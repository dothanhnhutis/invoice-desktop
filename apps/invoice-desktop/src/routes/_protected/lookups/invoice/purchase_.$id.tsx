import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import { api, pickFolder, type InvoiceLine } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute(
  "/_protected/lookups/invoice/purchase_/$id",
)({
  component: RouteComponent,
});

const vnd = (n: number | null | undefined) =>
  typeof n === "number" ? n.toLocaleString("vi-VN") : "-";

/** ISO datetime -> dd/mm/yyyy theo giờ VN. */
function vnDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "-"
    : d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

/** Đọc 1 trường phụ theo tên (Số lô, Hạn dùng...) trong `ttkhac` của 1 dòng hàng. */
function lineExtra(line: InvoiceLine, ttruong: string): string {
  const hit = line.ttkhac?.find((x) => x.ttruong === ttruong);
  return hit?.dlieu ?? "-";
}

function parseLines(hdhhdvu: string | null): InvoiceLine[] {
  if (!hdhhdvu) return [];
  try {
    const arr = JSON.parse(hdhhdvu);
    return Array.isArray(arr) ? (arr as InvoiceLine[]) : [];
  } catch {
    return [];
  }
}

/** Bóc field ngoài struct Invoice (tdlap, mhdon...) từ raw_json. */
function parseRaw(rawJson: string | null | undefined): Record<string, unknown> {
  if (!rawJson) return {};
  try {
    const v = JSON.parse(rawJson);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Đọc số tiền từ mảng `ttttkhac` theo tên trường (vd "Tổng tiền phí"). null nếu không có. */
function totalExtra(
  raw: Record<string, unknown>,
  ttruong: string,
): number | null {
  const arr = raw.ttttkhac;
  if (!Array.isArray(arr)) return null;
  const hit = arr.find(
    (x) =>
      x &&
      typeof x === "object" &&
      (x as { ttruong?: string }).ttruong === ttruong,
  ) as { dlieu?: unknown } | undefined;
  const n = Number(hit?.dlieu);
  return Number.isFinite(n) ? n : null;
}

function RouteComponent() {
  const { id } = Route.useParams();

  // Lazy-load: lần đầu gọi API detail (spinner), lần sau lấy từ cache DB.
  const detail = useQuery({
    queryKey: ["invoice-detail", id],
    queryFn: () => api.getInvoiceDetail(id),
  });

  const [downloading, setDownloading] = useState(false);

  const inv = detail.data;
  const lines = parseLines(inv?.hdhhdvu ?? null);
  const raw = parseRaw(inv?.raw_json);
  const tdlap = typeof raw.tdlap === "string" ? raw.tdlap : null;
  const mhdon = typeof raw.mhdon === "string" ? raw.mhdon : null;

  const onDownload = async () => {
    const dir = await pickFolder();
    if (!dir) return;
    setDownloading(true);
    try {
      const res = await api.downloadInvoices([id], dir);
      if (res.downloaded > 0) toast.success("Đã tải hoá đơn (XML + PDF)");
      if (res.errors.length) toast.error(`Lỗi: ${res.errors[0].reason}`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDownloading(false);
    }
  };
  const tgtphi =
    typeof raw.tgtphi === "number"
      ? raw.tgtphi
      : totalExtra(raw, "Tổng tiền phí");

  return (
    <div className="container mx-auto flex flex-col gap-4 p-4">
      {detail.isLoading && (
        <div className="flex items-center gap-2 rounded-xl border p-4 text-sm text-muted-foreground">
          <Spinner /> Đang tải chi tiết hóa đơn…
        </div>
      )}

      {detail.isError && (
        <div className="rounded-xl border border-red-500 bg-red-500/10 p-3 text-sm text-red-500">
          Lỗi tải chi tiết: {String(detail.error)}
        </div>
      )}

      {inv && (
        <div className="flex flex-col gap-6 rounded-xl border p-6">
          {/* Hàng đầu: QR bên trái, mẫu số/ký hiệu/số HĐ bên phải */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              {inv.qrcode ? (
                <div className="inline-block rounded-lg bg-white p-2">
                  <QRCodeSVG value={inv.qrcode} size={80} />
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Không có mã QR
                </div>
              )}
            </div>
            <div className="text-sm sm:text-right">
              <p>
                Mẫu số: <b>{inv.khmshdon}</b>
              </p>
              <p>
                Ký hiệu HĐ: <b>{inv.khhdon}</b>
              </p>
              <p>
                Số HĐ: <b>{inv.shdon}</b>
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                disabled={downloading}
                onClick={onDownload}
              >
                {downloading ? <Spinner /> : <DownloadIcon />}
                Tải xuống (XML + PDF)
              </Button>
            </div>
          </div>

          {/* Tiêu đề + ngày lập + MCCQT (căn giữa) */}
          <div className="text-center">
            <h1 className="text-xl font-bold uppercase">{inv.tlhdon}</h1>
            <p className="text-sm text-muted-foreground">
              Ngày lập: {vnDate(tdlap)}
            </p>
            {mhdon && (
              <p className="text-sm break-all text-muted-foreground">
                MCCQT: {mhdon}
              </p>
            )}
          </div>

          {/* Bên bán & bên mua */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border p-4 text-sm">
              <p className="font-semibold">Người bán</p>
              <p>{inv.nbten}</p>
              <p className="text-muted-foreground">MST: {inv.nbmst}</p>
              <p className="text-muted-foreground">{inv.nbdchi}</p>
            </div>
            <div className="rounded-lg border p-4 text-sm">
              <p className="font-semibold">Người mua</p>
              <p>{inv.nmten}</p>
              <p className="text-muted-foreground">MST: {inv.nmmst}</p>
              <p className="text-muted-foreground">{inv.nmdchi}</p>
            </div>
          </div>

          {/* Danh sách hàng hoá, dịch vụ */}
          <div className="rounded-lg border">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-center">STT</TableHead>
                    <TableHead>Tên hàng hóa, dịch vụ</TableHead>
                    <TableHead className="text-center">ĐVT</TableHead>
                    <TableHead className="text-center">Số lượng</TableHead>
                    <TableHead className="text-right">Đơn giá</TableHead>
                    <TableHead className="text-right">Thành tiền</TableHead>
                    <TableHead className="text-center">Thuế suất</TableHead>
                    <TableHead className="text-center">Số lô</TableHead>
                    <TableHead className="text-center">Hạn dùng</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={9}
                        className="text-center text-muted-foreground"
                      >
                        Không có dòng hàng.
                      </TableCell>
                    </TableRow>
                  ) : (
                    lines.map((line, i) => (
                      <TableRow key={line.stt ?? i}>
                        <TableCell className="text-center">
                          {line.stt}
                        </TableCell>
                        <TableCell className="text-wrap">{line.ten}</TableCell>
                        <TableCell className="text-center">
                          {line.dvtinh || "-"}
                        </TableCell>
                        <TableCell className="text-center">
                          {line.sluong ?? "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          {vnd(line.dgia)}
                        </TableCell>
                        <TableCell className="text-right">
                          {vnd(line.thtien)}
                        </TableCell>
                        <TableCell className="text-center">
                          {line.ltsuat || "-"}
                        </TableCell>
                        <TableCell className="text-center">
                          {lineExtra(line, "Số lô")}
                        </TableCell>
                        <TableCell className="text-center">
                          {lineExtra(line, "Hạn dùng")}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Khối tổng tiền */}
          <div className="ml-auto w-full max-w-sm space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Đơn vị tiền tệ:</span>
              <span>{inv.dvtte}</span>
            </div>
            <div className="flex justify-between">
              <span>Tổng tiền chưa thuế:</span>
              <span>{vnd(inv.tgtcthue)}</span>
            </div>
            <div className="flex justify-between">
              <span>Tổng tiền thuế:</span>
              <span>{vnd(inv.tgtthue)}</span>
            </div>
            <div className="flex justify-between">
              <span>Tổng tiền phí:</span>
              <span>{vnd(tgtphi)}</span>
            </div>
            <div className="flex justify-between">
              <span>Chiết khấu thương mại:</span>
              <span>{vnd(inv.ttcktmai)}</span>
            </div>
            <div className="flex justify-between border-t pt-1 font-bold">
              <span>Tổng thanh toán:</span>
              <span>{vnd(inv.tgtttbso)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
