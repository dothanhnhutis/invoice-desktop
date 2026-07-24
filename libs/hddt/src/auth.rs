//! Đăng nhập hoadondientu.gdt.gov.vn — ráp Solver vào luồng login.
//!
//! ⚠️  QUAN TRỌNG VỀ KHÓA TÀI KHOẢN:
//!     Cổng này KHÓA tài khoản sau vài lần đăng nhập SAI (sai mật khẩu).
//!     Vì vậy `login` CHỈ retry khi lỗi trông giống "sai captcha".
//!     Mọi lỗi khác (sai tài khoản/mật khẩu, bị khóa...) -> DỪNG NGAY.
//!     Đừng bao giờ nới lỏng điều này thành "cứ retry mọi lỗi".

use base64::Engine;
use captcha_core::Solver;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::BASE;

/// Số giây từ epoch tới bây giờ (dùng để so với claim `exp` của JWT).
fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Đọc claim `exp` (unix giây) của một JWT `header.payload.signature`.
/// `None` nếu không phải JWT hợp lệ / không có `exp`. KHÔNG xác minh chữ ký
/// (chỉ để biết hạn — máy chủ mới là bên xác minh).
pub fn token_expiry(token: &str) -> Option<i64> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()?;
    #[derive(Deserialize)]
    struct Claims {
        exp: i64,
    }
    serde_json::from_slice::<Claims>(&bytes).ok().map(|c| c.exp)
}

/// True nếu token đã hết hạn, hoặc còn dưới `skew_secs`, HOẶC không đọc được `exp`.
/// Không đọc được -> coi như hết hạn để buộc login mới (mặc định AN TOÀN).
pub fn is_expired(token: &str, skew_secs: i64) -> bool {
    match token_expiry(token) {
        Some(exp) => now_unix() + skew_secs >= exp,
        None => true,
    }
}

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

/// Thân lỗi JSON của cổng khi `authenticate` thất bại:
/// `{"timestamp":"24/07/2026 10:00:44","message":"...","details":"","path":"uri=/authenticate"}`
///
/// Các `message` thật đã biết (dùng để phân loại ở [`classify`]):
/// - `"Mã captcha không đúng."` → sai captcha, AN TOÀN để thử captcha khác.
/// - `"Tài khoản đã bị khoá vì đã nhập sai thông tin quá số lần quy định."` → bị khóa.
/// - `"Tên đăng nhập hoặc mật khẩu không đúng"` → sai tài khoản/mật khẩu (KHÔNG retry).
#[derive(Deserialize, Debug)]
pub struct AuthErr {
    #[serde(default)]
    pub timestamp: String,
    pub message: String,
    #[serde(default)]
    pub details: String,
    #[serde(default)]
    pub path: String,
}

impl std::fmt::Display for AuthErr {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)?;
        if !self.details.is_empty() {
            write!(f, " — {}", self.details)?;
        }
        write!(f, " (lúc {}, {})", self.timestamp, self.path)
    }
}

/// Phân loại lỗi đăng nhập dựa trên `message` của cổng.
#[derive(Debug, PartialEq, Eq)]
enum ErrKind {
    /// Sai captcha -> AN TOÀN để thử captcha khác.
    Captcha,
    /// Tài khoản bị khóa -> DỪNG.
    Locked,
    /// Sai tài khoản/mật khẩu hoặc lỗi lạ -> DỪNG.
    Other,
}

/// Phân loại theo TỪ KHÓA (chịu được thay đổi nhỏ về câu chữ của cổng).
///
/// ⚠️ THỨ TỰ QUAN TRỌNG: xét "khóa" TRƯỚC "captcha". Trường hợp nhập nhằng phải
/// nghiêng về DỪNG — tuyệt đối không được rơi vào nhánh retry.
fn classify(message: &str) -> ErrKind {
    let low = message.to_lowercase();
    if low.contains("khoá") || low.contains("khóa") || low.contains("locked") {
        ErrKind::Locked
    } else if low.contains("captcha") {
        ErrKind::Captcha
    } else {
        ErrKind::Other
    }
}

#[derive(Debug)]
pub enum LoginError {
    /// Sai tài khoản/mật khẩu hoặc lỗi không rõ -> KHÔNG retry (tránh khóa).
    BadCredentials(AuthErr),
    /// Tài khoản bị khóa.
    Locked(AuthErr),
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

