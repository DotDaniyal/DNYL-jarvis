import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Mic,
  MicOff,
  MessageSquareText,
  RotateCw,
  Volume2,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";
import { useJarvisLive } from "./hooks/useJarvisLive";
import { JarvisCore3D } from "./components/JarvisCore3D";
import { AudioWaveform } from "./components/AudioWaveform";
import { TranscriptOverlay } from "./components/TranscriptOverlay";
import { CommandBar } from "./components/CommandBar";
import { TaskStatusHUD } from "./components/TaskStatusHUD";
import { ConfirmationModal } from "./components/ConfirmationModal";
import { ImagePreviewModal } from "./components/ImagePreviewModal";
import { SystemDrawer } from "./components/SystemDrawer";
import { JarvisSystemState } from "./types/jarvis";
import { TaskRecord, PendingAction } from "./types/dnyl";

const STATE_DISPLAY_CONFIG: Record<
  JarvisSystemState,
  {
    symbol: string;
    label: string;
    subtext: string;
    textColor: string;
    dotColor: string;
  }
> = {
  CONNECTING: {
    symbol: "◌",
    label: "CONNECTING...",
    subtext: "Establishing real-time neural audio link with Gemini 3.8 Live",
    textColor: "text-slate-300",
    dotColor: "text-sky-400 animate-spin",
  },
  READY: {
    symbol: "●",
    label: "READY",
    subtext: "Voice interface & desktop agent initialized · Speak or type naturally",
    textColor: "text-cyan-300",
    dotColor: "text-cyan-400",
  },
  LISTENING: {
    symbol: "●",
    label: "LISTENING...",
    subtext: "Continuous voice detection active · Speak anytime",
    textColor: "text-cyan-300",
    dotColor: "text-cyan-400 animate-pulse",
  },
  "USER SPEAKING": {
    symbol: "◉",
    label: "USER SPEAKING...",
    subtext: "Capturing real-time voice stream",
    textColor: "text-teal-300",
    dotColor: "text-teal-400 animate-ping",
  },
  THINKING: {
    symbol: "◉",
    label: "THINKING...",
    subtext: "Reasoning and planning desktop actions",
    textColor: "text-amber-300",
    dotColor: "text-amber-400 animate-pulse",
  },
  EXECUTING: {
    symbol: "⚙",
    label: "EXECUTING...",
    subtext: "Running laptop and Chrome actions",
    textColor: "text-purple-300",
    dotColor: "text-purple-400 animate-spin",
  },
  "JARVIS SPEAKING": {
    symbol: "◉",
    label: "DNYL SPEAKING...",
    subtext: "Speak at any moment to interrupt naturally",
    textColor: "text-sky-300",
    dotColor: "text-sky-400 animate-pulse",
  },
  ERROR: {
    symbol: "▲",
    label: "ERROR",
    subtext: "Voice link interrupted",
    textColor: "text-red-400",
    dotColor: "text-red-500",
  },
};

