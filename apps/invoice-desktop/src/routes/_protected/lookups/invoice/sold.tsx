import { createFileRoute, redirect } from "@tanstack/react-router";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_protected/lookups/invoice/sold")({
  beforeLoad: async () => {
    let ok = false;
    try {
      ok = await api.getFeatureInvoice();
    } catch {
      /* lỗi lệnh -> coi như chưa bật */
    }
    if (!ok) throw redirect({ to: "/settings/features" });
  },
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Tính năng đang được phát triển.....</div>;
}
