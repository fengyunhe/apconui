import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from 'react-i18next';
import type { CommandResult, Image, Network } from "../types";
import { Modal } from "./Modal";

interface RunContainerModalProps {
  images: Image[];
  networks: Network[];
  initialImage?: string;
  onClose: () => void;
  onRun: (config: Record<string, unknown>) => void;
}

export function RunContainerModal({ images, networks, initialImage, onClose, onRun }: RunContainerModalProps) {
  const { t } = useTranslation();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [image, setImage] = useState(initialImage || (images[0] ? `${images[0].name}:${images[0].tag}` : ""));
  const [name, setName] = useState("");
  const [detach, setDetach] = useState(true);
  const [rm, setRm] = useState(false);
  const [cpus, setCpus] = useState("");
  const [memory, setMemory] = useState("");
  const [ports, setPorts] = useState("");
  const [envs, setEnvs] = useState("");
  const [volumes, setVolumes] = useState("");
  const [network, setNetwork] = useState("");
  const [entrypoint, setEntrypoint] = useState("");
  const [workdir, setWorkdir] = useState("");
  const [arch, setArch] = useState("");
  const [capAdd, setCapAdd] = useState("");
  const [capDrop, setCapDrop] = useState("");
  const [dns, setDns] = useState("");
  const [dnsDomain, setDnsDomain] = useState("");
  const [init, setInit] = useState(false);
  const [label, setLabel] = useState("");
  const [mount, setMount] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [rosetta, setRosetta] = useState(false);
  const [runtime, setRuntime] = useState("");
  const [ssh, setSsh] = useState(false);
  const [shmSize, setShmSize] = useState("");
  const [user, setUser] = useState("");
  const [imageDropdownOpen, setImageDropdownOpen] = useState(false);

  const handleImageChange = async (value: string) => {
    setImage(value);
    const matchedImage = images.find(img => `${img.name}:${img.tag}` === value);
    if (matchedImage) {
      try {
        const result = await invoke<CommandResult>("inspect_image", { name: value });
        if (result.success && result.stdout.trim()) {
          const imgData = JSON.parse(result.stdout);
          const imgObj = Array.isArray(imgData) ? imgData[0] : imgData;
          const configObj = imgObj?.configuration?.config?.config || {};
          const imgEnvs = configObj.Env || [];
          if (imgEnvs.length > 0) {
            setEnvs(imgEnvs.join(","));
          }
        }
      } catch {
        // ignore
      }
    }
  };

  return (
    <Modal onClose={onClose}>
      <h2>{t('runContainer.title')}</h2>
      <div className="form-grid">
        <div className="form-group">
          <label>{t('runContainer.image')} *</label>
          <div style={{ position: "relative" }}>
            <input
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder="docker.io/library/nginx:latest"
              onFocus={() => setImageDropdownOpen(true)}
              onBlur={() => setTimeout(() => setImageDropdownOpen(false), 200)}
            />
            {imageDropdownOpen && images.length > 0 && (
              <div className="image-dropdown">
                {images.map((img) => (
                  <div
                    key={`${img.name}:${img.tag}`}
                    className="image-dropdown-item"
                    onMouseDown={() => handleImageChange(`${img.name}:${img.tag}`)}
                  >
                    {img.name}:{img.tag}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="form-group">
          <label>{t('runContainer.name')}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-container" />
        </div>
        <div className="form-group">
          <label>CPUs</label>
          <input value={cpus} onChange={(e) => setCpus(e.target.value)} placeholder="2" />
        </div>
        <div className="form-group">
          <label>Memory</label>
          <input value={memory} onChange={(e) => setMemory(e.target.value)} placeholder="512M" />
        </div>
        <div className="form-group">
          <label>{t('runContainer.ports')}</label>
          <input value={ports} onChange={(e) => setPorts(e.target.value)} placeholder="8080:80,3000:3000" />
        </div>
        <div className="form-group">
          <label>{t('runContainer.volumes')}</label>
          <input value={volumes} onChange={(e) => setVolumes(e.target.value)} placeholder="/host:/container" />
        </div>
        <div className="form-group" style={{ gridColumn: "1 / -1" }}>
          <label>{t('runContainer.env')}</label>
          <textarea
            value={envs}
            onChange={(e) => setEnvs(e.target.value)}
            placeholder="KEY=val,FOO=bar"
            rows={3}
            style={{ resize: "none", fontFamily: "monospace" }}
          />
        </div>
        <div className="form-group">
          <label>{t('runContainer.network')}</label>
          <select value={network} onChange={(e) => setNetwork(e.target.value)}>
            <option value="">Default</option>
            {networks.map((n) => (
              <option key={n.name} value={n.name}>{n.name}</option>
            ))}
          </select>
        </div>
        <div className="form-group form-checkboxes">
          <label><input type="checkbox" checked={detach} onChange={(e) => setDetach(e.target.checked)} /> Detach</label>
          <label><input type="checkbox" checked={rm} onChange={(e) => setRm(e.target.checked)} /> Auto-remove</label>
        </div>
      </div>

      <button className="btn btn-secondary btn-sm" style={{ margin: "12px 0" }} onClick={() => setShowAdvanced(!showAdvanced)}>
        {showAdvanced ? "Hide Advanced" : "Show Advanced Options"}
      </button>

      {showAdvanced && (
        <div className="form-grid" style={{ borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
          <div className="form-group">
            <label>Entrypoint</label>
            <input value={entrypoint} onChange={(e) => setEntrypoint(e.target.value)} placeholder="/bin/sh" />
          </div>
          <div className="form-group">
            <label>Working Dir</label>
            <input value={workdir} onChange={(e) => setWorkdir(e.target.value)} placeholder="/app" />
          </div>
          <div className="form-group">
            <label>Architecture</label>
            <select value={arch} onChange={(e) => setArch(e.target.value)}>
              <option value="">Default (arm64)</option>
              <option value="arm64">arm64</option>
              <option value="amd64">amd64</option>
            </select>
          </div>
          <div className="form-group">
            <label>User</label>
            <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="root or 1000:1000" />
          </div>
          <div className="form-group">
            <label>Cap Add</label>
            <input value={capAdd} onChange={(e) => setCapAdd(e.target.value)} placeholder="CAP_NET_RAW" />
          </div>
          <div className="form-group">
            <label>Cap Drop</label>
            <input value={capDrop} onChange={(e) => setCapDrop(e.target.value)} placeholder="CAP_NET_RAW" />
          </div>
          <div className="form-group">
            <label>DNS</label>
            <input value={dns} onChange={(e) => setDns(e.target.value)} placeholder="8.8.8.8" />
          </div>
          <div className="form-group">
            <label>DNS Domain</label>
            <input value={dnsDomain} onChange={(e) => setDnsDomain(e.target.value)} placeholder="example.com" />
          </div>
          <div className="form-group">
            <label>Label (key=value)</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="app=web" />
          </div>
          <div className="form-group">
            <label>Mount</label>
            <input value={mount} onChange={(e) => setMount(e.target.value)} placeholder="type=bind,source=/data,target=/app" />
          </div>
          <div className="form-group">
            <label>Runtime</label>
            <input value={runtime} onChange={(e) => setRuntime(e.target.value)} placeholder="container-runtime-linux" />
          </div>
          <div className="form-group">
            <label>SHM Size</label>
            <input value={shmSize} onChange={(e) => setShmSize(e.target.value)} placeholder="64M" />
          </div>
          <div className="form-group form-checkboxes">
            <label><input type="checkbox" checked={init} onChange={(e) => setInit(e.target.checked)} /> Init process</label>
            <label><input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /> Read-only</label>
            <label><input type="checkbox" checked={rosetta} onChange={(e) => setRosetta(e.target.checked)} /> Rosetta</label>
            <label><input type="checkbox" checked={ssh} onChange={(e) => setSsh(e.target.checked)} /> SSH agent</label>
          </div>
        </div>
      )}

      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>{t('modal.cancel')}</button>
        <button className="btn btn-primary" onClick={() => onRun({
          image, name: name || null, detach, rm, cpus: cpus || null, memory: memory || null,
          ports: ports || null, envs: envs || null, volumes: volumes || null, network: network || null,
          entrypoint: entrypoint || null, workingDir: workdir || null,
          arch: arch || null, capAdd: capAdd || null, capDrop: capDrop || null,
          dns: dns || null, dnsDomain: dnsDomain || null, dnsOption: null, dnsSearch: null,
          init, label: label || null, mount: mount || null, noDns: false,
          os: null, platform: null, readOnly, rosetta, runtime: runtime || null,
          ssh, shmSize: shmSize || null, tmpfs: null, ulimit: null, user: user || null,
          maxConcurrentDownloads: null, progress: null,
        })} disabled={!image}>{t('runContainer.run')}</button>
      </div>
    </Modal>
  );
}
