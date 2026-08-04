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
/// Lấy TẤT CẢ trạng thái xử lý (không lọc `ttxly`).
pub async fn query_purchase(
    client: &Client,
    token: &str,
    from: &str,
    to: &str,
    state: Option<&str>,
) -> Result<Page, QueryError> {
    let search = format!("tdlap=ge={from};tdlap=le={to}");
    let mut params: Vec<(&str, String)> = vec![
        ("sort", "tdlap:desc".into()),
        ("size", SIZE.to_string()),
        ("search", search),
    ];
    if let Some(s) = state {
        params.push(("state", s.to_string()));
    }

    let url =
        reqwest::Url::parse_with_params(&format!("{BASE}/api/query/invoices/purchase"), &params)
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

/// Lấy CHI TIẾT 1 hóa đơn (gồm `qrcode` + mảng dòng hàng `hdhhdvu`).
/// Trả JSON raw để caller tự trích field cần (không map sang struct).
pub async fn query_detail(
    client: &Client,
    token: &str,
    nbmst: &str,
    khhdon: &str,
    shdon: &str,
    khmshdon: &str,
) -> Result<serde_json::Value, QueryError> {
    let url = reqwest::Url::parse_with_params(
        &format!("{BASE}/api/query/invoices/detail"),
        &[
            ("nbmst", nbmst),
            ("khhdon", khhdon),
            ("shdon", shdon),
            ("khmshdon", khmshdon),
        ],
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
    resp.json()
        .await
        .map_err(|e| QueryError::Parse(e.to_string()))
}

/// Tải bản thể hiện hóa đơn (ZIP gồm invoice.html/xml + asset) từ cổng GDT.
/// Trả về nguyên bytes ZIP để caller tự giải nén.
pub async fn export_html(
    client: &Client,
    token: &str,
    nbmst: &str,
    khhdon: &str,
    shdon: &str,
    khmshdon: &str,
) -> Result<Vec<u8>, QueryError> {
    let url = reqwest::Url::parse_with_params(
        &format!("{BASE}/api/query/invoices/export-xml"),
        &[
            ("nbmst", nbmst),
            ("khhdon", khhdon),
            ("shdon", shdon),
            ("khmshdon", khmshdon),
        ],
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
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| QueryError::Http(e.to_string()))?;
    Ok(bytes.to_vec())
}

/// Map 1 record JSON hóa đơn mua vào -> [`Invoice`]. Bỏ qua record thiếu `id`.
fn map_purchase(v: &serde_json::Value) -> Option<Invoice> {
    let id = v.get("id")?.as_str()?.to_string();
    // Trích field theo kiểu, mặc định an toàn khi thiếu/sai kiểu.
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let f = |k: &str| v.get(k).and_then(|x| x.as_f64()).unwrap_or(0.0);
    let u = |k: &str| v.get(k).and_then(|x| x.as_u64()).unwrap_or(0);

    Some(Invoice {
        id,
        kind: InvoiceKind::Purchase,
        nbmst: s("nbmst"),
        khmshdon: u("khmshdon") as u8,
        khhdon: s("khhdon"),
        shdon: u("shdon") as u32,
        dvtte: s("dvtte"),
        nbdchi: s("nbdchi"),
        nbten: s("nbten"),
        tgtcthue: f("tgtcthue"),
        tgtthue: f("tgtthue"),
        tgtttbso: f("tgtttbso"),
        tlhdon: s("tlhdon"),
        ttcktmai: f("ttcktmai"),
        tthai: u("tthai") as u8,
        ttxly: u("ttxly") as u8,
        ntao: s("ntao"),
        nmten: s("nmten"),
        nmmst: s("nmmst"),
        nmdchi: s("nmdchi"),
        raw_json: v.to_string(),
        // Chi tiết (QR + dòng hàng) không có trong danh sách -> lazy-load qua `query_detail`.
        qrcode: None,
        hdhhdvu: None,
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
            "khmshdon": 1,
            "khhdon": "C25TAC",
            "shdon": 6033492,
            "tgtcthue": 35000.0,
            "tgtthue": 3500.0,
            "tgtttbso": 38500.0,
            "tthai": 1,
            "ttxly": 5,
            "ntao": "2025-12-01T17:00:00Z"
        });
        let inv = map_purchase(&v).expect("map ra Invoice");
        assert_eq!(inv.id, "740edf6f-1445-41de-9f21-746bd419f0b6");
        assert_eq!(inv.nbmst, "0109266456");
        assert_eq!(inv.nmmst, "2200773307");
        assert_eq!(inv.khmshdon, 1);
        assert_eq!(inv.khhdon, "C25TAC");
        assert_eq!(inv.shdon, 6033492);
        assert_eq!(inv.tgtttbso, 38500.0);
        assert_eq!(inv.ttxly, 5);
        assert_eq!(inv.ntao, "2025-12-01T17:00:00Z");
        assert_eq!(inv.kind, InvoiceKind::Purchase);
    }

    #[test]
    fn map_purchase_skips_record_without_id() {
        let v = serde_json::json!({ "nbmst": "0109266456" });
        assert!(map_purchase(&v).is_none());
    }
}
