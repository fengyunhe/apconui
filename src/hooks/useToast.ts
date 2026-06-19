import { useState, useCallback, useRef, useEffect } from "react";

export function useToast() {
  const [toastMessage, setToastMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []) // TODO: [auto-fix] empty deps — verify if intentional; add deps or suppress with eslint-disable;

  const showToast = useCallback((type: "success" | "error", text: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToastMessage({ type, text });
    timerRef.current = setTimeout(() => {
      setToastMessage(null);
      timerRef.current = null;
    }, 3000);
  }, []);

  return { toastMessage, showToast };
}
