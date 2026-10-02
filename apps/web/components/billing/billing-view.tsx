"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Coins, ExternalLink, Loader2, ReceiptText, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorState } from "@/components/states/error-state";
import { UsageChart } from "@/components/billing/usage-chart";
import {
  getBilling,
  getBillingCatalog,
  getMe,
  isBillingUnavailable,
  startCheckout,
  type CatalogPack,
  type CatalogPlan,
  type Currency,
} from "@/lib/api/phase6";
import { dailyUsage, defaultCurrency, formatMinor, formatPrice, ledgerReason, openRazorpay, providerFor } from "@/lib/billing";
import { cn } from "@/lib/utils";

const PLAN_LABEL = { free: "Free", pro: "Pro", business: "Business" } as const;
const PLAN_PERKS: Record<string, string[]> = {
  free: ["Watermark on videos", "Pay as you go with credit packs"],
  pro: ["No watermark", "All formats", "Brand kits"],
  business: ["No watermark", "Priority rendering", "Team-ready volume"],
};

type Purchase = { kind: "pack" | "plan"; id: string; label: string };

function useCheckoutReturn() {
  const params = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [banner, setBanner] = useState<"success" | "cancel" | null>(null);
  useEffect(() => {
    const status = params.get("checkout") ?? params.get("status");
    if (status !== "success" && status !== "cancel" && status !== "cancelled") return;
    setBanner(status === "success" ? "success" : "cancel");
    if (status === "success") {
      // Credits arrive via the provider webhook — poll briefly so the new balance shows up.
      let n = 0;
      const t = setInterval(() => {
        void queryClient.invalidateQueries({ queryKey: ["billing"] });
        void queryClient.invalidateQueries({ queryKey: ["credits"] });
        if (++n >= 5) clearInterval(t);
      }, 2000);
      router.replace("/billing", { scroll: false });
      return () => clearInterval(t);
    }
    router.replace("/billing", { scroll: false });
  }, [params, router, queryClient]);
  return [banner, setBanner] as const;
}

