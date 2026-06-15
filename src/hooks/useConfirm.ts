import { useState, useCallback } from "react";

export function useConfirm() {
  const [confirmDialog, setConfirmDialog] = useState<{ show: boolean; message: string; onConfirm: () => void }>({
    show: false,
    message: "",
    onConfirm: () => {},
  });

  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
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
    setConfirmDialog({ show: false, message: "", onConfirm: () => {} });
  }, []);

  return { confirmDialog, confirm, cancelConfirm };
}
