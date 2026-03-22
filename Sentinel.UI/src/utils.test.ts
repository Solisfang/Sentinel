import { describe, it, expect } from 'vitest';
import {
  formatTime,
  formatDuration,
  formatSnoozeTime,
  getTimerDuration,
  calculateGoalProgress,
  isPresetActive,
  defaultSettings,
  PRESETS,
} from './utils';

describe('formatTime', () => {
  it('formats zero seconds as 00:00', () => {
    expect(formatTime(0)).toBe('00:00');
  });

  it('formats seconds only', () => {
    expect(formatTime(45)).toBe('00:45');
  });

  it('formats minutes and seconds', () => {
    expect(formatTime(125)).toBe('02:05');
  });

  it('formats 25 minutes (pomodoro default)', () => {
    expect(formatTime(1500)).toBe('25:00');
  });

  it('pads single digit minutes and seconds', () => {
    expect(formatTime(61)).toBe('01:01');
  });

  it('handles large values', () => {
    expect(formatTime(3661)).toBe('61:01');
  });
});

describe('formatDuration', () => {
  it('shows minutes for short durations', () => {
    expect(formatDuration(300)).toBe('5m');
  });

  it('shows hours and minutes for long durations', () => {
    expect(formatDuration(5400)).toBe('1h 30m');
  });

  it('shows 0m for zero seconds', () => {
    expect(formatDuration(0)).toBe('0m');
  });

  it('rounds down partial minutes', () => {
    expect(formatDuration(90)).toBe('1m');
  });

  it('handles exactly one hour', () => {
    expect(formatDuration(3600)).toBe('1h 0m');
  });
});

describe('formatSnoozeTime', () => {
  it('shows seconds when under 60', () => {
    expect(formatSnoozeTime(45)).toBe('45s');
  });

  it('shows minutes when 60 or more', () => {
    expect(formatSnoozeTime(120)).toBe('2m');
  });

  it('shows minutes at exactly 60', () => {
    expect(formatSnoozeTime(60)).toBe('1m');
  });

  it('shows 0s for zero', () => {
    expect(formatSnoozeTime(0)).toBe('0s');
  });
});

describe('getTimerDuration', () => {
  it('returns pomodoro duration in seconds', () => {
    expect(getTimerDuration('pomodoro', defaultSettings)).toBe(1500);
  });

  it('returns short break duration in seconds', () => {
    expect(getTimerDuration('shortBreak', defaultSettings)).toBe(300);
  });

  it('returns long break duration in seconds', () => {
    expect(getTimerDuration('longBreak', defaultSettings)).toBe(900);
  });

  it('uses custom settings', () => {
    const custom = { ...defaultSettings, pomodoroMinutes: 50 };
    expect(getTimerDuration('pomodoro', custom)).toBe(3000);
  });
});

describe('calculateGoalProgress', () => {
  it('returns 0 when no sessions completed', () => {
    expect(calculateGoalProgress(0, defaultSettings)).toBe(0);
  });

  it('calculates progress correctly', () => {
    // 2 sessions * 25 min = 50 min of 120 min goal = 42%
    expect(calculateGoalProgress(2, defaultSettings)).toBe(42);
  });

  it('caps at 100%', () => {
    // 10 sessions * 25 min = 250 min of 120 min goal = 208% → capped at 100
    expect(calculateGoalProgress(10, defaultSettings)).toBe(100);
  });

  it('returns 0 when goal is 0', () => {
    const s = { ...defaultSettings, dailyFocusGoalMinutes: 0 };
    expect(calculateGoalProgress(5, s)).toBe(0);
  });

  it('handles exact goal completion', () => {
    // dailyFocusGoalMinutes=50, pomodoroMinutes=25, 2 sessions = 50 min = 100%
    const s = { ...defaultSettings, dailyFocusGoalMinutes: 50 };
    expect(calculateGoalProgress(2, s)).toBe(100);
  });
});

