"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorState } from "@/components/states/error-state";
import { createClient } from "@/lib/supabase/client";
import { deleteMe, getMe, mePref, updateMe, type Me, type MePrefs } from "@/lib/api/phase6";
import { VOICES } from "@/lib/voices";

function useSavePrefs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<MePrefs>) => updateMe(patch),
    onSuccess: (me) => {
      queryClient.setQueryData(["me"], me);
      toast.success("Settings saved");
    },
    onError: (err) => toast.error(`Couldn't save: ${err instanceof Error ? err.message : "unknown error"}`),
  });
}

function ProfileTab({ me }: { me: Me }) {
  const save = useSavePrefs();
  const [name, setName] = useState(mePref(me, "displayName") ?? "");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Profile</CardTitle>
        <CardDescription>How you appear in SiteReel.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex max-w-md flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ displayName: name.trim() });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="display-name">Display name</Label>
            <Input id="display-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Your name" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={me.email} readOnly disabled />
            <p className="text-xs text-muted-foreground">You sign in with a magic link sent to this address.</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Plan: <span className="capitalize text-foreground">{me.plan}</span> · Member since {new Date(me.createdAt).toLocaleDateString()}
          </p>
          <Button type="submit" className="self-start" disabled={save.isPending || name.trim() === (mePref(me, "displayName") ?? "")}>
            {save.isPending && <Loader2 className="animate-spin motion-reduce:animate-none" />} Save profile
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function NotificationsTab({ me }: { me: Me }) {
  const save = useSavePrefs();
  const enabled = mePref(me, "emailNotifications") !== false;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Notifications</CardTitle>
        <CardDescription>We only email you about your own videos.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
          <div>
            <Label htmlFor="email-notify" className="text-sm">
              Email me when a video is ready
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">Also when we need screenshots from you to continue.</p>
          </div>
          <Switch id="email-notify" checked={enabled} disabled={save.isPending} onCheckedChange={(v) => save.mutate({ emailNotifications: v })} />
        </div>
      </CardContent>
    </Card>
  );
}

function DefaultsTab({ me }: { me: Me }) {
  const save = useSavePrefs();
  const [format, setFormat] = useState<MePrefs["defaultFormat"]>(mePref(me, "defaultFormat") ?? "16:9");
  const [voice, setVoice] = useState(mePref(me, "defaultVoiceId") ?? "default");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Defaults for new videos</CardTitle>
        <CardDescription>Preselected on the create page — you can still change them per video.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex max-w-md flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ defaultFormat: format, defaultVoiceId: voice });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="default-format">Format</Label>
            <Select id="default-format" value={format} onChange={(e) => setFormat(e.target.value as MePrefs["defaultFormat"])}>
              <option value="16:9">16:9 — YouTube, landing page</option>
              <option value="9:16">9:16 — Reels, Shorts, Stories</option>
              <option value="1:1">1:1 — Feed post</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="default-voice">Voice</Label>
            <Select id="default-voice" value={voice} onChange={(e) => setVoice(e.target.value)}>
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} — {v.description}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" className="self-start" disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin motion-reduce:animate-none" />} Save defaults
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function DangerTab({ me }: { me: Me }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const matches = typed.trim().toLowerCase() === me.email.toLowerCase();
  const del = useMutation({
    mutationFn: deleteMe,
    onSuccess: async () => {
      toast.success("Your account is being deleted. Goodbye!");
      try {
        await createClient().auth.signOut();
      } finally {
        router.push("/");
        router.refresh();
      }
    },
    onError: (err) => toast.error(`Couldn't delete your account: ${err instanceof Error ? err.message : "unknown error"}`),
  });
  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-destructive">
          <AlertTriangle className="size-4" aria-hidden /> Delete account
        </CardTitle>
        <CardDescription>
          Permanently deletes your account, every video, render, share link and brand kit. Unused credits are forfeited. This can&apos;t be undone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Delete my account
        </Button>
      </CardContent>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setTyped("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              Type <span className="font-mono text-foreground">{me.email}</span> to confirm. Everything is removed within a few minutes.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (matches) del.mutate();
            }}
          >
            <Input aria-label="Type your email to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" placeholder={me.email} />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" variant="destructive" disabled={!matches || del.isPending}>
                {del.isPending && <Loader2 className="animate-spin motion-reduce:animate-none" />} Delete forever
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

const TABS = ["profile", "notifications", "defaults", "danger"] as const;
type Tab = (typeof TABS)[number];

export function SettingsView() {
  const me = useQuery({ queryKey: ["me"], queryFn: getMe });
  const [tab, setTab] = useState<Tab>("profile");
  useEffect(() => {
    const h = window.location.hash.slice(1) as Tab;
    if (TABS.includes(h)) setTab(h);
  }, []);

  if (me.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading settings">
        <Skeleton className="h-9 w-full max-w-md" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }
  if (me.isError) return <ErrorState error={me.error} title="Couldn't load your settings" onRetry={() => me.refetch()} />;

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => {
        setTab(v as Tab);
        history.replaceState(null, "", `#${v}`);
      }}
    >
      <TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="notifications">Notifications</TabsTrigger>
        <TabsTrigger value="defaults">Defaults</TabsTrigger>
        <TabsTrigger value="danger">Danger zone</TabsTrigger>
      </TabsList>
      <TabsContent value="profile">
        <ProfileTab me={me.data} />
      </TabsContent>
      <TabsContent value="notifications">
        <NotificationsTab me={me.data} />
      </TabsContent>
      <TabsContent value="defaults">
        <DefaultsTab me={me.data} />
      </TabsContent>
      <TabsContent value="danger">
        <DangerTab me={me.data} />
      </TabsContent>
    </Tabs>
  );
}
