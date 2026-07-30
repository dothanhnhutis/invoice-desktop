// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use captcha_core::Solver;
use domain::{
    Coa, Invoice, InvoiceFilter, NewCoa, NewRawMaterial, Paged, RawMaterial, RawMaterialFilter,
    SyncState,
};
use tauri::{path::BaseDirectory, Manager, State};
use tauri_plugin_opener::OpenerExt;

/// Dịch lỗi DB sang thông báo thân thiện (vi phạm UNIQUE = mã trùng).
fn map_db_err(e: impl std::fmt::Display) -> String {
    let s = e.to_string();
    if s.contains("UNIQUE constraint failed") {
        "Mã nguyên liệu đã tồn tại".to_string()
    } else {
        s
    }
}
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
    let _ = secrets::save_token(&token); // bền vững qua lần mở app sau
    *state.token.lock().await = Some(token.clone());
    Ok(token)
}

/// Đăng xuất: xóa credential + floor + token, dừng đồng bộ nền, xóa sạch DB cục bộ.
#[tauri::command]
async fn logout(state: State<'_, AppState>) -> Result<(), String> {
    // 1. Chặn auto-login để luồng sync không tự đăng nhập lại.
    state.auth_blocked.store(true, Ordering::Relaxed);
    // 2. Xóa token cache (sync in-flight sẽ bail ở ensure_token trang kế).
    *state.token.lock().await = None;
    // 3. Xóa username/password khỏi keychain.
    secrets::clear().map_err(|e| e.to_string())?;
    // 4. Xóa toàn bộ dữ liệu cục bộ (hóa đơn, floor + settings, sync_state).
    state.db.clear_all().map_err(|e| e.to_string())?;
    // 5. Đánh thức luồng sync để nó kiểm tra lại và vào idle.
    state.wake.notify_one();
    Ok(())
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

/// Danh sách nguyên liệu (lọc theo `q`, phân trang phía server: trả 1 trang + tổng số).
#[tauri::command]
fn list_raw_materials(
    state: State<'_, AppState>,
    filter: RawMaterialFilter,
) -> Result<Paged<RawMaterial>, String> {
    let total = state
        .db
        .count_raw_materials(&filter)
        .map_err(|e| e.to_string())?;
    let data = state
        .db
        .list_raw_materials(&filter)
        .map_err(|e| e.to_string())?;
    Ok(Paged { data, total })
}

/// lấy nguyên liệu bằng id
#[tauri::command]
fn get_raw_material_by_id(state: State<'_, AppState>, id: i64) -> Result<RawMaterial, String> {
    state
        .db
        .get_raw_material(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "không tìm thấy nguyên liệu".to_string())
}

/// Tạo nguyên liệu mới, trả bản ghi vừa tạo.
#[tauri::command]
fn create_raw_material(
    state: State<'_, AppState>,
    input: NewRawMaterial,
) -> Result<RawMaterial, String> {
    let id = state.db.insert_raw_material(&input).map_err(map_db_err)?;
    state
        .db
        .get_raw_material(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "không tìm thấy nguyên liệu vừa tạo".to_string())
}

/// Cập nhật nguyên liệu theo `id`, trả bản ghi sau cập nhật.
#[tauri::command]
fn update_raw_material(
    state: State<'_, AppState>,
    id: i64,
    input: NewRawMaterial,
) -> Result<RawMaterial, String> {
    state
        .db
        .update_raw_material(id, &input)
        .map_err(map_db_err)?;
    state
        .db
        .get_raw_material(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "không tìm thấy nguyên liệu sau cập nhật".to_string())
}

/// Danh sách COA của một nguyên liệu.
#[tauri::command]
fn list_coas(state: State<'_, AppState>, raw_material_id: i64) -> Result<Vec<Coa>, String> {
    state.db.list_coas(raw_material_id).map_err(|e| e.to_string())
}

/// Dữ liệu tạo COA kèm file (ảnh/PDF) truyền từ frontend.
#[derive(serde::Deserialize)]
struct CreateCoaInput {
    raw_material_id: i64,
    lot_no: String,
    manufacture_date: Option<String>,
    expiration_date: Option<String>,
    file_name: String,
    file_bytes: Vec<u8>,
}

/// Tạo COA: ghi file vào `app_data_dir/coa/<uuidv7>.<ext>` (cạnh SQLite),
/// chèn bản ghi với đường dẫn tương đối, trả bản ghi COA.
#[tauri::command]
fn create_coa(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    payload: CreateCoaInput,
) -> Result<Coa, String> {
    // 1. Tên file = UUID v7 (có tiền tố thời gian). Đường dẫn tương đối để DB portable.
    let ext = std::path::Path::new(&payload.file_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());
    let name = uuid::Uuid::now_v7();
    let rel = match ext {
        Some(ext) => format!("coa/{name}.{ext}"),
        None => format!("coa/{name}"),
    };
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let abs = base.join(&rel);
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&abs, &payload.file_bytes).map_err(|e| e.to_string())?;

    // 2. Chèn bản ghi (path đã có) rồi trả về.
    let id = state
        .db
        .insert_coa(&NewCoa {
            raw_material_id: payload.raw_material_id,
            lot_no: payload.lot_no,
            manufacture_date: payload.manufacture_date,
            expiration_date: payload.expiration_date,
            path: Some(rel),
        })
        .map_err(|e| e.to_string())?;
    state
        .db
        .get_coa(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "không tìm thấy COA vừa tạo".to_string())
}

