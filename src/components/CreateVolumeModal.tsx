import { useState } from "react";
import { useTranslation } from 'react-i18next';
import { Modal } from "./Modal";

interface CreateVolumeModalProps {
  onClose: () => void;
  onCreate: (name: string, size: string) => void;
}

export function CreateVolumeModal({ onClose, onCreate }: CreateVolumeModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [size, setSize] = useState("");
  return (
    <Modal onClose={onClose}>
      <h2>{t('createVolume.title')}</h2>
      <div className="form-grid">
        <div className="form-group">
          <label>{t('createVolume.name')} *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-volume" autoFocus />
        </div>
        <div className="form-group">
          <label>{t('createVolume.size')}</label>
          <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="10G" />
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>{t('modal.cancel')}</button>
        <button className="btn btn-primary" onClick={() => onCreate(name, size)} disabled={!name}>{t('createVolume.create')}</button>
      </div>
    </Modal>
  );
}
