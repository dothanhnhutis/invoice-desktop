import {
  Column,
  ColumnDef,
  ColumnPinningState,
  OnChangeFn,
  PaginationState,
  RowSelectionState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { cn } from "@/lib/utils";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  type?: "fixed" | "default" | undefined;
  /** Bật phân trang phía server: truyền cả 3 prop dưới đây. */
  pagination?: PaginationState;
  onPaginationChange?: OnChangeFn<PaginationState>;
  pageCount?: number;
  /** Bật phân trang phía client (table tự quản lý, dùng khi đã tải hết dữ liệu). */
  enableClientPagination?: boolean;
  /** Bật sắp xếp phía client. Cột phải có accessor; header tự lo nút bấm (xem SortHeader). */
  enableSorting?: boolean;
  /** Bật chọn dòng (checkbox). Truyền kèm rowSelection/onRowSelectionChange/getRowId. */
  enableRowSelection?: boolean;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  getRowId?: (row: TData, index: number) => string;
  /** Ghim cột khi cuộn ngang: { left: [id...], right: [id...] }. Cần type="fixed". */
  columnPinning?: ColumnPinningState;
}

/** Style + class sticky cho 1 cột đã ghim (trái/phải). */
function pinStyle<TData>(column: Column<TData>): React.CSSProperties {
  const pin = column.getIsPinned();
  if (!pin) return {};
  return {
    position: "sticky",
    left: pin === "left" ? column.getStart("left") : undefined,
    right: pin === "right" ? column.getAfter("right") : undefined,
    zIndex: 1,
  };
}

/** Class nền + đường viền ranh cho cột ghim (giữ highlight khi chọn dòng). */
function pinClass<TData>(column: Column<TData>): string {
  const pin = column.getIsPinned();
  if (!pin) return "";
  return cn(
    "bg-background group-data-[state=selected]:bg-muted",
    pin === "left" && column.getIsLastColumn("left") && "border-r",
    pin === "right" && column.getIsFirstColumn("right") && "border-l",
  );
}

const PAGE_SIZES = [10, 20, 30, 40, 50];

export function DataTable<TData, TValue>({
  columns,
  data,
  type = "default",
  pagination,
  onPaginationChange,
  pageCount,
  enableClientPagination = false,
  enableSorting = false,
  enableRowSelection = false,
  rowSelection,
  onRowSelectionChange,
  getRowId,
  columnPinning,
}: DataTableProps<TData, TValue>) {
  const manualPagination = pageCount !== undefined;
  const showPagination = manualPagination || enableClientPagination;

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    enableColumnPinning: true,
    initialState: {
      ...(enableClientPagination
        ? { pagination: { pageIndex: 0, pageSize: 10 } }
        : {}),
      ...(columnPinning ? { columnPinning } : {}),
    },
    ...(enableClientPagination
      ? { getPaginationRowModel: getPaginationRowModel() }
      : {}),
    // Không truyền onSortingChange -> TanStack tự giữ state sắp xếp (Shift+bấm = xếp chồng cột).
    ...(enableSorting ? { getSortedRowModel: getSortedRowModel() } : {}),
    ...(manualPagination
      ? { manualPagination: true, pageCount, onPaginationChange }
      : {}),
    ...(enableRowSelection
      ? { enableRowSelection: true, getRowId, onRowSelectionChange }
      : {}),
    state: {
      ...(manualPagination && pagination ? { pagination } : {}),
      ...(enableRowSelection && rowSelection ? { rowSelection } : {}),
    },
  });

  return (
    <div className="space-y-4 ">
      <div className="rounded-md border ">
        {/* Bề rộng bảng = tổng size cột; tràn khung -> container overflow-x-auto (ui/table) tự cuộn ngang. */}
        {/* overflow-y-hidden cho container: chặn thanh cuộn dọc thừa do overflow-x-auto ép overflow-y=auto. */}
        <Table
          style={
            type == "fixed"
              ? { width: table.getTotalSize(), tableLayout: "fixed" }
              : {}
          }
        >
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead
                      key={header.id}
                      className={pinClass(header.column)}
                      style={{
                        ...(type == "fixed" ? { width: header.getSize() } : {}),
                        ...pinStyle(header.column),
                      }}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="group"
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn("truncate", pinClass(cell.column))}
                      style={{
                        ...(type == "fixed"
                          ? { width: cell.column.getSize() }
                          : {}),
                        ...pinStyle(cell.column),
                      }}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {showPagination && (
        <div className="flex items-center justify-end gap-8">
          <div className="flex items-center gap-2">
            <Label htmlFor="rows-per-page" className="text-sm font-medium">
              Số dòng/trang
            </Label>
            <Select
              value={`${table.getState().pagination.pageSize}`}
              onValueChange={(value) => table.setPageSize(Number(value))}
            >
              <SelectTrigger size="sm" className="w-20" id="rows-per-page">
                <SelectValue
                  placeholder={table.getState().pagination.pageSize}
                />
              </SelectTrigger>
              <SelectContent side="top">
                {PAGE_SIZES.map((size) => (
                  <SelectItem key={size} value={`${size}`}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex w-fit items-center justify-center text-sm font-medium">
            Trang {table.getState().pagination.pageIndex + 1} /{" "}
            {table.getPageCount() || 1}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="hidden size-8 lg:flex"
              size="icon"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">Về trang đầu</span>
              <ChevronsLeft />
            </Button>
            <Button
              variant="outline"
              className="size-8"
              size="icon"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">Trang trước</span>
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              className="size-8"
              size="icon"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <span className="sr-only">Trang sau</span>
              <ChevronRight />
            </Button>
            <Button
              variant="outline"
              className="hidden size-8 lg:flex"
              size="icon"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
            >
              <span className="sr-only">Tới trang cuối</span>
              <ChevronsRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
