import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CommandResult, Container, ContainerStats, RawContainer, ToastType } from "../types";
import { parseJsonArray, mapContainers, TOAST_ERROR, TOAST_SUCCESS } from "../utils";

interface UseContainersParams {
  showToast: (type: ToastType, text: string) => void;
  confirm: (message: string) => Promise<boolean>;
  setLoading: (v: boolean) => void;
}

export function useContainers({ showToast, confirm, setLoading }: UseContainersParams) {
  const [containers, setContainers] = useState<Container[]>([]);
  const imageExposedPortsCache = useRef<Map<string, string>>(new Map());

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

  const handleContainerAction = useCallback(async (action: string, id: string) => {
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
        showToast(TOAST_SUCCESS, `Container ${action} succeeded`);
        refreshContainers();
      } else {
        showToast(TOAST_ERROR, result.stderr || `Failed to ${action} container`);
      }
    } catch (e) {
      showToast(TOAST_ERROR, String(e));
    } finally {
      setLoading(false);
    }
  }, [confirm, setLoading, showToast, refreshContainers]);

  const handlePruneContainers = useCallback(async () => {
    if (!await confirm("Prune all stopped containers? This cannot be undone.")) return;
    setLoading(true);
    try {
      const result = await invoke<CommandResult>("prune_containers");
      if (result.success) {
        showToast(TOAST_SUCCESS, "Containers pruned");
        refreshContainers();
      } else {
        showToast(TOAST_ERROR, result.stderr);
      }
    } catch (e) {
      showToast(TOAST_ERROR, String(e));
    } finally {
      setLoading(false);
    }
  }, [confirm, setLoading, showToast, refreshContainers]);

  return { containers, refreshContainers, handleContainerAction, handlePruneContainers };
}
