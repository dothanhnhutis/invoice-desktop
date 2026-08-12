# HANDOFF — invoice-desktop

Tài liệu bàn giao để **tiếp tục công việc ở máy khác**. Đây là nguồn ngữ cảnh chính (memory
của Claude nằm ở `~/.claude/...` **cục bộ theo máy**, không theo repo).

> Cập nhật lần cuối: phiên **tải hoá đơn theo file CSV**. Thay đổi lớn nhất: lệnh mới
> **`download_invoices_from_csv`** — nạp CSV `nbmst,khhdon,shdon[,khmshdon]` rồi tải hàng loạt, **không
> cần hoá đơn có sẵn trong DB** (CSV đã đủ 4 khoá mà `/export-xml` cần), có tiến độ realtime
> `invoice-csv://progress`. Kèm theo: **đổi quy tắc đóng gói khi tải xuống** (1 hoá đơn → 2 file rời;
> nhiều hoá đơn → 1 `.zip` tên tự đặt), nút **Copy khoá HĐ** ở trang chi tiết, và **sửa nav Cài đặt**
> (sidebar con + mục "Cài đặt" ở sidebar chính giờ sáng đúng). (Trước đó: bật/tắt module + trang Cài
> đặt, app không còn bắt buộc đăng nhập GDT, đổi tên **ICH Toolkit** → đổi `identifier` nên thư mục dữ
> liệu đổi theo, xem §7 + §9; trước nữa: bộ lọc hoá đơn trên URL, chi tiết hoá đơn & tải XML+PDF, hệ
> Nguyên liệu + COA.)
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
- **`libs/domain`** — kiểu thuần: `Invoice`, `InvoiceKind`, `InvoiceFilter`, `SyncState`; **+ hệ nguyên
  liệu**: `RawMaterial`, `Coa`, `NewRawMaterial`, `NewCoa`, `RawMaterialFilter`, `Paged<T>`.
- **`libs/store`** — SQLite (rusqlite bundled): `Db` open/upsert/query/sync_state/settings/count/
  delete_invoices_before/clear_all; **+ raw_materials/coas**: insert/update/soft_delete/get/list/count,
  `get_raw_material_by_code`, `insert_coa`/`get_coa`/`list_coas`/
  `soft_delete_coa`/`set_coa_path`; **+ xoá theo module** (xem §6.7): `clear_invoices` (xoá hoá đơn +
  reset sync_state nhưng **GIỮ settings**) và `delete_all_raw_materials_and_coas` (xoá **cứng**
  raw_materials+coas, reset `sqlite_sequence`). (19 unit test.)
- **`apps/captcha`** — bin công cụ dev: `label_tool`, `solver`, `login` (mỏng, gọi vào lib).
- **`apps/invoice-desktop/src-tauri`** — app Tauri (edition 2021). `AppState{client, solver,
  token: Mutex<Option<String>>, db, wake: Notify, auth_blocked: AtomicBool, syncing: AtomicBool}`
  (`syncing` = luồng nền đang chạy 1 lượt đồng bộ, xem §4).
  Dep thêm: `uuid`(v7 — đặt tên file COA), `zip`(nén COA khi tải), `csv`(import/export CSV).

Frontend (`apps/invoice-desktop`): React 19, Vite, **TanStack Router** (file-based; `routeTree.gen.ts`
**tự sinh** khi dev server chạy hoặc `pnpm dlx @tanstack/router-cli generate`), TanStack Query/Form,
Zod, **Base UI + shadcn**, Tailwind v4, `@tauri-apps/api` v2.

Cây route (⚠️ **đã bỏ guard đăng nhập toàn app**):
- `/` → [routes/index.tsx](apps/invoice-desktop/src/routes/index.tsx): **redirect thẳng**
  `/settings/features`. Không còn màn đăng nhập ở đây.
- `/_protected` → [routes/_protected/route.tsx](apps/invoice-desktop/src/routes/_protected/route.tsx):
  **chỉ còn layout** (`SyncProvider` + sidebar + `NavHeader`). Đã **xoá** `beforeLoad`
  (`has_credentials`), `loader` (`profile`) và `AuthProvider` — vào app không cần credential GDT.
- `/_protected/settings` → [settings/route.tsx](apps/invoice-desktop/src/routes/_protected/settings/route.tsx):
  layout **sidebar con** cho 3 trang: `features` (Tính năng — xem §6.7), `notifications` (Thông báo —
  placeholder), `accessibilitys` (Giao diện — chọn sáng/tối/hệ thống qua `theme-context`).
- `/_protected/lookups/invoice/purchase` (+ `purchase_/$id`) và `.../sold`.
- `/_protected/coas` (danh sách nguyên liệu) và `/_protected/coas_/$id` (chi tiết — dấu `_` để
  **un-nest** khỏi layout danh sách; xem mục 6.5).
- **Guard theo module**: các route hoá đơn & nguyên liệu tự kiểm cờ tính năng trong `beforeLoad`, tắt
  thì `redirect({ to: "/settings/features" })` (xem §6.7).

Điều hướng: [nav-header.tsx](apps/invoice-desktop/src/components/nav-header.tsx) breadcrumb **động** theo
`useMatches()` (map `routeId`→nhãn); [nav-main.tsx](apps/invoice-desktop/src/components/nav-main.tsx)
sidebar **active theo route** (`useRouterState` pathname, `/coas` active cả ở `/coas/$id`) — không còn
hardcode `isActive`. [app-sidebar.tsx](apps/invoice-desktop/src/components/app-sidebar.tsx) **lọc mục
theo cờ tính năng** (module tắt → ẩn mục) và **đã bỏ `NavUser`** (file `nav-user.tsx` bị xoá).

