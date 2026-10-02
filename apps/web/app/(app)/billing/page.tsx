import { Suspense } from "react";
import { BillingView } from "@/components/billing/billing-view";

export default function BillingPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-sm text-muted-foreground">Your plan, credits and payments. One credit makes one video in one format.</p>
      </div>
      <Suspense>
        <BillingView />
      </Suspense>
    </div>
  );
}
