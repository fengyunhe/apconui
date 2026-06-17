import { useState } from "react";
import { useTranslation } from 'react-i18next';
import type { Image } from "../types";
import { Modal } from "./Modal";

interface CreateMachineModalProps {
  images: Image[];
  onClose: () => void;
  onCreate: (image: string, name: string, cpus: string, memory: string, homeMount: string, setDefault: boolean) => void;
}

export function CreateMachineModal({ images, onClose, onCreate }: CreateMachineModalProps) {
  const { t } = useTranslation();
  const [image, setImage] = useState(images[0] ? `${images[0].name}:${images[0].tag}` : "");
  const [name, setName] = useState("");
  const [cpus, setCpus] = useState("");
  const [memory, setMemory] = useState("");
  const [homeMount, setHomeMount] = useState("rw");
  const [setDefault, setSetDefault] = useState(false);
  return (
    <Modal onClose={onClose}>
      <h2>{t('createMachine.title')}</h2>
      <div className="form-grid">
        <div className="form-group">
          <label>{t('createMachine.image')} *</label>
          <select value={image} onChange={(e) => setImage(e.target.value)}>
            {images.map((img) => (
              <option key={`${img.name}:${img.tag}`} value={`${img.name}:${img.tag}`}>
                {img.name}:{img.tag}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>{t('createMachine.name')}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-machine" />
        </div>
        <div className="form-group">
          <label>{t('createMachine.cpus')}</label>
          <input value={cpus} onChange={(e) => setCpus(e.target.value)} placeholder="2" />
        </div>
        <div className="form-group">
          <label>{t('createMachine.memory')}</label>
          <input value={memory} onChange={(e) => setMemory(e.target.value)} placeholder="4G" />
        </div>
        <div className="form-group">
          <label>{t('createMachine.homeMount')}</label>
          <select value={homeMount} onChange={(e) => setHomeMount(e.target.value)}>
            <option value="rw">Read/Write</option>
            <option value="ro">Read Only</option>
            <option value="none">None</option>
          </select>
        </div>
        <div className="form-group form-checkboxes">
          <label><input type="checkbox" checked={setDefault} onChange={(e) => setSetDefault(e.target.checked)} /> {t('createMachine.setDefault')}</label>
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>{t('modal.cancel')}</button>
        <button className="btn btn-primary" onClick={() => onCreate(image, name, cpus, memory, homeMount, setDefault)} disabled={!image}>{t('createMachine.create')}</button>
      </div>
    </Modal>
  );
}
