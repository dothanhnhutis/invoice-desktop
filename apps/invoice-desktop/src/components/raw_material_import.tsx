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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UploadIcon } from "lucide-react";
import { ApiError, api, type ImportResult } from "@/lib/api";

/** Nút "Nhập CSV": chọn file .csv -> gọi backend nhập hàng loạt -> báo cáo kết quả. */
const RawMaterialImport = () => {
  const [result, setResult] = React.useState<ImportResult | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: api.importRawMaterials,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["raw_materials"] });
      toast.success(`Đã nhập ${res.created} nguyên liệu`);
      // Chỉ mở dialog kết quả khi có gì đó cần người dùng xem lại.
      if (res.duplicates.length || res.invalid.length) setResult(res);
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : String(e));
    },
  });

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset ngay để chọn lại cùng file vẫn kích hoạt onChange.
    e.target.value = "";
    if (!file) return;
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    mutation.mutate(bytes);
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={onPick}
      />
      <Button
        variant="outline"
        disabled={mutation.isPending}
        onClick={() => fileInputRef.current?.click()}
      >
        {mutation.isPending ? <Spinner /> : <UploadIcon />}
        <span className="hidden sm:inline">Nhập CSV</span>
      </Button>

      <Dialog open={!!result} onOpenChange={(o) => !o && setResult(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Kết quả nhập CSV</DialogTitle>
            <DialogDescription>
              Đã tạo mới {result?.created ?? 0} nguyên liệu.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[50vh] space-y-4 overflow-auto text-sm">
            {!!result?.duplicates.length && (
              <div>
                <p className="font-medium">
                  Bỏ qua do trùng mã ({result.duplicates.length})
                </p>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {result.duplicates.map((code, i) => (
                    <li key={i}>{code}</li>
                  ))}
                </ul>
              </div>
            )}
            {!!result?.invalid.length && (
              <div>
                <p className="font-medium">
                  Dòng lỗi ({result.invalid.length})
                </p>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {result.invalid.map((row, i) => (
                    <li key={i}>
                      Dòng {row.line}: {row.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline">Đóng</Button>} />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default RawMaterialImport;
