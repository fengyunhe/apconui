import { formatBytes } from "../utils";
import { DetailSection } from "./DetailSection";
import { DetailRow } from "./DetailRow";
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
          <h2>{t('images.title')}</h2>
          <span className="tag-badge">{name}</span>
        </div>
        <div className="detail-actions">
          <button className="btn btn-info btn-sm" onClick={() => onTag(name)}>{t('detail.tag')}</button>
          <button className="btn btn-success btn-sm" onClick={() => onPush(name)}>{t('detail.push')}</button>
        </div>
      </div>

      <div className="detail-body">
        <DetailSection title={t('detail.general')}>
          <DetailRow label={t('detail.id')} value={<span className="cell-digest">{id}</span>} />
          <DetailRow label={t('detail.name')} value={name || "-"} />
          <DetailRow label={t('detail.created')} value={creationDate ? new Date(creationDate).toLocaleString() : "-"} />
          <DetailRow label={t('detail.size')} value={size ? formatBytes(size) : "-"} />
          <DetailRow label={t('detail.mediaType')} value={mediatype || "-"} />
        </DetailSection>

        <DetailSection title={t('detail.configuration')}>
          <DetailRow label={t('detail.entrypoint')} value={entrypoint.length > 0 ? <code>{entrypoint.join(" ")}</code> : "-"} />
          <DetailRow label={t('detail.cmd')} value={cmd.length > 0 ? <code>{cmd.join(" ")}</code> : "-"} />
          <DetailRow label={t('detail.workingDir')} value={workingDir || "-"} />
          <DetailRow label={t('detail.user')} value={user || "-"} />
          {Object.keys(exposedPorts).length > 0 && (
            <DetailRow label={t('detail.exposedPorts')} value={Object.keys(exposedPorts).join(", ")} />
          )}
        </DetailSection>

        {env.length > 0 && (
          <DetailSection title={t('detail.environment')}>
            <div className="detail-env-list">
              {env.map((e, i) => (
                <code key={i} className="detail-env-item">{e}</code>
              ))}
            </div>
          </DetailSection>
        )}

        {Object.keys(labels).length > 0 && (
          <DetailSection title={t('detail.labels')}>
            {Object.entries(labels).map(([k, v]) => (
              <DetailRow key={k} label={k} value={v} />
            ))}
          </DetailSection>
        )}

        {variants.length > 0 && (
          <DetailSection title={`${t('detail.variants')} (${variants.length})`}>
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
          <DetailSection title={`${t('detail.layers')} (${diffIDs.length})`}>
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
          <DetailSection title={t('detail.buildHistory')}>
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
                      {h.empty_layer ? ` (${t('detail.emptyLayer')})` : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </DetailSection>
        )}

        {usedByContainers.length > 0 && (
          <DetailSection title={t('detail.usedBy', { count: usedByContainers.length })}>
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

        <DetailSection title={t('detail.rawJson')}>
          <div className="inspect-content">
            <pre>{JSON.stringify(data, null, 2)}</pre>
          </div>
        </DetailSection>
      </div>
    </div>
  );
}
