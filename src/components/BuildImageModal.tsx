import { useState } from "react";
import { Modal } from "./Modal";

interface BuildImageModalProps {
  onClose: () => void;
  onBuild: (config: Record<string, unknown>) => void;
}

export function BuildImageModal({ onClose, onBuild }: BuildImageModalProps) {
  const [context, setContext] = useState(".");
  const [tag, setTag] = useState("");
  const [dockerfile, setDockerfile] = useState("");
  const [noCache, setNoCache] = useState(false);
  const [buildArgs, setBuildArgs] = useState("");

  return (
    <Modal onClose={onClose}>
      <h2>Build Image</h2>
      <div className="form-grid">
        <div className="form-group">
          <label>Context Directory</label>
          <input value={context} onChange={(e) => setContext(e.target.value)} placeholder="." />
        </div>
        <div className="form-group">
          <label>Tag</label>
          <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="my-app:latest" />
        </div>
        <div className="form-group">
          <label>Dockerfile Path</label>
          <input value={dockerfile} onChange={(e) => setDockerfile(e.target.value)} placeholder="Dockerfile" />
        </div>
        <div className="form-group">
          <label>Build Args (comma sep)</label>
          <input value={buildArgs} onChange={(e) => setBuildArgs(e.target.value)} placeholder="NODE_VERSION=18,NPM_TOKEN=xxx" />
        </div>
        <div className="form-group form-checkboxes">
          <label><input type="checkbox" checked={noCache} onChange={(e) => setNoCache(e.target.checked)} /> No cache</label>
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onBuild({
          context, tag, dockerfile: dockerfile || null, noCache, buildArgs: buildArgs || null
        })} disabled={!tag}>Build</button>
      </div>
    </Modal>
  );
}
