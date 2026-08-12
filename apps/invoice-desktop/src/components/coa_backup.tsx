import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DatabaseBackupIcon, HardDriveUploadIcon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import {
  ApiError,
  api,
  pickFile,
  pickFolder,
  FEATURE_RAW_MATERIALS_KEY,
  type BackupResult,
  type RestoreResult,
} from "@/lib/api";

const err = (e: unknown) => (e instanceof ApiError ? e.message : String(e));

/**
 * Sao lưu / phục hồi toàn bộ Nguyên liệu & COA (kèm file) qua 1 file `.zip` —
 * dùng để mang dữ liệu sang máy khác cũng chạy app này.
 * Phục hồi là **gộp thêm**: không xoá gì, COA trùng thì bỏ qua nên chạy lại nhiều lần vẫn an toàn.
 */
const CoaBackup = () => {
  const qc = useQueryClient();
  const [backupResult, setBackupResult] = React.useState<BackupResult | null>(
    null,
  );
  const [restoreResult, setRestoreResult] =
    React.useState<RestoreResult | null>(null);
  // Đường dẫn file đã chọn, chờ xác nhận trước khi ghi vào DB.
  const [pending, setPending] = React.useState<string | null>(null);

  const backupMut = useMutation({
    mutationFn: (dir: string) => api.backupCoas(dir),
    onSuccess: (res) => {
      toast.success(`Đã sao lưu ${res.raw_materials} nguyên liệu / ${res.coas} COA`);
      setBackupResult(res);
    },
    onError: (e) => toast.error(err(e)),
  });

  const restoreMut = useMutation({
    mutationFn: (zipPath: string) => api.restoreCoas(zipPath),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["raw_materials"] });
      qc.invalidateQueries({ queryKey: FEATURE_RAW_MATERIALS_KEY });
      toast.success(
        `Đã thêm ${res.coas_added} COA (bỏ qua ${res.coas_skipped} COA đã có)`,
      );
      setRestoreResult(res);
    },
    onError: (e) => toast.error(err(e)),
  });

  const busy = backupMut.isPending || restoreMut.isPending;

  const onBackup = async () => {
    const dir = await pickFolder();
    if (!dir) return;
    backupMut.mutate(dir);
  };

  const onPickRestore = async () => {
    const path = await pickFile("Bản sao lưu", ["zip"]);
    if (path) setPending(path);
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={onBackup}>
          {backupMut.isPending ? <Spinner /> : <DatabaseBackupIcon />}
          Sao lưu
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={onPickRestore}
        >
          {restoreMut.isPending ? <Spinner /> : <HardDriveUploadIcon />}
          Phục hồi
        </Button>
      </div>

      <AlertDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Phục hồi từ bản sao lưu?</AlertDialogTitle>
            <AlertDialogDescription>
              Dữ liệu hiện có <b>không bị xoá</b>. Nguyên liệu trùng mã sẽ giữ
              nguyên thông tin ở máy này và chỉ được thêm COA còn thiếu; COA đã
              có sẽ bỏ qua.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction
              disabled={restoreMut.isPending}
              onClick={async () => {
                const path = pending;
                setPending(null);
                if (path) await restoreMut.mutateAsync(path).catch(() => {});
              }}
            >
              Phục hồi
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={!!backupResult}
        onOpenChange={(o) => !o && setBackupResult(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Đã sao lưu</DialogTitle>
            <DialogDescription>
              {backupResult?.raw_materials ?? 0} nguyên liệu,{" "}
              {backupResult?.coas ?? 0} COA → {backupResult?.path}
            </DialogDescription>
          </DialogHeader>

          {!!backupResult?.missing_files.length && (
            <div className="max-h-[50vh] space-y-1 overflow-auto text-sm">
              <p className="font-medium">
                COA thiếu file ({backupResult.missing_files.length})
              </p>
              <p className="text-muted-foreground">
                Bản ghi vẫn được sao lưu, nhưng file đính kèm không còn trên đĩa:
              </p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {backupResult.missing_files.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          <DialogFooter>
            <DialogClose render={<Button variant="outline">Đóng</Button>} />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!restoreResult}
        onOpenChange={(o) => !o && setRestoreResult(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Kết quả phục hồi</DialogTitle>
            <DialogDescription>
              Thêm mới {restoreResult?.materials_created ?? 0} nguyên liệu, gộp
              vào {restoreResult?.materials_matched ?? 0} nguyên liệu đã có. Thêm{" "}
              {restoreResult?.coas_added ?? 0} COA, bỏ qua{" "}
              {restoreResult?.coas_skipped ?? 0} COA trùng.
            </DialogDescription>
          </DialogHeader>

          {!!restoreResult?.errors.length && (
            <div className="max-h-[50vh] space-y-1 overflow-auto text-sm">
              <p className="font-medium">Lỗi ({restoreResult.errors.length})</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {restoreResult.errors.map((e, i) => (
                  <li key={i}>
                    {e.code}
                    {e.lot_no ? ` / ${e.lot_no}` : ""}: {e.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <DialogFooter>
            <DialogClose render={<Button variant="outline">Đóng</Button>} />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default CoaBackup;