⚠️ **Đích điều hướng ≠ phạm vi active**: `NavLinkType` có trường tuỳ chọn **`match`** (tiền tố path để
tính active, mặc định `= url`). Dùng cho mục **Cài đặt**: `url: "/settings/features"` nhưng
`match: "/settings"` nên nó sáng ở cả `notifications`/`accessibilitys`. Thêm mục mới mà đích trỏ vào 1
trang con thì nhớ khai `match`. Sidebar **con** của trang Cài đặt
([settings/route.tsx](apps/invoice-desktop/src/routes/_protected/settings/route.tsx)) dùng lại hàm
`isLeafActive` **export từ `nav-main.tsx`** — đừng viết lại logic so khớp lần thứ ba.

---

## 3. Luồng auth + token

- **Đăng nhập** giờ nằm ở **trang Cài đặt tính năng** (`InvoiceEnableForm` trong
  [settings/features.tsx](apps/invoice-desktop/src/routes/_protected/settings/features.tsx)), gạt
  công tắc "Quản lý hoá đơn" để hiện form. Thứ tự **an toàn giữ nguyên**: `login` (xác minh, gửi
  **1 lần**) → `set_floor` → `set_credentials`. Lỗi hiện đỏ dưới form.
  ⚠️ [login-dialog.tsx](apps/invoice-desktop/src/components/login-dialog.tsx) **không còn được dùng**
  (code chết, xem §7).
- **Credential + token ở OS keychain** ([secrets.rs](apps/invoice-desktop/src-tauri/src/secrets.rs)),
  service `com.thanhnhut.invoice-desktop`, entry `username` / `password` / `token`. KHÔNG lưu
  plaintext/SQLite. ⚠️ Tên service này **cố định trong secrets.rs**, KHÔNG đổi theo `identifier` của
  Tauri (đã đổi thành `ich-toolkit`) → credential cũ vẫn dùng được sau khi đổi tên app.
- **Token bền vững**: token là JWT (~1 ngày). `hddt::is_expired(token, skew)` đọc claim `exp`.
  [helper.rs](apps/invoice-desktop/src-tauri/src/helper.rs) `valid_cached_token` lấy token CÒN HẠN
  từ RAM → keychain; chỉ `login` khi hết hạn/không có, và lưu lại. → **mở lại app không phải giải
  captcha lại** nếu token còn hạn. Gặp 401 → `invalidate_token` (xóa RAM + keychain) rồi login 1 lần.
- **`logout`** ([lib.rs](apps/invoice-desktop/src-tauri/src/lib.rs)): `auth_blocked=true`, xóa token,
  `secrets::clear()` (xóa cả token), `db.clear_all()` (xóa hóa đơn + settings + reset sync_state),
  `wake`.
- **`disable_invoices`** (dùng khi TẮT module hoá đơn): giống `logout` nhưng gọi `db.clear_invoices()`
  → **giữ nguyên settings** (floor + cờ tính năng khác). Đừng dùng `clear_all` ở đây.

---

## 4. Đồng bộ (sync)

[sync.rs](apps/invoice-desktop/src-tauri/src/sync.rs): vòng lặp nền `run(app)`.
- Chờ tới khi có credential và không `auth_blocked`.
- **Backfill** theo **cửa sổ tháng lịch** lùi dần tới FLOOR (setting `floor`, mặc định
  **`2026-01-01`** — hằng `DEFAULT_FLOOR`); `next_window` là hàm thuần có unit test.
- **Incremental** mỗi ~1h từ mốc mới nhất tới hôm nay.
- `ensure_token` dùng `valid_cached_token`; upsert idempotent theo `id`.
- Emit `sync://progress` / `sync://error` (Tauri event).
- **Cờ "đang đồng bộ"**: `run()` bọc `set_busy(&app, true)` … `sync_once` … `set_busy(&app, false)`
  (luôn hạ cờ ở mọi nhánh Ok/Err) → ghi `AppState.syncing` + phát event `sync://busy` (bool).
  UI đọc trạng thái **ban đầu** bằng command `is_syncing` vì event chỉ phát lúc **chuyển** trạng thái.
  ⚠️ Không dùng `sync://progress` làm cờ "đang chạy": nó chỉ phát khi xong 1 cửa sổ và giá trị cũ nằm
  lại trong `useSync()` suốt 1 giờ luồng ngủ.
- **`set_floor` trả `Err` khi đang đồng bộ** ("Đang đồng bộ, vui lòng thử lại sau…"). Đây là race
  thật: `set_floor` ghi `sync_state` + `delete_invoices_before`, trong khi `sync_once` đang giữ bản
  `ss` cũ trong RAM và ghi đè lại sau mỗi cửa sổ.
- Listener phía UI ([sync-context.tsx](apps/invoice-desktop/src/contexts/sync-context.tsx)) **đã bật**
  cho cả 3 event; `useSync()` trả `{ progress, error, busy }`.
- API: `GET /api/query/invoices/purchase`, params `sort=tdlap:desc`, `size=50`,
  `search=tdlap=ge=<dd/MM/yyyyTHH:mm:ss>;tdlap=le=<...>`, phân trang bằng cursor `state`.
  Response `{datas, total, state, time}`; hết khi `datas` rỗng hoặc `state` rỗng.
  **Lấy MỌI trạng thái** — đã **bỏ** lọc `ttxly==5` (trước chỉ lấy hóa đơn đã xử lý xong).

---

## 5. Tauri commands (đã đăng ký ở `invoke_handler`)

Auth/sync/hóa đơn: `login`, `logout`, `profile`, `set_credentials`, `clear_credentials`,
`has_credentials`, **`get_username`** (MST đã lưu, `Option<String>`), **`is_syncing`** (bool),
**`disable_invoices`** (tắt module hoá đơn), `get_sync_status`, `list_invoices(filter)` **→ `Paged<Invoice>`** (phân trang server:
`filter.limit`/`filter.offset` + `count_invoices`; filter có `nbmst/khhdon/shdon/khmshdon` **+ `tthai`/`ttxly`**),
`get_invoice_detail(id)` **→ `Invoice`** (lazy-load `qrcode`+`hdhhdvu`: gọi API detail rồi cache DB —
xem 6.6), `download_invoices(ids, dir)` **→ `ExportInvoiceResult {downloaded, dir, path, errors}`**,
**`download_invoices_from_csv(csv_bytes, base_name, dir)`** **→ `InvoiceCsvResult {downloaded, path,
errors}`** (tải hàng loạt theo CSV — xem 6.6), `get_floor`, `set_floor(date)` (date = ISO `yyyy-MM-dd`).

