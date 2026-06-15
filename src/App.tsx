import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

type Tab = "containers" | "images" | "volumes" | "networks" | "machines" | "terminal";

interface RawContainer {
  configuration: {
    id: string;
    image: { reference: string };
    platform: { os: string; architecture: string };
    publishedPorts: Array<{ proto?: string; hostPort?: number; containerPort?: number }>;
    initProcess: { arguments?: string[] };
    resources: { cpus?: number; memoryInBytes?: number };
    creationDate?: string;
    labels?: Record<string, string>;
    stopSignal?: string;
  };
  status: {
    state: string;
    networks?: Array<{ ipv4Address?: string }>;
  };
}

interface Container {
  id: string;
  image: string;
  command: string;
  os: string;
  arch: string;
  state: string;
  ip: string;
  ports: string;
  cpus: number;
  memoryBytes: number;
  created: string;
  labels: Record<string, string>;
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
    const args = c.configuration.initProcess?.arguments || [];
    const command = args.length > 0 ? args.join(" ") : "";
    const ports = (c.configuration.publishedPorts || []).map(p => {
      const proto = p.proto ? `/${p.proto}` : "";
      return p.hostPort && p.containerPort ? `${p.hostPort}:${p.containerPort}${proto}` : "";
    }).filter(Boolean).join(", ");
    return {
      id: c.configuration.id || "",
      image: ref,
      command,
      os: c.configuration.platform?.os || "",
      arch: c.configuration.platform?.architecture || "",
      state: c.status.state || "unknown",
      ip,
      ports,
      cpus: c.configuration.resources?.cpus || 0,
      memoryBytes: c.configuration.resources?.memoryInBytes || 0,
      created: c.configuration.creationDate?.split("T")[0] || "",
      labels: c.configuration.labels || {},
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
  const [systemStatus, setSystemStatus] = useState<string>("unknown");

  const [showRunModal, setShowRunModal] = useState(false);
  const [runModalImage, setRunModalImage] = useState<string | undefined>(undefined);
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

  const [showVolumeInspectModal, setShowVolumeInspectModal] = useState(false);
  const [volumeInspectData, setVolumeInspectData] = useState("");
  const [selectedVolume, setSelectedVolume] = useState<Volume | null>(null);
  const [showNetworkInspectModal, setShowNetworkInspectModal] = useState(false);
  const [networkInspectData, setNetworkInspectData] = useState("");
  const [selectedNetwork, setSelectedNetwork] = useState<Network | null>(null);

  const [showTagModal, setShowTagModal] = useState(false);
  const [tagImageSource, setTagImageSource] = useState("");
  const [showPushModal, setShowPushModal] = useState(false);
  const [pushImageRef, setPushImageRef] = useState("");
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [logsContainerId, setLogsContainerId] = useState("");
  const [detailView, setDetailView] = useState<"container" | "image" | null>(null);
  const [detailData, setDetailData] = useState<Record<string, unknown> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const imageExposedPortsCache = useRef<Map<string, string>>(new Map());

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

        const uniqueImages = [...new Set(parsed.map(c => c.image))];
        for (const imgRef of uniqueImages) {
          if (!imageExposedPortsCache.current.has(imgRef)) {
            try {
              const imgResult = await invoke<CommandResult>("inspect_image", { name: imgRef });
              if (imgResult.success && imgResult.stdout.trim()) {
                const imgData = JSON.parse(imgResult.stdout);
                const imgObj = Array.isArray(imgData) ? imgData[0] : imgData;
                const variants = imgObj?.variants || [];
                let exposedPorts: string[] = [];
                for (const v of variants) {
                  const history = v?.config?.history || [];
                  for (const h of history) {
                    const cb = (h as Record<string, unknown>).created_by as string || "";
                    const match = cb.match(/EXPOSE\s+(.+?)(?:\s+#|$)/);
                    if (match) {
                      const portStr = match[1];
                      const portMatches = portStr.match(/(\d+\/\w+)/g);
                      if (portMatches) {
                        exposedPorts = portMatches;
                        break;
                      }
                    }
                  }
                  if (exposedPorts.length > 0) break;
                }
                imageExposedPortsCache.current.set(imgRef, exposedPorts.join(", "));
              }
            } catch {
              imageExposedPortsCache.current.set(imgRef, "");
            }
          }
        }

        parsed = parsed.map(c => {
          const exposed = imageExposedPortsCache.current.get(c.image) || "";
          return {
            ...c,
            ports: c.ports || exposed || "",
          };
        });

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

  const handleCheckSystemStatus = useCallback(async () => {
    try {
      const result = await invoke<CommandResult>("run_raw_command", { command: "system status" });
      if (result.success && result.stdout.toLowerCase().includes("running")) {
        setSystemStatus("running");
      } else {
        setSystemStatus("stopped");
      }
    } catch {
      setSystemStatus("unknown");
    }
  }, []);

  useEffect(() => {
    handleCheckSystemStatus();
    const interval = setInterval(handleCheckSystemStatus, 10000);
    return () => clearInterval(interval);
  }, [handleCheckSystemStatus]);

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
    setLogsContainerId(id);
    setShowLogsModal(true);
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

  const showContainerDetail = async (id: string) => {
    setDetailLoading(true);
    setDetailView("container");
    try {
      const result = await invoke<CommandResult>("inspect_container", { id });
      if (result.success) {
        try {
          const parsed = JSON.parse(result.stdout);
          setDetailData(Array.isArray(parsed) ? parsed[0] : parsed);
        } catch {
          setDetailData(null);
        }
      } else {
        showToast("error", result.stderr);
        setDetailView(null);
      }
    } catch (e) {
      showToast("error", String(e));
      setDetailView(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const showImageDetail = async (fullName: string) => {
    setDetailLoading(true);
    setDetailView("image");
    try {
      const result = await invoke<CommandResult>("inspect_image", { name: fullName });
      if (result.success) {
        try {
          const parsed = JSON.parse(result.stdout);
          setDetailData(Array.isArray(parsed) ? parsed[0] : parsed);
        } catch {
          setDetailData(null);
        }
      } else {
        showToast("error", result.stderr);
        setDetailView(null);
      }
    } catch (e) {
      showToast("error", String(e));
      setDetailView(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleVolumeInspect = async (name: string) => {
    setLoading(true);
    try {
      const result = await invoke<CommandResult>("inspect_volume", { name });
      if (result.success) {
        try {
          setVolumeInspectData(JSON.stringify(JSON.parse(result.stdout), null, 2));
        } catch {
          setVolumeInspectData(result.stdout);
        }
        setSelectedVolume(volumes.find(v => v.name === name) || null);
        setShowVolumeInspectModal(true);
      } else {
        showToast("error", result.stderr);
      }
    } catch (e) {
      showToast("error", String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleNetworkInspect = async (name: string) => {
    setLoading(true);
    try {
      const result = await invoke<CommandResult>("inspect_network", { name });
      if (result.success) {
        try {
          setNetworkInspectData(JSON.stringify(JSON.parse(result.stdout), null, 2));
        } catch {
          setNetworkInspectData(result.stdout);
        }
        setSelectedNetwork(networks.find(n => n.name === name) || null);
        setShowNetworkInspectModal(true);
      } else {
        showToast("error", result.stderr);
      }
    } catch (e) {
      showToast("error", String(e));
    } finally {
      setLoading(false);
    }
  };

  const handlePruneContainers = async () => {
    if (!await confirm("Prune all stopped containers? This cannot be undone.")) return;
    setLoading(true);
    try {
      const result = await invoke<CommandResult>("prune_containers");
      if (result.success) {
        showToast("success", "Containers pruned");
        refreshContainers();
      } else {
        showToast("error", result.stderr);
      }
    } catch (e) {
      showToast("error", String(e));
    } finally {
      setLoading(false);
    }
  };

  const handlePruneImages = async () => {
    if (!await confirm("Prune all unused images? This cannot be undone.")) return;
    setLoading(true);
    try {
      const result = await invoke<CommandResult>("prune_images", { all: true });
      if (result.success) {
        showToast("success", "Images pruned");
        refreshImages();
      } else {
        showToast("error", result.stderr);
      }
    } catch (e) {
      showToast("error", String(e));
    } finally {
      setLoading(false);
    }
  };

  const handlePruneVolumes = async () => {
    if (!await confirm("Prune all unused volumes? This cannot be undone.")) return;
    setLoading(true);
    try {
      const result = await invoke<CommandResult>("prune_volumes");
      if (result.success) {
        showToast("success", "Volumes pruned");
        refreshVolumes();
      } else {
        showToast("error", result.stderr);
      }
    } catch (e) {
      showToast("error", String(e));
    } finally {
      setLoading(false);
    }
  };

  const handlePruneNetworks = async () => {
    if (!await confirm("Prune all unused networks? This cannot be undone.")) return;
    setLoading(true);
    try {
      const result = await invoke<CommandResult>("prune_networks");
      if (result.success) {
        showToast("success", "Networks pruned");
        refreshNetworks();
      } else {
        showToast("error", result.stderr);
      }
    } catch (e) {
      showToast("error", String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSystemStart = async () => {
    setLoading(true);
    try {
      const result = await invoke<CommandResult>("system_start");
      if (result.success) {
        showToast("success", "System started");
        handleCheckSystemStatus();
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
        handleCheckSystemStatus();
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
          <button className={`nav-item ${activeTab === "terminal" ? "active" : ""}`} onClick={() => setActiveTab("terminal")}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
            <span>Terminal</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="system-controls">
            <div className="system-status-row">
              <span className="system-label">Service</span>
              <span className={`status-dot status-dot-${systemStatus}`} title={systemStatus}></span>
            </div>
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
            onPrune={handlePruneContainers}
            onRowClick={showContainerDetail}
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
            onTag={(name) => { setTagImageSource(name); setShowTagModal(true); }}
            onPush={(name) => { setPushImageRef(name); setShowPushModal(true); }}
            onCreateContainer={(name) => { setRunModalImage(name); setShowRunModal(true); }}
            containers={containers}
            onPrune={handlePruneImages}
            onRowClick={showImageDetail}
          />
        )}

        {activeTab === "volumes" && (
          <VolumesTab
            volumes={volumes}
            loading={loading}
            onRefresh={refreshVolumes}
            onCreate={() => setShowCreateVolumeModal(true)}
            onDelete={(name) => handleVolumeAction("delete", name)}
            onInspect={handleVolumeInspect}
            onPrune={handlePruneVolumes}
          />
        )}

        {activeTab === "networks" && (
          <NetworksTab
            networks={networks}
            loading={loading}
            onRefresh={refreshNetworks}
            onCreate={() => setShowCreateNetworkModal(true)}
            onDelete={(name) => handleNetworkAction("delete", name)}
            onInspect={handleNetworkInspect}
            onPrune={handlePruneNetworks}
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
            onSetDefault={async (name) => {
              setLoading(true);
              try {
                const result = await invoke<CommandResult>("set_default_machine", { name });
                if (result.success) {
                  showToast("success", `Default machine set to ${name}`);
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

        {activeTab === "terminal" && <TerminalTab />}
      </main>

      {showRunModal && (
        <RunContainerModal
          images={images}
          networks={networks}
          initialImage={runModalImage}
          onClose={() => { setShowRunModal(false); setRunModalImage(undefined); }}
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

      {showTagModal && (
        <TagImageModal
          source={tagImageSource}
          onClose={() => setShowTagModal(false)}
          onTag={async (source, target) => {
            setLoading(true);
            try {
              const result = await invoke<CommandResult>("tag_image", { source, target });
              if (result.success) {
                showToast("success", "Image tagged");
                setShowTagModal(false);
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

      {showPushModal && (
        <PushImageModal
          reference={pushImageRef}
          onClose={() => setShowPushModal(false)}
          onPush={async (reference) => {
            setLoading(true);
            try {
              const result = await invoke<CommandResult>("push_image", { reference });
              if (result.success) {
                showToast("success", "Image pushed");
                setShowPushModal(false);
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
              const result = await invoke<CommandResult>("create_volume", { name, size: size || null, labels: null, opts: null });
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
                labels: null,
                options: null,
                plugin: null,
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
          onCreate={async (image, name, cpus, memory, homeMount, setDefault) => {
            setLoading(true);
            try {
              const result = await invoke<CommandResult>("create_machine", {
                image,
                name: name || null,
                cpus: cpus || null,
                memory: memory || null,
                setDefault,
                noBoot: false,
                homeMount: homeMount || null,
                arch: null,
                os: null,
                platform: null,
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

      {showVolumeInspectModal && (
        <InspectModal
          title={selectedVolume ? `Volume: ${selectedVolume.name}` : "Inspect Volume"}
          data={volumeInspectData}
          onClose={() => { setShowVolumeInspectModal(false); setSelectedVolume(null); }}
        />
      )}

      {showNetworkInspectModal && (
        <InspectModal
          title={selectedNetwork ? `Network: ${selectedNetwork.name}` : "Inspect Network"}
          data={networkInspectData}
          onClose={() => { setShowNetworkInspectModal(false); setSelectedNetwork(null); }}
        />
      )}

      {showLogsModal && (
        <LogsModal
          containerId={logsContainerId}
          onClose={() => setShowLogsModal(false)}
        />
      )}

      {detailView === "container" && (
        <ContainerDetail
          data={detailData}
          loading={detailLoading}
          onBack={() => { setDetailView(null); setDetailData(null); }}
          onAction={handleContainerAction}
          onLogs={(id) => { setLogsContainerId(id); setShowLogsModal(true); }}
          onExec={handleExec}
        />
      )}

      {detailView === "image" && (
        <ImageDetail
          data={detailData}
          loading={detailLoading}
          onBack={() => { setDetailView(null); setDetailData(null); }}
          onTag={(name) => { setTagImageSource(name); setShowTagModal(true); }}
          onPush={(name) => { setPushImageRef(name); setShowPushModal(true); }}
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

function ContainersTab({ containers, loading, onRefresh, onRun, onStop, onStart, onDelete, onKill, onLogs, onInspect, onExec, onPrune, onRowClick }: {
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
}) {
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
            placeholder="Filter by ID, image, command, port..."
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
          </select>
          <button className="btn btn-primary" onClick={onRun}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Run
          </button>
          <button className="btn btn-danger btn-sm" onClick={onPrune} disabled={loading}>
            Prune Stopped
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
              <th>Command</th>
              <th>State</th>
              <th>IP</th>
              <th>Ports</th>
              <th>Resources</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredContainers.length === 0 ? (
              <tr><td colSpan={10} className="empty-row">{containers.length === 0 ? "No containers" : "No match"}</td></tr>
            ) : (
              filteredContainers.map((c) => {
                const memMB = c.memoryBytes > 0 ? (c.memoryBytes / 1024 / 1024).toFixed(0) : null;
                return (
                  <tr key={c.id} className={c.state === "running" ? "row-running" : ""} style={{ cursor: "pointer" }} onClick={() => onRowClick(c.id)}>
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
                        const match = p.trim().match(/^(\d+):/);
                        const hostPort = match ? match[1] : null;
                        return hostPort ? (
                          <span key={i}>
                            {i > 0 && ", "}
                            <a
                              href="#"
                              className="port-link"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(`http://localhost:${hostPort}`); }}
                              title={`Open http://localhost:${hostPort}`}
                            >
                              {p.trim()}
                            </a>
                          </span>
                        ) : <span key={i}>{i > 0 && ", "}{p.trim()}</span>;
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
                    <td className="cell-actions" onClick={(e) => e.stopPropagation()}>
                      {c.state === "running" ? (
                        <>
                          <button className="btn btn-xs btn-warning" onClick={() => onStop(c.id)} title="Stop">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
                          </button>
                          <button className="btn btn-xs btn-danger" onClick={() => onKill(c.id)} title="Kill">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                        </>
                      ) : (
                        <button className="btn btn-xs btn-success" onClick={() => onStart(c.id)} title="Start">
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        </button>
                      )}
                      <button className="btn btn-xs btn-info" onClick={() => onLogs(c.id)} title="Logs">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                      </button>
                      <button className="btn btn-xs btn-secondary" onClick={() => onInspect(c.id)} title="Inspect">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                      </button>
                      <button className="btn btn-xs btn-success" onClick={() => onExec(c.id)} title="Exec Shell">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                      </button>
                      <button className="btn btn-xs btn-danger" onClick={() => onDelete(c.id)} title="Delete">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      </button>
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

function ImagesTab({ images, loading, onRefresh, onPull, onBuild, onDelete, onInspect, onTag, onPush, onCreateContainer, containers, onPrune, onRowClick }: {
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
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredImages.length === 0 ? (
              <tr><td colSpan={verbose ? 10 : 7} className="empty-row">{images.length === 0 ? "No images" : "No match"}</td></tr>
            ) : (
              filteredImages.map((img) => {
                const usingContainers = getContainersUsingImage(img.name, img.tag);
                const fullName = `${img.name}:${img.tag}`;
                return (
                  <tr key={fullName} style={{ cursor: "pointer" }} onClick={() => onRowClick(fullName)}>
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
                    <td className="cell-actions" onClick={(e) => e.stopPropagation()}>
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

function VolumesTab({ volumes, loading, onRefresh, onCreate, onDelete, onInspect, onPrune }: {
  volumes: Volume[];
  loading: boolean;
  onRefresh: () => void;
  onCreate: () => void;
  onDelete: (name: string) => void;
  onInspect: (name: string) => void;
  onPrune: () => void;
}) {
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

function NetworksTab({ networks, loading, onRefresh, onCreate, onDelete, onInspect, onPrune }: {
  networks: Network[];
  loading: boolean;
  onRefresh: () => void;
  onCreate: () => void;
  onDelete: (name: string) => void;
  onInspect: (name: string) => void;
  onPrune: () => void;
}) {
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

function MachinesTab({ machines, loading, onRefresh, onCreate, onStart, onStop, onDelete, onInspect, onSetDefault }: {
  machines: Machine[];
  loading: boolean;
  onRefresh: () => void;
  onCreate: () => void;
  onStart: (name: string) => void;
  onStop: (name: string) => void;
  onDelete: (name: string) => void;
  onInspect: (name: string) => void;
  onSetDefault: (name: string) => void;
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

// ==================== Modal Components ====================

function RunContainerModal({ images, networks, initialImage, onClose, onRun }: {
  images: Image[];
  networks: Network[];
  initialImage?: string;
  onClose: () => void;
  onRun: (config: Record<string, unknown>) => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [image, setImage] = useState(initialImage || (images[0] ? `${images[0].name}:${images[0].tag}` : ""));
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
  const [arch, setArch] = useState("");
  const [capAdd, setCapAdd] = useState("");
  const [capDrop, setCapDrop] = useState("");
  const [dns, setDns] = useState("");
  const [dnsDomain, setDnsDomain] = useState("");
  const [init, setInit] = useState(false);
  const [label, setLabel] = useState("");
  const [mount, setMount] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [rosetta, setRosetta] = useState(false);
  const [runtime, setRuntime] = useState("");
  const [ssh, setSsh] = useState(false);
  const [shmSize, setShmSize] = useState("");
  const [user, setUser] = useState("");
  const [imageDropdownOpen, setImageDropdownOpen] = useState(false);

  const handleImageChange = async (value: string) => {
    setImage(value);
    const matchedImage = images.find(img => `${img.name}:${img.tag}` === value);
    if (matchedImage) {
      try {
        const result = await invoke<CommandResult>("inspect_image", { name: value });
        if (result.success && result.stdout.trim()) {
          const imgData = JSON.parse(result.stdout);
          const imgObj = Array.isArray(imgData) ? imgData[0] : imgData;
          const configObj = imgObj?.configuration?.config?.config || {};
          const imgEnvs = configObj.Env || [];
          if (imgEnvs.length > 0) {
            setEnvs(imgEnvs.join(","));
          }
        }
      } catch {
        // ignore
      }
    }
  };

  return (
    <Modal onClose={onClose}>
      <h2>Run Container</h2>
      <div className="form-grid">
        <div className="form-group">
          <label>Image *</label>
          <div style={{ position: "relative" }}>
            <input
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder="docker.io/library/nginx:latest"
              onFocus={() => setImageDropdownOpen(true)}
              onBlur={() => setTimeout(() => setImageDropdownOpen(false), 200)}
            />
            {imageDropdownOpen && images.length > 0 && (
              <div className="image-dropdown">
                {images.map((img) => (
                  <div
                    key={`${img.name}:${img.tag}`}
                    className="image-dropdown-item"
                    onMouseDown={() => handleImageChange(`${img.name}:${img.tag}`)}
                  >
                    {img.name}:{img.tag}
                  </div>
                ))}
              </div>
            )}
          </div>
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
          <label>Volumes (comma sep)</label>
          <input value={volumes} onChange={(e) => setVolumes(e.target.value)} placeholder="/host:/container" />
        </div>
        <div className="form-group" style={{ gridColumn: "1 / -1" }}>
          <label>Environment (comma sep)</label>
          <textarea
            value={envs}
            onChange={(e) => setEnvs(e.target.value)}
            placeholder="KEY=val,FOO=bar"
            rows={3}
            style={{ resize: "none", fontFamily: "monospace" }}
          />
        </div>
        <div className="form-group">
          <label>Network</label>
          <select value={network} onChange={(e) => setNetwork(e.target.value)}>
            <option value="">Default</option>
            {networks.map((n) => (
              <option key={n.name} value={n.name}>{n.name}</option>
            ))}
          </select>
        </div>
        <div className="form-group form-checkboxes">
          <label><input type="checkbox" checked={detach} onChange={(e) => setDetach(e.target.checked)} /> Detach</label>
          <label><input type="checkbox" checked={rm} onChange={(e) => setRm(e.target.checked)} /> Auto-remove</label>
        </div>
      </div>

      <button className="btn btn-secondary btn-sm" style={{ margin: "12px 0" }} onClick={() => setShowAdvanced(!showAdvanced)}>
        {showAdvanced ? "Hide Advanced" : "Show Advanced Options"}
      </button>

      {showAdvanced && (
        <div className="form-grid" style={{ borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
          <div className="form-group">
            <label>Entrypoint</label>
            <input value={entrypoint} onChange={(e) => setEntrypoint(e.target.value)} placeholder="/bin/sh" />
          </div>
          <div className="form-group">
            <label>Working Dir</label>
            <input value={workdir} onChange={(e) => setWorkdir(e.target.value)} placeholder="/app" />
          </div>
          <div className="form-group">
            <label>Architecture</label>
            <select value={arch} onChange={(e) => setArch(e.target.value)}>
              <option value="">Default (arm64)</option>
              <option value="arm64">arm64</option>
              <option value="amd64">amd64</option>
            </select>
          </div>
          <div className="form-group">
            <label>User</label>
            <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="root or 1000:1000" />
          </div>
          <div className="form-group">
            <label>Cap Add</label>
            <input value={capAdd} onChange={(e) => setCapAdd(e.target.value)} placeholder="CAP_NET_RAW" />
          </div>
          <div className="form-group">
            <label>Cap Drop</label>
            <input value={capDrop} onChange={(e) => setCapDrop(e.target.value)} placeholder="CAP_NET_RAW" />
          </div>
          <div className="form-group">
            <label>DNS</label>
            <input value={dns} onChange={(e) => setDns(e.target.value)} placeholder="8.8.8.8" />
          </div>
          <div className="form-group">
            <label>DNS Domain</label>
            <input value={dnsDomain} onChange={(e) => setDnsDomain(e.target.value)} placeholder="example.com" />
          </div>
          <div className="form-group">
            <label>Label (key=value)</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="app=web" />
          </div>
          <div className="form-group">
            <label>Mount</label>
            <input value={mount} onChange={(e) => setMount(e.target.value)} placeholder="type=bind,source=/data,target=/app" />
          </div>
          <div className="form-group">
            <label>Runtime</label>
            <input value={runtime} onChange={(e) => setRuntime(e.target.value)} placeholder="container-runtime-linux" />
          </div>
          <div className="form-group">
            <label>SHM Size</label>
            <input value={shmSize} onChange={(e) => setShmSize(e.target.value)} placeholder="64M" />
          </div>
          <div className="form-group form-checkboxes">
            <label><input type="checkbox" checked={init} onChange={(e) => setInit(e.target.checked)} /> Init process</label>
            <label><input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /> Read-only</label>
            <label><input type="checkbox" checked={rosetta} onChange={(e) => setRosetta(e.target.checked)} /> Rosetta</label>
            <label><input type="checkbox" checked={ssh} onChange={(e) => setSsh(e.target.checked)} /> SSH agent</label>
          </div>
        </div>
      )}

      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onRun({
          image, name: name || null, detach, rm, cpus: cpus || null, memory: memory || null,
          ports: ports || null, envs: envs || null, volumes: volumes || null, network: network || null,
          entrypoint: entrypoint || null, workingDir: workdir || null,
          arch: arch || null, capAdd: capAdd || null, capDrop: capDrop || null,
          dns: dns || null, dnsDomain: dnsDomain || null, dnsOption: null, dnsSearch: null,
          init, label: label || null, mount: mount || null, noDns: false,
          os: null, platform: null, readOnly, rosetta, runtime: runtime || null,
          ssh, shmSize: shmSize || null, tmpfs: null, ulimit: null, user: user || null,
          maxConcurrentDownloads: null, progress: null,
        })} disabled={!image}>Run</button>
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
        })} disabled={!tag}>Build</button>
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
        <div className="form-group" style={{ gridColumn: "1 / -1" }}>
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

function TagImageModal({ source, onClose, onTag }: {
  source: string;
  onClose: () => void;
  onTag: (source: string, target: string) => void;
}) {
  const [target, setTarget] = useState("");
  return (
    <Modal onClose={onClose}>
      <h2>Tag Image</h2>
      <div className="form-grid">
        <div className="form-group" style={{ gridColumn: "1 / -1" }}>
          <label>Source Image</label>
          <input value={source} readOnly style={{ opacity: 0.7 }} />
        </div>
        <div className="form-group" style={{ gridColumn: "1 / -1" }}>
          <label>Target Reference</label>
          <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="myregistry.io/myimage:v1.0" autoFocus />
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onTag(source, target)} disabled={!target}>Tag</button>
      </div>
    </Modal>
  );
}

function PushImageModal({ reference, onClose, onPush }: {
  reference: string;
  onClose: () => void;
  onPush: (reference: string) => void;
}) {
  const [ref, setRef] = useState(reference);
  return (
    <Modal onClose={onClose}>
      <h2>Push Image</h2>
      <div className="form-grid">
        <div className="form-group" style={{ gridColumn: "1 / -1" }}>
          <label>Image Reference</label>
          <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="myregistry.io/myimage:tag" autoFocus />
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onPush(ref)} disabled={!ref}>Push</button>
      </div>
    </Modal>
  );
}

function LogsModal({ containerId, onClose }: {
  containerId: string;
  onClose: () => void;
}) {
  const [logs, setLogs] = useState("");
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [lines, setLines] = useState("200");
  const logsRef = useRef<HTMLPreElement>(null);

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const result = await invoke<CommandResult>("get_container_logs", {
        id: containerId,
        follow: false,
        lines: parseInt(lines) || null,
      });
      setLogs(result.stdout || result.stderr || "(no logs)");
    } catch (e) {
      setLogs(String(e));
    } finally {
      setLoadingLogs(false);
    }
  }, [containerId, lines]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return (
    <Modal onClose={onClose}>
      <h2>Container Logs: {containerId.substring(0, 12)}</h2>
      <div className="form-group" style={{ marginBottom: 12 }}>
        <label>Lines</label>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input value={lines} onChange={(e) => setLines(e.target.value)} style={{ width: 80 }} placeholder="200" />
          <button className="btn btn-sm btn-secondary" onClick={fetchLogs} disabled={loadingLogs}>
            {loadingLogs ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>
      <div className="logs-content">
        <pre ref={logsRef}>{loadingLogs ? "Loading..." : logs}</pre>
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
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
          <label>Name *</label>
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
          <label>Name *</label>
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
  onCreate: (image: string, name: string, cpus: string, memory: string, homeMount: string, setDefault: boolean) => void;
}) {
  const [image, setImage] = useState(images[0] ? `${images[0].name}:${images[0].tag}` : "");
  const [name, setName] = useState("");
  const [cpus, setCpus] = useState("");
  const [memory, setMemory] = useState("");
  const [homeMount, setHomeMount] = useState("rw");
  const [setDefault, setSetDefault] = useState(false);
  return (
    <Modal onClose={onClose}>
      <h2>Create Machine</h2>
      <div className="form-grid">
        <div className="form-group">
          <label>Image *</label>
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
        <div className="form-group">
          <label>Home Mount</label>
          <select value={homeMount} onChange={(e) => setHomeMount(e.target.value)}>
            <option value="rw">Read/Write</option>
            <option value="ro">Read Only</option>
            <option value="none">None</option>
          </select>
        </div>
        <div className="form-group form-checkboxes">
          <label><input type="checkbox" checked={setDefault} onChange={(e) => setSetDefault(e.target.checked)} /> Set as default</label>
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onCreate(image, name, cpus, memory, homeMount, setDefault)} disabled={!image}>Create</button>
      </div>
    </Modal>
  );
}

function TerminalTab() {
  const [history, setHistory] = useState<Array<{ cmd: string; output: string; success: boolean }>>([]);
  const [input, setInput] = useState("");
  const [executing, setExecuting] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [history]);

  const handleExecute = async () => {
    const cmd = input.trim();
    if (!cmd || executing) return;
    setInput("");
    setExecuting(true);
    try {
      const result = await invoke<CommandResult>("run_raw_command", { command: cmd });
      setHistory((prev) => [...prev, { cmd, output: result.stdout || result.stderr, success: result.success }]);
    } catch (e) {
      setHistory((prev) => [...prev, { cmd, output: String(e), success: false }]);
    } finally {
      setExecuting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleExecute();
    }
  };

  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>Terminal</h2>
        <div className="tab-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => setHistory([])}>Clear</button>
        </div>
      </div>
      <div className="terminal-tab">
        <div className="terminal-container">
          <div className="terminal-output" ref={outputRef}>
            {history.length === 0 && (
              <div className="terminal-line" style={{ color: "var(--text-muted)" }}>
                Apple Container CLI Terminal. Type commands below. Example: container ls
              </div>
            )}
            {history.map((entry, i) => (
              <div key={i}>
                <div className="terminal-line terminal-command">$ {entry.cmd}</div>
                <div className={`terminal-line ${entry.success ? "terminal-result" : "terminal-error"}`}>
                  {entry.output || "(no output)"}
                </div>
              </div>
            ))}
            {executing && <div className="terminal-line terminal-result">Executing...</div>}
          </div>
          <form className="terminal-input-form" onSubmit={(e) => { e.preventDefault(); handleExecute(); }}>
            <span className="terminal-prompt">$</span>
            <input
              className="terminal-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="container command..."
              disabled={executing}
              autoFocus
            />
          </form>
        </div>
      </div>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="detail-section">
      <h3 className="detail-section-title">{title}</h3>
      <div className="detail-section-body">{children}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value}</span>
    </div>
  );
}

function ContainerDetail({ data, loading, onBack, onAction, onLogs, onExec }: {
  data: Record<string, unknown> | null;
  loading: boolean;
  onBack: () => void;
  onAction: (action: string, id: string) => void;
  onLogs: (id: string) => void;
  onExec: (id: string) => void;
}) {
  const config = (data?.configuration || {}) as Record<string, unknown>;
  const stateObj = (data?.status || {}) as Record<string, unknown>;
  const platform = (config.platform || {}) as Record<string, unknown>;
  const image = (config.image || {}) as Record<string, unknown>;
  const networks = (stateObj.networks || []) as Array<Record<string, unknown>>;
  const mounts = (config.mounts || []) as Array<Record<string, unknown>>;
  const initProcess = (config.initProcess || {}) as Record<string, unknown>;
  const env = (initProcess.environment || []) as string[];
  const args = (initProcess.arguments || []) as string[];
  const executable = (initProcess.executable || "") as string;
  const res = (config.resources || {}) as Record<string, unknown>;
  const labels = (config.labels || {}) as Record<string, string>;
  const publishedPorts = (config.publishedPorts || []) as Array<Record<string, unknown>>;
  const startedAt = (stateObj.startedDate || "") as string;
  const state = (stateObj.state || "") as string;
  const os = (platform.os || "") as string;
  const arch = (platform.architecture || "") as string;
  const imageRef = (image.reference || "") as string;
  const id = (config.id || data?.id || "") as string;
  const stopSignal = (config.stopSignal || "") as string;
  const creationDate = (config.creationDate || "") as string;
  const cpus = (res.cpus || 0) as number;
  const memBytes = (res.memoryInBytes || 0) as number;

  if (loading) {
    return (
      <div className="detail-page">
        <div className="detail-header">
          <button className="btn btn-secondary" onClick={onBack}>Back</button>
          <h2>Loading...</h2>
        </div>
        <div className="detail-loading">Loading container details...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="detail-page">
        <div className="detail-header">
          <button className="btn btn-secondary" onClick={onBack}>Back</button>
          <h2>Container Details</h2>
        </div>
        <div className="detail-loading">No data available</div>
      </div>
    );
  }

  return (
    <div className="detail-page">
      <div className="detail-header">
        <button className="btn btn-secondary" onClick={onBack}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          Back
        </button>
        <div className="detail-title-area">
          <h2>Container</h2>
          <span className={`status-badge status-${state}`}>{state}</span>
        </div>
        <div className="detail-actions">
          {state === "running" ? (
            <>
              <button className="btn btn-warning btn-sm" onClick={() => onAction("stop", id)}>Stop</button>
              <button className="btn btn-danger btn-sm" onClick={() => onAction("kill", id)}>Kill</button>
            </>
          ) : (
            <button className="btn btn-success btn-sm" onClick={() => onAction("start", id)}>Start</button>
          )}
          <button className="btn btn-info btn-sm" onClick={() => onLogs(id)}>Logs</button>
          <button className="btn btn-success btn-sm" onClick={() => onExec(id)}>Exec</button>
          <button className="btn btn-danger btn-sm" onClick={() => onAction("delete", id)}>Delete</button>
        </div>
      </div>

      <div className="detail-body">
        <DetailSection title="General">
          <DetailRow label="ID" value={<span className="cell-id">{id}</span>} />
          <DetailRow label="Image" value={imageRef || "-"} />
          <DetailRow label="Command" value={args.length > 0 ? <code>{args.join(" ")}</code> : (executable || "-")} />
          <DetailRow label="OS" value={os || "-"} />
          <DetailRow label="Architecture" value={arch || "-"} />
          <DetailRow label="Stop Signal" value={stopSignal || "-"} />
          <DetailRow label="Created" value={creationDate ? new Date(creationDate).toLocaleString() : "-"} />
          <DetailRow label="Started" value={startedAt ? new Date(startedAt).toLocaleString() : "-"} />
        </DetailSection>

        <DetailSection title="Resources">
          <DetailRow label="CPUs" value={cpus > 0 ? String(cpus) : "-"} />
          <DetailRow label="Memory Limit" value={memBytes > 0 ? formatBytes(memBytes) : "-"} />
        </DetailSection>

        {publishedPorts.length > 0 && (
          <DetailSection title="Published Ports">
            {publishedPorts.map((p, i) => (
              <div key={i} className="detail-network-card">
                <DetailRow label="Host" value={`${(p.hostAddress || "0.0.0.0") as string}:${(p.hostPort || "") as number}`} />
                <DetailRow label="Container" value={`${(p.containerPort || "") as number}/${(p.proto || "tcp") as string}`} />
              </div>
            ))}
          </DetailSection>
        )}

        {Object.keys(labels).length > 0 && (
          <DetailSection title="Labels">
            {Object.entries(labels).map(([k, v]) => (
              <DetailRow key={k} label={k} value={v} />
            ))}
          </DetailSection>
        )}

        {env.length > 0 && (
          <DetailSection title="Environment">
            <div className="detail-env-list">
              {env.map((e, i) => (
                <code key={i} className="detail-env-item">{e}</code>
              ))}
            </div>
          </DetailSection>
        )}

        {networks.length > 0 && (
          <DetailSection title="Networks">
            {networks.map((n, i) => (
              <div key={i} className="detail-network-card">
                <DetailRow label="Network" value={(n.network || "") as string} />
                <DetailRow label="IPv4" value={(n.ipv4Address || "") as string} />
                <DetailRow label="IPv6" value={(n.ipv6Address || "") as string} />
                <DetailRow label="Gateway" value={(n.ipv4Gateway || "") as string} />
                <DetailRow label="MAC" value={(n.macAddress || "") as string} />
              </div>
            ))}
          </DetailSection>
        )}

        {mounts.length > 0 && (
          <DetailSection title="Mounts">
            {mounts.map((m, i) => (
              <div key={i} className="detail-mount-card">
                <DetailRow label="Type" value={(m.type || "") as string} />
                <DetailRow label="Source" value={<span className="cell-digest">{(m.source || "") as string}</span>} />
                <DetailRow label="Destination" value={(m.destination || "") as string} />
                <DetailRow label="Mode" value={(m.mode || "") as string} />
                <DetailRow label="RW" value={(m.rw !== undefined) ? (m.rw ? "Yes" : "No") : "-"} />
              </div>
            ))}
          </DetailSection>
        )}

        {(() => {
          const dns = (config.dns || {}) as Record<string, unknown>;
          const servers = (dns.nameservers || []) as string[];
          const search = (dns.searchDomains || []) as string[];
          const options = (dns.options || []) as string[];
          const domain = (dns.domain || "") as string;
          if (servers.length === 0 && search.length === 0 && options.length === 0 && !domain) return null;
          return (
            <DetailSection title="DNS">
              <DetailRow label="Servers" value={servers.join(", ") || "-"} />
              <DetailRow label="Search" value={search.join(", ") || "-"} />
              <DetailRow label="Options" value={options.join(", ") || "-"} />
              <DetailRow label="Domain" value={domain || "-"} />
            </DetailSection>
          );
        })()}

        <DetailSection title="Raw JSON">
          <div className="inspect-content">
            <pre>{JSON.stringify(data, null, 2)}</pre>
          </div>
        </DetailSection>
      </div>
    </div>
  );
}

function ImageDetail({ data, loading, onBack, onTag, onPush }: {
  data: Record<string, unknown> | null;
  loading: boolean;
  onBack: () => void;
  onTag: (name: string) => void;
  onPush: (name: string) => void;
}) {
  const id = (data?.id || "") as string;
  const imgData = (data?.configuration || {}) as Record<string, unknown>;
  const name = (imgData.name || "") as string;
  const creationDate = (imgData.creationDate || "") as string;
  const desc = (imgData.descriptor || {}) as Record<string, unknown>;
  const size = (desc.size || 0) as number;
  const mediatype = (desc.mediaType || "") as string;
  const history = (imgData.history || []) as Array<Record<string, unknown>>;
  const rootfs = (imgData.rootfs || {}) as Record<string, unknown>;
  const diffIDs = (rootfs.diff_ids || []) as string[];
  const variants = (data?.variants || []) as Array<Record<string, unknown>>;

  const configObj = (imgData.config || {}) as Record<string, unknown>;
  const imageConfig = (configObj.config || {}) as Record<string, unknown>;
  const entrypoint = (imageConfig.Entrypoint || []) as string[];
  const cmd = (imageConfig.Cmd || []) as string[];
  const env = (imageConfig.Env || []) as string[];
  const workingDir = (imageConfig.WorkingDir || "") as string;
  const user = (imageConfig.User || "") as string;
  const exposedPorts = (imageConfig.ExposedPorts || {}) as Record<string, unknown>;
  const labels = (imageConfig.Labels || {}) as Record<string, string>;

  if (loading) {
    return (
      <div className="detail-page">
        <div className="detail-header">
          <button className="btn btn-secondary" onClick={onBack}>Back</button>
          <h2>Loading...</h2>
        </div>
        <div className="detail-loading">Loading image details...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="detail-page">
        <div className="detail-header">
          <button className="btn btn-secondary" onClick={onBack}>Back</button>
          <h2>Image Details</h2>
        </div>
        <div className="detail-loading">No data available</div>
      </div>
    );
  }

  return (
    <div className="detail-page">
      <div className="detail-header">
        <button className="btn btn-secondary" onClick={onBack}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          Back
        </button>
        <div className="detail-title-area">
          <h2>Image</h2>
          <span className="tag-badge">{name}</span>
        </div>
        <div className="detail-actions">
          <button className="btn btn-info btn-sm" onClick={() => onTag(name)}>Tag</button>
          <button className="btn btn-success btn-sm" onClick={() => onPush(name)}>Push</button>
        </div>
      </div>

      <div className="detail-body">
        <DetailSection title="General">
          <DetailRow label="ID" value={<span className="cell-digest">{id}</span>} />
          <DetailRow label="Name" value={name || "-"} />
          <DetailRow label="Created" value={creationDate ? new Date(creationDate).toLocaleString() : "-"} />
          <DetailRow label="Size" value={size ? formatBytes(size) : "-"} />
          <DetailRow label="Media Type" value={mediatype || "-"} />
        </DetailSection>

        <DetailSection title="Configuration">
          <DetailRow label="Entrypoint" value={entrypoint.length > 0 ? <code>{entrypoint.join(" ")}</code> : "-"} />
          <DetailRow label="Cmd" value={cmd.length > 0 ? <code>{cmd.join(" ")}</code> : "-"} />
          <DetailRow label="Working Dir" value={workingDir || "-"} />
          <DetailRow label="User" value={user || "-"} />
          {Object.keys(exposedPorts).length > 0 && (
            <DetailRow label="Exposed Ports" value={Object.keys(exposedPorts).join(", ")} />
          )}
        </DetailSection>

        {env.length > 0 && (
          <DetailSection title="Environment">
            <div className="detail-env-list">
              {env.map((e, i) => (
                <code key={i} className="detail-env-item">{e}</code>
              ))}
            </div>
          </DetailSection>
        )}

        {Object.keys(labels).length > 0 && (
          <DetailSection title="Labels">
            {Object.entries(labels).map(([k, v]) => (
              <DetailRow key={k} label={k} value={v} />
            ))}
          </DetailSection>
        )}

        {variants.length > 1 && (
          <DetailSection title={`Variants (${variants.length})`}>
            <div className="detail-layers">
              {variants.map((v, i) => {
                const platform = (v.platform || {}) as Record<string, unknown>;
                const vArch = (platform.architecture || "") as string;
                const vOs = (platform.os || "") as string;
                const vSize = (v.size || 0) as number;
                return (
                  <div key={i} className="detail-layer">
                    <span className="detail-layer-num">#{i + 1}</span>
                    <code className="detail-layer-id">{vOs}/{vArch} - {vSize ? formatBytes(vSize) : "-"}</code>
                  </div>
                );
              })}
            </div>
          </DetailSection>
        )}

        {diffIDs.length > 0 && (
          <DetailSection title={`Layers (${diffIDs.length})`}>
            <div className="detail-layers">
              {diffIDs.map((d, i) => (
                <div key={i} className="detail-layer">
                  <span className="detail-layer-num">#{i + 1}</span>
                  <code className="detail-layer-id">{d}</code>
                </div>
              ))}
            </div>
          </DetailSection>
        )}

        {history.length > 0 && (
          <DetailSection title="Build History">
            <div className="detail-history">
              {history.map((h, i) => (
                <div key={i} className="detail-history-item">
                  <span className="detail-history-num">#{i + 1}</span>
                  <div className="detail-history-info">
                    {(h.created_by || "") as string && (
                      <code className="detail-history-cmd">{(h.created_by || "") as string}</code>
                    )}
                    <span className="detail-history-meta">
                      {h.size ? `${formatBytes(Number(h.size))}` : ""}
                      {h.empty_layer ? " (empty layer)" : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </DetailSection>
        )}

        <DetailSection title="Raw JSON">
          <div className="inspect-content">
            <pre>{JSON.stringify(data, null, 2)}</pre>
          </div>
        </DetailSection>
      </div>
    </div>
  );
}

function InspectModal({ title, data, onClose }: {
  title: string;
  data: string;
  onClose: () => void;
}) {
  const handleCopy = () => {
    navigator.clipboard.writeText(data);
  };
  return (
    <Modal onClose={onClose}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <button className="btn btn-sm btn-secondary" onClick={handleCopy}>Copy</button>
      </div>
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
