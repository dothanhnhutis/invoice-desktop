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
import RawMaterialPicker from "./raw_material_picker";
import { ApiError, api, pickFiles, type RawMaterial } from "@/lib/api";
import { isVnDate } from "@/lib/date";

/** Khớp `COA_EXTS` phía Rust — chỉ dùng để lọc trong hộp thoại chọn file. */
const COA_EXTS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "pdf"];

type Row = {
  path: string;
  name: string;
  /** Chỉ dùng ở chế độ nhiều nguyên liệu (mở từ danh sách); giữ cả object để hiện `mã — tên`. */
  material: RawMaterial | null;
  lot_no: string;
  manufacture_date: string | null;
  expiration_date: string | null;
};

export type CoaBulkDialogProps = {
  /** Có id (mở từ trang chi tiết) → mọi COA thuộc nguyên liệu này. Không có (mở từ danh sách)
   *  → mỗi dòng tự chọn nguyên liệu, 1 lần nhập gom được COA của nhiều nguyên liệu. */
  rawMaterialId?: number;
};

const CoaBulkDialog = ({ rawMaterialId }: CoaBulkDialogProps) => {
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [dragging, setDragging] = React.useState(false);
  // Nguyên liệu ở thanh trên bảng: chọn 1 lần rồi điền cho cả loạt (chỉ chế độ nhiều nguyên liệu).
  const [bulkMaterial, setBulkMaterial] = React.useState<RawMaterial | null>(
    null,
  );
  const queryClient = useQueryClient();

  /** Mở từ danh sách nguyên liệu ⇒ phải hỏi nguyên liệu cho từng dòng. */
  const multi = rawMaterialId === undefined;

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
          material: null,
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
    setRows((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    );

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

  /** Điền nguyên liệu ở thanh trên cho cả loạt — kéo nguyên thư mục của 1 nguyên liệu thì chỉ chọn 1 lần. */
  const applyBulkMaterial = (overwrite: boolean) =>
    setRows((prev) =>
      prev.map((r) =>
        overwrite || !r.material ? { ...r, material: bulkMaterial } : r,
      ),
    );

  const mutation = useMutation({
    mutationFn: () =>
      api.createCoasBulkFromPaths(
        // Dòng thiếu nguyên liệu đã bị `canSubmit` chặn từ trước; ở đây chỉ lọc cho chắc.
        rows.flatMap((r) => {
          const raw_material_id = rawMaterialId ?? r.material?.id;
          return raw_material_id
            ? [
                {
                  raw_material_id,
                  path: r.path,
                  lot_no: r.lot_no.trim(),
                  manufacture_date: r.manufacture_date || null,
                  expiration_date: r.expiration_date || null,
                },
              ]
            : [];
        }),
      ),
    onSuccess: (res) => {
      // Khớp tiền tố -> làm mới mọi ["coas", id] vì 1 lần lưu có thể chạm nhiều nguyên liệu.
      queryClient.invalidateQueries({ queryKey: ["coas"] });
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
  const missingMaterial = multi ? rows.filter((r) => !r.material).length : 0;
  const badDate = rows.filter(
    (r) =>
      (r.manufacture_date && !isVnDate(r.manufacture_date)) ||
      (r.expiration_date && !isVnDate(r.expiration_date)),
  ).length;
  const canSubmit =
    rows.length > 0 &&
    missingLot === 0 &&
    missingMaterial === 0 &&
    badDate === 0 &&
    !mutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setRows([]);
          setBulkMaterial(null);
        }
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
      <DialogContent className={multi ? "sm:max-w-5xl" : "sm:max-w-3xl"}>
        <DialogHeader>
          <DialogTitle>Nhập COA</DialogTitle>
          <DialogDescription>
            Kéo file/thư mục vào đây hoặc bấm nút để chọn — gom được từ nhiều
            thư mục khác nhau. Nhập {multi ? "nguyên liệu, " : ""}số lô và ngày
            cho từng file rồi lưu tất cả.
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {rows.length} file
                {missingMaterial > 0 && (
                  <span className="text-destructive">
                    {" "}
                    · {missingMaterial} dòng thiếu nguyên liệu
                  </span>
                )}
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
              <div className="flex items-center gap-2 flex-wrap">
                {multi && (
                  <>
                    <RawMaterialPicker
                      value={bulkMaterial}
                      onChange={setBulkMaterial}
                      placeholder="Điền nhanh nguyên liệu"
                      className="w-72"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!bulkMaterial || missingMaterial === 0}
                      onClick={() => applyBulkMaterial(false)}
                    >
                      Điền dòng trống
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!bulkMaterial}
                      onClick={() => applyBulkMaterial(true)}
                    >
                      Ghi đè tất cả
                    </Button>
                  </>
                )}
                <Button variant="outline" size="sm" onClick={addFiles}>
                  <FilePlusIcon />
                  Thêm file
                </Button>
              </div>
            </div>

            {/* min-w-0: DialogContent là grid, ô lưới mặc định min-width:auto -> thiếu dòng này
                bảng đội hộp thoại tràn ra ngoài màn hình thay vì cuộn.
                overflow-visible cho div bọc của ui/table: để nó tự cuộn ngang thì thanh cuộn nằm ở
                đáy bảng (phải cuộn dọc hết mới thấy) — dồn cả 2 chiều về khung 55vh này. */}
            <div
              className={`max-h-[55vh] min-w-0 overflow-auto rounded-md border transition-colors **:data-[slot=table-container]:overflow-visible ${
                dragging ? "border-primary bg-primary/5" : ""
              }`}
            >
              <Table>
                <TableHeader>
                  {/* min-w (không phải w): với table-layout auto thì w-* chỉ là gợi ý, màn hình
                      hẹp là mọi cột bị bóp — min-width mới buộc bảng tràn ra để cuộn ngang. */}
                  <TableRow>
                    <TableHead className="min-w-55">Tên file</TableHead>
                    {multi && (
                      <TableHead className="min-w-72">Nguyên liệu *</TableHead>
                    )}
                    <TableHead className="min-w-40">Số lô *</TableHead>
                    <TableHead className="min-w-36">Ngày SX</TableHead>
                    <TableHead className="min-w-36">HSD</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={r.path}>
                      <TableCell className="max-w-55" title={r.path}>
                        <button
                          type="button"
                          className="block max-w-full truncate text-left text-primary underline-offset-2 hover:underline"
                          onClick={() => openFile(r.path)}
                        >
                          {r.name}
                        </button>
                      </TableCell>
                      {multi && (
                        <TableCell>
                          <RawMaterialPicker
                            value={r.material}
                            invalid={!r.material}
                            onChange={(m) => update(i, { material: m })}
                          />
                        </TableCell>
                      )}
                      <TableCell>
                        <Input
                          value={r.lot_no}
                          aria-invalid={!r.lot_no.trim()}
                          placeholder="Số lô"
                          onChange={(e) =>
                            update(i, { lot_no: e.target.value })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={r.manufacture_date ?? ""}
                          placeholder="dd/mm/yyyy"
                          aria-invalid={
                            !!r.manufacture_date &&
                            !isVnDate(r.manufacture_date)
                          }
                          onChange={(e) =>
                            update(i, {
                              manufacture_date: e.target.value || null,
                            })
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
                            update(i, {
                              expiration_date: e.target.value || null,
                            })
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
