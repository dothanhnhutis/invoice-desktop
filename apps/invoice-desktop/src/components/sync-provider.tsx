import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

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
};

const SyncContext = createContext<SyncContextValue>({
  progress: null,
  error: null,
});

/** Đọc trạng thái đồng bộ mới nhất (progress/error) từ bất kỳ trang nào. */
export function useSync() {
  return useContext(SyncContext);
}

/**
 * Đăng ký listener sync://* MỘT lần cho cả app (mount ở __root).
 * Nhờ vậy tiến độ/lỗi không mất khi chuyển route.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // useEffect(() => {
  //   const unlisteners: UnlistenFn[] = [];
  //   listen<SyncProgress>("sync://progress", (e) => {
  //     setProgress(e.payload);
  //     setError(null);
  //   }).then((u) => unlisteners.push(u));
  //   listen<string>("sync://error", (e) => setError(e.payload)).then((u) =>
  //     unlisteners.push(u),
  //   );
  //   return () => unlisteners.forEach((u) => u());
  // }, []);

  return (
    <SyncContext.Provider value={{ progress, error }}>
      {children}
    </SyncContext.Provider>
  );
}
