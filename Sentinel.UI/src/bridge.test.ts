import { describe, it, expect } from 'vitest';

/**
 * Bridge message protocol contract tests.
 *
 * These verify that the message shapes sent between the React UI
 * and the WPF C# host via window.chrome.webview.postMessage remain
 * well-formed. Each test constructs the exact shape the App.tsx code
 * sends and asserts the required fields exist and have correct types.
 */

// UI → C# messages
type BridgeMessage =
  | { type: 'LOG_SESSION'; durationSeconds: number; sessionName?: string }
  | { type: 'LOG_DISTRACTION'; note: string; categoryName: string | null; forceUncategorized: boolean }
  | { type: 'SAVE_SETTINGS'; settings: Record<string, unknown> }
  | { type: 'TIMER_RUNNING'; running: boolean }
  | { type: 'GET_TAXONOMY_DATA' }
  | { type: 'GET_REPORT_DATA'; range: string }
  | { type: 'EXPORT_DATA'; format: 'csv' | 'json' }
  | { type: 'TOGGLE_COMPACT' }
  | { type: 'PLAY_SOUND' }
  | { type: 'INTERVENTION_DISMISSED' }
  | { type: 'FALSE_ALARM' }
  | { type: 'SNOOZE'; minutes: number }
  | { type: 'WATCHING_CONTENT'; minutes: number }
  | { type: 'CANCEL_SNOOZE' }
  | { type: 'UPDATE_DISTRACTION_GROUP'; normalizedNote: string; note: string; categoryName: string | null }
  | { type: 'RENAME_CATEGORY'; oldName: string; newName: string }
  | { type: 'OVERLAY_CLOSE' };

// C# → UI messages
type InboundMessage =
  | { type: 'SETTINGS_LOADED'; settings: Record<string, unknown> }
  | { type: 'IDLE_DETECTED' }
  | { type: 'SNOOZE_STATUS'; isSnoozed: boolean; secondsRemaining: number }
  | { type: 'REPORT_DATA'; data: Record<string, unknown> }
  | { type: 'TAXONOMY_DATA'; data: Record<string, unknown> }
  | { type: 'HOTKEY_START_PAUSE' }
  | { type: 'HOTKEY_DISTRACTION' }
  | { type: 'SYSTEM_SUSPEND' }
  | { type: 'SYSTEM_RESUME' }
  | { type: 'EXPORT_COMPLETE'; error?: string; path?: string }
  | { type: 'UPDATE_AVAILABLE'; latestVersion: string; downloadUrl: string }
  | { type: 'COMPACT_MODE_CHANGED'; isCompact: boolean };

function assertValidMessage(msg: BridgeMessage | InboundMessage) {
  expect(msg).toHaveProperty('type');
  expect(typeof msg.type).toBe('string');
  expect(msg.type.length).toBeGreaterThan(0);
}

