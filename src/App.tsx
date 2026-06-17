import { useState, useEffect, useCallback } from "react";

// PERF: memoized counts
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import type { CommandResult, Container, Volume, Network, Tab } from "./types";
import { useToast } from "./hooks/useToast";
import { TOAST_ERROR, TOAST_SUCCESS } from "./utils";
import { useConfirm } from "./hooks/useConfirm";
import { useContainers } from "./hooks/useContainers";
import { useImages } from "./hooks/useImages";
import { useVolumes } from "./hooks/useVolumes";
import { useNetworks } from "./hooks/useNetworks";
import { useMachines } from "./hooks/useMachines";
import { Sidebar } from "./components/Sidebar";
import { ContainersTab } from "./components/ContainersTab";
import { ImagesTab } from "./components/ImagesTab";
import { VolumesTab } from "./components/VolumesTab";
import { NetworksTab } from "./components/NetworksTab";
import { MachinesTab } from "./components/MachinesTab";
import { TerminalTab } from "./components/TerminalTab";
import { SettingsTab } from "./components/SettingsTab";
import { RunContainerModal } from "./components/RunContainerModal";
import { BuildImageModal } from "./components/BuildImageModal";
import { PullImageModal } from "./components/PullImageModal";
import { TagImageModal } from "./components/TagImageModal";
import { PushImageModal } from "./components/PushImageModal";
import { CreateVolumeModal } from "./components/CreateVolumeModal";
import { CreateNetworkModal } from "./components/CreateNetworkModal";
import { CreateMachineModal } from "./components/CreateMachineModal";
import { LogsModal } from "./components/LogsModal";
import { InspectModal } from "./components/InspectModal";
import { ContainerDetail } from "./components/ContainerDetail";
import { ImageDetail } from "./components/ImageDetail";
import { Modal } from "./components/Modal";
import { TaskPanel } from "./components/TaskPanel";
import "./App.css";

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("containers");
  const [loading, setLoading] = useState(false);
  const [systemStatus, setSystemStatus] = useState<string>("unknown");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });

  const [showRunModal, setShowRunModal] = useState(false);
  const [runModalImage, setRunModalImage] = useState<string | undefined>(undefined);
  const [showBuildModal, setShowBuildModal] = useState(false);
  const [showCreateVolumeModal, setShowCreateVolumeModal] = useState(false);
  const [showCreateNetworkModal, setShowCreateNetworkModal] = useState(false);
  const [showCreateMachineModal, setShowCreateMachineModal] = useState(false);
  const [showPullModal, setShowPullModal] = useState(false);
  const [showInspectModal, setShowInspectModal] = useState(false);
  const [inspectData, setInspectData] = useState("");

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
  const [selectedContainer, setSelectedContainer] = useState<Container | null>(null);
  const [dockerMode, setDockerMode] = useState(() => {
    try {
      return localStorage.getItem("docker-mode") === "true";
    } catch {
      return false;
    }
  });

  const handleSidebarToggle = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem("sidebar-collapsed", String(next));
      } catch (e) {
        console.error("Failed to save sidebar state:", e);
      }
      return next;
    });
  }, []);

  const { toastMessage, showToast } = useToast();
  const { confirmDialog, confirm, cancelConfirm } = useConfirm();
  const { containers, refreshContainers, handleContainerAction, handlePruneContainers } = useContainers({ showToast, confirm, setLoading });
  const { images, refreshImages, handleImageAction, handlePruneImages } = useImages({ showToast, confirm, setLoading });
  const { volumes, refreshVolumes, handleVolumeAction, handlePruneVolumes } = useVolumes({ showToast, confirm, setLoading });
  const { networks, refreshNetworks, handleNetworkAction, handlePruneNetworks } = useNetworks({ showToast, confirm, setLoading });
  const { machines, refreshMachines, handleMachineAction } = useMachines({ showToast, confirm, setLoading });

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
        showToast(TOAST_ERROR, result.stderr);
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
        showToast(TOAST_SUCCESS, "Shell opened in Terminal");
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

      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        containerCount={containers.length}
        imageCount={images.length}
        volumeCount={volumes.length}
        networkCount={networks.length}
        machineCount={machines.length}
        systemStatus={systemStatus}
        onSystemStart={handleSystemStart}
        onSystemStop={handleSystemStop}
        loading={loading}
        collapsed={sidebarCollapsed}
        onToggleCollapse={handleSidebarToggle}
      />

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
            onInspect={(name) => handleMachineAction("inspect", name, { setShowInspectModal, setInspectData })}
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

        {activeTab === "terminal" && (
          <TerminalTab dockerMode={dockerMode} onDockerModeChange={setDockerMode} />
        )}

        {activeTab === "settings" && <SettingsTab />}
      </main>

      {showRunModal && (
        <RunContainerModal
          images={images}
          networks={networks}
          initialImage={runModalImage}
          onClose={() => { setShowRunModal(false); setRunModalImage(undefined); }}
          onRun={async (config) => {
            const imageRef = config.image as string;
            setShowRunModal(false);
            setRunModalImage(undefined);

            try {
              // Check if image exists locally
              const checkResult = await invoke<CommandResult>("image_exists_locally", { reference: imageRef });
              console.log(`[Run] ${imageRef} exists locally: ${checkResult.success}`);

              if (!checkResult.success) {
                // Image doesn't exist locally, pull it first
                emit("pull-start", imageRef);
                console.log(`[Run] Pulling ${imageRef}...`);
                const pullResult = await invoke<CommandResult>("pull_image", { reference: imageRef });
                console.log(`[Run] Pull ${imageRef} result:`, pullResult.success, pullResult.stderr);

                if (!pullResult.success) {
                  showToast("error", `Failed to pull image: ${pullResult.stderr}`);
                  return;
                }
              }

              // Now run the container
              console.log(`[Run] Starting container for ${imageRef}...`);
              const result = await invoke<CommandResult>("run_container", config);
              console.log(`[Run] Container start result:`, result.success, result.stderr);
              if (result.success) {
                showToast("success", "Container started");
                refreshContainers();
              } else {
                showToast("error", result.stderr);
              }
            } catch (e) {
              console.error(`[Run] Error:`, e);
              showToast("error", String(e));
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
          onImageClick={async (imgName) => {
            setDetailLoading(true);
            try {
              const r = await invoke<CommandResult>("inspect_image", { name: imgName });
              if (r.success) {
                try {
                  const parsed = JSON.parse(r.stdout);
                  setDetailData(Array.isArray(parsed) ? parsed[0] : parsed);
                  setDetailView("image");
                } catch { setDetailData(null); }
              } else {
                showToast("error", r.stderr);
              }
            } catch (e) { showToast("error", String(e)); }
            finally { setDetailLoading(false); }
          }}
        />
      )}

      {detailView === "image" && (
        <ImageDetail
          data={detailData}
          loading={detailLoading}
          containers={containers}
          onBack={() => { setDetailView(null); setDetailData(null); }}
          onTag={(name) => { setTagImageSource(name); setShowTagModal(true); }}
          onPush={(name) => { setPushImageRef(name); setShowPushModal(true); }}
          onContainerClick={async (containerId) => {
            setDetailLoading(true);
            try {
              const r = await invoke<CommandResult>("inspect_container", { id: containerId });
              if (r.success) {
                try {
                  const parsed = JSON.parse(r.stdout);
                  setDetailData(Array.isArray(parsed) ? parsed[0] : parsed);
                  setDetailView("container");
                } catch { setDetailData(null); }
              } else {
                showToast("error", r.stderr);
              }
            } catch (e) { showToast("error", String(e)); }
            finally { setDetailLoading(false); }
          }}
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

      <TaskPanel onTaskComplete={refreshImages} />
    </div>
  );
}

export default App;