/// Đọc nội dung file COA (đường dẫn tương đối trong `app_data_dir`) để xem trước trong app.
#[tauri::command]
fn read_coa_file(app: tauri::AppHandle, path: String) -> Result<Vec<u8>, String> {
    let abs = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(path);
    std::fs::read(&abs).map_err(|e| e.to_string())
}

/// Mở file COA (đường dẫn tương đối trong `app_data_dir`) bằng app mặc định của OS.
#[tauri::command]
fn open_coa_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let abs = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(path);
    app.opener()
        .open_path(abs.to_string_lossy().to_string(), None::<String>)
        .map_err(|e| e.to_string())
}

/// Xoá (soft delete) một COA — kèm xoá file trên đĩa.
#[tauri::command]
fn delete_coa(app: tauri::AppHandle, state: State<'_, AppState>, id: i64) -> Result<(), String> {
    // Xoá file trên đĩa (best-effort) trước khi soft-delete bản ghi.
    if let Some(coa) = state.db.get_coa(id).map_err(|e| e.to_string())? {
        if let Some(rel) = coa.path {
            if let Ok(base) = app.path().app_data_dir() {
                let _ = std::fs::remove_file(base.join(rel));
            }
        }
    }
    state.db.soft_delete_coa(id).map_err(|e| e.to_string())
}

