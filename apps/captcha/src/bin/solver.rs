// solver.rs — build template + nhận dạng + kiểm định
//
// Cargo.toml cần thêm:
//   resvg     = "0.44"
//   image     = "0.25"
//   imageproc = "0.25"
//   regex     = "1"
//
// Chạy:
//   cargo run --bin solver -- build      # đọc dataset/chars/* -> templates/*.png
//   cargo run --bin solver -- eval       # đo độ chính xác trên dataset/raw/*
//   cargo run --bin solver -- solve f.svg

use std::collections::HashMap;
use std::path::Path;

use image::{
    GrayImage, Luma,
    imageops::{self, FilterType},
};
use imageproc::distance_transform::Norm;
use regex::Regex;
use resvg::tiny_skia::{Color, Pixmap, Transform};
use resvg::usvg::{Options, Tree};

// --- tham số chuẩn hóa (PHẢI giống nhau ở build và nhận dạng) ---------------
const NORM: u32 = 64; // kích thước khung chuẩn
const RW: u32 = 800; // render width  (200 * 4)
const RH: u32 = 160; // render height (40  * 4)
const DILATE: u8 = 2; // độ nở nét khi so khớp

const DIR_CHARS: &str = "dataset/chars";
const DIR_RAW: &str = "dataset/raw";
const DIR_TMPL: &str = "templates";

// ---------------------------------------------------------------------------
// Tiền xử lý SVG (giống label_tool.rs)
// ---------------------------------------------------------------------------

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

fn svg_preprocessing(content: &str) -> String {
    let re = Regex::new(r#"<path\s+[^>]*fill="none"[^>]*\s*\/?>"#).unwrap();
    re.replace_all(content, "").to_string()
}

fn wrap_path(path: &str) -> String {
    format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 40">{}</svg>"#,
        path
    )
}

// ---------------------------------------------------------------------------
// Chuẩn hóa: SVG -> ảnh nhị phân 64x64 (nét = 255). KHÔNG dilate ở bước này.
// ---------------------------------------------------------------------------

fn rasterize(svg: &str) -> GrayImage {
    let tree = Tree::from_str(svg, &Options::default()).expect("parse svg");
    let mut pm = Pixmap::new(RW, RH).unwrap();
    pm.fill(Color::WHITE);
    let sx = RW as f32 / 200.0;
    let sy = RH as f32 / 40.0;
    resvg::render(&tree, Transform::from_scale(sx, sy), &mut pm.as_mut());

    let mut g = GrayImage::new(RW, RH);
    for y in 0..RH {
        for x in 0..RW {
            let p = pm.pixel(x, y).unwrap();
            let v = ((p.red() as u16 + p.green() as u16 + p.blue() as u16) / 3) as u8;
            g.put_pixel(x, y, Luma([v]));
        }
    }
    g
}

/// SVG hoàn chỉnh -> nhị phân 64x64 (crop bbox + resize). Chưa dilate.
fn raster_binary(svg: &str) -> GrayImage {
    let g = rasterize(svg);

    let (mut x0, mut y0, mut x1, mut y1) = (u32::MAX, u32::MAX, 0u32, 0u32);
    for y in 0..g.height() {
        for x in 0..g.width() {
            if g.get_pixel(x, y).0[0] < 200 {
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x);
                y1 = y1.max(y);
            }
        }
    }
    if x0 == u32::MAX {
        return GrayImage::from_pixel(NORM, NORM, Luma([0]));
    }

    let crop = imageops::crop_imm(&g, x0, y0, x1 - x0 + 1, y1 - y0 + 1).to_image();
    let resized = imageops::resize(&crop, NORM, NORM, FilterType::Lanczos3);

    let mut bin = GrayImage::new(NORM, NORM);
    for (x, y, p) in resized.enumerate_pixels() {
        bin.put_pixel(x, y, Luma([if p.0[0] < 128 { 255 } else { 0 }]));
    }
    bin
}

fn dilate(img: &GrayImage) -> GrayImage {
    imageproc::morphology::dilate(img, Norm::LInf, DILATE)
}

fn iou(a: &GrayImage, b: &GrayImage) -> f32 {
    let (mut inter, mut union) = (0u32, 0u32);
    for (pa, pb) in a.pixels().zip(b.pixels()) {
        let ba = pa.0[0] > 127;
        let bb = pb.0[0] > 127;
        if ba && bb {
            inter += 1;
        }
        if ba || bb {
            union += 1;
        }
    }
    if union == 0 {
        0.0
    } else {
        inter as f32 / union as f32
    }
}

// ---------------------------------------------------------------------------
// Build template: trung bình các mẫu -> pixel nào xuất hiện ở > 50% mẫu.
// ---------------------------------------------------------------------------

fn build_templates() {
    std::fs::create_dir_all(DIR_TMPL).unwrap();
    let mut entries: Vec<_> = std::fs::read_dir(DIR_CHARS)
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
        tmpl.save(format!("{}/{}.png", DIR_TMPL, ch)).unwrap();
        println!("template {}  <- {} mẫu", ch, count);
    }
    println!("Đã build xong templates/");
}

// ---------------------------------------------------------------------------
// Nhận dạng
// ---------------------------------------------------------------------------

pub struct Solver {
    templates: HashMap<char, GrayImage>, // đã dilate sẵn
}

impl Solver {
    pub fn load(dir: &str) -> Self {
        let mut templates = HashMap::new();
        for e in std::fs::read_dir(dir).expect("thiếu templates/").flatten() {
            let p = e.path();
            if p.extension().map_or(false, |x| x == "png") {
                let stem = p.file_stem().unwrap().to_string_lossy().to_string();
                if stem.chars().count() == 1 {
                    let ch = stem.chars().next().unwrap();
                    let img = image::open(&p).unwrap().to_luma8();
                    templates.insert(ch, dilate(&img));
                }
            }
        }
        Self { templates }
    }

    /// Trả về (chuỗi đoán, margin nhỏ nhất giữa top-1 và top-2).
    pub fn solve(&self, captcha_svg: &str) -> (String, f32) {
        let processed = svg_preprocessing(captcha_svg);
        let paths = extract_sorted_paths(&processed);

        let mut out = String::new();
        let mut min_margin = 1.0f32;

        for path in paths {
            let q = dilate(&raster_binary(&wrap_path(&path)));
            let mut scored: Vec<(char, f32)> = self
                .templates
                .iter()
                .map(|(c, t)| (*c, iou(&q, t)))
                .collect();
            scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

            out.push(scored[0].0);
            let margin = scored[0].1 - scored.get(1).map(|x| x.1).unwrap_or(0.0);
            min_margin = min_margin.min(margin);
        }
        (out, min_margin)
    }
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

    for e in std::fs::read_dir(DIR_RAW)
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
        Some("build") => build_templates(),
        Some("eval") => evaluate(),
        Some("solve") => {
            let file = args.get(2).expect("cần đường dẫn .svg");
            let svg = std::fs::read_to_string(file).unwrap();
            let solver = Solver::load(DIR_TMPL);
            let (code, margin) = solver.solve(&svg);
            println!("mã = {}   (margin = {:.3})", code, margin);
        }
        _ => {
            eprintln!("dùng: solver [build | eval | solve <file.svg>]");
        }
    }
}
