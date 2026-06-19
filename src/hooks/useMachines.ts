import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CommandResult, Machine, ToastType } from "../types";
import { parseJsonArray, TOAST_ERROR, TOAST_SUCCESS } from "../utils";

interface UseMachinesParams {
  showToast: (type: ToastType, text: string) => void;
  confirm: (message: string) => Promise<boolean>;
  setLoading: (v: boolean) => void;
}

export function useMachines({ showToast, confirm, setLoading }: UseMachinesParams) {
  const [machines, setMachines] = useState<Machine[]>([]);

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

  const handleMachineAction = useCallback(async (action: string, name: string, extras?: {
    setShowInspectModal?: (v: boolean) => void;
    setInspectData?: (v: string) => void;
  }) => {
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
          if (result.success && extras?.setInspectData && extras?.setShowInspectModal) {
            try {
              extras.setInspectData(JSON.stringify(JSON.parse(result.stdout), null, 2));
            } catch {
              extras.setInspectData(result.stdout);
            }
            extras.setShowInspectModal(true);
          } else if (!result.success) {
            showToast(TOAST_ERROR, result.stderr || "Failed to inspect machine");
          }
          setLoading(false);
          return;
        default:
          return;
      }
      if (result.success) {
        showToast(TOAST_SUCCESS, `Machine ${action} succeeded`);
        refreshMachines();
      } else {
        showToast(TOAST_ERROR, result.stderr || `Failed to ${action} machine`);
      }
    } catch (e) {
      showToast(TOAST_ERROR, String(e));
    } finally {
      setLoading(false);
    }
  }, [confirm, setLoading, showToast, refreshMachines]);

  return { machines, refreshMachines, handleMachineAction };
}
