# HANDOFF — invoice-desktop

Tài liệu bàn giao để **tiếp tục công việc ở máy khác**. Đây là nguồn ngữ cảnh chính (memory
của Claude nằm ở `~/.claude/...` **cục bộ theo máy**, không theo repo).

> Cập nhật lần cuối: phiên **nâng cấp bộ lọc hoá đơn** — thêm 2 **Select trạng thái** (`tthai` Trạng
> thái HĐ, `ttxly` Trạng thái xử lý; backend `InvoiceFilter` += tthai/ttxly), đổi **khmshdon** từ Input
> → Select (Tất cả + 1..6), **Range Picker** nâng cấp (chặn ngày tương lai, cố định 6 tuần, giới hạn độ
> dài khoảng = số ngày tháng của điểm giữa), và **đưa filter + phân trang lên URL** (validateSearch) để
> **giữ trạng thái khi Back/refresh**. (Trước đó: chi tiết hoá đơn & tải XML+PDF, ghim cột, filter cơ
> bản; phân trang server; hệ Nguyên liệu + COA.)
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
  `get_raw_material_by_code`, `insert_raw_materials_bulk`, `insert_coa`/`get_coa`/`list_coas`/
  `soft_delete_coa`/`set_coa_path`. (13 unit test.)
- **`apps/captcha`** — bin công cụ dev: `label_tool`, `solver`, `login` (mỏng, gọi vào lib).
- **`apps/invoice-desktop/src-tauri`** — app Tauri (edition 2021). `AppState{client, solver,
  token: Mutex<Option<String>>, db, wake: Notify, auth_blocked: AtomicBool}`.
  Dep thêm: `uuid`(v7 — đặt tên file COA), `zip`(nén COA khi tải), `csv`(import/export CSV).

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
- `/_protected/coas` (danh sách nguyên liệu) và `/_protected/coas_/$id` (chi tiết — dấu `_` để
  **un-nest** khỏi layout danh sách; xem mục 6.5).

Điều hướng: [nav-header.tsx](apps/invoice-desktop/src/components/nav-header.tsx) breadcrumb **động** theo
`useMatches()` (map `routeId`→nhãn); [nav-main.tsx](apps/invoice-desktop/src/components/nav-main.tsx)
sidebar **active theo route** (`useRouterState` pathname, `/coas` active cả ở `/coas/$id`) — không còn
hardcode `isActive`.

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
  `search=tdlap=ge=<dd/MM/yyyyTHH:mm:ss>;tdlap=le=<...>`, phân trang bằng cursor `state`.
  Response `{datas, total, state, time}`; hết khi `datas` rỗng hoặc `state` rỗng.
  **Lấy MỌI trạng thái** — đã **bỏ** lọc `ttxly==5` (trước chỉ lấy hóa đơn đã xử lý xong).

---

## 5. Tauri commands (đã đăng ký ở `invoke_handler`)

Auth/sync/hóa đơn: `login`, `logout`, `profile`, `set_credentials`, `clear_credentials`,
`has_credentials`, `get_sync_status`, `list_invoices(filter)` **→ `Paged<Invoice>`** (phân trang server:
`filter.limit`/`filter.offset` + `count_invoices`; filter có `nbmst/khhdon/shdon/khmshdon` **+ `tthai`/`ttxly`**),
`get_invoice_detail(id)` **→ `Invoice`** (lazy-load `qrcode`+`hdhhdvu`: gọi API detail rồi cache DB —
xem 6.6), `download_invoices(ids, dir)` **→ `ExportInvoiceResult {downloaded, dir, errors}`** (tải
XML+PDF về `dir` — xem 6.6), `get_floor`, `set_floor(date)` (date = ISO `yyyy-MM-dd`).

Plugin thêm: `tauri_plugin_dialog` (hộp thoại chọn thư mục lưu — cần `dialog:default` trong
`capabilities/default.json`).

Nguyên liệu: `get_raw_material_by_id`, `list_raw_materials(filter)`, `create_raw_material`,
`update_raw_material`, `import_raw_materials(csv_bytes)`.

COA: `list_coas`, `create_coa`, `create_coas_bulk`, `read_coa_file`, `open_coa_file`,
`open_bytes_external(file_name, file_bytes)` (ghi file tạm + mở app ngoài — xem COA CHƯA lưu),
`delete_coa`, `download_coas(ids, base_name)`, `download_coas_from_csv(csv_bytes, base_name)`.

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
  (mặc định 50 dòng, đổi số dòng → về trang 1).

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
  `set_floor` parse `%Y-%m-%d`); chỉ **biên form** đổi qua lại dd/mm/yyyy↔ISO. Form FLOOR ở
  [login-dialog.tsx](apps/invoice-desktop/src/components/login-dialog.tsx) (prefill `get_floor` →
  `formatVnDate`) và trang purchase.