Plugin thêm: `tauri_plugin_dialog` (hộp thoại chọn thư mục lưu — cần `dialog:default` trong
`capabilities/default.json`).

Nguyên liệu: `get_raw_material_by_id`, `list_raw_materials(filter)`, `create_raw_material`,
`update_raw_material`.

COA: `list_coas`, `scan_coa_files(paths)` (quét file/thư mục → danh sách file COA hợp lệ),
`create_coas_bulk_from_paths(raw_material_id, items)`, `read_coa_file`, `open_coa_file`,
`open_path_external(path)` (mở app ngoài theo đường dẫn tuyệt đối — xem COA CHƯA lưu),
`delete_coa`, `download_coas(ids, base_name, dir)`, `download_coas_from_csv(csv_bytes, base_name, dir)`.

Cờ tính năng: `get_feature_raw_materials`, `set_feature_raw_materials(enabled)` (tắt ⇒ **xoá dữ liệu**
— xem §6.7).

Frontend gọi qua wrapper [lib/api.ts](apps/invoice-desktop/src/lib/api.ts) (`api.*` + `ApiError`);
tránh gọi `invoke("...")` trực tiếp ở component mới.

---

## 6. Schema `Invoice` (mới — field thô GDT)

[libs/domain/src/lib.rs](libs/domain/src/lib.rs). Giữ `id` (PK), `kind` (mua/bán), `raw_json`; thêm:
`nbmst, khmshdon(u8), khhdon, shdon(u32), dvtte, nbdchi, nbten, tgtcthue(f64), tgtthue(f64),
tgtttbso(f64), tlhdon, ttcktmai(f64), tthai(u8), ttxly(u8), ntao(String ISO), nmten, nmmst, nmdchi`.
- **Lazy-load** (thêm cuối struct, `#[serde(default)]`): `qrcode: Option<String>`,
  `hdhhdvu: Option<String>` — sync để `null`; chỉ điền khi người dùng xem chi tiết (xem 6.6). Bảng
  SQLite có 2 cột `qrcode TEXT`/`hdhhdvu TEXT`, tạo bằng **ALTER TABLE idempotent** (check
  `PRAGMA table_info` — `add_column_if_missing`), nên DB cũ tự nâng cấp không cần xoá.
- **Ngày dùng `ntao`** (ngày tạo) — là cột dùng để ORDER BY / lọc from-to / prune theo FLOOR
  (ISO so sánh chuỗi vẫn đúng thứ tự). Server vẫn lọc theo `tdlap`.
- Tiền để `f64`. Bảng SQLite ([libs/store/src/lib.rs](libs/store/src/lib.rs)) khớp field này.
- **`InvoiceFilter`** = `{kind, from, to, nbmst, khhdon, shdon(u32), khmshdon(u8), tthai(u8),
  ttxly(u8), limit, offset}`. Match: `nbmst`/`khhdon` **dò chứa** (`LIKE %..%`),
  `shdon`/`khmshdon`/`tthai`/`ttxly` **khớp chính xác**; `from`/`to` so `ntao`. `query` +
  `count_invoices` dùng chung helper `push_invoice_conditions` (tránh lệch WHERE). `list_invoices`
  phân trang phía server: trả `Paged<Invoice> {data, total}`
  (`query` limit/offset + `count_invoices`). Trang purchase dùng `DataTable` manualPagination
  (**mặc định 10 dòng**, `PAGE_SIZES = [10,20,30,40,50]`, đổi số dòng → về trang 1).

---

## 6.5. Nguyên liệu (raw materials) & COA

Quản lý nguyên liệu thô + phiếu kiểm nghiệm (COA — Certificate of Analysis) kèm file ảnh/PDF.

- **Data model**: 1 `raw_material` có **nhiều** `coa`. `code` (dạng `ICHRM-####`) **unique** qua
  **partial index** `ux_raw_materials_code ... WHERE deleted_at IS NULL` (cho phép tái dùng code sau
  soft-delete). FK `coas.raw_material_id → raw_materials(id) ON DELETE CASCADE`, bật `PRAGMA
  foreign_keys=ON`. Cả hai bảng dùng **soft delete** (`deleted_at`).
- **File COA trên đĩa**: lưu `app_data_dir/coa/<uuidv7>.<ext>` (cạnh SQLite); DB chỉ giữ **path tương
  đối** (portable). Xem trước trong app qua blob URL ([coa_viewer_sheet.tsx](apps/invoice-desktop/src/components/coa_viewer_sheet.tsx));
  xoá mềm COA ⇒ **xoá luôn file** (best-effort).
- **Định dạng ngày `dd/mm/yyyy`** cho ngày COA (hỗ trợ chỉ `mm/yyyy` cho COA không rõ ngày) **và cho
  FORM nhập FLOOR**. Helper [lib/date.ts](apps/invoice-desktop/src/lib/date.ts): `isVnDate`,
  `formatVnDate` (ISO→dd/mm/yyyy để hiển thị), `vnDateToIso` (dd/mm/yyyy→ISO khi submit). Nhập bằng
  text (không `type=date`). ⚠️ **Lưu trữ `ntao` và `floor` VẪN ISO `yyyy-MM-dd`** (dính sync/prune +
  `set_floor` parse `%Y-%m-%d`); chỉ **biên form** đổi qua lại dd/mm/yyyy↔ISO.
  ⚠️ **FLOOR giờ chọn bằng Calendar** ở trang Cài đặt tính năng (`FloorDatePicker`, hiển thị
  `dd/MM/yyyy`, submit `format(date,"yyyy-MM-dd")`) — không còn ô text ở login-dialog/purchase.
