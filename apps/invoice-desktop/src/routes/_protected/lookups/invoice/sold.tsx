import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_protected/lookups/invoice/sold")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/_protected/lookups/invoice/sold"!</div>;
}
