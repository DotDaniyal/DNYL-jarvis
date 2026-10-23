import React from "react";
import { AlertTriangle, Check, X, ShieldAlert } from "lucide-react";
import { PendingAction } from "../types/dnyl";

interface ConfirmationModalProps {
  pending: PendingAction | null;
  onConfirm: (actionId: string) => void;
  onCancel: (actionId: string) => void;
  isProcessing?: boolean;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  pending,
  onConfirm,
  onCancel,
  isProcessing = false,
}) => {
  if (!pending) return null;

  const isDestructive = pending.risk === "destructive";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div
        className={`w-full max-w-lg rounded-2xl p-6 border shadow-2xl transition-all ${
          isDestructive
            ? "bg-slate-950/95 border-red-500/50 shadow-[0_0_50px_rgba(239,68,68,0.3)] text-red-100"
            : "bg-slate-950/95 border-amber-500/50 shadow-[0_0_50px_rgba(245,158,11,0.25)] text-amber-100"
        }`}
      >
        <div className="flex items-start gap-4">
          <div
            className={`p-3 rounded-xl ${
              isDestructive ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"
            }`}
          >
            {isDestructive ? (
              <ShieldAlert className="w-6 h-6 animate-pulse" />
            ) : (
              <AlertTriangle className="w-6 h-6" />
            )}
          </div>

          <div className="flex-1 space-y-2">
            <div className="flex items-center justify-between">
              <span
                className={`text-[11px] font-mono font-semibold uppercase tracking-widest px-2.5 py-0.5 rounded-full border ${
                  isDestructive
                    ? "bg-red-500/20 border-red-500/40 text-red-300"
                    : "bg-amber-500/20 border-amber-500/40 text-amber-300"
                }`}
              >
                {isDestructive ? "Destructive Action Confirmation" : "Sensitive Action Confirmation"}
              </span>
            </div>

            <h3 id="confirm-modal-title" className="text-lg font-display font-bold text-white">
              {pending.description}
            </h3>

            <p className="text-xs text-slate-300 leading-relaxed">
              {isDestructive
                ? "This command will affect system state or delete data. A 60-second grace period applies to shutdown/restart, which can be aborted via Emergency Stop. Please verify that all your work is saved before proceeding."
                : "This command modifies files or closes applications. Confirm whether you want DNYL to execute this action."}
            </p>

            <div className="mt-3 p-3 rounded-lg bg-black/40 border border-white/5 font-mono text-[11px] text-slate-400">
              <span className="text-slate-500">Requested from: </span>
              <span className="text-cyan-300">&ldquo;{pending.command}&rdquo;</span>
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 pt-4 border-t border-white/10">
          <button
            type="button"
            disabled={isProcessing}
            onClick={() => onCancel(pending.id)}
            className="px-4 py-2 rounded-xl text-xs font-medium border border-white/10 bg-slate-900 text-slate-300 hover:bg-slate-800 transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" />
            <span>Cancel</span>
          </button>

          <button
            type="button"
            disabled={isProcessing}
            onClick={() => onConfirm(pending.id)}
            className={`px-5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer shadow-lg disabled:opacity-50 ${
              isDestructive
                ? "bg-red-600 hover:bg-red-500 text-white shadow-red-600/30"
                : "bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/30"
            }`}
          >
            <Check className="w-3.5 h-3.5" />
            <span>{isProcessing ? "Executing..." : "Confirm & Execute"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
