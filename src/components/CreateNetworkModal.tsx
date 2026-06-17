import { useState } from "react";
import { useTranslation } from 'react-i18next';
import { Modal } from "./Modal";

interface CreateNetworkModalProps {
  onClose: () => void;
  onCreate: (name: string, subnet: string) => void;
}

export function CreateNetworkModal({ onClose, onCreate }: CreateNetworkModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [subnet, setSubnet] = useState("");
  return (
    <Modal onClose={onClose}>
      <h2>{t('createNetwork.title')}</h2>
      <div className="form-grid">
        <div className="form-group">
          <label>{t('createNetwork.name')} *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-network" autoFocus />
        </div>
        <div className="form-group">
          <label>{t('createNetwork.subnet')}</label>
          <input value={subnet} onChange={(e) => setSubnet(e.target.value)} placeholder="192.168.100.0/24" />
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>{t('modal.cancel')}</button>
        <button className="btn btn-primary" onClick={() => onCreate(name, subnet)} disabled={!name}>{t('createNetwork.create')}</button>
      </div>
    </Modal>
  );
}
