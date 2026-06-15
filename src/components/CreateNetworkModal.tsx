import { useState } from "react";
import { Modal } from "./Modal";

interface CreateNetworkModalProps {
  onClose: () => void;
  onCreate: (name: string, subnet: string) => void;
}

export function CreateNetworkModal({ onClose, onCreate }: CreateNetworkModalProps) {
  const [name, setName] = useState("");
  const [subnet, setSubnet] = useState("");
  return (
    <Modal onClose={onClose}>
      <h2>Create Network</h2>
      <div className="form-grid">
        <div className="form-group">
          <label>Name *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-network" autoFocus />
        </div>
        <div className="form-group">
          <label>Subnet (CIDR, optional)</label>
          <input value={subnet} onChange={(e) => setSubnet(e.target.value)} placeholder="192.168.100.0/24" />
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onCreate(name, subnet)} disabled={!name}>Create</button>
      </div>
    </Modal>
  );
}
