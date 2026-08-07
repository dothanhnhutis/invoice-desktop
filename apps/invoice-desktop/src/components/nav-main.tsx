import { ChevronRight, type LucideIcon } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from "@/components/ui/sidebar";
import { Link, useRouterState } from "@tanstack/react-router";

export type NavLinkType = {
  icon?: LucideIcon;
  title: string;
  url: string;
  /** Tiền tố path để tính active khi khác `url` (vd Cài đặt: bấm sang
   *  `/settings/features` nhưng sáng ở mọi `/settings/*`). Mặc định = `url`. */
  match?: string;
};

export type NavLinkGroup = Omit<NavLinkType, "url" | "match"> & {
  items: (NavLinkType | NavLinkGroup)[];
};

/** Mục lá active khi route hiện tại khớp `url` (kể cả route con, vd /coas active ở /coas/$id). */
export function isLeafActive(url: string, pathname: string) {
  if (!url || url === "#") return false;
  return pathname === url || pathname.startsWith(url + "/");
}

/** Nhóm/mục có chứa trang đang xem không (đệ quy). */
function hasActive(
  item: NavLinkType | NavLinkGroup,
  pathname: string,
): boolean {
  return "items" in item
    ? item.items.some((c) => hasActive(c, pathname))
    : isLeafActive(item.match ?? item.url, pathname);
}

function Tree({
  item,
  pathname,
}: {
  item: NavLinkType | NavLinkGroup;
  pathname: string;
}) {
  if (!("items" in item)) {
    return (
      <SidebarMenuButton
        isActive={isLeafActive(item.match ?? item.url, pathname)}
        className="data-[active=true]:bg-transparent"
        render={<Link to={item.url} />}
      >
        {item.icon && <item.icon />}
        {item.title}
      </SidebarMenuButton>
    );
  }
  return (
    <Collapsible
      key={item.title}
      render={<SidebarMenuItem />}
      defaultOpen={hasActive(item, pathname)}
      className="group/collapsible"
    >
      <CollapsibleTrigger render={<SidebarMenuButton tooltip={item.title} />}>
        {item.icon && <item.icon />}
        <span>{item.title}</span>
        <ChevronRight className="ml-auto transition-transform duration-200 group-data-open/collapsible:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenuSub className="mr-0 pr-0">
          {item.items.map((subItem, index) => (
            <Tree key={index} item={subItem} pathname={pathname} />
          ))}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function NavMain({ items }: { items: (NavLinkType | NavLinkGroup)[] }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Platform</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <Tree key={item.title} item={item} pathname={pathname} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
