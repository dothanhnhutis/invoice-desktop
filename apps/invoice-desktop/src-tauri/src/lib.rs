// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use captcha_core::Solver;
use domain::{
    Coa, Invoice, InvoiceFilter, NewCoa, NewRawMaterial, Paged, RawMaterial, RawMaterialFilter,
    SyncState,
};
use tauri::{path::BaseDirectory, Emitter, Manager, State};
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
mod export;
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
    /// Luồng nền đang chạy 1 lượt đồng bộ (khóa cập nhật floor/mật khẩu ở UI).
    syncing: AtomicBool,
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

/// Tắt module hoá đơn: xóa credential/token + xóa hóa đơn (GIỮ settings), dừng sync.
/// Khác `logout` ở chỗ KHÔNG `clear_all` (giữ floor + cờ tính năng khác).
#[tauri::command]
async fn disable_invoices(state: State<'_, AppState>) -> Result<(), String> {
    state.auth_blocked.store(true, Ordering::Relaxed);
    *state.token.lock().await = None;
    secrets::clear().map_err(|e| e.to_string())?;
    state.db.clear_invoices().map_err(|e| e.to_string())?;
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

/// MST đã lưu trong keychain (hiển thị ở Cài đặt). None nếu chưa đăng nhập.
#[tauri::command]
fn get_username() -> Option<String> {
    secrets::load().map(|(u, _)| u)
}

/// Luồng nền có đang chạy 1 lượt đồng bộ không (UI khóa form cập nhật khi true).
#[tauri::command]
fn is_syncing(state: State<'_, AppState>) -> bool {
    state.syncing.load(Ordering::Relaxed)
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

/// Lấy chi tiết 1 hóa đơn (lazy-load). Nếu DB đã cache `qrcode`+`hdhhdvu` thì trả ngay,
/// ngược lại gọi API `/detail`, ghi vào DB rồi trả về (lần sau không gọi mạng nữa).
#[tauri::command]
async fn get_invoice_detail(state: State<'_, AppState>, id: String) -> Result<Invoice, String> {
    let mut inv = state
        .db
        .get_invoice(&id)
        .map_err(|e| e.to_string())?
        .ok_or("Không tìm thấy hóa đơn")?;

    // Cache hit -> trả ngay, KHÔNG gọi mạng.
    if inv.qrcode.is_some() && inv.hdhhdvu.is_some() {
        return Ok(inv);
    }

    // Cache miss -> gọi API detail với khóa từ chính bản ghi.
    let token = helper::get_access_token(&state).await?;
    let v = hddt::query_detail(
        &state.client,
        &token,
        &inv.nbmst,
        &inv.khhdon,
        &inv.shdon.to_string(),
        &inv.khmshdon.to_string(),
    )
    .await
    .map_err(|e| e.to_string())?;

    let qrcode = v
        .get("qrcode")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let hdhhdvu = v
        .get("hdhhdvu")
        .map(|x| x.to_string())
        .unwrap_or_else(|| "[]".into());

    state
        .db
        .set_invoice_detail(&inv.id, &qrcode, &hdhhdvu)
        .map_err(|e| e.to_string())?;
    inv.qrcode = Some(qrcode);
    inv.hdhhdvu = Some(hdhhdvu);
    Ok(inv)
}

#[derive(serde::Serialize)]
struct InvoiceExportError {
    id: String,
    label: String,
    reason: String,
}

#[derive(serde::Serialize)]
struct ExportInvoiceResult {
    downloaded: u32,
    dir: String,
    /// Đường dẫn file `.zip` khi tải nhiều hóa đơn; None khi chép rời từng file.
    path: Option<String>,
    errors: Vec<InvoiceExportError>,
}

/// Đưa file thành phẩm (đang nằm ở thư mục tạm) về `out_dir`:
/// - `zip = false` → chép rời từng file, trả `None`.
/// - `zip = true`  → nén tất cả vào `<zip_base>.zip`, trả đường dẫn file nén.
///
/// Tên file/entry lấy nguyên từ thư mục tạm (đã unique sẵn nhờ `unique_path`), trùng với file
/// có sẵn ở `out_dir` thì `unique_path` tự thêm ` (n)` — không bao giờ ghi đè.
fn package_outputs(
    files: &[std::path::PathBuf],
    out_dir: &std::path::Path,
    zip_base: &str,
    zip: bool,
) -> Result<Option<std::path::PathBuf>, String> {
    use std::io::Write;

    if !zip {
        for src in files {
            let stem = src
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("invoice");
            let ext = src
                .extension()
                .and_then(|s| s.to_str())
                .map(|e| format!(".{e}"))
                .unwrap_or_default();
            std::fs::copy(src, unique_path(out_dir, stem, &ext)).map_err(|e| e.to_string())?;
        }
        return Ok(None);
    }

    let zip_path = unique_path(out_dir, zip_base, ".zip");
    let file = std::fs::File::create(&zip_path).map_err(|e| e.to_string())?;
    let mut zw = zip::ZipWriter::new(file);
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for src in files {
        let name = src
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("invoice")
            .to_string();
        zw.start_file(&name, options).map_err(|e| e.to_string())?;
        let bytes = std::fs::read(src).map_err(|e| e.to_string())?;
        zw.write_all(&bytes).map_err(|e| e.to_string())?;
    }
    zw.finish().map_err(|e| e.to_string())?;
    Ok(Some(zip_path))
}

/// Tên file nén hệ thống tự đặt khi tải nhiều hóa đơn: `HoaDon_<số lượng>_<ngày giờ>`.
fn auto_zip_base(count: u32) -> String {
    format!(
        "HoaDon_{count}_{}",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    )
}

/// Tải bản thể hiện hóa đơn (ZIP invoice.html/xml) từ GDT cho từng `id`, render PDF bằng
/// trình duyệt headless, rồi đưa cặp `<khhdon>_<shdon>.xml` + `.pdf` về thư mục `dir` người dùng chọn:
/// **1 hóa đơn → 2 file rời**, **nhiều hóa đơn → nén 1 file `.zip`** (tên hệ thống tự đặt).
/// Hóa đơn lỗi được gom vào `errors`, không chặn các hóa đơn còn lại.
#[tauri::command]
async fn download_invoices(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    ids: Vec<String>,
    dir: String,
) -> Result<ExportInvoiceResult, String> {
    let out_dir = std::path::PathBuf::from(&dir);
    if !out_dir.is_dir() {
        return Err("Thư mục lưu không hợp lệ".into());
    }
    let browser =
        export::find_browser().ok_or("Không tìm thấy Edge/Chrome trên máy để tạo PDF")?;
    // Lấy token 1 lần (tái dùng cho mọi hóa đơn). Không retry sai mật khẩu (helper lo).
    let token = helper::get_access_token(&state).await?;
    // Ghi vào `root/out` trước rồi mới gom về `out_dir` (vì chưa biết sẽ nén hay chép rời);
    // `root/w-<uuid>` là chỗ giải nén tạm của từng hóa đơn.
    let root = app
        .path()
        .temp_dir()
        .map_err(|e| e.to_string())?
        .join("invoice-desktop")
        .join("inv-export")
        .join(uuid::Uuid::now_v7().to_string());
    let staging = root.join("out");
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;

    let mut downloaded = 0u32;
    let mut errors: Vec<InvoiceExportError> = Vec::new();
    let mut files: Vec<std::path::PathBuf> = Vec::new();

    for id in ids {
        let inv = match state.db.get_invoice(&id) {
            Ok(Some(v)) => v,
            Ok(None) => {
                errors.push(InvoiceExportError {
                    id: id.clone(),
                    label: id.clone(),
                    reason: "không tìm thấy hóa đơn".into(),
                });
                continue;
            }
            Err(e) => {
                errors.push(InvoiceExportError {
                    id: id.clone(),
                    label: id.clone(),
                    reason: e.to_string(),
                });
                continue;
            }
        };
        let label = format!("{}_{}", inv.khhdon, inv.shdon);

        let zip = match hddt::export_html(
            &state.client,
            &token,
            &inv.nbmst,
            &inv.khhdon,
            &inv.shdon.to_string(),
            &inv.khmshdon.to_string(),
        )
        .await
        {
            Ok(b) => b,
            Err(e) => {
                errors.push(InvoiceExportError {
                    id: id.clone(),
                    label: label.clone(),
                    reason: e.to_string(),
                });
                continue;
            }
        };

        // Phần nặng (giải nén + gọi trình duyệt + ghi đĩa) chạy trên thread blocking.
        let browser = browser.clone();
        let root_c = root.clone();
        let staging_c = staging.clone();
        let name = sanitize_filename(&label);
        let res = tauri::async_runtime::spawn_blocking(
            move || -> Result<Vec<std::path::PathBuf>, String> {
                let work = root_c.join(format!("w-{}", uuid::Uuid::now_v7()));
                export::extract_zip_to(&zip, &work)?;
                let html = work.join("invoice.html");
                let xml = work.join("invoice.xml");
                if !html.exists() {
                    return Err("ZIP thiếu invoice.html".into());
                }
                let pdf_tmp = work.join("invoice.pdf");
                let pdf_bytes = export::html_to_pdf(&browser, &html, &pdf_tmp)?;
                let xml_bytes = std::fs::read(&xml).map_err(|e| e.to_string())?;
                let p_xml = unique_path(&staging_c, &name, ".xml");
                std::fs::write(&p_xml, &xml_bytes).map_err(|e| e.to_string())?;
                let p_pdf = unique_path(&staging_c, &name, ".pdf");
                std::fs::write(&p_pdf, &pdf_bytes).map_err(|e| e.to_string())?;
                let _ = std::fs::remove_dir_all(&work); // dọn temp (best-effort)
                Ok(vec![p_xml, p_pdf])
            },
        )
        .await
        .map_err(|e| e.to_string())?;

        match res {
            Ok(mut paths) => {
                downloaded += 1;
                files.append(&mut paths);
            }
            Err(e) => errors.push(InvoiceExportError {
                id: id.clone(),
                label,
                reason: e,
            }),
        }
    }

    // Nhiều hơn 1 hóa đơn -> nén; đúng 1 hóa đơn -> để rời 2 file .xml/.pdf.
    let path = if files.is_empty() {
        None
    } else {
        package_outputs(
            &files,
            &out_dir,
            &auto_zip_base(downloaded),
            downloaded > 1,
        )?
    };
    let _ = std::fs::remove_dir_all(&root); // dọn temp (best-effort)

    Ok(ExportInvoiceResult {
        downloaded,
        dir,
        path: path.map(|p| p.to_string_lossy().to_string()),
        errors,
    })
}

#[derive(serde::Serialize)]
struct InvoiceCsvError {
    line: usize,
    label: String,
    reason: String,
}

#[derive(serde::Serialize)]
struct InvoiceCsvResult {
    downloaded: u32,
    /// Đường dẫn file kết quả (`.zip`, hoặc file đơn khi chỉ có 1 file). None nếu không tải được gì.
    path: Option<String>,
    errors: Vec<InvoiceCsvError>,
}

#[derive(Clone, serde::Serialize)]
struct InvoiceCsvProgress {
    done: usize,
    total: usize,
    label: String,
}

/// Nghỉ giữa 2 hóa đơn — cổng GDT không có backoff phía client (`libs/hddt` không throttle),
/// CSV vài trăm dòng bắn liên tục rất dễ bị chặn. Không đáng kể so với ~2-4s render PDF mỗi hóa đơn.
const CSV_THROTTLE: std::time::Duration = std::time::Duration::from_millis(500);

/// Tải hàng loạt hóa đơn theo file CSV cột `nbmst,khhdon,shdon[,khmshdon]` — đúng 4 khóa mà
/// `/export-xml` cần, nên **không** đòi hóa đơn phải có sẵn trong DB (khác `download_invoices`).
/// Mỗi hóa đơn ra cặp `<khhdon>_<shdon>.pdf` + `.xml`; hơn 1 file thì nén thành `<tên CSV>.zip`
/// trong thư mục `dir` người dùng chọn. `khmshdon` thiếu/rỗng → mặc định `"1"` (hóa đơn GTGT).
/// Dòng lỗi gom vào `errors`, không chặn các dòng còn lại. Phát `invoice-csv://progress` theo tiến độ.
#[tauri::command]
async fn download_invoices_from_csv(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    csv_bytes: Vec<u8>,
    base_name: String,
    dir: String,
) -> Result<InvoiceCsvResult, String> {
    // Kiểm tra sớm, trước khi đụng mạng.
    let out_dir = std::path::PathBuf::from(&dir);
    if !out_dir.is_dir() {
        return Err("Thư mục lưu không hợp lệ".into());
    }
    let browser =
        export::find_browser().ok_or("Không tìm thấy Edge/Chrome trên máy để tạo PDF")?;

    let bytes: &[u8] = csv_bytes
        .strip_prefix(&[0xEF, 0xBB, 0xBF])
        .unwrap_or(&csv_bytes);
    let mut rdr = csv::ReaderBuilder::new()
        .trim(csv::Trim::All)
        .has_headers(true)
        .flexible(true)
        .from_reader(bytes);

    // Map header theo tên, không phân biệt hoa thường.
    let headers = rdr
        .headers()
        .map_err(|e| format!("Không đọc được header CSV: {e}"))?;
    let (mut i_nbmst, mut i_khhdon, mut i_shdon, mut i_khmshdon) = (None, None, None, None);
    for (i, h) in headers.iter().enumerate() {
        match h.trim().to_lowercase().as_str() {
            "nbmst" => i_nbmst = Some(i),
            "khhdon" => i_khhdon = Some(i),
            "shdon" => i_shdon = Some(i),
            "khmshdon" => i_khmshdon = Some(i),
            _ => {}
        }
    }
    let mut missing: Vec<&str> = Vec::new();
    if i_nbmst.is_none() {
        missing.push("nbmst");
    }
    if i_khhdon.is_none() {
        missing.push("khhdon");
    }
    if i_shdon.is_none() {
        missing.push("shdon");
    }
    if !missing.is_empty() {
        return Err(format!("File CSV thiếu cột: {}", missing.join(", ")));
    }
    let (i_nbmst, i_khhdon, i_shdon) = (i_nbmst.unwrap(), i_khhdon.unwrap(), i_shdon.unwrap());

    // Gom dòng hợp lệ TRƯỚC (để biết `total` cho tiến độ), khử trùng theo 4 khóa.
    let mut errors: Vec<InvoiceCsvError> = Vec::new();
    let mut rows: Vec<(usize, String, String, String, String)> = Vec::new();
    let mut seen: std::collections::HashSet<(String, String, String, String)> =
        std::collections::HashSet::new();
    for (i, rec) in rdr.records().enumerate() {
        let line = i + 2; // +1 header, +1 để về 1-based
        let rec = match rec {
            Ok(r) => r,
            Err(_) => {
                errors.push(InvoiceCsvError {
                    line,
                    label: String::new(),
                    reason: "Dòng CSV không hợp lệ".into(),
                });
                continue;
            }
        };
        let get = |idx: usize| rec.get(idx).unwrap_or("").trim().to_string();
        // Giữ nguyên dạng chuỗi: `nbmst` có thể là "0106678187-001".
        let (nbmst, khhdon, shdon) = (get(i_nbmst), get(i_khhdon), get(i_shdon));
        let khmshdon = i_khmshdon
            .map(get)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "1".into());

        if nbmst.is_empty() || khhdon.is_empty() || shdon.is_empty() {
            errors.push(InvoiceCsvError {
                line,
                label: format!("{khhdon}_{shdon}"),
                reason: "Thiếu nbmst/khhdon/shdon".into(),
            });
            continue;
        }
        // Dòng trùng lặp -> bỏ qua lặng lẽ, không tính là lỗi.
        if !seen.insert((
            nbmst.clone(),
            khhdon.clone(),
            shdon.clone(),
            khmshdon.clone(),
        )) {
            continue;
        }
        rows.push((line, nbmst, khhdon, shdon, khmshdon));
    }

    if rows.is_empty() {
        return Ok(InvoiceCsvResult {
            downloaded: 0,
            path: None,
            errors,
        });
    }

    // Lấy token 1 lần cho cả lượt (helper lo cache/hết hạn; KHÔNG tự retry khi sai mật khẩu).
    let token = helper::get_access_token(&state).await?;
    // `root/out` chứa file thành phẩm, `root/w-<uuid>` là chỗ giải nén tạm -> zip chỉ lấy từ `files`.
    let root = app
        .path()
        .temp_dir()
        .map_err(|e| e.to_string())?
        .join("invoice-desktop")
        .join("inv-csv")
        .join(uuid::Uuid::now_v7().to_string());
    let staging = root.join("out");
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;

    let total = rows.len();
    let mut downloaded = 0u32;
    let mut files: Vec<std::path::PathBuf> = Vec::new();

    for (done, (line, nbmst, khhdon, shdon, khmshdon)) in rows.into_iter().enumerate() {
        let label = format!("{khhdon}_{shdon}");
        let _ = app.emit(
            "invoice-csv://progress",
            InvoiceCsvProgress {
                done,
                total,
                label: label.clone(),
            },
        );
        if done > 0 {
            tokio::time::sleep(CSV_THROTTLE).await;
        }

        let zip = match hddt::export_html(
            &state.client,
            &token,
            &nbmst,
            &khhdon,
            &shdon,
            &khmshdon,
        )
        .await
        {
            Ok(b) => b,
            Err(e) => {
                errors.push(InvoiceCsvError {
                    line,
                    label,
                    reason: e.to_string(),
                });
                continue;
            }
        };

        // Phần nặng (giải nén + gọi trình duyệt + ghi đĩa) chạy trên thread blocking.
        let browser = browser.clone();
        let root_c = root.clone();
        let staging_c = staging.clone();
        let name = sanitize_filename(&label);
        let res = tauri::async_runtime::spawn_blocking(
            move || -> Result<Vec<std::path::PathBuf>, String> {
                let work = root_c.join(format!("w-{}", uuid::Uuid::now_v7()));
                export::extract_zip_to(&zip, &work)?;
                let html = work.join("invoice.html");
                let xml = work.join("invoice.xml");
                if !html.exists() {
                    return Err("ZIP thiếu invoice.html".into());
                }
                let pdf_bytes = export::html_to_pdf(&browser, &html, &work.join("invoice.pdf"))?;
                let xml_bytes = std::fs::read(&xml).map_err(|e| e.to_string())?;
                let p_xml = unique_path(&staging_c, &name, ".xml");
                std::fs::write(&p_xml, &xml_bytes).map_err(|e| e.to_string())?;
                let p_pdf = unique_path(&staging_c, &name, ".pdf");
                std::fs::write(&p_pdf, &pdf_bytes).map_err(|e| e.to_string())?;
                let _ = std::fs::remove_dir_all(&work); // dọn temp (best-effort)
                Ok(vec![p_xml, p_pdf])
            },
        )
        .await
        .map_err(|e| e.to_string())?;

        match res {
            Ok(mut paths) => {
                downloaded += 1;
                files.append(&mut paths);
            }
            Err(e) => errors.push(InvoiceCsvError {
                line,
                label,
                reason: e,
            }),
        }
    }
    let _ = app.emit(
        "invoice-csv://progress",
        InvoiceCsvProgress {
            done: total,
            total,
            label: String::new(),
        },
    );

    if files.is_empty() {
        let _ = std::fs::remove_dir_all(&root);
        return Ok(InvoiceCsvResult {
            downloaded: 0,
            path: None,
            errors,
        });
    }

    // Hơn 1 file -> nén thành `<tên CSV>.zip`; đúng 1 file -> chép thẳng.
    let zip_base = if base_name.trim().is_empty() {
        "invoices".to_string()
    } else {
        sanitize_filename(&base_name)
    };
    let out_path = package_outputs(&files, &out_dir, &zip_base, files.len() > 1)?;

    let _ = std::fs::remove_dir_all(&root);
    let _ = app.opener().open_path(dir, None::<String>); // mở thư mục đích cho tiện

    Ok(InvoiceCsvResult {
        downloaded,
        path: out_path.map(|p| p.to_string_lossy().to_string()),
        errors,
    })
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

/// Dữ liệu tạo 1 COA kèm bytes file (ảnh/PDF). Nội bộ Rust: dựng từ đường dẫn
/// (`create_coas_bulk_from_paths`) hoặc từ entry trong zip sao lưu (`restore_coas`).
struct CreateCoaInput {
    raw_material_id: i64,
    lot_no: String,
    manufacture_date: Option<String>,
    expiration_date: Option<String>,
    file_name: String,
    file_bytes: Vec<u8>,
}

/// Ghi 1 file COA vào `app_data_dir/coa/<uuidv7>.<ext>` (cạnh SQLite) rồi chèn bản ghi
/// (đường dẫn tương đối để DB portable). Trả bản ghi COA vừa tạo. Dùng chung cho tạo hàng loạt
/// (`create_coas_bulk`) và phục hồi sao lưu (`restore_coas`).
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

// ---------------------------------------------------------------------------
// Sao lưu / phục hồi Nguyên liệu & COA (mang dữ liệu sang máy khác)
// ---------------------------------------------------------------------------

/// Phiên bản định dạng file sao lưu. Tăng khi đổi cấu trúc `manifest.json`.
const BACKUP_VERSION: u32 = 1;

/// 1 COA trong `manifest.json`. `file` = tên entry trong zip (`files/<uuid>.<ext>`),
/// None khi COA chưa từng đính file.
#[derive(serde::Serialize, serde::Deserialize)]
struct BackupCoa {
    lot_no: String,
    manufacture_date: Option<String>,
    expiration_date: Option<String>,
    file: Option<String>,
}

/// 1 nguyên liệu + COA của nó. COA lồng trong nguyên liệu nên phục hồi KHÔNG cần map id cũ→mới.
#[derive(serde::Serialize, serde::Deserialize)]
struct BackupRawMaterial {
    code: String,
    name: String,
    producer: String,
    country_of_origin: Option<String>,
    coas: Vec<BackupCoa>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct BackupManifest {
    version: u32,
    created_at: String,
    raw_materials: Vec<BackupRawMaterial>,
}

#[derive(serde::Serialize)]
struct BackupResult {
    raw_materials: usize,
    coas: usize,
    /// COA có `path` nhưng file không còn trên đĩa (bản ghi vẫn được sao lưu, chỉ thiếu file).
    missing_files: Vec<String>,
    path: String,
}

#[derive(serde::Serialize)]
struct RestoreError {
    code: String,
    lot_no: String,
    reason: String,
}

#[derive(serde::Serialize)]
struct RestoreResult {
    materials_created: usize,
    materials_matched: usize,
    coas_added: usize,
    coas_skipped: usize,
    errors: Vec<RestoreError>,
}

/// Khóa khử trùng 1 COA trong phạm vi 1 nguyên liệu: (số lô, ngày SX, HSD).
/// Số lô bỏ qua hoa/thường + khoảng trắng; ngày chuẩn hoá qua `parse_flex_date` nên
/// `01/2026` và `2026-01` coi là MỘT (dữ liệu COA cũ còn lưu dạng ISO).
type CoaKey = (String, Option<(i32, u32, Option<u32>)>, Option<(i32, u32, Option<u32>)>);

fn coa_key(lot_no: &str, mdate: &Option<String>, edate: &Option<String>) -> CoaKey {
    let norm = |o: &Option<String>| o.as_deref().and_then(parse_flex_date);
    (
        lot_no.trim().to_lowercase(),
        norm(mdate),
        norm(edate),
    )
}

/// Sao lưu toàn bộ Nguyên liệu & COA ra 1 file `.zip` trong thư mục `dir`:
/// `manifest.json` (nguyên liệu + COA lồng nhau) và `files/<uuid>.<ext>` (bản sao file COA).
/// ⚠️ Duyệt theo nguyên liệu đang hoạt động nên COA "mồ côi" (nguyên liệu cha đã xoá mềm) bị bỏ qua —
/// đúng ý, vì chúng cũng không hiện ở UI.
#[tauri::command]
fn backup_coas(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    dir: String,
) -> Result<BackupResult, String> {
    use std::io::Write;

    let out_dir = std::path::PathBuf::from(&dir);
    if !out_dir.is_dir() {
        return Err("Thư mục lưu không hợp lệ".into());
    }
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let materials = state
        .db
        .list_raw_materials(&RawMaterialFilter::default()) // limit None -> lấy hết
        .map_err(|e| e.to_string())?;

    let mut manifest = BackupManifest {
        version: BACKUP_VERSION,
        created_at: chrono::Local::now().to_rfc3339(),
        raw_materials: Vec::with_capacity(materials.len()),
    };
    // (tên entry trong zip, đường dẫn tuyệt đối trên đĩa)
    let mut files: Vec<(String, std::path::PathBuf)> = Vec::new();
    let mut missing_files: Vec<String> = Vec::new();
    let mut coa_count = 0usize;

    for m in materials {
        let coas = state.db.list_coas(m.id).map_err(|e| e.to_string())?;
        let mut items = Vec::with_capacity(coas.len());
        for c in coas {
            coa_count += 1;
            // `path` có thể lỗi thời (delete_coa xoá file trước khi xoá mềm) -> luôn kiểm tồn tại.
            let entry = match c.path.as_deref() {
                Some(rel) => {
                    let abs = base.join(rel);
                    if abs.exists() {
                        // Tên gốc là uuidv7 -> chắc chắn không trùng giữa các COA.
                        let name = std::path::Path::new(rel)
                            .file_name()
                            .and_then(|s| s.to_str())
                            .unwrap_or(rel);
                        let in_zip = format!("files/{name}");
                        files.push((in_zip.clone(), abs));
                        Some(in_zip)
                    } else {
                        missing_files.push(format!("{} / {}", m.code, c.lot_no));
                        None
                    }
                }
                None => None,
            };
            items.push(BackupCoa {
                lot_no: c.lot_no,
                manufacture_date: c.manufacture_date,
                expiration_date: c.expiration_date,
                file: entry,
            });
        }
        manifest.raw_materials.push(BackupRawMaterial {
            code: m.code,
            name: m.name,
            producer: m.producer,
            country_of_origin: m.country_of_origin,
            coas: items,
        });
    }

    let zip_base = format!(
        "COA_backup_{}",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );
    let zip_path = unique_path(&out_dir, &zip_base, ".zip");
    let file = std::fs::File::create(&zip_path).map_err(|e| e.to_string())?;
    let mut zw = zip::ZipWriter::new(file);
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let json = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;
    zw.start_file("manifest.json", options)
        .map_err(|e| e.to_string())?;
    zw.write_all(&json).map_err(|e| e.to_string())?;
    for (name, abs) in &files {
        zw.start_file(name, options).map_err(|e| e.to_string())?;
        let bytes = std::fs::read(abs).map_err(|e| e.to_string())?;
        zw.write_all(&bytes).map_err(|e| e.to_string())?;
    }
    zw.finish().map_err(|e| e.to_string())?;

    let _ = app.opener().open_path(dir, None::<String>);

    Ok(BackupResult {
        raw_materials: manifest.raw_materials.len(),
        coas: coa_count,
        missing_files,
        path: zip_path.to_string_lossy().to_string(),
    })
}

/// Phục hồi từ file sao lưu: **gộp thêm, không xoá gì**.
/// Mã nguyên liệu đã có ở máy này ⇒ giữ nguyên thông tin cũ, chỉ thêm COA còn thiếu.
/// COA trùng (cùng số lô + ngày, xem `coa_key`) ⇒ bỏ qua ⇒ chạy lại nhiều lần vẫn an toàn.
///
/// Nhận **đường dẫn** chứ không nhận bytes: cầu IPC mã hoá `Vec<u8>` thành mảng số JSON (~4× dung
/// lượng, buffer cả 2 phía) nên bản sao lưu lớn sẽ không tải nổi.
#[tauri::command]
fn restore_coas(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    zip_path: String,
) -> Result<RestoreResult, String> {
    use std::io::Read;

    let bytes = std::fs::read(&zip_path).map_err(|e| format!("Không đọc được file: {e}"))?;
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|e| format!("File không phải ZIP hợp lệ: {e}"))?;

    let manifest: BackupManifest = {
        let mut entry = archive
            .by_name("manifest.json")
            .map_err(|_| "Không đọc được manifest.json — file này không phải bản sao lưu".to_string())?;
        let mut buf = String::new();
        entry.read_to_string(&mut buf).map_err(|e| e.to_string())?;
        serde_json::from_str(&buf).map_err(|e| format!("manifest.json hỏng: {e}"))?
    };
    if manifest.version != BACKUP_VERSION {
        return Err(format!(
            "Bản sao lưu phiên bản {} không tương thích (app đọc được phiên bản {BACKUP_VERSION})",
            manifest.version
        ));
    }

    let mut res = RestoreResult {
        materials_created: 0,
        materials_matched: 0,
        coas_added: 0,
        coas_skipped: 0,
        errors: Vec::new(),
    };

    for m in &manifest.raw_materials {
        // Mã đã có -> dùng lại id, KHÔNG đụng tên/NSX/quốc gia của máy này.
        let rm_id = match state
            .db
            .get_raw_material_by_code(&m.code)
            .map_err(|e| e.to_string())?
        {
            Some(rm) => {
                res.materials_matched += 1;
                rm.id
            }
            None => {
                let new = NewRawMaterial {
                    code: m.code.clone(),
                    name: m.name.clone(),
                    producer: m.producer.clone(),
                    country_of_origin: m.country_of_origin.clone(),
                };
                match state.db.insert_raw_material(&new) {
                    Ok(id) => {
                        res.materials_created += 1;
                        id
                    }
                    Err(e) => {
                        res.errors.push(RestoreError {
                            code: m.code.clone(),
                            lot_no: String::new(),
                            reason: map_db_err(e),
                        });
                        continue;
                    }
                }
            }
        };

        // Nạp COA hiện có 1 lần để khử trùng.
        let mut seen: std::collections::HashSet<CoaKey> = state
            .db
            .list_coas(rm_id)
            .map_err(|e| e.to_string())?
            .iter()
            .map(|c| coa_key(&c.lot_no, &c.manufacture_date, &c.expiration_date))
            .collect();

        for c in &m.coas {
            let key = coa_key(&c.lot_no, &c.manufacture_date, &c.expiration_date);
            if !seen.insert(key) {
                res.coas_skipped += 1;
                continue;
            }
            let outcome = match &c.file {
                // Có file -> lấy bytes trong zip rồi đi đúng đường tạo COA thường ngày
                // (tự sinh uuid mới, không đè file nào của máy này).
                Some(name) => read_zip_entry(&mut archive, name).and_then(|bytes| {
                    write_and_insert_coa(
                        &app,
                        &state.db,
                        &CreateCoaInput {
                            raw_material_id: rm_id,
                            lot_no: c.lot_no.clone(),
                            manufacture_date: c.manufacture_date.clone(),
                            expiration_date: c.expiration_date.clone(),
                            file_name: name.clone(),
                            file_bytes: bytes,
                        },
                    )
                    .map(|_| ())
                }),
                // Không có file -> vẫn giữ bản ghi để không mất dữ liệu.
                None => state
                    .db
                    .insert_coa(&NewCoa {
                        raw_material_id: rm_id,
                        lot_no: c.lot_no.clone(),
                        manufacture_date: c.manufacture_date.clone(),
                        expiration_date: c.expiration_date.clone(),
                        path: None,
                    })
                    .map(|_| ())
                    .map_err(|e| e.to_string()),
            };
            match outcome {
                Ok(()) => res.coas_added += 1,
                Err(reason) => res.errors.push(RestoreError {
                    code: m.code.clone(),
                    lot_no: c.lot_no.clone(),
                    reason,
                }),
            }
        }
    }

    // Vừa nạp dữ liệu thì module phải đang bật, không thì người dùng không thấy gì.
    let _ = state.db.set_setting("feature_raw_materials", "1");

    Ok(res)
}

/// Đọc 1 entry trong zip. `enclosed_name` chặn path traversal của archive lạ.
fn read_zip_entry(
    archive: &mut zip::ZipArchive<std::io::Cursor<Vec<u8>>>,
    name: &str,
) -> Result<Vec<u8>, String> {
    use std::io::Read;

    let mut entry = archive
        .by_name(name)
        .map_err(|_| format!("thiếu file {name} trong bản sao lưu"))?;
    if entry.enclosed_name().is_none() {
        return Err(format!("tên file không hợp lệ: {name}"));
    }
    let mut buf = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
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

/// Đuôi file COA chấp nhận được (ảnh + PDF) và trần dung lượng mỗi file.
const COA_EXTS: [&str; 7] = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "pdf"];
const COA_MAX_BYTES: u64 = 20 * 1024 * 1024;
/// Trần số file 1 lần quét — thả nhầm thư mục gốc thì báo lỗi thay vì treo UI.
const COA_SCAN_LIMIT: usize = 1000;

/// 1 file COA ứng viên (chưa lưu) trả về cho bảng nhập liệu.
#[derive(serde::Serialize)]
struct CoaFileEntry {
    path: String,
    name: String,
}

/// File có đuôi hợp lệ và không quá `COA_MAX_BYTES`? Lỗi đọc metadata -> loại.
fn is_coa_file(p: &std::path::Path) -> bool {
    let ok_ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| COA_EXTS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false);
    ok_ext && std::fs::metadata(p).map(|m| m.len() <= COA_MAX_BYTES).unwrap_or(false)
}

/// Duyệt đệ quy 1 thư mục, gom file COA hợp lệ. Nhánh nào đọc lỗi thì bỏ qua (best-effort).
fn collect_coa_files(dir: &std::path::Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() > COA_SCAN_LIMIT {
            return;
        }
        let p = entry.path();
        if p.is_dir() {
            collect_coa_files(&p, out);
        } else if is_coa_file(&p) {
            out.push(p);
        }
    }
}

