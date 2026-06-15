import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CommandResult, Image, RawImage } from "../types";
import { parseJsonArray, mapImages } from "../utils";

interface UseImagesParams {
  showToast: (type: "success" | "error", text: string) => void;
  confirm: (message: string) => Promise<boolean>;
  setLoading: (v: boolean) => void;
}

export function useImages({ showToast, confirm, setLoading }: UseImagesParams) {
  const [images, setImages] = useState<Image[]>([]);

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

  const handleImageAction = useCallback(async (action: string, name: string) => {
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
  }, [confirm, setLoading, showToast, refreshImages]);

  const handlePruneImages = useCallback(async () => {
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
  }, [confirm, setLoading, showToast, refreshImages]);

  return { images, refreshImages, handleImageAction, handlePruneImages };
}
