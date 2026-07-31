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
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { DownloadIcon } from "lucide-react";
import { ApiError, api, type ExportResult } from "@/lib/api";

/** Nút "Tải COA": chọn file CSV (code, lot_no, [ngày SX], [HSD]) → tải file COA khớp về Downloads. */
const RawMaterialExport = () => {
  const [result, setResult] = React.useState<ExportResult | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: ({ bytes, baseName }: { bytes: number[]; baseName: string }) =>
      api.downloadCoasFromCsv(bytes, baseName),
    onSuccess: (res) => {
      if (res.downloaded > 0) {
        toast.success(`Đã tải ${res.downloaded} COA về Downloads`);
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
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    const baseName = file.name.replace(/\.csv$/i, "");
    mutation.mutate({ bytes, baseName });
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
        {mutation.isPending ? <Spinner /> : <DownloadIcon />}
        <span className="hidden sm:inline">Tải COA</span>
      </Button>

      <Dialog open={!!result} onOpenChange={(o) => !o && setResult(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Kết quả tải COA</DialogTitle>
            <DialogDescription>
              Đã tải {result?.downloaded ?? 0} COA về Downloads.
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
