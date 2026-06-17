import { formatBytes } from "../utils";
import { DetailSection } from "./DetailSection";
import { DetailRow } from "./DetailRow";
import type { Container } from "../types";

interface ImageDetailProps {
  data: Record<string, unknown> | null;
  loading: boolean;
  containers?: Container[];
  onBack: () => void;
  onTag: (name: string) => void;
  onPush: (name: string) => void;
  onContainerClick?: (id: string) => void;
}

export function ImageDetail({ data, loading, containers, onBack, onTag, onPush, onContainerClick }: ImageDetailProps) {
  const id = (data?.id || "") as string;
  const imgData = (data?.configuration || {}) as Record<string, unknown>;
  const name = (imgData.name || "") as string;
  const creationDate = (imgData.creationDate || "") as string;
  const desc = (imgData.descriptor || {}) as Record<string, unknown>;
  const size = (desc.size || 0) as number;
  const mediatype = (desc.mediaType || "") as string;
  const history = (imgData.history || []) as Array<Record<string, unknown>>;
  const rootfs = (imgData.rootfs || {}) as Record<string, unknown>;
  const diffIDs = (rootfs.diff_ids || []) as string[];
  const variants = (data?.variants || []) as Array<Record<string, unknown>>;

  const configObj = (imgData.config || {}) as Record<string, unknown>;
  const imageConfig = (configObj.config || {}) as Record<string, unknown>;
  const entrypoint = (imageConfig.Entrypoint || []) as string[];
  const cmd = (imageConfig.Cmd || []) as string[];
  const env = (imageConfig.Env || []) as string[];
  const workingDir = (imageConfig.WorkingDir || "") as string;
  const user = (imageConfig.User || "") as string;
  const exposedPorts = (imageConfig.ExposedPorts || {}) as Record<string, unknown>;
  const labels = (imageConfig.Labels || {}) as Record<string, string>;

  // Find containers using this image
  const usedByContainers = (containers || []).filter(c => c.image === name);

  if (loading) {
    return (
      <div className="detail-page">
        <div className="detail-header">
          <button className="btn btn-secondary" onClick={onBack}>Back</button>
          <h2>Loading...</h2>
        </div>
        <div className="detail-loading">Loading image details...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="detail-page">
        <div className="detail-header">
          <button className="btn btn-secondary" onClick={onBack}>Back</button>
          <h2>Image Details</h2>
        </div>
        <div className="detail-loading">No data available</div>
      </div>
    );
  }

  return (
    <div className="detail-page">
      <div className="detail-header">
        <button className="btn btn-secondary" onClick={onBack}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          Back
        </button>
        <div className="detail-title-area">
          <h2>Image</h2>
          <span className="tag-badge">{name}</span>
        </div>
        <div className="detail-actions">
          <button className="btn btn-info btn-sm" onClick={() => onTag(name)}>Tag</button>
          <button className="btn btn-success btn-sm" onClick={() => onPush(name)}>Push</button>
        </div>
      </div>

      <div className="detail-body">
        <DetailSection title="General">
          <DetailRow label="ID" value={<span className="cell-digest">{id}</span>} />
          <DetailRow label="Name" value={name || "-"} />
          <DetailRow label="Created" value={creationDate ? new Date(creationDate).toLocaleString() : "-"} />
          <DetailRow label="Size" value={size ? formatBytes(size) : "-"} />
          <DetailRow label="Media Type" value={mediatype || "-"} />
        </DetailSection>

        <DetailSection title="Configuration">
          <DetailRow label="Entrypoint" value={entrypoint.length > 0 ? <code>{entrypoint.join(" ")}</code> : "-"} />
          <DetailRow label="Cmd" value={cmd.length > 0 ? <code>{cmd.join(" ")}</code> : "-"} />
          <DetailRow label="Working Dir" value={workingDir || "-"} />
          <DetailRow label="User" value={user || "-"} />
          {Object.keys(exposedPorts).length > 0 && (
            <DetailRow label="Exposed Ports" value={Object.keys(exposedPorts).join(", ")} />
          )}
        </DetailSection>

        {env.length > 0 && (
          <DetailSection title="Environment">
            <div className="detail-env-list">
              {env.map((e, i) => (
                <code key={i} className="detail-env-item">{e}</code>
              ))}
            </div>
          </DetailSection>
        )}

        {Object.keys(labels).length > 0 && (
          <DetailSection title="Labels">
            {Object.entries(labels).map(([k, v]) => (
              <DetailRow key={k} label={k} value={v} />
            ))}
          </DetailSection>
        )}

        {variants.length > 0 && (
          <DetailSection title={`Variants (${variants.length})`}>
            <div className="detail-layers">
              {variants.map((v, i) => {
                const platform = (v.platform || {}) as Record<string, unknown>;
                const vArch = (platform.architecture || "") as string;
                const vOs = (platform.os || "") as string;
                const vVariant = (platform.variant || "") as string;
                const vSize = (v.size || 0) as number;
                const platformStr = [vOs, vArch, vVariant].filter(Boolean).join("/");
                return (
                  <div key={i} className="detail-layer">
                    <span className="detail-layer-num">#{i + 1}</span>
                    <code className="detail-layer-id">{platformStr} - {vSize ? formatBytes(vSize) : "-"}</code>
                  </div>
                );
              })}
            </div>
          </DetailSection>
        )}

        {diffIDs.length > 0 && (
          <DetailSection title={`Layers (${diffIDs.length})`}>
            <div className="detail-layers">
              {diffIDs.map((d, i) => (
                <div key={i} className="detail-layer">
                  <span className="detail-layer-num">#{i + 1}</span>
                  <code className="detail-layer-id">{d}</code>
                </div>
              ))}
            </div>
          </DetailSection>
        )}

        {history.length > 0 && (
          <DetailSection title="Build History">
            <div className="detail-history">
              {history.map((h, i) => (
                <div key={i} className="detail-history-item">
                  <span className="detail-history-num">#{i + 1}</span>
                  <div className="detail-history-info">
                    {(h.created_by || "") as string && (
                      <code className="detail-history-cmd">{(h.created_by || "") as string}</code>
                    )}
                    <span className="detail-history-meta">
                      {h.size ? `${formatBytes(Number(h.size))}` : ""}
                      {h.empty_layer ? " (empty layer)" : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </DetailSection>
        )}

        {usedByContainers.length > 0 && (
          <DetailSection title={`Used by ${usedByContainers.length} Container(s)`}>
            <div className="detail-containers-list">
              {usedByContainers.map((c) => (
                <div
                  key={c.id}
                  className={`detail-container-item ${onContainerClick ? "clickable" : ""}`}
                  onClick={() => onContainerClick?.(c.id)}
                >
                  <div className="detail-container-info">
                    <span className="detail-container-name">{c.id.substring(0, 12)}</span>
                    <span className={`detail-container-state state-${c.state}`}>{c.state}</span>
                  </div>
                  {c.ip && <span className="detail-container-ip">{c.ip}</span>}
                </div>
              ))}
            </div>
          </DetailSection>
        )}

        <DetailSection title="Raw JSON">
          <div className="inspect-content">
            <pre>{JSON.stringify(data, null, 2)}</pre>
          </div>
        </DetailSection>
      </div>
    </div>
  );
}
