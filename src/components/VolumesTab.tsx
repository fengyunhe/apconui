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
  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>Volumes</h2>
        <div className="tab-actions">
          <button className="btn btn-primary" onClick={onCreate}>Create</button>
          <button className="btn btn-danger btn-sm" onClick={onPrune} disabled={loading}>Prune Unused</button>
          <button className="btn btn-secondary" onClick={onRefresh} disabled={loading}>Refresh</button>
        </div>
      </div>
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Driver</th>
              <th>Size</th>
              <th>Source</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {volumes.length === 0 ? (
              <tr><td colSpan={5} className="empty-row">No volumes</td></tr>
            ) : (
              volumes.map((v) => (
                <tr key={v.name}>
                  <td>{v.name}</td>
                  <td>{v.driver}</td>
                  <td>{v.size || "-"}</td>
                  <td className="cell-digest">{v.source}</td>
                  <td className="cell-actions">
                    <button className="btn btn-xs btn-secondary" onClick={() => onInspect(v.name)} title="Inspect">Inspect</button>
                    <button className="btn btn-xs btn-danger" onClick={() => onDelete(v.name)} title="Delete">Delete</button>
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
