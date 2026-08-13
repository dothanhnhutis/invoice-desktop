// Định dạng ngày cho COA: dd/mm/yyyy, hoặc chỉ tháng/năm mm/yyyy (một số COA không có ngày cụ thể).

const DMY = /^(\d{2})\/(\d{2})\/(\d{4})$/; // dd/mm/yyyy
const MY = /^(\d{2})\/(\d{4})$/; // mm/yyyy
const ISO_YMD = /^(\d{4})-(\d{2})-(\d{2})$/; // yyyy-mm-dd (dữ liệu cũ)
const ISO_YM = /^(\d{4})-(\d{2})$/; // yyyy-mm (dữ liệu cũ)

const validMonth = (m: number) => m >= 1 && m <= 12;
const validDay = (d: number) => d >= 1 && d <= 31;

/** `s` là ngày COA hợp lệ: dd/mm/yyyy hoặc mm/yyyy (kiểm ngày/tháng cơ bản). */
export function isVnDate(s: string): boolean {
  const dmy = s.match(DMY);
  if (dmy) return validDay(+dmy[1]) && validMonth(+dmy[2]);
  const my = s.match(MY);
  if (my) return validMonth(+my[1]);
  return false;
}

/** dd/mm/yyyy -> yyyy-mm-dd (ISO). null nếu không phải ngày dd/mm/yyyy hợp lệ. */
export function vnDateToIso(s: string): string | null {
  const m = s.trim().match(DMY);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  if (!validDay(+dd) || !validMonth(+mm)) return null;
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Khóa so sánh ngày COA → số `yyyymmdd` (vd `15/01/2026` → 20260115). Ngày lưu là TEXT tự do
 * (dd/mm/yyyy, mm/yyyy, hoặc ISO của dữ liệu cũ) nên so sánh chuỗi trực tiếp sẽ SAI thứ tự.
 * Chỉ có tháng/năm → ngày = 00 (đứng trước mọi ngày cụ thể trong cùng tháng).
 * Rỗng/không parse được → `undefined` (dùng với `sortUndefined: "last"`).
 */
export function vnDateSortKey(s: string | null | undefined): number | undefined {
  if (!s) return undefined;
  const t = s.trim();
  const dmy = t.match(DMY);
  if (dmy) return +dmy[3] * 10000 + +dmy[2] * 100 + +dmy[1];
  const my = t.match(MY);
  if (my) return +my[2] * 10000 + +my[1] * 100;
  const ymd = t.match(ISO_YMD);
  if (ymd) return +ymd[1] * 10000 + +ymd[2] * 100 + +ymd[3];
  const ym = t.match(ISO_YM);
  if (ym) return +ym[1] * 10000 + +ym[2] * 100;
  return undefined;
}

/**
 * Hiển thị ngày COA dạng dd/mm/yyyy (hoặc mm/yyyy). Dữ liệu cũ lưu ISO (yyyy-mm-dd / yyyy-mm)
 * sẽ được đổi sang cho đồng nhất. Rỗng/null → "-".
 */
export function formatVnDate(s: string | null | undefined): string {
  if (!s) return "-";
  const ymd = s.match(ISO_YMD);
  if (ymd) return `${ymd[3]}/${ymd[2]}/${ymd[1]}`;
  const ym = s.match(ISO_YM);
  if (ym) return `${ym[2]}/${ym[1]}`;
  return s;
}
