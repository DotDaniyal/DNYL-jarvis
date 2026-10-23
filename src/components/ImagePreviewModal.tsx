import React from "react";
import { Download, X, Sparkles, FolderOpen } from "lucide-react";

interface ImagePreviewModalProps {
  image: {
    fileName: string;
    filePath: string;
    model: string;
    prompt: string;
  } | null;
  onClose: () => void;
  onOpenFolder?: (path: string) => void;
}

export const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({
  image,
  onClose,
  onOpenFolder,
}) => {
  if (!image) return null;

  const imageUrl = `/api/agent/image/${encodeURIComponent(image.fileName)}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-2xl bg-slate-950/95 border border-cyan-500/40 rounded-2xl p-6 shadow-[0_0_60px_rgba(6,182,212,0.25)] flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <h3 className="text-base font-display font-bold text-white">Generated Artwork</h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
              {image.model}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Close image preview"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Image preview frame */}
        <div className="relative w-full aspect-video sm:aspect-square max-h-[55vh] rounded-xl overflow-hidden border border-white/10 bg-black/60 flex items-center justify-center">
          <img
            src={imageUrl}
            alt={image.prompt}
            className="w-full h-full object-contain"
          />
        </div>

        {/* Prompt description */}
        <div className="p-3 rounded-lg bg-black/40 border border-white/5 space-y-1">
          <p className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">Prompt</p>
          <p className="text-xs text-slate-200 leading-relaxed">&ldquo;{image.prompt}&rdquo;</p>
        </div>

        {/* Saved location and actions */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2 text-xs text-slate-400">
          <span className="truncate max-w-xs font-mono text-[11px]">
            Saved to: <span className="text-slate-300">{image.filePath}</span>
          </span>
          <div className="flex items-center gap-2.5 shrink-0">
            {onOpenFolder && (
              <button
                type="button"
                onClick={() => onOpenFolder(image.filePath)}
                className="px-3 py-1.5 rounded-lg border border-white/10 bg-slate-900 text-slate-300 hover:bg-slate-800 transition-colors flex items-center gap-1.5 text-xs cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Show in Explorer</span>
              </button>
            )}
            <a
              href={imageUrl}
              download={image.fileName}
              className="px-3.5 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold transition-colors flex items-center gap-1.5 text-xs cursor-pointer shadow-md shadow-cyan-500/20"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
