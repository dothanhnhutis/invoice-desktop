import React from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Spinner } from "./ui/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderUpIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { ApiError, api, type NewCoaInput } from "@/lib/api";
import { isVnDate } from "@/lib/date";

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB
const ALLOWED_EXTS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "pdf"];

type Row = {
  file: File;
  lot_no: string;
  manufacture_date: string | null;
  expiration_date: string | null;
};

function isAllowed(file: File): boolean {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  return ALLOWED_EXTS.includes(ext) && file.size <= MAX_FILE_BYTES;
}

export type CoaBulkDialogProps = {
  rawMaterialId: number;
};

const CoaBulkDialog = ({ rawMaterialId }: CoaBulkDialogProps) => {
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState<Row[]>([]);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // TS không có prop `webkitdirectory` — gắn qua ref để chọn cả thư mục.
  React.useEffect(() => {
    if (inputRef.current) {
      inputRef.current.setAttribute("webkitdirectory", "");
      inputRef.current.setAttribute("directory", "");
    }
  }, [open]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const all = Array.from(e.target.files ?? []);
    e.target.value = ""; // cho phép chọn lại cùng thư mục
    const kept = all.filter(isAllowed);
    if (kept.length === 0) {
      toast.warning("Thư mục không có file ảnh/PDF hợp lệ (≤ 20MB).");
      return;
    }
    if (kept.length < all.length) {
      toast.info(`Đã bỏ qua ${all.length - kept.length} file không hợp lệ.`);
    }
    setRows(
      kept.map((file) => ({
        file,
        lot_no: "",
        manufacture_date: null,
        expiration_date: null,
      })),
    );
  };

  const update = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const removeRow = (i: number) =>
    setRows((prev) => prev.filter((_, idx) => idx !== i));

  const reset = () => {
    setRows([]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const mutation = useMutation({
    mutationFn: api.createCoasBulk,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["coas", rawMaterialId] });
      toast.success(`Đã thêm ${res.created} COA`);
      if (res.errors.length) {
        toast.error(
          `${res.errors.length} file lỗi: ` +
            res.errors.map((e) => e.file_name).join(", "),
        );
      }
      setOpen(false);
      reset();
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : String(e));
    },
  });

  const missingLot = rows.filter((r) => !r.lot_no.trim()).length;
  const badDate = rows.filter(
    (r) =>
      (r.manufacture_date && !isVnDate(r.manufacture_date)) ||
      (r.expiration_date && !isVnDate(r.expiration_date)),
  ).length;
  const canSubmit =
    rows.length > 0 && missingLot === 0 && badDate === 0 && !mutation.isPending;

  const submit = async () => {
    const payloads: NewCoaInput[] = [];
    for (const r of rows) {
      const bytes = Array.from(new Uint8Array(await r.file.arrayBuffer()));
      payloads.push({
        raw_material_id: rawMaterialId,
        lot_no: r.lot_no.trim(),
        manufacture_date: r.manufacture_date || null,
        expiration_date: r.expiration_date || null,
        file_name: r.file.name,
        file_bytes: bytes,
      });
    }
    mutation.mutate(payloads);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline">
            <FolderUpIcon />
            <span className="hidden sm:inline">Nhập thư mục COA</span>
          </Button>
        }
      />
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Nhập thư mục COA</DialogTitle>
          <DialogDescription>
            Chọn thư mục chứa các file COA (ảnh/PDF), nhập số lô và ngày cho từng
            file rồi lưu tất cả.
          </DialogDescription>
        </DialogHeader>

        <input ref={inputRef} type="file" hidden multiple onChange={onPick} />

        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed py-10">
            <p className="text-sm text-muted-foreground">
              Chưa chọn thư mục nào.
            </p>
            <Button
              variant="outline"
              onClick={() => inputRef.current?.click()}
            >
              <UploadIcon />
              Chọn thư mục
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {rows.length} file
                {missingLot > 0 && (
                  <span className="text-destructive">
                    {" "}
                    · {missingLot} dòng thiếu số lô
                  </span>
                )}
                {badDate > 0 && (
                  <span className="text-destructive">
                    {" "}
                    · {badDate} dòng ngày sai định dạng
                  </span>
                )}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => inputRef.current?.click()}
              >
                <UploadIcon />
                Chọn thư mục khác
              </Button>
            </div>

            <div className="max-h-[55vh] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tên file</TableHead>
                    <TableHead className="w-40">Số lô *</TableHead>
                    <TableHead className="w-40">Ngày SX</TableHead>
                    <TableHead className="w-40">HSD</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell
                        className="max-w-[220px] truncate"
                        title={r.file.name}
                      >
                        {r.file.name}
                      </TableCell>
                      <TableCell>
                        <Input
                          value={r.lot_no}
                          aria-invalid={!r.lot_no.trim()}
                          placeholder="Số lô"
                          onChange={(e) => update(i, { lot_no: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={r.manufacture_date ?? ""}
                          placeholder="dd/mm/yyyy"
                          aria-invalid={
                            !!r.manufacture_date && !isVnDate(r.manufacture_date)
                          }
                          onChange={(e) =>
                            update(i, { manufacture_date: e.target.value || null })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={r.expiration_date ?? ""}
                          placeholder="dd/mm/yyyy"
                          aria-invalid={
                            !!r.expiration_date && !isVnDate(r.expiration_date)
                          }
                          onChange={(e) =>
                            update(i, { expiration_date: e.target.value || null })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeRow(i)}
                          aria-label="Xoá dòng"
                        >
                          <Trash2Icon />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        <DialogFooter>
          <DialogClose
            render={
              <Button disabled={mutation.isPending} variant="outline">
                Huỷ
              </Button>
            }
          />
          <Button disabled={!canSubmit} onClick={submit}>
            {mutation.isPending && <Spinner />}
            Lưu tất cả{rows.length ? ` (${rows.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CoaBulkDialog;
