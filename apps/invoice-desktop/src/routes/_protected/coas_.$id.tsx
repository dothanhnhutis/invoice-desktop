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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { createFileRoute } from "@tanstack/react-router";
import { ColumnDef } from "@tanstack/react-table";
import { EllipsisIcon } from "lucide-react";

export const Route = createFileRoute("/_protected/coas_/$id")({
  component: RouteComponent,
});

const countries = [
  { label: "Choose country", value: null },
  { label: "Việt Nam", value: "Việt Nam" },
  { label: "Trung Quốc", value: "Trung Quốc" },
  { label: "Ý", value: "Ý" },
  { label: "Hàn Quốc", value: "Hàn Quốc" },
];

type COA = {
  id: number;
  lot_no: string;
  manufacture_date: string | null;
  expiration_date: string | null;
  path: string;
};
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

export const columns: ColumnDef<COA>[] = [
  {
    id: "lot_no",
    header: () => <div>Số lô</div>,
    cell: ({ row }) => {
      return <p className="line-clamp-2 text-wrap">{row.original.lot_no}</p>;
    },
  },
  {
    id: "manufacture_date",
    header: () => <div>Ngày sản xuất</div>,
    cell: ({ row }) => {
      return (
        <p className="line-clamp-2 text-wrap">
          {row.original.manufacture_date}
        </p>
      );
    },
  },
  {
    id: "expiration_date",
    header: () => <div>Hạn sử dụng</div>,
    cell: ({ row }) => {
      return (
        <p className="line-clamp-2 text-wrap">{row.original.expiration_date}</p>
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
              <DropdownMenuItem>Sửa</DropdownMenuItem>
              <DropdownMenuItem variant="destructive">Xoá</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];

function RouteComponent() {
  return (
    <div className="container mx-auto p-4">
      <FieldGroup>
        <FieldSet>
          <FieldLegend>Thông tin nguyên liệu</FieldLegend>
          <FieldGroup>
            <div className="grid md:grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="code">Mã nguyên liệu</FieldLabel>
                <Input id="code" placeholder="ICHRM-xxx" required />
                <FieldDescription>
                  Mã nguyên liệu trên google sheet
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="name">Tên nguyên liệu</FieldLabel>
                <Input id="name" placeholder="Tên nguyên liệu" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="producer">Tên nhà sản xuất</FieldLabel>
                <Input id="producer" placeholder="Tên nhà sản xuất" required />
                <FieldDescription>
                  Tên nhà sản xuất nguyên liệu
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="country_of_origin">Quốc gia</FieldLabel>
                <Select items={countries}>
                  <SelectTrigger id="country_of_origin">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {countries.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>Quốc gia của nhà sản xuất</FieldDescription>
              </Field>
            </div>
          </FieldGroup>
        </FieldSet>
        <FieldSeparator />
        <FieldSet>
          <FieldLegend>Certificate of Analysis (COA)</FieldLegend>
          <FieldDescription>Danh sách COA của nguyên liệu</FieldDescription>
          <DataTable columns={columns} data={coas ?? []} />
        </FieldSet>
      </FieldGroup>
    </div>
  );
}
