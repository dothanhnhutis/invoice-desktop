import { createFileRoute, redirect } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import logo2 from "@/assets/logo2.png";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
} from "@/components/ui/breadcrumb";

import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import LoginDialog from "@/components/login-dialog";

export const Route = createFileRoute("/")({
  // Đã có credential -> vào thẳng app, khỏi qua màn đăng nhập.
  beforeLoad: async () => {
    const ok = await invoke<boolean>("has_credentials");
    if (!ok) {
      await invoke<boolean>("clear_credentials");
    } else throw redirect({ to: "/lookups/invoice/purchase" });
  },
  component: RouteComponent,
});
function RouteComponent() {
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <img src={logo2} alt="logo2" />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>
              <Skeleton className="h-3 w-20" />
            </SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuButton>
                <Skeleton className="h-8 w-full" />
              </SidebarMenuButton>
              <SidebarMenuButton>
                <Skeleton className="h-8 w-full" />
              </SidebarMenuButton>
              <SidebarMenuButton>
                <Skeleton className="h-8 w-full" />
              </SidebarMenuButton>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <Skeleton className="h-12 w-full" />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-50 backdrop-blur-lg flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <Skeleton className="size-7" />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-7"
            />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <Skeleton className="h-4 w-40" />
                </BreadcrumbItem>
                <BreadcrumbItem>
                  <Skeleton className="h-4 w-40" />
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="ml-auto px-4">
            <Skeleton className="size-10" />
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <div className="grid auto-rows-min gap-4 md:grid-cols-3">
            <div className="aspect-video rounded-xl bg-muted/50" />
            <div className="aspect-video rounded-xl bg-muted/50" />
            <div className="aspect-video rounded-xl bg-muted/50" />
          </div>
          <div className="min-h-screen flex-1 rounded-xl bg-muted/50 md:min-h-min" />
        </div>
        <LoginDialog />
      </SidebarInset>
    </SidebarProvider>
  );
}
