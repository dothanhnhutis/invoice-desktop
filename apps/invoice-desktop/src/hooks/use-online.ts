import * as React from "react";

/**
 * Theo dõi máy có mạng hay không, phản ứng NGAY khi rớt/khôi phục mạng.
 *
 * Dựa trên `navigator.onLine` + sự kiện `online`/`offline` của trình duyệt
 * (không ping URL nào).
 *
 * ```tsx
 * const online = useOnline();
 * if (!online) return <div>Mất kết nối mạng</div>;
 * ```
 */
export function useOnline() {
  const [online, setOnline] = React.useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  React.useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    // Đồng bộ lại phòng khi trạng thái đổi giữa lúc render và effect.
    setOnline(navigator.onLine);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return online;
}
