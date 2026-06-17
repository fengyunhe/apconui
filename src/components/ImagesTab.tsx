import { useState, Fragment } from "react";
import type { Image, Container } from "../types";

interface ImagesTabProps {
  images: Image[];
  loading: boolean;
  onRefresh: () => void;
  onPull: () => void;
  onBuild: () => void;
  onDelete: (name: string) => void;
  onInspect: (fullName: string) => void;
  onTag: (name: string) => void;
  onPush: (name: string) => void;
  onCreateContainer: (fullName: string) => void;
  containers: Container[];
  onPrune: () => void;
  onRowClick: (fullName: string) => void;
}

export function ImagesTab({ images, loading, onRefresh, onPull, onBuild, onDelete, onInspect, onTag, onPush, onCreateContainer, containers, onPrune, onRowClick }: ImagesTabProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [verbose, setVerbose] = useState(false);
  const [filter, setFilter] = useState("");

  const filteredImages = images.filter((img) => {
    if (filter === "") return true;
    const search = filter.toLowerCase();
    return (
      img.name.toLowerCase().includes(search) ||
      img.tag.toLowerCase().includes(search) ||
      img.digest.toLowerCase().includes(search)
    );
  });

  const toggleSelect = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filteredImages.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredImages.map((img) => `${img.name}:${img.tag}`)));
    }
  };

  const batchDelete = async () => {
    for (const name of selected) {
      await onDelete(name);
    }
    setSelected(new Set());
  };

  const getContainersUsingImage = (imageName: string, tag: string) => {
    return containers.filter((c) => c.image === `${imageName}:${tag}`);
  };

  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>Images</h2>
        <div className="tab-actions">
          {selected.size > 0 && (
            <button className="btn btn-danger btn-sm" onClick={batchDelete}>
              Delete ({selected.size})
            </button>
          )}
          <input
            type="text"
            className="filter-input"
            placeholder="Filter by name, tag, digest..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={verbose}
              onChange={(e) => setVerbose(e.target.checked)}
            />
            Verbose
          </label>
          <button className="btn btn-primary" onClick={onPull}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Pull
          </button>
          <button className="btn btn-primary" onClick={onBuild}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            Build
          </button>
          <button className="btn btn-danger btn-sm" onClick={onPrune} disabled={loading}>
            Prune Unused
          </button>
          <button className="btn btn-secondary" onClick={onRefresh} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>
                <input
                  type="checkbox"
                  checked={filteredImages.length > 0 && selected.size === filteredImages.length}
                  onChange={toggleAll}
                />
              </th>
              <th>Name</th>
              <th>Tag</th>
              <th>Digest</th>
              <th>Size</th>
              {verbose && <th>Created</th>}
              {verbose && <th>Architectures</th>}
              {verbose && <th>Cmd</th>}
              <th>Containers</th>
            </tr>
          </thead>
          <tbody>
            {filteredImages.length === 0 ? (
              <tr><td colSpan={verbose ? 9 : 6} className="empty-row">{images.length === 0 ? "No images" : "No match"}</td></tr>
            ) : (
              filteredImages.map((img) => {
                const usingContainers = getContainersUsingImage(img.name, img.tag);
                const fullName = `${img.name}:${img.tag}`;
                return (
                  <Fragment key={fullName}>
                    <tr style={{ cursor: "pointer" }} onClick={() => onRowClick(fullName)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(fullName)}
                          onChange={() => toggleSelect(fullName)}
                        />
                      </td>
                      <td>{img.name}</td>
                      <td><span className="tag-badge">{img.tag}</span></td>
                      <td className="cell-digest">{img.digest}</td>
                      <td>{img.size}</td>
                      {verbose && <td>{img.created || "-"}</td>}
                      {verbose && <td>{img.architectures?.join(", ") || "-"}</td>}
                      {verbose && <td className="cell-cmd">{img.cmd?.join(" ") || "-"}</td>}
                      <td>
                        {usingContainers.length > 0 ? (
                          <span className="badge badge-info">{usingContainers.length} running</span>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                    </tr>
                    <tr className="row-actions" onClick={() => onRowClick(fullName)}>
                      <td colSpan={verbose ? 9 : 6}>
                        <div className="cell-actions" onClick={(e) => e.stopPropagation()}>
                          <button className="btn btn-xs btn-success" onClick={() => onCreateContainer(fullName)} title="Run Container">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                          </button>
                          <button className="btn btn-xs btn-info" onClick={() => onTag(fullName)} title="Tag">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                          </button>
                          <button className="btn btn-xs btn-success" onClick={() => onPush(fullName)} title="Push">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                          </button>
                          <button className="btn btn-xs btn-secondary" onClick={() => onInspect(fullName)} title="Inspect">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                          </button>
                          <button className="btn btn-xs btn-danger" onClick={() => onDelete(fullName)} title="Delete" disabled={usingContainers.length > 0}>
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
