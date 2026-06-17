import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from 'react-i18next';
import type { CommandResult } from "../types";
import { XTerminal } from "./XTerminal";

interface TerminalTabProps {
  dockerMode?: boolean;
  onDockerModeChange?: (mode: boolean) => void;
}

export function TerminalTab({ dockerMode: externalDockerMode, onDockerModeChange }: TerminalTabProps) {
  const { t } = useTranslation();
  const [dockerMode, setDockerMode] = useState(() => {
    if (externalDockerMode !== undefined) return externalDockerMode;
    try {
      return localStorage.getItem("docker-mode") === "true";
    } catch {
      return false;
    }
  });
  const [socketStatus, setSocketStatus] = useState<"checking" | "connected" | "disconnected">("checking");
  const [output, setOutput] = useState<string>("");
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    localStorage.setItem("docker-mode", String(dockerMode));
    if (onDockerModeChange) onDockerModeChange(dockerMode);
  }, [dockerMode, onDockerModeChange]);

  useEffect(() => {
    checkSocketStatus();
    const interval = setInterval(checkSocketStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
      }
    };
  }, []);

  const checkSocketStatus = async () => {
    try {
      const result = await invoke<CommandResult>("run_raw_command", { command: "system status" });
      setSocketStatus(result.success && result.stdout.toLowerCase().includes("running") ? "connected" : "disconnected");
    } catch {
      setSocketStatus("disconnected");
    }
  };

  const translateDockerCommand = useCallback((cmd: string): string => {
    if (!dockerMode || !cmd.startsWith("docker ")) return cmd;
    let rest = cmd.slice(7);
    const subCommands: Record<string, string> = {
      "ps": "ls",
      "images": "image ls",
      "pull": "image pull",
      "push": "image push",
      "rmi": "image rm",
      "volume": "volume",
      "network": "network",
      "system": "system",
      "machine": "machine",
      "info": "system df",
      "version": "--version",
    };
    const parts = rest.split(/\s+/);
    const sub = parts[0];
    if (subCommands[sub]) {
      return `container ${subCommands[sub]}${parts.length > 1 ? " " + parts.slice(1).join(" ") : ""}`;
    }
    return `container ${rest}`;
  }, [dockerMode]);

  const isStreamCommand = useCallback((cmd: string): boolean => {
    const lower = cmd.toLowerCase();
    return (lower.includes("logs") && (lower.includes("-f") || lower.includes("--follow"))) ||
           (lower.includes("stats") && !lower.includes("--no-stream"));
  }, []);

  const handleCommand = useCallback(async (cmd: string) => {
    const translatedCmd = translateDockerCommand(cmd);
    setIsRunning(true);
    setOutput("");

    if (isStreamCommand(cmd)) {
      const eventId = `stream-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const unlistenOutput = await listen<{line: string; stream: string}>(`stream-output-${eventId}`, (event) => {
        setOutput((prev) => prev + event.payload.line + "\n");
      });

      const unlistenComplete = await listen<{success: boolean; error?: string}>(`stream-complete-${eventId}`, () => {
        setIsRunning(false);
        unlistenOutput();
        unlistenComplete();
      });

      unlistenRef.current = () => {
        unlistenOutput();
        unlistenComplete();
      };

      try {
        await invoke("run_container_cmd_stream", { request: { command: translatedCmd, event_id: eventId } });
      } catch (e) {
        setOutput(String(e));
        setIsRunning(false);
        if (unlistenRef.current) {
          unlistenRef.current();
          unlistenRef.current = null;
        }
      }
    } else {
      try {
        const result = await invoke<CommandResult>("run_raw_command", { command: translatedCmd });
        setOutput(result.stdout || result.stderr);
      } catch (e) {
        setOutput(String(e));
      } finally {
        setIsRunning(false);
      }
    }
  }, [translateDockerCommand, isStreamCommand]);

  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>{t('terminal.title')}</h2>
        <div className="tab-actions">
          {/* Socket Status Indicator */}
          <div className="socket-status" title={`Docker Socket: ${socketStatus}`}>
            <span className={`socket-dot socket-dot-${socketStatus}`}></span>
            <span className="socket-label">
              {socketStatus === "connected" ? "Socket OK" : socketStatus === "checking" ? "Checking..." : "Socket N/A"}
            </span>
          </div>

          {/* Docker Mode Toggle */}
          <button
            className={`btn btn-sm ${dockerMode ? "btn-docker" : "btn-container"}`}
            onClick={() => setDockerMode(!dockerMode)}
            title={dockerMode ? "Docker mode: docker commands auto-translate to container" : "Container mode: use container CLI directly"}
          >
            {dockerMode ? (
              <>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4 }}>
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
                Docker
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4 }}>
                  <rect x="2" y="2" width="20" height="20" rx="3" />
                  <path d="M8 12h8M12 8v8" />
                </svg>
                Container
              </>
            )}
          </button>
        </div>
      </div>
      <div className="terminal-tab" style={{ height: "calc(100vh - 140px)" }}>
        <XTerminal
          onCommand={handleCommand}
          output={output}
          isRunning={isRunning}
        />
      </div>
    </div>
  );
}
