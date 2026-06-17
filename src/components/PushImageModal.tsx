import { useState } from "react";
import { useTranslation } from 'react-i18next';
import { Modal } from "./Modal";

interface PushImageModalProps {
  reference: string;
  onClose: () => void;
  onPush: (reference: string) => void;
}

export function PushImageModal({ reference, onClose, onPush }: PushImageModalProps) {
  const { t } = useTranslation();
  const [ref, setRef] = useState(reference);
  return (
    <Modal onClose={onClose}>
      <h2>{t('pushImage.title')}</h2>
      <div className="form-grid">
        <div className="form-group" style={{ gridColumn: "1 / -1" }}>
          <label>{t('pushImage.reference')}</label>
          <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="myregistry.io/myimage:tag" autoFocus />
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>{t('modal.cancel')}</button>
        <button className="btn btn-primary" onClick={() => onPush(ref)} disabled={!ref}>{t('pushImage.push')}</button>
      </div>
    </Modal>
  );
}
