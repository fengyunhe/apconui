export type Tab = "containers" | "images" | "volumes" | "networks" | "machines" | "terminal" | "settings";

export interface RawContainer {
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

export interface Container {
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

export interface RawImage {
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

export interface Image {
  name: string;
  tag: string;
  digest: string;
  size: string;
  created?: string;
  architectures?: string[];
  cmd?: string[];
}

export interface ContainerStats {
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

export interface RawVolume {
  configuration: {
    name: string;
    driver: string;
    source: string;
    sizeInBytes: number;
  };
  id: string;
}

export interface Volume {
  name: string;
  driver: string;
  source: string;
  size: string;
}

export interface RawNetwork {
  configuration: { name: string };
  status?: { ipv4Subnet?: string };
}

export interface Network {
  name: string;
  state: string;
  subnet: string;
}

export interface Machine {
  id: string;
  status: string;
  cpus: number;
  memory: number;
  diskSize: number;
  createdDate: string;
  isDefault: boolean;
}

export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

// ===== 共享 UI 类型 =====
export type ToastType = "info" | "success" | "error";
export interface ConfirmDialog {
  show: boolean;
  message: string;
  onConfirm?: () => void;
}

// ===== Pull 任务类型 =====
export interface PullTask {
  id: string;
  reference: string;
  status: "running" | "completed" | "failed";
  progress: string;
  progressDetails?: {
    current: number;
    total: number;
    percentage: number;
  };
  error?: string;
  startTime: number;
}
