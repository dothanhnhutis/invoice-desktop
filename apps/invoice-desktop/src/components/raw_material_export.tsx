import React from "react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { DownloadIcon } from "lucide-react";
import { ApiError, api, pickFolder, type ExportResult } from "@/lib/api";

/** Nút "Tải COA": chọn file CSV (code, lot_no, [ngày SX], [HSD]) → tải file COA khớp về Downloads. */
const RawMaterialExport = () => {
  const [result, setResult] = React.useState<ExportResult | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: ({
      bytes,
      baseName,
      dir,
    }: {
      bytes: number[];
      baseName: string;
      dir: string;
    }) => api.downloadCoasFromCsv(bytes, baseName, dir),
    onSuccess: (res) => {
      if (res.downloaded > 0) {
        toast.success(`Đã tải ${res.downloaded} COA → ${res.path}`);
      } else {
        toast.warning("Không có COA nào khớp");
      }
      if (res.not_found.length || res.downloaded === 0) setResult(res);
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : String(e));
    },
  });

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    // Hỏi thư mục lưu TRƯỚC khi làm gì — huỷ chọn = huỷ thao tác.
    const dir = await pickFolder();
    if (!dir) return;
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    const baseName = file.name.replace(/\.csv$/i, "");
    mutation.mutate({ bytes, baseName, dir });
  };

  // Tải file CSV mẫu để người dùng biết cần những cột nào.
  const onDownloadTemplate = async () => {
    const dir = await pickFolder();
    if (!dir) return;
    try {
      const path = await api.saveCoaCsvTemplate(dir);
      toast.success(`Đã lưu file mẫu → ${path}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={onPick}
      />

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => inputRef.current?.click()}
            >
              {mutation.isPending ? <Spinner /> : <DownloadIcon />}
              <span className="hidden sm:inline">Tải COA</span>
            </Button>
          }
        />
        <TooltipContent>
          <div className="flex flex-col">
            <p>Chọn file csv chứa danh sách COA để tải về.</p>
            <p
              aria-label="Tải file CSV mẫu"
              className="hover:underline cursor-pointer"
              onClick={onDownloadTemplate}
            >
              Tải file mẫu
            </p>
          </div>
        </TooltipContent>
      </Tooltip>

      <Dialog open={!!result} onOpenChange={(o) => !o && setResult(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Kết quả tải COA</DialogTitle>
            <DialogDescription>
              Đã tải {result?.downloaded ?? 0} COA
              {result?.path ? ` → ${result.path}` : ""}.
            </DialogDescription>
          </DialogHeader>

          {!!result?.not_found.length && (
            <div className="max-h-[50vh] space-y-1 overflow-auto text-sm">
              <p className="font-medium">
                Không tìm thấy ({result.not_found.length})
              </p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {result.not_found.map((row, i) => (
                  <li key={i}>
                    Dòng {row.line}
                    {row.code || row.lot_no
                      ? ` (${row.code} / ${row.lot_no})`
                      : ""}
                    : {row.reason}
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

export default RawMaterialExport;
