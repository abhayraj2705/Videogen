"use client";

import { use } from "react";
import { ReviewEditor } from "@/components/editor/review-editor";

export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ReviewEditor jobId={id} />;
}
