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
import { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { DownloadIcon, EllipsisIcon, FileIcon } from "lucide-react";
import { toast } from "sonner";
import RawMaterialDialog from "@/components/raw_material_dialog";
import CoaDialog from "@/components/coa_dialog";
import CoaBulkDialog from "@/components/coa_bulk_dialog";
import CoaViewerSheet from "@/components/coa_viewer_sheet";
import { api, type Coa } from "@/lib/api";
import { formatVnDate } from "@/lib/date";

export const Route = createFileRoute("/_protected/coas_/$id")({
  beforeLoad: async ({ params }) => {
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
    },
    {
      id: "lot_no",
      header: () => <div>Số lô</div>,
      cell: ({ row }) => (
        <p className="line-clamp-2 text-wrap">{row.original.lot_no}</p>
      ),
    },
    {
      id: "manufacture_date",
      header: () => <div>Ngày sản xuất</div>,
      cell: ({ row }) => (
        <p className="line-clamp-2 text-wrap">
          {formatVnDate(row.original.manufacture_date)}
        </p>
      ),
    },
    {
      id: "expiration_date",
      header: () => <div>Hạn sử dụng</div>,
      cell: ({ row }) => (
        <p className="line-clamp-2 text-wrap">
          {formatVnDate(row.original.expiration_date)}
        </p>
      ),
    },
    {
      id: "file",
      header: () => <div>File</div>,
      cell: ({ row }) =>
        row.original.path ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onView(row.original)}
          >
            <FileIcon />
            Xem
          </Button>
        ) : (
          <span className="text-muted-foreground">-</span>
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
                  Mở file
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
    try {
      await api.downloadCoas(selectedIds, data.code);
      toast.success(
        selectedIds.length === 1
          ? "Đã tải COA về Downloads"
          : `Đã tải ${selectedIds.length} COA (.zip) về Downloads`,
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
              <CoaDialog rawMaterialId={data.id} />
            </div>
          </div>
          <FieldDescription>Danh sách COA của nguyên liệu</FieldDescription>
          <DataTable
            columns={columns}
            data={coas.data ?? []}
            enableClientPagination
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