describe('isPresetActive', () => {
  it('detects Classic preset', () => {
    expect(isPresetActive(defaultSettings, PRESETS[0])).toBe(true);
  });

  it('returns false for non-matching preset', () => {
    expect(isPresetActive(defaultSettings, PRESETS[1])).toBe(false);
  });

  it('detects Deep Work preset', () => {
    const s = { ...defaultSettings, pomodoroMinutes: 50, shortBreakMinutes: 10, longBreakMinutes: 20 };
    expect(isPresetActive(s, PRESETS[1])).toBe(true);
  });

  it('detects Sprint preset', () => {
    const s = { ...defaultSettings, pomodoroMinutes: 15, shortBreakMinutes: 3, longBreakMinutes: 10 };
    expect(isPresetActive(s, PRESETS[2])).toBe(true);
  });
});

describe('PRESETS', () => {
  it('has 3 presets', () => {
    expect(PRESETS).toHaveLength(3);
  });

  it('each preset has valid durations', () => {
    for (const preset of PRESETS) {
      expect(preset.focus).toBeGreaterThan(0);
      expect(preset.shortBreak).toBeGreaterThan(0);
      expect(preset.longBreak).toBeGreaterThan(0);
      expect(preset.longBreak).toBeGreaterThan(preset.shortBreak);
    }
  });
});

// P3-1: Timer anchor drift-correction logic (extracted from App.tsx useEffect)
describe('anchor-based timer calculation', () => {
  // This mirrors the formula used in App.tsx timer useEffect:
  // remaining = Math.max(0, anchor.startTimeLeft - Math.floor((now - anchor.startedAt) / 1000))
  function computeRemaining(anchor: { startedAt: number; startTimeLeft: number }, now: number) {
    const elapsed = Math.floor((now - anchor.startedAt) / 1000);
    return Math.max(0, anchor.startTimeLeft - elapsed);
  }

  it('returns full time when no time has elapsed', () => {
    const anchor = { startedAt: 1000000, startTimeLeft: 1500 };
    expect(computeRemaining(anchor, 1000000)).toBe(1500);
  });

  it('decrements correctly after 10 seconds', () => {
    const anchor = { startedAt: 1000000, startTimeLeft: 1500 };
    expect(computeRemaining(anchor, 1000000 + 10_000)).toBe(1490);
  });

  it('reaches zero at exact duration', () => {
    const anchor = { startedAt: 1000000, startTimeLeft: 1500 };
    expect(computeRemaining(anchor, 1000000 + 1_500_000)).toBe(0);
  });

  it('clamps to zero when elapsed exceeds duration', () => {
    const anchor = { startedAt: 1000000, startTimeLeft: 1500 };
    expect(computeRemaining(anchor, 1000000 + 2_000_000)).toBe(0);
  });

  it('is immune to interval drift by using wall-clock delta', () => {
    // Simulate setInterval running 50ms late on each tick
    const anchor = { startedAt: 0, startTimeLeft: 100 };
    // After "10 seconds" of wall-clock time, regardless of drift
    expect(computeRemaining(anchor, 10_000)).toBe(90);
    expect(computeRemaining(anchor, 10_050)).toBe(90); // Still 90 (sub-second)
    expect(computeRemaining(anchor, 10_999)).toBe(90); // Still 90 until 11s
    expect(computeRemaining(anchor, 11_000)).toBe(89);
  });

  it('handles pause-resume by creating new anchor', () => {
    // First run: 10 seconds into 25-min session
    const anchor1 = { startedAt: 0, startTimeLeft: 1500 };
    const remaining = computeRemaining(anchor1, 10_000);
    expect(remaining).toBe(1490);

    // Pause and resume: new anchor starts at remaining time
    const anchor2 = { startedAt: 50_000, startTimeLeft: remaining };
    expect(computeRemaining(anchor2, 50_000)).toBe(1490);
    expect(computeRemaining(anchor2, 60_000)).toBe(1480);
  });

  it('handles mode switch to short break', () => {
    const breakAnchor = { startedAt: 0, startTimeLeft: 300 }; // 5 min break
    expect(computeRemaining(breakAnchor, 150_000)).toBe(150);
    expect(computeRemaining(breakAnchor, 300_000)).toBe(0);
  });
});
