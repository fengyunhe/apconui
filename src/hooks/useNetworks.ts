import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CommandResult, Network, RawNetwork } from "../types";
import { parseJsonArray, mapNetworks } from "../utils";

interface UseNetworksParams {
  showToast: (type: "success" | "error", text: string) => void;
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
  }, [confirm, setLoading, showToast, refreshNetworks]);

  const handlePruneNetworks = useCallback(async () => {
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
  }, [confirm, setLoading, showToast, refreshNetworks]);

  return { networks, refreshNetworks, handleNetworkAction, handlePruneNetworks };
}
