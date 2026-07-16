//! Lưu credential đăng nhập ở OS keychain (Windows Credential Manager) qua `keyring`.
//! KHÔNG lưu mật khẩu thuế xuống SQLite/plaintext.

use keyring::Entry;

const SERVICE: &str = "com.thanhnhut.invoice-desktop";

fn entry(account: &str) -> keyring::Result<Entry> {
    Entry::new(SERVICE, account)
}

/// Lưu (ghi đè) username + password.
pub fn save(username: &str, password: &str) -> keyring::Result<()> {
    entry("username")?.set_password(username)?;
    entry("password")?.set_password(password)?;
    Ok(())
}

/// Đọc credential đã lưu; None nếu chưa có.
pub fn load() -> Option<(String, String)> {
    let username = entry("username").ok()?.get_password().ok()?;
    let password = entry("password").ok()?.get_password().ok()?;
    Some((username, password))
}

/// Xóa credential (đăng xuất / đổi tài khoản).
pub fn clear() -> keyring::Result<()> {
    if let Ok(e) = entry("username") {
        let _ = e.delete_credential();
    }
    if let Ok(e) = entry("password") {
        let _ = e.delete_credential();
    }
    Ok(())
}
