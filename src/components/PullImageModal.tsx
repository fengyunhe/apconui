import { useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { Modal } from "./Modal";

interface PullImageModalProps {
  onClose: () => void;
  onPull: (reference: string) => Promise<void>;
}

export function PullImageModal({ onClose, onPull }: PullImageModalProps) {
  const [reference, setReference] = useState("");
  const [pulling, setPulling] = useState(false);

  const handlePull = async () => {
    setPulling(true);
    emit("pull-start", reference);
    onClose();
    await onPull(reference);
  };

  return (
    <Modal onClose={onClose}>
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
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose} disabled={pulling}>Cancel</button>
        <button className="btn btn-primary" onClick={handlePull} disabled={!reference || pulling}>
          {pulling ? "Pulling..." : "Pull"}
        </button>
      </div>
    </Modal>
  );
}
