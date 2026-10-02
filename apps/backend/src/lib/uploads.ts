import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Bucket, StorageClient } from "@sitereel/storage";

/**
 * Presigned uploads (§8.1: size limit + content-type allowlist).
 *
 * S3/R2: a real presigned PUT URL. Local driver: there is no object store to
 * presign against, so the URL points at this backend's
 * `PUT /api/uploads/local/:token`, where `token` is an HMAC-signed, expiring
 * grant for exactly one (bucket, key, content-type, max size).
 */

export const UPLOAD_MAX_FILES = 8;
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const UPLOAD_TTL_SEC = 15 * 60;

export const IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
} as const;
export type ImageType = keyof typeof IMAGE_TYPES;

export const UploadFileSpec = z.object({
  name: z.string().trim().min(1).max(255),
  type: z.enum(Object.keys(IMAGE_TYPES) as [ImageType, ...ImageType[]], {
    errorMap: () => ({ message: "Only PNG, JPEG, WebP or SVG images can be uploaded" }),
  }),
  size: z
    .number()
    .int()
    .positive()
    .max(UPLOAD_MAX_BYTES, { message: `Each file must be ${UPLOAD_MAX_BYTES / 1024 / 1024} MB or smaller` }),
});
export type UploadFileSpec = z.infer<typeof UploadFileSpec>;

export const PresignRequest = z.object({
  files: z
    .array(UploadFileSpec)
    .min(1, { message: "Add at least one file" })
    .max(UPLOAD_MAX_FILES, { message: `At most ${UPLOAD_MAX_FILES} files per upload` }),
});

export const LogoPresignRequest = UploadFileSpec.omit({ name: true });

export interface PresignedUpload {
  url: string;
  key: string;
  method: "PUT";
  headers: Record<string, string>;
}

/** 12 url-safe random chars — collision-free enough for per-job upload keys. */
export function randomKeyId(): string {
  return randomBytes(9).toString("base64url");
}

export interface UploadGrant {
  bucket: Bucket;
  key: string;
  type: string;
  size: number;
  /** Unix seconds. */
  exp: number;
}

export function signUploadToken(grant: UploadGrant, secret: string): string {
  const payload = Buffer.from(JSON.stringify(grant)).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyUploadToken(token: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): UploadGrant | undefined {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return undefined;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  try {
    const grant = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as UploadGrant;
    if (typeof grant.exp !== "number" || grant.exp < nowSec) return undefined;
    if (typeof grant.key !== "string" || (grant.bucket !== "assets" && grant.bucket !== "renders")) return undefined;
    return grant;
  } catch {
    return undefined;
  }
}

export interface UploadSigner {
  presign(bucket: Bucket, key: string, type: string, size: number): Promise<PresignedUpload>;
}

export function createUploadSigner(opts: {
  storage: StorageClient;
  storageDriver: "local" | "s3";
  apiPublicUrl: string;
  tokenSecret: string;
  ttlSec?: number;
}): UploadSigner {
  const ttl = opts.ttlSec ?? UPLOAD_TTL_SEC;
  return {
    async presign(bucket, key, type, size) {
      const headers = { "Content-Type": type };
      if (opts.storageDriver === "s3") {
        return { url: await opts.storage.presignUpload(bucket, key, type, ttl), key, method: "PUT", headers };
      }
      const token = signUploadToken({ bucket, key, type, size, exp: Math.floor(Date.now() / 1000) + ttl }, opts.tokenSecret);
      return { url: `${opts.apiPublicUrl.replace(/\/$/, "")}/api/uploads/local/${token}`, key, method: "PUT", headers };
    },
  };
}

/** SVG uploads are served back to browsers (logos), so refuse anything scriptable. */
export function isSafeSvg(body: Buffer): boolean {
  const text = body.toString("utf8").toLowerCase();
  return !/<script|javascript:|\son[a-z]+\s*=|<foreignobject|<iframe|<embed|<object/.test(text);
}
