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
  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>Machines</h2>
        <div className="tab-actions">
          <button className="btn btn-primary" onClick={onCreate}>Create</button>
          <button className="btn btn-secondary" onClick={onRefresh} disabled={loading}>Refresh</button>
        </div>
      </div>
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>CPUs</th>
              <th>Memory</th>
              <th>Disk</th>
              <th>Created</th>
              <th>Default</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {machines.length === 0 ? (
              <tr><td colSpan={8} className="empty-row">No machines</td></tr>
            ) : (
              machines.map((m) => (
                <tr key={m.id} className={m.status === "running" ? "row-running" : ""}>
                  <td className="cell-id">{m.id}</td>
                  <td><span className={`status-badge status-${m.status}`}>{m.status}</span></td>
                  <td>{m.cpus}</td>
                  <td>{formatBytes(m.memory)}</td>
                  <td>{formatBytes(m.diskSize)}</td>
                  <td>{m.createdDate}</td>
                  <td>{m.isDefault ? <span className="badge badge-info">default</span> : "-"}</td>
                  <td className="cell-actions">
                    {m.status === "running" ? (
                      <button className="btn btn-xs btn-warning" onClick={() => onStop(m.id)} title="Stop">Stop</button>
                    ) : (
                      <button className="btn btn-xs btn-success" onClick={() => onStart(m.id)} title="Start">Start</button>
                    )}
                    {!m.isDefault && (
                      <button className="btn btn-xs btn-info" onClick={() => onSetDefault(m.id)} title="Set Default">Set Default</button>
                    )}
                    <button className="btn btn-xs btn-secondary" onClick={() => onInspect(m.id)} title="Inspect">Inspect</button>
                    <button className="btn btn-xs btn-danger" onClick={() => onDelete(m.id)} title="Delete">Delete</button>
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
