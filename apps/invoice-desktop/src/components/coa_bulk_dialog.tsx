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
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { toast } from "sonner";
import { FilePlusIcon, FolderUpIcon, Trash2Icon } from "lucide-react";
import { ApiError, api, pickFiles } from "@/lib/api";
import { isVnDate } from "@/lib/date";

/** Khớp `COA_EXTS` phía Rust — chỉ dùng để lọc trong hộp thoại chọn file. */
const COA_EXTS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "pdf"];

type Row = {
  path: string;
  name: string;
  lot_no: string;
  manufacture_date: string | null;
  expiration_date: string | null;
};

export type CoaBulkDialogProps = {
  rawMaterialId: number;
};

const CoaBulkDialog = ({ rawMaterialId }: CoaBulkDialogProps) => {
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const queryClient = useQueryClient();

  /**
   * Đường vào DUY NHẤT cho mọi cách thêm file (kéo-thả / chọn file / chọn thư mục):
   * Rust quét đệ quy + lọc đuôi/dung lượng, JS chỉ lo cộng dồn và khử trùng theo đường dẫn.
   */
  const addPaths = React.useCallback(async (paths: string[]) => {
    if (!paths.length) return;
    let found;
    try {
      found = await api.scanCoaFiles(paths);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
      return;
    }
    if (!found.length) {
      toast.warning("Không có file ảnh/PDF hợp lệ (≤ 20MB).");
      return;
    }
    setRows((prev) => {
      const seen = new Set(prev.map((r) => r.path));
      const fresh = found.filter((f) => !seen.has(f.path));
      if (!fresh.length) {
        toast.info("Các file này đã có trong danh sách.");
        return prev;
      }
      if (fresh.length < found.length) {
        toast.info(`Đã bỏ qua ${found.length - fresh.length} file trùng.`);
      }
      // Cộng dồn: số lô/ngày đã gõ ở các dòng cũ được giữ nguyên.
      return [
        ...prev,
        ...fresh.map((f) => ({
          path: f.path,
          name: f.name,
          lot_no: "",
          manufacture_date: null,
          expiration_date: null,
        })),
      ];
    });
  }, []);

  /**
   * Kéo-thả: `dragDropEnabled` mặc định BẬT ở Tauri v2 nên webview KHÔNG nhận được sự kiện
   * `drop` HTML5 / đối tượng `File` — phải nghe sự kiện của Tauri (trả đường dẫn tuyệt đối).
   * Sự kiện ở phạm vi cả cửa sổ ⇒ chỉ đăng ký khi dialog đang mở.
   */
  React.useEffect(() => {
    if (!open) return;
    const p = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "enter" || e.payload.type === "over") {
        setDragging(true);
      } else if (e.payload.type === "drop") {
        setDragging(false);
        addPaths(e.payload.paths);
      } else {
        setDragging(false);
      }
    });
    return () => {
      p.then((un) => un());
      setDragging(false);
    };
  }, [open, addPaths]);

  const update = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const removeRow = (i: number) =>
    setRows((prev) => prev.filter((_, idx) => idx !== i));

  // Chỉ có nút chọn FILE — thư mục cố ý chỉ nạp được bằng kéo-thả.
  const addFiles = async () => addPaths(await pickFiles("COA", COA_EXTS));

  // Xem trước file CHƯA lưu: mở thẳng từ đường dẫn gốc bằng app mặc định của OS.
  const openFile = async (path: string) => {
    try {
      await api.openPathExternal(path);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    }
  };

  const mutation = useMutation({
    mutationFn: () =>
      api.createCoasBulkFromPaths(
        rawMaterialId,
        rows.map((r) => ({
          path: r.path,
          lot_no: r.lot_no.trim(),
          manufacture_date: r.manufacture_date || null,
          expiration_date: r.expiration_date || null,
        })),
      ),
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
      setRows([]);
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

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setRows([]);
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline">
            <FolderUpIcon />
            <span className="hidden sm:inline">Nhập COA</span>
          </Button>
        }
      />
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Nhập COA</DialogTitle>
          <DialogDescription>
            Kéo file/thư mục vào đây hoặc bấm nút để chọn — gom được từ nhiều thư
            mục khác nhau. Nhập số lô và ngày cho từng file rồi lưu tất cả.
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <div
            className={`flex flex-col items-center justify-center gap-3 rounded-md border border-dashed py-10 transition-colors ${
              dragging ? "border-primary bg-primary/5" : ""
            }`}
          >
            <div className="space-y-1 text-center">
              <p className="text-sm text-muted-foreground">
                Kéo file hoặc thư mục vào đây
              </p>
              <p className="text-xs text-muted-foreground">
                Cả thư mục thì phải kéo-thả; nút bên dưới chỉ chọn file.
              </p>
            </div>
            <Button variant="outline" onClick={addFiles}>
              <FilePlusIcon />
              Chọn file
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
              <Button variant="outline" size="sm" onClick={addFiles}>
                <FilePlusIcon />
                Thêm file
              </Button>
            </div>

            <div
              className={`max-h-[55vh] overflow-auto rounded-md border transition-colors ${
                dragging ? "border-primary bg-primary/5" : ""
              }`}
            >
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
                    <TableRow key={r.path}>
                      <TableCell className="max-w-[220px]" title={r.path}>
                        <button
                          type="button"
                          className="block max-w-full truncate text-left text-primary underline-offset-2 hover:underline"
                          onClick={() => openFile(r.path)}
                        >
                          {r.name}
                        </button>
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
          <Button disabled={!canSubmit} onClick={() => mutation.mutate()}>
            {mutation.isPending && <Spinner />}
            Lưu tất cả{rows.length ? ` (${rows.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CoaBulkDialog;
