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
