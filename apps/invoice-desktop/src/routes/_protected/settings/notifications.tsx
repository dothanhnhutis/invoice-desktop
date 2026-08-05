import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_protected/settings/notifications")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/_protected/settings/notifications"!</div>;
}
