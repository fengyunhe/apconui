import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CommandResult } from "../types";

export function TerminalTab() {
  const [history, setHistory] = useState<Array<{ cmd: string; output: string; success: boolean }>>([]);
  const [input, setInput] = useState("");
  const [executing, setExecuting] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [history]);

  const handleExecute = async () => {
    const cmd = input.trim();
    if (!cmd || executing) return;
    setInput("");
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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleExecute();
    }
  };

  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>Terminal</h2>
        <div className="tab-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => setHistory([])}>Clear</button>
        </div>
      </div>
      <div className="terminal-tab">
        <div className="terminal-container">
          <div className="terminal-output" ref={outputRef}>
            {history.length === 0 && (
              <div className="terminal-line" style={{ color: "var(--text-muted)" }}>
                Apple Container CLI Terminal. Type commands below. Example: container ls
              </div>
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
          <form className="terminal-input-form" onSubmit={(e) => { e.preventDefault(); handleExecute(); }}>
            <span className="terminal-prompt">$</span>
            <input
              className="terminal-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="container command..."
              disabled={executing}
              autoFocus
            />
          </form>
        </div>
      </div>
    </div>
  );
}
