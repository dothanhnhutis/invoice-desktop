//! Kiểu dữ liệu nghiệp vụ thuần (không IO) — dùng chung cho store, hddt, desktop.

use serde::{Deserialize, Serialize};

/// Loại hóa đơn theo chiều giao dịch của người dùng.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InvoiceKind {
    /// Hóa đơn mua vào.
    Purchase,
    /// Hóa đơn bán ra.
    Sold,
}

impl InvoiceKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            InvoiceKind::Purchase => "purchase",
            InvoiceKind::Sold => "sold",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "purchase" => Some(InvoiceKind::Purchase),
            "sold" => Some(InvoiceKind::Sold),
            _ => None,
        }
    }
}

/// Một hóa đơn (giữ nguyên tên field thô của cổng GDT).
///
/// `raw_json` giữ nguyên payload gốc từ API để không mất dữ liệu khi các field
/// dưới đây chưa bao phủ hết. Mốc thời gian (`ntao`) để dạng chuỗi ISO đúng như
/// API trả (tránh phụ thuộc lib thời gian ở tầng domain; ISO so sánh chuỗi vẫn
/// đúng thứ tự thời gian).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Invoice {
    /// Khóa chính duy nhất (định danh hóa đơn từ cổng).
    pub id: String,
    /// Loại hóa đơn (mua/bán) — suy ra từ endpoint, không có trong payload.
    pub kind: InvoiceKind,
    /// MST bên bán.
    pub nbmst: String,
    /// Ký hiệu mẫu số hóa đơn.
    pub khmshdon: u8,
    /// Ký hiệu hóa đơn.
    pub khhdon: String,
    /// Số hóa đơn.
    pub shdon: u32,
    /// Đơn vị tiền tệ.
    pub dvtte: String,
    /// Địa chỉ bên bán.
    pub nbdchi: String,
    /// Tên bên bán.
    pub nbten: String,
    /// Tổng tiền chưa thuế.
    pub tgtcthue: f64,
    /// Tổng tiền thuế.
    pub tgtthue: f64,
    /// Tổng tiền thanh toán (bằng số).
    pub tgtttbso: f64,
    /// Thể loại hóa đơn.
    pub tlhdon: String,
    /// Tổng tiền chiết khấu thương mại.
    pub ttcktmai: f64,
    /// Trạng thái.
    pub tthai: u8,
    /// Thông tin xử lý.
    pub ttxly: u8,
    /// Ngày tạo (chuỗi ISO như API trả) — dùng làm mốc sắp xếp/lọc/prune.
    pub ntao: String,
    /// Tên bên mua.
    pub nmten: String,
    /// MST bên mua.
    pub nmmst: String,
    /// Địa chỉ bên mua.
    pub nmdchi: String,
    /// Payload gốc (JSON) từ API.
    pub raw_json: String,
}

/// Điều kiện lọc khi truy vấn cục bộ.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct InvoiceFilter {
    pub kind: Option<InvoiceKind>,
    /// Khoảng ngày (chuỗi so sánh được — dùng chung định dạng với `Invoice::date`).
    pub from: Option<String>,
    pub to: Option<String>,
    pub limit: Option<u32>,
    /// Bỏ qua bao nhiêu dòng (phân trang; chỉ áp dụng khi có `limit`).
    pub offset: Option<u32>,
}

/// Nguyên liệu (nguyên liệu thô). Một nguyên liệu có nhiều COA.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RawMaterial {
    pub id: i64,
    /// Mã nguyên liệu "ICHRM-xxx" (KHÔNG unique — có thể trùng).
    pub code: String,
    pub name: String,
    /// Tên nhà sản xuất (cột TEXT, không tách bảng).
    pub producer: String,
    pub country_of_origin: Option<String>,
    /// Soft delete: None = còn hiệu lực, Some(ISO) = đã xóa.
    pub deleted_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Phiếu kiểm nghiệm (COA — Certificate of Analysis) thuộc về một RawMaterial.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Coa {
    pub id: i64,
    /// Khóa ngoại tới `raw_materials.id`.
    pub raw_material_id: i64,
    pub lot_no: String,
    pub manufacture_date: Option<String>,
    pub expiration_date: Option<String>,
    /// Đường dẫn file COA.
    pub path: Option<String>,
    pub deleted_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Input tạo/sửa nguyên liệu (id + timestamps do DB sinh).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NewRawMaterial {
    pub code: String,
    pub name: String,
    pub producer: String,
    pub country_of_origin: Option<String>,
}

/// Input tạo/sửa COA (id + timestamps do DB sinh).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NewCoa {
    pub raw_material_id: i64,
    pub lot_no: String,
    pub manufacture_date: Option<String>,
    pub expiration_date: Option<String>,
    pub path: Option<String>,
}

/// Lọc danh sách nguyên liệu (tìm theo code HOẶC name — khớp UI search name/code).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RawMaterialFilter {
    /// LIKE %q% trên cả `code` và `name`.
    pub q: Option<String>,
    pub limit: Option<u32>,
    /// Bỏ qua bao nhiêu dòng (dùng cho phân trang; chỉ áp dụng khi có `limit`).
    pub offset: Option<u32>,
}

/// Kết quả một trang: dữ liệu trang hiện tại + tổng số bản ghi khớp bộ lọc.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Paged<T> {
    pub data: Vec<T>,
    pub total: i64,
}

/// Tiến độ đồng bộ (một dòng duy nhất trong DB).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SyncState {
    /// Ngày cũ nhất đã tải (mốc backfill). None = chưa tải gì.
    pub oldest_date: Option<String>,
    /// Ngày mới nhất đã tải (mốc incremental).
    pub newest_date: Option<String>,
    /// Đã backfill hết quá khứ chưa.
    pub backfill_done: bool,
    /// Lần đồng bộ gần nhất (unix seconds).
    pub last_sync_at: Option<i64>,
}
