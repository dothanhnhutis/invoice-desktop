import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useSync } from "@/contexts/sync-context";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { CalendarSyncIcon, DownloadIcon, EllipsisIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@base-ui/react";
import { Button as UiButton } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import * as z from "zod";
import { useForm } from "@tanstack/react-form";
import { Spinner } from "@/components/ui/spinner";
import {
  ColumnDef,
  OnChangeFn,
  PaginationState,
  RowSelectionState,
} from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { vnDateToIso } from "@/lib/date";
import { api, pickFolder, type Invoice, type Paged } from "@/lib/api";

export const Route = createFileRoute("/_protected/lookups/invoice/purchase")({
  component: RouteComponent,
});

export const columns: ColumnDef<Invoice>[] = [
  {
    id: "select",
    minSize: 40,
    header: ({ table }) => (
      <input
        type="checkbox"
        className="size-4 align-middle"
        aria-label="Chọn tất cả"
        checked={table.getIsAllPageRowsSelected()}
        onChange={table.getToggleAllPageRowsSelectedHandler()}
      />
    ),
    cell: ({ row }) => (
      <input
        type="checkbox"
        className="size-4 align-middle"
        aria-label="Chọn dòng"
        checked={row.getIsSelected()}
        onChange={row.getToggleSelectedHandler()}
      />
    ),
  },
  {
    id: "nguoiBan",
    minSize: 400,
    header: () => <div>Thông tin người bán</div>,
    cell: ({ row }) => {
      return (
        <div>
          <p className="font-bold line-clamp-2 text-wrap">
            {row.original.nbten}
          </p>
          <p className="font-normal text-xs">MST: {row.original.nbmst}</p>
        </div>
      );
    },
  },
  {
    accessorKey: "ntao",
    minSize: 180,
    header: () => <div className="text-center">Ngày lập</div>,
    cell: ({ row }) => {
      const date = new Date(row.getValue("ntao")).toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
      });
      return <div className="text-center">{date}</div>;
    },
  },
  {
    accessorKey: "khhdon",
    minSize: 150,

    header: () => <div className="text-center">Ký hiệu HĐ</div>,
    cell: ({ row }) => {
      return <div className="text-center">{row.getValue("khhdon")}</div>;
    },
  },
  {
    accessorKey: "shdon",
    minSize: 120,
    header: () => <div className="text-center">Số HĐ</div>,
    cell: ({ row }) => {
      return <div className="text-center">{row.getValue("shdon")}</div>;
    },
  },
  {
    accessorKey: "tgtcthue",
    minSize: 160,
    header: () => <div className="text-center">Tổng tiền chưa thuế</div>,
    cell: ({ row }) => {
      return (
        <div className="text-center">
          {row.getValue<number>("tgtcthue").toLocaleString("vi-VN")}
        </div>
      );
    },
  },
  {
    accessorKey: "tgtthue",
    minSize: 160,
    header: () => <div className="text-center">Tổng tiền thuế</div>,
    cell: ({ row }) => {
      return (
        <div className="text-center">
          {row.getValue<number>("tgtthue").toLocaleString("vi-VN")}
        </div>
      );
    },
  },
  {
    accessorKey: "ttcktmai",
    minSize: 160,
    header: () => (
      <div className="text-center text-wrap">
        Tổng tiền chiết khấu thương mại
      </div>
    ),
    cell: ({ row }) => {
      return (
        <div className="text-center">
          {row.getValue<number>("ttcktmai").toLocaleString("vi-VN")}
        </div>
      );
    },
  },
  {
    accessorKey: "tgtttbso",
    minSize: 160,
    header: () => <div className="text-center">Tổng tiền thanh toán</div>,
    cell: ({ row }) => {
      return (
        <div className="text-center">
          {row.getValue<number>("tgtttbso").toLocaleString("vi-VN")}
        </div>
      );
    },
  },
  {
    accessorKey: "dvtte",
    minSize: 160,
    header: () => <div className="text-center text-wrap">Đơn vị tiền tệ</div>,
    cell: ({ row }) => {
      return <div className="text-center">{row.getValue<string>("dvtte")}</div>;
    },
  },
  {
    accessorKey: "tthai",
    minSize: 160,
    header: () => (
      <div className="text-center text-wrap">Trạng thái hóa đơn</div>
    ),
    cell: ({ row }) => {
      const tthai = row.getValue<number>("tthai");

      return (
        <div className="text-center">
          {tthai == 0 ? (
            <p>Chưa được xử lý</p>
          ) : tthai == 1 ? (
            <p>Đã được xử lý</p>
          ) : tthai == 2 ? (
            <p>Chưa được xử lý nhưng quá hạn</p>
          ) : (
            ""
          )}
        </div>
      );
    },
  },
  {
    id: "actions",
    minSize: 190,
    header: () => <div className="text-center">Hành động</div>,
    cell: ({ row }) => {
      const r = row.original;
      // Chỉ copy giá trị, tách nhau bằng TAB -> dán vào Google Sheet rơi đúng 4 ô.
      const copyText = `${r.nbmst}\t${r.khhdon}\t${r.shdon}\t${r.khmshdon}`;
      const onCopy = async () => {
        try {
          await navigator.clipboard.writeText(copyText);
          toast.success("Đã copy khóa hoá đơn");
        } catch {
          toast.error("Copy thất bại");
        }
      };
      const onDownload = async () => {
        const dir = await pickFolder();
        if (!dir) return;
        try {
          const res = await api.downloadInvoices([r.id], dir);
          if (res.downloaded > 0) toast.success("Đã tải hoá đơn (XML + PDF)");
          if (res.errors.length)
            toast.error(`Lỗi: ${res.errors[0].reason}`);
        } catch (e) {
          toast.error(String(e));
        }
      };
      return (
        <div className="text-center">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <UiButton variant="ghost" size="icon">
                  <EllipsisIcon />
                </UiButton>
              }
            />
            <DropdownMenuContent className="w-44" align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Hành động</DropdownMenuLabel>
                <DropdownMenuItem
                  render={
                    <Link
                      to="/lookups/invoice/purchase/$id"
                      params={{ id: r.id }}
                    />
                  }
                >
                  Xem chi tiết
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onCopy}>Copy</DropdownMenuItem>
                <DropdownMenuItem onClick={onDownload}>
                  Tải xuống
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      );
    },
  },
];

