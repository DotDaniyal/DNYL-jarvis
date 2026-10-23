import React, { useState, useRef, useEffect } from "react";
import { Send, Terminal, Loader2, Sparkles, Music, Folder, Globe, Power, CloudSun } from "lucide-react";

interface CommandBarProps {
  onSubmit: (command: string) => void;
  isLoading: boolean;
  onEmergencyStop: () => void;
}

const QUICK_SUGGESTIONS = [
  { label: "YouTube Music", icon: Music, prompt: "YouTube par Atif Aslam ka gaana chalao" },
  { label: "Karachi Weather", icon: CloudSun, prompt: "Aaj Karachi ka weather batao" },
  { label: "Chrome AI Search", icon: Globe, prompt: "Chrome kholo aur latest AI news search karo" },
  { label: "Open Spotify", icon: Music, prompt: "Play a song on Spotify" },
  { label: "Open Downloads", icon: Folder, prompt: "Open my Downloads folder" },
  { label: "System Info", icon: Power, prompt: "Check my system information" },
];

export const CommandBar: React.FC<CommandBarProps> = ({
  onSubmit,
  isLoading,
  onEmergencyStop,
}) => {
  const [text, setText] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const clean = text.trim();
    if (!clean || isLoading) return;

    setHistory((prev) => [clean, ...prev.filter((h) => h !== clean)].slice(0, 30));
    setHistoryIndex(-1);
    onSubmit(clean);
    setText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const nextIdx = Math.min(history.length - 1, historyIndex + 1);
      setHistoryIndex(nextIdx);
      setText(history[nextIdx]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex <= 0) {
        setHistoryIndex(-1);
        setText("");
      } else {
        const nextIdx = historyIndex - 1;
        setHistoryIndex(nextIdx);
        setText(history[nextIdx]);
      }
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto px-4 pointer-events-auto space-y-2">
      {/* Quick Action Suggestion Chips */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] font-mono scrollbar-none no-scrollbar">
        {QUICK_SUGGESTIONS.map((s, idx) => {
          const Icon = s.icon;
          return (
            <button
              key={idx}
              type="button"
              disabled={isLoading}
              onClick={() => {
                onSubmit(s.prompt);
              }}
              className="px-2.5 py-1 rounded-full border border-white/10 bg-slate-950/60 hover:bg-cyan-500/10 hover:border-cyan-400/30 text-slate-400 hover:text-cyan-200 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer shrink-0 disabled:opacity-40"
            >
              <Icon className="w-3 h-3 text-cyan-400" />
              <span>{s.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Command Input Box */}
      <form
        onSubmit={handleSubmit}
        className="relative flex items-center gap-2 bg-slate-950/90 backdrop-blur-md border border-cyan-500/30 rounded-2xl p-2 shadow-[0_4px_24px_rgba(0,0,0,0.6)] focus-within:border-cyan-400 focus-within:shadow-[0_0_30px_rgba(6,182,212,0.25)] transition-all"
      >
        <div className="pl-2.5 text-cyan-400 flex items-center">
          <Terminal className="w-4 h-4" />
        </div>

        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Speak to DNYL, or type a command... (e.g. 'Open Spotify', 'Downloads folder', 'Shut down laptop')"
          disabled={isLoading}
          className="flex-1 bg-transparent px-2 py-1 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none disabled:opacity-50 font-sans"
        />

        <div className="flex items-center gap-1.5 pr-1">
          <button
            type="submit"
            disabled={isLoading || !text.trim()}
            className="p-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold transition-colors disabled:opacity-40 disabled:hover:bg-cyan-500 cursor-pointer shrink-0 flex items-center justify-center"
            aria-label="Send command"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
            ) : (
              <Send className="w-4 h-4 text-slate-950" />
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
