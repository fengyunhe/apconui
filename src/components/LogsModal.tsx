import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CommandResult } from "../types";
import { Modal } from "./Modal";

interface LogsModalProps {
  containerId: string;
  onClose: () => void;
}

export function LogsModal({ containerId, onClose }: LogsModalProps) {
  const [logs, setLogs] = useState("");
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [lines, setLines] = useState("200");
  const logsRef = useRef<HTMLPreElement>(null);

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const result = await invoke<CommandResult>("get_container_logs", {
        id: containerId,
        follow: false,
        lines: parseInt(lines) || null,
      });
      setLogs(result.stdout || result.stderr || "(no logs)");
    } catch (e) {
      setLogs(String(e));
    } finally {
      setLoadingLogs(false);
    }
  }, [containerId, lines]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return (
    <Modal onClose={onClose}>
      <h2>Container Logs: {containerId.substring(0, 12)}</h2>
      <div className="form-group" style={{ marginBottom: 12 }}>
        <label>Lines</label>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input value={lines} onChange={(e) => setLines(e.target.value)} style={{ width: 80 }} placeholder="200" />
          <button className="btn btn-sm btn-secondary" onClick={fetchLogs} disabled={loadingLogs}>
            {loadingLogs ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>
      <div className="logs-content">
        <pre ref={logsRef}>{loadingLogs ? "Loading..." : logs}</pre>
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
