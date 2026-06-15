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
  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>Networks</h2>
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
              <th>State</th>
              <th>Subnet</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {networks.length === 0 ? (
              <tr><td colSpan={4} className="empty-row">No networks</td></tr>
            ) : (
              networks.map((n) => (
                <tr key={n.name}>
                  <td>{n.name}</td>
                  <td><span className={`status-badge status-${n.state}`}>{n.state}</span></td>
                  <td>{n.subnet}</td>
                  <td className="cell-actions">
                    <button className="btn btn-xs btn-secondary" onClick={() => onInspect(n.name)} title="Inspect">Inspect</button>
                    <button className="btn btn-xs btn-danger" onClick={() => onDelete(n.name)} title="Delete">Delete</button>
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
