"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cancelJob } from "@/lib/api/phase6";

/** POST /api/jobs/:id/cancel — credits are refunded if no render completed. */
export function CancelJobButton({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => cancelJob(jobId),
    onSuccess: () => {
      setOpen(false);
      toast.success("Job cancelled");
      void queryClient.invalidateQueries({ queryKey: ["job", jobId] });
      void queryClient.invalidateQueries({ queryKey: ["credits"] });
    },
    onError: (err) => toast.error(`Couldn't cancel: ${err instanceof Error ? err.message : "unknown error"}`),
  });
  return (
    <>
      <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setOpen(true)}>
        <Square className="size-3.5" aria-hidden /> Cancel
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this video?</DialogTitle>
            <DialogDescription>Processing stops right away. If nothing has rendered yet, your credits are refunded.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Keep going</Button>
            </DialogClose>
            <Button variant="destructive" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="animate-spin motion-reduce:animate-none" />} Cancel video
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
