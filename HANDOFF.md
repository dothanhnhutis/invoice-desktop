# HANDOFF — invoice-desktop

Tài liệu bàn giao để **tiếp tục công việc ở máy khác**. Đây là nguồn ngữ cảnh chính (memory
của Claude nằm ở `~/.claude/...` **cục bộ theo máy**, không theo repo).

> Cập nhật lần cuối: phiên làm việc đổi schema `Invoice` sang field thô GDT + lưu token bền vững.
> Nếu bạn sửa tiếp, cập nhật lại phần **Trạng thái** và **Việc còn dang dở** bên dưới.

---

## 0. ⚠️ BẤT BIẾN AN TOÀN — ĐỌC TRƯỚC TIÊN

Cổng **hoadondientu.gdt.gov.vn KHÓA tài khoản sau vài lần đăng nhập SAI mật khẩu.**

- `hddt::login` ([libs/hddt/src/auth.rs](libs/hddt/src/auth.rs)) **CHỈ** retry khi lỗi là
  "sai captcha"; mọi lỗi khác (sai user/pass → `BadCredentials`, bị khóa → `Locked`) **DỪNG
  NGAY**. Hàm `classify(message)` phân loại theo từ khóa, xét "khoá" TRƯỚC "captcha" (nhập nhằng
  thì nghiêng về DỪNG). **ĐỪNG BAO GIỜ nới lỏng thành "retry mọi lỗi".**
- Khi Solver có margin < ngưỡng → bỏ captcha lấy cái khác, **không** nộp (tránh đếm vào số lần sai).
- **Khi kiểm thử: KHÔNG chạy login thật bằng mật khẩu sai.** Chỉ dùng mật khẩu đúng, hoặc unit
  test `classify`. Các nhánh nguy hiểm chỉ verify bằng unit test.
- UI đăng nhập gọi `login` (xác minh) **trước**, chỉ khi OK mới `set_credentials` (lưu keychain).
  Không được lưu credential chưa xác minh — nếu lưu mật khẩu sai, sync + profile + mỗi lần mở app
  sẽ thử login lại nhiều lần → dẫn tới khóa.

Các message thật đã biết từ cổng:
| message | phân loại | hành động |
|---|---|---|
| `Mã captcha không đúng.` | Captcha | thử captcha khác (nhánh DUY NHẤT được retry) |
| `Tài khoản đã bị khoá vì đã nhập sai thông tin quá số lần quy định.` | Locked | dừng |
| `Tên đăng nhập hoặc mật khẩu không đúng` | Other | dừng |

---

## 1. Tổng quan

Desktop app (Tauri v2) tự động đăng nhập hoadondientu.gdt.gov.vn bằng cách **tự giải captcha**,
tải hóa đơn mua vào, lưu **SQLite cục bộ** để tra cứu offline, và **đồng bộ nền** (backfill quá
khứ + incremental). Đích: 1 bản build cho nhiều người dùng; cập nhật thuật toán captcha qua build
lại + Tauri updater (chưa hiện thực).

---

## 2. Kiến trúc (Cargo workspace + frontend)

Workspace members (`Cargo.toml`, resolver 3):
- **`libs/captcha`** (package `captcha-core`) — nhận dạng captcha: `Solver` (SVG→raster→so template
  IoU), tiền xử lý SVG, fetch, `CaptchaError`. Thuần Rust.
- **`libs/hddt`** (package `hddt`) — HTTP client cổng thuế:
  - `client.rs` `make_client` (giữ cookie + UA trình duyệt).
  - `auth.rs` `login` (tự giải captcha, retry an toàn), `classify`, `token_expiry`/`is_expired`
    (đọc JWT `exp`, dùng `base64`), `LoginError`, `AuthErr`.
  - `api.rs` `query_purchase` (phân trang cursor), `profile`, `map_purchase`, `QueryError`, `Page`.
- **`libs/domain`** — kiểu thuần: `Invoice`, `InvoiceKind`, `InvoiceFilter`, `SyncState`.
- **`libs/store`** — SQLite (rusqlite bundled): `Db` open/upsert/query/sync_state/settings/count/
  delete_invoices_before/clear_all.
- **`apps/captcha`** — bin công cụ dev: `label_tool`, `solver`, `login` (mỏng, gọi vào lib).
- **`apps/invoice-desktop/src-tauri`** — app Tauri (edition 2021). `AppState{client, solver,
  token: Mutex<Option<String>>, db, wake: Notify, auth_blocked: AtomicBool}`.

