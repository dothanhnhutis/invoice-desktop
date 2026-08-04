import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_protected/lookups/invoice/sold")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Tính năng đang được phát triển.....</div>;
}
