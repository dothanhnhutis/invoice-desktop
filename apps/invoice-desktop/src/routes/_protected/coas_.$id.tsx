import React from "react";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Column, ColumnDef, RowSelectionState } from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  DownloadIcon,
  EllipsisIcon,
  SearchIcon,
} from "lucide-react";
import { toast } from "sonner";
import RawMaterialDialog from "@/components/raw_material_dialog";
import CoaBulkDialog from "@/components/coa_bulk_dialog";
import CoaViewerSheet from "@/components/coa_viewer_sheet";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { useDebounce } from "@/hooks/use-debounce";
import { api, pickFolder, type Coa } from "@/lib/api";
import { formatVnDate, vnDateSortKey } from "@/lib/date";

export const Route = createFileRoute("/_protected/coas_/$id")({
  beforeLoad: async ({ params }) => {
    // Module tắt → chặn truy cập trực tiếp, đẩy sang trang Cài đặt tính năng.
    let enabled = true;
    try {
      enabled = await api.getFeatureRawMaterials();
    } catch {
      /* lỗi lệnh -> cho vào */
    }
    if (!enabled) throw redirect({ to: "/settings/features" });
    const id = Number(params.id);
    if (!Number.isInteger(id))
      throw redirect({ to: "/coas", search: { page: 1, size: 10 } });
    try {
      const raw_material = await api.getRawMaterialById(id);
      return { raw_material };
    } catch {
      throw redirect({ to: "/coas", search: { page: 1, size: 10 } });
    }
  },
  loader: ({ context: { raw_material } }) => raw_material,
  component: RouteComponent,
});

/**
 * Header bấm được để sắp xếp. `getToggleSortingHandler` tự hiểu phím Shift → giữ Shift bấm cột
 * thứ hai là xếp chồng; khi đó hiện thêm số thứ tự ưu tiên của cột.
 */
function SortHeader({
  column,
  children,
}: {
  column: Column<Coa, unknown>;
  children: React.ReactNode;
}) {
  const sorted = column.getIsSorted();
  const order = column.getSortIndex();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-2 h-8"
      onClick={column.getToggleSortingHandler()}
    >
      {children}
      {sorted === "asc" ? (
        <ArrowUpIcon />
      ) : sorted === "desc" ? (
        <ArrowDownIcon />
      ) : (
        <ArrowUpDownIcon className="text-muted-foreground" />
      )}
      {order > 0 && (
        <span className="text-xs text-muted-foreground">{order + 1}</span>
      )}
    </Button>
  );
}

function makeCoaColumns(
  onView: (coa: Coa) => void,
  onDelete: (id: number) => void,
): ColumnDef<Coa>[] {
  return [
    {
      id: "select",
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
      enableSorting: false,
    },
    {
      id: "lot_no",
      // sortingFn mặc định là "alphanumeric" -> LOT2 đứng trước LOT10.
      accessorFn: (c) => c.lot_no,
      header: ({ column }) => <SortHeader column={column}>Số lô</SortHeader>,
      // Có file -> số lô là liên kết mở luôn file (thay cho cột "File" cũ).
      cell: ({ row }) =>
        row.original.path ? (
          <button
            type="button"
            title={row.original.path}
            className="line-clamp-2 text-wrap text-left text-primary underline-offset-2 hover:underline"
            onClick={() => onView(row.original)}
          >
            {row.original.lot_no}
          </button>
        ) : (
          <p className="line-clamp-2 text-wrap">{row.original.lot_no}</p>
        ),
    },
    {
      id: "manufacture_date",
      // Ngày lưu là TEXT tự do -> phải quy về số mới sắp xếp đúng thời gian.
      accessorFn: (c) => vnDateSortKey(c.manufacture_date),
      sortUndefined: "last", // COA thiếu ngày luôn nằm cuối
      header: ({ column }) => (
        <SortHeader column={column}>Ngày sản xuất</SortHeader>
      ),
      cell: ({ row }) => (
        <p className="line-clamp-2 text-wrap">
          {formatVnDate(row.original.manufacture_date)}
        </p>
      ),
    },
    {
      id: "expiration_date",
      accessorFn: (c) => vnDateSortKey(c.expiration_date),
      sortUndefined: "last",
      header: ({ column }) => (
        <SortHeader column={column}>Hạn sử dụng</SortHeader>
      ),
      cell: ({ row }) => (
        <p className="line-clamp-2 text-wrap">
          {formatVnDate(row.original.expiration_date)}
        </p>
      ),
    },
    {
      id: "action",
      header: () => <div></div>,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost">
                <EllipsisIcon />
              </Button>
            }
          />
          <DropdownMenuContent className="w-40" align="start">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Hành động</DropdownMenuLabel>
              {row.original.path && (
                <DropdownMenuItem onClick={() => onView(row.original)}>
                  Xem file
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onDelete(row.original.id)}
              >
                Xoá
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
      enableSorting: false,
    },
  ];
}

