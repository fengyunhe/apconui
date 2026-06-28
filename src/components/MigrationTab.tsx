import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import type { CommandResult, Image, Volume, Container, MigrationManifest } from "../types";
import { open } from "@tauri-apps/plugin-dialog";

interface MigrationTabProps {
  images: Image[];
  volumes: Volume[];
  containers: Container[];
  loading: boolean;
  onRefresh: () => void;
}

type MigrationMode = "idle" | "export-select" | "export-progress" | "export-complete" | "import-select" | "import-progress" | "import-complete" | "docker-import";

interface ExportState {
  selectedImages: Set<string>;
  selectedVolumes: Set<string>;
  selectedContainers: Set<string>;
  outputDir: string;
  progress: { current: string; completed: number; total: number };
  result: { success: boolean; message: string; errors: string[] } | null;
}

interface ImportState {
  inputDir: string;
  manifest: MigrationManifest | null;
  importImages: boolean;
  importVolumes: boolean;
  importContainers: boolean;
  progress: { current: string; completed: number; total: number };
  result: { success: boolean; message: string; errors: string[] } | null;
}

interface DockerResource {
  name: string;
  size?: string;
  tag?: string;
}

interface DockerContainer {
  id: string;
  image: string;
  names: string;
  state: string;
  status: string;
}

interface DockerImportState {
  images: DockerResource[];
  volumes: DockerResource[];
  containers: DockerContainer[];
  volumeUsage: Record<string, string[]>;
  selectedImages: Set<string>;
  selectedVolumes: Set<string>;
  selectedContainers: Set<string>;
  loading: boolean;
  importing: boolean;
  progress: { current: string; completed: number; total: number };
  result: { success: boolean; message: string; errors: string[] } | null;
}