- **Thêm COA**: từng file ([coa_dialog.tsx](apps/invoice-desktop/src/components/coa_dialog.tsx)) hoặc
  **cả thư mục** ([coa_bulk_dialog.tsx](apps/invoice-desktop/src/components/coa_bulk_dialog.tsx) dùng
  `<input webkitdirectory>` → nhập số lô/ngày từng file → `create_coas_bulk`).
- **Import nguyên liệu (CSV)** `import_raw_materials`
  ([raw_material_import.tsx](apps/invoice-desktop/src/components/raw_material_import.tsx)): header
  `code,coa_name|name,producer,country_of_origin`; validate `code`=`ICHRM-####`, **bỏ qua dòng trùng**
  (báo cáo), 1 transaction.
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
Sheets) / **Tải xuống**.

**Tải xuống XML + PDF** — module [export.rs](apps/invoice-desktop/src-tauri/src/export.rs):
`GET /api/query/invoices/export-xml` (bearer token — **KHÔNG** phải `export-html`; endpoint đó 404)
trả **ZIP 5 file** (chỉ khác file XML), giải nén (`extract_zip_to`), render `invoice.html` → PDF bằng
**Edge/Chrome headless** (`html_to_pdf`: `--headless=new --no-pdf-header-footer --print-to-pdf`,
`--user-data-dir` cô lập, `Stdio::null`, coi là thành công khi **file PDF tồn tại & khác rỗng**).
`find_browser` dò Edge/Chrome ở path Windows chuẩn hoặc env **`INVOICE_BROWSER`**. Command
`download_invoices(ids, dir)` chạy mỗi hoá đơn: `get_invoice` → `export_xml` → giải nén →
`html_to_pdf` (trong `spawn_blocking`) → ghi `<khhdon>_<shdon>.xml` + `.pdf` (unique_path), trả
`ExportInvoiceResult {downloaded, dir, errors}`. UI: nút ở trang chi tiết (1 hoá đơn) + checkbox chọn
nhiều ở danh sách + **hộp thoại chọn thư mục** (`pickFolder` qua `@tauri-apps/plugin-dialog`).
⚠️ Máy đích **phải có Edge hoặc Chrome** để render PDF.

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
  ⚠️ Vì `page`/`size` bắt buộc trên URL, **caller điều hướng tới purchase phải truyền
  `search: { page: 1, size: 10 }`** ([login-dialog.tsx](apps/invoice-desktop/src/components/login-dialog.tsx),
  [index.tsx](apps/invoice-desktop/src/routes/index.tsx)).
- **3 filter bắt buộc có mặc định áp ngay khi vào trang**: `tthai`=Tất cả (không lọc), `ttxly`=phần tử
  đầu (5), khoảng ngày = **today lùi ~1 tháng** (`defaultOneMonthRange`). `khmshdon` tùy chọn (mặc định
  Tất cả). Select base-ui hiển thị **label** qua `SelectValue` children-hàm (value là chuỗi key,
  `keyOf`: null→"all").
- **Range Picker rules** ([date-range-picker.tsx](apps/invoice-desktop/src/components/date-range-picker.tsx)):
  chặn **ngày tương lai** (`disabled={{after: today}}`), ẩn ngày tháng khác (`showOutsideDays={false}`),
  **cố định 6 tuần** (`fixedWeeks`, tránh nhảy UI), và **giới hạn độ dài khoảng = số ngày của tháng chứa
  điểm giữa** (`maxRangeDays`, kẹp trong `onSelect` — neo `to`, rút `from`).
- Component (kiểu shadcn, thích ứng @base-ui + react-day-picker@10):
  [ui/popover.tsx](apps/invoice-desktop/src/components/ui/popover.tsx),
  [ui/calendar.tsx](apps/invoice-desktop/src/components/ui/calendar.tsx) (ô ngày `h-8 w-8` giữ cột khi
  ẩn outside days), [date-range-picker.tsx](apps/invoice-desktop/src/components/date-range-picker.tsx).
  Deps: `react-day-picker@10`, `date-fns@4`.

---

## 7. ⚠️ VIỆC CÒN DANG DỞ / BẪY (đọc kỹ khi tiếp tục)

- **Spawn sync ĐÃ BẬT** — [lib.rs](apps/invoice-desktop/src-tauri/src/lib.rs) trong `setup` gọi
  `tauri::async_runtime::spawn(sync::run(app.handle().clone()));` (đồng bộ nền chạy khi có credential).
- **Listener `sync://*` VẪN COMMENT** — [contexts/sync-context.tsx](apps/invoice-desktop/src/contexts/sync-context.tsx):
  `useEffect` đăng ký `listen("sync://progress"/"error")` còn bị comment → `useSync().progress/error`
  luôn null (banner tiến độ/lỗi ở purchase không hoạt động). Bỏ comment để bật lại.
