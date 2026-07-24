use crate::AppState;

/// Login lại sớm 2 phút trước hạn để tránh token hết hạn giữa một request.
const TOKEN_SKEW_SECS: i64 = 120;

/// Token CÒN HẠN lấy từ RAM cache, hoặc từ keychain (nạp lại vào RAM). `None` nếu
/// không có / đã hết hạn -> caller phải login. KHÔNG tự login ở đây.
pub async fn valid_cached_token(state: &AppState) -> Option<String> {
    {
        let guard = state.token.lock().await;
        if let Some(t) = guard.as_ref() {
            if !hddt::is_expired(t, TOKEN_SKEW_SECS) {
                return Some(t.clone());
            }
        }
    }
    let t = crate::secrets::load_token()?;
    if hddt::is_expired(&t, TOKEN_SKEW_SECS) {
        return None;
    }
    *state.token.lock().await = Some(t.clone()); // hydrate RAM từ keychain
    Some(t)
}

/// Xóa token khỏi RAM + keychain (khi 401 / hết hạn) để buộc login mới.
pub async fn invalidate_token(state: &AppState) {
    *state.token.lock().await = None;
    crate::secrets::clear_token();
}

/// Lấy access token dùng chung cho các command gọi API: ưu tiên token CÒN HẠN
/// (RAM/keychain), thiếu thì login bằng credential trong keychain và lưu lại.
///
/// ⚠️ `hddt::login` chỉ retry lỗi captcha; sai mật khẩu -> lỗi ngay (tránh khóa tài khoản).
pub async fn get_access_token(state: &AppState) -> Result<String, String> {
    if let Some(t) = valid_cached_token(state).await {
        return Ok(t);
    }
    let (username, password) = crate::secrets::load().ok_or("chưa có credential")?;
    let token = hddt::login(&state.client, &state.solver, &username, &password, 8, 0.06)
        .await
        .map_err(|e| e.to_string())?;
    let _ = crate::secrets::save_token(&token); // bền vững qua lần mở app sau
    *state.token.lock().await = Some(token.clone());
    Ok(token)
}
