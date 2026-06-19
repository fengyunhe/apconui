import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from 'react-i18next';
import type { CommandResult } from "../types";
import { Modal } from "./Modal";

interface LogsModalProps {
  containerId: string;
  onClose: () => void;
}

export function LogsModal({ containerId, onClose }: LogsModalProps) {
  const { t } = useTranslation();
  const [logs, setLogs] = useState("");
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [lines, setLines] = useState("200");
  const logsRef = useRef<HTMLPreElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchLogs = useCallback(async (linesOverride?: string) => {
    setLoadingLogs(true);
    try {
      const result = await invoke<CommandResult>("get_container_logs", {
        id: containerId,
        follow: false,
        lines: parseInt(linesOverride ?? lines) || null,
      });
      setLogs(result.stdout || result.stderr || "(no logs)");
    } catch (e) {
      setLogs(String(e));
    } finally {
      setLoadingLogs(false);
    }
  }, [containerId, lines]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerId]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []) // TODO: [auto-fix] empty deps — verify if intentional; add deps or suppress with eslint-disable;

  return (
    <Modal onClose={onClose}>
      <h2>{t('logs.title')}: {containerId.substring(0, 12)}</h2>
      <div className="form-group" style={{ marginBottom: 12 }}>
        <label>Lines</label>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input value={lines} onChange={(e) => {
            const val = e.target.value;
            setLines(val);
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => fetchLogs(val), 500);
          }} style={{ width: 80 }} placeholder="200" />
          <button className="btn btn-sm btn-secondary" onClick={() => fetchLogs()} disabled={loadingLogs}>
            {loadingLogs ? "Loading..." : t('logs.refresh')}
          </button>
        </div>
      </div>
      <div className="logs-content">
        <pre ref={logsRef}>{loadingLogs ? "Loading..." : logs}</pre>
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>{t('modal.close')}</button>
      </div>
    </Modal>
  );
}
