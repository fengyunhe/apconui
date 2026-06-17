import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from 'react-i18next';
import { changeLanguage } from '../i18n';
import type { CommandResult } from "../types";

interface DockerSettings {
  enabled: boolean;
  autoStart: boolean;
  useSocktainer: boolean;
}

const DEFAULT_SETTINGS: DockerSettings = {
  enabled: true,
  autoStart: true,
  useSocktainer: false,
};

export function SettingsTab() {
  const { t, i18n } = useTranslation();
  const [settings, setSettings] = useState<DockerSettings>(() => {
    try {
      const saved = localStorage.getItem("docker-settings");
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const [socketStatus, setSocketStatus] = useState<"checking" | "connected" | "disconnected">("checking");
  const [socketInfo, setSocketInfo] = useState<{ containers?: number; images?: number }>({});
  const [actualSocketPath, setActualSocketPath] = useState<string>("");
  const [socktainerInstalled, setSocktainerInstalled] = useState<boolean>(false);
  const [socktainerRunning, setSocktainerRunning] = useState<boolean>(false);
  const [socktainerLoading, setSocktainerLoading] = useState<boolean>(false);

  // Check socktainer status
  const checkSocktainerStatus = async () => {
    try {
      const installed = await invoke<boolean>("is_socktainer_installed");
      setSocktainerInstalled(installed);
      const running = await invoke<boolean>("is_socktainer_running");
      setSocktainerRunning(running);
      // Auto-enable Socktainer if it's running and user hasn't explicitly disabled it
      if (running && !settings.useSocktainer) {
        setSettings((prev) => ({ ...prev, useSocktainer: true }));
      }
    } catch {}
  };

  // Get actual socket path from backend
  useEffect(() => {
    const loadSocketPath = async () => {
      if (settings.useSocktainer) {
        try {
          const path = await invoke<string>("get_socktainer_socket_path");
          setActualSocketPath(path);
        } catch {
          setActualSocketPath("/Users/yan.yang/.socktainer/container.sock");
        }
      } else {
        try {
          const path = await invoke<string>("get_docker_socket_path");
          setActualSocketPath(path);
        } catch {
          setActualSocketPath("/tmp/docker.sock");
        }
      }
    };
    loadSocketPath();
  }, [settings.useSocktainer]);

  useEffect(() => {
    checkSocktainerStatus();
    const interval = setInterval(checkSocktainerStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    checkSocketStatus();
    const interval = setInterval(checkSocketStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const checkSocketStatus = async () => {
    try {
      const result = await invoke<CommandResult>("run_raw_command", {
        command: `system status`
      });
      if (result.success) {
        setSocketStatus("connected");
        // Try to get some stats
        try {
          const containersResult = await invoke<CommandResult>("run_raw_command", {
            command: "ls --format json --all"
          });
          const imagesResult = await invoke<CommandResult>("run_raw_command", {
            command: "image ls --format json"
          });
          if (containersResult.success && imagesResult.success) {
            const containers = JSON.parse(containersResult.stdout || "[]");
            const images = JSON.parse(imagesResult.stdout || "[]");
            setSocketInfo({
              containers: Array.isArray(containers) ? containers.length : 0,
              images: Array.isArray(images) ? images.length : 0,
            });
          }
        } catch {}
      } else {
        setSocketStatus("disconnected");
      }
    } catch {
      setSocketStatus("disconnected");
    }
  };

  const handleTestSocket = async () => {
    try {
      const result = await invoke<CommandResult>("run_raw_command", {
        command: "system status"
      });
      if (result.success) {
        alert(`Socket test passed!\n\nPath: ${actualSocketPath}\nStatus: ${result.stdout.trim()}`);
      } else {
        alert(`Socket test failed!\n\n${result.stderr}`);
      }
    } catch (e) {
      alert(`Socket test failed!\n\n${String(e)}`);
    }
  };

  const handleStartSocktainer = async () => {
    setSocktainerLoading(true);
    try {
      const result = await invoke<CommandResult>("start_socktainer");
      if (result.success) {
        setSocktainerRunning(true);
        setSettings((prev) => ({ ...prev, useSocktainer: true }));
        // Reload socket path
        const path = await invoke<string>("get_socktainer_socket_path");
        setActualSocketPath(path);
      } else {
        alert(`Failed to start socktainer:\n${result.stderr}`);
      }
    } catch (e) {
      alert(`Failed to start socktainer:\n${String(e)}`);
    } finally {
      setSocktainerLoading(false);
    }
  };

  const handleStopSocktainer = async () => {
    setSocktainerLoading(true);
    try {
      await invoke<CommandResult>("stop_socktainer");
      setSocktainerRunning(false);
      setSettings((prev) => ({ ...prev, useSocktainer: false }));
      // Reload socket path
      const path = await invoke<string>("get_docker_socket_path");
      setActualSocketPath(path);
    } catch (e) {
      alert(`Failed to stop socktainer:\n${String(e)}`);
    } finally {
      setSocktainerLoading(false);
    }
  };

  const handleResetSettings = () => {
    if (confirm(t('settings.resetConfirm'))) {
      setSettings(DEFAULT_SETTINGS);
    }
  };

  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>{t('settings.title')}</h2>
      </div>

      <div className="settings-container">
        {/* Language Section */}
        <div className="settings-section">
          <h3 className="settings-section-title">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            {t('settings.language')}
          </h3>

          <div className="settings-item">
            <div className="settings-item-info">
              <label className="settings-label">{t('settings.language')}</label>
              <p className="settings-description">
                {t('settings.languageDesc')}
              </p>
            </div>
            <select
              className="settings-input"
              value={i18n.language}
              onChange={(e) => changeLanguage(e.target.value)}
              style={{ width: 150 }}
            >
              <option value="zh">🇨🇳 中文</option>
              <option value="en">🇺🇸 English</option>
              <option value="ja">🇯🇵 日本語</option>
              <option value="de">🇩🇪 Deutsch</option>
              <option value="fr">🇫🇷 Français</option>
            </select>
          </div>
        </div>

        {/* Docker Compatibility Section */}
        <div className="settings-section">
          <h3 className="settings-section-title">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8 }}>
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            {t('settings.dockerCompatibility')}
          </h3>

          <div className="settings-item">
            <div className="settings-item-info">
              <label className="settings-label">{t('settings.enableDockerMode')}</label>
              <p className="settings-description">
                {t('settings.enableDockerModeDesc')}
              </p>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <label className="settings-label">{t('settings.dockerSocketPath')}</label>
              <p className="settings-description">
                {t('settings.dockerSocketPathDesc')}
              </p>
            </div>
            <div className="settings-input-group">
              <input
                type="text"
                className="settings-input"
                value={actualSocketPath || "Loading..."}
                readOnly
                disabled
              />
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleTestSocket}
                disabled={!settings.enabled}
              >
                {t('settings.test')}
              </button>
            </div>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <label className="settings-label">{t('settings.autoStartSocket')}</label>
              <p className="settings-description">
                {t('settings.autoStartSocketDesc')}
              </p>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={settings.autoStart}
                onChange={(e) => setSettings({ ...settings, autoStart: e.target.checked })}
                disabled={!settings.enabled}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>
        </div>

        {/* Socket Status Section */}
        <div className="settings-section">
          <h3 className="settings-section-title">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8 }}>
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
            {t('settings.socketStatus')}
          </h3>

          <div className="settings-status-card">
            <div className="status-row">
              <span className="status-label">{t('settings.socketPath')}</span>
              <span className="status-value">{actualSocketPath || "Loading..."}</span>
            </div>
            <div className="status-row">
              <span className="status-label">{t('settings.connection')}</span>
              <span className={`status-badge status-badge-${socketStatus}`}>
                {socketStatus === "checking" && t('settings.checking')}
                {socketStatus === "connected" && t('settings.connected')}
                {socketStatus === "disconnected" && t('settings.disconnected')}
              </span>
            </div>
            {socketStatus === "connected" && socketInfo.containers !== undefined && (
              <>
                <div className="status-row">
                  <span className="status-label">{t('settings.containers')}</span>
                  <span className="status-value">{socketInfo.containers}</span>
                </div>
                <div className="status-row">
                  <span className="status-label">{t('settings.images')}</span>
                  <span className="status-value">{socketInfo.images}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Socktainer Section */}
        <div className="settings-section">
          <h3 className="settings-section-title">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8 }}>
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
            {t('settings.socktainer')}
          </h3>

          <div className="settings-item">
            <div className="settings-item-info">
              <label className="settings-label">{t('settings.useSocktainer')}</label>
              <p className="settings-description">
                {socktainerInstalled
                  ? t('settings.useSocktainerDesc')
                  : t('settings.useSocktainerOptional')}
              </p>
            </div>
            {socktainerInstalled ? (
              <div className="settings-input-group">
                {socktainerRunning ? (
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={handleStopSocktainer}
                    disabled={socktainerLoading}
                  >
                    {socktainerLoading ? t('settings.stopping') : t('settings.stopSocktainer')}
                  </button>
                ) : (
                  <button
                    className="btn btn-success btn-sm"
                    onClick={handleStartSocktainer}
                    disabled={socktainerLoading}
                  >
                    {socktainerLoading ? t('settings.starting') : t('settings.startSocktainer')}
                  </button>
                )}
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={settings.useSocktainer && socktainerRunning}
                    onChange={(e) => {
                      if (e.target.checked) {
                        handleStartSocktainer();
                      } else {
                        handleStopSocktainer();
                      }
                    }}
                    disabled={!socktainerRunning}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>
            ) : (
              <div className="settings-input-group">
                <span className="status-badge status-badge-disconnected">{t('settings.notInstalled')}</span>
              </div>
            )}
          </div>

          {!socktainerInstalled && (
            <div className="socktainer-install-hint">
              <div className="socktainer-hint-icon">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              </div>
              <div className="socktainer-hint-content">
                <p className="socktainer-hint-text">
                  {t('settings.socktainerDesc1')}
                </p>
                <p className="socktainer-hint-text">
                  {t('settings.socktainerDesc2')}
                </p>
                <a
                  href="https://socktainer.github.io/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="socktainer-install-link"
                >
                  https://socktainer.github.io/
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: 4 }}>
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>
              </div>
            </div>
          )}

          {socktainerInstalled && (
            <div className="settings-status-card" style={{ marginTop: 12 }}>
              <div className="status-row">
                <span className="status-label">{t('settings.status')}</span>
                <span className={`status-badge ${socktainerRunning ? "status-badge-connected" : "status-badge-disconnected"}`}>
                  {socktainerRunning ? t('settings.running') : t('settings.stopped')}
                </span>
              </div>
              <div className="status-row">
                <span className="status-label">{t('settings.socketPath')}</span>
                <span className="status-value">/Users/yan.yang/.socktainer/container.sock</span>
              </div>
              <div className="status-row">
                <span className="status-label">{t('settings.apiVersion')}</span>
                <span className="status-value">v1.51 (full Docker Engine API)</span>
              </div>
            </div>
          )}
        </div>

        {/* Docker Command Reference */}
        <div className="settings-section">
          <h3 className="settings-section-title">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8 }}>
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
            {t('settings.dockerCommandTranslation')}
          </h3>

          <div className="settings-reference">
            <table className="settings-table">
              <thead>
                <tr>
                  <th>{t('settings.dockerCommand')}</th>
                  <th>{t('settings.appleContainerCommand')}</th>
                </tr>
              </thead>
              <tbody>
                <tr><td><code>docker ps</code></td><td><code>container ls</code></td></tr>
                <tr><td><code>docker run</code></td><td><code>container run</code></td></tr>
                <tr><td><code>docker stop</code></td><td><code>container stop</code></td></tr>
                <tr><td><code>docker start</code></td><td><code>container start</code></td></tr>
                <tr><td><code>docker rm</code></td><td><code>container rm</code></td></tr>
                <tr><td><code>docker images</code></td><td><code>container image ls</code></td></tr>
                <tr><td><code>docker pull</code></td><td><code>container image pull</code></td></tr>
                <tr><td><code>docker build</code></td><td><code>container build</code></td></tr>
                <tr><td><code>docker exec</code></td><td><code>container exec</code></td></tr>
                <tr><td><code>docker logs</code></td><td><code>container logs</code></td></tr>
                <tr><td><code>docker inspect</code></td><td><code>container inspect</code></td></tr>
                <tr><td><code>docker volume</code></td><td><code>container volume</code></td></tr>
                <tr><td><code>docker network</code></td><td><code>container network</code></td></tr>
                <tr><td><code>docker system</code></td><td><code>container system</code></td></tr>
                <tr><td><code>docker info</code></td><td><code>container system df</code></td></tr>
                <tr><td><code>docker version</code></td><td><code>container --version</code></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Actions */}
        <div className="settings-actions">
          <button className="btn btn-secondary" onClick={handleResetSettings}>
            {t('settings.resetToDefaults')}
          </button>
        </div>
      </div>
    </div>
  );
}
