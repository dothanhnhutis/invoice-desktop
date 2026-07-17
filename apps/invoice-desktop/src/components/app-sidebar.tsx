import * as React from "react";
import {
  AudioWaveform,
  BanknoteArrowDownIcon,
  BanknoteArrowUpIcon,
  BookOpen,
  Bot,
  Command,
  Frame,
  GalleryVerticalEnd,
  Map,
  PieChart,
  Settings2,
  SquareTerminal,
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

// This is sample data.
const data = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "/avatars/shadcn.jpg",
  },
};

const navMain: (NavLinkType | NavLinkGroup)[] = [
  { icon: BanknoteArrowUpIcon, title: "Tra cứu", url: "#" },
  {
    icon: BanknoteArrowUpIcon,
    title: "Tra cứu",
    isActive: true,
    items: [
      {
        isActive: true,
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
