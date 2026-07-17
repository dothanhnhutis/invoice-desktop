//! Gọi API tra cứu hóa đơn (cần token từ [`crate::login`]).

use domain::{Invoice, InvoiceKind};
use reqwest::Client;
use serde::Deserialize;

use crate::BASE;

const SIZE: u32 = 50; // max của cổng

/// Một trang kết quả truy vấn.
pub struct Page {
    pub invoices: Vec<Invoice>,
    /// Cursor cho trang kế; dùng làm `state` ở lần gọi sau. `None`/rỗng = hết.
    pub next_state: Option<String>,
    /// Tổng số bản ghi khớp bộ lọc (theo cổng trả về).
    pub total: u64,
}

#[derive(Debug)]
pub enum QueryError {
    /// Token hết hạn/không hợp lệ (HTTP 401) — caller nên login lại.
    Unauthorized,
    /// Lỗi mạng / HTTP khác.
    Http(String),
    /// Phản hồi không parse được.
    Parse(String),
}

impl std::fmt::Display for QueryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            QueryError::Unauthorized => write!(f, "token không hợp lệ (401)"),
            QueryError::Http(s) => write!(f, "lỗi HTTP: {s}"),
            QueryError::Parse(s) => write!(f, "lỗi parse phản hồi: {s}"),
        }
    }
}
impl std::error::Error for QueryError {}

#[derive(Deserialize)]
struct RawPage {
    #[serde(default)]
    datas: Vec<serde_json::Value>,
    state: Option<String>,
    #[serde(default)]
    total: u64,
}

/// Lấy 1 trang hóa đơn MUA VÀO trong khoảng ngày `[from, to]` (định dạng
/// `dd/MM/yyyyTHH:mm:ss`). `state` = cursor trang kế (None cho trang đầu).
/// Chỉ lấy hóa đơn đã xử lý xong (`ttxly==5`).
pub async fn query_purchase(
    client: &Client,
    token: &str,
    from: &str,
    to: &str,
    state: Option<&str>,
) -> Result<Page, QueryError> {
    let search = format!("tdlap=ge={from};tdlap=le={to};ttxly==5");
    let mut params: Vec<(&str, String)> = vec![
        ("sort", "tdlap:desc".into()),
        ("size", SIZE.to_string()),
        ("search", search),
    ];
    if let Some(s) = state {
        params.push(("state", s.to_string()));
    }

    let url = reqwest::Url::parse_with_params(
        &format!("{BASE}/api/query/invoices/purchase"),
        &params,
    )
    .map_err(|e| QueryError::Http(e.to_string()))?;

    let resp = client
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| QueryError::Http(e.to_string()))?;

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(QueryError::Unauthorized);
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(QueryError::Http(format!("{status}: {body}")));
    }

    let raw: RawPage = resp
        .json()
        .await
        .map_err(|e| QueryError::Parse(e.to_string()))?;
    let invoices = raw.datas.iter().filter_map(map_purchase).collect();
    let next_state = raw.state.filter(|s| !s.is_empty());
    Ok(Page {
        invoices,
        next_state,
        total: raw.total,
    })
}

/// Lấy thông tin người nộp thuế đang đăng nhập. Trả JSON raw (frontend tự dùng field cần).
pub async fn profile(client: &Client, token: &str) -> Result<serde_json::Value, QueryError> {
    let resp = client
        .get(format!("{BASE}/api/security-taxpayer/profile"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| QueryError::Http(e.to_string()))?;

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(QueryError::Unauthorized);
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(QueryError::Http(format!("{status}: {body}")));
    }
    resp.json()
        .await
        .map_err(|e| QueryError::Parse(e.to_string()))
}

/// Map 1 record JSON hóa đơn mua vào -> [`Invoice`]. Bỏ qua record thiếu `id`.
fn map_purchase(v: &serde_json::Value) -> Option<Invoice> {
    let id = v.get("id")?.as_str()?.to_string();
    let str_field = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();

    let khhdon = str_field("khhdon");
    let shdon = v
        .get("shdon")
        .map(|x| x.as_i64().map(|n| n.to_string()).unwrap_or_else(|| str_field("shdon")))
        .unwrap_or_default();

    Some(Invoice {
        id,
        kind: InvoiceKind::Purchase,
        seller_tax: str_field("nbmst"),
        buyer_tax: str_field("nmmst"),
        invoice_no: format!("{khhdon}-{shdon}"),
        date: str_field("tdlap"),
        total: v.get("tgtttbso").and_then(|x| x.as_f64()).unwrap_or(0.0).round() as i64,
        raw_json: v.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_purchase_extracts_key_fields() {
        let v: serde_json::Value = serde_json::json!({
            "id": "740edf6f-1445-41de-9f21-746bd419f0b6",
            "nbmst": "0109266456",
            "nmmst": "2200773307",
            "khhdon": "C25TAC",
            "shdon": 6033492,
            "tdlap": "2025-12-01T17:00:00Z",
            "tgtttbso": 38500.0
        });
        let inv = map_purchase(&v).expect("map ra Invoice");
        assert_eq!(inv.id, "740edf6f-1445-41de-9f21-746bd419f0b6");
        assert_eq!(inv.seller_tax, "0109266456");
        assert_eq!(inv.buyer_tax, "2200773307");
        assert_eq!(inv.invoice_no, "C25TAC-6033492");
        assert_eq!(inv.date, "2025-12-01T17:00:00Z");
        assert_eq!(inv.total, 38500);
        assert_eq!(inv.kind, InvoiceKind::Purchase);
    }

    #[test]
    fn map_purchase_skips_record_without_id() {
        let v = serde_json::json!({ "nbmst": "0109266456" });
        assert!(map_purchase(&v).is_none());
    }
}
