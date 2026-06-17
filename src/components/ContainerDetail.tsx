import { formatBytes } from "../utils";
import { DetailSection } from "./DetailSection";
import { DetailRow } from "./DetailRow";

interface ContainerDetailProps {
  data: Record<string, unknown> | null;
  loading: boolean;
  onBack: () => void;
  onAction: (action: string, id: string) => void;
  onLogs: (id: string) => void;
  onExec: (id: string) => void;
  onFiles: (id: string) => void;
  onImageClick?: (name: string) => void;
}

export function ContainerDetail({ data, loading, onBack, onAction, onLogs, onExec, onFiles, onImageClick }: ContainerDetailProps) {
  const config = (data?.configuration || {}) as Record<string, unknown>;
  const stateObj = (data?.status || {}) as Record<string, unknown>;
  const platform = (config.platform || {}) as Record<string, unknown>;
  const image = (config.image || {}) as Record<string, unknown>;
  const networks = (stateObj.networks || []) as Array<Record<string, unknown>>;
  const mounts = (config.mounts || []) as Array<Record<string, unknown>>;
  const initProcess = (config.initProcess || {}) as Record<string, unknown>;
  const env = (initProcess.environment || []) as string[];
  const args = (initProcess.arguments || []) as string[];
  const executable = (initProcess.executable || "") as string;
  const res = (config.resources || {}) as Record<string, unknown>;
  const labels = (config.labels || {}) as Record<string, string>;
  const publishedPorts = (config.publishedPorts || []) as Array<Record<string, unknown>>;
  const startedAt = (stateObj.startedDate || "") as string;
  const state = (stateObj.state || "") as string;
  const os = (platform.os || "") as string;
  const arch = (platform.architecture || "") as string;
  const imageRef = (image.reference || "") as string;
  const id = (config.id || data?.id || "") as string;
  const stopSignal = (config.stopSignal || "") as string;
  const creationDate = (config.creationDate || "") as string;
  const cpus = (res.cpus || 0) as number;
  const memBytes = (res.memoryInBytes || 0) as number;

  if (loading) {
    return (
      <div className="detail-page">
        <div className="detail-header">
          <button className="btn btn-secondary" onClick={onBack}>Back</button>
          <h2>Loading...</h2>
        </div>
        <div className="detail-loading">Loading container details...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="detail-page">
        <div className="detail-header">
          <button className="btn btn-secondary" onClick={onBack}>Back</button>
          <h2>Container Details</h2>
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
          <h2>Container</h2>
          <span className={`status-badge status-${state}`}>{state}</span>
        </div>
        <div className="detail-actions">
          {state === "running" ? (
            <>
              <button className="btn btn-warning btn-sm" onClick={() => onAction("stop", id)}>Stop</button>
              <button className="btn btn-danger btn-sm" onClick={() => onAction("kill", id)}>Kill</button>
            </>
          ) : (
            <button className="btn btn-success btn-sm" onClick={() => onAction("start", id)}>Start</button>
          )}
          <button className="btn btn-info btn-sm" onClick={() => onLogs(id)}>Logs</button>
          <button className="btn btn-success btn-sm" onClick={() => onExec(id)}>Exec</button>
          {state === "running" && (
            <button className="btn btn-secondary btn-sm" onClick={() => onFiles(id)}>Files</button>
          )}
          <button className="btn btn-danger btn-sm" onClick={() => onAction("delete", id)}>Delete</button>
        </div>
      </div>

      <div className="detail-body">
        <DetailSection title="General">
          <DetailRow label="ID" value={<span className="cell-id">{id}</span>} />
          <DetailRow label="Image" value={
            imageRef ? (
              onImageClick ? (
                <a href="#" className="detail-link" onClick={(e) => { e.preventDefault(); onImageClick(imageRef); }}>{imageRef}</a>
              ) : imageRef
            ) : "-"
          } />
          <DetailRow label="Command" value={args.length > 0 ? <code>{args.join(" ")}</code> : (executable || "-")} />
          <DetailRow label="OS" value={os || "-"} />
          <DetailRow label="Architecture" value={arch || "-"} />
          <DetailRow label="Stop Signal" value={stopSignal || "-"} />
          <DetailRow label="Created" value={creationDate ? new Date(creationDate).toLocaleString() : "-"} />
          <DetailRow label="Started" value={startedAt ? new Date(startedAt).toLocaleString() : "-"} />
        </DetailSection>

        <DetailSection title="Resources">
          <DetailRow label="CPUs" value={cpus > 0 ? String(cpus) : "-"} />
          <DetailRow label="Memory Limit" value={memBytes > 0 ? formatBytes(memBytes) : "-"} />
        </DetailSection>

        {publishedPorts.length > 0 && (
          <DetailSection title="Published Ports">
            {publishedPorts.map((p, i) => (
              <div key={i} className="detail-network-card">
                <DetailRow label="Host" value={`${(p.hostAddress || "0.0.0.0") as string}:${(p.hostPort || "") as number}`} />
                <DetailRow label="Container" value={`${(p.containerPort || "") as number}/${(p.proto || "tcp") as string}`} />
              </div>
            ))}
          </DetailSection>
        )}

        {Object.keys(labels).length > 0 && (
          <DetailSection title="Labels">
            {Object.entries(labels).map(([k, v]) => (
              <DetailRow key={k} label={k} value={v} />
            ))}
          </DetailSection>
        )}

        {env.length > 0 && (
          <DetailSection title="Environment">
            <div className="detail-env-list">
              {env.map((e, i) => (
                <code key={i} className="detail-env-item">{e}</code>
              ))}
            </div>
          </DetailSection>
        )}

        {networks.length > 0 && (
          <DetailSection title="Networks">
            {networks.map((n, i) => (
              <div key={i} className="detail-network-card">
                <DetailRow label="Network" value={(n.network || "") as string} />
                <DetailRow label="IPv4" value={(n.ipv4Address || "") as string} />
                <DetailRow label="IPv6" value={(n.ipv6Address || "") as string} />
                <DetailRow label="Gateway" value={(n.ipv4Gateway || "") as string} />
                <DetailRow label="MAC" value={(n.macAddress || "") as string} />
              </div>
            ))}
          </DetailSection>
        )}

        {mounts.length > 0 && (
          <DetailSection title="Mounts">
            {mounts.map((m, i) => (
              <div key={i} className="detail-mount-card">
                <DetailRow label="Type" value={(m.type || "") as string} />
                <DetailRow label="Source" value={<span className="cell-digest">{(m.source || "") as string}</span>} />
                <DetailRow label="Destination" value={(m.destination || "") as string} />
                <DetailRow label="Mode" value={(m.mode || "") as string} />
                <DetailRow label="RW" value={(m.rw !== undefined) ? (m.rw ? "Yes" : "No") : "-"} />
              </div>
            ))}
          </DetailSection>
        )}

        {(() => {
          const dns = (config.dns || {}) as Record<string, unknown>;
          const servers = (dns.nameservers || []) as string[];
          const search = (dns.searchDomains || []) as string[];
          const options = (dns.options || []) as string[];
          const domain = (dns.domain || "") as string;
          if (servers.length === 0 && search.length === 0 && options.length === 0 && !domain) return null;
          return (
            <DetailSection title="DNS">
              <DetailRow label="Servers" value={servers.join(", ") || "-"} />
              <DetailRow label="Search" value={search.join(", ") || "-"} />
              <DetailRow label="Options" value={options.join(", ") || "-"} />
              <DetailRow label="Domain" value={domain || "-"} />
            </DetailSection>
          );
        })()}

        <DetailSection title="Raw JSON">
          <div className="inspect-content">
            <pre>{JSON.stringify(data, null, 2)}</pre>
          </div>
        </DetailSection>
      </div>
    </div>
  );
}
