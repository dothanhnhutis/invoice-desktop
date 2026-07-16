//! hddt — client đăng nhập + gọi API hoadondientu.gdt.gov.vn.
//!
//! - [`client`] : tạo `reqwest::Client` (giữ cookie, user-agent trình duyệt).
//! - [`auth`]   : [`login`] tự giải captcha, retry AN TOÀN (tránh khóa tài khoản).

pub mod api;
pub mod auth;
pub mod client;

pub use api::{Page, QueryError, query_purchase};
pub use auth::{LoginError, login};
pub use client::make_client;

/// Base URL của cổng hóa đơn điện tử.
pub(crate) const BASE: &str = "https://hoadondientu.gdt.gov.vn";
