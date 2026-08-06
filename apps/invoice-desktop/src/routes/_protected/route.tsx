import { AppSidebar } from "@/components/app-sidebar";
import NavHeader from "@/components/nav-header";
import {
  SidebarInset,
  SidebarProvider,
  SidebarRail,
} from "@/components/ui/sidebar";
import { SyncProvider } from "@/contexts/sync-context";
import { createFileRoute, Outlet } from "@tanstack/react-router";

// Không còn bắt buộc đăng nhập GDT: vào thẳng app. Đăng nhập/bật hoá đơn qua Cài đặt.
export const Route = createFileRoute("/_protected")({
  component: ProtectedLayout,
});

function ProtectedLayout() {
  return (
    <SyncProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <NavHeader />
          <Outlet />
        </SidebarInset>
        <SidebarRail />
      </SidebarProvider>
    </SyncProvider>
  );
}
