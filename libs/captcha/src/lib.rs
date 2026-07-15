//! captcha-core — logic dùng chung cho tool gán nhãn (apps/captcha) và desktop (Tauri).
//!
//! Module:
//! - [`error`]  : kiểu lỗi [`CaptchaError`].
//! - [`svg`]    : tiền xử lý SVG (bỏ nhiễu, sort path, tách/bọc path).
//! - [`fetch`]  : tải captcha từ API.
//! - [`solver`] : chuẩn hóa ảnh + nhận dạng ([`Solver`]).

pub mod error;
pub mod fetch;
pub mod solver;
pub mod svg;

pub use error::CaptchaError;
pub use fetch::{CaptchaResp, build_client, fetch_captcha};
pub use solver::{NORM, Solver, raster_binary};
pub use svg::{extract_sorted_paths, svg_preprocessing, wrap_path};