export function MigrationTab({ images, volumes, containers, onRefresh }: MigrationTabProps) {
  const { t } = useTranslation();

  const [mode, setMode] = useState<MigrationMode>("idle");
  const [exportState, setExportState] = useState<ExportState>({
    selectedImages: new Set(),
    selectedVolumes: new Set(),
    selectedContainers: new Set(),
    outputDir: "",
    progress: { current: "", completed: 0, total: 0 },
    result: null,
  });
  const [importState, setImportState] = useState<ImportState>({
    inputDir: "",
    manifest: null,
    importImages: true,
    importVolumes: true,
    importContainers: true,
    progress: { current: "", completed: 0, total: 0 },
    result: null,
  });

  const [dockerState, setDockerState] = useState<DockerImportState>({
    images: [],
    volumes: [],
    containers: [],
    volumeUsage: {},
    selectedImages: new Set(),
    selectedVolumes: new Set(),
    selectedContainers: new Set(),
    loading: false,
    importing: false,
    progress: { current: "", completed: 0, total: 0 },
    result: null,
  });

  const [dockerFilter, setDockerFilter] = useState("");

  const loadDockerResources = useCallback(async () => {
    setDockerState(prev => ({ ...prev, loading: true, images: [], volumes: [], containers: [], volumeUsage: {} }));
    try {
      const result = await invoke<CommandResult>("docker_list_all");

      if (result.success && result.stdout.trim()) {
        const data = JSON.parse(result.stdout);
        const images: DockerResource[] = Array.isArray(data.images)
          ? data.images.map((obj: Record<string, string>) => ({
              name: obj.Repository || "",
              tag: obj.Tag || "latest",
              size: obj.Size || "",
            }))
          : [];
        const volumes: DockerResource[] = Array.isArray(data.volumes)
          ? data.volumes.map((obj: Record<string, string>) => ({
              name: obj.Name || "",
              size: obj.Size || "",
            }))
          : [];
        const containers: DockerContainer[] = Array.isArray(data.containers)
          ? data.containers.map((obj: Record<string, string | string[]>) => ({
              id: obj.ID || "",
              image: obj.Image || "",
              names: obj.Names || "",
              state: obj.State || "",
              status: obj.Status || "",
            }))
          : [];
        const volumeUsage: Record<string, string[]> = data.volumeUsage || {};

        setDockerState(prev => ({
          ...prev,
          images,
          volumes,
          containers,
          volumeUsage,
          loading: false,
          selectedImages: new Set(),
          selectedVolumes: new Set(),
          selectedContainers: new Set(),
        }));
      } else {
        setDockerState(prev => ({ ...prev, loading: false }));
      }
    } catch (e) {
      console.error("Failed to load Docker resources:", e);
      setDockerState(prev => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    if (mode === "docker-import") {
      loadDockerResources();
    }
  }, [mode, loadDockerResources]);

  const handleExportSelect = () => {
    setExportState({
      selectedImages: new Set(),
      selectedVolumes: new Set(),
      selectedContainers: new Set(),
      outputDir: "",
      progress: { current: "", completed: 0, total: 0 },
      result: null,
    });
    setMode("export-select");
  };

  const handleImportSelect = () => {
    setImportState({
      inputDir: "",
      manifest: null,
      importImages: true,
      importVolumes: true,
      importContainers: true,
      progress: { current: "", completed: 0, total: 0 },
      result: null,
    });
    setMode("import-select");
  };

  const handleDockerImport = () => {
    setDockerState({
      images: [],
      volumes: [],
      containers: [],
      volumeUsage: {},
      selectedImages: new Set(),
      selectedVolumes: new Set(),
      selectedContainers: new Set(),
      loading: false,
      importing: false,
      progress: { current: "", completed: 0, total: 0 },
      result: null,
    });
    setDockerFilter("");
    setMode("docker-import");
  };

  const toggleDockerImageSelection = (name: string) => {
    setDockerState(prev => {
      const next = new Set(prev.selectedImages);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return { ...prev, selectedImages: next };
    });
  };

  const toggleDockerVolumeSelection = (name: string) => {
    setDockerState(prev => {
      const next = new Set(prev.selectedVolumes);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return { ...prev, selectedVolumes: next };
    });
  };

  const selectAllDockerImages = () => {
    setDockerState(prev => {
      const list = dockerFilter ? filteredDockerImages : prev.images;
      const allSelected = list.length > 0 && list.every(i => prev.selectedImages.has(`${i.name}:${i.tag}`));
      const next = new Set<string>(prev.selectedImages);
      for (const i of list) {
        const key = `${i.name}:${i.tag}`;
        if (allSelected) next.delete(key);
        else next.add(key);
      }
      return { ...prev, selectedImages: next };
    });
  };

  const selectAllDockerVolumes = () => {
    setDockerState(prev => {
      const list = dockerFilter ? filteredDockerVolumes : prev.volumes;
      const allSelected = list.length > 0 && list.every(v => prev.selectedVolumes.has(v.name));
      const next = new Set<string>(prev.selectedVolumes);
      for (const v of list) {
        if (allSelected) next.delete(v.name);
        else next.add(v.name);
      }
      return { ...prev, selectedVolumes: next };
    });
  };

  const selectAllDockerContainers = () => {
    setDockerState(prev => {
      const list = dockerFilter ? filteredDockerContainers : prev.containers;
      const allSelected = list.length > 0 && list.every(c => prev.selectedContainers.has(c.id));
      const next = new Set<string>(prev.selectedContainers);
      for (const c of list) {
        if (allSelected) next.delete(c.id);
        else next.add(c.id);
      }
      return { ...prev, selectedContainers: next };
    });
  };

  const toggleDockerContainerSelection = (id: string) => {
    setDockerState(prev => {
      const next = new Set(prev.selectedContainers);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, selectedContainers: next };
    });
  };

  const handleStartDockerImport = async () => {
    const total = dockerState.selectedImages.size + dockerState.selectedVolumes.size + dockerState.selectedContainers.size;
    if (total === 0) return;

    setDockerState(prev => ({ ...prev, importing: true, progress: { current: "", completed: 0, total } }));
    const errors: string[] = [];
    let completed = 0;

    // Import images
    for (const ref of dockerState.selectedImages) {
      setDockerState(prev => ({
        ...prev,
        progress: { current: `Importing image ${ref}`, completed, total },
      }));
      try {
        const result = await invoke<CommandResult>("import_docker_image", { reference: ref });
        if (!result.success) {
          errors.push(`Image ${ref}: ${result.stderr}`);
        }
      } catch (e) {
        errors.push(`Image ${ref}: ${String(e)}`);
      }
      completed++;
    }

    // Import volumes
    for (const name of dockerState.selectedVolumes) {
      setDockerState(prev => ({
        ...prev,
        progress: { current: `Importing volume ${name}`, completed, total },
      }));
      try {
        const result = await invoke<CommandResult>("import_docker_volume", { name });
        if (!result.success) {
          errors.push(`Volume ${name}: ${result.stderr}`);
        }
      } catch (e) {
        errors.push(`Volume ${name}: ${String(e)}`);
      }
      completed++;
    }

    // Import containers (import image first, then create container with config)
    for (const cid of dockerState.selectedContainers) {
      const c = dockerState.containers.find(ct => ct.id === cid);
      if (!c) { completed++; continue; }
      setDockerState(prev => ({
        ...prev,
        progress: { current: `Importing container ${c.names || c.id.substring(0, 12)}`, completed, total },
      }));
      try {
        const result = await invoke<CommandResult>("import_docker_container", {
          id: c.id,
          image: c.image,
        });
        if (!result.success) {
          errors.push(`Container ${c.names || c.id}: ${result.stderr}`);
        }
      } catch (e) {
        errors.push(`Container ${c.names || c.id}: ${String(e)}`);
      }
      completed++;
    }

    setDockerState(prev => ({
      ...prev,
      importing: false,
      progress: { current: "", completed: total, total },
      result: {
        success: errors.length === 0,
        message: errors.length === 0
          ? `Imported ${dockerState.selectedImages.size} images, ${dockerState.selectedVolumes.size} volumes, ${dockerState.selectedContainers.size} containers from Docker`
          : `Imported with errors`,
        errors,
      },
    }));
    onRefresh();
  };

  const handleChooseOutputDir = async () => {
    const selected = await open({ directory: true });
    if (selected) {
      setExportState(prev => ({ ...prev, outputDir: selected as string }));
    }
  };

  const handleChooseInputDir = async () => {
    const selected = await open({ directory: true });
    if (selected) {
      const dir = selected as string;
      setImportState(prev => ({ ...prev, inputDir: dir }));

      // Try to read manifest
      try {
        const result = await invoke<CommandResult>("run_raw_command", {
          command: `cat "${dir}/manifest.json"`,
        });
        if (result.success) {
          const manifest = JSON.parse(result.stdout) as MigrationManifest;
          setImportState(prev => ({ ...prev, manifest }));
        }
      } catch {
        // Manifest not found or invalid
      }
    }
  };

  const handleStartExport = async () => {
    if (!exportState.outputDir) return;

    setMode("export-progress");
    const total = exportState.selectedImages.size + exportState.selectedVolumes.size + exportState.selectedContainers.size;
    setExportState(prev => ({
      ...prev,
      progress: { current: t('migration.exporting'), completed: 0, total },
    }));

    try {
      const result = await invoke<CommandResult>("export_migration", {
        images: Array.from(exportState.selectedImages),
        volumes: Array.from(exportState.selectedVolumes),
        containers: Array.from(exportState.selectedContainers),
        outputDir: exportState.outputDir,
      });

      setExportState(prev => ({
        ...prev,
        progress: { current: "", completed: total, total },
        result: {
          success: result.success,
          message: result.stdout,
          errors: result.stderr ? result.stderr.split("\n").filter(Boolean) : [],
        },
      }));
      setMode("export-complete");
    } catch (e) {
      setExportState(prev => ({
        ...prev,
        result: {
          success: false,
          message: String(e),
          errors: [],
        },
      }));
      setMode("export-complete");
    }
  };

  const handleStartImport = async () => {
    if (!importState.inputDir) return;

    setMode("import-progress");
    const total = (importState.importImages ? (importState.manifest?.images.length || 0) : 0) +
                  (importState.importVolumes ? (importState.manifest?.volumes.length || 0) : 0) +
                  (importState.importContainers ? (importState.manifest?.containers.length || 0) : 0);
    setImportState(prev => ({
      ...prev,
      progress: { current: t('migration.importing'), completed: 0, total },
    }));

    try {
      const result = await invoke<CommandResult>("import_migration", {
        inputDir: importState.inputDir,
        importImages: importState.importImages,
        importVolumes: importState.importVolumes,
        importContainers: importState.importContainers,
      });

      setImportState(prev => ({
        ...prev,
        progress: { current: "", completed: total, total },
        result: {
          success: result.success,
          message: result.stdout,
          errors: result.stderr ? result.stderr.split("\n").filter(Boolean) : [],
        },
      }));
      setMode("import-complete");
    } catch (e) {
      setImportState(prev => ({
        ...prev,
        result: {
          success: false,
          message: String(e),
          errors: [],
        },
      }));
      setMode("import-complete");
    }
  };

  const toggleImageSelection = (name: string) => {
    setExportState(prev => {
      const next = new Set(prev.selectedImages);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return { ...prev, selectedImages: next };
    });
  };

  const toggleVolumeSelection = (name: string) => {
    setExportState(prev => {
      const next = new Set(prev.selectedVolumes);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return { ...prev, selectedVolumes: next };
    });
  };

  const selectAllImages = () => {
    setExportState(prev => ({
      ...prev,
      selectedImages: new Set(images.map(i => i.name)),
    }));
  };

  const selectAllVolumes = () => {
    setExportState(prev => ({
      ...prev,
      selectedVolumes: new Set(volumes.map(v => v.name)),
    }));
  };

  const toggleContainerSelection = (id: string) => {
    setExportState(prev => {
      const next = new Set(prev.selectedContainers);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { ...prev, selectedContainers: next };
    });
  };

  const selectAllContainers = () => {
    setExportState(prev => ({
      ...prev,
      selectedContainers: new Set(containers.map(c => c.id)),
    }));
  };

  const formatSize = (bytes: number) => {
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${bytes} B`;
  };

  // Idle state - show export/import buttons
  if (mode === "idle") {
    return (
      <div className="tab-content">
        <div className="tab-header">
          <h2>{t('migration.title')}</h2>
        </div>
        <div className="migration-options">
          <div className="migration-card" onClick={handleExportSelect}>
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            <h3>{t('migration.export')}</h3>
            <p>{t('migration.selectResources')}</p>
          </div>
          <div className="migration-card" onClick={handleImportSelect}>
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
            <h3>{t('migration.import')}</h3>
            <p>{t('migration.importFrom')}</p>
          </div>
          <div className="migration-card" onClick={handleDockerImport}>
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
            <h3>{t('migration.importFromDocker')}</h3>
            <p>{t('migration.dockerToApple')}</p>
          </div>
        </div>
      </div>
    );
  }

  // Export select state
  if (mode === "export-select") {
    return (
      <div className="tab-content">
        <div className="tab-header">
          <h2>{t('migration.export')} - {t('migration.selectResources')}</h2>
          <div className="tab-actions">
            <button className="btn btn-secondary" onClick={() => setMode("idle")}>{t('migration.back')}</button>
            <button
              className="btn btn-primary"
              onClick={handleStartExport}
              disabled={!exportState.outputDir || (exportState.selectedImages.size === 0 && exportState.selectedVolumes.size === 0)}
            >
              {t('migration.startExport')}
            </button>
          </div>
        </div>

        <div className="migration-export-form">
          <div className="migration-field">
            <label>{t('migration.exportTo')}</label>
            <div className="migration-dir-select">
              <input
                type="text"
                value={exportState.outputDir}
                readOnly
                placeholder={t('migration.chooseDir')}
              />
              <button className="btn btn-secondary" onClick={handleChooseOutputDir}>
                {t('migration.chooseDir')}
              </button>
            </div>
          </div>

          <div className="migration-section">
            <div className="migration-section-header">
              <h3>{t('migration.selectImages')} ({exportState.selectedImages.size}/{images.length})</h3>
              <button className="btn btn-xs btn-secondary" onClick={selectAllImages}>{t('containers.refresh')}</button>
            </div>
            {images.length === 0 ? (
              <p className="migration-empty">{t('migration.noImages')}</p>
            ) : (
              <div className="migration-list">
                {images.map(img => (
                  <label key={img.name} className="migration-item">
                    <input
                      type="checkbox"
                      checked={exportState.selectedImages.has(img.name)}
                      onChange={() => toggleImageSelection(img.name)}
                    />
                    <span className="migration-item-name">{img.name}</span>
                    <span className="migration-item-size">{img.size}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="migration-section">
            <div className="migration-section-header">
              <h3>{t('migration.selectVolumes')} ({exportState.selectedVolumes.size}/{volumes.length})</h3>
              <button className="btn btn-xs btn-secondary" onClick={selectAllVolumes}>{t('containers.refresh')}</button>
            </div>
            {volumes.length === 0 ? (
              <p className="migration-empty">{t('migration.noVolumes')}</p>
            ) : (
              <div className="migration-list">
                {volumes.map(vol => (
                  <label key={vol.name} className="migration-item">
                    <input
                      type="checkbox"
                      checked={exportState.selectedVolumes.has(vol.name)}
                      onChange={() => toggleVolumeSelection(vol.name)}
                    />
                    <span className="migration-item-name">{vol.name}</span>
                    <span className="migration-item-size">{vol.size || "-"}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="migration-section">
            <div className="migration-section-header">
              <h3>{t('containers.title')} ({exportState.selectedContainers.size}/{containers.length})</h3>
              <button className="btn btn-xs btn-secondary" onClick={selectAllContainers}>{t('containers.refresh')}</button>
            </div>
            {containers.length === 0 ? (
              <p className="migration-empty">{t('containers.noContainers')}</p>
            ) : (
              <div className="migration-list">
                {containers.map(c => (
                  <label key={c.id} className="migration-item">
                    <input
                      type="checkbox"
                      checked={exportState.selectedContainers.has(c.id)}
                      onChange={() => toggleContainerSelection(c.id)}
                    />
                    <span className="migration-item-name">{c.id.substring(0, 12)}</span>
                    <span className="migration-item-size">{c.image}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Export progress state
  if (mode === "export-progress") {
    return (
      <div className="tab-content">
        <div className="tab-header">
          <h2>{t('migration.export')} - {t('migration.progress')}</h2>
        </div>
        <div className="migration-progress">
          <div className="migration-progress-bar">
            <div
              className="migration-progress-fill"
              style={{ width: `${exportState.progress.total > 0 ? (exportState.progress.completed / exportState.progress.total) * 100 : 0}%` }}
            />
          </div>
          <p>{exportState.progress.current} {exportState.progress.completed} {t('migration.of')} {exportState.progress.total}</p>
        </div>
      </div>
    );
  }

  // Export complete state
  if (mode === "export-complete") {
    return (
      <div className="tab-content">
        <div className="tab-header">
          <h2>{t('migration.export')} - {t('migration.complete')}</h2>
          <div className="tab-actions">
            <button className="btn btn-secondary" onClick={() => setMode("idle")}>{t('migration.close')}</button>
          </div>
        </div>
        <div className="migration-result">
          <div className={`migration-result-status ${exportState.result?.success ? "success" : "error"}`}>
            {exportState.result?.success ? t('migration.exportComplete') : t('migration.errors')}
          </div>
          <p>{exportState.result?.message}</p>
          {exportState.result?.errors && exportState.result.errors.length > 0 && (
            <div className="migration-errors">
              <h4>{t('migration.errors')}</h4>
              <ul>
                {exportState.result.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Import select state
  if (mode === "import-select") {
    return (
      <div className="tab-content">
        <div className="tab-header">
          <h2>{t('migration.import')} - {t('migration.selectResources')}</h2>
          <div className="tab-actions">
            <button className="btn btn-secondary" onClick={() => setMode("idle")}>{t('migration.back')}</button>
            <button
              className="btn btn-primary"
              onClick={handleStartImport}
              disabled={!importState.inputDir}
            >
              {t('migration.startImport')}
            </button>
          </div>
        </div>

        <div className="migration-import-form">
          <div className="migration-field">
            <label>{t('migration.importFrom')}</label>
            <div className="migration-dir-select">
              <input
                type="text"
                value={importState.inputDir}
                readOnly
                placeholder={t('migration.chooseDir')}
              />
              <button className="btn btn-secondary" onClick={handleChooseInputDir}>
                {t('migration.chooseDir')}
              </button>
            </div>
          </div>

          {importState.manifest && (
            <div className="migration-manifest">
              <h3>{t('migration.summary')}</h3>
              <p>{t('migration.imagesImported')}: {importState.manifest.images.length}</p>
              <p>{t('migration.volumesImported')}: {importState.manifest.volumes.length}</p>
              {importState.manifest.containers && (
                <p>{t('containers.title')}: {importState.manifest.containers.length}</p>
              )}

              <div className="migration-section">
                <label className="migration-item">
                  <input
                    type="checkbox"
                    checked={importState.importImages}
                    onChange={(e) => setImportState(prev => ({ ...prev, importImages: e.target.checked }))}
                  />
                  <span>{t('migration.selectImages')}</span>
                </label>
                {importState.importImages && (
                  <div className="migration-list">
                    {importState.manifest.images.map(img => (
                      <div key={img.name} className="migration-item">
                        <span className="migration-item-name">{img.name}</span>
                        <span className="migration-item-size">{formatSize(img.size)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="migration-section">
                <label className="migration-item">
                  <input
                    type="checkbox"
                    checked={importState.importVolumes}
                    onChange={(e) => setImportState(prev => ({ ...prev, importVolumes: e.target.checked }))}
                  />
                  <span>{t('migration.selectVolumes')}</span>
                </label>
                {importState.importVolumes && (
                  <div className="migration-list">
                    {importState.manifest.volumes.map(vol => (
                      <div key={vol.name} className="migration-item">
                        <span className="migration-item-name">{vol.name}</span>
                        <span className="migration-item-size">{formatSize(vol.size)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {importState.manifest.containers && importState.manifest.containers.length > 0 && (
                <div className="migration-section">
                  <label className="migration-item">
                    <input
                      type="checkbox"
                      checked={importState.importContainers}
                      onChange={(e) => setImportState(prev => ({ ...prev, importContainers: e.target.checked }))}
                    />
                    <span>{t('containers.title')}</span>
                  </label>
                  {importState.importContainers && (
                    <div className="migration-list">
                      {importState.manifest.containers.map(c => (
                        <div key={c.id} className="migration-item">
                          <span className="migration-item-name">{c.name}</span>
                          <span className="migration-item-size">{formatSize(c.config_size + c.filesystem_size)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {importState.inputDir && !importState.manifest && (
            <div className="migration-no-manifest">
              <p>{t('migration.errors')}: manifest.json not found or invalid</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Import progress state
  if (mode === "import-progress") {
    return (
      <div className="tab-content">
        <div className="tab-header">
          <h2>{t('migration.import')} - {t('migration.progress')}</h2>
        </div>
        <div className="migration-progress">
          <div className="migration-progress-bar">
            <div
              className="migration-progress-fill"
              style={{ width: `${importState.progress.total > 0 ? (importState.progress.completed / importState.progress.total) * 100 : 0}%` }}
            />
          </div>
          <p>{importState.progress.current} {importState.progress.completed} {t('migration.of')} {importState.progress.total}</p>
        </div>
      </div>
    );
  }

  // Import complete state
  if (mode === "import-complete") {
    return (
      <div className="tab-content">
        <div className="tab-header">
          <h2>{t('migration.import')} - {t('migration.complete')}</h2>
          <div className="tab-actions">
            <button className="btn btn-secondary" onClick={() => setMode("idle")}>{t('migration.close')}</button>
          </div>
        </div>
        <div className="migration-result">
          <div className={`migration-result-status ${importState.result?.success ? "success" : "error"}`}>
            {importState.result?.success ? t('migration.importComplete') : t('migration.errors')}
          </div>
          <p>{importState.result?.message}</p>
          {importState.result?.errors && importState.result.errors.length > 0 && (
            <div className="migration-errors">
              <h4>{t('migration.errors')}</h4>
              <ul>
                {importState.result.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Docker import state
  const dockerFilterLower = dockerFilter.toLowerCase();
  const filteredDockerImages = dockerFilter
    ? dockerState.images.filter(i => `${i.name}:${i.tag}`.toLowerCase().includes(dockerFilterLower))
    : dockerState.images;
  const filteredDockerVolumes = dockerFilter
    ? dockerState.volumes.filter(v => v.name.toLowerCase().includes(dockerFilterLower))
    : dockerState.volumes;
  const filteredDockerContainers = dockerFilter
    ? dockerState.containers.filter(c => c.id.toLowerCase().includes(dockerFilterLower) || c.names.toLowerCase().includes(dockerFilterLower) || c.image.toLowerCase().includes(dockerFilterLower))
    : dockerState.containers;

  if (mode === "docker-import") {
    return (
      <div className="tab-content">
        <div className="tab-header">
          <h2>{t('migration.importFromDocker')}</h2>
          <div className="tab-actions">
            <input
              type="text"
              className="filter-input"
              placeholder={t('images.filterPlaceholder')}
              value={dockerFilter}
              onChange={(e) => setDockerFilter(e.target.value)}
            />
            <button className="btn btn-secondary" onClick={() => setMode("idle")}>{t('migration.back')}</button>
            {!dockerState.importing && (
              <button
                className="btn btn-primary"
                onClick={handleStartDockerImport}
                disabled={dockerState.selectedImages.size === 0 && dockerState.selectedVolumes.size === 0 && dockerState.selectedContainers.size === 0}
              >
                {t('migration.startImport')} {dockerState.selectedImages.size + dockerState.selectedVolumes.size + dockerState.selectedContainers.size > 0
                  ? `(${dockerState.selectedImages.size + dockerState.selectedVolumes.size + dockerState.selectedContainers.size})`
                  : ""}
              </button>
            )}
            <button className="btn btn-secondary" onClick={loadDockerResources} disabled={dockerState.loading}>
              {t('containers.refresh')}
            </button>
          </div>
        </div>

        {dockerState.loading && (
          <div className="migration-progress">
            <p>{t('migration.loadingDocker')}</p>
          </div>
        )}

        {dockerState.importing && (
          <div className="migration-progress">
            <div className="migration-progress-bar">
              <div
                className="migration-progress-fill"
                style={{ width: `${dockerState.progress.total > 0 ? (dockerState.progress.completed / dockerState.progress.total) * 100 : 0}%` }}
              />
            </div>
            <p>{dockerState.progress.current}</p>
          </div>
        )}

        {dockerState.result && (
          <div className="migration-result">
            <div className={`migration-result-status ${dockerState.result.success ? "success" : "error"}`}>
              {dockerState.result.success ? t('migration.importComplete') : t('migration.errors')}
            </div>
            <p>{dockerState.result.message}</p>
            {dockerState.result.errors.length > 0 && (
              <div className="migration-errors">
                <h4>{t('migration.errors')}</h4>
                <ul>
                  {dockerState.result.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {!dockerState.loading && !dockerState.importing && !dockerState.result && (
          <div className="docker-import-scroll">
            {/* Images Section */}
            <h3 className="migration-section-title">{t('migration.dockerImages')} ({dockerState.selectedImages.size}/{dockerState.images.length})</h3>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>
                        <input
                          type="checkbox"
                          checked={filteredDockerImages.length > 0 && filteredDockerImages.every(i => dockerState.selectedImages.has(`${i.name}:${i.tag}`))}
                          onChange={() => selectAllDockerImages()}
                        />
                    </th>
                    <th>{t('images.repository')}</th>
                    <th>{t('images.tag')}</th>
                    <th>{t('images.size')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDockerImages.length === 0 ? (
                    <tr><td colSpan={4} className="empty-row">{dockerFilter ? t('containers.noMatch') : t('migration.noDockerImages')}</td></tr>
                  ) : (
                    filteredDockerImages.map(img => (
                      <tr key={`${img.name}:${img.tag}`}>
                        <td>
                          <input
                            type="checkbox"
                            checked={dockerState.selectedImages.has(`${img.name}:${img.tag}`)}
                            onChange={() => toggleDockerImageSelection(`${img.name}:${img.tag}`)}
                          />
                        </td>
                        <td>{img.name}</td>
                        <td><span className="tag-badge">{img.tag}</span></td>
                        <td>{img.size || "-"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Volumes Section */}
            <h3 className="migration-section-title">{t('migration.dockerVolumes')} ({dockerState.selectedVolumes.size}/{dockerState.volumes.length})</h3>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>
                        <input
                          type="checkbox"
                          checked={filteredDockerVolumes.length > 0 && filteredDockerVolumes.every(v => dockerState.selectedVolumes.has(v.name))}
                          onChange={() => selectAllDockerVolumes()}
                        />
                    </th>
                    <th>{t('volumes.name')}</th>
                    <th>{t('volumes.driver')}</th>
                    <th>{t('images.size')}</th>
                    <th>{t('containers.title')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDockerVolumes.length === 0 ? (
                    <tr><td colSpan={4} className="empty-row">{dockerFilter ? t('containers.noMatch') : t('migration.noDockerVolumes')}</td></tr>
                  ) : (
                    filteredDockerVolumes.map(vol => {
                      const usedBy = dockerState.volumeUsage[vol.name] || [];
                      return (
                        <tr key={vol.name}>
                          <td>
                            <input
                              type="checkbox"
                              checked={dockerState.selectedVolumes.has(vol.name)}
                              onChange={() => toggleDockerVolumeSelection(vol.name)}
                            />
                          </td>
                          <td>{vol.name}</td>
                          <td>{"local"}</td>
                          <td>{vol.size || "-"}</td>
                          <td className="cell-digest">{usedBy.length > 0 ? usedBy.join(", ") : "-"}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Containers Section */}
            <h3 className="migration-section-title">{t('migration.dockerContainers')} ({dockerState.selectedContainers.size}/{dockerState.containers.length})</h3>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>
                        <input
                          type="checkbox"
                          checked={filteredDockerContainers.length > 0 && filteredDockerContainers.every(c => dockerState.selectedContainers.has(c.id))}
                          onChange={() => selectAllDockerContainers()}
                        />
                    </th>
                    <th>{t('containers.id')}</th>
                    <th>Name</th>
                    <th>{t('containers.image')}</th>
                    <th>{t('containers.state')}</th>
                    <th>{t('containers.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDockerContainers.length === 0 ? (
                    <tr><td colSpan={6} className="empty-row">{dockerFilter ? t('containers.noMatch') : t('migration.noDockerContainers')}</td></tr>
                  ) : (
                    filteredDockerContainers.map(c => (
                      <tr key={c.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={dockerState.selectedContainers.has(c.id)}
                            onChange={() => toggleDockerContainerSelection(c.id)}
                          />
                        </td>
                        <td className="cell-digest">{c.id.substring(0, 12)}</td>
                        <td>{c.names || "-"}</td>
                        <td>{c.image}</td>
                        <td>{c.state || "-"}</td>
                        <td>{c.status}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}
