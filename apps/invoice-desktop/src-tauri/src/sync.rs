//! Luồng đồng bộ nền: backfill (lùi 1 tháng/lần tới FLOOR) + incremental.
//!
//! An toàn tài khoản: sai mật khẩu / bị khóa -> DỪNG auto-login (đặt cờ
//! `auth_blocked`), chờ user cập nhật credential ở Settings; KHÔNG lặp login.

use std::sync::atomic::Ordering;
use std::time::Duration;

use chrono::{Datelike, Local, Months, NaiveDate, Utc};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::{AppState, secrets};

/// Mốc dừng backfill mặc định khi user chưa đặt (setting `floor`).
pub const DEFAULT_FLOOR: &str = "2022-01-01";
/// Nghỉ giữa các request (tránh rate-limit + an toàn tài khoản).
const THROTTLE: Duration = Duration::from_millis(800);
/// Chu kỳ đồng bộ tăng dần khi đã backfill xong.
const INCREMENTAL_INTERVAL: Duration = Duration::from_secs(60 * 60);
/// Chu kỳ chờ khi chưa có credential / đang bị chặn.
const IDLE_INTERVAL: Duration = Duration::from_secs(30);

enum SyncError {
    /// Sai tài khoản/mật khẩu hoặc bị khóa -> dừng, chờ user.
    Auth,
    Other(String),
}

#[derive(Clone, Serialize)]
struct SyncProgress {
    phase: &'static str,
    oldest: Option<String>,
    newest: Option<String>,
    saved: usize,
    total_in_db: i64,
}

/// Vòng lặp chính (spawn 1 lần lúc khởi động).
pub async fn run(app: AppHandle) {
    loop {
        let blocked = {
            let state = app.state::<AppState>();
            state.auth_blocked.load(Ordering::Relaxed)
        };

        if secrets::load().is_none() || blocked {
            // Chờ set_credentials đánh thức, hoặc timeout để kiểm tra lại.
            wait(&app, IDLE_INTERVAL).await;
            continue;
        }

        let next_wait = match sync_once(&app).await {
            Ok(()) => INCREMENTAL_INTERVAL,
            Err(SyncError::Auth) => {
                app.state::<AppState>()
                    .auth_blocked
                    .store(true, Ordering::Relaxed);
                emit_error(
                    &app,
                    "Sai tài khoản/mật khẩu (hoặc bị khóa). Đã dừng đồng bộ — cập nhật lại trong Settings.",
                );
                IDLE_INTERVAL
            }
            Err(SyncError::Other(msg)) => {
                emit_error(&app, &format!("Lỗi đồng bộ: {msg}"));
                INCREMENTAL_INTERVAL
            }
        };
        wait(&app, next_wait).await;
    }
}

/// Chờ tối đa `dur`, nhưng thức sớm nếu có tín hiệu wake (set_credentials).
async fn wait(app: &AppHandle, dur: Duration) {
    let state = app.state::<AppState>();
    let _ = tokio::time::timeout(dur, state.wake.notified()).await;
}

async fn sync_once(app: &AppHandle) -> Result<(), SyncError> {
    let state = app.state::<AppState>();
    let today = Local::now().date_naive();
    let floor_str = state
        .db
        .get_setting("floor")
        .ok()
        .flatten()
        .unwrap_or_else(|| DEFAULT_FLOOR.to_string());
    let floor = NaiveDate::parse_from_str(&floor_str, "%Y-%m-%d").unwrap_or(today);

    let mut ss = state.db.get_sync_state().map_err(other)?;

    // ----- Backfill: lùi theo TỪNG THÁNG LỊCH tới FLOOR -----
    // [01/07..hôm nay] → [01/06..30/06] → [01/05..31/05] → … → tháng của FLOOR.
    if !ss.backfill_done {
        if ss.newest_date.is_none() {
            ss.newest_date = Some(fmt_date(today));
        }
        while let Some((start, end)) =
            next_window(ss.oldest_date.as_deref().and_then(parse_date), today, floor)
        {
            let saved = fetch_window(&state, start, end).await?;
            ss.oldest_date = Some(fmt_date(start));
            state.db.set_sync_state(&ss).map_err(other)?;
            emit_progress(app, &state, "backfill", &ss, saved);

            tokio::time::sleep(THROTTLE).await;
        }
        ss.backfill_done = true;
        state.db.set_sync_state(&ss).map_err(other)?;
    }

    // ----- Incremental: từ mốc mới nhất tới hôm nay -----
    let from = ss
        .newest_date
        .as_deref()
        .and_then(parse_date)
        .unwrap_or_else(|| today.checked_sub_months(Months::new(1)).unwrap_or(today));
    let saved = fetch_window(&state, from, today).await?;
    ss.newest_date = Some(fmt_date(today));
    ss.last_sync_at = Some(Utc::now().timestamp());
    state.db.set_sync_state(&ss).map_err(other)?;
    emit_progress(app, &state, "incremental", &ss, saved);

    Ok(())
}