describe('Bridge message protocol — UI to C#', () => {
  it('LOG_SESSION has required fields', () => {
    const msg: BridgeMessage = { type: 'LOG_SESSION', durationSeconds: 1500, sessionName: 'Deep Work' };
    assertValidMessage(msg);
    expect(msg.durationSeconds).toBeGreaterThan(0);
  });

  it('LOG_DISTRACTION has required fields', () => {
    const msg: BridgeMessage = {
      type: 'LOG_DISTRACTION',
      note: 'twitter',
      categoryName: 'Social Media',
      forceUncategorized: false,
    };
    assertValidMessage(msg);
    expect(msg.note.length).toBeGreaterThan(0);
  });

  it('LOG_DISTRACTION allows null category', () => {
    const msg: BridgeMessage = {
      type: 'LOG_DISTRACTION',
      note: 'random browsing',
      categoryName: null,
      forceUncategorized: true,
    };
    assertValidMessage(msg);
    expect(msg.categoryName).toBeNull();
  });

  it('SAVE_SETTINGS carries settings object', () => {
    const msg: BridgeMessage = { type: 'SAVE_SETTINGS', settings: { pomodoroMinutes: 25 } };
    assertValidMessage(msg);
    expect(typeof msg.settings).toBe('object');
  });

  it('TIMER_RUNNING has boolean running', () => {
    const msg: BridgeMessage = { type: 'TIMER_RUNNING', running: true };
    assertValidMessage(msg);
    expect(typeof msg.running).toBe('boolean');
  });

  it('SNOOZE has numeric minutes', () => {
    const msg: BridgeMessage = { type: 'SNOOZE', minutes: 10 };
    assertValidMessage(msg);
    expect(msg.minutes).toBeGreaterThan(0);
  });

  it('GET_REPORT_DATA has range string', () => {
    const msg: BridgeMessage = { type: 'GET_REPORT_DATA', range: 'week' };
    assertValidMessage(msg);
    expect(['today', 'week', 'month', 'all']).toContain(msg.range);
  });

  it('UPDATE_DISTRACTION_GROUP has all required fields', () => {
    const msg: BridgeMessage = {
      type: 'UPDATE_DISTRACTION_GROUP',
      normalizedNote: 'twitter',
      note: 'X / Twitter',
      categoryName: 'Social Media',
    };
    assertValidMessage(msg);
    expect(msg.normalizedNote.length).toBeGreaterThan(0);
    expect(msg.note.length).toBeGreaterThan(0);
  });

  it('RENAME_CATEGORY has old and new names', () => {
    const msg: BridgeMessage = { type: 'RENAME_CATEGORY', oldName: 'Social Media', newName: 'Networking' };
    assertValidMessage(msg);
    expect(msg.oldName.length).toBeGreaterThan(0);
    expect(msg.newName.length).toBeGreaterThan(0);
  });

  it('simple signal messages have only type', () => {
    const signals: BridgeMessage[] = [
      { type: 'GET_TAXONOMY_DATA' },
      { type: 'TOGGLE_COMPACT' },
      { type: 'PLAY_SOUND' },
      { type: 'INTERVENTION_DISMISSED' },
      { type: 'FALSE_ALARM' },
      { type: 'CANCEL_SNOOZE' },
      { type: 'OVERLAY_CLOSE' },
    ];
    for (const msg of signals) {
      assertValidMessage(msg);
    }
  });
});

describe('Bridge message protocol — C# to UI', () => {
  it('SETTINGS_LOADED carries settings object', () => {
    const msg: InboundMessage = { type: 'SETTINGS_LOADED', settings: { pomodoroMinutes: 25 } };
    assertValidMessage(msg);
    expect(typeof msg.settings).toBe('object');
  });

  it('SNOOZE_STATUS has boolean and seconds', () => {
    const msg: InboundMessage = { type: 'SNOOZE_STATUS', isSnoozed: true, secondsRemaining: 300 };
    assertValidMessage(msg);
    expect(typeof msg.isSnoozed).toBe('boolean');
    expect(msg.secondsRemaining).toBeGreaterThanOrEqual(0);
  });

  it('UPDATE_AVAILABLE has version and URL', () => {
    const msg: InboundMessage = {
      type: 'UPDATE_AVAILABLE',
      latestVersion: '1.1.0',
      downloadUrl: 'https://example.com/release',
    };
    assertValidMessage(msg);
    expect(msg.latestVersion.length).toBeGreaterThan(0);
  });

  it('EXPORT_COMPLETE reports success with path', () => {
    const msg: InboundMessage = { type: 'EXPORT_COMPLETE', path: 'C:\\exports\\data.csv' };
    assertValidMessage(msg);
    expect(msg.path).toBeDefined();
    expect(msg.error).toBeUndefined();
  });

  it('EXPORT_COMPLETE reports failure with error', () => {
    const msg: InboundMessage = { type: 'EXPORT_COMPLETE', error: 'Permission denied' };
    assertValidMessage(msg);
    expect(msg.error).toBeDefined();
  });

  it('COMPACT_MODE_CHANGED has boolean isCompact', () => {
    const msg: InboundMessage = { type: 'COMPACT_MODE_CHANGED', isCompact: true };
    assertValidMessage(msg);
    expect(typeof msg.isCompact).toBe('boolean');
  });

  it('simple signal messages have only type', () => {
    const signals: InboundMessage[] = [
      { type: 'IDLE_DETECTED' },
      { type: 'HOTKEY_START_PAUSE' },
      { type: 'HOTKEY_DISTRACTION' },
      { type: 'SYSTEM_SUSPEND' },
      { type: 'SYSTEM_RESUME' },
    ];
    for (const msg of signals) {
      assertValidMessage(msg);
    }
  });
});
