import React from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLinkIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { api, type Coa } from "@/lib/api";

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif", "bmp"];

function mimeFor(ext: string): string {
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg") return "image/jpeg";
  if (IMAGE_EXTS.includes(ext)) return `image/${ext}`;
  return "application/octet-stream";
}

export type CoaViewerSheetProps = {
  coa: Coa | null;
  onOpenChange: (open: boolean) => void;
};

export default function CoaViewerSheet({
  coa,
  onOpenChange,
}: CoaViewerSheetProps) {
  const open = !!coa;
  const path = coa?.path ?? null;
  const ext = path ? (path.split(".").pop() ?? "").toLowerCase() : "";
  const isImage = IMAGE_EXTS.includes(ext);
  const isPdf = ext === "pdf";

  const fileQuery = useQuery({
    queryKey: ["coa_file", path],
    queryFn: () => api.readCoaFile(path!),
    enabled: open && !!path,
  });

  const url = React.useMemo(() => {
    if (!fileQuery.data) return null;
    const blob = new Blob([new Uint8Array(fileQuery.data)], {
      type: mimeFor(ext),
    });
    return URL.createObjectURL(blob);
  }, [fileQuery.data, ext]);

  React.useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  const openExternal = () => {
    if (path) api.openCoaFile(path);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="p-0 gap-0"
        style={{ width: "92vw", maxWidth: "900px" }}
      >
        <SheetHeader className="border-b">
          <SheetTitle>COA — Số lô {coa?.lot_no ?? ""}</SheetTitle>
          <SheetDescription className="truncate">{path ?? ""}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 min-h-0 bg-muted/30">
          {fileQuery.isLoading && (
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          )}
          {fileQuery.isError && (
            <div className="flex h-full items-center justify-center p-4 text-destructive">
              Không đọc được file COA.
            </div>
          )}
          {url && isPdf && (
            <iframe
              src={url}
              title="COA"
              className="h-full w-full border-0"
            />
          )}
          {url && isImage && (
            <div className="h-full overflow-auto p-4 flex items-start justify-center">
              <img src={url} alt="COA" className="max-w-full h-auto" />
            </div>
          )}
          {url && !isPdf && !isImage && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
              <p className="text-muted-foreground">
                Không xem trước được định dạng này.
              </p>
              <Button variant="outline" onClick={openExternal}>
                <ExternalLinkIcon />
                Mở bằng ứng dụng ngoài
              </Button>
            </div>
          )}
        </div>

        <SheetFooter className="border-t">
          <Button variant="outline" onClick={openExternal}>
            <ExternalLinkIcon />
            Mở bằng ứng dụng ngoài
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
