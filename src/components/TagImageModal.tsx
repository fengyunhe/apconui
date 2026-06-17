import { useState } from "react";
import { useTranslation } from 'react-i18next';
import { Modal } from "./Modal";

interface TagImageModalProps {
  source: string;
  onClose: () => void;
  onTag: (source: string, target: string) => void;
}

export function TagImageModal({ source, onClose, onTag }: TagImageModalProps) {
  const { t } = useTranslation();
  const [target, setTarget] = useState("");
  return (
    <Modal onClose={onClose}>
      <h2>{t('tagImage.title')}</h2>
      <div className="form-grid">
        <div className="form-group" style={{ gridColumn: "1 / -1" }}>
          <label>{t('tagImage.source')}</label>
          <input value={source} readOnly style={{ opacity: 0.7 }} />
        </div>
        <div className="form-group" style={{ gridColumn: "1 / -1" }}>
          <label>{t('tagImage.target')}</label>
          <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="myregistry.io/myimage:v1.0" autoFocus />
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>{t('modal.cancel')}</button>
        <button className="btn btn-primary" onClick={() => onTag(source, target)} disabled={!target}>{t('tagImage.tag')}</button>
      </div>
    </Modal>
  );
}
