import { useTranslation } from 'react-i18next';
import type { Volume } from "../types";

interface VolumesTabProps {
  volumes: Volume[];
  loading: boolean;
  onRefresh: () => void;
  onCreate: () => void;
  onDelete: (name: string) => void;
  onInspect: (name: string) => void;
  onPrune: () => void;
}

export function VolumesTab({ volumes, loading, onRefresh, onCreate, onDelete, onInspect, onPrune }: VolumesTabProps) {
  const { t } = useTranslation();

  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>{t('volumes.title')}</h2>
        <div className="tab-actions">
          <button className="btn btn-primary" onClick={onCreate}>{t('volumes.create')}</button>
          <button className="btn btn-danger btn-sm" onClick={onPrune} disabled={loading}>{t('volumes.pruneUnused')}</button>
          <button className="btn btn-secondary" onClick={onRefresh} disabled={loading}>{t('containers.refresh')}</button>
        </div>
      </div>
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('volumes.name')}</th>
              <th>{t('volumes.driver')}</th>
              <th>{t('images.size')}</th>
              <th>Source</th>
              <th>{t('containers.inspect')}</th>
            </tr>
          </thead>
          <tbody>
            {volumes.length === 0 ? (
              <tr><td colSpan={5} className="empty-row">{t('volumes.noVolumes')}</td></tr>
            ) : (
              volumes.map((v) => (
                <tr key={v.name}>
                  <td>{v.name}</td>
                  <td>{v.driver}</td>
                  <td>{v.size || "-"}</td>
                  <td className="cell-digest">{v.source}</td>
                  <td className="cell-actions">
                    <button className="btn btn-xs btn-secondary" onClick={() => onInspect(v.name)} title={t('containers.inspect')}>{t('containers.inspect')}</button>
                    <button className="btn btn-xs btn-danger" onClick={() => onDelete(v.name)} title={t('containers.delete')}>{t('containers.delete')}</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
