import { useEffect, useState } from "react";

/** Trả về `value` sau khi nó ngừng thay đổi trong `delayMs` mili-giây. */
export function useDebounce<T>(value: T, delayMs = 500): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
}
