import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { DownloadIcon, EllipsisIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import {
  ColumnDef,
  OnChangeFn,
  PaginationState,
  RowSelectionState,
} from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { api, pickFolder, type Invoice, type Paged } from "@/lib/api";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DateRangePicker,
  defaultOneMonthRange,
} from "@/components/date-range-picker";
import type { DateRange } from "react-day-picker";
import { format } from "date-fns";

const PAGE_SIZES = [10, 20, 30, 40, 50];

// Điều kiện lọc + phân trang nằm trên URL → giữ nguyên khi xem chi tiết rồi Back.
type PurchaseSearch = {
  nbmst?: string;
  khhdon?: string;
  shdon?: number;
  khmshdon?: number;
  tthai?: number; // bỏ = "Tất cả"
  ttxly?: number; // bỏ = mặc định (áp ở searchToApplied)
  from?: string; // yyyy-MM-dd
  to?: string; // yyyy-MM-dd
  page: number; // 1-based cho URL
  size: number;
};

export const Route = createFileRoute("/_protected/lookups/invoice/purchase")({
  // Module hoá đơn tắt (chưa đăng nhập GDT) → chặn, đẩy sang Cài đặt tính năng.
  beforeLoad: async () => {
    let ok = false;
    try {
      ok = await api.getFeatureInvoice();
    } catch {
      /* lỗi lệnh -> coi như chưa bật */
    }
    if (!ok) throw redirect({ to: "/settings/features" });
  },
  validateSearch: (s: Record<string, unknown>): PurchaseSearch => {
    const size = PAGE_SIZES.includes(Number(s.size)) ? Number(s.size) : 10;
    const page = Number(s.page) >= 1 ? Math.floor(Number(s.page)) : 1;
    const str = (v: unknown) =>
      typeof v === "string" && v.trim() ? v.trim() : undefined;
    const num = (v: unknown) => {
      const n = Number(v);
      return String(v ?? "").trim() !== "" && Number.isFinite(n)
        ? n
        : undefined;
    };
    const isYmd = (v: unknown) =>
      typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const tthai = tthais.some((o) => o.value === Number(s.tthai))
      ? Number(s.tthai)
      : undefined;
    const ttxly = ttxlys.some((o) => o.value === Number(s.ttxly))
      ? Number(s.ttxly)
      : undefined;
    return {
      nbmst: str(s.nbmst),
      khhdon: str(s.khhdon),
      shdon: num(s.shdon),
      khmshdon: num(s.khmshdon),
      tthai,
      ttxly,
      from: isYmd(s.from) ? (s.from as string) : undefined,
      to: isYmd(s.to) ? (s.to as string) : undefined,
      page,
      size,
    };
  },
  component: RouteComponent,
});

