import { useState, Fragment } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from 'react-i18next';
import type { Container, CommandResult } from "../types";

interface ContainersTabProps {
  containers: Container[];
  loading: boolean;
  onRefresh: () => void;
  onRun: () => void;
  onStop: (id: string) => void;
  onStart: (id: string) => void;
  onDelete: (id: string) => void;
  onKill: (id: string) => void;
  onLogs: (id: string) => void;
  onInspect: (id: string) => void;
  onExec: (id: string) => void;
  onPrune: () => void;
  onRowClick: (id: string) => void;
}

export function ContainersTab({ containers, loading, onRefresh, onRun, onStop, onStart, onDelete, onKill, onLogs, onInspect, onExec, onPrune, onRowClick }: ContainersTabProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [stateFilter, setStateFilter] = useState<string>("all");

  const filteredContainers = containers.filter((c) => {
    const matchText = filter === "" ||
      c.id.toLowerCase().includes(filter.toLowerCase()) ||
      c.image.toLowerCase().includes(filter.toLowerCase()) ||
      c.ip.toLowerCase().includes(filter.toLowerCase()) ||
      c.command.toLowerCase().includes(filter.toLowerCase()) ||
      c.ports.toLowerCase().includes(filter.toLowerCase());
    const matchState = stateFilter === "all" || c.state === stateFilter;
    return matchText && matchState;
  });

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filteredContainers.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredContainers.map((c) => c.id)));
    }
  };

  const batchAction = async (action: "start" | "stop" | "delete") => {
    for (const id of selected) {
      if (action === "start") await onStart(id);
      else if (action === "stop") await onStop(id);
      else if (action === "delete") await onDelete(id);
    }
    setSelected(new Set());
  };

  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>{t('containers.title')}</h2>
        <div className="tab-actions">
          {selected.size > 0 && (
            <>
              <button className="btn btn-success btn-sm" onClick={() => batchAction("start")}>
                {t('containers.start')} ({selected.size})
              </button>
              <button className="btn btn-warning btn-sm" onClick={() => batchAction("stop")}>
                {t('containers.stop')} ({selected.size})
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => batchAction("delete")}>
                {t('containers.delete')} ({selected.size})
              </button>
            </>
          )}
          <input
            type="text"
            className="filter-input"
            placeholder={t('containers.filterPlaceholder')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <select
            className="filter-select"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
          >
            <option value="all">{t('containers.allStates')}</option>
            <option value="running">{t('containers.running')}</option>
            <option value="exited">{t('containers.exited')}</option>
            <option value="created">{t('containers.created')}</option>
          </select>
          <button className="btn btn-primary" onClick={onRun}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            {t('containers.run')}
          </button>
          <button className="btn btn-danger btn-sm" onClick={onPrune} disabled={loading}>
            {t('containers.pruneStopped')}
          </button>
          <button className="btn btn-secondary" onClick={onRefresh} disabled={loading}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            {t('containers.refresh')}
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
                  checked={filteredContainers.length > 0 && selected.size === filteredContainers.length}
                  onChange={toggleAll}
                />
              </th>
              <th>{t('containers.id')}</th>
              <th>{t('containers.image')}</th>
              <th>{t('containers.command')}</th>
              <th>{t('containers.state')}</th>
              <th>{t('containers.ip')}</th>
              <th>{t('containers.ports')}</th>
              <th>{t('containers.resources')}</th>
              <th>{t('containers.created_at')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredContainers.length === 0 ? (
              <tr><td colSpan={9} className="empty-row">{containers.length === 0 ? t('containers.noContainers') : t('containers.noMatch')}</td></tr>
            ) : (
              filteredContainers.map((c) => {
                const memMB = c.memoryBytes > 0 ? (c.memoryBytes / 1024 / 1024).toFixed(0) : null;
                return (
                  <Fragment key={c.id}>
                    <tr className={c.state === "running" ? "row-running" : ""} style={{ cursor: "pointer" }} onClick={() => onRowClick(c.id)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => toggleSelect(c.id)}
                        />
                      </td>
                      <td className="cell-id">{c.id.substring(0, 12)}</td>
                      <td className="cell-image">{c.image}</td>
                      <td className="cell-command" title={c.command}>{c.command || "-"}</td>
                      <td>
                        <span className={`status-badge status-${c.state}`}>
                          {c.state}
                        </span>
                      </td>
                      <td>{c.ip || "-"}</td>
                      <td className="cell-ports">
                        {c.ports ? c.ports.split(",").map((p, i) => {
                          const trimmed = p.trim();
                          const hostMatch = trimmed.match(/^(\d+):(\d+)/);
                          const containerMatch = trimmed.match(/^(\d+)/);
                          let url = "";
                          let title = "";
                          if (hostMatch) {
                            url = `http://localhost:${hostMatch[1]}`;
                            title = `Open http://localhost:${hostMatch[1]}`;
                          } else if (containerMatch && c.ip) {
                            url = `http://${c.ip}:${containerMatch[1]}`;
                            title = `Open http://${c.ip}:${containerMatch[1]}`;
                          }
                          return url ? (
                            <span key={i}>
                              {i > 0 && ", "}
                              <a href="#" className="port-link" onClick={(e) => { e.preventDefault(); e.stopPropagation(); invoke<CommandResult>("open_url", { url }); }} title={title}>
                                {trimmed}
                              </a>
                            </span>
                          ) : <span key={i}>{i > 0 && ", "}{trimmed}</span>;
                        }) : "-"}
                      </td>
                      <td className="cell-resources">
                        {c.cpus > 0 || memMB ? (
                          <span title={`CPU: ${c.cpus || "-"} cores, Memory: ${memMB ? memMB + " MB" : "-"}`}>
                            {c.cpus > 0 ? `${c.cpus} CPU` : ""}{c.cpus > 0 && memMB ? " / " : ""}{memMB ? `${memMB} MB` : ""}
                          </span>
                        ) : "-"}
                      </td>
                      <td>{c.created || "-"}</td>
                    </tr>
                    <tr className="row-actions" onClick={() => onRowClick(c.id)}>
                      <td colSpan={9}>
                        <div className="cell-actions" onClick={(e) => e.stopPropagation()}>
                          {c.state === "running" ? (
                            <>
                              <button className="btn btn-xs btn-warning" onClick={() => onStop(c.id)} title={t('containers.stop')}>
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
                              </button>
                              <button className="btn btn-xs btn-danger" onClick={() => onKill(c.id)} title={t('containers.delete')}>
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                              </button>
                            </>
                          ) : (
                            <button className="btn btn-xs btn-success" onClick={() => onStart(c.id)} title={t('containers.start')}>
                              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                            </button>
                          )}
                          <button className="btn btn-xs btn-info" onClick={() => onLogs(c.id)} title={t('containers.logs')}>
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                          </button>
                          <button className="btn btn-xs btn-secondary" onClick={() => onInspect(c.id)} title={t('containers.inspect')}>
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                          </button>
                          <button className="btn btn-xs btn-success" onClick={() => onExec(c.id)} title={t('containers.execShell')}>
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                          </button>
                          <button className="btn btn-xs btn-danger" onClick={() => onDelete(c.id)} title={t('containers.delete')}>
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
