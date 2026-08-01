import React from "react";
import { Link, useMatches } from "@tanstack/react-router";
import { SidebarTrigger } from "./ui/sidebar";
import { Separator } from "./ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { BellIcon } from "lucide-react";
import { Button } from "./ui/button";

type Crumb = { label: string; to?: string };

/** Đường dẫn breadcrumb theo route lá đang khớp (nhãn khớp sidebar). */
function useTrail(): Crumb[] {
  const matches = useMatches();
  const leaf = matches[matches.length - 1];
  switch (leaf?.routeId) {
    case "/_protected/lookups/invoice/purchase":
      return [{ label: "Tra cứu hoá đơn" }, { label: "Đầu vào" }];
    case "/_protected/lookups/invoice/sold":
      return [{ label: "Tra cứu hoá đơn" }, { label: "Đầu ra" }];
    case "/_protected/coas":
      return [{ label: "Certificate of Analysis" }];
    case "/_protected/coas_/$id": {
      const code = (leaf.loaderData as { code?: string } | undefined)?.code;
      return [
        { label: "Certificate of Analysis", to: "/coas" },
        { label: code ?? "Chi tiết" },
      ];
    }
    default:
      return [{ label: "Bảng điều khiển" }];
  }
}

const NavHeader = () => {
  const trail = useTrail();
  return (
    <header className="sticky top-0 z-50 backdrop-blur-lg flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
      <div className="flex items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mr-2 data-[orientation=vertical]:h-4"
        />
        <Breadcrumb>
          <BreadcrumbList>
            {trail.map((c, i) => {
              const isLast = i === trail.length - 1;
              return (
                <React.Fragment key={i}>
                  <BreadcrumbItem>
                    {isLast ? (
                      <BreadcrumbPage>{c.label}</BreadcrumbPage>
                    ) : c.to ? (
                      <BreadcrumbLink render={<Link to={c.to} />}>
                        {c.label}
                      </BreadcrumbLink>
                    ) : (
                      <span>{c.label}</span>
                    )}
                  </BreadcrumbItem>
                  {!isLast && <BreadcrumbSeparator />}
                </React.Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="ml-auto px-4">
        <Button variant="secondary" size={"icon-lg"}>
          <BellIcon />
        </Button>
      </div>
    </header>
  );
};

export default NavHeader;
