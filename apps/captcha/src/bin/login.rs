// login.rs — bin test CLI cho luồng đăng nhập (logic nằm ở crate `hddt`).
//
// Đọc thông tin từ biến môi trường, KHÔNG hardcode:
//   HDDT_USER=<MST>  HDDT_PASS=<mật khẩu>  cargo run -p captcha --bin login

use captcha_core::Solver;

// Template lấy từ chỗ desktop (Tauri) sẽ bundle — neo theo crate, không phụ thuộc CWD.
const DIR_TMPL: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../invoice-desktop/src-tauri/templates"
);

#[tokio::main]
async fn main() {
    let username = std::env::var("HDDT_USER").expect("thiếu env HDDT_USER");
    let password = std::env::var("HDDT_PASS").expect("thiếu env HDDT_PASS");

    let client = hddt::make_client();
    let solver = Solver::load(DIR_TMPL);

    // max_attempts = 8: thử tối đa 8 captcha, nhưng chỉ NỘP khi margin đủ cao.
    // min_margin = 0.06: chỉnh theo kết quả `solver eval` (xem margin ở các ca đúng).
    match hddt::login(&client, &solver, &username, &password, 8, 0.06).await {
        Ok(token) => {
            println!("TOKEN = {token}");
            // Token là JWT có hạn (~1 ngày); HÃY CACHE lại và tái sử dụng,
            // chỉ đăng nhập lại (giải captcha lại) khi hết hạn — đừng login mỗi request.
        }
        Err(hddt::LoginError::BadCredentials(msg)) => {
            eprintln!("DỪNG: {msg}");
            eprintln!("→ Không retry sai mật khẩu để tránh bị KHÓA tài khoản.");
        }
        Err(e) => eprintln!("Lỗi: {e}"),
    }
}
