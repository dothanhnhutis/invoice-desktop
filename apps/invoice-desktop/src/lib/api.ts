import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

/** Mở hộp thoại chọn thư mục. Trả đường dẫn, hoặc null nếu người dùng huỷ. */
export async function pickFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
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
  errors: InvoiceExportError[];
};

export type ImportResult = {
  created: number;
  duplicates: string[];
  invalid: { line: number; reason: string }[];
};

export type NewCoaInput = {
  raw_material_id: number;
  lot_no: string;
  manufacture_date: string | null;
  expiration_date: string | null;
  file_name: string;
  file_bytes: number[];
};

export type CoaBulkResult = {
  created: number;
  errors: { file_name: string; reason: string }[];
};

export type ExportResult = {
  downloaded: number;
  path: string | null;
  not_found: { line: number; code: string; lot_no: string; reason: string }[];
};

export const api = {
  /** Lấy chi tiết 1 hóa đơn (lazy-load qrcode + hdhhdvu, cache ở DB). */
  getInvoiceDetail: (id: string) =>
    call<Invoice>("get_invoice_detail", { id }),
  /** Tải hóa đơn (XML + PDF) về thư mục `dir`. Trả số tải được + lỗi từng hóa đơn. */
  downloadInvoices: (ids: string[], dir: string) =>
    call<ExportInvoiceResult>("download_invoices", { ids, dir }),
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
  /** Nhập nguyên liệu hàng loạt từ nội dung file CSV (bytes). */
  importRawMaterials: (csvBytes: number[]) =>
    call<ImportResult>("import_raw_materials", { csvBytes }),
  listCoas: (rawMaterialId: number) =>
    call<Coa[]>("list_coas", { rawMaterialId }),
  createCoa: (payload: NewCoaInput) => call<Coa>("create_coa", { payload }),
  /** Tạo nhiều COA cùng lúc (upload cả thư mục). */
  createCoasBulk: (payloads: NewCoaInput[]) =>
    call<CoaBulkResult>("create_coas_bulk", { payloads }),
  readCoaFile: (path: string) => call<number[]>("read_coa_file", { path }),
  openCoaFile: (path: string) => call<void>("open_coa_file", { path }),
  /** Mở 1 file (bytes, chưa lưu) bằng app ngoài để xem trước. */
  openBytesExternal: (fileName: string, fileBytes: number[]) =>
    call<void>("open_bytes_external", { fileName, fileBytes }),
  deleteCoa: (id: number) => call<void>("delete_coa", { id }),
  /** Tải các COA đã chọn về Downloads (1 file: copy; nhiều: .zip). Trả đường dẫn kết quả. */
  downloadCoas: (ids: number[], baseName?: string) =>
    call<string>("download_coas", { ids, baseName }),
  /** Tải COA theo danh sách CSV (code, lot_no, [manufacture_date], [expiration_date]). */
  downloadCoasFromCsv: (csvBytes: number[], baseName?: string) =>
    call<ExportResult>("download_coas_from_csv", { csvBytes, baseName }),
};