- **Thêm COA**: 1 dialog duy nhất
  ([coa_bulk_dialog.tsx](apps/invoice-desktop/src/components/coa_bulk_dialog.tsx)) với **2 đường vào** —
  kéo-thả file/thư mục, và nút **Chọn file** (nhiều file). ⚠️ **Cả thư mục CHỈ nạp được bằng kéo-thả**
  — chủ ý (`pickFolders` đã gỡ), đừng thêm lại nút chọn thư mục. Mọi lần thêm đều **cộng dồn** vào
  bảng (khử trùng theo đường dẫn) nên gom được COA nằm rải ở nhiều thư mục mà không mất số lô/ngày
  đang gõ dở. Tất cả đi qua `addPaths` → `scan_coa_files` (Rust duyệt **đệ
  quy**, lọc `COA_EXTS` + ≤ 20MB, trần 1000 file) → lưu bằng `create_coas_bulk_from_paths`.
  ⚠️ **BẪY:** `dragDropEnabled` mặc định **BẬT** ở Tauri v2 ⇒ webview **không** nhận được sự kiện
  `drop` HTML5 hay đối tượng `File` — Tauri nuốt drop của OS và bắn `onDragDropEvent` kèm **đường dẫn
  tuyệt đối**. Vì vậy dialog chạy **hoàn toàn bằng đường dẫn** (Rust tự đọc bytes, không đẩy
  `number[]` qua IPC). Đừng quay lại `File`/`webkitdirectory` — kéo-thả sẽ chết. Listener ở phạm vi cả
  cửa sổ nên chỉ đăng ký khi dialog mở.
  ⚠️ **ĐÃ GỠ**: dialog "Thêm COA" từng file (`coa_dialog.tsx` + lệnh `create_coa`) vì bản này phủ trọn;
  `create_coas_bulk` (bytes qua IPC) và `open_bytes_external` (ghi file tạm để xem trước) — thay bằng
  `create_coas_bulk_from_paths` và `open_path_external`. `write_and_insert_coa` + `CreateCoaInput`
  **vẫn giữ** (nội bộ Rust, dùng chung với `restore_coas`).
- ⚠️ **ĐÃ GỠ "Nhập CSV" nguyên liệu** (`import_raw_materials` + `raw_material_import.tsx` +
  `is_valid_code` + `Db::insert_raw_materials_bulk`) — chức năng **Sao lưu / Phục hồi** thay thế được và
  mạnh hơn (mang cả COA + file). Đừng dựng lại; ràng buộc mã `ICHRM-####` giờ do form Zod ở
  `raw_material_dialog.tsx` + index `ux_raw_materials_code` lo.
- **Export COA (CSV)** `download_coas_from_csv`
  ([raw_material_export.tsx](apps/invoice-desktop/src/components/raw_material_export.tsx)): header
  `code,lot_no[,manufacture_date][,expiration_date]`; khớp `code`+`lot_no`, cột ngày **có mặt phải
  khớp** (`parse_flex_date`/`dates_match` chuẩn hoá cả dd/mm/yyyy lẫn ISO cũ). **Tên zip = tên file
  CSV**; 1 file→copy thẳng, nhiều→`.zip`; đều mở thư mục Downloads. Dòng không khớp → báo cáo, không chặn.
- **UI**: [coas.tsx](apps/invoice-desktop/src/routes/_protected/coas.tsx) (danh sách, phân trang
  server + tìm kiếm debounce 500ms qua [use-debounce.ts](apps/invoice-desktop/src/hooks/use-debounce.ts)),
  [coas_.$id.tsx](apps/invoice-desktop/src/routes/_protected/coas_.$id.tsx) (chi tiết + bảng COA).
  Dialog nguyên liệu: [raw_material_dialog.tsx](apps/invoice-desktop/src/components/raw_material_dialog.tsx).

---

## 6.6. Chi tiết hoá đơn, Tải xuống (XML+PDF), Ghim cột & Filter

**Lazy-load chi tiết** — Sync chỉ nạp header (`qrcode`/`hdhhdvu` = null). Khi mở chi tiết,
`get_invoice_detail(id)` gọi `GET /api/query/invoices/detail?nbmst&khhdon&shdon&khmshdon`
(`hddt::query_detail`), điền `qrcode`+`hdhhdvu`, **cache vào DB** (`set_invoice_detail`) rồi trả về;
lần sau lấy thẳng từ DB. Upsert của sync **không** ghi đè 2 field này. (So `detail` vs 1 phần tử
`datas` của list: chỉ khác đúng 2 field này.)

**Trang chi tiết** [purchase_.$id.tsx](apps/invoice-desktop/src/routes/_protected/lookups/invoice/purchase_.$id.tsx)
(dấu `_` un-nest khỏi layout danh sách): dựng như hoá đơn GTGT — QR (từ `qrcode`) trái; mẫu số/ký
hiệu/số HĐ phải; tiêu đề; ngày lập (`tdlap` từ `raw_json`); MCCQT; bên bán/bên mua; bảng hàng hoá
dịch vụ (parse `hdhhdvu` + "Số lô"/"Hạn dùng" từ `ttkhac`); tổng gồm **Tổng tiền phí** (`tgtphi`/
`ttttkhac`), Chiết khấu, Tổng thanh toán. nav-header có breadcrumb cho route này.

**Cột Hành động = DropdownMenu** ([purchase.tsx](apps/invoice-desktop/src/routes/_protected/lookups/invoice/purchase.tsx)):
Xem chi tiết / **Copy** (chỉ giá trị, tab-separated `nbmst\tkhhdon\tshdon\tkhmshdon` — dán Google
Sheets) / **Tải xuống**. Trang chi tiết có nút **Copy khoá HĐ** cùng định dạng đó → dán vào Excel ra
**đúng 4 cột theo thứ tự file CSV** dùng cho "Tải theo CSV" bên dưới.

