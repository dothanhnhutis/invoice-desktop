use crate::AppState;

/// Lấy access token dùng chung cho các command gọi API: ưu tiên token đã cache,
/// thiếu thì login bằng credential trong keychain.
///
/// ⚠️ `hddt::login` chỉ retry lỗi captcha; sai mật khẩu -> lỗi ngay (tránh khóa tài khoản).
pub async fn get_access_token(state: &AppState) -> Result<String, String> {
    {
        let guard = state.token.lock().await;
        if let Some(t) = guard.as_ref() {
            return Ok(t.clone());
        }
    }
    let (username, password) = crate::secrets::load().ok_or("chưa có credential")?;
    let token = hddt::login(&state.client, &state.solver, &username, &password, 8, 0.06)
        .await
        .map_err(|e| e.to_string())?;
    *state.token.lock().await = Some(token.clone());
    Ok(token)
}
