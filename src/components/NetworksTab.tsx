import { useTranslation } from 'react-i18next';
import type { Network } from "../types";

interface NetworksTabProps {
  networks: Network[];
  loading: boolean;
  onRefresh: () => void;
  onCreate: () => void;
  onDelete: (name: string) => void;
  onInspect: (name: string) => void;
  onPrune: () => void;
}

export function NetworksTab({ networks, loading, onRefresh, onCreate, onDelete, onInspect, onPrune }: NetworksTabProps) {
  const { t } = useTranslation();

  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>{t('networks.title')}</h2>
        <div className="tab-actions">
          <button className="btn btn-primary" onClick={onCreate}>{t('networks.create')}</button>
          <button className="btn btn-danger btn-sm" onClick={onPrune} disabled={loading}>{t('networks.pruneUnused')}</button>
          <button className="btn btn-secondary" onClick={onRefresh} disabled={loading}>{t('containers.refresh')}</button>
        </div>
      </div>
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('networks.name')}</th>
              <th>{t('containers.state')}</th>
              <th>{t('networks.subnet')}</th>
              <th>{t('containers.inspect')}</th>
            </tr>
          </thead>
          <tbody>
            {networks.length === 0 ? (
              <tr><td colSpan={4} className="empty-row">{t('networks.noNetworks')}</td></tr>
            ) : (
              networks.map((n) => (
                <tr key={n.name}>
                  <td>{n.name}</td>
                  <td><span className={`status-badge status-${n.state}`}>{n.state}</span></td>
                  <td>{n.subnet}</td>
                  <td className="cell-actions">
                    <button className="btn btn-xs btn-secondary" onClick={() => onInspect(n.name)} title={t('containers.inspect')}>{t('containers.inspect')}</button>
                    <button className="btn btn-xs btn-danger" onClick={() => onDelete(n.name)} title={t('containers.delete')}>{t('containers.delete')}</button>
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
