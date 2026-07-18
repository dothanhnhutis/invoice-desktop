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
import { Link } from "@tanstack/react-router";

export type NavLinkType = {
  icon?: LucideIcon;
  isActive?: boolean;
  title: string;
  url: string;
};

export type NavLinkGroup = Omit<NavLinkType, "url"> & {
  items: (NavLinkType | NavLinkGroup)[];
};

function Tree({ item }: { item: NavLinkType | NavLinkGroup }) {
  if (!("items" in item)) {
    return (
      <SidebarMenuButton
        isActive={item.isActive}
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
      defaultOpen={item.isActive}
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
            <Tree key={index} item={subItem} />
          ))}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function NavMain({ items }: { items: (NavLinkType | NavLinkGroup)[] }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Platform</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <Tree key={item.title} item={item} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
