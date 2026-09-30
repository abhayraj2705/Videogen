import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/app-shell/sidebar";
import { Topbar } from "@/components/app-shell/topbar";
import { MobileTabbar } from "@/components/app-shell/mobile-tabbar";
import { CommandMenu } from "@/components/app-shell/command-menu";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar email={user.email ?? null} />
        <main className="flex-1 overflow-y-auto px-6 py-8 pb-20 md:pb-8">{children}</main>
      </div>
      <MobileTabbar />
      <CommandMenu />
    </div>
  );
}
