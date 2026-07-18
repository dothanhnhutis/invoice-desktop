// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use captcha_core::Solver;
use domain::{Invoice, InvoiceFilter, SyncState};
use tauri::{path::BaseDirectory, Manager, State};
mod helper;
mod secrets;
mod sync;

/// State sống lâu của app: client (giữ cookie), bộ giải captcha, token, DB cục bộ,
/// và tín hiệu điều phối luồng đồng bộ nền.
pub struct AppState {
    client: reqwest::Client,
    solver: Solver,
    token: tokio::sync::Mutex<Option<String>>,
    db: store::Db,
    /// Đánh thức luồng sync khi user vừa đặt/đổi credential.
    wake: tokio::sync::Notify,
    /// Chặn auto-login sau khi sai mật khẩu/bị khóa (tránh khóa tài khoản).
    auth_blocked: AtomicBool,
}

/// Đăng nhập hoadondietu: tự giải captcha, trả token (JWT ~1 ngày) và cache lại.
///
/// ⚠️ `hddt::login` chỉ retry khi sai captcha; sai mật khẩu -> dừng ngay (tránh khóa tài khoản).
#[tauri::command]
async fn login(
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> Result<String, String> {
    let token = hddt::login(&state.client, &state.solver, &username, &password, 8, 0.06)
        .await
        .map_err(|e| e.to_string())?;
    *state.token.lock().await = Some(token.clone());
    Ok(token)
}

/// Thông tin người nộp thuế đang đăng nhập (JSON raw từ cổng).
#[tauri::command]
async fn profile(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let token = helper::get_access_token(&state).await?;
    hddt::profile(&state.client, &token)
        .await
        .map_err(|e| e.to_string())
}

/// Lưu credential vào keychain (lần đầu / đổi ở Settings) và đánh thức luồng sync.
#[tauri::command]
fn set_credentials(
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> Result<(), String> {
    secrets::save(&username, &password).map_err(|e| e.to_string())?;
    // Credential mới -> gỡ chặn + đánh thức luồng đồng bộ.
    state.auth_blocked.store(false, Ordering::Relaxed);
    state.wake.notify_one();
    Ok(())
}

/// Xóa credential (đăng xuất / đổi tài khoản).
#[tauri::command]
fn clear_credentials() -> Result<(), String> {
    secrets::clear().map_err(|e| e.to_string())
}

/// Đã có credential lưu chưa (frontend dùng để quyết định màn hình first-run).
#[tauri::command]
fn has_credentials() -> bool {
    secrets::load().is_some()
}

/// Tiến độ đồng bộ hiện tại.
#[tauri::command]
fn get_sync_status(state: State<'_, AppState>) -> Result<SyncState, String> {
    state.db.get_sync_state().map_err(|e| e.to_string())
}

/// Truy vấn hóa đơn từ DB cục bộ (không gọi server).
#[tauri::command]
fn list_invoices(
    state: State<'_, AppState>,
    filter: InvoiceFilter,
) -> Result<Vec<Invoice>, String> {
    state.db.query(&filter).map_err(|e| e.to_string())
}

/// Mốc dừng backfill hiện tại (ngày sớm nhất tải về).
#[tauri::command]
fn get_floor(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state
        .db
        .get_setting("floor")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| sync::DEFAULT_FLOOR.to_string()))
}

/// Đặt FLOOR mới (YYYY-MM-DD).
/// - Sớm hơn cũ → đào sâu thêm (reset backfill).
/// - Muộn hơn cũ → xóa hóa đơn cũ hơn FLOOR mới + kéo mốc oldest lên.
#[tauri::command]
fn set_floor(state: State<'_, AppState>, date: String) -> Result<(), String> {
    let new_d = chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d")
        .map_err(|_| "ngày phải dạng YYYY-MM-DD".to_string())?;
    if new_d > chrono::Local::now().date_naive() {
        return Err("FLOOR không được ở tương lai".into());
    }

    let old = state
        .db
        .get_setting("floor")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| sync::DEFAULT_FLOOR.to_string());
    state
        .db
        .set_setting("floor", &date)
        .map_err(|e| e.to_string())?;

    if date < old {
        // Sớm hơn: backfill tiếp xuống mốc mới.
        let mut ss = state.db.get_sync_state().map_err(|e| e.to_string())?;
        ss.backfill_done = false;
        state.db.set_sync_state(&ss).map_err(|e| e.to_string())?;
    } else if date > old {
        // Muộn hơn: prune dữ liệu cũ hơn + clamp oldest = max(oldest, date).
        state
            .db
            .delete_invoices_before(&date)
            .map_err(|e| e.to_string())?;
        let mut ss = state.db.get_sync_state().map_err(|e| e.to_string())?;
        ss.oldest_date = Some(match ss.oldest_date {
            Some(o) if o.as_str() >= date.as_str() => o,
            _ => date.clone(),
        });
        state.db.set_sync_state(&ss).map_err(|e| e.to_string())?;
    }

    state.wake.notify_one();
    Ok(())
}

/// Nạp Solver từ template đã bundle (production) hoặc thư mục dev (fallback).
fn load_solver(app: &tauri::App) -> Result<Solver, Box<dyn std::error::Error>> {
    let dir = app
        .path()
        .resolve("templates", BaseDirectory::Resource)
        .ok()
        .filter(|p| p.exists())
        // Dev: resource chưa được copy -> đọc thẳng templates cạnh crate.
        .unwrap_or_else(|| PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/templates")));
    Ok(Solver::try_load(&dir)?)
}

/// Mở DB cục bộ ở app data dir (tạo thư mục nếu chưa có).
fn open_db(app: &tauri::App) -> Result<store::Db, Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    Ok(store::Db::open(dir.join("invoices.db"))?)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let solver = load_solver(app)?;
            let db = open_db(app)?;
            app.manage(AppState {
                client: hddt::make_client(),
                solver,
                token: Default::default(),
                db,
                wake: tokio::sync::Notify::new(),
                auth_blocked: AtomicBool::new(false),
            });
            // Luồng đồng bộ nền (tự chờ tới khi có credential).
            // tauri::async_runtime::spawn(sync::run(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            login,
            profile,
            set_credentials,
            clear_credentials,
            has_credentials,
            get_sync_status,
            list_invoices,
            get_floor,
            set_floor,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
