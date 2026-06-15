import { useState } from "react";
import { Modal } from "./Modal";

interface PushImageModalProps {
  reference: string;
  onClose: () => void;
  onPush: (reference: string) => void;
}

export function PushImageModal({ reference, onClose, onPush }: PushImageModalProps) {
  const [ref, setRef] = useState(reference);
  return (
    <Modal onClose={onClose}>
      <h2>Push Image</h2>
      <div className="form-grid">
        <div className="form-group" style={{ gridColumn: "1 / -1" }}>
          <label>Image Reference</label>
          <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="myregistry.io/myimage:tag" autoFocus />
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onPush(ref)} disabled={!ref}>Push</button>
      </div>
    </Modal>
  );
}
