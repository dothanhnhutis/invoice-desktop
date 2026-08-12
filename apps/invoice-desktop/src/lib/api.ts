import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

/** Mở hộp thoại chọn thư mục. Trả đường dẫn, hoặc null nếu người dùng huỷ. */
export async function pickFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}

/**
 * Mở hộp thoại chọn 1 file, trả ĐƯỜNG DẪN (không đọc bytes) — dùng khi file có thể rất lớn:
 * đẩy bytes qua cầu IPC bị mã hoá thành mảng số JSON (~4× dung lượng).
 */
export async function pickFile(
  name: string,
  extensions: string[],
): Promise<string | null> {
  const selected = await open({
    multiple: false,
    filters: [{ name, extensions }],
  });
  return typeof selected === "string" ? selected : null;
}

/** Mở hộp thoại chọn NHIỀU file, trả danh sách đường dẫn (rỗng khi huỷ). */
export async function pickFiles(
  name: string,
  extensions: string[],
): Promise<string[]> {
  const selected = await open({
    multiple: true,
    filters: [{ name, extensions }],
  });
  return Array.isArray(selected) ? selected : [];
}

export class ApiError extends Error {
  constructor(
    public readonly kind: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type RustErrorShape = {
  kind: string;
  message?: string;
  status?: number;
};

async function call<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    if (typeof e === "object" && e !== null && "kind" in e) {
      const err = e as RustErrorShape;
      throw new ApiError(err.kind, err.message ?? err.kind);
    }
    throw new ApiError(
      "Unknown",
      typeof e === "string" ? e : JSON.stringify(e),
    );
  }
}

export type UserProfile = {
  password: string;
  username: string;
  authorities: {
    authority: string;
  }[];
  accountNonExpired: boolean;
  accountNonLocked: boolean;
  credentialsNonExpired: boolean;
  enabled: boolean;
  id: string;
  type: 2;
  groupId: string;
  groupIds: string;
  tinInfoTT86: {
    mst: string;
    mstUTien: string;
    dsMst: string[];
    cccd: boolean;
    groupIds: string;
    doiUng: boolean;
  };
  tcqt: string;
  name: string;
  capCqt: number;
  capUser: number;
  roleIds: string[];
  cdanh: string | null;
  domain: string | null;
  cbo: string;
  fullName: string | null;
  password_expire: string;
  expired: number;
};

