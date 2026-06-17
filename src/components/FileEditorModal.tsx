import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from 'react-i18next';
import type { CommandResult } from "../types";

interface FileEditorModalProps {
  containerId: string;
  initialPath?: string;
  onClose: () => void;
  showToast: (type: "success" | "error", message: string) => void;
}

interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  permissions: string;
}

export function FileEditorModal({ containerId, initialPath = "/", onClose, showToast }: FileEditorModalProps) {
  const { t } = useTranslation();
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [pathInput, setPathInput] = useState(initialPath);
  const [editingPath, setEditingPath] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const pathInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadFiles = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const result = await invoke<CommandResult>("list_container_files", {
        id: containerId,
        path,
      });
      if (result.success) {
        const lines = result.stdout.split("\n").filter((l: string) => l.trim() && !l.startsWith("total"));
        const parsed = lines.map((line: string) => {
          const parts = line.split(/\s+/);
          if (parts.length < 9) return null;
          const permissions = parts[0];
          const size = parseInt(parts[4], 10) || 0;
          const name = parts.slice(8).join(" ");
          if (name === "." || name === "..") return null;
          return {
            name,
            isDir: permissions.startsWith("d"),
            size,
            permissions,
          };
        }).filter((e: FileEntry | null): e is FileEntry => e !== null);
        setFiles(parsed);
      } else {
        showToast("error", result.stderr || "Failed to list files");
        setFiles([]);
      }
    } catch (e) {
      showToast("error", String(e));
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [containerId, showToast]);

  useEffect(() => {
    loadFiles(currentPath);
  }, [currentPath, loadFiles]);

  useEffect(() => {
    if (!editingPath) {
      setPathInput(currentPath);
    }
  }, [currentPath, editingPath]);

  const fetchSuggestions = useCallback(async (inputPath: string) => {
    if (!inputPath) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    try {
      let parentDir: string;
      let prefix: string;

      if (inputPath.endsWith("/")) {
        parentDir = inputPath.slice(0, -1) || "/";
        prefix = "";
      } else {
        const lastSlash = inputPath.lastIndexOf("/");
        if (lastSlash === 0) {
          parentDir = "/";
          prefix = inputPath.slice(1);
        } else {
          parentDir = inputPath.slice(0, lastSlash);
          prefix = inputPath.slice(lastSlash + 1);
        }
      }

      const result = await invoke<CommandResult>("list_container_dirs", {
        id: containerId,
        path: parentDir,
      });

      if (result.success && result.stdout.trim()) {
        const dirs = result.stdout
          .split("\n")
          .map((line: string) => line.trim())
          .filter((line: string) => line && line !== parentDir)
          .map((line: string) => {
            if (line.endsWith("/")) return line.slice(0, -1);
            return line;
          })
          .filter((dir: string) => {
            const dirName = dir.split("/").pop() || "";
            return prefix === "" || dirName.toLowerCase().startsWith(prefix.toLowerCase());
          })
          .map((dir: string) => dir.startsWith("/") ? dir : `/${dir}`)
          .slice(0, 50);

        setSuggestions(dirs);
        setShowSuggestions(dirs.length > 0);
        setActiveSuggestion(-1);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    } catch {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [containerId]);

  useEffect(() => {
    if (editingPath && pathInput) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchSuggestions(pathInput);
      }, 200);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [pathInput, editingPath, fetchSuggestions]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        pathInputRef.current &&
        !pathInputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const navigateToPath = (path: string) => {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const cleanPath = normalizedPath.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
    setCurrentPath(cleanPath);
    setEditingPath(false);
    setShowSuggestions(false);
    setEditingFile(null);
  };

  const selectSuggestion = (suggestion: string) => {
    setPathInput(suggestion);
    navigateToPath(suggestion);
  };

  const handlePathKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (activeSuggestion >= 0 && activeSuggestion < suggestions.length) {
        selectSuggestion(suggestions[activeSuggestion]);
      } else {
        navigateToPath(pathInput);
      }
    } else if (e.key === "Escape") {
      setPathInput(currentPath);
      setEditingPath(false);
      setShowSuggestions(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveSuggestion((prev) => (prev < suggestions.length - 1 ? prev + 1 : prev));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSuggestion((prev) => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === "Tab" && showSuggestions && activeSuggestion >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[activeSuggestion]);
    }
  };

  const navigateTo = (name: string, isDir: boolean) => {
    if (isDir) {
      const newPath = currentPath === "/" ? `/${name}` : `${currentPath}/${name}`;
      setCurrentPath(newPath);
      setEditingFile(null);
    }
  };

  const navigateUp = () => {
    if (currentPath === "/") return;
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    setCurrentPath(parts.length === 0 ? "/" : `/${parts.join("/")}`);
    setEditingFile(null);
  };

  const openFile = async (name: string) => {
    const filePath = currentPath === "/" ? `/${name}` : `${currentPath}/${name}`;
    setLoading(true);
    try {
      const result = await invoke<CommandResult>("read_container_file", {
        id: containerId,
        path: filePath,
      });
      if (result.success) {
        setEditingFile(filePath);
        setFileContent(result.stdout);
      } else {
        showToast("error", result.stderr || "Failed to read file");
      }
    } catch (e) {
      showToast("error", String(e));
    } finally {
      setLoading(false);
    }
  };

  const saveFile = async () => {
    if (!editingFile) return;
    setSaving(true);
    try {
      const result = await invoke<CommandResult>("write_container_file", {
        id: containerId,
        path: editingFile,
        content: fileContent,
      });
      if (result.success) {
        showToast("success", `File saved: ${editingFile}`);
      } else {
        showToast("error", result.stderr || "Failed to save file");
      }
    } catch (e) {
      showToast("error", String(e));
    } finally {
      setSaving(false);
    }
  };

  const deleteFile = async (name: string) => {
    const filePath = currentPath === "/" ? `/${name}` : `${currentPath}/${name}`;
    try {
      const result = await invoke<CommandResult>("delete_container_file", {
        id: containerId,
        path: filePath,
      });
      if (result.success) {
        showToast("success", `Deleted: ${name}`);
        loadFiles(currentPath);
        if (editingFile === filePath) {
          setEditingFile(null);
        }
      } else {
        showToast("error", result.stderr || "Failed to delete file");
      }
    } catch (e) {
      showToast("error", String(e));
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  const lineCount = editingFile ? fileContent.split("\n").length : 0;

  const handleEditorScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const lineNumbers = e.currentTarget.parentElement?.querySelector(".file-editor-line-numbers") as HTMLElement;
    if (lineNumbers) {
      lineNumbers.scrollTop = e.currentTarget.scrollTop;
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal file-editor-modal" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div className="file-editor-header">
          <h2>{t('fileEditor.title')}</h2>
          <div className="file-editor-path">
            <button className="btn btn-xs btn-secondary" onClick={navigateUp} disabled={currentPath === "/"}>../</button>
            {editingPath ? (
              <div className="file-editor-path-wrapper">
                <input
                  ref={pathInputRef}
                  type="text"
                  className="file-editor-path-input"
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  onKeyDown={handlePathKeyDown}
                  onBlur={() => {
                    setTimeout(() => {
                      setPathInput(currentPath);
                      setEditingPath(false);
                      setShowSuggestions(false);
                    }, 150);
                  }}
                  autoFocus
                />
                {showSuggestions && suggestions.length > 0 && (
                  <div ref={suggestionsRef} className="file-editor-suggestions">
                    {suggestions.map((suggestion, index) => {
                      const dirName = suggestion.split("/").pop() || suggestion;
                      return (
                        <div
                          key={suggestion}
                          className={`file-editor-suggestion ${index === activeSuggestion ? "active" : ""}`}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            selectSuggestion(suggestion);
                          }}
                          onMouseEnter={() => setActiveSuggestion(index)}
                        >
                          <span className="suggestion-icon">📁</span>
                          <span className="suggestion-name">{dirName}</span>
                          <span className="suggestion-path">{suggestion}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <span
                className="file-editor-current-path"
                onClick={() => { setPathInput(currentPath); setEditingPath(true); }}
                title="Click to edit path"
              >
                {currentPath}
              </span>
            )}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>{t('modal.close')}</button>
        </div>

        <div className="file-editor-body">
          <div className="file-browser">
            {loading ? (
              <div className="file-editor-loading">Loading...</div>
            ) : files.length === 0 ? (
              <div className="file-editor-empty">No files</div>
            ) : (
              <div className="file-list">
                {files.map((file) => (
                  <div
                    key={file.name}
                    className={`file-item ${file.isDir ? "file-dir" : "file-file"} ${editingFile === (currentPath === "/" ? `/${file.name}` : `${currentPath}/${file.name}`) ? "file-active" : ""}`}
                    onClick={() => navigateTo(file.name, file.isDir)}
                  >
                    <span className="file-icon">{file.isDir ? "📁" : "📄"}</span>
                    <span className="file-name" title={file.name}>{file.name}</span>
                    <span className="file-size">{file.isDir ? "" : formatSize(file.size)}</span>
                    {!file.isDir && (
                      <div className="file-actions">
                        <button className="btn btn-xs btn-info" onClick={(e) => { e.stopPropagation(); openFile(file.name); }}>Edit</button>
                        <button className="btn btn-xs btn-danger" onClick={(e) => { e.stopPropagation(); deleteFile(file.name); }}>Del</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {editingFile && (
            <div className="file-editor-panel">
              <div className="file-editor-toolbar">
                <span className="file-editor-name">{editingFile}</span>
                <div className="file-editor-actions">
                  <button className="btn btn-success btn-sm" onClick={saveFile} disabled={saving}>
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditingFile(null)}>Close</button>
                </div>
              </div>
              <div className="file-editor-content">
                <div className="file-editor-line-numbers">
                  {Array.from({ length: lineCount }, (_, i) => (
                    <div key={i + 1} className="file-editor-line-number">{i + 1}</div>
                  ))}
                </div>
                <textarea
                  className="file-editor-textarea"
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  onScroll={handleEditorScroll}
                  spellCheck={false}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
