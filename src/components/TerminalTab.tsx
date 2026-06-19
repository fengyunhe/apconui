import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from 'react-i18next';
import type { CommandResult } from "../types";

export function TerminalTab() {
  const { t } = useTranslation();
  const [opening, setOpening] = useState(false);

  const handleOpenTerminal = async () => {
    setOpening(true);
    try {
      const result = await invoke<CommandResult>("open_terminal");
      if (!result.success) {
        console.error("Failed to open terminal:", result.stderr);
      }
    } catch (e) {
      console.error("Error opening terminal:", e);
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>{t('terminal.title')}</h2>
      </div>
      <div className="terminal-tab" style={{ 
        height: "calc(100vh - 140px)", 
        display: "flex", 
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "24px"
      }}>
        <div style={{ textAlign: "center" }}>
          <svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--text-muted)", marginBottom: 16 }}>
            <rect x="2" y="3" width="20" height="18" rx="2" />
            <polyline points="7 8 11 12 7 16" />
            <line x1="13" y1="16" x2="17" y2="16" />
          </svg>
          <h3 style={{ color: "var(--text-primary)", marginBottom: 8 }}>System Terminal</h3>
          <p style={{ color: "var(--text-muted)", marginBottom: 24 }}>
            Opens Terminal.app with Docker Context set to Socktainer
          </p>
          <button 
            className="btn btn-primary"
            onClick={handleOpenTerminal}
            disabled={opening}
            style={{ padding: "12px 32px", fontSize: "16px" }}
          >
            {opening ? "Opening..." : "Open Terminal"}
          </button>
        </div>
      </div>
    </div>
  );
}
