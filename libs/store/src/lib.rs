//! Lưu trữ cục bộ bằng SQLite (rusqlite bundled).
//!
//! `Db` bọc `Connection` trong `Mutex` để chia sẻ an toàn qua Tauri state.
//! Các thao tác đồng bộ (blocking) — ở tầng async nên gọi qua `spawn_blocking`
//! nếu batch lớn; batch nhỏ gọi trực tiếp cũng được.

use std::path::Path;
use std::sync::Mutex;

use domain::{
    Coa, Invoice, InvoiceFilter, InvoiceKind, NewCoa, NewRawMaterial, RawMaterial,
    RawMaterialFilter, SyncState,
};
use rusqlite::{Connection, OptionalExtension, params};

pub type Result<T> = std::result::Result<T, rusqlite::Error>;

pub struct Db {
    conn: Mutex<Connection>,
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS invoices (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    nbmst       TEXT NOT NULL,
    khmshdon    INTEGER NOT NULL,
    khhdon      TEXT NOT NULL,
    shdon       INTEGER NOT NULL,
    dvtte       TEXT NOT NULL,
    nbdchi      TEXT NOT NULL,
    nbten       TEXT NOT NULL,
    tgtcthue    REAL NOT NULL,
    tgtthue     REAL NOT NULL,
    tgtttbso    REAL NOT NULL,
    tlhdon      TEXT NOT NULL,
    ttcktmai    REAL NOT NULL,
    tthai       INTEGER NOT NULL,
    ttxly       INTEGER NOT NULL,
    ntao        TEXT NOT NULL,
    nmten       TEXT NOT NULL,
    nmmst       TEXT NOT NULL,
    nmdchi      TEXT NOT NULL,
    raw_json    TEXT NOT NULL,
    qrcode      TEXT,
    hdhhdvu     TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoices_ntao ON invoices(ntao);
CREATE INDEX IF NOT EXISTS idx_invoices_kind ON invoices(kind);

CREATE TABLE IF NOT EXISTS sync_state (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    oldest_date   TEXT,
    newest_date   TEXT,
    backfill_done INTEGER NOT NULL DEFAULT 0,
    last_sync_at  INTEGER
);
INSERT OR IGNORE INTO sync_state (id, backfill_done) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS raw_materials (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    code              TEXT NOT NULL,
    name              TEXT NOT NULL,
    producer          TEXT NOT NULL,
    country_of_origin TEXT,
    deleted_at        TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
-- `code` duy nhất trong phạm vi hàng còn hiệu lực (cho phép tái dùng sau soft-delete).
-- DROP index thường (bản cũ) trước vì trùng tên/không-unique.
DROP INDEX IF EXISTS idx_raw_materials_code;
CREATE UNIQUE INDEX IF NOT EXISTS ux_raw_materials_code
    ON raw_materials(code) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS coas (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_material_id   INTEGER NOT NULL REFERENCES raw_materials(id) ON DELETE CASCADE,
    lot_no            TEXT NOT NULL,
    manufacture_date  TEXT,
    expiration_date   TEXT,
    path              TEXT,
    deleted_at        TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_coas_raw_material_id ON coas(raw_material_id);
"#;

impl Db {
    /// Mở DB ở đường dẫn file (tạo + migrate nếu chưa có).
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let conn = Connection::open(path)?;
        Self::from_conn(conn)
    }

    /// DB trong bộ nhớ — dùng cho test.
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        Self::from_conn(conn)
    }

    fn from_conn(conn: Connection) -> Result<Self> {
        // Bật FK để `ON DELETE CASCADE` (coas -> raw_materials) có hiệu lực.
        // PRAGMA đặt theo connection; Db giữ 1 connection nên đặt một lần là đủ.
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        conn.execute_batch(SCHEMA)?;
        // Migrate DB cũ: `CREATE TABLE IF NOT EXISTS` không thêm cột mới, và SQLite
        // không có `ADD COLUMN IF NOT EXISTS` -> tự kiểm tra rồi ALTER (idempotent).
        Self::add_column_if_missing(&conn, "invoices", "qrcode", "TEXT")?;
        Self::add_column_if_missing(&conn, "invoices", "hdhhdvu", "TEXT")?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Thêm cột vào bảng nếu chưa tồn tại (dựa trên `PRAGMA table_info`).
    fn add_column_if_missing(
        conn: &Connection,
        table: &str,
        column: &str,
        decl: &str,
    ) -> Result<()> {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
        let existing: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(1))?
            .collect::<Result<_>>()?;
        if !existing.iter().any(|c| c == column) {
            conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {decl};"))?;
        }
        Ok(())
    }

    /// Chèn/cập nhật một batch hóa đơn (idempotent theo `id`).
    pub fn upsert_invoices(&self, invoices: &[Invoice]) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                r#"INSERT INTO invoices
                     (id, kind, nbmst, khmshdon, khhdon, shdon, dvtte, nbdchi, nbten,
                      tgtcthue, tgtthue, tgtttbso, tlhdon, ttcktmai, tthai, ttxly,
                      ntao, nmten, nmmst, nmdchi, raw_json)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                           ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)
                   ON CONFLICT(id) DO UPDATE SET
                     kind=excluded.kind, nbmst=excluded.nbmst, khmshdon=excluded.khmshdon,
                     khhdon=excluded.khhdon, shdon=excluded.shdon, dvtte=excluded.dvtte,
                     nbdchi=excluded.nbdchi, nbten=excluded.nbten, tgtcthue=excluded.tgtcthue,
                     tgtthue=excluded.tgtthue, tgtttbso=excluded.tgtttbso, tlhdon=excluded.tlhdon,
                     ttcktmai=excluded.ttcktmai, tthai=excluded.tthai, ttxly=excluded.ttxly,
                     ntao=excluded.ntao, nmten=excluded.nmten, nmmst=excluded.nmmst,
                     nmdchi=excluded.nmdchi, raw_json=excluded.raw_json"#,
            )?;
            for inv in invoices {
                stmt.execute(params![
                    inv.id,
                    inv.kind.as_str(),
                    inv.nbmst,
                    inv.khmshdon,
                    inv.khhdon,
                    inv.shdon,
                    inv.dvtte,
                    inv.nbdchi,
                    inv.nbten,
                    inv.tgtcthue,
                    inv.tgtthue,
                    inv.tgtttbso,
                    inv.tlhdon,
                    inv.ttcktmai,
                    inv.tthai,
                    inv.ttxly,
                    inv.ntao,
                    inv.nmten,
                    inv.nmmst,
                    inv.nmdchi,
                    inv.raw_json,
                ])?;
            }
        }
        tx.commit()
    }

    /// Truy vấn hóa đơn theo bộ lọc (sắp xếp ngày giảm dần).
    pub fn query(&self, filter: &InvoiceFilter) -> Result<Vec<Invoice>> {
        let mut sql = String::from(
            "SELECT id, kind, nbmst, khmshdon, khhdon, shdon, dvtte, nbdchi, nbten, \
             tgtcthue, tgtthue, tgtttbso, tlhdon, ttcktmai, tthai, ttxly, ntao, \
             nmten, nmmst, nmdchi, raw_json, qrcode, hdhhdvu \
             FROM invoices WHERE 1=1",
        );
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        push_invoice_conditions(filter, &mut sql, &mut args);
        sql.push_str(" ORDER BY ntao DESC");
        if let Some(limit) = filter.limit {
            sql.push_str(" LIMIT ?");
            args.push(Box::new(limit as i64));
            // OFFSET chỉ hợp lệ khi đi kèm LIMIT (ràng buộc của SQLite).
            if let Some(offset) = filter.offset {
                sql.push_str(" OFFSET ?");
                args.push(Box::new(offset as i64));
            }
        }

        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&sql)?;
        let param_refs: Vec<&dyn rusqlite::ToSql> = args.iter().map(|b| b.as_ref()).collect();
        let rows = stmt.query_map(param_refs.as_slice(), row_to_invoice)?;
        rows.collect()
    }

    /// Lấy 1 hóa đơn theo `id` (None nếu không tồn tại).
    pub fn get_invoice(&self, id: &str) -> Result<Option<Invoice>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, kind, nbmst, khmshdon, khhdon, shdon, dvtte, nbdchi, nbten, \
             tgtcthue, tgtthue, tgtttbso, tlhdon, ttcktmai, tthai, ttxly, ntao, \
             nmten, nmmst, nmdchi, raw_json, qrcode, hdhhdvu \
             FROM invoices WHERE id = ?1",
            [id],
            row_to_invoice,
        )
        .optional()
    }

    /// Ghi chi tiết lazy-load (`qrcode` + `hdhhdvu` JSON thô) cho 1 hóa đơn.
    /// Chỉ đụng 2 cột này nên sync sau đó (upsert) không xoá mất.
    pub fn set_invoice_detail(&self, id: &str, qrcode: &str, hdhhdvu: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE invoices SET qrcode = ?1, hdhhdvu = ?2 WHERE id = ?3",
            params![qrcode, hdhhdvu, id],
        )?;
        Ok(())
    }

    /// Đếm tổng số hóa đơn khớp bộ lọc `kind`/`from`/`to` (bỏ qua limit/offset).
    pub fn count_invoices(&self, filter: &InvoiceFilter) -> Result<i64> {
        let mut sql = String::from("SELECT COUNT(*) FROM invoices WHERE 1=1");
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        push_invoice_conditions(filter, &mut sql, &mut args);

        let conn = self.conn.lock().unwrap();
        let param_refs: Vec<&dyn rusqlite::ToSql> = args.iter().map(|b| b.as_ref()).collect();
        conn.query_row(&sql, param_refs.as_slice(), |r| r.get(0))
    }

    pub fn get_sync_state(&self) -> Result<SyncState> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT oldest_date, newest_date, backfill_done, last_sync_at \
             FROM sync_state WHERE id = 1",
            [],
            |r| {
                Ok(SyncState {
                    oldest_date: r.get(0)?,
                    newest_date: r.get(1)?,
                    backfill_done: r.get::<_, i64>(2)? != 0,
                    last_sync_at: r.get(3)?,
                })
            },
        )
        .optional()
        .map(Option::unwrap_or_default)
    }

    pub fn set_sync_state(&self, s: &SyncState) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sync_state SET oldest_date=?1, newest_date=?2, backfill_done=?3, last_sync_at=?4 \
             WHERE id = 1",
            params![
                s.oldest_date,
                s.newest_date,
                s.backfill_done as i64,
                s.last_sync_at,
            ],
        )?;
        Ok(())
    }

    /// Đếm tổng số hóa đơn (tiện cho hiển thị/tiến độ).
    pub fn count(&self) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.query_row("SELECT COUNT(*) FROM invoices", [], |r| r.get(0))
    }

    /// Xóa hóa đơn có ngày < `date` (dạng `YYYY-MM-DD`). Trả số dòng đã xóa.
    /// Dùng khi nâng FLOOR muộn hơn (thu hẹp lịch sử).
    pub fn delete_invoices_before(&self, date: &str) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM invoices WHERE ntao < ?1", params![date])
    }

    /// Xóa toàn bộ dữ liệu cục bộ: hóa đơn, mọi setting (gồm floor), và reset
    /// sync_state. Dùng khi đăng xuất. Giữ nguyên schema/bảng, chỉ xóa nội dung.
    pub fn clear_all(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "DELETE FROM invoices;
             DELETE FROM settings;
             UPDATE sync_state SET oldest_date=NULL, newest_date=NULL,
                 backfill_done=0, last_sync_at=NULL WHERE id=1;",
        )
    }

    // ---- Nguyên liệu (raw_materials) ----------------------------------------

    /// Chèn nguyên liệu mới. Trả `id` vừa sinh.
    pub fn insert_raw_material(&self, m: &NewRawMaterial) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO raw_materials (code, name, producer, country_of_origin) \
             VALUES (?1, ?2, ?3, ?4)",
            params![m.code, m.name, m.producer, m.country_of_origin],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Cập nhật nguyên liệu (kèm `updated_at`).
    pub fn update_raw_material(&self, id: i64, m: &NewRawMaterial) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE raw_materials SET code=?1, name=?2, producer=?3, country_of_origin=?4, \
             updated_at=datetime('now') WHERE id=?5",
            params![m.code, m.name, m.producer, m.country_of_origin, id],
        )?;
        Ok(())
    }

    /// Soft delete nguyên liệu (đánh dấu `deleted_at`).
    pub fn soft_delete_raw_material(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE raw_materials SET deleted_at=datetime('now'), updated_at=datetime('now') \
             WHERE id=?1",
            params![id],
        )?;
        Ok(())
    }

    /// Lấy một nguyên liệu còn hiệu lực theo `id`.
    pub fn get_raw_material(&self, id: i64) -> Result<Option<RawMaterial>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, code, name, producer, country_of_origin, deleted_at, created_at, updated_at \
             FROM raw_materials WHERE id=?1 AND deleted_at IS NULL",
            params![id],
            row_to_raw_material,
        )
        .optional()
    }

    /// Lấy một nguyên liệu còn hiệu lực theo `code` (khớp chính xác).
    pub fn get_raw_material_by_code(&self, code: &str) -> Result<Option<RawMaterial>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, code, name, producer, country_of_origin, deleted_at, created_at, updated_at \
             FROM raw_materials WHERE code=?1 AND deleted_at IS NULL",
            params![code],
            row_to_raw_material,
        )
        .optional()
    }

    /// Danh sách nguyên liệu còn hiệu lực (lọc theo `q` trên code/name).
    pub fn list_raw_materials(&self, f: &RawMaterialFilter) -> Result<Vec<RawMaterial>> {
        let mut sql = String::from(
            "SELECT id, code, name, producer, country_of_origin, deleted_at, created_at, updated_at \
             FROM raw_materials WHERE deleted_at IS NULL",
        );
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(q) = &f.q {
            sql.push_str(" AND (code LIKE ? OR name LIKE ?)");
            let like = format!("%{q}%");
            args.push(Box::new(like.clone()));
            args.push(Box::new(like));
        }
        sql.push_str(" ORDER BY id DESC");
        if let Some(limit) = f.limit {
            sql.push_str(" LIMIT ?");
            args.push(Box::new(limit as i64));
            // OFFSET chỉ hợp lệ khi đi kèm LIMIT (ràng buộc của SQLite).
            if let Some(offset) = f.offset {
                sql.push_str(" OFFSET ?");
                args.push(Box::new(offset as i64));
            }
        }

        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&sql)?;
        let param_refs: Vec<&dyn rusqlite::ToSql> = args.iter().map(|b| b.as_ref()).collect();
        let rows = stmt.query_map(param_refs.as_slice(), row_to_raw_material)?;
        rows.collect()
    }

    /// Đếm tổng số nguyên liệu còn hiệu lực khớp bộ lọc `q` (bỏ qua limit/offset).
    pub fn count_raw_materials(&self, f: &RawMaterialFilter) -> Result<i64> {
        let mut sql =
            String::from("SELECT COUNT(*) FROM raw_materials WHERE deleted_at IS NULL");
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(q) = &f.q {
            sql.push_str(" AND (code LIKE ? OR name LIKE ?)");
            let like = format!("%{q}%");
            args.push(Box::new(like.clone()));
            args.push(Box::new(like));
        }

        let conn = self.conn.lock().unwrap();
        let param_refs: Vec<&dyn rusqlite::ToSql> = args.iter().map(|b| b.as_ref()).collect();
        conn.query_row(&sql, param_refs.as_slice(), |r| r.get(0))
    }

    /// Nhập hàng loạt trong 1 transaction. Trả `(số đã tạo, các code bị bỏ qua do trùng)`.
    ///
    /// Trùng = vi phạm UNIQUE `ux_raw_materials_code`: mã đã tồn tại ở hàng còn hiệu lực
    /// HOẶC đã được chèn ở dòng trước trong cùng batch (unique kiểm tra ngay theo từng câu
    /// lệnh, không defer). Các lỗi khác -> rollback cả batch.
    pub fn insert_raw_materials_bulk(
        &self,
        rows: &[NewRawMaterial],
    ) -> Result<(usize, Vec<String>)> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let mut created = 0usize;
        let mut duplicates: Vec<String> = Vec::new();
        {
            let mut stmt = tx.prepare(
                "INSERT INTO raw_materials (code, name, producer, country_of_origin) \
                 VALUES (?1, ?2, ?3, ?4)",
            )?;
            for m in rows {
                match stmt.execute(params![m.code, m.name, m.producer, m.country_of_origin]) {
                    Ok(_) => created += 1,
                    Err(rusqlite::Error::SqliteFailure(e, _))
                        if e.code == rusqlite::ErrorCode::ConstraintViolation =>
                    {
                        duplicates.push(m.code.clone());
                    }
                    Err(e) => return Err(e),
                }
            }
        }
        tx.commit()?;
        Ok((created, duplicates))
    }

    // ---- COA (coas) ---------------------------------------------------------

    /// Chèn COA mới. Trả `id` vừa sinh.
    pub fn insert_coa(&self, c: &NewCoa) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO coas (raw_material_id, lot_no, manufacture_date, expiration_date, path) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                c.raw_material_id,
                c.lot_no,
                c.manufacture_date,
                c.expiration_date,
                c.path
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Cập nhật COA (kèm `updated_at`). `raw_material_id` cũng có thể đổi.
    pub fn update_coa(&self, id: i64, c: &NewCoa) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE coas SET raw_material_id=?1, lot_no=?2, manufacture_date=?3, \
             expiration_date=?4, path=?5, updated_at=datetime('now') WHERE id=?6",
            params![
                c.raw_material_id,
                c.lot_no,
                c.manufacture_date,
                c.expiration_date,
                c.path,
                id
            ],
        )?;
        Ok(())
    }

    /// Soft delete COA (đánh dấu `deleted_at`).
    pub fn soft_delete_coa(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE coas SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE id=?1",
            params![id],
        )?;
        Ok(())
    }

    /// Danh sách COA còn hiệu lực của một nguyên liệu.
    pub fn list_coas(&self, raw_material_id: i64) -> Result<Vec<Coa>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, raw_material_id, lot_no, manufacture_date, expiration_date, path, \
             deleted_at, created_at, updated_at \
             FROM coas WHERE raw_material_id=?1 AND deleted_at IS NULL ORDER BY id DESC",
        )?;
        let rows = stmt.query_map(params![raw_material_id], row_to_coa)?;
        rows.collect()
    }

    /// Lấy một COA còn hiệu lực theo `id`.
    pub fn get_coa(&self, id: i64) -> Result<Option<Coa>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, raw_material_id, lot_no, manufacture_date, expiration_date, path, \
             deleted_at, created_at, updated_at \
             FROM coas WHERE id=?1 AND deleted_at IS NULL",
            params![id],
            row_to_coa,
        )
        .optional()
    }

    /// Gán đường dẫn file cho COA (sau khi ghi file ra đĩa).
    pub fn set_coa_path(&self, id: i64, path: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE coas SET path=?1, updated_at=datetime('now') WHERE id=?2",
            params![path, id],
        )?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |r| r.get(0),
        )
        .optional()
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }
}