        // 4) Thành công -> body là { "token": "..." }
        if status.is_success() {
            let ok: AuthOk = resp
                .json()
                .await
                .map_err(|e| LoginError::Http(format!("HTTP 200 nhưng body lạ: {e}")))?;
            println!("[{attempt}] ✅ đăng nhập OK (captcha '{code}', đã nộp {submitted} lần)");
            return Ok(ok.token);
        }

        // 5) Lỗi -> body là AuthErr; phân loại để quyết định retry hay DỪNG.
        //    Không parse được = không hiểu phản hồi -> DỪNG (mặc định an toàn).
        let err: AuthErr = resp
            .json()
            .await
            .map_err(|e| LoginError::Http(format!("{status}, body lỗi không đọc được: {e}")))?;

        match classify(&err.message) {
            ErrKind::Captcha => {
                println!("[{attempt}] ✗ sai captcha ('{code}') → thử captcha khác. resp: {err}");
                continue; // AN TOÀN: đây là nhánh DUY NHẤT được lặp.
            }
            ErrKind::Locked => return Err(LoginError::Locked(err)),
            // Thường là sai user/pass -> DỪNG NGAY để tránh bị khóa tài khoản.
            ErrKind::Other => return Err(LoginError::BadCredentials(err)),
        }
    }

    Err(LoginError::TooManyCaptchaFails)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_captcha_message() {
        assert_eq!(classify("Mã captcha không đúng."), ErrKind::Captcha);
    }

    /// Chốt chặn AN TOÀN: message "bị khoá" TUYỆT ĐỐI không được coi là sai captcha,
    /// vì nhánh captcha là nhánh duy nhất được retry.
    #[test]
    fn classify_locked_message() {
        assert_eq!(
            classify("Tài khoản đã bị khoá vì đã nhập sai thông tin quá số lần quy định."),
            ErrKind::Locked
        );
        assert_eq!(classify("Tài khoản đã bị khóa."), ErrKind::Locked);
    }

    /// Chốt chặn AN TOÀN: sai tài khoản/mật khẩu phải DỪNG (không rơi vào nhánh
    /// captcha), vì retry sẽ làm cổng đếm sai và KHÓA tài khoản.
    #[test]
    fn classify_bad_credentials_message() {
        // Chuỗi THẬT từ cổng (uri=/authenticate) — không có dấu chấm cuối câu.
        assert_eq!(
            classify("Tên đăng nhập hoặc mật khẩu không đúng"),
            ErrKind::Other
        );
        // Biến thể phòng khi cổng đổi câu chữ -> vẫn phải DỪNG.
        assert_eq!(classify("Sai tên đăng nhập hoặc mật khẩu."), ErrKind::Other);
    }

    /// Nhập nhằng (có cả "captcha" lẫn "khoá") -> phải nghiêng về DỪNG.
    #[test]
    fn classify_prefers_locked_when_ambiguous() {
        assert_eq!(
            classify("Sai captcha nhiều lần, tài khoản đã bị khoá."),
            ErrKind::Locked
        );
    }

    /// Ghép một JWT giả (chữ ký tùy ý) với payload chứa `exp` cho trước.
    fn jwt_with_exp(exp: i64) -> String {
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(format!("{{\"exp\":{exp}}}"));
        format!("aGVhZGVy.{payload}.c2ln")
    }

    #[test]
    fn token_expiry_reads_exp() {
        assert_eq!(token_expiry(&jwt_with_exp(1_800_000_000)), Some(1_800_000_000));
    }

    #[test]
    fn is_expired_future_and_past() {
        let future = now_unix() + 3600; // còn 1 giờ
        let past = now_unix() - 3600; // hết hạn 1 giờ trước
        assert!(!is_expired(&jwt_with_exp(future), 120));
        assert!(is_expired(&jwt_with_exp(past), 120));
        // Trong khoảng skew (còn 60s < 120s) -> coi như hết hạn.
        assert!(is_expired(&jwt_with_exp(now_unix() + 60), 120));
    }

    #[test]
    fn is_expired_true_for_garbage() {
        assert!(is_expired("khong-phai-jwt", 0));
        assert!(is_expired("", 0));
        assert_eq!(token_expiry("a.b.c"), None);
    }
}