type SyncState = {
  oldest_date: string | null;
  newest_date: string | null;
  backfill_done: boolean;
  last_sync_at: number | null;
};

const formSchema = z.object({
  floor: z
    .string()
    .refine((v) => vnDateToIso(v) !== null, "Ngày dạng dd/mm/yyyy"),
});

function RouteComponent() {
  const { progress, error } = useSync(); // tiến độ/lỗi realtime (listener toàn cục ở __root)
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 50,
  });
  // Chọn dòng theo id (giữ được qua các trang nhờ getRowId = id).
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [downloading, setDownloading] = useState(false);

  const invoices = useQuery({
    queryKey: ["invoices", pagination.pageIndex, pagination.pageSize],
    // Phân trang phía server: chỉ tải đúng 1 trang + tổng số.
    queryFn: async () =>
      invoke<Paged<Invoice>>("list_invoices", {
        filter: {
          limit: pagination.pageSize,
          offset: pagination.pageIndex * pagination.pageSize,
        },
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 3000,
  });

  const sync = useQuery({
    queryKey: ["sync_status"],
    queryFn: async () => invoke<SyncState>("get_sync_status"),
    refetchInterval: 3000,
  });

  const form = useForm({
    defaultValues: {
      floor: "",
    },
    validators: {
      onSubmit: formSchema,
    },
    onSubmit: async ({ value }) => {
      try {
        // FLOOR lưu ISO; form nhập dd/mm/yyyy nên đổi trước khi gửi.
        await invoke("set_floor", { date: vnDateToIso(value.floor)! });
      } catch (e) {
        console.log(e);
      }
    },
  });

  const total = invoices.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pagination.pageSize));

  const selectedIds = Object.keys(rowSelection).filter((k) => rowSelection[k]);

  // Tải hàng loạt: chọn thư mục -> gọi backend -> toast kết quả.
  const downloadSelected = async () => {
    if (!selectedIds.length) return;
    const dir = await pickFolder();
    if (!dir) return;
    setDownloading(true);
    try {
      const res = await api.downloadInvoices(selectedIds, dir);
      if (res.downloaded > 0)
        toast.success(`Đã tải ${res.downloaded} hoá đơn (XML + PDF)`);
      if (res.errors.length)
        toast.error(`${res.errors.length} hoá đơn lỗi: ${res.errors[0].reason}`);
      setRowSelection({});
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDownloading(false);
    }
  };

  // Đổi số dòng/trang -> về trang đầu.
  const onPaginationChange: OnChangeFn<PaginationState> = (updater) => {
    setPagination((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      return next.pageSize !== prev.pageSize ? { ...next, pageIndex: 0 } : next;
    });
  };

  // Kẹp trang khi tổng co lại (vd sau prune) để không hiện trang trống.
  useEffect(() => {
    if (pagination.pageIndex > pageCount - 1) {
      setPagination((p) => ({ ...p, pageIndex: pageCount - 1 }));
    }
  }, [pageCount, pagination.pageIndex]);

  const lastSync = sync.data?.last_sync_at
    ? new Date(sync.data.last_sync_at * 1000).toLocaleString()
    : "chưa";

  return (
    <div className="container mx-auto py-10">
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
            Tổng: <b>{total}</b> hóa đơn · trang{" "}
            <b>{Math.min(pagination.pageIndex + 1, pageCount)}</b>/{pageCount}
          </p>
          {invoices.isError && (
            <p className="text-red-500">
              Lỗi list_invoices: {String(invoices.error)}
            </p>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <InputGroup>
            <form.Field
              name="floor"
              children={(field) => {
                return (
                  <InputGroupInput
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    required
                    placeholder="dd/mm/yyyy"
                  />
                );
              }}
            />
            <InputGroupAddon>
              <CalendarSyncIcon />
            </InputGroupAddon>
            <InputGroupAddon align="inline-end">
              <form.Subscribe
                selector={(state) => [state.canSubmit, state.isSubmitting]}
                children={([canSubmit, isSubmitting]) => (
                  <Button
                    type="submit"
                    disabled={!canSubmit}
                    className="w-full"
                  >
                    {isSubmitting && <Spinner />}
                    Lưu & Đồng bộ
                  </Button>
                )}
              />
            </InputGroupAddon>
          </InputGroup>
        </form>

        <div className="flex items-center justify-end">
          <UiButton
            variant="secondary"
            disabled={!selectedIds.length || downloading}
            onClick={downloadSelected}
          >
            {downloading && <Spinner />}
            <DownloadIcon />
            Tải xuống ({selectedIds.length})
          </UiButton>
        </div>

        <DataTable
          type="fixed"
          columns={columns}
          data={invoices.data?.data ?? []}
          pagination={pagination}
          onPaginationChange={onPaginationChange}
          pageCount={pageCount}
          enableRowSelection
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
          getRowId={(r) => r.id}
        />
      </div>
    </div>
  );
}
