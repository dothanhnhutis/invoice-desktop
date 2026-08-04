import { AppSidebar } from "@/components/app-sidebar";
import NavHeader from "@/components/nav-header";
import {
  SidebarInset,
  SidebarProvider,
  SidebarRail,
} from "@/components/ui/sidebar";
import { AuthProvider, Profile } from "@/contexts/auth-context";
import { SyncProvider } from "@/contexts/sync-context";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";

export const Route = createFileRoute("/_protected")({
  beforeLoad: async () => {
    const ok = await invoke<boolean>("has_credentials");
    if (!ok) {
      await invoke<boolean>("clear_credentials");
      throw redirect({ to: "/" });
    }
  },

  loader: async () => {
    const profile = await invoke<Profile | null>("profile");
    if (!profile) {
      await invoke<boolean>("clear_credentials");
      throw redirect({ to: "/" });
    }
    return { profile };
  },
  component: ProtectedLayout,
});

function ProtectedLayout() {
  const { profile } = Route.useLoaderData();
  return (
    <SyncProvider>
      <AuthProvider profile={profile}>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset className="min-w-0">
            <NavHeader />
            <Outlet />
          </SidebarInset>
          <SidebarRail />
        </SidebarProvider>
      </AuthProvider>
    </SyncProvider>
  );
}