export const columns: ColumnDef<Invoice>[] = [
  {
    id: "select",
    size: 35,
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
    accessorKey: "khmshdon",
    minSize: 120,
    header: () => <div className="text-center">Ký hiệu mẫu số</div>,
    cell: ({ row }) => {
      return <div className="text-center">{row.getValue("khmshdon")}</div>;
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
    size: 100,
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
          if (res.errors.length) toast.error(`Lỗi: ${res.errors[0].reason}`);
        } catch (e) {
          toast.error(String(e));
        }
      };
      return (
        <div className="text-center">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon">
                  <EllipsisIcon />
                </Button>
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

// Bộ lọc đã áp dụng (khớp InvoiceFilter phía Rust; bỏ field rỗng).
type AppliedFilter = {
  nbmst?: string;
  khhdon?: string;
  shdon?: number;
  khmshdon?: number;
  tthai?: number;
  ttxly?: number;
  from?: string;
  to?: string;
};

const tthais = [
  { label: "Tất cả", value: null },
  { label: "Hoá đơn mới", value: 1 },
  { label: "Hoá đơn thay thế", value: 2 },
  { label: "Hoá đơn điều chỉnh", value: 3 },
  { label: "Hoá đơn đã bị thay thế", value: 4 },
  { label: "Hoá đơn đã bị điều chỉnh", value: 5 },
  { label: "Hoá đơn đã bị huỷ", value: 6 },
];

const ttxlys = [
  { label: "Đã cấp mã hoá đơn", value: 5 },
  { label: "Cục thuế đã nhận không mã", value: 6 },
  {
    label: "Cục Thuế đã nhận hóa đơn có mã khởi tạo từ máy tính tiền",
    value: 8,
  },
];

// Ký hiệu mẫu số hoá đơn (Thông tư 78): 1..6. "Tất cả" = không lọc.
const khmshdons = [
  { label: "Tất cả", value: null },
  { label: "(1) Hóa đơn điện tử giá trị gia tăng", value: 1 },
  { label: "(2) Hóa đơn điện tử bán hàng", value: 2 },
  { label: "(3) Hóa đơn điện tử bán tài sản công", value: 3 },
  { label: "(4) Hóa đơn điện tử bán hàng dự trữ quốc gia", value: 4 },
  { label: "(5) Hóa đơn điện tử khác", value: 5 },
  { label: "(6) Chứng từ điện tử", value: 6 },
  { label: "(7) Hóa đơn thương mại điện tử", value: 7 },
  {
    label:
      "(8) Hóa đơn giá trị gia tăng tích hợp biên lai thu thuế, phí, lệ phí",
    value: 8,
  },
  {
    label: "(9) Hóa đơn bán hàng tích hợp biên lai thu thuế, phí, lệ phí",
    value: 9,
  },
];

// Ngày (giờ VN) -> ISO biên đầu/cuối ngày để so với ntao (UTC ISO).
function dayBoundIso(d: Date, end: boolean): string {
  const t = end ? "23:59:59.999" : "00:00:00";
  return new Date(`${format(d, "yyyy-MM-dd")}T${t}+07:00`).toISOString();
}

// base-ui Select dùng value chuỗi; null ("Tất cả") -> "all".
const keyOf = (v: number | null) => (v === null ? "all" : String(v));
const DEFAULT_TTHAI_KEY = keyOf(tthais[0].value);
const DEFAULT_TTXLY_KEY = keyOf(ttxlys[0].value);
const DEFAULT_KHMSHDON_KEY = keyOf(khmshdons[0].value);

type FilterInputs = {
  nbmst: string;
  khhdon: string;
  shdon: string;
};

// yyyy-MM-dd -> Date (đầu ngày, giờ máy) để hiển thị trên DateRangePicker.
function parseYmd(s?: string): Date | undefined {
  return s ? new Date(`${s}T00:00:00`) : undefined;
}

// Khoảng ngày từ URL; nếu trống hoàn toàn -> khoảng mặc định (today lùi ~1 tháng).
function searchToRange(s: PurchaseSearch): DateRange {
  const from = parseYmd(s.from);
  const to = parseYmd(s.to);
  return from || to ? { from, to } : defaultOneMonthRange();
}

// AppliedFilter thật sự cho query, suy từ URL (ttxly mặc định = phần tử đầu).
function searchToApplied(s: PurchaseSearch): AppliedFilter {
  const range = searchToRange(s);
  return {
    nbmst: s.nbmst,
    khhdon: s.khhdon,
    shdon: s.shdon,
    khmshdon: s.khmshdon,
    tthai: s.tthai,
    ttxly: s.ttxly ?? (ttxlys[0].value as number),
    from: range.from ? dayBoundIso(range.from, false) : undefined,
    to: range.to
      ? dayBoundIso(range.to, true)
      : range.from
        ? dayBoundIso(range.from, true)
        : undefined,
  };
}

function RouteComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  // Phân trang + filter đã áp dụng suy từ URL (giữ khi Back/refresh).
  const pagination: PaginationState = {
    pageIndex: search.page - 1,
    pageSize: search.size,
  };
  const applied = useMemo(() => searchToApplied(search), [search]);

  // Chọn dòng theo id (giữ được qua các trang nhờ getRowId = id).
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [downloading, setDownloading] = useState(false);

  // Ô nhập/chọn filter chưa áp dụng (cục bộ) — init từ URL để khôi phục khi Back.
  const [filterInputs, setFilterInputs] = useState<FilterInputs>(() => ({
    nbmst: search.nbmst ?? "",
    khhdon: search.khhdon ?? "",
    shdon: search.shdon != null ? String(search.shdon) : "",
  }));
  // 3 filter bắt buộc luôn có giá trị: khoảng ngày + 2 select trạng thái (mặc định phần tử đầu).
  const [range, setRange] = useState<DateRange>(() => searchToRange(search));
  const [tthaiKey, setTthaiKey] = useState<string>(
    search.tthai != null ? String(search.tthai) : DEFAULT_TTHAI_KEY,
  );
  const [ttxlyKey, setTtxlyKey] = useState<string>(
    search.ttxly != null ? String(search.ttxly) : DEFAULT_TTXLY_KEY,
  );
  // Ký hiệu mẫu số (tùy chọn) — Select có "Tất cả"; init từ URL để khôi phục khi Back.
  const [khmshdonKey, setKhmshdonKey] = useState<string>(
    search.khmshdon != null ? String(search.khmshdon) : DEFAULT_KHMSHDON_KEY,
  );

  const invoices = useQuery({
    queryKey: ["invoices", search.page, search.size, applied],
    // Phân trang phía server: chỉ tải đúng 1 trang + tổng số.
    queryFn: async () =>
      invoke<Paged<Invoice>>("list_invoices", {
        filter: {
          limit: search.size,
          offset: (search.page - 1) * search.size,
          ...applied,
        },
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 3000,
  });

  const total = invoices.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pagination.pageSize));

  const selectedIds = Object.keys(rowSelection).filter((k) => rowSelection[k]);

  // Áp dụng filter: ghi điều kiện lên URL (về trang 1). applied/query tự cập nhật theo search.
  const applyFilter = () => {
    const shdon = filterInputs.shdon.trim()
      ? Number(filterInputs.shdon.trim())
      : undefined;
    navigate({
      search: (p) => ({
        ...p,
        nbmst: filterInputs.nbmst.trim() || undefined,
        khhdon: filterInputs.khhdon.trim() || undefined,
        shdon: Number.isFinite(shdon) ? shdon : undefined,
        khmshdon: khmshdonKey === "all" ? undefined : Number(khmshdonKey),
        tthai: tthaiKey === "all" ? undefined : Number(tthaiKey),
        ttxly: ttxlyKey ? Number(ttxlyKey) : undefined,
        from: range.from ? format(range.from, "yyyy-MM-dd") : undefined,
        to: range.to ? format(range.to, "yyyy-MM-dd") : undefined,
        page: 1,
      }),
    });
  };

  // Xoá lọc: về mặc định (xoá param lọc; 3 filter bắt buộc vẫn có giá trị mặc định).
  const clearFilter = () => {
    setFilterInputs({ nbmst: "", khhdon: "", shdon: "" });
    setRange(defaultOneMonthRange());
    setTthaiKey(DEFAULT_TTHAI_KEY);
    setTtxlyKey(DEFAULT_TTXLY_KEY);
    setKhmshdonKey(DEFAULT_KHMSHDON_KEY);
    navigate({ search: { page: 1, size: search.size } });
  };

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
        toast.error(
          `${res.errors.length} hoá đơn lỗi: ${res.errors[0].reason}`,
        );
      setRowSelection({});
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDownloading(false);
    }
  };

  // Đổi số dòng/trang -> ghi lên URL (đổi size thì về trang 1).
  const onPaginationChange: OnChangeFn<PaginationState> = (updater) => {
    const next = typeof updater === "function" ? updater(pagination) : updater;
    const sizeChanged = next.pageSize !== pagination.pageSize;
    navigate({
      search: (p) => ({
        ...p,
        size: next.pageSize,
        page: sizeChanged ? 1 : next.pageIndex + 1,
      }),
    });
  };

  // Kẹp trang khi tổng co lại (vd sau prune) để không hiện trang trống.
  useEffect(() => {
    if (search.page > pageCount) {
      navigate({ replace: true, search: (p) => ({ ...p, page: pageCount }) });
    }
  }, [pageCount, search.page, navigate]);

  return (
    <div className="container @container mx-auto py-10">
      <div className="flex flex-1 flex-col gap-4 p-4">
        {invoices.isError && (
          <div className="rounded-xl border border-red-500 bg-red-500/10 p-3 text-sm text-red-500">
            Lỗi tải danh sách hoá đơn: {String(invoices.error)}
          </div>
        )}

        {/* Thanh lọc: MST bên bán, ký hiệu HĐ, số HĐ, ký hiệu mẫu số, khoảng ngày lập. */}
        <div className="grid @3xl:grid-cols-6 gap-2">
          <div className="flex flex-col gap-1 @3xl:col-span-2">
            <label className="text-xs text-muted-foreground after:ml-0.5 after:text-red-500 after:content-['*']">
              Thời gian lập
            </label>
            <DateRangePicker
              value={range}
              onChange={(r) => {
                if (r?.from) setRange(r);
              }}
            />
          </div>
          <div className="flex flex-col gap-1 @3xl:col-span-2">
            <label className="text-xs text-muted-foreground after:ml-0.5 after:text-red-500 after:content-['*']">
              Trạng thái HĐ
            </label>
            <Select value={tthaiKey} onValueChange={(v) => v && setTthaiKey(v)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v) => tthais.find((o) => keyOf(o.value) === v)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel> Trạng thái HĐ</SelectLabel>
                  {tthais.map((o) => (
                    <SelectItem key={keyOf(o.value)} value={keyOf(o.value)}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 @3xl:col-span-2">
            <label className="text-xs text-muted-foreground after:ml-0.5 after:text-red-500 after:content-['*']">
              Trạng thái xử lý
            </label>
            <Select value={ttxlyKey} onValueChange={(v) => v && setTtxlyKey(v)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v) => ttxlys.find((o) => keyOf(o.value) === v)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Trạng thái xử lý</SelectLabel>
                  {ttxlys.map((o) => (
                    <SelectItem key={keyOf(o.value)} value={keyOf(o.value)}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 @3xl:col-span-3">
            <label className="text-xs text-muted-foreground">MST bên bán</label>
            <Input
              value={filterInputs.nbmst}
              onChange={(e) =>
                setFilterInputs((s) => ({ ...s, nbmst: e.target.value }))
              }
              placeholder="MST bên bán"
            />
          </div>
          <div className="flex flex-col gap-1 @3xl:col-span-3">
            <label className="text-xs text-muted-foreground">
              Ký hiệu mẫu số
            </label>
            <Select
              value={khmshdonKey}
              onValueChange={(v) => v && setKhmshdonKey(v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v) => khmshdons.find((o) => keyOf(o.value) === v)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Ký hiệu mẫu số</SelectLabel>
                  {khmshdons.map((o) => (
                    <SelectItem key={keyOf(o.value)} value={keyOf(o.value)}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 @3xl:col-span-3">
            <label className="text-xs text-muted-foreground">Số HĐ</label>
            <Input
              value={filterInputs.shdon}
              onChange={(e) =>
                setFilterInputs((s) => ({ ...s, shdon: e.target.value }))
              }
              inputMode="numeric"
              placeholder="Số HĐ"
            />
          </div>
          <div className="flex flex-col gap-1 @3xl:col-span-3">
            <label className="text-xs text-muted-foreground">Ký hiệu HĐ</label>
            <Input
              value={filterInputs.khhdon}
              onChange={(e) =>
                setFilterInputs((s) => ({ ...s, khhdon: e.target.value }))
              }
              placeholder="VD: C26TAA"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-sm">Có {total} kết quả</p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={applyFilter}>
              Lọc
            </Button>
            <Button variant="ghost" onClick={clearFilter}>
              Xoá lọc
            </Button>
            <Button
              variant="secondary"
              disabled={!selectedIds.length || downloading}
              onClick={downloadSelected}
            >
              {downloading && <Spinner />}
              <DownloadIcon />
              Tải xuống ({selectedIds.length})
            </Button>
          </div>
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
          columnPinning={{ left: ["select", "nguoiBan"], right: ["actions"] }}
        />
      </div>
    </div>
  );
}
