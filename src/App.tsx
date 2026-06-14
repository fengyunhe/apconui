import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

type Tab = "containers" | "images" | "volumes" | "networks" | "machines";

interface RawContainer {
  configuration: {
    id: string;
    image: { reference: string };
    platform: { os: string; architecture: string };
  };
  status: {
    state: string;
    networks?: Array<{ ipv4Address?: string }>;
  };
}

interface Container {
  id: string;
  image: string;
  os: string;
  arch: string;
  state: string;
  ip: string;
  stats?: ContainerStats;
}

interface RawImage {
  configuration: {
    name: string;
    creationDate?: string;
    descriptor?: { size?: number };
  };
  id: string;
  variants?: Array<{
    size?: number;
    platform?: { architecture?: string; os?: string };
    config?: { config?: { Cmd?: string[]; Entrypoint?: string[] } };
  }>;
}

interface Image {
  name: string;
  tag: string;
  digest: string;
  size: string;
  created?: string;
  architectures?: string[];
  cmd?: string[];
}

interface ContainerStats {
  id: string;
  cpuUsageUsec: number;
  memoryUsageBytes: number;
  memoryLimitBytes: number;
  blockReadBytes: number;
  blockWriteBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
  numProcesses: number;
}

interface RawVolume {
  configuration: {
    name: string;
    driver: string;
    source: string;
    sizeInBytes: number;
  };
  id: string;
}

interface Volume {
  name: string;
  driver: string;
  source: string;
  size: string;
}

interface RawNetwork {
  configuration: { name: string };
  status?: { ipv4Subnet?: string };
}

interface Network {
  name: string;
  state: string;
  subnet: string;
}

interface Machine {
  id: string;
  status: string;
  cpus: number;
  memory: number;
  diskSize: number;
  createdDate: string;
  isDefault: boolean;
}

interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

function parseJsonArray<T>(stdout: string): T[] {
  try {
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed)) return parsed;
    return [parsed];
  } catch {
    return [];
  }
}

function mapContainers(raw: RawContainer[]): Container[] {
  return raw.map((c) => {
    const ref = c.configuration.image?.reference || "";
    const ip = c.status.networks?.[0]?.ipv4Address?.split("/")[0] || "";
    return {
      id: c.configuration.id || "",
      image: ref,
      os: c.configuration.platform?.os || "",
      arch: c.configuration.platform?.architecture || "",
      state: c.status.state || "unknown",
      ip,
    };
  });
}

