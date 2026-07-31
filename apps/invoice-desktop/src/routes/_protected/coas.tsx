import { DataTable } from "@/components/data-table";
import RawMaterialDialog from "@/components/raw_material_dialog";
import RawMaterialImport from "@/components/raw_material_import";
import RawMaterialExport from "@/components/raw_material_export";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { api, type RawMaterial } from "@/lib/api";
import { useDebounce } from "@/hooks/use-debounce";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ColumnDef, OnChangeFn, PaginationState } from "@tanstack/react-table";
import { EllipsisIcon, Search } from "lucide-react";
import React from "react";

const PAGE_SIZES = [10, 20, 30, 40, 50];

type CoasSearch = { q?: string; page: number; size: number };

export const Route = createFileRoute("/_protected/coas")({
  // Điều kiện tìm/phân trang nằm trên URL → giữ nguyên khi xem chi tiết rồi Back.
  validateSearch: (s: Record<string, unknown>): CoasSearch => {
    const size = PAGE_SIZES.includes(Number(s.size)) ? Number(s.size) : 10;
    const page = Number(s.page) >= 1 ? Math.floor(Number(s.page)) : 1; // 1-based cho URL
    const q = typeof s.q === "string" && s.q.trim() ? s.q : undefined;
    return { q, page, size };
  },
  component: RouteComponent,
});

function makeColumns(
  onEdit: (m: RawMaterial) => void,
): ColumnDef<RawMaterial>[] {
  return [
    {
      id: "code",
      header: () => <div>Mã nguyên liệu</div>,
      cell: ({ row }) => {
        return <p className="line-clamp-2 text-wrap">{row.original.code}</p>;
      },
    },
    {
      id: "name",
      header: () => <div>Tên nguyên liệu</div>,
      cell: ({ row }) => {
        return <p className="line-clamp-2 text-wrap">{row.original.name}</p>;
      },
    },
    {
      id: "producer",
      header: () => <div>Tên nhà sản xuất</div>,
      cell: ({ row }) => {
        return (
          <p className="line-clamp-2 text-wrap">{row.original.producer}</p>
        );
      },
    },
    {
      id: "country_of_origin",
      header: () => <div>Xuất sứ</div>,
      cell: ({ row }) => {
        return (
          <p className="line-clamp-2 text-wrap">
            {row.original.country_of_origin}
          </p>
        );
      },
    },
    {
      id: "action",
      header: () => <div></div>,
      cell: ({ row }) => {
        return (
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
                <DropdownMenuItem
                  render={<Link to={"/coas/" + row.original.id} />}
                >
                  Xem
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onEdit(row.original)}>
                  Sửa
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive">Xoá</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}

function RouteComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [editing, setEditing] = React.useState<RawMaterial | null>(null);

  // Ô tìm gõ tức thì (cục bộ), debounce rồi mới ghi vào URL.
  const [qInput, setQInput] = React.useState(search.q ?? "");
  const debouncedQ = useDebounce(qInput, 500);

  React.useEffect(() => {
    if ((debouncedQ.trim() || "") !== (search.q ?? "")) {
      // replace: gõ nhiều ký tự không tạo nhiều mục lịch sử; đổi từ khoá -> về trang 1.
      navigate({
        replace: true,
        search: (p) => ({ ...p, q: debouncedQ.trim() || undefined, page: 1 }),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  const pagination: PaginationState = {
    pageIndex: search.page - 1,
    pageSize: search.size,
  };

  const onPaginationChange: OnChangeFn<PaginationState> = (updater) => {
    const next = typeof updater === "function" ? updater(pagination) : updater;
    const sizeChanged = next.pageSize !== pagination.pageSize;
    navigate({
      // Đổi số dòng/trang -> luôn về trang 1.
      search: (p) => ({
        ...p,
        size: next.pageSize,
        page: sizeChanged ? 1 : next.pageIndex + 1,
      }),
    });
  };

  const rawMaterials = useQuery({
    queryKey: ["raw_materials", search.q ?? "", search.page, search.size],
    queryFn: () =>
      api.listRawMaterials({
        q: search.q,
        page: search.page - 1,
        pageSize: search.size,
      }),
    placeholderData: keepPreviousData,
  });

  const pageCount = Math.ceil((rawMaterials.data?.total ?? 0) / search.size);

  const columns = React.useMemo(() => makeColumns(setEditing), []);

  return (
    <div className="container mx-auto py-10 px-4 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <InputGroup className="max-w-xs">
          <InputGroupInput
            placeholder="Tìm theo mã hoặc tên..."
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
          <InputGroupAddon align="inline-end">
            <Search />
          </InputGroupAddon>
        </InputGroup>

        <div className="flex items-center gap-2">
          <RawMaterialExport />
          <RawMaterialImport />
          <RawMaterialDialog />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rawMaterials.data?.data ?? []}
        pagination={pagination}
        onPaginationChange={onPaginationChange}
        pageCount={pageCount}
      />

      {/* Dialog sửa (controlled): remount theo id để nạp lại defaultValues. */}
      <RawMaterialDialog
        key={editing?.id}
        data={editing ?? undefined}
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
      />
    </div>
  );
}
