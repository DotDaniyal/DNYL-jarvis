import React from "react";
import { CheckCircle2, XCircle, Clock, AlertCircle, Sparkles, Loader2 } from "lucide-react";
import { TaskRecord } from "../types/dnyl";

interface TaskStatusHUDProps {
  currentTask: TaskRecord | null;
  onViewImage?: (image: any) => void;
  onDismiss?: () => void;
}

export const TaskStatusHUD: React.FC<TaskStatusHUDProps> = ({
  currentTask,
  onViewImage,
  onDismiss,
}) => {
  if (!currentTask) return null;

  const isRunning = currentTask.status === "running";
  const isFailed = currentTask.status === "failed";
  const isCompleted = currentTask.status === "completed";
  const isAwaiting = currentTask.status === "awaiting_confirmation";

  return (
    <div className="w-full max-w-2xl mx-auto px-4 pointer-events-auto animate-in slide-in-from-bottom-2 duration-200">
      <div
        className={`rounded-2xl p-4 backdrop-blur-md border shadow-xl transition-all ${
          isFailed
            ? "bg-red-950/80 border-red-500/40 text-red-100"
            : isAwaiting
            ? "bg-amber-950/80 border-amber-500/40 text-amber-100"
            : isRunning
            ? "bg-slate-950/85 border-cyan-500/40 shadow-[0_0_30px_rgba(6,182,212,0.15)] text-cyan-50"
            : "bg-slate-950/85 border-teal-500/40 shadow-[0_0_30px_rgba(20,184,166,0.15)] text-teal-50"
        }`}
      >
        {/* Top Header of Task */}
        <div className="flex items-center justify-between pb-2 border-b border-white/10 text-xs">
          <div className="flex items-center gap-2">
            {isRunning && <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />}
            {isCompleted && <CheckCircle2 className="w-3.5 h-3.5 text-teal-400" />}
            {isFailed && <XCircle className="w-3.5 h-3.5 text-red-400" />}
            {isAwaiting && <AlertCircle className="w-3.5 h-3.5 text-amber-400" />}

            <span className="font-mono text-[11px] uppercase tracking-wider text-slate-300">
              {isRunning
                ? "Executing Task"
                : isCompleted
                ? "Task Completed"
                : isFailed
                ? "Execution Failed"
                : "Awaiting Confirmation"}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] text-slate-400">
              &ldquo;{currentTask.command.slice(0, 36)}&rdquo;
            </span>
            {onDismiss && !isRunning && (
              <button
                type="button"
                onClick={onDismiss}
                className="text-[11px] text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                Close
              </button>
            )}
          </div>
        </div>

        {/* Steps Stepper */}
        {currentTask.steps.length > 0 && (
          <div className="py-2.5 flex flex-wrap gap-1.5 border-b border-white/5">
            {currentTask.steps.map((step, idx) => (
              <div
                key={idx}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono border ${
                  step.status === "running"
                    ? "bg-cyan-500/15 border-cyan-400/40 text-cyan-200"
                    : step.status === "done"
                    ? "bg-teal-500/15 border-teal-400/30 text-teal-300"
                    : step.status === "failed"
                    ? "bg-red-500/15 border-red-500/30 text-red-300"
                    : step.status === "awaiting_confirmation"
                    ? "bg-amber-500/15 border-amber-500/30 text-amber-300"
                    : "bg-slate-900 border-white/10 text-slate-400"
                }`}
              >
                {step.status === "running" && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                {step.status === "done" && <CheckCircle2 className="w-2.5 h-2.5" />}
                {step.status === "failed" && <XCircle className="w-2.5 h-2.5" />}
                <span>{step.description}</span>
              </div>
            ))}
          </div>
        )}

        {/* Response Body */}
        {currentTask.response && (
          <div className="pt-2.5 text-xs sm:text-sm text-slate-200 leading-relaxed">
            <p>{currentTask.response}</p>
          </div>
        )}

        {/* Technical Diagnostics Details (Collapsible for Dev & Debugging) */}
        {(currentTask.error || currentTask.steps.length > 0) && (
          <details className="mt-2.5 pt-2 border-t border-white/5 text-[11px] font-mono text-slate-400 cursor-pointer group">
            <summary className="hover:text-cyan-300 transition-colors flex items-center gap-1.5 select-none">
              <span>Technical Diagnostics &amp; Logs</span>
              <span className="text-[9px] px-1.5 py-0.2 rounded bg-white/5 border border-white/10 text-slate-400">
                ID: {currentTask.id.slice(0, 14)}
              </span>
            </summary>
            <div className="mt-2 p-2.5 rounded-lg bg-black/60 border border-white/10 space-y-1.5 text-[11px]">
              <div><span className="text-slate-500">Command:</span> {currentTask.command}</div>
              <div><span className="text-slate-500">Status:</span> <span className={isFailed ? "text-red-400" : isCompleted ? "text-teal-400" : "text-amber-400"}>{currentTask.status}</span></div>
              {currentTask.error && (
                <div className="text-red-300"><span className="text-red-500">Error:</span> {currentTask.error}</div>
              )}
              {currentTask.steps.map((st, i) => (
                <div key={i} className="pl-2 border-l border-white/10">
                  <span className="text-cyan-400">Step {i + 1} ({st.toolName}):</span> {st.status}
                  {st.result?.message && <div className="text-slate-400 text-[10px] pl-2">{st.result.message}</div>}
                  {st.result?.blocker && <div className="text-amber-400 text-[10px] pl-2">Blocker: {st.result.blocker}</div>}
                  {st.result?.recovery && <div className="text-teal-400 text-[10px] pl-2">Recovery: {st.result.recovery}</div>}
                </div>
              ))}
            </div>
          </details>
        )}

        {/* Generated Image Thumbnail if present */}
        {currentTask.image && (
          <div className="mt-3 flex items-center justify-between p-2.5 rounded-xl bg-black/40 border border-cyan-500/30">
            <div className="flex items-center gap-3">
              <img
                src={`/api/agent/image/${encodeURIComponent(currentTask.image.fileName)}`}
                alt="Generated preview"
                className="w-12 h-12 object-cover rounded-lg border border-white/10"
              />
              <div className="space-y-0.5">
                <span className="text-xs font-semibold text-cyan-200 flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-cyan-400" />
                  <span>Image Generated</span>
                </span>
                <p className="text-[11px] text-slate-400 truncate max-w-xs">{currentTask.image.fileName}</p>
              </div>
            </div>

            {onViewImage && (
              <button
                type="button"
                onClick={() => onViewImage(currentTask.image)}
                className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs transition-colors cursor-pointer"
              >
                View Full Size
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
