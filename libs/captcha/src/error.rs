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
