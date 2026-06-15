import { useState, useCallback, useRef } from "react";

export function useConfirm() {
  const [confirmDialog, setConfirmDialog] = useState<{ show: boolean; message: string; onConfirm: () => void }>({
    show: false,
    message: "",
    onConfirm: () => {},
  });

  const resolveRef = useRef<(value: boolean) => void>(() => {});

  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setConfirmDialog({
        show: true,
        message,
        onConfirm: () => {
          setConfirmDialog({ show: false, message: "", onConfirm: () => {} });
          resolve(true);
        },
      });
    });
  }, []);

  const cancelConfirm = useCallback(() => {
    resolveRef.current(false);
    setConfirmDialog({ show: false, message: "", onConfirm: () => {} });
  }, []);

  return { confirmDialog, confirm, cancelConfirm };
}