export function BillingView() {
  const queryClient = useQueryClient();
  const billing = useQuery({ queryKey: ["billing"], queryFn: getBilling });
  const catalog = useQuery({ queryKey: ["billing-catalog"], queryFn: getBillingCatalog, staleTime: 5 * 60_000 });
  const me = useQuery({ queryKey: ["me"], queryFn: getMe, retry: false, staleTime: 60_000 });
  const [currency, setCurrency] = useState<Currency>("USD");
  const [unavailable, setUnavailable] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [banner, setBanner] = useCheckoutReturn();

  useEffect(() => setCurrency(defaultCurrency()), []);

  const checkout = useMutation({
    mutationFn: async (p: Purchase) => {
      setPending(`${p.kind}:${p.id}`);
      const res = await startCheckout({ kind: p.kind, id: p.id, provider: providerFor(currency) });
      if (res.provider === "stripe") {
        window.location.assign(res.url);
        return "redirect" as const;
      }
      return openRazorpay({ keyId: res.keyId, orderId: res.orderId, amount: res.amount, currency: res.currency, description: p.label, email: me.data?.email });
    },
    onSuccess: (outcome) => {
      if (outcome === "redirect") return;
      setPending(null);
      if (outcome === "paid") {
        setBanner("success");
        toast.success("Payment received — your credits will appear in a moment.");
        void queryClient.invalidateQueries({ queryKey: ["billing"] });
        void queryClient.invalidateQueries({ queryKey: ["credits"] });
      } else if (outcome === "dismissed") {
        toast("Checkout closed — you weren't charged.");
      } else {
        toast.error(outcome.failed);
      }
    },
    onError: (err) => {
      setPending(null);
      if (isBillingUnavailable(err)) setUnavailable(true);
      else toast.error(`Couldn't start checkout: ${err instanceof Error ? err.message : "unknown error"}`);
    },
  });

  const buy = (p: Purchase) => checkout.mutate(p);

  if (billing.isPending) {
    return (
      <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading billing">
        <div className="grid gap-4 md:grid-cols-[1fr_2fr]">
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
        </div>
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }
  if (billing.isError) return <ErrorState error={billing.error} title="Couldn't load billing" onRetry={() => billing.refetch()} />;

  const b = billing.data;
  const usage = dailyUsage(b.ledger);

  return (
    <div className="flex flex-col gap-6">
      {banner && (
        <div
          role="status"
          className={cn(
            "flex items-center gap-2 rounded-lg border px-4 py-3 text-sm",
            banner === "success" ? "border-success/40 bg-success/10" : "border-border bg-card",
          )}
        >
          {banner === "success" ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <XCircle className="size-4 text-muted-foreground" aria-hidden />}
          {banner === "success" ? "Payment successful. Credits are added as soon as the payment provider confirms — usually within seconds." : "Checkout cancelled — you weren't charged."}
          <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setBanner(null)}>
            Dismiss
          </Button>
        </div>
      )}
      {unavailable && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <span>Payments are temporarily unavailable. Your plan and credits are unaffected — please try again later.</span>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <CardDescription>Current plan</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              {PLAN_LABEL[b.plan]}
              {b.plan === "free" && <Badge variant="secondary">watermark on</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="flex items-baseline gap-2">
              <Coins className="size-4 self-center text-primary" aria-hidden />
              <span className="font-mono text-3xl font-semibold tabular-nums">{b.credits}</span>
              <span className="text-sm text-muted-foreground">credits left</span>
            </p>
            <ul className="text-xs text-muted-foreground">
              {(PLAN_PERKS[b.plan] ?? []).map((p) => (
                <li key={p}>• {p}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Credits used</CardTitle>
          </CardHeader>
          <CardContent>
            <UsageChart data={usage} />
          </CardContent>
        </Card>
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="buy-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="buy-heading" className="text-lg font-semibold tracking-tight">
            Plans & credit packs
          </h2>
          <div className="flex items-center gap-1 rounded-lg bg-muted p-1 text-xs" role="group" aria-label="Currency">
            {(["INR", "USD"] as const).map((c) => (
              <Button key={c} size="xs" variant="ghost" className={cn(currency === c && "bg-background text-foreground ring-1 ring-primary/50")} aria-pressed={currency === c} onClick={() => setCurrency(c)}>
                {c === "INR" ? "₹ INR · Razorpay" : "$ USD · Stripe"}
              </Button>
            ))}
          </div>
        </div>
        {catalog.isPending && <Skeleton className="h-48 rounded-xl" />}
        {catalog.isError && <ErrorState error={catalog.error} title="Couldn't load prices" onRetry={() => catalog.refetch()} />}
        {catalog.data && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {catalog.data.plans.map((p: CatalogPlan) => {
              const current = b.plan === p.id;
              return (
                <Card key={p.id} className={cn(current && "border-primary/60")}>
                  <CardHeader>
                    <CardDescription>Plan</CardDescription>
                    <CardTitle className="flex items-center gap-2">
                      {p.name} {current && <Badge variant="success">Current</Badge>}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <p>
                      <span className="text-2xl font-semibold">{formatPrice(p.priceMonthly[currency], currency)}</span>
                      <span className="text-sm text-muted-foreground"> / month</span>
                    </p>
                    <p className="text-sm text-muted-foreground">{p.creditsPerMonth} credits every month · no watermark</p>
                    <Button
                      onClick={() => buy({ kind: "plan", id: p.id, label: `${p.name} plan` })}
                      disabled={current || checkout.isPending || unavailable}
                      variant={p.id === "pro" ? "default" : "secondary"}
                    >
                      {pending === `plan:${p.id}` && <Loader2 className="animate-spin motion-reduce:animate-none" />}
                      {current ? "Your plan" : `Upgrade to ${p.name}`}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
            {catalog.data.packs.map((p: CatalogPack) => (
              <Card key={p.id}>
                <CardHeader>
                  <CardDescription>Credit pack</CardDescription>
                  <CardTitle>{p.credits} credits</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p>
                    <span className="text-2xl font-semibold">{formatPrice(p.price[currency], currency)}</span>
                    <span className="text-sm text-muted-foreground"> one-time</span>
                  </p>
                  <p className="text-sm text-muted-foreground">Never expire · ≈ {formatPrice(Math.round((p.price[currency] / p.credits) * 100) / 100, currency)} per video</p>
                  <Button variant="secondary" onClick={() => buy({ kind: "pack", id: p.id, label: `${p.credits} credits` })} disabled={checkout.isPending || unavailable}>
                    {pending === `pack:${p.id}` && <Loader2 className="animate-spin motion-reduce:animate-none" />}
                    Buy pack
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Credit history</CardTitle>
          </CardHeader>
          <CardContent>
            {b.ledger.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No credit activity yet.</p>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>What</TableHead>
                      <TableHead className="text-right">Credits</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {b.ledger.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(e.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell>
                          {e.jobId ? (
                            <Link href={`/videos/${e.jobId}`} className="underline-offset-4 hover:underline">
                              {ledgerReason(e.reason)}
                            </Link>
                          ) : (
                            ledgerReason(e.reason)
                          )}
                        </TableCell>
                        <TableCell className={cn("text-right font-mono tabular-nums", e.delta > 0 ? "text-success" : "text-foreground")}>
                          {e.delta > 0 ? `+${e.delta}` : e.delta}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payments & invoices</CardTitle>
          </CardHeader>
          <CardContent>
            {b.payments.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
                <ReceiptText className="size-5" aria-hidden /> No payments yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Invoice</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {b.payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <span className="font-mono tabular-nums">{formatMinor(p.amount, p.currency)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {p.credits} credits · {p.provider === "razorpay" ? "Razorpay" : "Stripe"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={/captured|succeeded|paid/.test(p.status) ? "success" : /fail/.test(p.status) ? "destructive" : "secondary"}>{p.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {p.invoiceUrl ? (
                          <a href={p.invoiceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
                            View <ExternalLink className="size-3" aria-hidden />
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
