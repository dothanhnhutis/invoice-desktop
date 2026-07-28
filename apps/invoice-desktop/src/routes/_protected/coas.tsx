import { DataTable } from "@/components/data-table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { createFileRoute } from "@tanstack/react-router";
import { ColumnDef } from "@tanstack/react-table";
import { EllipseIcon, EllipsisIcon, Search } from "lucide-react";
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
  producer_id: number;
  country_of_origin: string;
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
    producer_id: 1,
    country_of_origin: "Trung Quốc",
  },
  {
    id: 2,
    code: "ICHRM-0249",
    name: "Activoil Echnidium",
    producer_id: 2,
    country_of_origin: "Ý",
  },
  {
    id: 3,
    code: "ICHRM-0250",
    name: "Performalene (TM) PL PE",
    producer_id: 3,
    country_of_origin: "Thái lan",
  },
  {
    id: 4,
    code: "ICHRM-0250",
    name: "DW jojoba golden",
    producer_id: 4,
    country_of_origin: "Mỹ",
  },
  {
    id: 5,
    code: "ICHRM-0246",
    name: "BioluminoPeel",
    producer_id: 5,
    country_of_origin: "Hàn Quốc",
  },
];

const coas: COA[] = [
  {
    id: 1,
    lot_no: "25111101",
    manufacture_date: "11/11/2025",
    expiration_date: "10/11/2027",
    path: "",
  },
  {
    id: 2,
    lot_no: "250812-Z1013270",
    manufacture_date: "11/08/2025",
    expiration_date: "12/08/2027",
    path: "",
  },
  {
    id: 3,
    lot_no: "BFC0901",
    manufacture_date: "09/03/2026",
    expiration_date: "08/03/2028",
    path: "",
  },
];

const items = [
  { label: "Tên", value: "name" },
  { label: "Mã", value: "code" },
];

export const columns: ColumnDef<Producer>[] = [
  {
    id: "name",
    header: () => <div>Tên nhà sản xuất</div>,
    cell: ({ row }) => {
      return <p className="line-clamp-2 text-wrap">{row.original.name}</p>;
    },
  },
];

function RouteComponent() {
  const [searchType, setSearchType] = React.useState<string | null>("name");

  return (
    <div className="container mx-auto py-10 px-4">
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

        <AlertDialog>
          <AlertDialogTrigger
            render={<Button variant="outline">Show Dialog</Button>}
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Quản lý nhà sản xuất</AlertDialogTitle>
            </AlertDialogHeader>
            <div className="rounded-md border">
              <DataTable columns={columns} data={producers ?? []} />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction>Continue</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <div>table</div>
    </div>
  );
}
