import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CommandResult, Volume, RawVolume } from "../types";
import { parseJsonArray, mapVolumes } from "../utils";

interface UseVolumesParams {
  showToast: (type: "success" | "error", text: string) => void;
  confirm: (message: string) => Promise<boolean>;
  setLoading: (v: boolean) => void;
}

export function useVolumes({ showToast, confirm, setLoading }: UseVolumesParams) {
  const [volumes, setVolumes] = useState<Volume[]>([]);

  const refreshVolumes = useCallback(async () => {
    try {
      const result = await invoke<CommandResult>("list_volumes");
      if (result.success && result.stdout.trim()) {
        setVolumes(mapVolumes(parseJsonArray<RawVolume>(result.stdout)));
      } else {
        setVolumes([]);
      }
    } catch {
      setVolumes([]);
    }
  }, []);

  const handleVolumeAction = useCallback(async (action: string, name: string) => {
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
  }, [confirm, setLoading, showToast, refreshVolumes]);

  const handlePruneVolumes = useCallback(async () => {
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
  }, [confirm, setLoading, showToast, refreshVolumes]);

  return { volumes, refreshVolumes, handleVolumeAction, handlePruneVolumes };
}