fn row_to_invoice(r: &rusqlite::Row) -> Result<Invoice> {
    let kind_str: String = r.get(1)?;
    Ok(Invoice {
        id: r.get(0)?,
        kind: InvoiceKind::from_str(&kind_str).unwrap_or(InvoiceKind::Purchase),
        nbmst: r.get(2)?,
        khmshdon: r.get(3)?,
        khhdon: r.get(4)?,
        shdon: r.get(5)?,
        dvtte: r.get(6)?,
        nbdchi: r.get(7)?,
        nbten: r.get(8)?,
        tgtcthue: r.get(9)?,
        tgtthue: r.get(10)?,
        tgtttbso: r.get(11)?,
        tlhdon: r.get(12)?,
        ttcktmai: r.get(13)?,
        tthai: r.get(14)?,
        ttxly: r.get(15)?,
        ntao: r.get(16)?,
        nmten: r.get(17)?,
        nmmst: r.get(18)?,
        nmdchi: r.get(19)?,
        raw_json: r.get(20)?,
        qrcode: r.get(21)?,
        hdhhdvu: r.get(22)?,
    })
}

/// Ghép các điều kiện lọc hóa đơn vào `sql`/`args` (dùng chung cho `query` + `count_invoices`
/// để không lệch nhau). Chuỗi dò chứa dùng LIKE `%..%`; số khớp chính xác.
fn push_invoice_conditions(
    filter: &InvoiceFilter,
    sql: &mut String,
    args: &mut Vec<Box<dyn rusqlite::ToSql>>,
) {
    if let Some(kind) = filter.kind {
        sql.push_str(" AND kind = ?");
        args.push(Box::new(kind.as_str().to_string()));
    }
    if let Some(from) = &filter.from {
        sql.push_str(" AND ntao >= ?");
        args.push(Box::new(from.clone()));
    }
    if let Some(to) = &filter.to {
        sql.push_str(" AND ntao <= ?");
        args.push(Box::new(to.clone()));
    }
    if let Some(nbmst) = &filter.nbmst {
        sql.push_str(" AND nbmst LIKE ?");
        args.push(Box::new(format!("%{nbmst}%")));
    }
    if let Some(khhdon) = &filter.khhdon {
        sql.push_str(" AND khhdon LIKE ?");
        args.push(Box::new(format!("%{khhdon}%")));
    }
    if let Some(shdon) = filter.shdon {
        sql.push_str(" AND shdon = ?");
        args.push(Box::new(shdon as i64));
    }
    if let Some(khmshdon) = filter.khmshdon {
        sql.push_str(" AND khmshdon = ?");
        args.push(Box::new(khmshdon as i64));
    }
    if let Some(tthai) = filter.tthai {
        sql.push_str(" AND tthai = ?");
        args.push(Box::new(tthai as i64));
    }
    if let Some(ttxly) = filter.ttxly {
        sql.push_str(" AND ttxly = ?");
        args.push(Box::new(ttxly as i64));
    }
}

