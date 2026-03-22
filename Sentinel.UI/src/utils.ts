export interface TimerPreset {
  name: string;
  focus: number;
  shortBreak: number;
  longBreak: number;
}

export const PRESETS: TimerPreset[] = [
  { name: 'Classic', focus: 25, shortBreak: 5, longBreak: 15 },
  { name: 'Deep Work', focus: 50, shortBreak: 10, longBreak: 20 },
  { name: 'Sprint', focus: 15, shortBreak: 3, longBreak: 10 },
];

export type TimerMode = 'pomodoro' | 'shortBreak' | 'longBreak';

export type OverlayStyle = 'pill' | 'compact' | 'monitoring';

export interface Settings {
  pomodoroMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  idleThresholdSeconds: number;
  cloudSyncEnabled: boolean;
  soundEnabled: boolean;
  alwaysOnTop: boolean;
  suppressDuringMedia: boolean;
  dailyFocusGoalMinutes: number;
  overlayStyle: OverlayStyle;
  customPresets: TimerPreset[];
}

export const defaultSettings: Settings = {
  pomodoroMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  idleThresholdSeconds: 45,
  cloudSyncEnabled: false,
  soundEnabled: true,
  alwaysOnTop: false,
  suppressDuringMedia: true,
  dailyFocusGoalMinutes: 120,
  overlayStyle: 'compact',
  customPresets: [],
};

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatSnoozeTime(seconds: number): string {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    return `${m}m`;
  }
  return `${seconds}s`;
}

export function getTimerDuration(mode: TimerMode, settings: Settings): number {
  switch (mode) {
    case 'pomodoro': return settings.pomodoroMinutes * 60;
    case 'shortBreak': return settings.shortBreakMinutes * 60;
    case 'longBreak': return settings.longBreakMinutes * 60;
  }
}

export function calculateGoalProgress(sessionsCompleted: number, settings: Settings): number {
  const todayFocusSeconds = sessionsCompleted * settings.pomodoroMinutes * 60;
  if (settings.dailyFocusGoalMinutes <= 0) return 0;
  return Math.min(100, Math.round((todayFocusSeconds / (settings.dailyFocusGoalMinutes * 60)) * 100));
}

export function isPresetActive(settings: Settings, preset: TimerPreset): boolean {
  return (
    settings.pomodoroMinutes === preset.focus &&
    settings.shortBreakMinutes === preset.shortBreak &&
    settings.longBreakMinutes === preset.longBreak
  );
}