export type RawMaterial = {
  id: number;
  code: string;
  name: string;
  producer: string;
  country_of_origin: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type NewRawMaterial = {
  code: string;
  name: string;
  producer: string;
  country_of_origin: string | null;
};

export type Paged<T> = {
  data: T[];
  total: number;
};

export type Coa = {
  id: number;
  raw_material_id: number;
  lot_no: string;
  manufacture_date: string | null;
  expiration_date: string | null;
  path: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

// Khớp domain::Invoice (field thô GDT). `qrcode`/`hdhhdvu` null tới khi lazy-load chi tiết.
export type Invoice = {
  id: string;
  kind: string;
  nbmst: string;
  khmshdon: number;
  khhdon: string;
  shdon: number;
  dvtte: string;
  nbdchi: string;
  nbten: string;
  tgtcthue: number;
  tgtthue: number;
  tgtttbso: number;
  tlhdon: string;
  ttcktmai: number;
  tthai: number;
  ttxly: number;
  ntao: string;
  nmten: string;
  nmmst: string;
  nmdchi: string;
  raw_json: string;
  qrcode: string | null;
  hdhhdvu: string | null; // JSON thô, cần JSON.parse thành InvoiceLine[]
};

// Trường phụ mỗi dòng hàng (Số lô, Hạn dùng, Ghi chú dòng...).
export type InvoiceLineExtra = {
  ttruong: string;
  kdlieu: string;
  dlieu: string | null;
};

// 1 phần tử của `hdhhdvu` sau JSON.parse.
export type InvoiceLine = {
  stt: number;
  ten: string;
  dvtinh: string | null;
  sluong: number | null;
  dgia: number | null;
  thtien: number | null;
  ltsuat: string | null;
  ttkhac: InvoiceLineExtra[] | null;
};

export type InvoiceExportError = {
  id: string;
  label: string;
  reason: string;
};

export type ExportInvoiceResult = {
  downloaded: number;
  dir: string;
  path: string | null; // file .zip khi tải nhiều hoá đơn; null khi chép rời
  errors: InvoiceExportError[];
};

export type InvoiceCsvError = {
  line: number;
  label: string;
  reason: string;
};

export type InvoiceCsvResult = {
  downloaded: number;
  path: string | null; // file .zip (hoặc file đơn) đã ghi
  errors: InvoiceCsvError[];
};

// Payload sự kiện "invoice-csv://progress" phát từ download_invoices_from_csv.
export type InvoiceCsvProgress = {
  done: number;
  total: number;
  label: string;
};

/** 1 file COA ứng viên (chưa lưu) do `scan_coa_files` trả về. */
export type CoaFileEntry = {
  path: string;
  name: string;
};

/** 1 dòng trong bảng nhập COA hàng loạt: đường dẫn file gốc + số lô/ngày đã gõ. */
export type CoaPathInput = {
  path: string;
  lot_no: string;
  manufacture_date: string | null;
  expiration_date: string | null;
};

export type CoaBulkResult = {
  created: number;
  errors: { file_name: string; reason: string }[];
};

// Khớp struct SyncState phía Rust (get_sync_status).
export type SyncState = {
  oldest_date: string | null;
  newest_date: string | null;
  backfill_done: boolean;
  last_sync_at: number | null; // epoch giây
};

export type ExportResult = {
  downloaded: number;
  path: string | null;
  not_found: { line: number; code: string; lot_no: string; reason: string }[];
};

export type BackupResult = {
  raw_materials: number;
  coas: number;
  missing_files: string[]; // COA có bản ghi nhưng file đã mất trên đĩa
  path: string;
};

export type RestoreResult = {
  materials_created: number;
  materials_matched: number;
  coas_added: number;
  coas_skipped: number;
  errors: { code: string; lot_no: string; reason: string }[];
};

export const api = {
  /** Lấy chi tiết 1 hóa đơn (lazy-load qrcode + hdhhdvu, cache ở DB). */
  getInvoiceDetail: (id: string) =>
    call<Invoice>("get_invoice_detail", { id }),
  /**
   * Tải hóa đơn (XML + PDF) về thư mục `dir`: 1 hoá đơn → 2 file rời, nhiều hoá đơn → 1 file
   * `.zip` (tên do backend tự đặt, trả ở `path`). Trả số tải được + lỗi từng hóa đơn.
   */
  downloadInvoices: (ids: string[], dir: string) =>
    call<ExportInvoiceResult>("download_invoices", { ids, dir }),
  /**
   * Tải hàng loạt hóa đơn theo CSV `nbmst,khhdon,shdon[,khmshdon]` về thư mục `dir`.
   * Không cần hóa đơn có sẵn trong DB. Nhiều hơn 1 file thì nén thành `<baseName>.zip`.
   */
  downloadInvoicesFromCsv: (
    csvBytes: number[],
    baseName: string,
    dir: string,
  ) =>
    call<InvoiceCsvResult>("download_invoices_from_csv", {
      csvBytes,
      baseName,
      dir,
    }),
  listRawMaterials: (
    {
      q,
      page = 0,
      pageSize = 10,
    }: { q?: string; page?: number; pageSize?: number } = {},
  ) =>
    call<Paged<RawMaterial>>("list_raw_materials", {
      filter: { q, limit: pageSize, offset: page * pageSize },
    }),
  getRawMaterialById: (id: number) =>
    call<RawMaterial>("get_raw_material_by_id", { id }),
  createRawMaterial: (input: NewRawMaterial) =>
    call<RawMaterial>("create_raw_material", { input }),
  updateRawMaterial: (id: number, input: NewRawMaterial) =>
    call<RawMaterial>("update_raw_material", { id, input }),
  listCoas: (rawMaterialId: number) =>
    call<Coa[]>("list_coas", { rawMaterialId }),
  /** Quét file/thư mục (kéo-thả hoặc hộp thoại) → danh sách file COA hợp lệ, đã khử trùng. */
  scanCoaFiles: (paths: string[]) =>
    call<CoaFileEntry[]>("scan_coa_files", { paths }),
  /** Tạo nhiều COA cùng lúc từ đường dẫn — Rust tự đọc bytes, không đẩy file qua IPC. */
  createCoasBulkFromPaths: (rawMaterialId: number, items: CoaPathInput[]) =>
    call<CoaBulkResult>("create_coas_bulk_from_paths", { rawMaterialId, items }),
  readCoaFile: (path: string) => call<number[]>("read_coa_file", { path }),
  openCoaFile: (path: string) => call<void>("open_coa_file", { path }),
  /** Mở 1 file theo đường dẫn tuyệt đối (COA chưa lưu) bằng app ngoài để xem trước. */
  openPathExternal: (path: string) => call<void>("open_path_external", { path }),
  deleteCoa: (id: number) => call<void>("delete_coa", { id }),
  /** Tải các COA đã chọn về thư mục `dir` (1 file: copy; nhiều: .zip). Trả đường dẫn kết quả. */
  downloadCoas: (ids: number[], baseName: string | undefined, dir: string) =>
    call<string>("download_coas", { ids, baseName, dir }),
  /** Tải COA theo danh sách CSV (code, lot_no, [manufacture_date], [expiration_date]) về `dir`. */
  downloadCoasFromCsv: (
    csvBytes: number[],
    baseName: string | undefined,
    dir: string,
  ) => call<ExportResult>("download_coas_from_csv", { csvBytes, baseName, dir }),
  /** Sao lưu toàn bộ Nguyên liệu & COA ra 1 file .zip trong thư mục `dir`. */
  backupCoas: (dir: string) => call<BackupResult>("backup_coas", { dir }),
  /** Nạp file sao lưu: GỘP THÊM, không xoá gì; COA trùng thì bỏ qua. */
  restoreCoas: (zipPath: string) =>
    call<RestoreResult>("restore_coas", { zipPath }),
  /** Cờ bật/tắt module Quản lý nguyên liệu & COA. */
  getFeatureRawMaterials: () => call<boolean>("get_feature_raw_materials"),
  /** Bật/tắt module. Khi tắt (false) backend xoá hết dữ liệu + file COA. */
  setFeatureRawMaterials: (enabled: boolean) =>
    call<void>("set_feature_raw_materials", { enabled }),
  /** Cờ bật module hoá đơn ⟺ có credential GDT. */
  getFeatureInvoice: () => call<boolean>("has_credentials"),
  /** Tắt module hoá đơn: xoá credential + hoá đơn (giữ settings), dừng sync. */
  disableInvoices: () => call<void>("disable_invoices"),
  /** Trạng thái đồng bộ (khoảng đã tải, backfill, lần đồng bộ gần nhất). */
  getSyncStatus: () => call<SyncState>("get_sync_status"),
  /** Luồng nền có đang chạy 1 lượt đồng bộ không. */
  isSyncing: () => call<boolean>("is_syncing"),
  /** MST đã lưu ở keychain; null nếu chưa đăng nhập. */
  getUsername: () => call<string | null>("get_username"),
  /** Mốc dừng backfill hiện tại (yyyy-MM-dd). */
  getFloor: () => call<string>("get_floor"),
};

/** QueryKey chung cho cờ tính năng nguyên liệu & COA (dùng ở sidebar + settings). */
export const FEATURE_RAW_MATERIALS_KEY = ["feature", "raw_materials"] as const;
/** QueryKey chung cho cờ module hoá đơn (dùng ở sidebar + settings + guard). */
export const FEATURE_INVOICE_KEY = ["feature", "invoice"] as const;
/** QueryKey trạng thái đồng bộ (trang Cài đặt tính năng). */
export const SYNC_STATUS_KEY = ["sync_status"] as const;
/** QueryKey MST + mốc floor đã lưu. */
export const CREDENTIAL_USERNAME_KEY = ["credential", "username"] as const;
export const FLOOR_KEY = ["floor"] as const;
