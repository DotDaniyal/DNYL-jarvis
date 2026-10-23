export type RiskLevel = "low" | "sensitive" | "destructive";

export interface TaskStep {
  toolName: string;
  args: Record<string, any>;
  description: string;
  risk: RiskLevel;
  status: "pending" | "running" | "done" | "failed" | "awaiting_confirmation" | "cancelled";
  result?: {
    ok: boolean;
    message: string;
    data?: any;
    image?: { fileName: string; filePath: string; model: string; prompt: string };
    blocker?: string;
    recovery?: string;
  };
}

export interface TaskRecord {
  id: string;
  command: string;
  timestamp: number;
  status: "running" | "awaiting_confirmation" | "completed" | "failed" | "cancelled";
  steps: TaskStep[];
  response?: string;
  speechResponse?: string;
  image?: { fileName: string; filePath: string; model: string; prompt: string };
  error?: string;
}

export interface PendingAction {
  id: string;
  toolName: string;
  args: Record<string, any>;
  risk: RiskLevel;
  description: string;
  createdAt: number;
  command: string;
}

export interface InstalledApp {
  id: string;
  name: string;
  installed: boolean;
}

export interface SystemTelemetry {
  os: string;
  hostname: string;
  cpu?: string;
  cores?: number;
  totalMemoryGB: number;
  freeMemoryGB: number;
  uptimeHours: number;
  batteryPercent: number | null;
  charging: boolean | null;
  diskFreeGB: number | null;
  diskUsedGB: number | null;
  localTime: string;
}

export interface AgentStatus {
  ok: boolean;
  configured: boolean;
  roots: Record<string, string>;
  apps: InstalledApp[];
  integrations: {
    spotifyDesktop: boolean;
    chromeInstalled?: boolean;
    chromeConnected?: boolean;
    weatherProvider?: string;
  };
  pending: PendingAction | null;
}