/// Thay ký tự không hợp lệ cho tên file (Windows) bằng `_`.
fn sanitize_filename(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| {
            if "<>:\"/\\|?*".contains(c) || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "COA".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Tên gốc (không đuôi) cho file COA, ưu tiên gắn ngày để phân biệt các COA cùng số lô:
/// - có ngày SX  -> `COA_<số lô>_<ngày SX>`
/// - không có ngày SX nhưng có HSD -> `COA_<số lô>_HSD<ngày HSD>`
/// - không có ngày nào (vd cồn) -> `COA_<số lô>` (trùng thì `unique_path`/zip thêm ` (n)`).
fn coa_stem(
    lot: &str,
    manufacture_date: &Option<String>,
    expiration_date: &Option<String>,
) -> String {
    let lot = sanitize_filename(lot);
    let pick = |o: &Option<String>| {
        o.as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    if let Some(d) = pick(manufacture_date) {
        format!("COA_{}_{}", lot, sanitize_filename(&d))
    } else if let Some(d) = pick(expiration_date) {
        format!("COA_{}_HSD{}", lot, sanitize_filename(&d))
    } else {
        format!("COA_{}", lot)
    }
}

/// Đường dẫn `dir/<base><ext>` chưa tồn tại (thêm ` (n)` nếu trùng).
fn unique_path(dir: &std::path::Path, base: &str, ext: &str) -> std::path::PathBuf {
    let mut candidate = dir.join(format!("{base}{ext}"));
    let mut n = 1;
    while candidate.exists() {
        candidate = dir.join(format!("{base} ({n}){ext}"));
        n += 1;
    }
    candidate
}

/// Tải các COA đã chọn về thư mục Downloads.
/// - 1 file: copy thẳng `COA_<số lô>_<ngày SX>.<ext>`.
/// - nhiều file: nén thành 1 `.zip` (mỗi entry `COA_<số lô>_<ngày SX>.<ext>`).
/// Kèm ngày SX để không trùng tên khi các COA cùng số lô khác ngày sản xuất.
/// Trả đường dẫn kết quả và mở thư mục Downloads.
#[tauri::command]
fn download_coas(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    ids: Vec<i64>,
    base_name: Option<String>,
) -> Result<String, String> {
    use std::io::Write;

    if ids.is_empty() {
        return Err("Chưa chọn COA nào".to_string());
    }

    let base_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dl = app.path().download_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dl).map_err(|e| e.to_string())?;

    // Thu thập (số lô, ngày SX, HSD, đường dẫn tuyệt đối, đuôi) cho các COA có file.
    let mut items: Vec<(String, Option<String>, Option<String>, std::path::PathBuf, String)> =
        Vec::new();
    for id in &ids {
        if let Some(coa) = state.db.get_coa(*id).map_err(|e| e.to_string())? {
            if let Some(rel) = coa.path {
                let abs = base_dir.join(&rel);
                if abs.exists() {
                    let ext = std::path::Path::new(&rel)
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|e| format!(".{e}"))
                        .unwrap_or_default();
                    items.push((
                        coa.lot_no,
                        coa.manufacture_date,
                        coa.expiration_date,
                        abs,
                        ext,
                    ));
                }
            }
        }
    }
    if items.is_empty() {
        return Err("Các COA đã chọn chưa có file".to_string());
    }

    let result = if items.len() == 1 {
        let (lot, mdate, edate, src, ext) = &items[0];
        let dest = unique_path(&dl, &coa_stem(lot, mdate, edate), ext);
        std::fs::copy(src, &dest).map_err(|e| e.to_string())?;
        dest
    } else {
        let zip_base = format!(
            "COA_{}",
            sanitize_filename(&base_name.unwrap_or_else(|| "export".to_string()))
        );
        let zip_path = unique_path(&dl, &zip_base, ".zip");
        let file = std::fs::File::create(&zip_path).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        let mut used: std::collections::HashSet<String> = std::collections::HashSet::new();
        for (lot, mdate, edate, src, ext) in &items {
            let stem = coa_stem(lot, mdate, edate);
            let mut name = format!("{stem}{ext}");
            let mut n = 1;
            while used.contains(&name) {
                name = format!("{stem} ({n}){ext}");
                n += 1;
            }
            used.insert(name.clone());
            zip.start_file(&name, options).map_err(|e| e.to_string())?;
            let bytes = std::fs::read(src).map_err(|e| e.to_string())?;
            zip.write_all(&bytes).map_err(|e| e.to_string())?;
        }
        zip.finish().map_err(|e| e.to_string())?;
        zip_path
    };

    // Mở thư mục Downloads cho tiện.
    let _ = app
        .opener()
        .open_path(dl.to_string_lossy().to_string(), None::<String>);

    Ok(result.to_string_lossy().to_string())
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
            tauri::async_runtime::spawn(sync::run(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            login,
            logout,
            profile,
            set_credentials,
            clear_credentials,
            has_credentials,
            get_sync_status,
            list_invoices,
            get_raw_material_by_id,
            list_raw_materials,
            create_raw_material,
            update_raw_material,
            list_coas,
            create_coa,
            read_coa_file,
            open_coa_file,
            delete_coa,
            download_coas,
            get_floor,
            set_floor,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
