import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useSync } from "@/contexts/sync-context";

export const Route = createFileRoute("/_protected/lookups/invoice/purchase")({
  component: RouteComponent,
});

const PAGE_SIZE = 50;

// Khớp domain::Invoice (field thô GDT).
type Invoice = {
  id: string;
  kind: string;
  nbmst: string;
  khmshdon: number;
  khhdon: string;
  shdon: number;
  dvtte: string;
  nbdchi: string;
  nbten: string;
  tgtcthue: number;
  tgtthue: number;
  tgtttbso: number;
  tlhdon: string;
  ttcktmai: number;
  tthai: number;
  ttxly: number;
  ntao: string;
  nmten: string;
  nmmst: string;
  nmdchi: string;
  raw_json: string;
};

type SyncState = {
  oldest_date: string | null;
  newest_date: string | null;
  backfill_done: boolean;
  last_sync_at: number | null;
};

function RouteComponent() {
  const { progress, error } = useSync(); // tiến độ/lỗi realtime (listener toàn cục ở __root)
  const [page, setPage] = useState(0);

  const invoices = useQuery({
    queryKey: ["invoices"],
    queryFn: async () => {
      // Lấy toàn bộ hóa đơn đã đồng bộ; phân trang hiển thị ở client.
      const data = await invoke<Invoice[]>("list_invoices", { filter: {} });
      return data;
    },
    refetchInterval: 3000,
  });

  const sync = useQuery({
    queryKey: ["sync_status"],
    queryFn: async () => invoke<SyncState>("get_sync_status"),
    refetchInterval: 3000,
  });

  const rows = invoices.data ?? [];
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  // Kẹp trang khi dữ liệu co lại (vd sau prune) để không hiện trang trống.
  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1);
  }, [pageCount, page]);

  const lastSync = sync.data?.last_sync_at
    ? new Date(sync.data.last_sync_at * 1000).toLocaleString()
    : "chưa";

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      {error && (
        <div className="rounded-xl border border-red-500 bg-red-500/10 p-3 text-sm text-red-500">
          {error}
        </div>
      )}
      {progress && !error && (
        <div className="rounded-xl border p-3 text-sm text-muted-foreground">
          Đang đồng bộ ({progress.phase}) · lưu lượt này: {progress.saved} ·
          tổng: {progress.total_in_db}
        </div>
      )}

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
          Tổng: <b>{rows.length}</b> hóa đơn · trang{" "}
          <b>{Math.min(page + 1, pageCount)}</b>/{pageCount}
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
              <th className="p-2">Ngày tạo</th>
              <th className="p-2">Số HĐ</th>
              <th className="p-2">MST người bán</th>
              <th className="p-2">Tên người bán</th>
              <th className="p-2 text-right">Tổng tiền</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((inv) => (
              <tr key={inv.id} className="border-b">
                <td className="p-2">{inv.ntao}</td>
                <td className="p-2">
                  {inv.khhdon}-{inv.shdon}
                </td>
                <td className="p-2">{inv.nbmst}</td>
                <td className="p-2">{inv.nbten}</td>
                <td className="p-2 text-right">
                  {inv.tgtttbso.toLocaleString("vi-VN")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <button
          className="rounded-md border px-3 py-1 disabled:opacity-40"
          disabled={page <= 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          ← Trước
        </button>
        <span className="text-muted-foreground">
          Trang {Math.min(page + 1, pageCount)}/{pageCount}
        </span>
        <button
          className="rounded-md border px-3 py-1 disabled:opacity-40"
          disabled={page >= pageCount - 1}
          onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
        >
          Sau →
        </button>
      </div>
    </div>
  );
}
