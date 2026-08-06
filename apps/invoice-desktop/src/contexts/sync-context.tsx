import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { api } from "@/lib/api";

/** Payload event `sync://progress` (khớp struct SyncProgress ở Rust). */
export type SyncProgress = {
  phase: string;
  oldest: string | null;
  newest: string | null;
  saved: number;
  total_in_db: number;
};

type SyncContextValue = {
  progress: SyncProgress | null;
  error: string | null;
  /** Luồng nền đang chạy 1 lượt đồng bộ (khóa form cập nhật floor/mật khẩu). */
  busy: boolean;
};

const SyncContext = createContext<SyncContextValue>({
  progress: null,
  error: null,
  busy: false,
});

/** Đọc trạng thái đồng bộ mới nhất (progress/error) từ bất kỳ trang nào. */
export function useSync() {
  const context = useContext(SyncContext);
  if (context === undefined)
    throw new Error("useSync must be used within a SyncProvider");

  return context;
}

/**
 * Đăng ký listener sync://* MỘT lần cho cả app (mount ở __root).
 * Nhờ vậy tiến độ/lỗi không mất khi chuyển route.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    listen<SyncProgress>("sync://progress", (e) => {
      setProgress(e.payload);
      setError(null);
    }).then((u) => unlisteners.push(u));
    listen<string>("sync://error", (e) => setError(e.payload)).then((u) =>
      unlisteners.push(u),
    );
    listen<boolean>("sync://busy", (e) => setBusy(e.payload)).then((u) =>
      unlisteners.push(u),
    );
    // Event chỉ phát lúc chuyển trạng thái -> đọc giá trị hiện tại khi mở app.
    api
      .isSyncing()
      .then(setBusy)
      .catch(() => {});
    return () => unlisteners.forEach((u) => u());
  }, []);

  const contextValue = useMemo<SyncContextValue>(() => {
    return {
      progress,
      error,
      busy,
    };
  }, [progress, error, busy]);

  return (
    <SyncContext.Provider value={contextValue}>{children}</SyncContext.Provider>
  );
}
