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

/// Truy vấn hóa đơn từ DB cục bộ (không gọi server). Phân trang phía server: trả 1 trang + tổng số.
#[tauri::command]
fn list_invoices(
    state: State<'_, AppState>,
    filter: InvoiceFilter,
) -> Result<Paged<Invoice>, String> {
    let total = state.db.count_invoices(&filter).map_err(|e| e.to_string())?;
    let data = state.db.query(&filter).map_err(|e| e.to_string())?;
    Ok(Paged { data, total })
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

/// Một dòng CSV không hợp lệ (không nhập được) kèm lý do.
#[derive(serde::Serialize)]
struct InvalidRow {
    /// Số dòng trong file (1-based, tính cả dòng header).
    line: usize,
    reason: String,
}

/// Kết quả nhập nguyên liệu từ CSV.
#[derive(serde::Serialize)]
struct ImportResult {
    /// Số nguyên liệu tạo mới thành công.
    created: usize,
    /// Các mã bị bỏ qua do trùng (đã có trong DB hoặc trùng trong chính file).
    duplicates: Vec<String>,
    /// Các dòng không hợp lệ (sai mã / thiếu tên / hỏng), không được nhập.
    invalid: Vec<InvalidRow>,
}

/// `code` đúng chuẩn `ICHRM-####` (tiền tố + đúng 4 chữ số, hết chuỗi).
fn is_valid_code(code: &str) -> bool {
    match code.strip_prefix("ICHRM-") {
        Some(rest) => rest.len() == 4 && rest.bytes().all(|b| b.is_ascii_digit()),
        None => false,
    }
}

/// Nhập nguyên liệu hàng loạt từ nội dung file CSV (bytes).
///
/// Header nhận diện theo tên (không theo vị trí): `code`, `coa_name`/`name`, `producer`,
/// `country_of_origin`. Dòng sai mã (không `ICHRM-####`) hoặc thiếu tên -> liệt kê ở `invalid`,
/// không nhập. Mã trùng (DB hoặc trong chính file) -> bỏ qua, liệt kê ở `duplicates`.
#[tauri::command]
fn import_raw_materials(
    state: State<'_, AppState>,
    csv_bytes: Vec<u8>,
) -> Result<ImportResult, String> {
    // Bỏ BOM UTF-8 nếu có để header đầu không bị dính "\u{feff}".
    let bytes: &[u8] = csv_bytes
        .strip_prefix(&[0xEF, 0xBB, 0xBF])
        .unwrap_or(&csv_bytes);

    let mut rdr = csv::ReaderBuilder::new()
        .trim(csv::Trim::All)
        .has_headers(true)
        .flexible(true)
        .from_reader(bytes);

    // Map tên cột -> chỉ số (lowercase). Chấp nhận `coa_name` hoặc `name` cho tên nguyên liệu.
    let headers = rdr
        .headers()
        .map_err(|e| format!("Không đọc được header CSV: {e}"))?;
    let mut idx_code: Option<usize> = None;
    let mut idx_name: Option<usize> = None;
    let mut idx_producer: Option<usize> = None;
    let mut idx_country: Option<usize> = None;
    for (i, h) in headers.iter().enumerate() {
        match h.trim().to_lowercase().as_str() {
            "code" => idx_code = Some(i),
            "coa_name" | "name" => idx_name = Some(i),
            "producer" => idx_producer = Some(i),
            "country_of_origin" => idx_country = Some(i),
            _ => {}
        }
    }
    let mut missing: Vec<&str> = Vec::new();
    if idx_code.is_none() {
        missing.push("code");
    }
    if idx_name.is_none() {
        missing.push("coa_name");
    }
    if !missing.is_empty() {
        return Err(format!("File CSV thiếu cột: {}", missing.join(", ")));
    }
    let idx_code = idx_code.unwrap();
    let idx_name = idx_name.unwrap();

    let mut valid: Vec<NewRawMaterial> = Vec::new();
    let mut invalid: Vec<InvalidRow> = Vec::new();
    let get = |rec: &csv::StringRecord, i: Option<usize>| -> String {
        i.and_then(|i| rec.get(i)).unwrap_or("").trim().to_string()
    };

    for (i, rec) in rdr.records().enumerate() {
        let line = i + 2; // +1 header, +1 để về 1-based.
        let rec = match rec {
            Ok(r) => r,
            Err(_) => {
                invalid.push(InvalidRow {
                    line,
                    reason: "Dòng CSV không hợp lệ".into(),
                });
                continue;
            }
        };
        let code = get(&rec, Some(idx_code));
        let name = get(&rec, Some(idx_name));
        if !is_valid_code(&code) {
            invalid.push(InvalidRow {
                line,
                reason: "Mã không đúng ICHRM-####".into(),
            });
            continue;
        }
        if name.is_empty() {
            invalid.push(InvalidRow {
                line,
                reason: "Thiếu tên nguyên liệu".into(),
            });
            continue;
        }
        let producer = get(&rec, idx_producer);
        let country = get(&rec, idx_country);
        valid.push(NewRawMaterial {
            code,
            name,
            producer,
            country_of_origin: if country.is_empty() {
                None
            } else {
                Some(country)
            },
        });
    }

    let (created, duplicates) = state
        .db
        .insert_raw_materials_bulk(&valid)
        .map_err(|e| e.to_string())?;

    Ok(ImportResult {
        created,
        duplicates,
        invalid,
    })
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

/// Ghi 1 file COA vào `app_data_dir/coa/<uuidv7>.<ext>` (cạnh SQLite) rồi chèn bản ghi
/// (đường dẫn tương đối để DB portable). Trả bản ghi COA vừa tạo. Dùng chung cho tạo 1 file
/// và tạo hàng loạt.
fn write_and_insert_coa(
    app: &tauri::AppHandle,
    db: &store::Db,
    p: &CreateCoaInput,
) -> Result<Coa, String> {
    // 1. Tên file = UUID v7 (có tiền tố thời gian). Đường dẫn tương đối để DB portable.
    let ext = std::path::Path::new(&p.file_name)
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
    std::fs::write(&abs, &p.file_bytes).map_err(|e| e.to_string())?;

    // 2. Chèn bản ghi (path đã có) rồi trả về.
    let id = db
        .insert_coa(&NewCoa {
            raw_material_id: p.raw_material_id,
            lot_no: p.lot_no.clone(),
            manufacture_date: p.manufacture_date.clone(),
            expiration_date: p.expiration_date.clone(),
            path: Some(rel),
        })
        .map_err(|e| e.to_string())?;
    db.get_coa(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "không tìm thấy COA vừa tạo".to_string())
}

/// Tạo COA: ghi file vào `app_data_dir/coa/<uuidv7>.<ext>` (cạnh SQLite),
/// chèn bản ghi với đường dẫn tương đối, trả bản ghi COA.
#[tauri::command]
fn create_coa(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    payload: CreateCoaInput,
) -> Result<Coa, String> {
    write_and_insert_coa(&app, &state.db, &payload)
}

/// Một file lỗi khi tạo COA hàng loạt (không chặn các file khác).
#[derive(serde::Serialize)]
struct CoaBulkError {
    file_name: String,
    reason: String,
}

/// Kết quả tạo COA hàng loạt: số tạo thành công + danh sách file lỗi.
#[derive(serde::Serialize)]
struct CoaBulkResult {
    created: usize,
    errors: Vec<CoaBulkError>,
}

/// Tạo nhiều COA cùng lúc (upload cả thư mục). Best-effort: 1 file lỗi vẫn tiếp tục các file còn lại.
#[tauri::command]
fn create_coas_bulk(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    payloads: Vec<CreateCoaInput>,
) -> Result<CoaBulkResult, String> {
    let mut created = 0usize;
    let mut errors: Vec<CoaBulkError> = Vec::new();
    for p in &payloads {
        match write_and_insert_coa(&app, &state.db, p) {
            Ok(_) => created += 1,
            Err(reason) => errors.push(CoaBulkError {
                file_name: p.file_name.clone(),
                reason,
            }),
        }
    }
    Ok(CoaBulkResult { created, errors })
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

/// Ghi bytes ra file tạm (giữ tên gốc để app ngoài nhận đúng đuôi) rồi mở bằng app mặc định OS.
/// Dùng để xem trước file COA CHƯA lưu (chọn từ thư mục).
#[tauri::command]
fn open_bytes_external(
    app: tauri::AppHandle,
    file_name: String,
    file_bytes: Vec<u8>,
) -> Result<(), String> {
    // Thư mục con uuid riêng mỗi lần mở → không đụng tên / khoá file khi mở nhiều file trùng tên.
    let dir = app
        .path()
        .temp_dir()
        .map_err(|e| e.to_string())?
        .join("invoice-desktop")
        .join("coa-preview")
        .join(uuid::Uuid::now_v7().to_string());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let abs = dir.join(sanitize_filename(&file_name)); // giữ tên + đuôi gốc
    std::fs::write(&abs, &file_bytes).map_err(|e| e.to_string())?;
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

/// (số lô, ngày SX, HSD, đường dẫn tuyệt đối, đuôi) — đơn vị để copy/zip khi export.
type CoaItem = (String, Option<String>, Option<String>, std::path::PathBuf, String);

/// Chuyển COA -> item export nếu file tồn tại trên đĩa (ngược lại None).
fn coa_to_item(base_dir: &std::path::Path, coa: Coa) -> Option<CoaItem> {
    let rel = coa.path?;
    let abs = base_dir.join(&rel);
    if !abs.exists() {
        return None;
    }
    let ext = std::path::Path::new(&rel)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    Some((coa.lot_no, coa.manufacture_date, coa.expiration_date, abs, ext))
}

/// Copy/zip danh sách COA về Downloads: 1 file → copy thẳng; nhiều → nén 1 `.zip`
/// (mỗi entry `COA_<số lô>_<ngày SX>.<ext>`, thêm ` (n)` nếu trùng tên). Mở thư mục
/// Downloads và trả đường dẫn kết quả.
fn export_items_to_downloads(
    app: &tauri::AppHandle,
    items: &[CoaItem],
    base_name: Option<String>,
) -> Result<String, String> {
    use std::io::Write;

    let dl = app.path().download_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dl).map_err(|e| e.to_string())?;

    let result = if items.len() == 1 {
        let (lot, mdate, edate, src, ext) = &items[0];
        let dest = unique_path(&dl, &coa_stem(lot, mdate, edate), ext);
        std::fs::copy(src, &dest).map_err(|e| e.to_string())?;
        dest
    } else {
        let zip_base = sanitize_filename(&base_name.unwrap_or_else(|| "COA_export".to_string()));
        let zip_path = unique_path(&dl, &zip_base, ".zip");
        let file = std::fs::File::create(&zip_path).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        let mut used: std::collections::HashSet<String> = std::collections::HashSet::new();
        for (lot, mdate, edate, src, ext) in items {
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

/// Parse ngày linh hoạt → (year, month, day?). Hỗ trợ `dd/mm/yyyy`, `mm/yyyy`
/// (định dạng COA hiện tại) và `yyyy-mm-dd`, `yyyy-mm` (dữ liệu cũ ISO).
fn parse_flex_date(s: &str) -> Option<(i32, u32, Option<u32>)> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    let n = |x: &str| x.parse::<u32>().ok();
    if s.contains('/') {
        let p: Vec<&str> = s.split('/').collect();
        match p.as_slice() {
            // mm/yyyy
            [m, y] => {
                let (m, y) = (n(m)?, n(y)? as i32);
                (1..=12).contains(&m).then_some((y, m, None))
            }
            // dd/mm/yyyy
            [d, m, y] => {
                let (d, m, y) = (n(d)?, n(m)?, n(y)? as i32);
                ((1..=12).contains(&m) && (1..=31).contains(&d)).then_some((y, m, Some(d)))
            }
            _ => None,
        }
    } else if s.contains('-') {
        let p: Vec<&str> = s.split('-').collect();
        match p.as_slice() {
            // yyyy-mm
            [y, m] => {
                let (y, m) = (n(y)? as i32, n(m)?);
                (1..=12).contains(&m).then_some((y, m, None))
            }
            // yyyy-mm-dd
            [y, m, d] => {
                let (y, m, d) = (n(y)? as i32, n(m)?, n(d)?);
                ((1..=12).contains(&m) && (1..=31).contains(&d)).then_some((y, m, Some(d)))
            }
            _ => None,
        }
    } else {
        None
    }
}

/// Khớp ngày CSV với ngày COA: cùng year+month; nếu CẢ HAI có ngày thì ngày phải bằng
/// (một bên chỉ có tháng/năm → chỉ so tháng/năm).
fn dates_match(csv: &str, db: &Option<String>) -> bool {
    let Some((cy, cm, cd)) = parse_flex_date(csv) else {
        return false;
    };
    let Some(dbs) = db.as_deref() else {
        return false;
    };
    let Some((dy, dm, dd)) = parse_flex_date(dbs) else {
        return false;
    };
    if cy != dy || cm != dm {
        return false;
    }
    match (cd, dd) {
        (Some(a), Some(b)) => a == b,
        _ => true,
    }
}

/// Tải các COA đã chọn (theo id) về thư mục Downloads.
#[tauri::command]
fn download_coas(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    ids: Vec<i64>,
    base_name: Option<String>,
) -> Result<String, String> {
    if ids.is_empty() {
        return Err("Chưa chọn COA nào".to_string());
    }
    let base_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let mut items: Vec<CoaItem> = Vec::new();
    for id in &ids {
        if let Some(coa) = state.db.get_coa(*id).map_err(|e| e.to_string())? {
            if let Some(item) = coa_to_item(&base_dir, coa) {
                items.push(item);
            }
        }
    }
    if items.is_empty() {
        return Err("Các COA đã chọn chưa có file".to_string());
    }
    // Tải theo checkbox: giữ tên zip `COA_<mã nguyên liệu>.zip`.
    let base = base_name.unwrap_or_else(|| "export".to_string());
    export_items_to_downloads(&app, &items, Some(format!("COA_{base}")))
}

/// Một dòng CSV không tải được COA (kèm lý do) khi tải theo danh sách.
#[derive(serde::Serialize)]
struct NotFoundRow {
    line: usize,
    code: String,
    lot_no: String,
    reason: String,
}

/// Kết quả tải COA theo file CSV.
#[derive(serde::Serialize)]
struct ExportResult {
    downloaded: usize,
    path: Option<String>,
    not_found: Vec<NotFoundRow>,
}

/// Tải COA theo danh sách CSV `code,lot_no[,manufacture_date][,expiration_date]`.
/// Khớp `code` + `lot_no`; cột ngày *có mặt & không rỗng* phải khớp (chuẩn hoá dd/mm/yyyy
/// và ISO, hỗ trợ mm/yyyy). Dòng không khớp → gom vào `not_found`, không chặn dòng khác.
#[tauri::command]
fn download_coas_from_csv(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    csv_bytes: Vec<u8>,
    base_name: Option<String>,
) -> Result<ExportResult, String> {
    let bytes: &[u8] = csv_bytes
        .strip_prefix(&[0xEF, 0xBB, 0xBF])
        .unwrap_or(&csv_bytes);
    let mut rdr = csv::ReaderBuilder::new()
        .trim(csv::Trim::All)
        .has_headers(true)
        .flexible(true)
        .from_reader(bytes);

    // Map header theo tên; bắt buộc `code`, `lot_no`.
    let headers = rdr
        .headers()
        .map_err(|e| format!("Không đọc được header CSV: {e}"))?;
    let (mut idx_code, mut idx_lot, mut idx_m, mut idx_e) = (None, None, None, None);
    for (i, h) in headers.iter().enumerate() {
        match h.trim().to_lowercase().as_str() {
            "code" => idx_code = Some(i),
            "lot_no" => idx_lot = Some(i),
            "manufacture_date" => idx_m = Some(i),
            "expiration_date" => idx_e = Some(i),
            _ => {}
        }
    }
    let mut missing: Vec<&str> = Vec::new();
    if idx_code.is_none() {
        missing.push("code");
    }
    if idx_lot.is_none() {
        missing.push("lot_no");
    }
    if !missing.is_empty() {
        return Err(format!("File CSV thiếu cột: {}", missing.join(", ")));
    }
    let idx_code = idx_code.unwrap();
    let idx_lot = idx_lot.unwrap();

    let base_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let get = |rec: &csv::StringRecord, i: Option<usize>| -> String {
        i.and_then(|i| rec.get(i)).unwrap_or("").trim().to_string()
    };

    let mut items: Vec<CoaItem> = Vec::new();
    let mut seen: std::collections::HashSet<i64> = std::collections::HashSet::new();
    let mut not_found: Vec<NotFoundRow> = Vec::new();

    for (i, rec) in rdr.records().enumerate() {
        let line = i + 2; // +1 header, +1 để về 1-based.
        let rec = match rec {
            Ok(r) => r,
            Err(_) => {
                not_found.push(NotFoundRow {
                    line,
                    code: String::new(),
                    lot_no: String::new(),
                    reason: "Dòng CSV không hợp lệ".into(),
                });
                continue;
            }
        };
        let code = get(&rec, Some(idx_code));
        let lot = get(&rec, Some(idx_lot));
        let mdate = get(&rec, idx_m);
        let edate = get(&rec, idx_e);

        if code.is_empty() || lot.is_empty() {
            not_found.push(NotFoundRow {
                line,
                code,
                lot_no: lot,
                reason: "Thiếu code/lô".into(),
            });
            continue;
        }
        let rm = match state
            .db
            .get_raw_material_by_code(&code)
            .map_err(|e| e.to_string())?
        {
            Some(rm) => rm,
            None => {
                not_found.push(NotFoundRow {
                    line,
                    code,
                    lot_no: lot,
                    reason: "Không tìm thấy mã nguyên liệu".into(),
                });
                continue;
            }
        };
        let matched: Vec<Coa> = state
            .db
            .list_coas(rm.id)
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter(|c| c.lot_no.trim() == lot)
            .filter(|c| mdate.is_empty() || dates_match(&mdate, &c.manufacture_date))
            .filter(|c| edate.is_empty() || dates_match(&edate, &c.expiration_date))
            .collect();

        let mut added = 0usize;
        for c in matched {
            let id = c.id;
            if seen.contains(&id) {
                added += 1; // đã thêm từ dòng khác — vẫn coi là tìm thấy.
                continue;
            }
            if let Some(item) = coa_to_item(&base_dir, c) {
                seen.insert(id);
                items.push(item);
                added += 1;
            }
        }
        if added == 0 {
            not_found.push(NotFoundRow {
                line,
                code,
                lot_no: lot,
                reason: "Không có COA khớp hoặc chưa có file".into(),
            });
        }
    }

    if items.is_empty() {
        return Ok(ExportResult {
            downloaded: 0,
            path: None,
            not_found,
        });
    }
    let downloaded = items.len();
    let path = export_items_to_downloads(&app, &items, base_name)?;
    Ok(ExportResult {
        downloaded,
        path: Some(path),
        not_found,
    })
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
            import_raw_materials,
            list_coas,
            create_coa,
            create_coas_bulk,
            read_coa_file,
            open_coa_file,
            open_bytes_external,
            delete_coa,
            download_coas,
            download_coas_from_csv,
            get_floor,
            set_floor,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_valid_code_checks_pattern() {
        assert!(is_valid_code("ICHRM-0001"));
        assert!(!is_valid_code("ICHRM-1"));
        assert!(!is_valid_code("ICH-0001"));
        assert!(!is_valid_code("ICHRM-00A1"));
        assert!(!is_valid_code("ICHRM-00012"));
    }

    #[test]
    fn parse_flex_date_formats() {
        assert_eq!(parse_flex_date("25/11/2025"), Some((2025, 11, Some(25))));
        assert_eq!(parse_flex_date("12/2025"), Some((2025, 12, None)));
        assert_eq!(parse_flex_date("2025-11-25"), Some((2025, 11, Some(25))));
        assert_eq!(parse_flex_date("2025-11"), Some((2025, 11, None)));
        assert_eq!(parse_flex_date(""), None);
        assert_eq!(parse_flex_date("bad"), None);
        assert_eq!(parse_flex_date("13/2025"), None); // tháng > 12
    }

    #[test]
    fn dates_match_rules() {
        // Cùng ngày, khác định dạng (ISO cũ vs dd/mm/yyyy).
        assert!(dates_match("25/11/2025", &Some("2025-11-25".into())));
        assert!(dates_match("25/11/2025", &Some("25/11/2025".into())));
        // mm/yyyy khớp ngày đầy đủ cùng tháng/năm (một bên thiếu ngày).
        assert!(dates_match("12/2025", &Some("08/12/2025".into())));
        assert!(dates_match("08/12/2025", &Some("12/2025".into())));
        // Khác ngày / khác tháng → không khớp.
        assert!(!dates_match("24/11/2025", &Some("25/11/2025".into())));
        assert!(!dates_match("25/10/2025", &Some("25/11/2025".into())));
        // DB None → không khớp khi CSV có ngày.
        assert!(!dates_match("25/11/2025", &None));
    }
}