export default function App() {
  const [showTranscript, setShowTranscript] = useState(false);
  const [isSystemDrawerOpen, setIsSystemDrawerOpen] = useState(false);
  const [currentTask, setCurrentTask] = useState<TaskRecord | null>(null);
  const [isTaskLoading, setIsTaskLoading] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingAction | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [previewImage, setPreviewImage] = useState<TaskRecord["image"] | null>(null);
  const [emergencyAlert, setEmergencyAlert] = useState<string | null>(null);

  const speakTextRef = useRef<((text: string) => void) | null>(null);

  // Poll for pending confirmations
  const checkPending = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/pending");
      const data = await res.json();
      setPendingConfirmation(data.pending || null);
    } catch {
      // Ignore background poll errors
    }
  }, []);

  useEffect(() => {
    checkPending();
    const interval = setInterval(checkPending, 3000);
    return () => clearInterval(interval);
  }, [checkPending]);

  // Execute command (from text bar, voice, or quick suggestions)
  const handleExecuteCommand = useCallback(async (commandText: string) => {
    if (!commandText.trim()) return;
    setIsTaskLoading(true);
    setEmergencyAlert(null);

    // Initial placeholder task record
    const tempTask: TaskRecord = {
      id: `task-${Date.now()}`,
      command: commandText,
      timestamp: Date.now(),
      status: "running",
      steps: [{
        toolName: "evaluating",
        args: {},
        description: `Planning actions for: "${commandText}"`,
        risk: "low",
        status: "running",
      }],
    };
    setCurrentTask(tempTask);

    try {
      const res = await fetch("/api/agent/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: commandText }),
      });
      const data = await res.json();

      if (data.ok && data.record) {
        setCurrentTask(data.record);
        if (data.record.status === "awaiting_confirmation") {
          await checkPending();
        }
        if (data.record.image) {
          setPreviewImage(data.record.image);
        }
        const spoken = data.record.speechResponse || data.record.response;
        if (spoken) {
          speakTextRef.current?.(spoken);
        }
      } else {
        const errMsg = data.error || "Unable to complete command.";
        setCurrentTask({
          id: `task-err-${Date.now()}`,
          command: commandText,
          timestamp: Date.now(),
          status: "failed",
          steps: [],
          error: errMsg,
          response: errMsg,
        });
        speakTextRef.current?.(errMsg);
      }
    } catch (err: any) {
      const errMsg = "Network error communicating with desktop agent.";
      setCurrentTask({
        id: `task-err-${Date.now()}`,
        command: commandText,
        timestamp: Date.now(),
        status: "failed",
        steps: [],
        error: err?.message || String(err),
        response: errMsg,
      });
      speakTextRef.current?.(errMsg);
    } finally {
      setIsTaskLoading(false);
    }
  }, [checkPending]);

  const {
    systemState,
    errorCode,
    errorMessage,
    isMicMuted,
    needsUserGesture,
    transcripts,
    sampleAudioMetrics,
    unlockAndResumeAudio,
    reconnect,
    toggleMicMute,
    clearTranscripts,
    interruptJarvis,
    speakText,
  } = useJarvisLive({
    onCommand: handleExecuteCommand,
    onTaskUpdate: (task) => {
      setCurrentTask(task);
    },
    onTaskComplete: (task) => {
      setCurrentTask(task);
      if (task.image) {
        setPreviewImage(task.image);
      }
    },
  });

  useEffect(() => {
    speakTextRef.current = speakText;
  }, [speakText]);

  // Confirm or cancel pending action
  const handleConfirmAction = async (actionId: string, confirmed: boolean) => {
    setIsConfirming(true);
    try {
      const res = await fetch("/api/agent/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId, confirmed }),
      });
      const data = await res.json();
      setPendingConfirmation(null);

      if (data.record) {
        setCurrentTask(data.record);
        const spoken = data.record.speechResponse || data.record.response;
        if (spoken) {
          speakTextRef.current?.(spoken);
        }
      }
    } catch {
      // Ignore
    } finally {
      setIsConfirming(false);
    }
  };

  // Emergency stop trigger
  const handleEmergencyStop = async () => {
    try {
      const res = await fetch("/api/agent/emergency-stop", { method: "POST" });
      const data = await res.json();
      setPendingConfirmation(null);
      setEmergencyAlert(data.message || "Emergency Stop activated.");
      setCurrentTask({
        id: `stop-${Date.now()}`,
        command: "EMERGENCY_STOP",
        timestamp: Date.now(),
        status: "completed",
        steps: [],
        response: data.message,
      });
      speakTextRef.current?.("Emergency stop activated. Background tasks terminated.");
    } catch {
      setEmergencyAlert("Emergency Stop triggered.");
    }
  };

  const currentDisplay =
    STATE_DISPLAY_CONFIG[systemState] || STATE_DISPLAY_CONFIG.LISTENING;

  const handleCoreInteraction = () => {
    if (needsUserGesture || systemState === "ERROR") {
      unlockAndResumeAudio();
      return;
    }
    if (systemState === "JARVIS SPEAKING") {
      interruptJarvis();
    }
  };

  return (
    <div className="relative w-screen h-dvh bg-[#030712] text-slate-100 overflow-hidden select-none flex flex-col justify-between">
      {/* Background Architectural Grid & Vignette */}
      <div
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            "radial-gradient(rgba(56, 189, 248, 0.14) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_25%,#030712_90%)]" />

      {/* 3D Reactive Core */}
      <main className="absolute inset-0 z-0 w-full h-full">
        <JarvisCore3D
          systemState={systemState}
          sampleAudioMetrics={sampleAudioMetrics}
          onCoreClick={handleCoreInteraction}
        />
      </main>

      {/* Top Navbar */}
      <header className="relative z-10 flex items-center justify-between px-4 sm:px-8 py-3.5 border-b border-white/5 bg-slate-950/40 backdrop-blur-md">
        {/* Brand & Creator Attribution */}
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="font-display text-xl sm:text-2xl font-bold tracking-widest text-cyan-50 drop-shadow-[0_0_12px_rgba(6,182,212,0.6)]"
          >
            DNYL
          </a>
          <span className="text-[10px] sm:text-xs font-mono font-semibold tracking-wider px-2.5 py-0.5 rounded-full border border-cyan-400/40 bg-cyan-500/10 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.2)]">
            BY DANIYAL
          </span>
        </div>

        {/* Center Minimal System Telemetry */}
        <div className="hidden lg:flex items-center gap-2.5 text-xs text-slate-400 font-mono">
          <span>Gemini 3.8 Live</span>
          <span aria-hidden="true">·</span>
          <span>Full Laptop Control Agent</span>
          <span aria-hidden="true">·</span>
          <span>Multilingual Duplex Voice</span>
        </div>

        {/* Primary Action Controls */}
        <div className="flex items-center gap-2 sm:gap-2.5">
          {/* Emergency Stop Button */}
          <button
            type="button"
            onClick={handleEmergencyStop}
            className="min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold border border-red-500/40 bg-red-500/15 text-red-200 hover:bg-red-500/25 transition-all flex items-center gap-1.5 cursor-pointer shadow-[0_0_15px_rgba(239,68,68,0.2)]"
            title="Emergency Stop: halts all active processes and cancels shutdown"
            aria-label="Emergency Stop"
          >
            <ShieldAlert className="w-3.5 h-3.5 text-red-400 animate-pulse" />
            <span className="hidden sm:inline">Emergency Stop</span>
          </button>

          {/* System Drawer Toggle */}
          <button
            type="button"
            onClick={() => setIsSystemDrawerOpen(true)}
            className="min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-medium border border-white/10 bg-slate-900/60 text-slate-300 hover:text-cyan-200 hover:border-cyan-400/40 transition-colors flex items-center gap-1.5 cursor-pointer"
            aria-label="Open System Hub"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">System Hub</span>
          </button>

          {/* Transcript Toggle */}
          <button
            type="button"
            onClick={() => setShowTranscript((prev) => !prev)}
            className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
              showTranscript
                ? "bg-cyan-500/15 border-cyan-400/40 text-cyan-200"
                : "bg-slate-900/60 border-white/10 text-slate-400 hover:text-slate-200"
            }`}
            aria-label="Toggle transcript"
          >
            <MessageSquareText className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Transcript</span>
          </button>

          {/* Microphone Mute Toggle */}
          <button
            type="button"
            onClick={toggleMicMute}
            className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-medium border transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
              isMicMuted
                ? "bg-red-500/20 border-red-500/40 text-red-200 hover:bg-red-500/30"
                : "bg-cyan-500/20 border-cyan-400/50 text-cyan-100 hover:bg-cyan-500/30"
            }`}
            aria-label={isMicMuted ? "Unmute microphone" : "Mute microphone"}
          >
            {isMicMuted ? (
              <>
                <MicOff className="w-3.5 h-3.5 text-red-400" />
                <span className="hidden sm:inline">Mic Muted</span>
              </>
            ) : (
              <>
                <Mic className="w-3.5 h-3.5 text-cyan-300" />
                <span className="hidden sm:inline">Mic Active</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Center Ambient / Modals */}
      <ConfirmationModal
        pending={pendingConfirmation}
        onConfirm={(id) => handleConfirmAction(id, true)}
        onCancel={(id) => handleConfirmAction(id, false)}
        isProcessing={isConfirming}
      />

      <ImagePreviewModal
        image={previewImage || null}
        onClose={() => setPreviewImage(null)}
        onOpenFolder={(p) => handleExecuteCommand(`Open folder "${p}"`)}
      />

      <SystemDrawer
        isOpen={isSystemDrawerOpen}
        onClose={() => setIsSystemDrawerOpen(false)}
        onRunCommand={handleExecuteCommand}
      />

      {/* Bottom HUD & Command Engine */}
      <section className="relative z-10 w-full flex flex-col items-center justify-end pb-4 sm:pb-6 px-4 gap-2.5 pointer-events-none">
        {/* Audio unlock banner */}
        {needsUserGesture && systemState !== "ERROR" && (
          <div className="pointer-events-auto max-w-md w-full bg-slate-950/90 backdrop-blur-md border border-cyan-400/40 rounded-xl px-4 py-2.5 flex items-center justify-between gap-4 shadow-[0_0_30px_rgba(6,182,212,0.2)]">
            <div className="flex items-center gap-3 text-xs sm:text-sm text-cyan-100">
              <Volume2 className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>Tap once to activate microphone &amp; audio.</span>
            </div>
            <button
              type="button"
              onClick={unlockAndResumeAudio}
              className="px-3.5 py-1.5 rounded-lg bg-cyan-500 text-slate-950 font-semibold text-xs hover:bg-cyan-400 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Activate
            </button>
          </div>
        )}

        {/* Emergency Alert Banner */}
        {emergencyAlert && (
          <div className="pointer-events-auto max-w-lg w-full bg-red-950/90 border border-red-500/50 rounded-xl px-4 py-2.5 flex items-center justify-between gap-3 text-xs text-red-200">
            <span>{emergencyAlert}</span>
            <button
              type="button"
              onClick={() => setEmergencyAlert(null)}
              className="text-red-400 hover:text-white font-mono text-[11px]"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Voice link error notification */}
        {systemState === "ERROR" && errorMessage && (
          <div
            role="alert"
            className="pointer-events-auto max-w-lg w-full bg-red-950/85 backdrop-blur-md border border-red-500/40 rounded-xl px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-[0_0_35px_rgba(239,68,68,0.25)]"
          >
            <div className="space-y-0.5">
              <p className="text-xs font-mono text-red-300">
                {errorCode === "MIC_PERMISSION_DENIED"
                  ? "MICROPHONE PERMISSION REQUIRED"
                  : errorCode === "MISSING_API_KEY"
                  ? "CONFIGURATION ERROR"
                  : "CONNECTION ERROR"}
              </p>
              <p className="text-xs sm:text-sm font-medium text-red-100">{errorMessage}</p>
            </div>
            <button
              type="button"
              onClick={reconnect}
              className="min-h-[36px] px-3 py-1.5 rounded-lg bg-red-500/25 border border-red-400/50 text-red-100 hover:bg-red-500/35 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* Active Desktop Task Status HUD */}
        <TaskStatusHUD
          currentTask={currentTask}
          onViewImage={setPreviewImage}
          onDismiss={() => setCurrentTask(null)}
        />

        {/* Transcript Overlay */}
        <TranscriptOverlay
          transcripts={transcripts}
          isOpen={showTranscript}
          onClear={clearTranscripts}
        />

        {/* Audio Waveform */}
        <AudioWaveform
          systemState={systemState}
          sampleAudioMetrics={sampleAudioMetrics}
        />

        {/* Voice State Indicator */}
        <div className="flex flex-col items-center text-center gap-0.5">
          <div className="flex items-center gap-2 font-display text-sm sm:text-base font-semibold tracking-[0.18em]">
            <span className={currentDisplay.dotColor} aria-hidden="true">
              {currentDisplay.symbol}
            </span>
            <span className={currentDisplay.textColor}>
              {isMicMuted && systemState === "LISTENING"
                ? "MICROPHONE MUTED"
                : currentDisplay.label}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 max-w-md text-balance">
            {isMicMuted
              ? "Unmute microphone to speak hands-free, or use the command bar below"
              : currentDisplay.subtext}
          </p>
        </div>

        {/* Natural Language Command Bar */}
        <CommandBar
          onSubmit={handleExecuteCommand}
          isLoading={isTaskLoading}
          onEmergencyStop={handleEmergencyStop}
        />
      </section>
    </div>
  );
}
