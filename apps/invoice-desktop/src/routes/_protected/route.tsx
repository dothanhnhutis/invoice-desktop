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
  // Guard xác thực: chạy TRƯỚC khi render mọi trang con của _protected.
  // Chưa lưu credential (keychain trống) -> đá về "/" (màn đăng nhập).
  beforeLoad: async () => {
    const ok = await invoke<boolean>("has_credentials");
    if (!ok) {
      await invoke<boolean>("clear_credentials");
      throw redirect({ to: "/" });
    }
  },

  // 2. loader nhận được currentUser từ context của beforeLoad
  loader: async () => {
    const profile = await invoke<Profile | null>("profile");
    if (!profile) {
      await invoke<boolean>("clear_credentials");
      throw redirect({ to: "/" });
    }
    return { profile };
  },

  //   // 3. Component nhận data từ loader
  //   component: () => {
  //     const { stats, user } = Route.useLoaderData();
  //     return <div>Xin chào {user.name}</div>;
  //   },
  component: ProtectedLayout,
});

function ProtectedLayout() {
  const { profile } = Route.useLoaderData();
  console.log("12", profile);
  return (
    <SyncProvider>
      <AuthProvider profile={profile}>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>
            <NavHeader />
            <Outlet />
          </SidebarInset>
          <SidebarRail />
        </SidebarProvider>
      </AuthProvider>
    </SyncProvider>
  );
}
