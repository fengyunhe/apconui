import { useState, useCallback, useRef, useEffect } from "react";
import type { ToastType } from "../types";

export function useToast() {
  const [toastMessage, setToastMessage] = useState<{ type: ToastType; text: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // TODO: [auto-fix] empty deps — verify if intentional; add deps or suppress with eslint-disable;

  const showToast = useCallback((type: ToastType, text: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToastMessage({ type, text });
    timerRef.current = setTimeout(() => {
      setToastMessage(null);
      timerRef.current = null;
    }, 3000);
  }, []);

  return { toastMessage, showToast };
}