Frontend (`apps/invoice-desktop`): React 19, Vite, **TanStack Router** (file-based; `routeTree.gen.ts`
**tự sinh** khi dev server chạy hoặc `pnpm dlx @tanstack/router-cli generate`), TanStack Query/Form,
Zod, **Base UI + shadcn**, Tailwind v4, `@tauri-apps/api` v2.

Cây route:
- `/` → [routes/index.tsx](apps/invoice-desktop/src/routes/index.tsx): nếu đã có credential →
  redirect `/lookups/invoice/purchase`; chưa → render `<LoginDialog/>`.
- `/_protected` → [routes/_protected/route.tsx](apps/invoice-desktop/src/routes/_protected/route.tsx):
  **layout guard** — `beforeLoad` kiểm `has_credentials` (chưa có → redirect `/`), `loader` gọi
  `profile`; bọc `SyncProvider` + `AuthProvider` + sidebar.
- `/_protected/lookups/invoice/purchase` và `.../sold`.

---

## 3. Luồng auth + token

- **Đăng nhập** ([login-dialog.tsx](apps/invoice-desktop/src/components/login-dialog.tsx)):
  `login` (giải captcha) → nếu OK → `set_floor` → `set_credentials` → `navigate` sang purchase.
  Lỗi hiện đỏ dưới form, dialog ở nguyên (Base UI `AlertDialogAction` không tự đóng).
- **Credential + token ở OS keychain** ([secrets.rs](apps/invoice-desktop/src-tauri/src/secrets.rs)),
  service `com.thanhnhut.invoice-desktop`, entry `username` / `password` / `token`. KHÔNG lưu
  plaintext/SQLite.
- **Token bền vững**: token là JWT (~1 ngày). `hddt::is_expired(token, skew)` đọc claim `exp`.
  [helper.rs](apps/invoice-desktop/src-tauri/src/helper.rs) `valid_cached_token` lấy token CÒN HẠN
  từ RAM → keychain; chỉ `login` khi hết hạn/không có, và lưu lại. → **mở lại app không phải giải
  captcha lại** nếu token còn hạn. Gặp 401 → `invalidate_token` (xóa RAM + keychain) rồi login 1 lần.
- **`logout`** ([lib.rs](apps/invoice-desktop/src-tauri/src/lib.rs)): `auth_blocked=true`, xóa token,
  `secrets::clear()` (xóa cả token), `db.clear_all()` (xóa hóa đơn + settings + reset sync_state),
  `wake`.

---

## 4. Đồng bộ (sync)

[sync.rs](apps/invoice-desktop/src-tauri/src/sync.rs): vòng lặp nền `run(app)`.
- Chờ tới khi có credential và không `auth_blocked`.
- **Backfill** theo **cửa sổ tháng lịch** lùi dần tới FLOOR (setting `floor`, mặc định `2022-01-01`);
  `next_window` là hàm thuần có unit test.
- **Incremental** mỗi ~1h từ mốc mới nhất tới hôm nay.
- `ensure_token` dùng `valid_cached_token`; upsert idempotent theo `id`.
- Emit `sync://progress` / `sync://error` (Tauri event).
- API: `GET /api/query/invoices/purchase`, params `sort=tdlap:desc`, `size=50`,
  `search=tdlap=ge=<dd/MM/yyyyTHH:mm:ss>;tdlap=le=<...>;ttxly==5`, phân trang bằng cursor `state`.
  Response `{datas, total, state, time}`; hết khi `datas` rỗng hoặc `state` rỗng.

---

## 5. Tauri commands (đã đăng ký ở `invoke_handler`)

`login`, `logout`, `profile`, `set_credentials`, `clear_credentials`, `has_credentials`,
`get_sync_status`, `list_invoices(filter)`, `get_floor`, `set_floor(date)`.

---

## 6. Schema `Invoice` (mới — field thô GDT)

[libs/domain/src/lib.rs](libs/domain/src/lib.rs). Giữ `id` (PK), `kind` (mua/bán), `raw_json`; thêm:
`nbmst, khmshdon(u8), khhdon, shdon(u32), dvtte, nbdchi, nbten, tgtcthue(f64), tgtthue(f64),
tgtttbso(f64), tlhdon, ttcktmai(f64), tthai(u8), ttxly(u8), ntao(String ISO), nmten, nmmst, nmdchi`.
- **Ngày dùng `ntao`** (ngày tạo) — là cột dùng để ORDER BY / lọc from-to / prune theo FLOOR
  (ISO so sánh chuỗi vẫn đúng thứ tự). Server vẫn lọc theo `tdlap`.
