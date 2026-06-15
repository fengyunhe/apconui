import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { Modal } from "./Modal";

interface PullImageModalProps {
  onClose: () => void;
  onPull: (reference: string) => Promise<void>;
}

export function PullImageModal({ onClose, onPull }: PullImageModalProps) {
  const [reference, setReference] = useState("");
  const [progress, setProgress] = useState("");
  const [pulling, setPulling] = useState(false);

  useEffect(() => {
    const unlistenProgress = listen<string>("pull-progress", (event) => {
      setProgress(event.payload);
    });
    const unlistenComplete = listen<boolean>("pull-complete", () => {
      setPulling(false);
      setProgress("");
    });
    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
    };
  }, []);

  const handlePull = async () => {
    setPulling(true);
    setProgress("Starting pull...");
    await onPull(reference);
  };

  return (
    <Modal onClose={() => { if (!pulling) onClose(); }}>
      <h2>Pull Image</h2>
      <div className="form-grid">
        <div className="form-group" style={{ gridColumn: "1 / -1" }}>
          <label>Image Reference</label>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="docker.io/library/nginx:latest"
            autoFocus
            disabled={pulling}
          />
        </div>
      </div>
      {pulling && (
        <div className="pull-progress">
          <div className="progress-bar">
            <div className="progress-bar-indeterminate"></div>
          </div>
          <p className="progress-text">{progress || "Pulling..."}</p>
        </div>
      )}
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose} disabled={pulling}>Cancel</button>
        <button className="btn btn-primary" onClick={handlePull} disabled={!reference || pulling}>
          {pulling ? "Pulling..." : "Pull"}
        </button>
      </div>
    </Modal>
  );
}
