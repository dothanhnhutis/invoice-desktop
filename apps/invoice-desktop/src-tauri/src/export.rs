//! Giải nén ZIP bản thể hiện hóa đơn (từ GDT) và render `invoice.html` -> PDF
//! bằng cách gọi Edge/Chrome ở chế độ headless (`--print-to-pdf`).

use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Giải nén toàn bộ entry của ZIP `bytes` ra thư mục `dir` (phẳng theo cấu trúc trong zip).
pub fn extract_zip_to(bytes: &[u8], dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| format!("zip lỗi: {e}"))?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        // `enclosed_name` chặn path traversal (../). Bỏ qua entry tên không hợp lệ.
        let Some(rel) = entry.enclosed_name() else {
            continue;
        };
        let out = dir.join(rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut buf = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        std::fs::write(&out, &buf).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Tìm trình duyệt Chromium (Edge/Chrome) trên Windows để render PDF. None nếu không có.
pub fn find_browser() -> Option<PathBuf> {
    // Cho phép ép đường dẫn qua biến môi trường (ưu tiên cao nhất).
    if let Ok(p) = std::env::var("INVOICE_BROWSER") {
        let p = PathBuf::from(p);
        if p.exists() {
            return Some(p);
        }
    }
    let pf = std::env::var("ProgramFiles").ok();
    let pf86 = std::env::var("ProgramFiles(x86)").ok();
    let local = std::env::var("LOCALAPPDATA").ok();
    let mut candidates: Vec<PathBuf> = Vec::new();
    let mut push = |base: &Option<String>, rel: &str| {
        if let Some(b) = base {
            candidates.push(PathBuf::from(b).join(rel));
        }
    };
    push(&pf86, r"Microsoft\Edge\Application\msedge.exe");
    push(&pf, r"Microsoft\Edge\Application\msedge.exe");
    push(&pf, r"Google\Chrome\Application\chrome.exe");
    push(&pf86, r"Google\Chrome\Application\chrome.exe");
    push(&local, r"Google\Chrome\Application\chrome.exe");
    push(&local, r"Microsoft\Edge\Application\msedge.exe");
    candidates.into_iter().find(|p| p.exists())
}

/// Đường dẫn tuyệt đối -> URL `file:///...` (forward-slash) cho trình duyệt.
fn file_url(path: &Path) -> String {
    let s = path.to_string_lossy().replace('\\', "/");
    if s.starts_with('/') {
        format!("file://{s}")
    } else {
        format!("file:///{s}")
    }
}

/// Render `html_path` -> `out_pdf` bằng trình duyệt headless. Trả về bytes PDF đã đọc lại.
pub fn html_to_pdf(browser: &Path, html_path: &Path, out_pdf: &Path) -> Result<Vec<u8>, String> {
    let status = Command::new(browser)
        .arg("--headless=new")
        .arg("--disable-gpu")
        .arg("--no-pdf-header-footer")
        // Cho JS (vẽ QR trong details.js) kịp chạy trước khi in.
        .arg("--virtual-time-budget=3000")
        .arg(format!("--print-to-pdf={}", out_pdf.to_string_lossy()))
        .arg(file_url(html_path))
        .status()
        .map_err(|e| format!("không chạy được trình duyệt: {e}"))?;
    if !status.success() {
        return Err(format!("trình duyệt thoát mã {:?}", status.code()));
    }
    std::fs::read(out_pdf).map_err(|e| format!("không đọc được PDF: {e}"))
}
