import React from "react";
import { listen } from "@tauri-apps/api/event";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUpIcon } from "lucide-react";

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
  pickFolder,
  type InvoiceCsvProgress,
  type InvoiceCsvResult,
} from "@/lib/api";

/**
 * Nút "Tải theo CSV": chọn file CSV (`nbmst,khhdon,shdon[,khmshdon]`) → chọn thư mục lưu →
 * tải bản thể hiện (PDF + XML) của từng hóa đơn, nhiều file thì nén thành `<tên CSV>.zip`.
 * Hóa đơn không cần có sẵn trong máy — CSV đã đủ 4 khóa để hỏi thẳng cổng GDT.
 */
const InvoiceCsvDownload = () => {
  const [result, setResult] = React.useState<InvoiceCsvResult | null>(null);
  const [progress, setProgress] = React.useState<InvoiceCsvProgress | null>(
    null,
  );
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const p = listen<InvoiceCsvProgress>("invoice-csv://progress", (e) =>
      setProgress(e.payload),
    );
    return () => {
      p.then((un) => un());
    };
  }, []);

  const mutation = useMutation({
    mutationFn: ({
      bytes,
      baseName,
      dir,
    }: {
      bytes: number[];
      baseName: string;
      dir: string;
    }) => api.downloadInvoicesFromCsv(bytes, baseName, dir),
    onSuccess: (res) => {
      if (res.downloaded > 0) {
        toast.success(`Đã tải ${res.downloaded} hóa đơn`);
      } else {
        toast.warning("Không tải được hóa đơn nào");
      }
      if (res.errors.length || res.downloaded === 0) setResult(res);
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : String(e));
    },
    onSettled: () => setProgress(null),
  });

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // cho phép chọn lại đúng file vừa chọn
    if (!file) return;
    // Hỏi thư mục TRƯỚC khi gọi mạng — hủy chọn = hủy luôn thao tác.
    const dir = await pickFolder();
    if (!dir) return;
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    const baseName = file.name.replace(/\.csv$/i, "");
    setProgress(null);
    mutation.mutate({ bytes, baseName, dir });
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
      <Button
        variant="outline"
        disabled={mutation.isPending}
        onClick={() => inputRef.current?.click()}
      >
        {mutation.isPending ? <Spinner /> : <FileUpIcon />}
        {mutation.isPending && progress
          ? `Đang tải ${progress.done}/${progress.total}`
          : "Tải theo CSV"}
      </Button>

      <Dialog open={!!result} onOpenChange={(o) => !o && setResult(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Kết quả tải hóa đơn</DialogTitle>
            <DialogDescription>
              Đã tải {result?.downloaded ?? 0} hóa đơn
              {result?.path ? ` → ${result.path}` : ""}.
            </DialogDescription>
          </DialogHeader>

          {!!result?.errors.length && (
            <div className="max-h-[50vh] space-y-1 overflow-auto text-sm">
              <p className="font-medium">Lỗi ({result.errors.length})</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {result.errors.map((row, i) => (
                  <li key={i}>
                    Dòng {row.line}
                    {row.label ? ` (${row.label})` : ""}: {row.reason}
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

export default InvoiceCsvDownload;
