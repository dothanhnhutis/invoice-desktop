// solver.rs — công cụ dev: build template + kiểm định độ chính xác.
//
// Logic nhận dạng (rasterize, Solver, ...) nằm ở crate `captcha-core`.
// Bin này chỉ lo phần workflow gắn với thư mục dataset trên máy dev.
//
// Chạy:
//   cargo run --bin solver -- build      # đọc dataset/chars/* -> templates/*.png
//   cargo run --bin solver -- eval       # đo độ chính xác trên dataset/raw/*
//   cargo run --bin solver -- solve f.svg

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use image::{GrayImage, Luma};

use captcha_core::{NORM, Solver, raster_binary};

// Neo theo crate (baked lúc compile) — không phụ thuộc thư mục đang chạy lệnh.
const DIR_DATASET: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/dataset");
// Nơi mặc định ghi/đọc template = chỗ desktop (Tauri) sẽ bundle.
const DIR_TMPL: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../invoice-desktop/src-tauri/templates"
);

fn dir_chars() -> PathBuf {
    Path::new(DIR_DATASET).join("chars")
}
fn dir_raw() -> PathBuf {
    Path::new(DIR_DATASET).join("raw")
}

// ---------------------------------------------------------------------------
// Build template: trung bình các mẫu -> pixel nào xuất hiện ở > 50% mẫu.
// ---------------------------------------------------------------------------

fn build_templates(out: &Path) {
    std::fs::create_dir_all(out).unwrap();
    let mut entries: Vec<_> = std::fs::read_dir(dir_chars())
        .expect("thiếu dataset/chars")
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    entries.sort();

    for dir in entries {
        let name = dir.file_name().unwrap().to_string_lossy().to_string();
        if name.chars().count() != 1 {
            continue;
        }
        let ch = name.chars().next().unwrap();

        let mut acc = vec![0u32; (NORM * NORM) as usize];
        let mut count = 0u32;
        for f in std::fs::read_dir(&dir).unwrap().flatten() {
            let p = f.path();
            if p.extension().map_or(false, |e| e == "svg") {
                let svg = std::fs::read_to_string(&p).unwrap();
                let bin = raster_binary(&svg);
                for (i, px) in bin.pixels().enumerate() {
                    if px.0[0] > 127 {
                        acc[i] += 1;
                    }
                }
                count += 1;
            }
        }
        if count == 0 {
            continue;
        }

        let mut tmpl = GrayImage::new(NORM, NORM);
        for (i, v) in acc.iter().enumerate() {
            let x = (i as u32) % NORM;
            let y = (i as u32) / NORM;
            let on = *v * 2 > count; // > 50% mẫu
            tmpl.put_pixel(x, y, Luma([if on { 255 } else { 0 }]));
        }
        tmpl.save(out.join(format!("{}.png", ch))).unwrap();
        println!("template {}  <- {} mẫu", ch, count);
    }
    println!("Đã build xong {}", out.display());
}

// ---------------------------------------------------------------------------
// Kiểm định trên dataset/raw/*.svg + .txt
// ---------------------------------------------------------------------------

fn evaluate() {
    let solver = Solver::load(DIR_TMPL);

    let mut total = 0;
    let mut ok_full = 0; // đúng cả chuỗi
    let mut total_ch = 0;
    let mut ok_ch = 0; // đúng từng ký tự
    let mut confus: HashMap<(char, char), u32> = HashMap::new(); // (đúng, đoán) -> số lần

    for e in std::fs::read_dir(dir_raw())
        .expect("thiếu dataset/raw")
        .flatten()
    {
        let p = e.path();
        if p.extension().map_or(false, |x| x == "svg") {
            let label_path = p.with_extension("txt");
            if !label_path.exists() {
                continue;
            }
            let svg = std::fs::read_to_string(&p).unwrap();
            let truth = std::fs::read_to_string(&label_path)
                .unwrap()
                .trim()
                .to_uppercase();
            let (pred, _margin) = solver.solve(&svg);

            total += 1;
            if pred == truth {
                ok_full += 1;
            }
            for (t, g) in truth.chars().zip(pred.chars()) {
                total_ch += 1;
                if t == g {
                    ok_ch += 1;
                } else {
                    *confus.entry((t, g)).or_insert(0) += 1;
                }
            }
            if pred != truth {
                println!("SAI  thật={}  đoán={}  ({})", truth, pred, p.display());
            }
        }
    }

    println!("\n===== KẾT QUẢ =====");
    println!(
        "Đúng cả chuỗi : {}/{} = {:.1}%",
        ok_full,
        total,
        100.0 * ok_full as f32 / total.max(1) as f32
    );
    println!(
        "Đúng từng ký tự: {}/{} = {:.2}%",
        ok_ch,
        total_ch,
        100.0 * ok_ch as f32 / total_ch.max(1) as f32
    );

    if !confus.is_empty() {
        println!("\nCác cặp nhầm nhiều nhất (thật -> đoán):");
        let mut v: Vec<_> = confus.into_iter().collect();
        v.sort_by(|a, b| b.1.cmp(&a.1));
        for ((t, g), n) in v.into_iter().take(15) {
            println!("  {} -> {}   x{}", t, g, n);
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(|s| s.as_str()) {
        Some("build") => {
            // `solver build [--out <dir>]` — mặc định ghi vào DIR_TMPL (chỗ desktop bundle).
            let out = match args.iter().position(|a| a == "--out") {
                Some(i) => PathBuf::from(args.get(i + 1).expect("--out cần đường dẫn")),
                None => PathBuf::from(DIR_TMPL),
            };
            build_templates(&out);
        }
        Some("eval") => evaluate(),
        Some("solve") => {
            let file = args.get(2).expect("cần đường dẫn .svg");
            let svg = std::fs::read_to_string(file).unwrap();
            let solver = Solver::load(DIR_TMPL);
            let (code, margin) = solver.solve(&svg);
            println!("mã = {}   (margin = {:.3})", code, margin);
        }
        _ => {
            eprintln!("dùng: solver [build [--out <dir>] | eval | solve <file.svg>]");
        }
    }
}