function mapImages(raw: RawImage[]): Image[] {
  return raw.map((img) => {
    const fullName = img.configuration.name || "";
    const lastSlash = fullName.lastIndexOf("/");
    const namePart = lastSlash >= 0 ? fullName.substring(0, lastSlash) : "";
    const tagPart = lastSlash >= 0 ? fullName.substring(lastSlash + 1) : fullName;
    const colonIdx = tagPart.indexOf(":");
    const name = colonIdx >= 0 ? tagPart.substring(0, colonIdx) : tagPart;
    const tag = colonIdx >= 0 ? tagPart.substring(colonIdx + 1) : "latest";

    let totalSize = 0;
    const archSet = new Set<string>();
    let cmd: string[] | undefined;

    if (img.variants && img.variants.length > 0) {
      for (const v of img.variants) {
        totalSize += v.size || 0;
        if (v.platform?.architecture && v.platform.architecture !== "unknown") {
          archSet.add(v.platform.architecture);
        }
        if (!cmd && v.config?.config?.Cmd && v.config.config.Cmd.length > 0) {
          cmd = v.config.config.Cmd;
        }
      }
    } else {
      totalSize = img.configuration.descriptor?.size || 0;
    }

    return {
      name: namePart ? `${namePart}/${name}` : name,
      tag,
      digest: img.id ? img.id.substring(0, 12) : "",
      size: formatBytes(totalSize),
      created: img.configuration.creationDate?.split("T")[0],
      architectures: archSet.size > 0 ? Array.from(archSet) : undefined,
      cmd,
    };
  });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function mapNetworks(raw: RawNetwork[]): Network[] {
  return raw.map((n) => ({
    name: n.configuration?.name || "",
    state: "running",
    subnet: n.status?.ipv4Subnet || "",
  }));
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("containers");
  const [containers, setContainers] = useState<Container[]>([]);
  const [images, setImages] = useState<Image[]>([]);
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [networks, setNetworks] = useState<Network[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(false);
  const [showRunModal, setShowRunModal] = useState(false);
  const [showBuildModal, setShowBuildModal] = useState(false);
  const [showCreateVolumeModal, setShowCreateVolumeModal] = useState(false);
  const [showCreateNetworkModal, setShowCreateNetworkModal] = useState(false);
  const [showCreateMachineModal, setShowCreateMachineModal] = useState(false);
  const [showPullModal, setShowPullModal] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState<Container | null>(null);

  const [showInspectModal, setShowInspectModal] = useState(false);
  const [inspectData, setInspectData] = useState("");
  const [toastMessage, setToastMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ show: boolean; message: string; onConfirm: () => void }>({ show: false, message: "", onConfirm: () => {} });

  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmDialog({ show: true, message, onConfirm: () => { setConfirmDialog({ show: false, message: "", onConfirm: () => {} }); resolve(true); } });
    });
  }, []);

  const cancelConfirm = useCallback(() => {
    setConfirmDialog({ show: false, message: "", onConfirm: () => {} });
  }, []);

  const showToast = useCallback((type: "success" | "error", text: string) => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3000);
  }, []);

  const refreshContainers = useCallback(async () => {
    try {
      const result = await invoke<CommandResult>("list_containers", { all: true });
      if (result.success && result.stdout.trim()) {
        let parsed = mapContainers(parseJsonArray<RawContainer>(result.stdout));

        const statsResult = await invoke<CommandResult>("get_container_stats", {});
        if (statsResult.success && statsResult.stdout.trim()) {
          const statsArray = parseJsonArray<ContainerStats>(statsResult.stdout);
          const statsMap = new Map<string, ContainerStats>();
          statsArray.forEach(s => statsMap.set(s.id, s));
          parsed = parsed.map(c => ({
            ...c,
            stats: statsMap.get(c.id),
          }));
        }

        setContainers(parsed);
      } else {
        setContainers([]);
      }
    } catch {
      setContainers([]);
    }
  }, []);

  const refreshImages = useCallback(async () => {
    try {
      const result = await invoke<CommandResult>("list_images");
      if (result.success && result.stdout.trim()) {
        setImages(mapImages(parseJsonArray<RawImage>(result.stdout)));
      } else {
        setImages([]);
      }
    } catch {
      setImages([]);
    }
  }, []);

  const refreshVolumes = useCallback(async () => {
    try {
      const result = await invoke<CommandResult>("list_volumes");
      if (result.success && result.stdout.trim()) {
        const raw = parseJsonArray<RawVolume>(result.stdout);
        setVolumes(raw.map((v) => ({
          name: v.configuration?.name || v.id || "",
          driver: v.configuration?.driver || "",
          source: v.configuration?.source || "",
          size: v.configuration?.sizeInBytes ? `${(v.configuration.sizeInBytes / 1073741824).toFixed(1)} GB` : "",
        })));
      } else {
        setVolumes([]);
      }
    } catch {
      setVolumes([]);
    }
  }, []);

  const refreshNetworks = useCallback(async () => {
    try {
      const result = await invoke<CommandResult>("list_networks");
      if (result.success && result.stdout.trim()) {
        setNetworks(mapNetworks(parseJsonArray<RawNetwork>(result.stdout)));
      } else {
        setNetworks([]);
      }
    } catch {
      setNetworks([]);
    }
  }, []);

  const refreshMachines = useCallback(async () => {
    try {
      const result = await invoke<CommandResult>("list_machines");
      if (result.success && result.stdout.trim()) {
        const raw = parseJsonArray<{ id: string; status: string; cpus: number; memory: number; diskSize: number; createdDate: string; default: boolean }>(result.stdout);
        setMachines(raw.map((m) => ({
          id: m.id || "",
          status: m.status || "unknown",
          cpus: m.cpus || 0,
          memory: m.memory || 0,
          diskSize: m.diskSize || 0,
          createdDate: m.createdDate?.split("T")[0] || "",
          isDefault: m.default || false,
        })));
      } else {
        setMachines([]);
      }
    } catch {
      setMachines([]);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshContainers(), refreshImages(), refreshVolumes(), refreshNetworks(), refreshMachines()]);
  }, [refreshContainers, refreshImages, refreshVolumes, refreshNetworks, refreshMachines]);

  useEffect(() => {
    refreshAll();
    const interval = setInterval(refreshAll, 5000);
    return () => clearInterval(interval);
  }, [refreshAll]);

  const handleContainerAction = async (action: string, id: string) => {
    const label = id.substring(0, 12);
    if (action === "delete" && !await confirm(`Delete container ${label}? This cannot be undone.`)) return;
    if (action === "kill" && !await confirm(`Kill container ${label}? This will force-stop it immediately.`)) return;
    if (action === "stop" && !await confirm(`Stop container ${label}?`)) return;
    setLoading(true);
    try {
      let result: CommandResult;
      switch (action) {
        case "stop":
          result = await invoke<CommandResult>("stop_container", { id });
          break;
        case "start":
          result = await invoke<CommandResult>("start_container", { id });
          break;
        case "delete":
          result = await invoke<CommandResult>("delete_container", { id, force: true });
          break;
        case "kill":
          result = await invoke<CommandResult>("kill_container", { id });
          break;
        default:
          return;
      }
      if (result.success) {
        showToast("success", `Container ${action} succeeded`);
        refreshContainers();
      } else {
        showToast("error", result.stderr || `Failed to ${action} container`);
      }
    } catch (e) {
      showToast("error", String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleImageAction = async (action: string, name: string) => {
    if (action === "delete" && !await confirm(`Delete image ${name}?`)) return;
    setLoading(true);
    try {
      let result: CommandResult;
      switch (action) {
        case "delete":
          result = await invoke<CommandResult>("delete_image", { name, force: true });
          break;
        default:
          return;
      }
      if (result.success) {
        showToast("success", `Image ${action} succeeded`);
        refreshImages();
      } else {
        showToast("error", result.stderr || `Failed to ${action} image`);
      }
    } catch (e) {
      showToast("error", String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleVolumeAction = async (action: string, name: string) => {
    if (action === "delete" && !await confirm(`Delete volume ${name}?`)) return;
    setLoading(true);
    try {
      let result: CommandResult;
      switch (action) {
        case "delete":
          result = await invoke<CommandResult>("delete_volume", { name });
          break;
        default:
          return;
      }
      if (result.success) {
        showToast("success", `Volume ${action} succeeded`);
        refreshVolumes();
      } else {
        showToast("error", result.stderr || `Failed to ${action} volume`);
      }
    } catch (e) {
      showToast("error", String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleNetworkAction = async (action: string, name: string) => {
    if (action === "delete" && !await confirm(`Delete network ${name}?`)) return;
    setLoading(true);
    try {
      let result: CommandResult;
      switch (action) {
        case "delete":
          result = await invoke<CommandResult>("delete_network", { name });
          break;
        default:
          return;
      }
      if (result.success) {
        showToast("success", `Network ${action} succeeded`);
        refreshNetworks();
      } else {
        showToast("error", result.stderr || `Failed to ${action} network`);
      }
    } catch (e) {
      showToast("error", String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleMachineAction = async (action: string, name: string) => {
    if (action === "delete" && !await confirm(`Delete machine ${name}? This cannot be undone.`)) return;
    if (action === "stop" && !await confirm(`Stop machine ${name}?`)) return;
    setLoading(true);
    try {
      let result: CommandResult;
      switch (action) {
        case "stop":
          result = await invoke<CommandResult>("stop_machine", { name });
          break;
        case "start":
          result = await invoke<CommandResult>("start_machine", { name });
          break;
        case "delete":
          result = await invoke<CommandResult>("delete_machine", { name, force: true });
          break;
        case "inspect":
          result = await invoke<CommandResult>("inspect_machine", { name });
          if (result.success) {
            try { setInspectData(JSON.stringify(JSON.parse(result.stdout), null, 2)); } catch { setInspectData(result.stdout); }
            setShowInspectModal(true);
          }
          break;
        default:
          return;
      }
      if (result.success) {
        showToast("success", `Machine ${action} succeeded`);
        refreshMachines();
      } else {
        showToast("error", result.stderr || `Failed to ${action} machine`);
      }
    } catch (e) {
      showToast("error", String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleLogs = async (id: string) => {
    try {
      const result = await invoke<CommandResult>("open_container_logs", { id });
      if (result.success) {
        showToast("success", "Logs opened in Terminal");
      } else {
        showToast("error", result.stderr);
      }
    } catch (e) {
      showToast("error", String(e));
    }
  };

  const handleInspect = async (id: string) => {
    setLoading(true);
    try {
      const result = await invoke<CommandResult>("inspect_container", { id });
      if (result.success) {
        try {
          const parsed = JSON.parse(result.stdout);
          setInspectData(JSON.stringify(parsed, null, 2));
        } catch {
          setInspectData(result.stdout);
        }
        setSelectedContainer(containers.find(c => c.id === id) || null);
        setShowInspectModal(true);
      } else {
        showToast("error", result.stderr);
      }
    } catch (e) {
      showToast("error", String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleExec = async (id: string) => {
    try {
      const result = await invoke<CommandResult>("exec_container_shell", { id });
      if (result.success) {
        showToast("success", "Shell opened in Terminal");
      } else {
        showToast("error", result.stderr);
      }
    } catch (e) {
      showToast("error", String(e));
    }
  };

  const handleSystemStart = async () => {
    setLoading(true);
    try {
      const result = await invoke<CommandResult>("system_start");
      if (result.success) {
        showToast("success", "System started");
      } else {
        showToast("error", result.stderr);
      }
    } catch (e) {
      showToast("error", String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSystemStop = async () => {
    if (!await confirm("Stop the container system service? All running containers will be affected.")) return;
    setLoading(true);
    try {
      const result = await invoke<CommandResult>("system_stop");
      if (result.success) {
        showToast("success", "System stopped");
      } else {
        showToast("error", result.stderr);
      }
    } catch (e) {
      showToast("error", String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      {toastMessage && (
        <div className={`toast toast-${toastMessage.type}`}>
          {toastMessage.text}
        </div>
      )}

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
            <span className="badge">{containers.length}</span>
          </button>
          <button className={`nav-item ${activeTab === "images" ? "active" : ""}`} onClick={() => setActiveTab("images")}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            <span>Images</span>
            <span className="badge">{images.length}</span>
          </button>
          <button className={`nav-item ${activeTab === "volumes" ? "active" : ""}`} onClick={() => setActiveTab("volumes")}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
              <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
            </svg>
            <span>Volumes</span>
            <span className="badge">{volumes.length}</span>
          </button>
          <button className={`nav-item ${activeTab === "networks" ? "active" : ""}`} onClick={() => setActiveTab("networks")}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <span>Networks</span>
            <span className="badge">{networks.length}</span>
          </button>
          <button className={`nav-item ${activeTab === "machines" ? "active" : ""}`} onClick={() => setActiveTab("machines")}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <span>Machines</span>
            <span className="badge">{machines.length}</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="system-controls">
            <span className="system-label">Service</span>
            <div className="system-buttons">
              <button className="btn btn-sm btn-success" onClick={handleSystemStart} disabled={loading}>
                Start
              </button>
              <button className="btn btn-sm btn-danger" onClick={handleSystemStop} disabled={loading}>
                Stop
              </button>
            </div>
          </div>
        </div>
      </div>

      <main className="main-content">
        {activeTab === "containers" && (
          <ContainersTab
            containers={containers}
            loading={loading}
            onRefresh={refreshContainers}
            onRun={() => setShowRunModal(true)}
            onStop={(id) => handleContainerAction("stop", id)}
            onStart={(id) => handleContainerAction("start", id)}
            onDelete={(id) => handleContainerAction("delete", id)}
            onKill={(id) => handleContainerAction("kill", id)}
            onLogs={handleLogs}
            onInspect={handleInspect}
            onExec={handleExec}
          />
        )}

        {activeTab === "images" && (
          <ImagesTab
            images={images}
            loading={loading}
            onRefresh={refreshImages}
            onPull={() => setShowPullModal(true)}
            onBuild={() => setShowBuildModal(true)}
            onDelete={(name) => handleImageAction("delete", name)}
            onInspect={async (fullName) => {
              setLoading(true);
              try {
                const r = await invoke<CommandResult>("inspect_image", { name: fullName });
                if (r.success) {
                  try { setInspectData(JSON.stringify(JSON.parse(r.stdout), null, 2)); } catch { setInspectData(r.stdout); }
                  setShowInspectModal(true);
                } else {
                  showToast("error", r.stderr);
                }
              } catch (e) {
                showToast("error", String(e));
              } finally {
                setLoading(false);
              }
            }}
            containers={containers}
          />
        )}

        {activeTab === "volumes" && (
          <VolumesTab
            volumes={volumes}
            loading={loading}
            onRefresh={refreshVolumes}
            onCreate={() => setShowCreateVolumeModal(true)}
            onDelete={(name) => handleVolumeAction("delete", name)}
          />
        )}

        {activeTab === "networks" && (
          <NetworksTab
            networks={networks}
            loading={loading}
            onRefresh={refreshNetworks}
            onCreate={() => setShowCreateNetworkModal(true)}
            onDelete={(name) => handleNetworkAction("delete", name)}
          />
        )}

        {activeTab === "machines" && (
          <MachinesTab
            machines={machines}
            loading={loading}
            onRefresh={refreshMachines}
            onCreate={() => setShowCreateMachineModal(true)}
            onStart={(name) => handleMachineAction("start", name)}
            onStop={(name) => handleMachineAction("stop", name)}
            onDelete={(name) => handleMachineAction("delete", name)}
            onInspect={(name) => handleMachineAction("inspect", name)}
          />
        )}
      </main>

      {showRunModal && (
        <RunContainerModal
          images={images}
          onClose={() => setShowRunModal(false)}
          onRun={async (config) => {
            setLoading(true);
            try {
              const result = await invoke<CommandResult>("run_container", config);
              if (result.success) {
                showToast("success", "Container started");
                setShowRunModal(false);
                refreshContainers();
              } else {
                showToast("error", result.stderr);
              }
            } catch (e) {
              showToast("error", String(e));
            } finally {
              setLoading(false);
            }
          }}
        />
      )}

      {showBuildModal && (
        <BuildImageModal
          onClose={() => setShowBuildModal(false)}
          onBuild={async (config) => {
            setLoading(true);
            try {
              const result = await invoke<CommandResult>("build_image", config);
              if (result.success) {
                showToast("success", "Image built");
                setShowBuildModal(false);
                refreshImages();
              } else {
                showToast("error", result.stderr);
              }
            } catch (e) {
              showToast("error", String(e));
            } finally {
              setLoading(false);
            }
          }}
        />
      )}

      {showPullModal && (
        <PullImageModal
          onClose={() => setShowPullModal(false)}
          onPull={async (reference) => {
            setLoading(true);
            try {
              const result = await invoke<CommandResult>("pull_image", { reference });
              if (result.success) {
                showToast("success", "Image pulled");
                setShowPullModal(false);
                refreshImages();
              } else {
                showToast("error", result.stderr);
              }
            } catch (e) {
              showToast("error", String(e));
            } finally {
              setLoading(false);
            }
          }}
        />
      )}

      {showCreateVolumeModal && (
        <CreateVolumeModal
          onClose={() => setShowCreateVolumeModal(false)}
          onCreate={async (name, size) => {
            setLoading(true);
            try {
              const result = await invoke<CommandResult>("create_volume", { name, size: size || null });
              if (result.success) {
                showToast("success", "Volume created");
                setShowCreateVolumeModal(false);
                refreshVolumes();
              } else {
                showToast("error", result.stderr);
              }
            } catch (e) {
              showToast("error", String(e));
            } finally {
              setLoading(false);
            }
          }}
        />
      )}

      {showCreateNetworkModal && (
        <CreateNetworkModal
          onClose={() => setShowCreateNetworkModal(false)}
          onCreate={async (name, subnet) => {
            setLoading(true);
            try {
              const result = await invoke<CommandResult>("create_network", {
                name,
                subnet: subnet || null,
                subnetV6: null,
                internal: false,
              });
              if (result.success) {
                showToast("success", "Network created");
                setShowCreateNetworkModal(false);
                refreshNetworks();
              } else {
                showToast("error", result.stderr);
              }
            } catch (e) {
              showToast("error", String(e));
            } finally {
              setLoading(false);
            }
          }}
        />
      )}

      {showCreateMachineModal && (
        <CreateMachineModal
          images={images}
          onClose={() => setShowCreateMachineModal(false)}
          onCreate={async (image, name, cpus, memory) => {
            setLoading(true);
            try {
              const result = await invoke<CommandResult>("create_machine", {
                image,
                name: name || null,
                cpus: cpus || null,
                memory: memory || null,
              });
              if (result.success) {
                showToast("success", "Machine created");
                setShowCreateMachineModal(false);
                refreshMachines();
              } else {
                showToast("error", result.stderr);
              }
            } catch (e) {
              showToast("error", String(e));
            } finally {
              setLoading(false);
            }
          }}
        />
      )}



      {showInspectModal && (
        <InspectModal
          title={selectedContainer ? `Container: ${selectedContainer.id}` : "Inspect"}
          data={inspectData}
          onClose={() => { setShowInspectModal(false); setSelectedContainer(null); }}
        />
      )}

      {confirmDialog.show && (
        <Modal onClose={cancelConfirm}>
          <h2>Confirm</h2>
          <p style={{ marginBottom: 20, color: "var(--text-primary)" }}>{confirmDialog.message}</p>
          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={cancelConfirm}>Cancel</button>
            <button className="btn btn-danger" onClick={confirmDialog.onConfirm}>Confirm</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ==================== Tab Components ====================

function ContainersTab({ containers, loading, onRefresh, onRun, onStop, onStart, onDelete, onKill, onLogs, onInspect, onExec }: {
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
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [stateFilter, setStateFilter] = useState<string>("all");

  const filteredContainers = containers.filter((c) => {
    const matchText = filter === "" ||
      c.id.toLowerCase().includes(filter.toLowerCase()) ||
      c.image.toLowerCase().includes(filter.toLowerCase()) ||
      c.ip.toLowerCase().includes(filter.toLowerCase());
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

  const getStatsDisplay = (c: Container) => {
    if (c.state !== "running" || !c.stats) return null;
    const stats = c.stats;
    const memMB = (stats.memoryUsageBytes / 1024 / 1024).toFixed(1);
    const memLimitMB = (stats.memoryLimitBytes / 1024 / 1024).toFixed(0);
    const memPercent = ((stats.memoryUsageBytes / stats.memoryLimitBytes) * 100).toFixed(1);
    const cpuPercent = (stats.cpuUsageUsec / 10000).toFixed(1);
    const blockRead = formatBytes(stats.blockReadBytes);
    const blockWrite = formatBytes(stats.blockWriteBytes);
    return { memMB, memLimitMB, memPercent, cpuPercent, blockRead, blockWrite, procs: stats.numProcesses };
  };
  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>Containers</h2>
        <div className="tab-actions">
          {selected.size > 0 && (
            <>
              <button className="btn btn-success btn-sm" onClick={() => batchAction("start")}>
                Start ({selected.size})
              </button>
              <button className="btn btn-warning btn-sm" onClick={() => batchAction("stop")}>
                Stop ({selected.size})
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => batchAction("delete")}>
                Delete ({selected.size})
              </button>
            </>
          )}
          <input
            type="text"
            className="filter-input"
            placeholder="Filter by ID, image, IP..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <select
            className="filter-select"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
          >
            <option value="all">All States</option>
            <option value="running">Running</option>
            <option value="exited">Exited</option>
            <option value="created">Created</option>
            <option value="paused">Paused</option>
          </select>
          <button className="btn btn-primary" onClick={onRun}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Run
          </button>
          <button className="btn btn-secondary" onClick={onRefresh} disabled={loading}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
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
                  checked={filteredContainers.length > 0 && selected.size === filteredContainers.length}
                  onChange={toggleAll}
                />
              </th>
              <th>ID</th>
              <th>Image</th>
              <th>State</th>
              <th>IP</th>
              <th>CPU</th>
              <th>Memory</th>
              <th>Block I/O</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredContainers.length === 0 ? (
              <tr><td colSpan={9} className="empty-row">{containers.length === 0 ? "No containers" : "No match"}</td></tr>
            ) : (
              filteredContainers.map((c) => {
                const statsDisplay = getStatsDisplay(c);
                return (
                  <tr key={c.id} className={c.state === "running" ? "row-running" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggleSelect(c.id)}
                      />
                    </td>
                    <td className="cell-id">{c.id.substring(0, 12)}</td>
                    <td>{c.image}</td>
                    <td>
                      <span className={`status-badge status-${c.state}`}>
                        {c.state}
                      </span>
                    </td>
                    <td>{c.ip || "-"}</td>
                    <td>{statsDisplay ? `${statsDisplay.cpuPercent}%` : "-"}</td>
                    <td>{statsDisplay ? `${statsDisplay.memMB} / ${statsDisplay.memLimitMB} MB (${statsDisplay.memPercent}%)` : "-"}</td>
                    <td>{statsDisplay ? `R: ${statsDisplay.blockRead} / W: ${statsDisplay.blockWrite}` : "-"}</td>
                    <td className="cell-actions">
                      {c.state === "running" ? (
                        <>
                          <button className="btn btn-xs btn-warning" onClick={() => onStop(c.id)} title="Stop">Stop</button>
                          <button className="btn btn-xs btn-danger" onClick={() => onKill(c.id)} title="Kill">Kill</button>
                        </>
                      ) : (
                        <button className="btn btn-xs btn-success" onClick={() => onStart(c.id)} title="Start">Start</button>
                      )}
                      <button className="btn btn-xs btn-info" onClick={() => onLogs(c.id)} title="Logs">Logs</button>
                      <button className="btn btn-xs btn-secondary" onClick={() => onInspect(c.id)} title="Inspect">Inspect</button>
                      <button className="btn btn-xs btn-success" onClick={() => onExec(c.id)} title="Exec Shell">Exec</button>
                      <button className="btn btn-xs btn-danger" onClick={() => onDelete(c.id)} title="Delete">Delete</button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ImagesTab({ images, loading, onRefresh, onPull, onBuild, onDelete, onInspect, containers }: {
  images: Image[];
  loading: boolean;
  onRefresh: () => void;
  onPull: () => void;
  onBuild: () => void;
  onDelete: (name: string) => void;
  onInspect: (fullName: string) => void;
  containers: Container[];
}) {
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
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredImages.length === 0 ? (
              <tr><td colSpan={verbose ? 10 : 7} className="empty-row">{images.length === 0 ? "No images" : "No match"}</td></tr>
            ) : (
              filteredImages.map((img) => {
                const usingContainers = getContainersUsingImage(img.name, img.tag);
                return (
                  <tr key={`${img.name}-${img.tag}`}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(`${img.name}:${img.tag}`)}
                        onChange={() => toggleSelect(`${img.name}:${img.tag}`)}
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
                    <td className="cell-actions">
                      <button className="btn btn-xs btn-secondary" onClick={() => onInspect(`${img.name}:${img.tag}`)} title="Inspect">Inspect</button>
                      <button className="btn btn-xs btn-danger" onClick={() => onDelete(`${img.name}:${img.tag}`)} title="Delete" disabled={usingContainers.length > 0}>Delete</button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VolumesTab({ volumes, loading, onRefresh, onCreate, onDelete }: {
  volumes: Volume[];
  loading: boolean;
  onRefresh: () => void;
  onCreate: () => void;
  onDelete: (name: string) => void;
}) {
  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>Volumes</h2>
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

function NetworksTab({ networks, loading, onRefresh, onCreate, onDelete }: {
  networks: Network[];
  loading: boolean;
  onRefresh: () => void;
  onCreate: () => void;
  onDelete: (name: string) => void;
}) {
  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>Networks</h2>
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

function MachinesTab({ machines, loading, onRefresh, onCreate, onStart, onStop, onDelete, onInspect }: {
  machines: Machine[];
  loading: boolean;
  onRefresh: () => void;
  onCreate: () => void;
  onStart: (name: string) => void;
  onStop: (name: string) => void;
  onDelete: (name: string) => void;
  onInspect: (name: string) => void;
}) {
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

// ==================== Modal Components ====================

function RunContainerModal({ images, onClose, onRun }: {
  images: Image[];
  onClose: () => void;
  onRun: (config: Record<string, unknown>) => void;
}) {
  const [image, setImage] = useState(images[0] ? `${images[0].name}:${images[0].tag}` : "");
  const [name, setName] = useState("");
  const [detach, setDetach] = useState(true);
  const [rm, setRm] = useState(false);
  const [cpus, setCpus] = useState("");
  const [memory, setMemory] = useState("");
  const [ports, setPorts] = useState("");
  const [envs, setEnvs] = useState("");
  const [volumes, setVolumes] = useState("");
  const [network, setNetwork] = useState("");
  const [entrypoint, setEntrypoint] = useState("");
  const [workdir, setWorkdir] = useState("");

  return (
    <Modal onClose={onClose}>
      <h2>Run Container</h2>
      <div className="form-grid">
        <div className="form-group">
          <label>Image</label>
          <input value={image} onChange={(e) => setImage(e.target.value)} placeholder="docker.io/library/nginx:latest" />
        </div>
        <div className="form-group">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-container" />
        </div>
        <div className="form-group">
          <label>CPUs</label>
          <input value={cpus} onChange={(e) => setCpus(e.target.value)} placeholder="2" />
        </div>
        <div className="form-group">
          <label>Memory</label>
          <input value={memory} onChange={(e) => setMemory(e.target.value)} placeholder="512M" />
        </div>
        <div className="form-group">
          <label>Ports (comma sep)</label>
          <input value={ports} onChange={(e) => setPorts(e.target.value)} placeholder="8080:80,3000:3000" />
        </div>
        <div className="form-group">
          <label>Environment (comma sep)</label>
          <input value={envs} onChange={(e) => setEnvs(e.target.value)} placeholder="KEY=val,FOO=bar" />
        </div>
        <div className="form-group">
          <label>Volumes (comma sep)</label>
          <input value={volumes} onChange={(e) => setVolumes(e.target.value)} placeholder="/host:/container" />
        </div>
        <div className="form-group">
          <label>Network</label>
          <input value={network} onChange={(e) => setNetwork(e.target.value)} placeholder="default" />
        </div>
        <div className="form-group">
          <label>Entrypoint</label>
          <input value={entrypoint} onChange={(e) => setEntrypoint(e.target.value)} placeholder="/bin/sh" />
        </div>
        <div className="form-group">
          <label>Working Dir</label>
          <input value={workdir} onChange={(e) => setWorkdir(e.target.value)} placeholder="/app" />
        </div>
        <div className="form-group form-checkboxes">
          <label><input type="checkbox" checked={detach} onChange={(e) => setDetach(e.target.checked)} /> Detach</label>
          <label><input type="checkbox" checked={rm} onChange={(e) => setRm(e.target.checked)} /> Auto-remove</label>
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onRun({
          image, name: name || null, detach, rm, cpus: cpus || null, memory: memory || null,
          ports: ports || null, envs: envs || null, volumes: volumes || null, network: network || null,
          entrypoint: entrypoint || null, workingDir: workdir || null
        })}>Run</button>
      </div>
    </Modal>
  );
}

function BuildImageModal({ onClose, onBuild }: {
  onClose: () => void;
  onBuild: (config: Record<string, unknown>) => void;
}) {
  const [context, setContext] = useState(".");
  const [tag, setTag] = useState("");
  const [dockerfile, setDockerfile] = useState("");
  const [noCache, setNoCache] = useState(false);
  const [buildArgs, setBuildArgs] = useState("");

  return (
    <Modal onClose={onClose}>
      <h2>Build Image</h2>
      <div className="form-grid">
        <div className="form-group">
          <label>Context Directory</label>
          <input value={context} onChange={(e) => setContext(e.target.value)} placeholder="." />
        </div>
        <div className="form-group">
          <label>Tag</label>
          <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="my-app:latest" />
        </div>
        <div className="form-group">
          <label>Dockerfile Path</label>
          <input value={dockerfile} onChange={(e) => setDockerfile(e.target.value)} placeholder="Dockerfile" />
        </div>
        <div className="form-group">
          <label>Build Args (comma sep)</label>
          <input value={buildArgs} onChange={(e) => setBuildArgs(e.target.value)} placeholder="NODE_VERSION=18,NPM_TOKEN=xxx" />
        </div>
        <div className="form-group form-checkboxes">
          <label><input type="checkbox" checked={noCache} onChange={(e) => setNoCache(e.target.checked)} /> No cache</label>
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onBuild({
          context, tag, dockerfile: dockerfile || null, noCache, buildArgs: buildArgs || null
        })}>Build</button>
      </div>
    </Modal>
  );
}

function PullImageModal({ onClose, onPull }: {
  onClose: () => void;
  onPull: (reference: string) => Promise<void>;
}) {
  const [reference, setReference] = useState("");
  const [progress, setProgress] = useState("");
  const [pulling, setPulling] = useState(false);

  useEffect(() => {
    const unlistenProgress = listen<string>("pull-progress", (event) => {
      setProgress(event.payload);
    });
    const unlistenComplete = listen<boolean>("pull-complete", () => {
      setPulling(false);
      setProgress("");
    });
    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
    };
  }, []);

  const handlePull = async () => {
    setPulling(true);
    setProgress("Starting pull...");
    await onPull(reference);
  };

  return (
    <Modal onClose={() => { if (!pulling) onClose(); }}>
      <h2>Pull Image</h2>
      <div className="form-grid">
        <div className="form-group">
          <label>Image Reference</label>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="docker.io/library/nginx:latest"
            autoFocus
            disabled={pulling}
          />
        </div>
      </div>
      {pulling && (
        <div className="pull-progress">
          <div className="progress-bar">
            <div className="progress-bar-indeterminate"></div>
          </div>
          <p className="progress-text">{progress || "Pulling..."}</p>
        </div>
      )}
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose} disabled={pulling}>Cancel</button>
        <button className="btn btn-primary" onClick={handlePull} disabled={!reference || pulling}>
          {pulling ? "Pulling..." : "Pull"}
        </button>
      </div>
    </Modal>
  );
}

function CreateVolumeModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (name: string, size: string) => void;
}) {
  const [name, setName] = useState("");
  const [size, setSize] = useState("");
  return (
    <Modal onClose={onClose}>
      <h2>Create Volume</h2>
      <div className="form-grid">
        <div className="form-group">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-volume" autoFocus />
        </div>
        <div className="form-group">
          <label>Size (optional)</label>
          <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="10G" />
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onCreate(name, size)} disabled={!name}>Create</button>
      </div>
    </Modal>
  );
}

function CreateNetworkModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (name: string, subnet: string) => void;
}) {
  const [name, setName] = useState("");
  const [subnet, setSubnet] = useState("");
  return (
    <Modal onClose={onClose}>
      <h2>Create Network</h2>
      <div className="form-grid">
        <div className="form-group">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-network" autoFocus />
        </div>
        <div className="form-group">
          <label>Subnet (CIDR, optional)</label>
          <input value={subnet} onChange={(e) => setSubnet(e.target.value)} placeholder="192.168.100.0/24" />
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onCreate(name, subnet)} disabled={!name}>Create</button>
      </div>
    </Modal>
  );
}

function CreateMachineModal({ images, onClose, onCreate }: {
  images: Image[];
  onClose: () => void;
  onCreate: (image: string, name: string, cpus: string, memory: string) => void;
}) {
  const [image, setImage] = useState(images[0] ? `${images[0].name}:${images[0].tag}` : "");
  const [name, setName] = useState("");
  const [cpus, setCpus] = useState("");
  const [memory, setMemory] = useState("");
  return (
    <Modal onClose={onClose}>
      <h2>Create Machine</h2>
      <div className="form-grid">
        <div className="form-group">
          <label>Image</label>
          <select value={image} onChange={(e) => setImage(e.target.value)}>
            {images.map((img) => (
              <option key={`${img.name}:${img.tag}`} value={`${img.name}:${img.tag}`}>
                {img.name}:{img.tag}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Name (optional)</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-machine" />
        </div>
        <div className="form-group">
          <label>CPUs (optional)</label>
          <input value={cpus} onChange={(e) => setCpus(e.target.value)} placeholder="2" />
        </div>
        <div className="form-group">
          <label>Memory (optional)</label>
          <input value={memory} onChange={(e) => setMemory(e.target.value)} placeholder="4G" />
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onCreate(image, name, cpus, memory)} disabled={!image}>Create</button>
      </div>
    </Modal>
  );
}



function InspectModal({ title, data, onClose }: {
  title: string;
  data: string;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose}>
      <h2>{title}</h2>
      <div className="inspect-content">
        <pre>{data}</pre>
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export default App;
