//! Tải captcha từ API hoá đơn điện tử.

use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::error::CaptchaError;

pub const CAPTCHA_URL: &str = "https://hoadondientu.gdt.gov.vn/api/captcha";

#[derive(Deserialize, Debug, Serialize)]
pub struct CaptchaResp {
    pub key: String,
    pub content: String, // SVG string
}

/// Tạo `reqwest::Client` có cookie store + user-agent phù hợp để gọi API captcha.
pub fn build_client() -> Result<Client, CaptchaError> {
    let client = Client::builder()
        .cookie_store(true)
        .user_agent("Mozilla/5.0 (captcha-labeler)")
        .build()?;
    Ok(client)
}

/// Gọi API lấy 1 captcha (key + nội dung SVG).
pub async fn fetch_captcha(client: &Client) -> Result<CaptchaResp, CaptchaError> {
    let resp = client
        .get(CAPTCHA_URL)
        .send()
        .await?
        .json::<CaptchaResp>()
        .await?;
    Ok(resp)
}
