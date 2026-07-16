import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";

export const Route = createFileRoute("/_invoice/purchase")({
  component: RouteComponent,
});

type Invoice = {
  id: string;
  kind: string;
  seller_tax: string;
  buyer_tax: string;
  invoice_no: string;
  date: string;
  total: number;
  raw_json: string;
};

type SyncState = {
  oldest_date: string | null;
  newest_date: string | null;
  backfill_done: boolean;
  last_sync_at: number | null;
};

function RouteComponent() {
  const invoices = useQuery({
    queryKey: ["invoices"],
    queryFn: async () => {
      const data = await invoke<Invoice[]>("list_invoices", {
        filter: { limit: 50 },
      });
      console.log("[list_invoices]", data.length, data);
      return data;
    },
    refetchInterval: 3000,
  });

  const sync = useQuery({
    queryKey: ["sync_status"],
    queryFn: async () => {
      const s = await invoke<SyncState>("get_sync_status");
      console.log("[get_sync_status]", s);
      return s;
    },
    refetchInterval: 3000,
  });

  const lastSync = sync.data?.last_sync_at
    ? new Date(sync.data.last_sync_at * 1000).toLocaleString()
    : "chưa";

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div className="rounded-xl border p-4 text-sm">
        <p>
          Backfill xong:{" "}
          <b>{sync.data ? String(sync.data.backfill_done) : "…"}</b>
        </p>
        <p>
          Khoảng đã tải: {sync.data?.oldest_date ?? "?"} →{" "}
          {sync.data?.newest_date ?? "?"}
        </p>
        <p>Đồng bộ gần nhất: {lastSync}</p>
        <p>
          Hiển thị: <b>{invoices.data?.length ?? 0}</b> hóa đơn (tối đa 50)
        </p>
        {invoices.isError && (
          <p className="text-red-500">
            Lỗi list_invoices: {String(invoices.error)}
          </p>
        )}
      </div>

      <div className="rounded-xl border overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">Ngày</th>
              <th className="p-2">Số HĐ</th>
              <th className="p-2">MST người bán</th>
              <th className="p-2 text-right">Tổng tiền</th>
            </tr>
          </thead>
          <tbody>
            {invoices.data?.map((inv) => (
              <tr key={inv.id} className="border-b">
                <td className="p-2">{inv.date}</td>
                <td className="p-2">{inv.invoice_no}</td>
                <td className="p-2">{inv.seller_tax}</td>
                <td className="p-2 text-right">
                  {inv.total.toLocaleString("vi-VN")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
