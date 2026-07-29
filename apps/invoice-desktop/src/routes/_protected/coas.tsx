import { DataTable } from "@/components/data-table";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ColumnDef } from "@tanstack/react-table";
import { EllipsisIcon, Search } from "lucide-react";
import React from "react";

export const Route = createFileRoute("/_protected/coas")({
  component: RouteComponent,
});

type Producer = {
  id: number;
  name: string;
};

type RawMaterial = {
  id: number;
  code: string;
  name: string;
  producer: string;
  country_of_origin: string | null;
};

type COA = {
  id: number;
  lot_no: string;
  manufacture_date: string | null;
  expiration_date: string | null;
  path: string;
};

const producers: Producer[] = [
  {
    id: 1,
    name: "Sinoway Industrial Co.,Ltd",
  },
  {
    id: 2,
    name: "Innovacos Corp",
  },
  {
    id: 3,
    name: "Baker Petrolite Corporation",
  },
  {
    id: 4,
    name: "VANTAGE Speciaity Ingredients, Inc",
  },
  {
    id: 5,
    name: "CoSeedBioPharm Co., Ltd",
  },
];

const raw_materials: RawMaterial[] = [
  {
    id: 1,
    code: "ICHRM-0248",
    name: "Bakuchiol",
    producer: "Sinoway Industrial Co.,Ltd",
    country_of_origin: "Trung Quốc",
  },
  {
    id: 2,
    code: "ICHRM-0249",
    name: "Activoil Echnidium",
    producer: "Innovacos Corp",
    country_of_origin: "Ý",
  },
  {
    id: 3,
    code: "ICHRM-0250",
    name: "Performalene (TM) PL PE",
    producer: "Baker Petrolite Corporation",
    country_of_origin: "Thái lan",
  },
  {
    id: 4,
    code: "ICHRM-0250",
    name: "DW jojoba golden",
    producer: "VANTAGE Speciaity Ingredients, Inc",
    country_of_origin: "Mỹ",
  },
  {
    id: 5,
    code: "ICHRM-0246",
    name: "BioluminoPeel",
    producer: "CoSeedBioPharm Co., Ltd",
    country_of_origin: "Hàn Quốc",
  },
];

const items = [
  { label: "Tên", value: "name" },
  { label: "Mã", value: "code" },
];

export const columns: ColumnDef<RawMaterial>[] = [
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
      return <p className="line-clamp-2 text-wrap">{row.original.producer}</p>;
    },
  },
  {
    id: "producer",
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
      const navigate = useNavigate({ from: "/coas" });
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
                onClick={() => navigate({ to: "/coas/" + row.id })}
              >
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

function RouteComponent() {
  const [searchType, setSearchType] = React.useState<string | null>("name");

  return (
    <div className="container mx-auto py-10 px-4 space-y-4">
      <div>
        <InputGroup className="max-w-xs">
          <InputGroupInput placeholder="Search..." />
          <InputGroupAddon>
            <Select
              items={items}
              defaultValue={searchType}
              onValueChange={setSearchType}
            >
              <SelectTrigger className="w-full max-w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Loại</SelectLabel>
                  {items.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </InputGroupAddon>
          <InputGroupAddon align="inline-end">
            <Search />
          </InputGroupAddon>
        </InputGroup>
      </div>
      <div>
        <DataTable columns={columns} data={raw_materials ?? []} />
      </div>
    </div>
  );
}
