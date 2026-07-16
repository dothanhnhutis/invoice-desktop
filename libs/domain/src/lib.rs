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

/// Một hóa đơn đã chuẩn hóa để lưu/truy vấn cục bộ.
///
/// `raw_json` giữ nguyên payload gốc từ API để không mất dữ liệu khi các field
/// chuẩn hóa (dưới đây) chưa bao phủ hết. Ngày để dạng chuỗi ISO/`dd/MM/yyyy`
/// đúng như API trả (tránh phụ thuộc lib thời gian ở tầng domain).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Invoice {
    /// Khóa chính duy nhất (định danh hóa đơn từ cổng).
    pub id: String,
    pub kind: InvoiceKind,
    pub seller_tax: String,
    pub buyer_tax: String,
    pub invoice_no: String,
    /// Ngày lập (chuỗi như API trả).
    pub date: String,
    pub total: i64,
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
