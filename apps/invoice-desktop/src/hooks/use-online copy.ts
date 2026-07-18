import * as React from "react";

/**
 * Trạng thái mạng của app.
 * - `online`: có kết nối (theo trình duyệt, và nếu bật `probeUrl` thì đã ping được).
 * - `checking`: đang chủ động kiểm tra (chỉ khi bật `probeUrl`).
 */
export type NetworkStatus = "online" | "offline" | "checking";

export type UseOnlineOptions = {
  /**
   * URL để CHỦ ĐỘNG kiểm tra internet thật (vì `navigator.onLine` chỉ báo có card
   * mạng, có thể "online" nhưng không ra được internet). Bỏ trống = chỉ nghe sự kiện
   * online/offline của trình duyệt.
   * Gợi ý: một endpoint nhẹ, luôn sống, ví dụ `"https://hoadondientu.gdt.gov.vn/favicon.ico"`.
   */
  probeUrl?: string;
  /** Chu kỳ ping lại khi đang online (ms). Mặc định 15s. Chỉ dùng khi có `probeUrl`. */
  intervalMs?: number;
  /** Timeout mỗi lần ping (ms). Mặc định 5s. */
  timeoutMs?: number;
};

/** Ping thử một URL; true nếu tới được (bất kể mã HTTP), false nếu lỗi/timeout. */
async function probe(url: string, timeoutMs: number): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // no-cors + no-store: chỉ cần biết request có ĐI được hay không, không đọc body.
    await fetch(url, {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-store",
      signal: ctrl.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Hook theo dõi có internet hay không.
 *
 * ```tsx
 * const { online, offline, status, refresh } = useOnline();
 * // hoặc chủ động verify internet thật:
 * const net = useOnline({ probeUrl: "https://hoadondientu.gdt.gov.vn/static/images/NTT_Logo_v2.png" });
 * ```
 */
export function useOnline(options: UseOnlineOptions = {}) {
  const { probeUrl, intervalMs = 15_000, timeoutMs = 5_000 } = options;

  // Khởi tạo theo trình duyệt (SSR-safe: mặc định online nếu không có navigator).
  const [status, setStatus] = React.useState<NetworkStatus>(() =>
    typeof navigator === "undefined" || navigator.onLine ? "online" : "offline",
  );

  // Chủ động kiểm tra internet thật; chỉ chạy khi có probeUrl.
  const refresh = React.useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setStatus("offline");
      return false;
    }
    if (!probeUrl) {
      setStatus("online");
      return true;
    }
    setStatus("checking");
    const ok = await probe(probeUrl, timeoutMs);
    setStatus(ok ? "online" : "offline");
    return ok;
  }, [probeUrl, timeoutMs]);

  React.useEffect(() => {
    let alive = true;

    const onOnline = () => {
      // Trình duyệt báo có mạng lại -> xác nhận (nếu có probe) hoặc set online.
      if (probeUrl) void refresh();
      else setStatus("online");
    };
    const onOffline = () => setStatus("offline");

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    // Kiểm tra ngay lần đầu.
    void refresh();

    // Ping định kỳ để bắt trường hợp mất internet "ngầm" (onLine vẫn true).
    let timer: ReturnType<typeof setInterval> | undefined;
    if (probeUrl) {
      timer = setInterval(() => {
        if (alive) void refresh();
      }, intervalMs);
    }

    return () => {
      alive = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      if (timer) clearInterval(timer);
    };
  }, [probeUrl, intervalMs, refresh]);

  return {
    status,
    online: status === "online",
    offline: status === "offline",
    checking: status === "checking",
    /** Ép kiểm tra lại ngay (trả về true nếu online). */
    refresh,
  };
}
