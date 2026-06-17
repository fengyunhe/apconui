import { useTranslation } from 'react-i18next';
import type { Machine } from "../types";
import { formatBytes } from "../utils";

interface MachinesTabProps {
  machines: Machine[];
  loading: boolean;
  onRefresh: () => void;
  onCreate: () => void;
  onStart: (name: string) => void;
  onStop: (name: string) => void;
  onDelete: (name: string) => void;
  onInspect: (name: string) => void;
  onSetDefault: (name: string) => void;
}

export function MachinesTab({ machines, loading, onRefresh, onCreate, onStart, onStop, onDelete, onInspect, onSetDefault }: MachinesTabProps) {
  const { t } = useTranslation();

  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>{t('machines.title')}</h2>
        <div className="tab-actions">
          <button className="btn btn-primary" onClick={onCreate}>{t('machines.create')}</button>
          <button className="btn btn-secondary" onClick={onRefresh} disabled={loading}>{t('containers.refresh')}</button>
        </div>
      </div>
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('machines.name')}</th>
              <th>{t('machines.status')}</th>
              <th>CPUs</th>
              <th>Memory</th>
              <th>Disk</th>
              <th>{t('containers.created_at')}</th>
              <th>{t('machines.default')}</th>
              <th>{t('containers.inspect')}</th>
            </tr>
          </thead>
          <tbody>
            {machines.length === 0 ? (
              <tr><td colSpan={8} className="empty-row">{t('machines.noMachines')}</td></tr>
            ) : (
              machines.map((m) => (
                <tr key={m.id} className={m.status === "running" ? "row-running" : ""}>
                  <td className="cell-id">{m.id}</td>
                  <td><span className={`status-badge status-${m.status}`}>{m.status}</span></td>
                  <td>{m.cpus}</td>
                  <td>{formatBytes(m.memory)}</td>
                  <td>{formatBytes(m.diskSize)}</td>
                  <td>{m.createdDate}</td>
                  <td>{m.isDefault ? <span className="badge badge-info">{t('machines.default')}</span> : "-"}</td>
                  <td className="cell-actions">
                    {m.status === "running" ? (
                      <button className="btn btn-xs btn-warning" onClick={() => onStop(m.id)} title={t('machines.stop')}>{t('machines.stop')}</button>
                    ) : (
                      <button className="btn btn-xs btn-success" onClick={() => onStart(m.id)} title={t('machines.start')}>{t('machines.start')}</button>
                    )}
                    {!m.isDefault && (
                      <button className="btn btn-xs btn-info" onClick={() => onSetDefault(m.id)} title={t('machines.setDefault')}>{t('machines.setDefault')}</button>
                    )}
                    <button className="btn btn-xs btn-secondary" onClick={() => onInspect(m.id)} title={t('containers.inspect')}>{t('containers.inspect')}</button>
                    <button className="btn btn-xs btn-danger" onClick={() => onDelete(m.id)} title={t('containers.delete')}>{t('containers.delete')}</button>
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
