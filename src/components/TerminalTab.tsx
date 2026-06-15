import { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CommandResult } from "../types";

const DOCKER_COMMANDS = [
  "docker ps", "docker run", "docker stop", "docker start", "docker rm", "docker rmi",
  "docker images", "docker pull", "docker push", "docker build", "docker exec",
  "docker logs", "docker inspect", "docker cp", "docker export", "docker kill",
  "docker stats", "docker volume", "docker network", "docker system", "docker machine",
  "docker info", "docker version", "docker login", "docker logout", "docker tag",
  "docker rename", "docker top", "docker diff", "docker commit", "docker save", "docker load",
  "docker port", "docker update", "docker wait", "docker pause", "docker unpause",
  "docker rename", "docker container", "docker image", "docker manifest",
];

const CONTAINER_COMMANDS = [
  "container ls", "container run", "container stop", "container start", "container rm",
  "container image ls", "container image pull", "container image push", "container image rm",
  "container build", "container exec", "container logs", "container inspect",
  "container cp", "container export", "container kill", "container stats",
  "container volume ls", "container volume create", "container volume rm",
  "container network ls", "container network create", "container network rm",
  "container system status", "container system start", "container system stop",
  "container system df", "container --version", "container registry login", "container registry logout",
  "container machine ls", "container machine create", "container machine rm",
  "container prune",
];

interface TerminalTabProps {
  dockerMode?: boolean;
  onDockerModeChange?: (mode: boolean) => void;
}

export function TerminalTab({ dockerMode: externalDockerMode, onDockerModeChange }: TerminalTabProps) {
  const [history, setHistory] = useState<Array<{ cmd: string; output: string; success: boolean }>>([]);
  const [input, setInput] = useState("");
  const [executing, setExecuting] = useState(false);
  const [dockerMode, setDockerMode] = useState(() => {
    if (externalDockerMode !== undefined) return externalDockerMode;
    try {
      return localStorage.getItem("docker-mode") === "true";
    } catch {
      return false;
    }
  });
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [socketStatus, setSocketStatus] = useState<"checking" | "connected" | "disconnected">("checking");
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [history]);

  const checkSocketStatus = async () => {
    try {
      const result = await invoke<CommandResult>("run_raw_command", { command: "system status" });
      setSocketStatus(result.success && result.stdout.toLowerCase().includes("running") ? "connected" : "disconnected");
    } catch {
      setSocketStatus("disconnected");
    }
  };

  const suggestions = useMemo(() => {
    if (!input.trim()) return [];
    const commands = dockerMode ? DOCKER_COMMANDS : CONTAINER_COMMANDS;
    const lower = input.toLowerCase();
    return commands.filter(cmd => cmd.toLowerCase().startsWith(lower)).slice(0, 8);
  }, [input, dockerMode]);

  const handleExecute = async () => {
    const cmd = input.trim();
    if (!cmd || executing) return;
    setInput("");
    setShowSuggestions(false);
    setExecuting(true);
    try {
      const result = await invoke<CommandResult>("run_raw_command", { command: cmd });
      setHistory((prev) => [...prev, { cmd, output: result.stdout || result.stderr, success: result.success }]);
    } catch (e) {
      setHistory((prev) => [...prev, { cmd, output: String(e), success: false }]);
    } finally {
      setExecuting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Always prevent Tab from switching focus in terminal
    if (e.key === "Tab") {
      e.preventDefault();
      if (showSuggestions && suggestions.length > 0) {
        setInput(suggestions[selectedSuggestion]);
        setShowSuggestions(false);
      }
      return;
    }

    if (showSuggestions && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedSuggestion((prev) => (prev + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedSuggestion((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Escape") {
        setShowSuggestions(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleExecute();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
    setSelectedSuggestion(0);
    setShowSuggestions(e.target.value.trim().length > 0);
  };

  const quickCommands = dockerMode ? [
    { label: "ps", cmd: "docker ps" },
    { label: "images", cmd: "docker images" },
    { label: "version", cmd: "docker version" },
    { label: "info", cmd: "docker info" },
    { label: "run", cmd: "docker run -d --name " },
    { label: "exec", cmd: "docker exec -it " },
  ] : [
    { label: "ls", cmd: "container ls" },
    { label: "images", cmd: "container image ls" },
    { label: "version", cmd: "container --version" },
    { label: "status", cmd: "container system status" },
    { label: "run", cmd: "container run -d --name " },
    { label: "exec", cmd: "container exec -it " },
  ];

  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>Terminal</h2>
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

          {quickCommands.map((qc) => (
            <button
              key={qc.cmd}
              className="btn btn-secondary btn-sm"
              onClick={() => { setInput(qc.cmd); inputRef.current?.focus(); }}
              title={qc.cmd}
            >
              {qc.label}
            </button>
          ))}
          <button className="btn btn-secondary btn-sm" onClick={() => setHistory([])}>Clear</button>
        </div>
      </div>
      <div className="terminal-tab">
        <div className="terminal-container">
          <div className="terminal-output" ref={outputRef}>
            {history.length === 0 && (
              <>
                <div className="terminal-line" style={{ color: "var(--text-muted)" }}>
                  {dockerMode
                    ? "Docker-compatible mode. Type docker commands - they'll be translated to Apple Container."
                    : "Apple Container CLI Terminal. Type commands below."}
                </div>
                <div className="terminal-line terminal-help" style={{ color: "var(--text-muted)", fontSize: "0.85em", marginTop: 8, lineHeight: 1.6 }}>
                  {dockerMode
                    ? "  docker ps       → container ls\n  docker run      → container run\n  docker images   → container image ls\n  docker exec     → container exec\n  docker logs     → container logs\n  docker inspect  → container inspect\n  docker volume   → container volume\n  docker network  → container network\n\n  Type 'docker' followed by any subcommand. Tab for suggestions."
                    : "  container ls           - List containers\n  container run -d nginx  - Run container\n  container image ls      - List images\n  container exec -it ID   - Exec into container\n  container logs ID       - View logs\n  container inspect ID    - Inspect container\n  container stop ID       - Stop container\n  container --version     - Show version\n\n  Tab for suggestions. Use ↑↓ to navigate."}
                </div>
              </>
            )}
            {history.map((entry, i) => (
              <div key={i}>
                <div className="terminal-line terminal-command">$ {entry.cmd}</div>
                <div className={`terminal-line ${entry.success ? "terminal-result" : "terminal-error"}`}>
                  {entry.output || "(no output)"}
                </div>
              </div>
            ))}
            {executing && <div className="terminal-line terminal-result">Executing...</div>}
          </div>

          {/* Autocomplete Suggestions */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="terminal-suggestions">
              {suggestions.map((suggestion, i) => (
                <div
                  key={suggestion}
                  className={`terminal-suggestion ${i === selectedSuggestion ? "terminal-suggestion-active" : ""}`}
                  onClick={() => {
                    setInput(suggestion);
                    setShowSuggestions(false);
                    inputRef.current?.focus();
                  }}
                >
                  {suggestion}
                </div>
              ))}
            </div>
          )}

          <form className="terminal-input-form" onSubmit={(e) => { e.preventDefault(); handleExecute(); }}>
            <span className="terminal-prompt">$</span>
            <input
              ref={inputRef}
              className="terminal-input"
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onFocus={() => { if (input.trim()) setShowSuggestions(true); }}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              placeholder={dockerMode ? "docker command..." : "container ls, container run..."}
              disabled={executing}
              autoFocus
            />
          </form>
        </div>
      </div>
    </div>
  );
}
