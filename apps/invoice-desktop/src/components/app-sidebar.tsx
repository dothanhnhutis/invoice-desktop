import * as React from "react";
import {
  BanknoteArrowDownIcon,
  BanknoteArrowUpIcon,
  FileTextIcon,
  LayoutDashboardIcon,
} from "lucide-react";
import logo2 from "@/assets/logo2.png";
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
            icon: BanknoteArrowUpIcon,
            title: "Đầu ra",
            url: "/lookups/invoice/sold",
          },
          {
            icon: BanknoteArrowDownIcon,
            title: "Đầu vào",
            url: "/lookups/invoice/purchase",
          },
        ],
      },
    ],
  },
  {
    icon: FileTextIcon,
    title: "Certificate of Analysis",
    url: "/coas",
  },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <img src={logo2} alt="logo2" />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
