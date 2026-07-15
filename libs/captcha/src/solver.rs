//! Chuẩn hóa SVG → ảnh nhị phân 64x64 và nhận dạng captcha bằng so khớp template (IoU).

use std::collections::HashMap;
use std::path::Path;

use image::{
    GrayImage, Luma,
    imageops::{self, FilterType},
};
use imageproc::distance_transform::Norm;
use resvg::tiny_skia::{Color, Pixmap, Transform};
use resvg::usvg::{Options, Tree};

use crate::error::CaptchaError;
use crate::svg::{extract_sorted_paths, svg_preprocessing, wrap_path};

// --- tham số chuẩn hóa (PHẢI giống nhau ở build và nhận dạng) ---------------
/// Kích thước khung chuẩn (ô vuông NORM x NORM).
pub const NORM: u32 = 64;
const RW: u32 = 800; // render width  (200 * 4)
const RH: u32 = 160; // render height (40  * 4)
const DILATE: u8 = 2; // độ nở nét khi so khớp

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

/// SVG hoàn chỉnh → nhị phân 64x64 (crop bbox + resize). Chưa dilate.
pub fn raster_binary(svg: &str) -> GrayImage {
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

/// Bộ nhận dạng: giữ sẵn các template (đã dilate) theo từng ký tự.
pub struct Solver {
    templates: HashMap<char, GrayImage>, // đã dilate sẵn
}

impl Solver {
    /// Nạp template từ thư mục chứa các file `<ký_tự>.png`.
    /// Với Tauri, truyền đường dẫn thư mục resource đã được đóng gói.
    ///
    /// Panic nếu thư mục không đọc được — dùng [`Solver::try_load`] khi cần xử lý lỗi.
    pub fn load(dir: impl AsRef<Path>) -> Self {
        Self::try_load(dir).expect("nạp templates thất bại")
    }

    /// Như [`Solver::load`] nhưng trả lỗi thay vì panic (cho desktop / reload nóng).
    pub fn try_load(dir: impl AsRef<Path>) -> Result<Self, CaptchaError> {
        let mut templates = HashMap::new();
        for e in std::fs::read_dir(dir.as_ref())?.flatten() {
            let p = e.path();
            if p.extension().map_or(false, |x| x == "png") {
                let stem = p.file_stem().unwrap().to_string_lossy().to_string();
                if stem.chars().count() == 1 {
                    let ch = stem.chars().next().unwrap();
                    let img = image::open(&p)
                        .map_err(|err| CaptchaError::Conflict(err.to_string()))?
                        .to_luma8();
                    templates.insert(ch, dilate(&img));
                }
            }
        }
        Ok(Self { templates })
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