function RouteComponent() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const queryClient = useQueryClient();

  const coas = useQuery({
    queryKey: ["coas", data.id],
    queryFn: () => api.listCoas(data.id),
  });

  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [viewing, setViewing] = React.useState<Coa | null>(null);

  // Lọc theo số lô ở client (đã tải hết COA của nguyên liệu). Ô tìm hiện chữ ngay, chỉ kết quả
  // lọc mới đợi ngừng gõ 500ms. Lọc KHÔNG bỏ tick: chọn vài lô, đổi từ khoá, chọn tiếp rồi tải cả.
  const [qInput, setQInput] = React.useState("");
  const q = useDebounce(qInput, 500);
  const rows = React.useMemo(() => {
    const all = coas.data ?? [];
    const k = q.trim().toLowerCase();
    return k ? all.filter((c) => c.lot_no.toLowerCase().includes(k)) : all;
  }, [coas.data, q]);

  const deleteCoa = async (id: number) => {
    try {
      await api.deleteCoa(id);
      queryClient.invalidateQueries({ queryKey: ["coas", data.id] });
      toast.success("Đã xoá COA");
    } catch (e) {
      toast.error(String(e));
    }
  };

  const selectedIds = Object.keys(rowSelection)
    .filter((k) => rowSelection[k])
    .map(Number);

  const downloadSelected = async () => {
    if (!selectedIds.length) return;
    const dir = await pickFolder();
    if (!dir) return;
    try {
      const path = await api.downloadCoas(selectedIds, data.code, dir);
      toast.success(
        selectedIds.length === 1
          ? `Đã tải COA → ${path}`
          : `Đã tải ${selectedIds.length} COA (.zip) → ${path}`,
      );
      setRowSelection({});
    } catch (e) {
      toast.error(String(e));
    }
  };

  const columns = React.useMemo(
    () => makeCoaColumns(setViewing, deleteCoa),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.id],
  );

  return (
    <div className="container mx-auto p-4">
      <FieldGroup>
        <FieldSet>
          <div className="flex gap-4 items-center justify-between">
            <FieldLegend>Thông tin nguyên liệu</FieldLegend>
            <RawMaterialDialog
              data={data}
              onSaved={() =>
                router.invalidate({ filter: (m) => m.routeId === Route.id })
              }
            />
          </div>
          <FieldGroup>
            <div className="grid md:grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="code">Mã nguyên liệu</FieldLabel>
                <FieldDescription>{data.code}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="name">Tên nguyên liệu</FieldLabel>
                <FieldDescription>{data.name}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="producer">Tên nhà sản xuất</FieldLabel>
                <FieldDescription>{data.producer}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="country_of_origin">Quốc gia</FieldLabel>
                <FieldDescription>{data.country_of_origin}</FieldDescription>
              </Field>
            </div>
          </FieldGroup>
        </FieldSet>
        <FieldSeparator />
        <FieldSet>
          <div className="flex gap-4 items-center justify-between">
            <FieldLegend>Certificate of Analysis (COA)</FieldLegend>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                disabled={selectedIds.length === 0}
                onClick={downloadSelected}
              >
                <DownloadIcon />
                <span className="hidden sm:inline">
                  Tải về{selectedIds.length ? ` (${selectedIds.length})` : ""}
                </span>
              </Button>
              <CoaBulkDialog rawMaterialId={data.id} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <InputGroup className="max-w-xs">
              <InputGroupInput
                placeholder="Tìm theo số lô..."
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <SearchIcon />
              </InputGroupAddon>
            </InputGroup>
          </div>
          <DataTable
            columns={columns}
            data={rows}
            enableClientPagination
            enableSorting
            enableRowSelection
            rowSelection={rowSelection}
            onRowSelectionChange={setRowSelection}
            getRowId={(c) => String(c.id)}
          />
        </FieldSet>
      </FieldGroup>

      <CoaViewerSheet
        coa={viewing}
        onOpenChange={(o) => !o && setViewing(null)}
      />
    </div>
  );
}