**Tải xuống XML + PDF** — module [export.rs](apps/invoice-desktop/src-tauri/src/export.rs):
`GET /api/query/invoices/export-xml` (bearer token — **KHÔNG** phải `export-html`; endpoint đó 404;
hàm trong `libs/hddt` vẫn tên `export_html`, **tên gọi sai lịch sử**) trả **ZIP 5 file** (chỉ khác file
XML), giải nén (`extract_zip_to`), render `invoice.html` → PDF bằng **Edge/Chrome headless**
(`html_to_pdf`: `--headless=new --no-pdf-header-footer --print-to-pdf`, `--user-data-dir` cô lập,
`Stdio::null`, coi là thành công khi **file PDF tồn tại & khác rỗng**). `find_browser` dò Edge/Chrome ở
path Windows chuẩn hoặc env **`INVOICE_BROWSER`**.

`download_invoices(ids, dir)` chạy mỗi hoá đơn: `get_invoice` → `export_xml` → giải nén →
`html_to_pdf` (trong `spawn_blocking`) → ghi `<khhdon>_<shdon>.xml` + `.pdf`. ⚠️ **Ghi vào thư mục TẠM
trước** (`temp/invoice-desktop/inv-export/<uuid>/out`) rồi mới gom về `dir`, vì lúc tải chưa biết sẽ
nén hay không. Quy tắc đóng gói (hàm dùng chung **`package_outputs(files, out_dir, zip_base, zip)`**):
- **1 hoá đơn** (tính theo số hoá đơn **tải thành công**) → chép **2 file rời** `.xml` + `.pdf`.
- **≥2 hoá đơn** → nén **1 file `.zip`**, tên **hệ thống tự đặt**: `auto_zip_base` →
  `HoaDon_<số lượng>_<yyyyMMdd-HHmmss>.zip`.
Trả `ExportInvoiceResult {downloaded, dir, path, errors}` — `path` = đường dẫn file zip, **`null` khi
chép rời**. Trùng tên file có sẵn thì `unique_path` thêm ` (n)`, **không bao giờ ghi đè**.
UI: nút ở trang chi tiết (1 hoá đơn) + checkbox chọn nhiều ở danh sách + **hộp thoại chọn thư mục**
(`pickFolder` qua `@tauri-apps/plugin-dialog`).
⚠️ Máy đích **phải có Edge hoặc Chrome** để render PDF.

