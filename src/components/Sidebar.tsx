import type { Tab } from "../types";

interface SidebarProps {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  containerCount: number;
  imageCount: number;
  volumeCount: number;
  networkCount: number;
  machineCount: number;
  systemStatus: string;
  onSystemStart: () => void;
  onSystemStop: () => void;
  loading: boolean;
}

export function Sidebar({
  activeTab, setActiveTab,
  containerCount, imageCount, volumeCount, networkCount, machineCount,
  systemStatus, onSystemStart, onSystemStop, loading,
}: SidebarProps) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="logo">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="2" width="20" height="20" rx="3" />
            <path d="M8 12h8M12 8v8" />
          </svg>
        </div>
        <h1 className="app-title">Apple Container</h1>
      </div>

      <nav className="sidebar-nav">
        <button className={`nav-item ${activeTab === "containers" ? "active" : ""}`} onClick={() => setActiveTab("containers")}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="2" width="20" height="20" rx="2" />
            <path d="M7 8h10M7 12h10M7 16h6" />
          </svg>
          <span>Containers</span>
          <span className="badge">{containerCount}</span>
        </button>
        <button className={`nav-item ${activeTab === "images" ? "active" : ""}`} onClick={() => setActiveTab("images")}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          <span>Images</span>
          <span className="badge">{imageCount}</span>
        </button>
        <button className={`nav-item ${activeTab === "volumes" ? "active" : ""}`} onClick={() => setActiveTab("volumes")}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
            <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
          </svg>
          <span>Volumes</span>
          <span className="badge">{volumeCount}</span>
        </button>
        <button className={`nav-item ${activeTab === "networks" ? "active" : ""}`} onClick={() => setActiveTab("networks")}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          <span>Networks</span>
          <span className="badge">{networkCount}</span>
        </button>
        <button className={`nav-item ${activeTab === "machines" ? "active" : ""}`} onClick={() => setActiveTab("machines")}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          <span>Machines</span>
          <span className="badge">{machineCount}</span>
        </button>
        <button className={`nav-item ${activeTab === "terminal" ? "active" : ""}`} onClick={() => setActiveTab("terminal")}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          <span>Terminal</span>
        </button>
        <button className={`nav-item ${activeTab === "settings" ? "active" : ""}`} onClick={() => setActiveTab("settings")}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span>Settings</span>
        </button>
      </nav>

      <div className="sidebar-footer">
        <div className="system-controls">
          <div className="system-status-row">
            <span className="system-label">Service</span>
            <span className={`status-dot status-dot-${systemStatus}`} title={systemStatus}></span>
          </div>
          <div className="system-buttons">
            <button className="btn btn-sm btn-success" onClick={onSystemStart} disabled={loading}>
              Start
            </button>
            <button className="btn btn-sm btn-danger" onClick={onSystemStop} disabled={loading}>
              Stop
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
