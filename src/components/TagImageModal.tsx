import { useState } from "react";
import { Modal } from "./Modal";

interface TagImageModalProps {
  source: string;
  onClose: () => void;
  onTag: (source: string, target: string) => void;
}

export function TagImageModal({ source, onClose, onTag }: TagImageModalProps) {
  const [target, setTarget] = useState("");
  return (
    <Modal onClose={onClose}>
      <h2>Tag Image</h2>
      <div className="form-grid">
        <div className="form-group" style={{ gridColumn: "1 / -1" }}>
          <label>Source Image</label>
          <input value={source} readOnly style={{ opacity: 0.7 }} />
        </div>
        <div className="form-group" style={{ gridColumn: "1 / -1" }}>
          <label>Target Reference</label>
          <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="myregistry.io/myimage:v1.0" autoFocus />
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onTag(source, target)} disabled={!target}>Tag</button>
      </div>
    </Modal>
  );
}
