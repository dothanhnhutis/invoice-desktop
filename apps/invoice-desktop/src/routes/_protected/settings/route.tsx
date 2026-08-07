import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import {
  createFileRoute,
  Link,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { BellIcon, ClipboardCheckIcon, PaintbrushIcon } from "lucide-react";
import { isLeafActive } from "@/components/nav-main";

export const Route = createFileRoute("/_protected/settings")({
  component: RouteComponent,
});

const data = {
  nav: [
    {
      name: "Tính năng",
      icon: ClipboardCheckIcon,
      url: "/settings/features",
    },
    {
      name: "Giao diện",
      icon: PaintbrushIcon,
      url: "/settings/accessibilitys",
    },
    { name: "Thông báo", icon: BellIcon, url: "/settings/notifications" },
  ],
};

function RouteComponent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="container mx-auto p-4">
      <SidebarProvider className="items-start flex-col md:flex-row min-h-auto">
        <Sidebar
          collapsible="none"
          className="w-full md:w-(--sidebar-width) bg-transparent"
        >
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel className="hidden md:block">
                Cài đặt
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="flex-row md:flex-col overflow-y-scroll md:overflow-auto">
                  {data.nav.map((item) => (
                    <SidebarMenuItem key={item.name}>
                      <SidebarMenuButton
                        render={<Link to={item.url} />}
                        isActive={isLeafActive(item.url, pathname)}
                      >
                        <item.icon />
                        <span>{item.name}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>

        <Outlet />
      </SidebarProvider>
    </div>
  );
}
