import type { Metadata } from "next";
import { TAKEDOWN_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Acceptable Use Policy — SiteReel",
  description: "What you may and may not use SiteReel for, and how to request a takedown.",
};

export default function AcceptableUsePage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Acceptable Use Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Draft for the closed beta — to be reviewed by counsel before public launch (§8.2). Not legal advice.
      </p>

      <section className="mt-10 flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-lg font-medium text-foreground">You may use SiteReel to</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Create promotional videos for websites you own or operate.</li>
          <li>Create videos for clients or employers who have authorised you to promote their site.</li>
        </ul>
      </section>

      <section className="mt-8 flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-lg font-medium text-foreground">You may not use SiteReel to</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Promote, impersonate or misrepresent a website, brand or person without permission.</li>
          <li>Make false, misleading or unverified claims (anything we can&apos;t ground in the site is flagged).</li>
          <li>Create content that is illegal, hateful, harassing, sexually explicit or that infringes intellectual property.</li>
          <li>Process sites behind logins you aren&apos;t authorised to share, or attempt to bypass our crawler safeguards.</li>
          <li>Remove or obscure the watermark on free-plan videos.</li>
        </ul>
        <p>
          We may suspend accounts and remove videos that break this policy. Every video request requires you to confirm that you own the site
          or have permission to promote it.
        </p>
      </section>

      <section id="takedown" className="mt-8 scroll-mt-20 rounded-xl border border-border bg-card p-6 text-sm leading-relaxed">
        <h2 className="text-lg font-medium">Takedown requests</h2>
        <p className="mt-2 text-muted-foreground">
          If a SiteReel video uses your website, brand or content without permission, email{" "}
          <a href={`mailto:${TAKEDOWN_EMAIL}`} className="text-primary underline underline-offset-4">
            {TAKEDOWN_EMAIL}
          </a>{" "}
          with:
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>The public video link (for example, https://sitereel.app/v/…).</li>
          <li>The website or brand concerned, and your relationship to it.</li>
          <li>A short statement that you believe the use is unauthorised.</li>
        </ol>
        <p className="mt-3 text-muted-foreground">
          We aim to disable the public link within 2 business days and will tell you what action we took. Repeat offenders lose access.
        </p>
      </section>
    </main>
  );
}
