import { formatBytes } from "../utils";
import { DetailSection } from "./DetailSection";
import { DetailRow } from "./DetailRow";
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
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
          <button className="btn btn-secondary" onClick={onBack}>{t('detail.back')}</button>
          <h2>{t('detail.loading')}</h2>
        </div>
        <div className="detail-loading">{t('detail.loading')}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="detail-page">
        <div className="detail-header">
          <button className="btn btn-secondary" onClick={onBack}>{t('detail.back')}</button>
          <h2>{t('detail.general')}</h2>
        </div>
        <div className="detail-loading">{t('detail.noData')}</div>
      </div>
    );
  }

  return (
    <div className="detail-page">
      <div className="detail-header">
        <button className="btn btn-secondary" onClick={onBack}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          {t('detail.back')}
        </button>
        <div className="detail-title-area">
          <h2>{t('containers.title')}</h2>
          <span className={`status-badge status-${state}`}>{state}</span>
        </div>
        <div className="detail-actions">
          {state === "running" ? (
            <>
              <button className="btn btn-warning btn-sm" onClick={() => onAction("stop", id)}>{t('detail.stop')}</button>
              <button className="btn btn-danger btn-sm" onClick={() => onAction("kill", id)}>{t('detail.kill')}</button>
            </>
          ) : (
            <button className="btn btn-success btn-sm" onClick={() => onAction("start", id)}>{t('detail.start')}</button>
          )}
          <button className="btn btn-info btn-sm" onClick={() => onLogs(id)}>{t('detail.logs')}</button>
          <button className="btn btn-success btn-sm" onClick={() => onExec(id)}>{t('detail.exec')}</button>
          {state === "running" && (
            <button className="btn btn-secondary btn-sm" onClick={() => onFiles(id)}>{t('detail.files')}</button>
          )}
          <button className="btn btn-danger btn-sm" onClick={() => onAction("delete", id)}>{t('detail.delete')}</button>
        </div>
      </div>

      <div className="detail-body">
        <DetailSection title={t('detail.general')}>
          <DetailRow label={t('detail.id')} value={<span className="cell-id">{id}</span>} />
          <DetailRow label={t('detail.image')} value={
            imageRef ? (
              onImageClick ? (
                <a href="#" className="detail-link" onClick={(e) => { e.preventDefault(); onImageClick(imageRef); }}>{imageRef}</a>
              ) : imageRef
            ) : "-"
          } />
          <DetailRow label={t('detail.command')} value={args.length > 0 ? <code>{args.join(" ")}</code> : (executable || "-")} />
          <DetailRow label={t('detail.os')} value={os || "-"} />
          <DetailRow label={t('detail.architecture')} value={arch || "-"} />
          <DetailRow label={t('detail.stopSignal')} value={stopSignal || "-"} />
          <DetailRow label={t('detail.created')} value={creationDate ? new Date(creationDate).toLocaleString() : "-"} />
          <DetailRow label={t('detail.started')} value={startedAt ? new Date(startedAt).toLocaleString() : "-"} />
        </DetailSection>

        <DetailSection title={t('detail.resources')}>
          <DetailRow label={t('detail.cpus')} value={cpus > 0 ? String(cpus) : "-"} />
          <DetailRow label={t('detail.memoryLimit')} value={memBytes > 0 ? formatBytes(memBytes) : "-"} />
        </DetailSection>

        {publishedPorts.length > 0 && (
          <DetailSection title={t('detail.publishedPorts')}>
            {publishedPorts.map((p, i) => (
              <div key={i} className="detail-network-card">
                <DetailRow label={t('detail.host')} value={`${(p.hostAddress || "0.0.0.0") as string}:${(p.hostPort || "") as number}`} />
                <DetailRow label={t('detail.container')} value={`${(p.containerPort || "") as number}/${(p.proto || "tcp") as string}`} />
              </div>
            ))}
          </DetailSection>
        )}

        {Object.keys(labels).length > 0 && (
          <DetailSection title={t('detail.labels')}>
            {Object.entries(labels).map(([k, v]) => (
              <DetailRow key={k} label={k} value={v} />
            ))}
          </DetailSection>
        )}

        {env.length > 0 && (
          <DetailSection title={t('detail.environment')}>
            <div className="detail-env-list">
              {env.map((e, i) => (
                <code key={i} className="detail-env-item">{e}</code>
              ))}
            </div>
          </DetailSection>
        )}

        {networks.length > 0 && (
          <DetailSection title={t('detail.networks')}>
            {networks.map((n, i) => (
              <div key={i} className="detail-network-card">
                <DetailRow label={t('detail.network')} value={(n.network || "") as string} />
                <DetailRow label={t('detail.ipv4')} value={(n.ipv4Address || "") as string} />
                <DetailRow label={t('detail.ipv6')} value={(n.ipv6Address || "") as string} />
                <DetailRow label={t('detail.gateway')} value={(n.ipv4Gateway || "") as string} />
                <DetailRow label={t('detail.mac')} value={(n.macAddress || "") as string} />
              </div>
            ))}
          </DetailSection>
        )}

        {mounts.length > 0 && (
          <DetailSection title={t('detail.mounts')}>
            {mounts.map((m, i) => (
              <div key={i} className="detail-mount-card">
                <DetailRow label={t('detail.type')} value={(m.type || "") as string} />
                <DetailRow label={t('detail.source')} value={<span className="cell-digest">{(m.source || "") as string}</span>} />
                <DetailRow label={t('detail.destination')} value={(m.destination || "") as string} />
                <DetailRow label={t('detail.mode')} value={(m.mode || "") as string} />
                <DetailRow label={t('detail.rw')} value={(m.rw !== undefined) ? (m.rw ? t('detail.yes') : t('detail.no')) : "-"} />
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
            <DetailSection title={t('detail.dns')}>
              <DetailRow label={t('detail.servers')} value={servers.join(", ") || "-"} />
              <DetailRow label={t('detail.search')} value={search.join(", ") || "-"} />
              <DetailRow label={t('detail.options')} value={options.join(", ") || "-"} />
              <DetailRow label={t('detail.domain')} value={domain || "-"} />
            </DetailSection>
          );
        })()}

        <DetailSection title={t('detail.rawJson')}>
          <div className="inspect-content">
            <pre>{JSON.stringify(data, null, 2)}</pre>
          </div>
        </DetailSection>
      </div>
    </div>
  );
}
