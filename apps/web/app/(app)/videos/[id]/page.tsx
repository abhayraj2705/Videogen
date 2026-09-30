import { PhaseStub } from "@/components/app-shell/phase-stub";

export default async function VideoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PhaseStub title={`Video ${id.slice(0, 8)}…`} phase="Phase 5 (W5/W6/W7 — pipeline, review, result)" />;
}