fn row_to_raw_material(r: &rusqlite::Row) -> Result<RawMaterial> {
    Ok(RawMaterial {
        id: r.get(0)?,
        code: r.get(1)?,
        name: r.get(2)?,
        producer: r.get(3)?,
        country_of_origin: r.get(4)?,
        deleted_at: r.get(5)?,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
    })
}

fn row_to_coa(r: &rusqlite::Row) -> Result<Coa> {
    Ok(Coa {
        id: r.get(0)?,
        raw_material_id: r.get(1)?,
        lot_no: r.get(2)?,
        manufacture_date: r.get(3)?,
        expiration_date: r.get(4)?,
        path: r.get(5)?,
        deleted_at: r.get(6)?,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inv(id: &str, ntao: &str, tgtttbso: f64) -> Invoice {
        Invoice {
            id: id.into(),
            kind: InvoiceKind::Purchase,
            nbmst: "0101".into(),
            khmshdon: 1,
            khhdon: "C25TAC".into(),
            shdon: 1,
            dvtte: "VND".into(),
            nbdchi: "".into(),
            nbten: "".into(),
            tgtcthue: 0.0,
            tgtthue: 0.0,
            tgtttbso,
            tlhdon: "".into(),
            ttcktmai: 0.0,
            tthai: 1,
            ttxly: 5,
            ntao: ntao.into(),
            nmten: "".into(),
            nmmst: "0202".into(),
            nmdchi: "".into(),
            raw_json: "{}".into(),
            qrcode: None,
            hdhhdvu: None,
        }
    }

    #[test]
    fn upsert_is_idempotent_and_updates() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_invoices(&[inv("a", "2026-01-01", 100.0), inv("b", "2026-02-01", 200.0)])
            .unwrap();
        // upsert lại 'a' với tgtttbso mới + thêm 'a' lần nữa -> không trùng, cập nhật.
        db.upsert_invoices(&[inv("a", "2026-01-01", 150.0)])
            .unwrap();

        assert_eq!(db.count().unwrap(), 2);
        let all = db.query(&InvoiceFilter::default()).unwrap();
        let a = all.iter().find(|i| i.id == "a").unwrap();
        assert_eq!(a.tgtttbso, 150.0);
    }

    #[test]
    fn get_invoice_and_set_detail_roundtrip() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_invoices(&[inv("a", "2026-01-01", 100.0)]).unwrap();

        // Mới insert -> chưa có chi tiết.
        let got = db.get_invoice("a").unwrap().unwrap();
        assert_eq!(got.qrcode, None);
        assert_eq!(got.hdhhdvu, None);
        assert!(db.get_invoice("missing").unwrap().is_none());

        db.set_invoice_detail("a", "QR-DATA", "[{\"ten\":\"x\"}]")
            .unwrap();
        let got = db.get_invoice("a").unwrap().unwrap();
        assert_eq!(got.qrcode.as_deref(), Some("QR-DATA"));
        assert_eq!(got.hdhhdvu.as_deref(), Some("[{\"ten\":\"x\"}]"));
    }

    #[test]
    fn reupsert_preserves_cached_detail() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_invoices(&[inv("a", "2026-01-01", 100.0)]).unwrap();
        db.set_invoice_detail("a", "QR-DATA", "[]").unwrap();

        // Sync lại ghi đè header nhưng KHÔNG được xoá chi tiết đã lazy-load.
        db.upsert_invoices(&[inv("a", "2026-01-01", 999.0)]).unwrap();
        let got = db.get_invoice("a").unwrap().unwrap();
        assert_eq!(got.tgtttbso, 999.0);
        assert_eq!(got.qrcode.as_deref(), Some("QR-DATA"));
        assert_eq!(got.hdhhdvu.as_deref(), Some("[]"));
    }

    #[test]
    fn query_filters_by_date_and_orders_desc() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_invoices(&[
            inv("a", "2026-01-01", 1.0),
            inv("b", "2026-02-01", 2.0),
            inv("c", "2026-03-01", 3.0),
        ])
        .unwrap();

        let f = InvoiceFilter {
            from: Some("2026-01-15".into()),
            to: Some("2026-02-15".into()),
            ..Default::default()
        };
        let got = db.query(&f).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].id, "b");

        // sắp xếp giảm dần theo ngày
        let all = db.query(&InvoiceFilter::default()).unwrap();
        assert_eq!(
            all.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(),
            vec!["c", "b", "a"]
        );
    }

    #[test]
    fn query_paginates_and_counts_invoices() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_invoices(&[
            inv("a", "2026-01-01", 1.0),
            inv("b", "2026-02-01", 2.0),
            inv("c", "2026-03-01", 3.0),
        ])
        .unwrap();

        // Trang đầu (limit=2, offset=0) -> 2 dòng, mới nhất trước (ntao desc).
        let page1 = db
            .query(&InvoiceFilter {
                limit: Some(2),
                offset: Some(0),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(page1.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), vec!["c", "b"]);

        // Trang 2 (offset=2) -> 1 dòng còn lại.
        let page2 = db
            .query(&InvoiceFilter {
                limit: Some(2),
                offset: Some(2),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(page2.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), vec!["a"]);

        // count_invoices bỏ qua limit/offset.
        assert_eq!(
            db.count_invoices(&InvoiceFilter {
                limit: Some(2),
                offset: Some(0),
                ..Default::default()
            })
            .unwrap(),
            3
        );
        // count có lọc khoảng ngày.
        assert_eq!(
            db.count_invoices(&InvoiceFilter {
                from: Some("2026-01-15".into()),
                to: Some("2026-02-15".into()),
                ..Default::default()
            })
            .unwrap(),
            1
        );
    }

    #[test]
    fn query_filters_by_invoice_fields() {
        let db = Db::open_in_memory().unwrap();
        let mut a = inv("a", "2026-01-01", 1.0);
        a.nbmst = "0100000001".into();
        a.khhdon = "C26TAA".into();
        a.shdon = 100;
        a.khmshdon = 1;
        let mut b = inv("b", "2026-02-01", 2.0);
        b.nbmst = "0100000002".into();
        b.khhdon = "C26TAB".into();
        b.shdon = 200;
        b.khmshdon = 2;
        let mut c = inv("c", "2026-03-01", 3.0);
        c.nbmst = "0100000001".into();
        c.khhdon = "K26TAA".into();
        c.shdon = 300;
        c.khmshdon = 1;
        db.upsert_invoices(&[a, b, c]).unwrap();

        // nbmst dò chứa -> a & c (sắp xếp ntao desc: c trước a).
        let r = db
            .query(&InvoiceFilter {
                nbmst: Some("0000001".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(
            r.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(),
            vec!["c", "a"]
        );

        // khhdon dò chứa "C26" -> a & b.
        assert_eq!(
            db.count_invoices(&InvoiceFilter {
                khhdon: Some("C26".into()),
                ..Default::default()
            })
            .unwrap(),
            2
        );

        // shdon khớp chính xác.
        let r = db
            .query(&InvoiceFilter {
                shdon: Some(200),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(
            r.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(),
            vec!["b"]
        );

        // khmshdon = 1 -> a & c; kết hợp khoảng ngày thu còn c.
        assert_eq!(
            db.count_invoices(&InvoiceFilter {
                khmshdon: Some(1),
                ..Default::default()
            })
            .unwrap(),
            2
        );
        let r = db
            .query(&InvoiceFilter {
                khmshdon: Some(1),
                from: Some("2026-02-15".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(
            r.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(),
            vec!["c"]
        );
    }

    #[test]
    fn query_filters_by_status() {
        let db = Db::open_in_memory().unwrap();
        let mut a = inv("a", "2026-01-01", 1.0);
        a.tthai = 1;
        a.ttxly = 5;
        let mut b = inv("b", "2026-02-01", 2.0);
        b.tthai = 2;
        b.ttxly = 5;
        let mut c = inv("c", "2026-03-01", 3.0);
        c.tthai = 1;
        c.ttxly = 6;
        db.upsert_invoices(&[a, b, c]).unwrap();

        // tthai = 1 -> a & c.
        assert_eq!(
            db.count_invoices(&InvoiceFilter {
                tthai: Some(1),
                ..Default::default()
            })
            .unwrap(),
            2
        );

        // ttxly = 5 -> a & b.
        assert_eq!(
            db.count_invoices(&InvoiceFilter {
                ttxly: Some(5),
                ..Default::default()
            })
            .unwrap(),
            2
        );

        // Kết hợp tthai = 1 + ttxly = 5 -> chỉ a.
        let r = db
            .query(&InvoiceFilter {
                tthai: Some(1),
                ttxly: Some(5),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(
            r.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(),
            vec!["a"]
        );
    }

    #[test]
    fn settings_roundtrip() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(db.get_setting("floor").unwrap(), None);
        db.set_setting("floor", "2022-01-01").unwrap();
        db.set_setting("floor", "2023-06-01").unwrap(); // upsert
        assert_eq!(
            db.get_setting("floor").unwrap().as_deref(),
            Some("2023-06-01")
        );
    }

    #[test]
    fn delete_invoices_before_prunes_older_only() {
        let db = Db::open_in_memory().unwrap();
        // date lưu dạng ISO tdlap; prune theo YYYY-MM-DD.
        db.upsert_invoices(&[
            inv("a", "2022-05-10T00:00:00Z", 1.0),
            inv("b", "2023-06-01T00:00:00Z", 2.0), // đúng mốc -> GIỮ
            inv("c", "2024-01-01T00:00:00Z", 3.0),
        ])
        .unwrap();

        let removed = db.delete_invoices_before("2023-06-01").unwrap();
        assert_eq!(removed, 1); // chỉ 'a'
        let ids: Vec<String> = db
            .query(&InvoiceFilter::default())
            .unwrap()
            .into_iter()
            .map(|i| i.id)
            .collect();
        assert_eq!(ids, vec!["c", "b"]); // desc theo ngày
    }

    #[test]
    fn sync_state_roundtrip() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(db.get_sync_state().unwrap().backfill_done, false);

        let s = SyncState {
            oldest_date: Some("2025-01-01".into()),
            newest_date: Some("2026-07-16".into()),
            backfill_done: true,
            last_sync_at: Some(1_700_000_000),
        };
        db.set_sync_state(&s).unwrap();
        let got = db.get_sync_state().unwrap();
        assert_eq!(got.backfill_done, true);
        assert_eq!(got.oldest_date.as_deref(), Some("2025-01-01"));
        assert_eq!(got.last_sync_at, Some(1_700_000_000));
    }

    // ---- raw_materials / coas ----------------------------------------------

    fn new_rm(code: &str, name: &str) -> NewRawMaterial {
        NewRawMaterial {
            code: code.into(),
            name: name.into(),
            producer: "Acme".into(),
            country_of_origin: Some("Việt Nam".into()),
        }
    }

    fn new_coa(rm_id: i64, lot_no: &str) -> NewCoa {
        NewCoa {
            raw_material_id: rm_id,
            lot_no: lot_no.into(),
            manufacture_date: Some("2025-01-01".into()),
            expiration_date: Some("2027-01-01".into()),
            path: None,
        }
    }

    #[test]
    fn insert_and_list_raw_materials() {
        let db = Db::open_in_memory().unwrap();
        let id1 = db.insert_raw_material(&new_rm("ICHRM-0248", "Bakuchiol")).unwrap();
        let id2 = db.insert_raw_material(&new_rm("ICHRM-0249", "Activoil")).unwrap();
        assert!(id2 > id1);

        let all = db.list_raw_materials(&RawMaterialFilter::default()).unwrap();
        assert_eq!(all.len(), 2);
        // ORDER BY id DESC -> mới nhất trước.
        assert_eq!(all[0].id, id2);
        // Timestamp do DB tự sinh (không rỗng).
        assert!(!all[0].created_at.is_empty());
        assert!(all[0].deleted_at.is_none());
    }

    #[test]
    fn raw_material_has_many_coas() {
        let db = Db::open_in_memory().unwrap();
        let rm = db.insert_raw_material(&new_rm("ICHRM-0248", "Bakuchiol")).unwrap();
        let other = db.insert_raw_material(&new_rm("ICHRM-0249", "Activoil")).unwrap();

        db.insert_coa(&new_coa(rm, "LOT-1")).unwrap();
        db.insert_coa(&new_coa(rm, "LOT-2")).unwrap();
        db.insert_coa(&new_coa(rm, "LOT-3")).unwrap();
        db.insert_coa(&new_coa(other, "LOT-X")).unwrap();

        let coas = db.list_coas(rm).unwrap();
        assert_eq!(coas.len(), 3);
        assert!(coas.iter().all(|c| c.raw_material_id == rm));
        // COA của nguyên liệu khác không lẫn.
        assert_eq!(db.list_coas(other).unwrap().len(), 1);
    }

    #[test]
    fn soft_delete_excludes_from_list() {
        let db = Db::open_in_memory().unwrap();
        let rm = db.insert_raw_material(&new_rm("ICHRM-0248", "Bakuchiol")).unwrap();
        let coa = db.insert_coa(&new_coa(rm, "LOT-1")).unwrap();

        db.soft_delete_raw_material(rm).unwrap();
        assert!(db.get_raw_material(rm).unwrap().is_none());
        assert_eq!(db.list_raw_materials(&RawMaterialFilter::default()).unwrap().len(), 0);

        db.soft_delete_coa(coa).unwrap();
        assert_eq!(db.list_coas(rm).unwrap().len(), 0);
    }

    #[test]
    fn filter_q_matches_code_or_name() {
        let db = Db::open_in_memory().unwrap();
        db.insert_raw_material(&new_rm("ICHRM-0248", "Bakuchiol")).unwrap();
        db.insert_raw_material(&new_rm("ICHRM-0249", "Activoil")).unwrap();

        // khớp theo code
        let by_code = db
            .list_raw_materials(&RawMaterialFilter {
                q: Some("0248".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(by_code.len(), 1);
        assert_eq!(by_code[0].code, "ICHRM-0248");

        // khớp theo name
        let by_name = db
            .list_raw_materials(&RawMaterialFilter {
                q: Some("Activoil".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(by_name.len(), 1);
        assert_eq!(by_name[0].name, "Activoil");
    }

    #[test]
    fn get_by_code_returns_active_only() {
        let db = Db::open_in_memory().unwrap();
        let id = db.insert_raw_material(&new_rm("ICHRM-0248", "Bakuchiol")).unwrap();

        let found = db.get_raw_material_by_code("ICHRM-0248").unwrap();
        assert_eq!(found.map(|m| m.id), Some(id));
        assert!(db.get_raw_material_by_code("ICHRM-9999").unwrap().is_none());

        // Sau soft-delete -> không tìm thấy.
        db.soft_delete_raw_material(id).unwrap();
        assert!(db.get_raw_material_by_code("ICHRM-0248").unwrap().is_none());
    }

    #[test]
    fn list_raw_materials_paginates_and_counts() {
        let db = Db::open_in_memory().unwrap();
        for i in 1..=5 {
            db.insert_raw_material(&new_rm(&format!("ICHRM-000{i}"), &format!("RM {i}")))
                .unwrap();
        }

        // Trang đầu (limit=2, offset=0) -> 2 dòng.
        let page1 = db
            .list_raw_materials(&RawMaterialFilter {
                limit: Some(2),
                offset: Some(0),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(page1.len(), 2);

        // Trang cuối (offset=4) -> 1 dòng còn lại.
        let last = db
            .list_raw_materials(&RawMaterialFilter {
                limit: Some(2),
                offset: Some(4),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(last.len(), 1);

        // Đếm tổng bỏ qua limit/offset.
        assert_eq!(
            db.count_raw_materials(&RawMaterialFilter {
                limit: Some(2),
                offset: Some(0),
                ..Default::default()
            })
            .unwrap(),
            5
        );

        // Đếm có lọc q.
        assert_eq!(
            db.count_raw_materials(&RawMaterialFilter {
                q: Some("RM 3".into()),
                ..Default::default()
            })
            .unwrap(),
            1
        );
    }

    #[test]
    fn duplicate_active_code_rejected() {
        let db = Db::open_in_memory().unwrap();
        let id = db.insert_raw_material(&new_rm("ICHRM-0001", "A")).unwrap();

        // Trùng code trên hàng còn hiệu lực -> lỗi (partial unique index).
        assert!(db.insert_raw_material(&new_rm("ICHRM-0001", "B")).is_err());

        // Soft-delete rồi tạo lại cùng code -> OK.
        db.soft_delete_raw_material(id).unwrap();
        assert!(db.insert_raw_material(&new_rm("ICHRM-0001", "C")).is_ok());
    }

    #[test]
    fn bulk_insert_skips_duplicates_in_db_and_batch() {
        let db = Db::open_in_memory().unwrap();
        // Đã có sẵn ICHRM-0001 trong DB.
        db.insert_raw_material(&new_rm("ICHRM-0001", "Cũ")).unwrap();

        let rows = vec![
            new_rm("ICHRM-0001", "Trùng DB"),    // trùng bản ghi đang có
            new_rm("ICHRM-0002", "Mới A"),       // hợp lệ
            new_rm("ICHRM-0003", "Mới B"),       // hợp lệ
            new_rm("ICHRM-0002", "Trùng batch"), // trùng dòng ICHRM-0002 ở trên
        ];
        let (created, duplicates) = db.insert_raw_materials_bulk(&rows).unwrap();

        assert_eq!(created, 2); // chỉ 0002 + 0003
        assert_eq!(duplicates, vec!["ICHRM-0001", "ICHRM-0002"]);

        // Tổng bản ghi còn hiệu lực = 3 (0001 cũ + 0002 + 0003), không ghi đè "Cũ".
        let all = db.list_raw_materials(&RawMaterialFilter::default()).unwrap();
        assert_eq!(all.len(), 3);
        let old = all.iter().find(|m| m.code == "ICHRM-0001").unwrap();
        assert_eq!(old.name, "Cũ");
    }
}