/// Lấy hết hóa đơn trong 1 cửa sổ ngày (phân trang cursor), upsert vào DB.
async fn fetch_window(
    state: &AppState,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<usize, SyncError> {
    let from_s = fmt_search(from, "00:00:00");
    let to_s = fmt_search(to, "23:59:59");

    let mut cursor: Option<String> = None;
    let mut saved = 0usize;
    let mut retried_auth = false;

    loop {
        let token = ensure_token(state).await?;
        match hddt::query_purchase(&state.client, &token, &from_s, &to_s, cursor.as_deref()).await {
            Ok(page) => {
                if page.invoices.is_empty() {
                    break;
                }
                state.db.upsert_invoices(&page.invoices).map_err(other)?;
                saved += page.invoices.len();
                match page.next_state {
                    Some(s) => cursor = Some(s),
                    None => break,
                }
                tokio::time::sleep(THROTTLE).await;
            }
            // Token hết hạn giữa chừng: thử re-login đúng 1 lần rồi tiếp.
            Err(hddt::QueryError::Unauthorized) if !retried_auth => {
                retried_auth = true;
                *state.token.lock().await = None;
            }
            Err(hddt::QueryError::Unauthorized) => return Err(SyncError::Auth),
            Err(e) => return Err(SyncError::Other(e.to_string())),
        }
    }
    Ok(saved)
}

/// Lấy token cache; thiếu -> login (creds từ keychain). Sai mật khẩu/bị khóa -> `Auth`.
async fn ensure_token(state: &AppState) -> Result<String, SyncError> {
    {
        let guard = state.token.lock().await;
        if let Some(t) = guard.as_ref() {
            return Ok(t.clone());
        }
    }
    let (user, pass) = secrets::load().ok_or(SyncError::Auth)?;
    let token = hddt::login(&state.client, &state.solver, &user, &pass, 8, 0.06)
        .await
        .map_err(|e| match e {
            hddt::LoginError::BadCredentials(_) | hddt::LoginError::Locked(_) => SyncError::Auth,
            e => SyncError::Other(e.to_string()),
        })?;
    *state.token.lock().await = Some(token.clone());
    Ok(token)
}

fn emit_progress(app: &AppHandle, state: &AppState, phase: &'static str, ss: &domain::SyncState, saved: usize) {
    let payload = SyncProgress {
        phase,
        oldest: ss.oldest_date.clone(),
        newest: ss.newest_date.clone(),
        saved,
        total_in_db: state.db.count().unwrap_or(0),
    };
    let _ = app.emit("sync://progress", payload);
}

fn emit_error(app: &AppHandle, msg: &str) {
    let _ = app.emit("sync://error", msg.to_string());
}

fn other<E: std::fmt::Display>(e: E) -> SyncError {
    SyncError::Other(e.to_string())
}

fn parse_date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

fn fmt_date(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

/// Định dạng ngày cho param `search`: `dd/MM/yyyyTHH:mm:ss`.
fn fmt_search(d: NaiveDate, time: &str) -> String {
    format!("{}T{}", d.format("%d/%m/%Y"), time)
}

// --- Cửa sổ theo tháng lịch --------------------------------------------------

fn first_of_month(d: NaiveDate) -> NaiveDate {
    d.with_day(1).unwrap()
}

fn last_of_month(d: NaiveDate) -> NaiveDate {
    first_of_month(d)
        .checked_add_months(Months::new(1))
        .and_then(|x| x.pred_opt())
        .unwrap_or(d)
}

fn prev_month_first(d: NaiveDate) -> NaiveDate {
    first_of_month(d)
        .checked_sub_months(Months::new(1))
        .unwrap_or(d)
}

/// Cửa sổ tháng lịch kế tiếp cần backfill (đầu→cuối tháng, clamp theo `floor`);
/// `None` khi đã tới FLOOR.
fn next_window(
    oldest: Option<NaiveDate>,
    today: NaiveDate,
    floor: NaiveDate,
) -> Option<(NaiveDate, NaiveDate)> {
    match oldest {
        // Chưa lấy gì: tháng hiện tại, từ đầu tháng (hoặc floor) tới hôm nay.
        None => Some((first_of_month(today).max(floor), today)),
        // Đã chạm FLOOR.
        Some(o) if o <= floor => None,
        // Lùi sang tháng trước đó.
        Some(o) => {
            let pm = prev_month_first(o);
            Some((pm.max(floor), last_of_month(pm)))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn window_current_month_first_run() {
        assert_eq!(
            next_window(None, d("2026-07-17"), d("2026-01-01")),
            Some((d("2026-07-01"), d("2026-07-17")))
        );
    }

    #[test]
    fn window_steps_back_full_calendar_months() {
        assert_eq!(
            next_window(Some(d("2026-07-01")), d("2026-07-17"), d("2026-01-01")),
            Some((d("2026-06-01"), d("2026-06-30")))
        );
        assert_eq!(
            next_window(Some(d("2026-06-01")), d("2026-07-17"), d("2026-01-01")),
            Some((d("2026-05-01"), d("2026-05-31")))
        );
        // Tháng 3 (28 ngày, năm không nhuận 2026)
        assert_eq!(
            next_window(Some(d("2026-03-01")), d("2026-07-17"), d("2026-01-01")),
            Some((d("2026-02-01"), d("2026-02-28")))
        );
    }

    #[test]
    fn window_stops_at_floor() {
        assert_eq!(
            next_window(Some(d("2026-01-01")), d("2026-07-17"), d("2026-01-01")),
            None
        );
    }

    #[test]
    fn window_clamps_to_floor_mid_month() {
        // FLOOR giữa tháng hiện tại
        assert_eq!(
            next_window(None, d("2026-07-17"), d("2026-07-10")),
            Some((d("2026-07-10"), d("2026-07-17")))
        );
        // FLOOR giữa một tháng cũ
        assert_eq!(
            next_window(Some(d("2026-03-01")), d("2026-07-17"), d("2026-02-15")),
            Some((d("2026-02-15"), d("2026-02-28")))
        );
    }
}
