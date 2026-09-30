export function PhaseStub({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">Ships in {phase} — see MASTER_IMPLEMENTATION_PLAN.md.</p>
    </div>
  );
}