- Tiền để `f64`. Bảng SQLite ([libs/store/src/lib.rs](libs/store/src/lib.rs)) khớp field này.

---

## 7. ⚠️ VIỆC CÒN DANG DỞ / BẪY (đọc kỹ khi tiếp tục)

- **Spawn sync đang COMMENT** — [lib.rs](apps/invoice-desktop/src-tauri/src/lib.rs) trong `setup`:
  dòng `// tauri::async_runtime::spawn(sync::run(app.handle().clone()));`. **Bỏ comment để bật
  đồng bộ nền** (không bật thì DB rỗng, bảng không có dữ liệu). Vì đang tắt nên module `sync`
  báo nhiều warning dead-code — bình thường.
- **Listener `sync://*` đang COMMENT** — [contexts/sync-context.tsx](apps/invoice-desktop/src/contexts/sync-context.tsx):
  `useEffect` đăng ký `listen("sync://progress"/"error")` bị comment → `useSync().progress/error`
  luôn null (banner tiến độ/lỗi ở purchase không hoạt động). Bỏ comment để bật lại.
- **Migration DB**: đã đổi cột bảng `invoices`. File `invoices.db` cũ KHÔNG tương thích →
  **xóa `%APPDATA%/com.thanhnhut.invoice-desktop/invoices.db`** trước khi chạy (máy này đã xóa;
  máy khác DB tạo mới tự động nên không cần).
- **Lỗi TS6133 tồn sẵn** ở `app-sidebar.tsx` / `nav-user.tsx` (import icon thừa) → chặn
  `pnpm build` (tsc) nhưng **KHÔNG** chặn `pnpm tauri dev`. Dọn khi rảnh.
- **Chưa làm**: hóa đơn bán ra (`/sold`, đảo vai nbmst/nmmst), hiển thị profile, Tauri updater
  (cần `tauri signer generate` + GitHub Releases), event `sync://idle` để tắt banner khi bắt kịp.

---

## 8. Chạy & kiểm thử

```bash
# Frontend deps (một lần)
cd apps/invoice-desktop && pnpm install

# Chạy app (Vite + Tauri). routeTree.gen.ts tự sinh khi dev chạy.
pnpm tauri dev

# Backend
cargo build --workspace
cargo test -p hddt -p store            # hddt 9, store 5 (KHÔNG cần mạng)

# Sinh lại route khi thêm/sửa file trong src/routes (nếu dev server không chạy)
pnpm dlx @tanstack/router-cli generate

# CLI test login (chỉ mật khẩu ĐÚNG!)
HDDT_USER=<MST> HDDT_PASS=<mật khẩu đúng> cargo run -p captcha --bin login
```

Kiểm thử end-to-end: bật spawn sync (mục 7) → `pnpm tauri dev` → đăng nhập (mật khẩu đúng) →
sync backfill → bảng purchase hiện hóa đơn theo field mới.

---

## 9. Vị trí dữ liệu & môi trường máy mới

- **DB**: `%APPDATA%/com.thanhnhut.invoice-desktop/invoices.db` (Tauri `app_data_dir`).
- **Keychain**: Windows Credential Manager, service `com.thanhnhut.invoice-desktop`
  (entry `username`/`password`/`token`). **Không theo repo** → máy mới phải đăng nhập lại.
- **Templates captcha**: `apps/invoice-desktop/src-tauri/templates/` (commit, bundle theo version).
- **Dataset train**: `apps/captcha/dataset/` (gitignored).
- **Yêu cầu máy mới**: Rust toolchain mới (crate riêng dùng edition 2024), Node + pnpm, Tauri v2
  prereqs (Windows: **WebView2** + **MSVC Build Tools**).

---

## 10. Mang sang máy khác (QUAN TRỌNG)

Các thay đổi gần đây **có thể chưa commit**. Để máy khác nhận được:

```bash
git add -A
git commit -m "<mô tả>"
git push
# máy khác:
git pull
cd apps/invoice-desktop && pnpm install
```

Lưu ý:
- **Memory của Claude (`~/.claude/...`) KHÔNG theo repo** → tài liệu `HANDOFF.md` này là nguồn
  ngữ cảnh chính ở máy mới.
- **Keychain (creds/token) KHÔNG theo repo** → đăng nhập lại ở máy mới.
- **`invoices.db` KHÔNG theo repo** → tạo mới tự động; sync sẽ backfill lại.
