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
