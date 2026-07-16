use reqwest::Client;

/// Tạo client dùng chung: giữ cookie + User-Agent giống trình duyệt.
pub fn make_client() -> Client {
    Client::builder()
        .cookie_store(true)
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        )
        .build()
        .expect("build client")
}
