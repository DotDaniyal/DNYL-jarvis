import React, { useEffect, useState } from "react";
import { X, Cpu, HardDrive, Battery, CheckCircle2, XCircle, History, Folder, AppWindow, RotateCw } from "lucide-react";
import { AgentStatus, TaskRecord } from "../types/dnyl";

interface SystemDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onRunCommand: (command: string) => void;
}

export const SystemDrawer: React.FC<SystemDrawerProps> = ({
  isOpen,
  onClose,
  onRunCommand,
}) => {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [history, setHistory] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [resStatus, resHistory] = await Promise.all([
        fetch("/api/agent/status"),
        fetch("/api/agent/history"),
      ]);
      if (resStatus.ok) setStatus(await resStatus.json());
      if (resHistory.ok) {
        const histData = await resHistory.json();
        setHistory(histData.history || []);
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="w-full max-w-md h-full bg-slate-950/95 border-l border-white/10 p-6 flex flex-col justify-between overflow-y-auto space-y-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-lg font-bold text-white tracking-wide">
              DNYL System Hub
            </h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-cyan-400/30 bg-cyan-500/10 text-cyan-300">
              DESKTOP AGENT
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchData}
              disabled={loading}
              className="p-2 rounded-lg text-slate-400 hover:text-cyan-300 hover:bg-white/5 transition-colors cursor-pointer"
              title="Refresh"
            >
              <RotateCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Core Live Integrations */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs text-slate-300">
            <span className="font-display uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              <span>Live Engine Integrations</span>
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-xl border border-white/5 bg-slate-900/60 flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-slate-200">Google Chrome</span>
                <span className="w-2 h-2 rounded-full bg-teal-400" />
              </div>
              <span className="text-[10px] text-teal-300 font-mono">
                {status?.integrations?.chromeInstalled ? "Automated Control Active" : "Ready"}
              </span>
            </div>
            <div className="p-2.5 rounded-xl border border-white/5 bg-slate-900/60 flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-slate-200">YouTube Music</span>
                <span className="w-2 h-2 rounded-full bg-teal-400" />
              </div>
              <span className="text-[10px] text-teal-300 font-mono">Real Player &amp; Verification</span>
            </div>
            <div className="p-2.5 rounded-xl border border-white/5 bg-slate-900/60 flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-slate-200">Live Weather</span>
                <span className="w-2 h-2 rounded-full bg-teal-400" />
              </div>
              <span className="text-[10px] text-teal-300 font-mono">
                {status?.integrations?.weatherProvider || "Open-Meteo + IP Geolocation"}
              </span>
            </div>
            <div className="p-2.5 rounded-xl border border-white/5 bg-slate-900/60 flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-slate-200">Voice Synthesis</span>
                <span className="w-2 h-2 rounded-full bg-teal-400" />
              </div>
              <span className="text-[10px] text-teal-300 font-mono">Multilingual TTS (EN/UR)</span>
            </div>
          </div>
        </div>

        {/* Installed Applications */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-display uppercase tracking-wider flex items-center gap-1.5 text-slate-300">
              <AppWindow className="w-3.5 h-3.5 text-cyan-400" />
              <span>Supported Applications</span>
            </span>
            <span className="font-mono text-[10px]">
              {status?.apps?.filter((a) => a.installed).length || 0} / {status?.apps?.length || 0} Detected
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
            {status?.apps?.map((app) => (
              <button
                key={app.id}
                type="button"
                onClick={() => {
                  onRunCommand(`Open ${app.name}`);
                  onClose();
                }}
                disabled={!app.installed}
                className={`p-2.5 rounded-xl border text-left flex items-center justify-between text-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  app.installed
                    ? "bg-slate-900/60 border-white/5 hover:border-cyan-400/40 hover:bg-cyan-500/5 text-slate-200"
                    : "bg-slate-950/40 border-white/5 text-slate-500"
                }`}
              >
                <span className="truncate">{app.name}</span>
                {app.installed ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Permitted Folders */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs text-slate-300">
            <span className="font-display uppercase tracking-wider flex items-center gap-1.5">
              <Folder className="w-3.5 h-3.5 text-cyan-400" />
              <span>Safe Folder Access</span>
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {status?.roots &&
              Object.entries(status.roots).map(([key, folderPath]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    onRunCommand(`Open my ${key} folder`);
                    onClose();
                  }}
                  className="px-2.5 py-1.5 rounded-lg border border-white/5 bg-slate-900/60 hover:bg-cyan-500/10 hover:border-cyan-400/30 text-[11px] font-mono text-slate-300 hover:text-cyan-200 transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <span className="capitalize">{key}</span>
                </button>
              ))}
          </div>
        </div>

        {/* Recent Task History */}
        <div className="space-y-2.5 flex-1">
          <div className="flex items-center justify-between text-xs text-slate-300">
            <span className="font-display uppercase tracking-wider flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-cyan-400" />
              <span>Recent Tasks ({history.length})</span>
            </span>
          </div>

          <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
            {history.length === 0 ? (
              <p className="text-xs text-slate-500 italic">No tasks executed yet.</p>
            ) : (
              history.slice().reverse().map((task) => (
                <div
                  key={task.id}
                  className="p-2.5 rounded-xl border border-white/5 bg-slate-900/40 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className="text-cyan-300 truncate max-w-[200px]">&ldquo;{task.command}&rdquo;</span>
                    <span
                      className={`uppercase text-[10px] ${
                        task.status === "completed"
                          ? "text-teal-400"
                          : task.status === "failed"
                          ? "text-red-400"
                          : "text-amber-400"
                      }`}
                    >
                      {task.status}
                    </span>
                  </div>
                  {task.response && (
                    <p className="text-[11px] text-slate-400 line-clamp-2">{task.response}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer info */}
        <div className="pt-4 border-t border-white/10 text-[11px] font-mono text-slate-500 flex items-center justify-between">
          <span>DNYL v2.0 · Local Desktop Agent</span>
          <span>By Daniyal</span>
        </div>
      </div>
    </div>
  );
};
