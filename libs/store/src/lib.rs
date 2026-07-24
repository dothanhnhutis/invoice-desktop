//! Lưu trữ cục bộ bằng SQLite (rusqlite bundled).
//!
//! `Db` bọc `Connection` trong `Mutex` để chia sẻ an toàn qua Tauri state.
//! Các thao tác đồng bộ (blocking) — ở tầng async nên gọi qua `spawn_blocking`
//! nếu batch lớn; batch nhỏ gọi trực tiếp cũng được.

use std::path::Path;
use std::sync::Mutex;

use domain::{Invoice, InvoiceFilter, InvoiceKind, SyncState};
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
    raw_json    TEXT NOT NULL
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
        conn.execute_batch(SCHEMA)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
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
             nmten, nmmst, nmdchi, raw_json \
             FROM invoices WHERE 1=1",
        );
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

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
        sql.push_str(" ORDER BY ntao DESC");
        if let Some(limit) = filter.limit {
            sql.push_str(" LIMIT ?");
            args.push(Box::new(limit as i64));
        }

        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&sql)?;
        let param_refs: Vec<&dyn rusqlite::ToSql> = args.iter().map(|b| b.as_ref()).collect();
        let rows = stmt.query_map(param_refs.as_slice(), row_to_invoice)?;
        rows.collect()
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

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| {
            r.get(0)
        })
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
        }
    }

    #[test]
    fn upsert_is_idempotent_and_updates() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_invoices(&[inv("a", "2026-01-01", 100.0), inv("b", "2026-02-01", 200.0)])
            .unwrap();
        // upsert lại 'a' với tgtttbso mới + thêm 'a' lần nữa -> không trùng, cập nhật.
        db.upsert_invoices(&[inv("a", "2026-01-01", 150.0)]).unwrap();

        assert_eq!(db.count().unwrap(), 2);
        let all = db.query(&InvoiceFilter::default()).unwrap();
        let a = all.iter().find(|i| i.id == "a").unwrap();
        assert_eq!(a.tgtttbso, 150.0);
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
    fn settings_roundtrip() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(db.get_setting("floor").unwrap(), None);
        db.set_setting("floor", "2022-01-01").unwrap();
        db.set_setting("floor", "2023-06-01").unwrap(); // upsert
        assert_eq!(db.get_setting("floor").unwrap().as_deref(), Some("2023-06-01"));
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
}
