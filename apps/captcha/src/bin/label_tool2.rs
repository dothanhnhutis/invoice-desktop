use std::collections::HashMap;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};

use regex::Regex;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio;

const CAPTCHA_URL: &str = "https://hoadondientu.gdt.gov.vn/api/captcha";
const DIR_DATASET: &str = "dataset";
// Site KHÔNG generate I, L, O, U, 0, 1 (các ký tự dễ nhầm) -> chỉ còn 30 ký tự.
const ALPHABET: &str = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

#[derive(Debug, thiserror::Error)]
pub enum CaptchaError {
    #[error("fetch captcha thất bại: {0}")]
    RequestError(String),

    #[error("Tạo thư mục thất bại: {0}")]
    CreateDirError(String),

    #[error("{0}")]
    Conflict(String),
}

impl From<reqwest::Error> for CaptchaError {
    fn from(error: reqwest::Error) -> Self {
        Self::RequestError(error.to_string())
    }
}

impl From<std::io::Error> for CaptchaError {
    fn from(error: std::io::Error) -> Self {
        Self::CreateDirError(error.to_string())
    }
}

#[derive(Deserialize, Debug, Serialize)]
pub struct CaptchaResp {
    key: String,
    content: String, // SVG string
}

async fn fetch_captcha(client: &Client) -> Result<CaptchaResp, CaptchaError> {
    let resp = client
        .get(CAPTCHA_URL)
        .send()
        .await?
        .json::<CaptchaResp>()
        .await?;
    Ok(resp)
}

// ---------------------------------------------------------------------------
// Xử lý SVG: bỏ nhiễu + sort path trái -> phải
// ---------------------------------------------------------------------------

