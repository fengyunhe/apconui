import { Modal } from "./Modal";

export function InspectModal({ title, data, onClose }: {
  title: string;
  data: string;
  onClose: () => void;
}) {
  const handleCopy = () => {
    navigator.clipboard.writeText(data);
  };
  return (
    <Modal onClose={onClose}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <button className="btn btn-sm btn-secondary" onClick={handleCopy}>Copy</button>
      </div>
      <div className="inspect-content">
        <pre>{data}</pre>
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
