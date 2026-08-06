import * as React from "react";
import {
  BanknoteArrowDownIcon,
  BanknoteArrowUpIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  ReceiptTextIcon,
  SettingsIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import logo2 from "@/assets/logo2.png";
import { api, FEATURE_INVOICE_KEY, FEATURE_RAW_MATERIALS_KEY } from "@/lib/api";
import { NavLinkGroup, NavLinkType, NavMain } from "./nav-main";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

const navMain: (NavLinkType | NavLinkGroup)[] = [
  { icon: LayoutDashboardIcon, title: "Bảng điều khiển", url: "#" },
  {
    icon: ReceiptTextIcon,
    title: "Hoá đơn",
    items: [
      {
        title: "Tra cứu",
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
    title: "Nguyên liệu & COA",
    url: "/coas",
  },
  {
    icon: SettingsIcon,
    title: "Cài đặt",
    url: "/settings/features",
  },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  // Ẩn mục theo cờ tính năng (chung queryKey với trang Cài đặt).
  const rmEnabled =
    useQuery({
      queryKey: FEATURE_RAW_MATERIALS_KEY,
      queryFn: api.getFeatureRawMaterials,
    }).data ?? true;
  const invoiceEnabled =
    useQuery({
      queryKey: FEATURE_INVOICE_KEY,
      queryFn: api.getFeatureInvoice,
    }).data ?? false;

  const items = navMain.filter((i) => {
    if (!rmEnabled && "url" in i && i.url === "/coas") return false;
    if (!invoiceEnabled && i.title === "Hoá đơn") return false;
    return true;
  });

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
        <NavMain items={items} />
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
