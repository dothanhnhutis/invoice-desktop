import { DataTable } from "@/components/data-table";
import RawMaterialDialog from "@/components/raw_material_dialog";
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
import { ColumnDef, PaginationState } from "@tanstack/react-table";
import { EllipsisIcon, Search } from "lucide-react";
import React from "react";

export const Route = createFileRoute("/_protected/coas")({
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
  const [q, setQ] = React.useState("");
  const [editing, setEditing] = React.useState<RawMaterial | null>(null);
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });

  const debouncedQ = useDebounce(q, 500);

  const rawMaterials = useQuery({
    queryKey: [
      "raw_materials",
      debouncedQ,
      pagination.pageIndex,
      pagination.pageSize,
    ],
    queryFn: () =>
      api.listRawMaterials({
        q: debouncedQ || undefined,
        page: pagination.pageIndex,
        pageSize: pagination.pageSize,
      }),
    placeholderData: keepPreviousData,
  });

  // Từ khoá (đã debounce) đổi -> về trang đầu.
  React.useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [debouncedQ]);

  const pageCount = Math.ceil(
    (rawMaterials.data?.total ?? 0) / pagination.pageSize,
  );

  const columns = React.useMemo(() => makeColumns(setEditing), []);

  return (
    <div className="container mx-auto py-10 px-4 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <InputGroup className="max-w-xs">
          <InputGroupInput
            placeholder="Tìm theo mã hoặc tên..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <InputGroupAddon align="inline-end">
            <Search />
          </InputGroupAddon>
        </InputGroup>

        <RawMaterialDialog />
      </div>

      <DataTable
        columns={columns}
        data={rawMaterials.data?.data ?? []}
        pagination={pagination}
        onPaginationChange={setPagination}
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
