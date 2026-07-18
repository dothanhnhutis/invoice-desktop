import * as React from "react";

/**
 * Trạng thái mạng của app.
 * - `online`  : đã xác nhận có internet.
 * - `offline` : mất kết nối (mất card mạng, hoặc ping thất bại).
 * - `checking`: đang xác minh kết nối (giai đoạn giữa khi khôi phục mạng).
 */
export type NetworkStatus = "online" | "offline" | "checking";

export type UseOnlineOptions = {
  /**
   * URL để xác minh internet THẬT (vì `navigator.onLine` chỉ báo có card mạng).
   * Bỏ trống = tin luôn `navigator.onLine`, không có bước `checking`.
   * Gợi ý: một tài nguyên nhẹ, luôn sống.
   */
  probeUrl?: string;
  /** Timeout mỗi lần ping (ms). Mặc định 5s. */
  timeoutMs?: number;
  /** Khoảng chờ trước khi checking lại sau khi ping thất bại (ms). Mặc định 2s. */
  retryDelayMs?: number;
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
 * Hook theo dõi kết nối internet với máy trạng thái:
 *
 * ```
 * offline --(có mạng lại)--> checking --(ping OK)--> online   (kết thúc)
 *                             ^     |
 *                             └-----┘ (ping FAIL: vẫn checking, thử lại tới khi OK)
 * ```
 *
 * - Mất card mạng (sự kiện `offline`) -> `offline` ngay, dừng ping.
 * - Có mạng lại (sự kiện `online`) -> `checking` -> ping:
 *   - thành công -> `online` rồi dừng.
 *   - thất bại  -> VẪN `checking`, tự thử lại tới khi thành công.
 *
 * ```tsx
 * const net = useOnline({ probeUrl: "https://.../favicon.ico" });
 * // net.status | net.online | net.offline | net.checking
 * ```
 */
export function useOnline(options: UseOnlineOptions = {}) {
  const { probeUrl, timeoutMs = 5_000, retryDelayMs = 2_000 } = options;

  const [status, setStatus] = React.useState<NetworkStatus>("online");

  React.useEffect(() => {
    const onOnline = () => {
      setStatus("checking");
    };

    const onOffline = () => {
      setStatus("offline");
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  React.useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;

    (async () => {
      if (status == "checking") {
        if (!probeUrl) {
          setStatus("online");
          return;
        }
        timer = setInterval(async () => {
          const ok = await probe(probeUrl, timeoutMs);
          if (ok) {
            setStatus("online");
            clearInterval(timer);
          }
        }, timeoutMs);
      }
    })();
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [status, probeUrl, timeoutMs]);

  return status;
}
