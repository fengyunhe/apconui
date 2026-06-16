import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { PullTask } from "../types";

interface TaskPanelProps {
  onTaskComplete?: () => void;
}

export function TaskPanel({ onTaskComplete }: TaskPanelProps) {
  const [tasks, setTasks] = useState<PullTask[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  const addTask = useCallback((reference: string) => {
    const newTask: PullTask = {
      id: `${reference}-${Date.now()}`,
      reference,
      status: "running",
      progress: "Starting pull...",
      startTime: Date.now(),
    };
    setTasks((prev) => [...prev, newTask]);
  }, []);

  const updateTask = useCallback((progress: string) => {
    setTasks((prev) => {
      const idx = prev.findIndex((task) => task.status === "running");
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], progress };
      return next;
    });
  }, []);

  const completeTask = useCallback((success: boolean) => {
    setTasks((prev) => {
      const idx = prev.findIndex((task) => task.status === "running");
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], status: success ? "completed" : "failed" };
      return next;
    });
    onTaskComplete?.();
  }, [onTaskComplete]);

  const cancelTask = useCallback(async (taskId: string) => {
    try {
      await invoke("cancel_pull");
      setTasks((prev) => {
        const idx = prev.findIndex((task) => task.id === taskId);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], status: "failed", error: "Cancelled by user" };
        return next;
      });
    } catch (e) {
      console.error("Failed to cancel pull:", e);
    }
  }, []);

  const removeTask = useCallback((taskId: string) => {
    setTasks((prev) => prev.filter((task) => task.id !== taskId));
  }, []);

  const clearCompleted = useCallback(() => {
    setTasks((prev) => prev.filter((task) => task.status === "running"));
  }, []);

  useEffect(() => {
    const unlistenPullStart = listen<string>("pull-start", (event) => {
      addTask(event.payload);
    });

    const unlistenProgress = listen<string>("pull-progress", (event) => {
      updateTask(event.payload);
    });

    const unlistenComplete = listen<boolean>("pull-complete", (event) => {
      completeTask(event.payload);
    });

    return () => {
      unlistenPullStart.then((fn) => fn());
      unlistenProgress.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
    };
  }, [addTask, updateTask, completeTask]);

  const runningTasks = tasks.filter((t) => t.status === "running");
  const completedTasks = tasks.filter((t) => t.status !== "running");

  const showToggle = tasks.length > 0 || isOpen;

  return (
    <>
      {showToggle && (
        <button className="task-panel-toggle" onClick={() => setIsOpen(true)}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          {runningTasks.length > 0 ? `${runningTasks.length} running` : "Tasks"}
        </button>
      )}
      {isOpen && (
    <div className="task-panel-overlay" onClick={() => setIsOpen(false)}>
      <div className="task-panel" onClick={(e) => e.stopPropagation()}>
        <div className="task-panel-header">
          <div className="task-panel-title">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            <h2>Task Panel</h2>
            {runningTasks.length > 0 && (
              <span className="task-count">{runningTasks.length} running</span>
            )}
          </div>
          <div className="task-panel-actions">
            {completedTasks.length > 0 && (
              <button className="btn btn-xs btn-secondary" onClick={clearCompleted}>
                Clear Completed
              </button>
            )}
            <button className="btn btn-xs btn-secondary" onClick={() => setIsOpen(false)}>
              Close
            </button>
          </div>
        </div>

        <div className="task-panel-content">
          {tasks.length === 0 ? (
            <div className="task-panel-empty">
              <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <p>No tasks running</p>
              <p className="text-muted">Pull images to see tasks here</p>
            </div>
          ) : (
            <div className="task-list">
              {tasks.map((task) => (
                <div key={task.id} className={`task-item task-${task.status}`}>
                  <div className="task-header">
                    <div className="task-reference">
                      <div className="task-status-icon">
                        {task.status === "running" ? (
                          <svg className="animate-spin" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10"/>
                          </svg>
                        ) : task.status === "completed" ? (
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        )}
                      </div>
                      <span className="task-name">{task.reference}</span>
                    </div>
                    <span className={`task-badge task-${task.status}`}>
                      {task.status === "running" ? "Running" : task.status === "completed" ? "Completed" : "Failed"}
                    </span>
                  </div>

                  {task.status === "running" && (
                    <div className="task-progress">
                      <div className="progress-bar">
                        <div className="progress-bar-indeterminate"></div>
                      </div>
                      <p className="progress-text">{task.progress}</p>
                      <button className="btn btn-danger btn-xs task-cancel-btn" onClick={() => cancelTask(task.id)}>
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18"/>
                          <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                        Cancel
                      </button>
                    </div>
                  )}

                  {task.status === "completed" && (
                    <div className="task-result task-success">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                      <span>Image pulled successfully</span>
                    </div>
                  )}

                  {task.status === "failed" && (
                    <div className="task-result task-error">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="15" y1="9" x2="9" y2="15"/>
                        <line x1="9" y1="9" x2="15" y2="15"/>
                      </svg>
                      <span>{task.error || "Pull failed"}</span>
                    </div>
                  )}

                  {task.status !== "running" && (
                    <button className="task-remove-btn" onClick={() => removeTask(task.id)}>
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
      )}
    </>
  );
}
