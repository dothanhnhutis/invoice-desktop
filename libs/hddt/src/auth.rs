//! Đăng nhập hoadondientu.gdt.gov.vn — ráp Solver vào luồng login.
//!
//! ⚠️  QUAN TRỌNG VỀ KHÓA TÀI KHOẢN:
//!     Cổng này KHÓA tài khoản sau vài lần đăng nhập SAI (sai mật khẩu).
//!     Vì vậy `login` CHỈ retry khi lỗi trông giống "sai captcha".
//!     Mọi lỗi khác (sai tài khoản/mật khẩu, bị khóa...) -> DỪNG NGAY.
//!     Đừng bao giờ nới lỏng điều này thành "cứ retry mọi lỗi".

use captcha_core::Solver;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::BASE;

#[derive(Deserialize)]
struct CaptchaResp {
    key: String,
    content: String, // SVG
}

#[derive(Serialize)]
struct AuthReq<'a> {
    ckey: &'a str,   // = captcha.key
    cvalue: &'a str, // = mã đã giải
    username: &'a str,
    password: &'a str,
}

#[derive(Deserialize)]
struct AuthOk {
    token: String,
}

#[derive(Debug)]
pub enum LoginError {
    /// Sai tài khoản/mật khẩu hoặc lỗi không rõ -> KHÔNG retry (tránh khóa).
    BadCredentials(String),
    /// Tài khoản bị khóa.
    Locked(String),
    /// Hết số lần thử mà captcha vẫn sai.
    TooManyCaptchaFails,
    /// Lỗi mạng / phản hồi lạ.
    Http(String),
}

impl std::fmt::Display for LoginError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LoginError::BadCredentials(s) => write!(f, "sai tài khoản/mật khẩu hoặc lỗi khác: {s}"),
            LoginError::Locked(s) => write!(f, "tài khoản bị khóa: {s}"),
            LoginError::TooManyCaptchaFails => write!(f, "captcha sai quá số lần cho phép"),
            LoginError::Http(s) => write!(f, "lỗi HTTP: {s}"),
        }
    }
}
impl std::error::Error for LoginError {}

/// Đăng nhập, tự giải captcha, chỉ retry khi sai captcha.
///
/// - `max_attempts`: số captcha tối đa sẽ thử (mỗi lần margin thấp KHÔNG tốn lần
///   nộp nào vì ta bỏ qua trước khi gửi authenticate).
/// - `min_margin`: ngưỡng tin cậy của bộ giải. margin < ngưỡng -> bỏ captcha,
///   lấy cái khác thay vì nộp liều (giảm nguy cơ đếm vào số lần sai).
pub async fn login(
    client: &Client,
    solver: &Solver,
    username: &str,
    password: &str,
    max_attempts: usize,
    min_margin: f32,
) -> Result<String, LoginError> {
    let mut submitted = 0usize; // số lần THỰC SỰ gửi authenticate

    for attempt in 1..=max_attempts {
        // 1) Lấy captcha
        let cap: CaptchaResp = client
            .get(format!("{BASE}/api/captcha"))
            .send()
            .await
            .map_err(|e| LoginError::Http(e.to_string()))?
            .json()
            .await
            .map_err(|e| LoginError::Http(e.to_string()))?;

        // 2) Giải
        let (code, margin) = solver.solve(&cap.content);
        if margin < min_margin {
            println!("[{attempt}] margin thấp ({margin:.3}) cho '{code}' → bỏ, lấy captcha khác");
            continue;
        }

        // 3) Nộp đăng nhập
        submitted += 1;
        let body = AuthReq {
            ckey: &cap.key,
            cvalue: &code,
            username,
            password,
        };
        let resp = client
            .post(format!("{BASE}/api/security-taxpayer/authenticate"))
            .json(&body)
            .send()
            .await
            .map_err(|e| LoginError::Http(e.to_string()))?;

        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();

        // 4) Thành công?
        if status.is_success() {
            if let Ok(ok) = serde_json::from_str::<AuthOk>(&text) {
                println!("[{attempt}] ✅ đăng nhập OK (captcha '{code}', đã nộp {submitted} lần)");
                return Ok(ok.token);
            }
            return Err(LoginError::Http(format!(
                "HTTP 200 nhưng không thấy 'token'. Body: {text}"
            )));
        }

        // 5) Lỗi -> phân loại để quyết định retry hay dừng
        let low = text.to_lowercase();

        let looks_captcha = low.contains("captcha")
            || low.contains("mã xác")     // "mã xác nhận/thực"
            || low.contains("xác nhận")
            || low.contains("sai mã");
        let looks_locked = low.contains("khóa")
            || low.contains("khoá")
            || low.contains("locked")
            || low.contains("bị tạm dừng");

        if looks_captcha && !looks_locked {
            println!("[{attempt}] ✗ sai captcha ('{code}') → thử captcha khác. resp: {text}");
            continue; // AN TOÀN: chỉ lặp ở nhánh này
        }
        if looks_locked {
            return Err(LoginError::Locked(text));
        }

        // Bất kỳ lỗi nào khác (thường là sai user/pass) -> DỪNG để tránh khóa.
        return Err(LoginError::BadCredentials(text));
    }

    Err(LoginError::TooManyCaptchaFails)
}
