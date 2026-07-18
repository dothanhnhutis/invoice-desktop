import * as React from "react";
import {
  BanknoteArrowDownIcon,
  BanknoteArrowUpIcon,
  LayoutDashboardIcon,
} from "lucide-react";

import { NavLinkGroup, NavLinkType, NavMain } from "./nav-main";
import { NavUser } from "./nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

const data = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "/avatars/shadcn.jpg",
  },
};

const navMain: (NavLinkType | NavLinkGroup)[] = [
  { icon: LayoutDashboardIcon, title: "Bảng điều khiển", url: "#" },
  {
    icon: BanknoteArrowUpIcon,
    title: "Tra cứu",
    items: [
      {
        title: "Tra cứu hoá đơn",
        items: [
          {
            isActive: true,
            icon: BanknoteArrowUpIcon,
            title: "Đầu ra",
            url: "/sold",
          },
          {
            icon: BanknoteArrowDownIcon,
            title: "Đầu vào",
            url: "/purchase",
          },
        ],
      },
    ],
  },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>logo</SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
