import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { brandKits, type Db } from "@sitereel/db";
import { brandKitLogoPrefix } from "@sitereel/shared";
import type { StorageClient } from "@sitereel/storage";
import type { AuthVerifier } from "../lib/auth.js";
import type { Logger } from "../lib/logger.js";
import { isUuid, sendError, sendInvalidBody } from "../lib/http.js";
import { serveAsset } from "../lib/assets.js";
import { IMAGE_TYPES, LogoPresignRequest, randomKeyId, type UploadSigner } from "../lib/uploads.js";

export interface BrandKitRouteDeps {
  db: Db;
  storage: StorageClient;
  storageDriver: "local" | "s3";
  verifyAuth: AuthVerifier;
  logger: Logger;
  uploads: UploadSigner;
}

/** CSS colors we accept: hex, rgb()/rgba()/hsl()/hsla(). No url(), no expressions. */
const CssColor = z
  .string()
  .trim()
  .max(64)
  .regex(/^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\([0-9.,%\s/deg-]+\))$/, { message: "Use a hex, rgb() or hsl() color" });

const FontName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[\w\s,'"-]+$/, { message: "Font names may contain letters, numbers, spaces, commas, quotes and dashes" });

const Colors = z.object({
  primary: CssColor,
  secondary: CssColor.optional(),
  background: CssColor,
  foreground: CssColor,
  accent: CssColor.optional(),
});
const Fonts = z.object({ heading: FontName, body: FontName });

const CreateKitBody = z.object({
  name: z.string().trim().min(1).max(80),
  colors: Colors,
  fonts: Fonts,
  logoKey: z.string().max(300).nullable().optional(),
  sourceUrl: z.string().url().max(2000).nullable().optional(),
});
const UpdateKitBody = CreateKitBody.partial().refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" });

type KitRow = typeof brandKits.$inferSelect;

export interface BrandKitView {
  id: string;
  name: string;
  colors: KitRow["colors"];
  fonts: KitRow["fonts"];
  logoUrl: string | null;
  sourceUrl: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toBrandKit(row: KitRow): BrandKitView {
  return {
    id: row.id,
    name: row.name,
    colors: row.colors,
    fonts: row.fonts,
    // Relative to the API base, like RenderInfo URLs; media route accepts ?token=.
    logoUrl: row.logoKey ? `/api/brand-kits/${row.id}/logo` : null,
    sourceUrl: row.sourceUrl ?? null,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * W10 brand kits.
 *   GET    /api/brand-kits                     → { kits }
 *   POST   /api/brand-kits                     → 201 BrandKit
 *   PATCH  /api/brand-kits/:id                 → BrandKit
 *   DELETE /api/brand-kits/:id                 → 204
 *   POST   /api/brand-kits/:id/default         → BrandKit
 *   POST   /api/brand-kits/:id/logo/presign    { type, size } → { url, key, method, headers }
 *   GET    /api/brand-kits/:id/logo            logo image (media; accepts ?token=)
 *
 * A kit's logoKey must live under users/{userId}/brand-kits/{kitId}/ (i.e. come
 * from this kit's logo presign) — otherwise a user could point their kit at
 * another user's object.
 */
export function registerBrandKitRoutes(app: FastifyInstance, deps: BrandKitRouteDeps): void {
  const { db } = deps;

  async function loadOwnedKit(kitId: string, userId: string): Promise<KitRow | undefined> {
    if (!isUuid(kitId)) return undefined;
    const [row] = await db
      .select()
      .from(brandKits)
      .where(and(eq(brandKits.id, kitId), eq(brandKits.userId, userId)))
      .limit(1);
    return row;
  }

  /** Logo keys must come from one of this user's logo presigns: users/{userId}/brand-kits/{kitId}/logo-{id}.{ext}. */
  const logoKeyOk = (key: string, userId: string) => {
    const prefix = `users/${userId}/brand-kits/`;
    return key.startsWith(prefix) && /^[0-9a-f-]{36}\/logo-[A-Za-z0-9_-]+\.(png|jpg|webp|svg)$/.test(key.slice(prefix.length));
  };

  app.get("/api/brand-kits", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;
    const rows = await db.select().from(brandKits).where(eq(brandKits.userId, user.id)).orderBy(desc(brandKits.isDefault), desc(brandKits.updatedAt));
    return reply.send({ kits: rows.map(toBrandKit) });
  });

  app.post("/api/brand-kits", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;
    const parsed = CreateKitBody.safeParse(req.body);
    if (!parsed.success) return sendInvalidBody(reply, parsed.error);
    if (parsed.data.logoKey && !logoKeyOk(parsed.data.logoKey, user.id)) {
      return sendError(reply, 400, "invalid_logo_key", "Upload the logo through a brand kit logo upload first.");
    }
    const [existing] = await db.select({ id: brandKits.id }).from(brandKits).where(eq(brandKits.userId, user.id)).limit(1);
    const [row] = await db
      .insert(brandKits)
      .values({
        userId: user.id,
        name: parsed.data.name,
        colors: parsed.data.colors,
        fonts: parsed.data.fonts,
        sourceUrl: parsed.data.sourceUrl ?? null,
        logoKey: parsed.data.logoKey ?? null,
        // First kit becomes the default.
        isDefault: !existing,
      })
      .returning();
    return reply.code(201).send(toBrandKit(row!));
  });

  app.patch<{ Params: { id: string } }>("/api/brand-kits/:id", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;
    const parsed = UpdateKitBody.safeParse(req.body);
    if (!parsed.success) return sendInvalidBody(reply, parsed.error);
    const kit = await loadOwnedKit(req.params.id, user.id);
    if (!kit) return sendError(reply, 404, "not_found", "Brand kit not found.");
    const body = parsed.data;
    if (body.logoKey && body.logoKey !== kit.logoKey && !logoKeyOk(body.logoKey, user.id)) {
      return sendError(reply, 400, "invalid_logo_key", "Upload the logo through this kit's logo upload first.");
    }
    const [row] = await db
      .update(brandKits)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.colors !== undefined ? { colors: body.colors } : {}),
        ...(body.fonts !== undefined ? { fonts: body.fonts } : {}),
        ...(body.logoKey !== undefined ? { logoKey: body.logoKey } : {}),
        ...(body.sourceUrl !== undefined ? { sourceUrl: body.sourceUrl } : {}),
        updatedAt: new Date(),
      })
      .where(eq(brandKits.id, kit.id))
      .returning();
    return reply.send(toBrandKit(row!));
  });

  app.delete<{ Params: { id: string } }>("/api/brand-kits/:id", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;
    const kit = await loadOwnedKit(req.params.id, user.id);
    if (!kit) return sendError(reply, 404, "not_found", "Brand kit not found.");
    // jobs.brand_kit_id is ON DELETE SET NULL; finished videos keep what they rendered.
    await db.delete(brandKits).where(eq(brandKits.id, kit.id));
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>("/api/brand-kits/:id/default", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;
    const kit = await loadOwnedKit(req.params.id, user.id);
    if (!kit) return sendError(reply, 404, "not_found", "Brand kit not found.");
    const row = await db.transaction(async (tx) => {
      // Clear first: brand_kits_one_default_per_user is a unique partial index.
      await tx.update(brandKits).set({ isDefault: false }).where(and(eq(brandKits.userId, user.id), eq(brandKits.isDefault, true)));
      const [updated] = await tx.update(brandKits).set({ isDefault: true, updatedAt: new Date() }).where(eq(brandKits.id, kit.id)).returning();
      return updated!;
    });
    return reply.send(toBrandKit(row));
  });

  app.post<{ Params: { id: string } }>("/api/brand-kits/:id/logo/presign", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;
    const parsed = LogoPresignRequest.safeParse(req.body);
    if (!parsed.success) return sendInvalidBody(reply, parsed.error);
    const kit = await loadOwnedKit(req.params.id, user.id);
    if (!kit) return sendError(reply, 404, "not_found", "Brand kit not found.");
    const key = `${brandKitLogoPrefix(user.id, kit.id)}logo-${randomKeyId()}.${IMAGE_TYPES[parsed.data.type]}`;
    return reply.send(await deps.uploads.presign("assets", key, parsed.data.type, parsed.data.size));
  });

  app.get<{ Params: { id: string } }>("/api/brand-kits/:id/logo", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;
    const kit = await loadOwnedKit(req.params.id, user.id);
    if (!kit?.logoKey) return sendError(reply, 404, "not_found", "Logo not found.");
    return serveAsset(reply, { storage: deps.storage, storageDriver: deps.storageDriver, bucket: "assets", key: kit.logoKey, cacheControl: "private, max-age=300" });
  });
}