**Tải hàng loạt theo file CSV** — `download_invoices_from_csv(csv_bytes, base_name, dir)` +
[invoice_csv_download.tsx](apps/invoice-desktop/src/components/invoice_csv_download.tsx) (nút "Tải theo
CSV" ở toolbar trang purchase). Khác `download_invoices` ở chỗ **không tra DB**: CSV đã chứa đủ 4 khoá
mà `/export-xml` cần nên **tải được cả hoá đơn chưa đồng bộ về máy**.
- **Header CSV** (map **theo tên, không phân biệt hoa thường**, có strip BOM): bắt buộc `nbmst`,
  `khhdon`, `shdon`; `khmshdon` **tuỳ chọn** — thiếu cột/ô rỗng thì mặc định **`"1"`** (hoá đơn GTGT).
  Thiếu cột bắt buộc ⇒ `Err` **trước khi gọi mạng**. `nbmst` giữ **nguyên chuỗi** (có dạng
  `0106678187-001`) — xem bẫy Excel ở §7.
- Gom dòng hợp lệ **trước** (để biết `total` cho tiến độ) + **khử trùng** theo bộ 4 khoá; dòng thiếu
  khoá vào `errors` kèm `line` (1-based, đã tính dòng header).
- Nghỉ **500ms** giữa 2 hoá đơn (`CSV_THROTTLE`) — `libs/hddt` **không** throttle, CSV vài trăm dòng
  bắn liên tục dễ bị cổng chặn. Không đáng kể so với ~2-4s render PDF/hoá đơn.
- Đóng gói dùng chung `package_outputs` nhưng **luật khác**: **hơn 1 FILE ⇒ nén** (nên CSV 1 dòng vẫn
  ra `.zip` vì có 2 file), tên zip = **tên file CSV** (`base_name`). Xong thì **mở thư mục đích**.
- **Tiến độ**: emit `invoice-csv://progress` `{done, total, label}` trước mỗi hoá đơn + 1 lần cuối;
  component tự `listen` trong `useEffect` (không qua `SyncProvider`) → nút hiện "Đang tải 3/12".
- Kết quả `InvoiceCsvResult {downloaded, path, errors}`; Dialog liệt kê lỗi từng dòng.

**Ghim cột** ([data-table.tsx](apps/invoice-desktop/src/components/data-table.tsx)):
`enableColumnPinning` + `columnPinning={{ left: ["select","nguoiBan"], right: ["actions"] }}`; helper
`pinStyle` (sticky, left/right qua `getStart`/`getAfter`) + `pinClass` (bg + border biên). Fix tràn
ngang **khi có sidebar** (flex `min-width:auto`) bằng `min-w-0` trên `SidebarInset`
([_protected/route.tsx](apps/invoice-desktop/src/routes/_protected/route.tsx)).
⚠️ **KHÔNG sửa component shadcn `ui/*`** (yêu cầu rõ của user) — chỉ chỉnh `data-table.tsx` (app-level)
và `route.tsx`.

**Filter danh sách** ([purchase.tsx](apps/invoice-desktop/src/routes/_protected/lookups/invoice/purchase.tsx)):
thanh filter gồm Input `nbmst`/`khhdon` (dò chứa) + `shdon` (khớp), **3 Select** `khmshdon` (Tất cả +
1..6), `tthai` (Trạng thái HĐ; "Tất cả"=không lọc) và `ttxly` (Trạng thái xử lý), **Range Picker** ngày
lập, nút Lọc/Xoá lọc.
- **Điều kiện lọc + phân trang nằm trên URL** (`validateSearch`/`PurchaseSearch`, `Route.useSearch()`/
  `useNavigate()`, `page` 1-based) — **giữ nguyên khi xem chi tiết rồi Back / F5**; theo đúng pattern
  [coas.tsx](apps/invoice-desktop/src/routes/_protected/coas.tsx). `searchToApplied(search)` dựng
  `AppliedFilter` cho query; ngày → ISO **biên ngày giờ VN** (`dayBoundIso` `+07:00`) để so `ntao` (UTC).
  ⚠️ `page`/`size` là **bắt buộc** trong `PurchaseSearch` (và `CoasSearch`) → `Link`/`navigate` viết
  **đường dẫn literal** tới 2 trang này phải kèm `search: { page: 1, size: 10 }`, nếu không lỗi type.
  (Sidebar thoát được vì `item.url` có kiểu `string` đã bị nới; runtime vẫn chạy do `validateSearch`
  tự áp mặc định `page=1`, `size=10`.)
- **3 filter bắt buộc có mặc định áp ngay khi vào trang**: `tthai`=Tất cả (không lọc), `ttxly`=phần tử
  đầu (5), khoảng ngày = **today lùi ~1 tháng** (`defaultOneMonthRange`). `khmshdon` tùy chọn (mặc định
  Tất cả). Select base-ui hiển thị **label** qua `SelectValue` children-hàm (value là chuỗi key,
  `keyOf`: null→"all").
- **Range Picker rules** ([date-range-picker.tsx](apps/invoice-desktop/src/components/date-range-picker.tsx)):
  chặn **ngày tương lai** (`disabled={{after: today}}`), ẩn ngày tháng khác (`showOutsideDays={false}`),
  **cố định 6 tuần** (`fixedWeeks`, tránh nhảy UI), và **giới hạn độ dài khoảng = số ngày của tháng chứa
  điểm giữa** (`maxRangeDays(anchor, dir)`, kẹp trong `onSelect`).
  ⚠️ **Bẫy đã sửa** — trước đây bấm ngày khi khoảng đã đủ 2 đầu thì react-day-picker **nới** khoảng cũ
  (`addToRange`), rồi luật kẹp (luôn neo `to`) rút về **đúng khoảng cũ** ⇒ **không chọn được khoảng ở
  xa** (vd đang 07/07–06/08 thì không chọn nổi 01/01–31/01, bấm như không ăn). Cách sửa: bật
  **`resetOnSelect`** (đủ 2 đầu → bấm tiếp mở khoảng MỚI) và kẹp theo **đầu vừa bấm** (`triggerDate`),
  neo đầu người dùng đã chọn trước. Đừng quay lại kiểu neo cứng ở `to`.
- Component (kiểu shadcn, thích ứng @base-ui + react-day-picker@10):
  [ui/popover.tsx](apps/invoice-desktop/src/components/ui/popover.tsx),
  [ui/calendar.tsx](apps/invoice-desktop/src/components/ui/calendar.tsx) (ô ngày `h-8 w-8` giữ cột khi
  ẩn outside days), [date-range-picker.tsx](apps/invoice-desktop/src/components/date-range-picker.tsx).
  Deps: `react-day-picker@10`, `date-fns@4`.

---

## 6.7. Bật/tắt module & trang Cài đặt

Toàn bộ ở [settings/features.tsx](apps/invoice-desktop/src/routes/_protected/settings/features.tsx)
(4 component: `RouteComponent`, `InvoiceEnableForm`, `InvoiceEnabledPanel`, `FloorDatePicker`).

**2 module, 2 kiểu lưu cờ khác nhau:**
- **Nguyên liệu & COA** — cờ ở setting `feature_raw_materials` (**vắng = BẬT**; `"0"` = tắt).
  Tắt ⇒ `set_feature_raw_materials(false)` xoá thư mục `app_data_dir/coa` (best-effort) +
  `delete_all_raw_materials_and_coas()`. **Không khôi phục được** → có `AlertDialog` xác nhận.
- **Hoá đơn** — **không có setting riêng**: bật ⟺ `has_credentials()` (có credential GDT trong
  keychain). Bật = hiện `InvoiceEnableForm` (MST + mật khẩu + ngày thành lập → `login` → `set_floor` →
  `set_credentials`). Tắt = `disable_invoices()` (xoá credential/token + hoá đơn, **giữ** floor/cờ
  khác) + `AlertDialog` xác nhận.

**Khi module hoá đơn ĐANG BẬT** — `InvoiceEnabledPanel` hiển thị:
- Banner lỗi/tiến độ realtime từ `useSync()` + thẻ trạng thái ("Tải lịch sử: đã xong/đang chạy",
  "Khoảng đã tải", "Đồng bộ gần nhất" — `get_sync_status`, `refetchInterval: 3000`).
- Form cập nhật: **MST read-only** (đổi tài khoản ⇒ tắt rồi bật lại), **Mật khẩu mới** (để trống =
  không đổi) và **Mốc thời gian** (floor). Bấm Lưu: nếu có mật khẩu → `login` **1 lần duy nhất** rồi
  `set_credentials`; nếu floor đổi → `set_floor` (có thể **prune** hoá đơn cũ hơn mốc mới).
- ⚠️ **Khoá khi đang đồng bộ**: `busy` (từ `sync://busy`) ⇒ ô mật khẩu + nút chọn ngày + nút Lưu bị
  `disabled`, kèm dòng "Đang đồng bộ — không thể đổi mật khẩu hoặc mốc thời gian…". Backend cũng chặn
  `set_floor` (§4) nên UI chỉ là lớp chặn sớm. Tự mở lại khi luồng nền xong (không cần F5).

**Guard route theo cờ** — `beforeLoad` gọi cờ, lỗi lệnh thì fallback an toàn (nguyên liệu → cho vào,
hoá đơn → coi như chưa bật), tắt ⇒ `throw redirect({ to: "/settings/features" })`. Áp cho: `/coas`,
`/coas_/$id`, `/lookups/invoice/purchase`, `purchase_/$id`, `/lookups/invoice/sold`.

**QueryKey dùng chung** (khai báo ở [lib/api.ts](apps/invoice-desktop/src/lib/api.ts)) —
`FEATURE_RAW_MATERIALS_KEY`, `FEATURE_INVOICE_KEY`, `SYNC_STATUS_KEY`, `CREDENTIAL_USERNAME_KEY`,
`FLOOR_KEY`. Sidebar + trang Cài đặt + guard dùng **chung key**, nên sau khi bật/tắt chỉ cần
`invalidateQueries` là mọi nơi tự cập nhật. Thêm cờ mới thì khai báo key ở đây, đừng viết mảng rời.

**Component mới**: `ui/switch.tsx`, `ui/radio-group.tsx` (base-ui — `Switch` dùng
`checked`/`onCheckedChange`).

---

## 7. ⚠️ VIỆC CÒN DANG DỞ / BẪY (đọc kỹ khi tiếp tục)

- **⚠️ ĐỔI `identifier` APP** — [tauri.conf.json](apps/invoice-desktop/src-tauri/tauri.conf.json):
  `productName`/title → **"ICH Toolkit"**, `identifier` `com.thanhnhut.invoice-desktop` →
  **`ich-toolkit`**. Vì `app_data_dir` suy từ `identifier`, **DB + file COA giờ nằm ở
  `%APPDATA%/ich-toolkit/`**; dữ liệu cũ ở `%APPDATA%/com.thanhnhut.invoice-desktop/` **bị bỏ lại**
  (app tự tạo DB rỗng mới, sync backfill lại). Muốn giữ thì copy tay `invoices.db` + thư mục `coa`.
  **Keychain KHÔNG đổi** (service vẫn là chuỗi cũ, hardcode trong `secrets.rs`) → không phải đăng nhập lại.
- **Spawn sync ĐÃ BẬT** — [lib.rs](apps/invoice-desktop/src-tauri/src/lib.rs) trong `setup` gọi
  `tauri::async_runtime::spawn(sync::run(app.handle().clone()));` (đồng bộ nền chạy khi có credential).
- **Code chết chưa dọn**: [login-dialog.tsx](apps/invoice-desktop/src/components/login-dialog.tsx) và
  [contexts/auth-context.tsx](apps/invoice-desktop/src/contexts/auth-context.tsx) **không còn file nào
  import** (đăng nhập đã dời sang trang Cài đặt, `_protected` bỏ `AuthProvider`). Đừng sửa 2 file này
  khi debug luồng đăng nhập — sửa `settings/features.tsx`.
- **Migration DB**: đã đổi cột bảng `invoices` (đợt redesign schema). File `invoices.db` cũ (trước
  đợt đó) KHÔNG tương thích → xoá là xong (nay lại càng không đụng tới vì đã đổi thư mục dữ liệu).
  **Lưu ý**: 2 cột mới `qrcode`/`hdhhdvu` thêm bằng **ALTER idempotent** nên DB có sẵn không cần xoá.
- **Render PDF cần trình duyệt**: `download_invoices` gọi Edge/Chrome headless để tạo PDF → **máy đích
  phải cài Edge hoặc Chrome** (hoặc set env `INVOICE_BROWSER` trỏ tới binary). Không có → tải được XML
  nhưng PDF lỗi (ghi vào `errors`). Đã thử nhúng **nền + QR vào PDF** nhưng **rewind bỏ** — PDF hiện
  render theo `invoice.html` gốc trong ZIP.
- **`tsc --noEmit` hiện SẠCH** (lỗi TS6133 cũ ở `sync-context.tsx`/`use-online.ts` đã dọn) — giữ vậy,
  đừng để trôi lại. Chạy **trong `apps/invoice-desktop`** (xem §8).
- **Filter đã lên URL** (search params) — KHÔNG còn ở state cục bộ. Nếu thêm route điều hướng tới
  `/lookups/invoice/purchase` phải kèm `search: { page, size }` (xem 6.6) nếu không sẽ lỗi type.
- **⚠️ BẪY DỮ LIỆU: Excel cắt số 0 đầu của `nbmst` khi lưu CSV.** MST Việt Nam là **10 chữ số** (hoặc
  `10 số + "-" + 3 số`), nhưng Excel coi ô toàn số là *number* nên `0106718496` bị lưu thành
  `106718496`. Cổng GDT gặp MST sai độ dài thì trả **HTTP 500** với `"message": null` — thông báo vô
  nghĩa, rất dễ tưởng lỗi app. Đã gặp thật: file 12 dòng chỉ chạy được 3 dòng — đúng 3 dòng có MST hợp
  lệ (`0106678187-001`, `0302262756-003` giữ dạng text nhờ dấu `-`, và `3700720496` vốn không có số 0
  đầu). **Quyết định: KHÔNG tự đệm số 0 trong code** (chốt với user) — lỗi thuộc về file nguồn. Khi xuất
  CSV phải để cột MST ở **định dạng Text**, hoặc thêm lại số 0 trước khi nạp. Nếu sau này đổi ý thì
  chỗ sửa là hàm đọc dòng CSV trong `download_invoices_from_csv`.
- **Breadcrumb thiếu `/settings/*`**: [nav-header.tsx](apps/invoice-desktop/src/components/nav-header.tsx)
  chưa có nhánh `routeId` cho các trang Cài đặt → rơi về nhãn mặc định "Bảng điều khiển".
  (Phần **active của sidebar** Cài đặt thì đã sửa xong — xem §2.)
- `/settings/notifications` mới là placeholder "Tính năng đang phát triển".
- **Ngày COA cũ dạng ISO**: COA nào lỡ nhập trước khi đổi định dạng (bằng `type=date`) đang lưu ISO
  trong DB — vẫn **hiển thị & khớp export đúng** nhờ chuẩn hoá (`formatVnDate`/`dates_match`); chưa
  migrate chuỗi ISO→`dd/mm/yyyy` trong DB (để ngỏ, làm khi cần).
- **Chưa làm**: hóa đơn bán ra (`/sold` mới có guard + khung rỗng, cần đảo vai nbmst/nmmst); trang
  "Bảng điều khiển" (mục sidebar còn `url: "#"`); Tauri updater (cần `tauri signer generate` +
  GitHub Releases). Command `profile` **vẫn còn** nhưng **không nơi nào gọi** sau khi bỏ loader ở
  `_protected` — muốn hiện thông tin NNT thì gọi lại từ trang Cài đặt.

---

## 8. Chạy & kiểm thử

```bash
# Frontend deps (một lần) — gồm react-day-picker@10 + date-fns@4 (Range Picker filter)
cd apps/invoice-desktop && pnpm install

# Chạy app (Vite + Tauri). routeTree.gen.ts tự sinh khi dev chạy.
pnpm tauri dev

# Kiểm kiểu FE — PHẢI chạy trong apps/invoice-desktop
# (ở gốc repo sẽ lỗi ERR_PNPM_RECURSIVE_EXEC_NO_PACKAGE). Hiện đang SẠCH.
pnpm exec tsc --noEmit

# Backend
cargo build --workspace
cargo check -p invoice-desktop         # nhanh, dùng khi chỉ sửa Rust của app
cargo test -p hddt -p store            # hddt 9, store 19 (KHÔNG cần mạng)
cargo test -p invoice-desktop          # 7 test: parse_flex_date, dates_match, coa_key, sync window

# Sinh lại route khi thêm/sửa file trong src/routes (nếu dev server không chạy)
pnpm dlx @tanstack/router-cli generate

# CLI test login (chỉ mật khẩu ĐÚNG!)
HDDT_USER=<MST> HDDT_PASS=<mật khẩu đúng> cargo run -p captcha --bin login
```

Kiểm thử end-to-end (`pnpm tauri dev`):
1. Mở app → rơi thẳng vào **/settings/features** (không còn màn đăng nhập).
2. Gạt **Quản lý hoá đơn** → nhập MST + **mật khẩu ĐÚNG** + ngày thành lập → mục "Hoá đơn" hiện ở
   sidebar, sync backfill chạy, panel Cài đặt cập nhật "Tải lịch sử / Khoảng đã tải / Đồng bộ gần nhất".
3. **Trong lúc đang đồng bộ**: ô Mật khẩu mới + nút chọn ngày + nút Lưu **xám**, có dòng "Đang đồng
   bộ — …"; xong 1 lượt thì **tự mở lại** (event `sync://busy=false`, không cần F5).
4. Trang purchase (mục 6.6): **Chi tiết** (lần đầu gọi API detail + cache QR/hàng hoá), **Copy** dán
   Google Sheets, **Tải xuống** (XML+PDF, cần Edge/Chrome), **Filter** (nbmst/khhdon dò chứa, shdon
   khớp, 3 Select khmshdon/tthai/ttxly, **Range Picker** — thử đổi sang khoảng ở tháng xa hẳn, phải
   chọn được); đổi filter/trang rồi **Chi tiết → Back** thấy filter + trang khôi phục từ URL (F5 cũng giữ).
5. **Đóng gói khi tải** (6.6): tick **1** hoá đơn → thư mục đích có **2 file rời** `.xml`/`.pdf`;
   tick **≥2** → **1 file** `HoaDon_<n>_<ngày giờ>.zip`. Chạy lại lần nữa → ra `... (1).zip`, không ghi đè.
6. **Tải theo CSV** (6.6): nút ở toolbar purchase → chọn CSV `nbmst,khhdon,shdon,khmshdon` → chọn thư
   mục → nút chạy "Đang tải 1/12 … 12/12" → ra `<tên CSV>.zip` + thư mục tự mở. ⚠️ Cột MST phải đủ
   10 số (bẫy Excel, §7). Thử 1 dòng sai `shdon` → dòng đó vào Dialog lỗi, các dòng khác vẫn ra file.
7. Gạt **tắt** từng module → dữ liệu module đó bị xoá, mục sidebar biến mất, vào thẳng URL bị đẩy về
   /settings/features.
8. **Nav Cài đặt** (§2): ở `/settings/notifications` và `/settings/accessibilitys`, mục **Cài đặt** ở
   sidebar chính **vẫn sáng**, sidebar con sáng đúng mục đang xem.

Chức năng mạng phải đăng nhập GDT thật nên không tự chạy được. ⚠️ Luôn dùng **mật khẩu đúng** (§0).

---

## 9. Vị trí dữ liệu & môi trường máy mới

- **DB**: `%APPDATA%/ich-toolkit/invoices.db` (Tauri `app_data_dir`, suy từ `identifier`).
  ⚠️ Bản cũ nằm ở `%APPDATA%/com.thanhnhut.invoice-desktop/` — xem §7.
- **File COA**: `%APPDATA%/ich-toolkit/coa/<uuidv7>.<ext>` (cạnh DB; DB giữ path
  tương đối). **KHÔNG theo repo** → máy mới bắt đầu rỗng, tải/nhập lại.
- **Keychain**: Windows Credential Manager, service `com.thanhnhut.invoice-desktop`
  (entry `username`/`password`/`token`) — **giữ tên cũ**, không đổi theo `identifier`.
  **Không theo repo** → máy mới phải đăng nhập lại.
- **Templates captcha**: `apps/invoice-desktop/src-tauri/templates/` (commit, bundle theo version).
- **Dataset train**: `apps/captcha/dataset/` (gitignored).
- **Yêu cầu máy mới**: Rust toolchain mới (crate riêng dùng edition 2024), Node + pnpm, Tauri v2
  prereqs (Windows: **WebView2** + **MSVC Build Tools**).

---

## 10. Mang sang máy khác (QUAN TRỌNG)

⚠️ Đợt "bật/tắt module + trang Cài đặt" **đã commit** (`2aca93f`). Nhưng đợt **"tải hoá đơn theo CSV"
CHƯA COMMIT**: `git status` còn **9 file sửa** (`src-tauri/src/lib.rs`, `lib/api.ts`, `nav-main.tsx`,
`app-sidebar.tsx`, `settings/route.tsx`, `purchase.tsx`, `purchase_.$id.tsx`, `__root.tsx`,
`settings/accessibilitys.tsx`) + **1 file mới** `components/invoice_csv_download.tsx`.
Để máy khác nhận được:

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