fn sort_simple_svg(content: &str) -> String {
    let re_path = Regex::new(r#"(?s)<path\b[^>]*/>|<path\b[^>]*>.*?</path>"#).unwrap();
    let re_x = Regex::new(r#"d\s*=\s*"\s*[Mm]\s*[,\s]*(-?[0-9]*\.?[0-9]+)"#).unwrap();

    let mut paths: Vec<(f32, String)> = re_path
        .find_iter(content)
        .map(|m| {
            let s = m.as_str();
            let x = re_x
                .captures(s)
                .and_then(|c| c.get(1))
                .and_then(|g| g.as_str().parse::<f32>().ok())
                .unwrap_or(f32::MAX);
            (x, s.to_string())
        })
        .collect();

    if paths.is_empty() {
        return content.to_string();
    }

    paths.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

    let first_start = re_path.find(content).map(|m| m.start()).unwrap();
    let last_end = re_path.find_iter(content).last().map(|m| m.end()).unwrap();

    let prefix = &content[..first_start];
    let suffix = &content[last_end..];
    let body: String = paths.into_iter().map(|(_, s)| s).collect();

    format!("{}{}{}", prefix, body, suffix)
}

fn svg_preprocessing(content: &str) -> String {
    let regex = Regex::new(r#"<path\s+[^>]*fill="none"[^>]*\s*\/?>"#).unwrap();
    let svg_no_noise = regex.replace_all(content, "");
    sort_simple_svg(&svg_no_noise)
}

/// Tách các <path> đã sort trái -> phải, trả về danh sách chuỗi path.
fn extract_sorted_paths(content: &str) -> Vec<String> {
    let re_path = Regex::new(r#"(?s)<path\b[^>]*/>|<path\b[^>]*>.*?</path>"#).unwrap();
    let re_x = Regex::new(r#"d\s*=\s*"\s*[Mm]\s*[,\s]*(-?[0-9]*\.?[0-9]+)"#).unwrap();

    let mut paths: Vec<(f32, String)> = re_path
        .find_iter(content)
        .map(|m| {
            let s = m.as_str();
            let x = re_x
                .captures(s)
                .and_then(|c| c.get(1))
                .and_then(|g| g.as_str().parse::<f32>().ok())
                .unwrap_or(f32::MAX);
            (x, s.to_string())
        })
        .collect();

    paths.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    paths.into_iter().map(|(_, s)| s).collect()
}

/// Bọc 1 path đơn lẻ thành SVG hoàn chỉnh để lưu làm mẫu.
fn wrap_path(path: &str) -> String {
    format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40" viewBox="0 0 200 40">{}</svg>"#,
        path
    )
}

// ---------------------------------------------------------------------------
// Đếm mẫu & tiến độ
// ---------------------------------------------------------------------------

/// Quét thư mục dataset/chars/<C>/ để đếm số mẫu hiện có mỗi ký tự (resume được).
fn load_counts() -> HashMap<char, usize> {
    let mut counts: HashMap<char, usize> = ALPHABET.chars().map(|c| (c, 0usize)).collect();
    let chars_dir = Path::new(DIR_DATASET).join("chars");
    if let Ok(entries) = std::fs::read_dir(&chars_dir) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.chars().count() == 1 && e.path().is_dir() {
                let ch = name.chars().next().unwrap();
                let cnt = std::fs::read_dir(e.path())
                    .map(|it| it.filter(|x| x.is_ok()).count())
                    .unwrap_or(0);
                counts.insert(ch, cnt);
            }
        }
    }
    counts
}

/// Số thứ tự tiếp theo cho 1 captcha (đếm số file .svg trong dataset/raw).
fn next_seq() -> usize {
    let raw = Path::new(DIR_DATASET).join("raw");
    std::fs::read_dir(&raw)
        .map(|it| {
            it.filter(|e| {
                e.as_ref()
                    .map(|x| x.path().extension().map_or(false, |ext| ext == "svg"))
                    .unwrap_or(false)
            })
            .count()
        })
        .unwrap_or(0)
}

/// In lưới tiến độ ra terminal.
fn print_counts(counts: &HashMap<char, usize>, target: usize) {
    println!();
    let mut cols = 0;
    for ch in ALPHABET.chars() {
        let c = counts.get(&ch).copied().unwrap_or(0);
        let mark = if c >= target { '✓' } else { ' ' };
        print!("{}{}:{:<2} ", mark, ch, c);
        cols += 1;
        if cols % 9 == 0 {
            println!();
        }
    }
    if cols % 9 != 0 {
        println!();
    }
    let missing: Vec<String> = ALPHABET
        .chars()
        .filter(|c| counts.get(c).copied().unwrap_or(0) < target)
        .map(|c| format!("{}({})", c, counts.get(&c).copied().unwrap_or(0)))
        .collect();
    if missing.is_empty() {
        println!("→ tất cả ký tự đã đủ {} mẫu.", target);
    } else {
        println!("còn thiếu ({}): {}", missing.len(), missing.join(" "));
    }
}

/// Ghi trang preview.html: ảnh gốc + ảnh đã xử lý + lưới 36 ký tự (tự refresh).
fn write_preview(
    orig: &str,
    processed: &str,
    counts: &HashMap<char, usize>,
    target: usize,
) -> io::Result<PathBuf> {
    let mut grid = String::new();
    for ch in ALPHABET.chars() {
        let c = counts.get(&ch).copied().unwrap_or(0);
        let cls = if c >= target {
            "done"
        } else if c == 0 {
            "zero"
        } else {
            "partial"
        };
        grid.push_str(&format!(
            r#"<span class="cell {}">{} <b>{}</b></span>"#,
            cls, ch, c
        ));
    }
    let done = ALPHABET
        .chars()
        .filter(|c| counts.get(c).copied().unwrap_or(0) >= target)
        .count();
    let total = ALPHABET.chars().count();

    let html = format!(
        r#"<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="refresh" content="2">
<title>captcha labeler</title>
<style>
body{{font-family:system-ui,Arial;margin:20px;background:#141414;color:#eee}}
h3{{margin:14px 0 4px;font-weight:600}}
.box{{background:#fff;display:inline-block;padding:10px;border-radius:8px}}
.box svg{{width:520px;height:104px}}
.grid{{display:grid;grid-template-columns:repeat(9,1fr);gap:6px;max-width:760px;margin-top:8px}}
.cell{{padding:8px 4px;text-align:center;border-radius:5px;font-size:14px;background:#333}}
.cell.done{{background:#1f7a1f}}
.cell.partial{{background:#7a6a1f}}
.cell.zero{{background:#7a1f1f}}
.cell b{{font-size:17px}}
</style></head><body>
<h3>Ảnh gốc</h3><div class="box">{orig}</div>
<h3>Đã xử lý (bỏ nhiễu + sort trái→phải)</h3><div class="box">{processed}</div>
<h3>Tiến độ: {done}/{total} ký tự đã đủ (mục tiêu n = {target})</h3>
<div class="grid">{grid}</div>
</body></html>"#
    );

    let path = Path::new(DIR_DATASET).join("preview.html");
    std::fs::write(&path, html)?;
    Ok(path)
}

// ---------------------------------------------------------------------------
// Thu thập + gán nhãn
// ---------------------------------------------------------------------------

async fn build_dataset(target: usize) -> Result<(), CaptchaError> {
    let client: Client = Client::builder()
        .cookie_store(true)
        .user_agent("Mozilla/5.0 (captcha-labeler)")
        .build()?;

    std::fs::create_dir_all(Path::new(DIR_DATASET).join("raw"))?;
    for ch in ALPHABET.chars() {
        std::fs::create_dir_all(Path::new(DIR_DATASET).join("chars").join(ch.to_string()))?;
    }

    let mut counts = load_counts();
    let stdin = io::stdin();
    let mut line = String::new();
    let mut opened = false;

    loop {
        // Điều kiện dừng: mọi ký tự trong ALPHABET đã đạt >= target
        if ALPHABET
            .chars()
            .all(|c| counts.get(&c).copied().unwrap_or(0) >= target)
        {
            println!(
                "\n✅ Đủ {} mẫu cho tất cả {} ký tự. Dừng.",
                target,
                ALPHABET.chars().count()
            );
            break;
        }

        let c = fetch_captcha(&client).await?;
        let processed = svg_preprocessing(&c.content);
        let paths = extract_sorted_paths(&processed);

        // Cập nhật preview (tự refresh mỗi 2s trong browser)
        let preview = write_preview(&c.content, &processed, &counts, target)?;
        if !opened {
            let _ = open::that(&preview);
            opened = true;
        }

        print_counts(&counts, target);
        println!(
            "captcha có {} ký tự | gõ nhãn, 'skip' bỏ qua, 'quit' để dừng",
            paths.len()
        );
        print!("nhãn = ");
        io::stdout().flush()?;

        line.clear();
        stdin.lock().read_line(&mut line)?;
        let label = line.trim().to_uppercase();

        if label == "QUIT" {
            println!("Đã dừng theo yêu cầu.");
            break;
        }
        if label.is_empty() || label == "SKIP" {
            continue;
        }

        // Kiểm tra hợp lệ
        if label.chars().count() != paths.len() {
            println!(
                "⚠️  nhãn {} ký tự nhưng captcha có {} path — bỏ qua.\n",
                label.chars().count(),
                paths.len()
            );
            continue;
        }
        if let Some(bad) = label.chars().find(|c| !ALPHABET.contains(*c)) {
            println!("⚠️  ký tự '{}' không có trong bảng chữ — bỏ qua.\n", bad);
            continue;
        }

        // Lưu captcha gốc + nhãn
        let seq = next_seq();
        std::fs::write(
            Path::new(DIR_DATASET)
                .join("raw")
                .join(format!("{:04}.svg", seq)),
            &c.content,
        )?;
        std::fs::write(
            Path::new(DIR_DATASET)
                .join("raw")
                .join(format!("{:04}.txt", seq)),
            &label,
        )?;

        // Lưu mẫu từng ký tự: dataset/chars/<C>/<seq>_<pos>.svg
        for (pos, (ch, path)) in label.chars().zip(paths.iter()).enumerate() {
            let dir = Path::new(DIR_DATASET).join("chars").join(ch.to_string());
            std::fs::write(dir.join(format!("{:04}_{}.svg", seq, pos)), wrap_path(path))?;
            *counts.entry(ch).or_insert(0) += 1;
        }
        println!("→ đã lưu: {}\n", label);

        tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
    }

    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), CaptchaError> {
    // n lấy từ tham số dòng lệnh, mặc định 1.  Ví dụ:  cargo run -- 2
    let target: usize = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(1);

    println!(
        "Mục tiêu: mỗi ký tự ≥ {} mẫu. Mở preview.html trong browser để xem; gõ 'quit' để dừng sớm.",
        target
    );
    build_dataset(target).await?;
    Ok(())
}
