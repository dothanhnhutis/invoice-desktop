use std::collections::HashMap;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};

use captcha_core::{
    CaptchaError, build_client, extract_sorted_paths, fetch_captcha, svg_preprocessing, wrap_path,
};

const DIR_DATASET: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/dataset");
// đã chạy thử 100 captcha và không thấy xuất hiện các ký tự [I, L, O, U, 0, 1]
// Site KHÔNG generate I, L, O, U, 0, 1 (các ký tự dễ nhầm) -> chỉ còn 30 ký tự.
const ALPHABET: &str = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

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
            "bg-green-500"
        } else if c == 0 {
            "bg-red-500"
        } else {
            "bg-yellow-500"
        };
        if ch != 'z' {
            grid.push_str(&format!(
                r#"<p class="{} rounded p-2">{} : (<b> {} </b>)</p>"#,
                cls, ch, c
            ));
        } else {
            grid.push_str(&format!(
                r#"<div class="grid lg:grid-cols-subgrid lg:col-span-3"><p class="{} rounded p-2">{} : (<b> {} </b>)</p></div>"#,
                cls, ch, c
            ));
        }
    }
    let done = ALPHABET
        .chars()
        .filter(|c| counts.get(c).copied().unwrap_or(0) >= target)
        .count();
    let total = ALPHABET.chars().count();

    let html = format!(
        r#"<!doctype html>
<html lang="en">

<head>
  <meta charset="UTF-8" />
  <meta http-equiv="refresh" content="1">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <title>Captcha label</title>
</head>

<body>
  <main class="bg-taupe-700 text-white h-screen">
    <div class="container mx-auto p-4 pb-10">
      <h2 class="text-2xl bold text-center">
        Thu thập và gắn nhãn cho captcha
      </h2>

      <div class="space-y-2">
        <h3>Ảnh gốc</h3>
        <div class="bg-white p-2 rounded inline-block">
          {orig}
        </div>
        <h3>Đã xử lý (bỏ nhiễu + sort trái→phải)</h3>
        <div class="bg-white p-2 rounded inline-block">
          {processed}
        </div>
        <h3>Tiến độ: {done}/{total} ký tự đã đủ (mục tiêu n = {target})</h3>
        <div class="grid lg:grid-cols-8 gap-4 sm:grid-cols-3">
          {grid}
        </div>
      </div>
    </div>
  </main>
</body>

</html>"#
    );

    let path = Path::new(DIR_DATASET).join("preview.html");
    std::fs::write(&path, html)?;
    Ok(path)
}

// ---------------------------------------------------------------------------
// Thu thập + gán nhãn
// ---------------------------------------------------------------------------

async fn build_dataset(target: usize) -> Result<(), CaptchaError> {
    let client = build_client()?;

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