/// Quét danh sách đường dẫn (trộn file lẫn thư mục — từ kéo-thả hoặc hộp thoại) thành danh sách
/// file COA hợp lệ: thư mục duyệt **đệ quy**, lọc đuôi + dung lượng, khử trùng, sắp theo tên.
#[tauri::command]
fn scan_coa_files(paths: Vec<String>) -> Result<Vec<CoaFileEntry>, String> {
    let mut found: Vec<PathBuf> = Vec::new();
    for raw in &paths {
        let p = PathBuf::from(raw);
        if p.is_dir() {
            collect_coa_files(&p, &mut found);
        } else if is_coa_file(&p) {
            found.push(p);
        }
        if found.len() > COA_SCAN_LIMIT {
            return Err(format!(
                "Quá nhiều file (> {COA_SCAN_LIMIT}). Hãy chọn thư mục nhỏ hơn."
            ));
        }
    }

    let mut seen: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    let mut out: Vec<CoaFileEntry> = found
        .into_iter()
        .filter(|p| seen.insert(p.clone()))
        .map(|p| CoaFileEntry {
            name: p
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            path: p.to_string_lossy().to_string(),
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// 1 dòng trong bảng nhập COA hàng loạt: đường dẫn file gốc + số lô/ngày người dùng gõ.
#[derive(serde::Deserialize)]
struct CoaPathInput {
    path: String,
    lot_no: String,
    manufacture_date: Option<String>,
    expiration_date: Option<String>,
}

/// Tạo nhiều COA cùng lúc từ ĐƯỜNG DẪN (đọc bytes ở Rust — không đẩy file qua cầu IPC).
/// Best-effort: 1 file lỗi vẫn tiếp tục các file còn lại.
#[tauri::command]
fn create_coas_bulk_from_paths(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    raw_material_id: i64,
    items: Vec<CoaPathInput>,
) -> Result<CoaBulkResult, String> {
    let mut created = 0usize;
    let mut errors: Vec<CoaBulkError> = Vec::new();
    for it in &items {
        let src = std::path::Path::new(&it.path);
        let file_name = src
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| it.path.clone());
        // File có thể đã bị xoá/đổi tên sau khi thêm vào bảng -> báo đúng file đó rồi đi tiếp.
        let bytes = match std::fs::read(src) {
            Ok(b) => b,
            Err(e) => {
                errors.push(CoaBulkError {
                    file_name,
                    reason: e.to_string(),
                });
                continue;
            }
        };
        let payload = CreateCoaInput {
            raw_material_id,
            lot_no: it.lot_no.clone(),
            manufacture_date: it.manufacture_date.clone(),
            expiration_date: it.expiration_date.clone(),
            file_name: file_name.clone(),
            file_bytes: bytes,
        };
        match write_and_insert_coa(&app, &state.db, &payload) {
            Ok(_) => created += 1,
            Err(reason) => errors.push(CoaBulkError { file_name, reason }),
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

/// Mở 1 file theo đường dẫn TUYỆT ĐỐI bằng app mặc định OS — xem trước COA **chưa lưu**
/// (đang nằm ở thư mục gốc của người dùng, chưa chép vào `app_data_dir`).
#[tauri::command]
fn open_path_external(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .open_path(path, None::<String>)
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

/// Copy/zip danh sách COA vào `out_dir` (người dùng chọn): 1 file → copy thẳng; nhiều → nén 1 `.zip`
/// (mỗi entry `COA_<số lô>_<ngày SX>.<ext>`, thêm ` (n)` nếu trùng tên). Mở thư mục đích
/// và trả đường dẫn kết quả.
fn export_items_to_dir(
    app: &tauri::AppHandle,
    items: &[CoaItem],
    base_name: Option<String>,
    out_dir: &std::path::Path,
) -> Result<String, String> {
    use std::io::Write;

    let result = if items.len() == 1 {
        let (lot, mdate, edate, src, ext) = &items[0];
        let dest = unique_path(out_dir, &coa_stem(lot, mdate, edate), ext);
        std::fs::copy(src, &dest).map_err(|e| e.to_string())?;
        dest
    } else {
        let zip_base = sanitize_filename(&base_name.unwrap_or_else(|| "COA_export".to_string()));
        let zip_path = unique_path(out_dir, &zip_base, ".zip");
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

    // Mở thư mục đích cho tiện.
    let _ = app
        .opener()
        .open_path(out_dir.to_string_lossy().to_string(), None::<String>);

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

/// Tải các COA đã chọn (theo id) về thư mục `dir` người dùng chọn.
#[tauri::command]
fn download_coas(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    ids: Vec<i64>,
    base_name: Option<String>,
    dir: String,
) -> Result<String, String> {
    if ids.is_empty() {
        return Err("Chưa chọn COA nào".to_string());
    }
    let out_dir = std::path::PathBuf::from(&dir);
    if !out_dir.is_dir() {
        return Err("Thư mục lưu không hợp lệ".into());
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
    export_items_to_dir(&app, &items, Some(format!("COA_{base}")), &out_dir)
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
    dir: String,
) -> Result<ExportResult, String> {
    // Kiểm thư mục trước, khỏi parse CSV thừa.
    let out_dir = std::path::PathBuf::from(&dir);
    if !out_dir.is_dir() {
        return Err("Thư mục lưu không hợp lệ".into());
    }
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
    let path = export_items_to_dir(&app, &items, base_name, &out_dir)?;
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
    // Đang đồng bộ: luồng nền giữ bản sync_state cũ trong RAM và sẽ ghi đè -> chặn.
    if state.syncing.load(Ordering::Relaxed) {
        return Err("Đang đồng bộ, vui lòng thử lại sau khi đồng bộ xong".into());
    }
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

/// Cờ bật/tắt module Quản lý nguyên liệu & COA. Absent = bật (mặc định).
#[tauri::command]
fn get_feature_raw_materials(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state
        .db
        .get_setting("feature_raw_materials")
        .map_err(|e| e.to_string())?
        .as_deref()
        != Some("0"))
}

/// Bật/tắt module nguyên liệu & COA. Khi TẮT (`enabled=false`): xoá toàn bộ file COA
/// trên đĩa + dữ liệu raw_materials/coas (không khôi phục được) rồi lưu cờ.
#[tauri::command]
fn set_feature_raw_materials(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<(), String> {
    if !enabled {
        // Xoá cả thư mục coa (best-effort) — mọi file COA chỉ nằm ở đây.
        if let Ok(base) = app.path().app_data_dir() {
            let _ = std::fs::remove_dir_all(base.join("coa"));
        }
        state
            .db
            .delete_all_raw_materials_and_coas()
            .map_err(|e| e.to_string())?;
    }
    state
        .db
        .set_setting("feature_raw_materials", if enabled { "1" } else { "0" })
        .map_err(|e| e.to_string())
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
        .plugin(tauri_plugin_dialog::init())
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
                syncing: AtomicBool::new(false),
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
            get_username,
            is_syncing,
            get_sync_status,
            list_invoices,
            get_invoice_detail,
            download_invoices,
            download_invoices_from_csv,
            get_raw_material_by_id,
            list_raw_materials,
            create_raw_material,
            update_raw_material,
            list_coas,
            scan_coa_files,
            create_coas_bulk_from_paths,
            read_coa_file,
            open_coa_file,
            open_path_external,
            delete_coa,
            download_coas,
            download_coas_from_csv,
            backup_coas,
            restore_coas,
            get_floor,
            set_floor,
            get_feature_raw_materials,
            set_feature_raw_materials,
            disable_invoices,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn coa_key_normalizes_lot_and_dates() {
        let d = |s: &str| Some(s.to_string());
        // mm/yyyy và ISO yyyy-mm là MỘT (dữ liệu COA cũ lưu ISO).
        assert_eq!(
            coa_key("L1", &d("01/2026"), &None),
            coa_key("L1", &d("2026-01"), &None)
        );
        assert_eq!(
            coa_key("L1", &d("01/12/2025"), &None),
            coa_key("L1", &d("2025-12-01"), &None)
        );
        // Số lô: bỏ qua hoa/thường + khoảng trắng thừa.
        assert_eq!(coa_key(" l1 ", &None, &None), coa_key("L1", &None, &None));
        // Khác tháng / khác HSD -> khác khóa.
        assert_ne!(
            coa_key("L1", &d("01/2026"), &None),
            coa_key("L1", &d("02/2026"), &None)
        );
        assert_ne!(
            coa_key("L1", &d("01/2026"), &None),
            coa_key("L1", &d("01/2026"), &d("01/2027"))
        );
        // Ngày không parse được -> None, không làm nổ khóa.
        assert_eq!(coa_key("L1", &d("bad"), &None), coa_key("L1", &None, &None));
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
