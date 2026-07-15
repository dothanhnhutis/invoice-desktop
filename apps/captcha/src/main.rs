// login.rs — ráp Solver vào luồng đăng nhập hoadondientu.gdt.gov.vn
//
// Yêu cầu: Solver (trong solver.rs) nằm CÙNG crate và `solve()` là pub.
// Cargo.toml cần thêm (ngoài các crate của solver):
//   reqwest    = { version = "0.12", features = ["json", "cookies"] }
//   tokio      = { version = "1", features = ["full"] }
//   serde      = { version = "1", features = ["derive"] }
//   serde_json = "1"
//
// ⚠️  QUAN TRỌNG VỀ KHÓA TÀI KHOẢN:
//     Cổng này KHÓA tài khoản sau vài lần đăng nhập SAI (sai mật khẩu).
//     Vì vậy hàm dưới CHỈ retry khi lỗi trông giống "sai captcha".
//     Mọi lỗi khác (sai tài khoản/mật khẩu, bị khóa...) -> DỪNG NGAY.
//     Đừng bao giờ nới lỏng điều này thành "cứ retry mọi lỗi".

use reqwest::Client;
use serde::{Deserialize, Serialize};

const BASE: &str = "https://hoadondientu.gdt.gov.vn";

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
    solver: &crate::Solver,
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

/// Tạo client dùng chung: giữ cookie + User-Agent giống trình duyệt.
pub fn make_client() -> Client {
    Client::builder()
        .cookie_store(true)
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        )
        .build()
        .expect("build client")
}

// ---------------------------------------------------------------------------
// Ví dụ sử dụng.  Đọc thông tin từ biến môi trường, KHÔNG hardcode.
//   HDDT_USER=<MST>  HDDT_PASS=<mật khẩu>  cargo run --bin login
// ---------------------------------------------------------------------------
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let username = std::env::var("HDDT_USER").expect("thiếu env HDDT_USER");
    let password = std::env::var("HDDT_PASS").expect("thiếu env HDDT_PASS");

    let client = make_client();
    let solver = crate::Solver::load("templates");

    // max_attempts = 8: sẽ thử tối đa 8 captcha, nhưng chỉ NỘP khi margin đủ cao.
    // min_margin = 0.06: chỉnh theo kết quả `eval` (xem margin ở các ca đúng).
    match login(&client, &solver, &username, &password, 8, 0.06).await {
        Ok(token) => {
            println!("TOKEN = {token}");
            // Dùng token cho các API sau, ví dụ tra cứu hóa đơn:
            //   client.get(format!("{BASE}/query/invoices/..."))
            //         .header("Authorization", format!("Bearer {token}"))
            //         .send().await?;
            //
            // Token là JWT có hạn (đọc claim `exp`); HÃY CACHE lại và tái sử dụng,
            // chỉ đăng nhập lại (giải captcha lại) khi token hết hạn — đừng login
            // mỗi request.
        }
        Err(LoginError::BadCredentials(msg)) => {
            eprintln!("DỪNG: {msg}");
            eprintln!("→ Không retry sai mật khẩu để tránh bị KHÓA tài khoản.");
        }
        Err(e) => eprintln!("Lỗi: {e}"),
    }
    Ok(())
}
