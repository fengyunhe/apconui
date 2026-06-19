import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CommandResult, Network, RawNetwork, ToastType } from "../types";
import { parseJsonArray, mapNetworks, TOAST_ERROR, TOAST_SUCCESS } from "../utils";

interface UseNetworksParams {
  showToast: (type: ToastType, text: string) => void;
  confirm: (message: string) => Promise<boolean>;
  setLoading: (v: boolean) => void;
}

export function useNetworks({ showToast, confirm, setLoading }: UseNetworksParams) {
  const [networks, setNetworks] = useState<Network[]>([]);

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

  const handleNetworkAction = useCallback(async (action: string, name: string) => {
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
        showToast(TOAST_SUCCESS, `Network ${action} succeeded`);
        refreshNetworks();
      } else {
        showToast(TOAST_ERROR, result.stderr || `Failed to ${action} network`);
      }
    } catch (e) {
      showToast(TOAST_ERROR, String(e));
    } finally {
      setLoading(false);
    }
  }, [confirm, setLoading, showToast, refreshNetworks]);

  const handlePruneNetworks = useCallback(async () => {
    if (!await confirm("Prune all unused networks? This cannot be undone.")) return;
    setLoading(true);
    try {
      const result = await invoke<CommandResult>("prune_networks");
      if (result.success) {
        showToast(TOAST_SUCCESS, "Networks pruned");
        refreshNetworks();
      } else {
        showToast(TOAST_ERROR, result.stderr);
      }
    } catch (e) {
      showToast(TOAST_ERROR, String(e));
    } finally {
      setLoading(false);
    }
  }, [confirm, setLoading, showToast, refreshNetworks]);

  return { networks, refreshNetworks, handleNetworkAction, handlePruneNetworks };
}