- **Migration DB**: đã đổi cột bảng `invoices` (đợt redesign schema). File `invoices.db` cũ (trước
  đợt đó) KHÔNG tương thích → **xóa `%APPDATA%/com.thanhnhut.invoice-desktop/invoices.db`** trước khi
  chạy (máy này đã xóa; máy khác DB tạo mới tự động nên không cần). **Lưu ý**: 2 cột mới `qrcode`/
  `hdhhdvu` thêm bằng **ALTER idempotent** nên DB đã có sẵn (sau redesign) **không** cần xoá lại.
- **Render PDF cần trình duyệt**: `download_invoices` gọi Edge/Chrome headless để tạo PDF → **máy đích
  phải cài Edge hoặc Chrome** (hoặc set env `INVOICE_BROWSER` trỏ tới binary). Không có → tải được XML
  nhưng PDF lỗi (ghi vào `errors`). Đã thử nhúng **nền + QR vào PDF** nhưng **rewind bỏ** — PDF hiện
  render theo `invoice.html` gốc trong ZIP.
- **Lỗi TS6133 tồn sẵn** ở `contexts/sync-context.tsx`, `hooks/use-online.ts` (import/biến thừa) →
  chặn `pnpm build` (tsc) nhưng **KHÔNG** chặn `pnpm tauri dev`. (`purchase.tsx` vẫn sạch sau khi đưa
  filter lên URL.) Dọn khi rảnh.
- **Filter đã lên URL** (search params) — KHÔNG còn ở state cục bộ. Nếu thêm route điều hướng tới
  `/lookups/invoice/purchase` phải kèm `search: { page, size }` (xem 6.6) nếu không sẽ lỗi type.
- **Ngày COA cũ dạng ISO**: COA nào lỡ nhập trước khi đổi định dạng (bằng `type=date`) đang lưu ISO
  trong DB — vẫn **hiển thị & khớp export đúng** nhờ chuẩn hoá (`formatVnDate`/`dates_match`); chưa
  migrate chuỗi ISO→`dd/mm/yyyy` trong DB (để ngỏ, làm khi cần).
- **Chưa làm**: hóa đơn bán ra (`/sold`, đảo vai nbmst/nmmst), hiển thị profile, Tauri updater
  (cần `tauri signer generate` + GitHub Releases), event `sync://idle` để tắt banner khi bắt kịp.

---

## 8. Chạy & kiểm thử

```bash
# Frontend deps (một lần) — gồm react-day-picker@10 + date-fns@4 (Range Picker filter)
cd apps/invoice-desktop && pnpm install

# Chạy app (Vite + Tauri). routeTree.gen.ts tự sinh khi dev chạy.
pnpm tauri dev

# Backend
cargo build --workspace
cargo test -p hddt -p store            # hddt 9, store 18 (KHÔNG cần mạng)
cargo test -p invoice-desktop          # unit test: is_valid_code, parse_flex_date, dates_match, sync

# Sinh lại route khi thêm/sửa file trong src/routes (nếu dev server không chạy)
pnpm dlx @tanstack/router-cli generate

# CLI test login (chỉ mật khẩu ĐÚNG!)
HDDT_USER=<MST> HDDT_PASS=<mật khẩu đúng> cargo run -p captcha --bin login
```

Kiểm thử end-to-end: bật spawn sync (mục 7) → `pnpm tauri dev` → đăng nhập (mật khẩu đúng) →
sync backfill → bảng purchase hiện hóa đơn theo field mới. Kiểm thêm (mục 6.6): mở **Chi tiết** (lần
đầu gọi API detail + cache QR/hàng hoá), **Copy** dán Google Sheets, **Tải xuống** (XML+PDF, cần
Edge/Chrome), **Filter** (nbmst/khhdon dò chứa, shdon khớp, 3 Select khmshdon/tthai/ttxly, Range Picker
ngày lập → Lọc/Xoá lọc); đổi filter/trang rồi mở **Chi tiết → Back** thấy **filter + trang khôi phục**
từ URL (F5 cũng giữ). Chức năng mạng phải đăng nhập GDT thật nên không tự chạy được.

---

## 9. Vị trí dữ liệu & môi trường máy mới

- **DB**: `%APPDATA%/com.thanhnhut.invoice-desktop/invoices.db` (Tauri `app_data_dir`).
- **File COA**: `%APPDATA%/com.thanhnhut.invoice-desktop/coa/<uuidv7>.<ext>` (cạnh DB; DB giữ path
  tương đối). **KHÔNG theo repo** → máy mới bắt đầu rỗng, tải/nhập lại.
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
