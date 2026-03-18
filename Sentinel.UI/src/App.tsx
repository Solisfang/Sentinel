import { useState, useEffect, useCallback, useRef } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { db, auth } from './firebase';
import { collection, addDoc, serverTimestamp, query, where, orderBy, getDocs, Timestamp } from 'firebase/firestore';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';
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
import type { Settings, TimerMode, TimerPreset } from './utils';
import './index.css';

const COLORS = ['#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444'];

interface Distraction {
  note: string;
  timestamp: Date;
}

type View = 'timer' | 'settings' | 'auth' | 'reports';
type ReportRange = 'today' | 'week' | 'month' | 'all';

interface ReportData {
  totalFocusSeconds: number;
  sessionsCompleted: number;
  distractionsLogged: number;
  falseAlarms: number;
  avgSessionSeconds: number;
  dailyFocus: { date: string; focusSeconds: number; sessions: number; distractions: number }[];
  topDistractions: { name: string; count: number }[];
  recentSessions: { startedAt: string; durationSeconds: number; completed: boolean }[];
}

function App() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [view, setView] = useState<View>('timer');
  const [timerMode, setTimerMode] = useState<TimerMode>('pomodoro');
  const [timeLeft, setTimeLeft] = useState(settings.pomodoroMinutes * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [isPausedByIntervention, setIsPausedByIntervention] = useState(false);
  const [showIntervention, setShowIntervention] = useState(false);
  const [distractionInput, setDistractionInput] = useState('');
  const [distractions, setDistractions] = useState<Distraction[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [sessionsCompleted, setSessionsCompleted] = useState(0);
  const [isSnoozed, setIsSnoozed] = useState(false);
  const [snoozeSecondsRemaining, setSnoozeSecondsRemaining] = useState(0);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [reportRange, setReportRange] = useState<ReportRange>('week');
  const [reportLoading, setReportLoading] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return localStorage.getItem('sentinel_onboarded') !== 'true';
  });
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [sessionName, setSessionName] = useState('');
  const [showPresets, setShowPresets] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{ latestVersion: string; downloadUrl: string } | null>(null);
  const wasRunningRef = useRef(false);
  const handleStartPauseRef = useRef(() => {});

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;

        switch (data.type) {
          case 'SETTINGS_LOADED':
            setSettings(data.settings);
            setTimeLeft(data.settings.pomodoroMinutes * 60);
            break;
          case 'IDLE_DETECTED':
            if (isRunning) {
              wasRunningRef.current = true;
              setIsRunning(false);
              setIsPausedByIntervention(true);
              setShowIntervention(true);
            }
            break;
          case 'SNOOZE_STATUS':
            setIsSnoozed(data.isSnoozed);
            setSnoozeSecondsRemaining(data.secondsRemaining);
            break;
          case 'REPORT_DATA':
            setReportData(data.data);
            setReportLoading(false);
            break;
          case 'HOTKEY_START_PAUSE':
            handleStartPauseRef.current();
            break;
          case 'HOTKEY_DISTRACTION':
            if (isRunning) {
              wasRunningRef.current = true;
              setIsRunning(false);
              setIsPausedByIntervention(true);
              setShowIntervention(true);
            }
            break;
          case 'SYSTEM_SUSPEND':
            if (isRunning) {
              wasRunningRef.current = true;
              setIsRunning(false);
            }
            break;
          case 'SYSTEM_RESUME':
            if (wasRunningRef.current) {
              setShowResumePrompt(true);
            }
            break;
          case 'EXPORT_COMPLETE':
            if (data.error) {
              setExportStatus(`Export failed: ${data.error}`);
            } else {
              setExportStatus(`Exported to ${data.path}`);
            }
            setTimeout(() => setExportStatus(null), 5000);
            break;
          case 'UPDATE_AVAILABLE':
            setUpdateInfo({ latestVersion: data.latestVersion, downloadUrl: data.downloadUrl });
            break;
        }
      } catch {
        // Ignore non-JSON messages
      }
    };

    const webview = (window as any).chrome?.webview;
    if (webview) {
      webview.addEventListener('message', handleMessage);
      return () => webview.removeEventListener('message', handleMessage);
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isRunning]);

  // Countdown for snooze indicator
  useEffect(() => {
    if (!isSnoozed || snoozeSecondsRemaining <= 0) return;
    const interval = setInterval(() => {
      setSnoozeSecondsRemaining(prev => {
        if (prev <= 1) {
          setIsSnoozed(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isSnoozed, snoozeSecondsRemaining]);

  // Timer countdown
  useEffect(() => {
    if (!isRunning || timeLeft <= 0) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          setIsRunning(false);
          setIsComplete(true);
          if (timerMode === 'pomodoro') {
            setSessionsCompleted(s => s + 1);
            postMessage({ type: 'LOG_SESSION', durationSeconds: getTimerDuration('pomodoro', settings), sessionName: sessionName || undefined });
            postMessage({ type: 'PLAY_SOUND' });
            syncSessionToFirestore();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, timeLeft, timerMode]);

  // Global keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showOnboarding) return;
        if (showPresets) {
          setShowPresets(false);
        } else if (showIntervention) {
          dismissIntervention();
        } else if (showResumePrompt) {
          handleResumeAfterSleep(false);
        } else if (view !== 'timer') {
          setView('timer');
        }
      }
      if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey) {
        if (showResumePrompt) {
          e.preventDefault();
          handleResumeAfterSleep(true);
        }
      }
      if (e.key === ' ' && view === 'timer' && !showIntervention && !showResumePrompt && !showOnboarding) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          handleStartPauseRef.current();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [view, showIntervention, showResumePrompt, showOnboarding, showPresets]);

  const completeOnboarding = () => {
    localStorage.setItem('sentinel_onboarded', 'true');
    setShowOnboarding(false);
  };

  const syncSessionToFirestore = useCallback(async () => {
    if (!user || !settings.cloudSyncEnabled) return;
    try {
      await addDoc(collection(db, 'sessions'), {
        userId: user.uid,
        duration: settings.pomodoroMinutes * 60,
        distractions: distractions.map(d => d.note),
        completedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('[Sentinel] Sync failed:', error);
    }
  }, [user, settings, distractions]);

  const postMessage = (message: object) => {
    const webview = (window as any).chrome?.webview;
    if (webview) {
      webview.postMessage(message);
    }
  };

  const saveSettings = (newSettings: Settings) => {
    setSettings(newSettings);
    postMessage({ type: 'SAVE_SETTINGS', settings: newSettings });
  };

  const handleModeChange = (mode: TimerMode) => {
    setTimerMode(mode);
    setTimeLeft(getTimerDuration(mode, settings));
    setIsRunning(false);
    setIsComplete(false);
    setIsPausedByIntervention(false);
  };

  const applyPreset = (preset: TimerPreset) => {
    const newSettings = {
      ...settings,
      pomodoroMinutes: preset.focus,
      shortBreakMinutes: preset.shortBreak,
      longBreakMinutes: preset.longBreak,
    };
    saveSettings(newSettings);
    setTimeLeft(preset.focus * 60);
    setTimerMode('pomodoro');
    setIsRunning(false);
    setIsComplete(false);
    setShowPresets(false);
  };

  const handleStartPause = () => {
    if (isComplete) {
      setTimeLeft(getTimerDuration(timerMode, settings));
      setIsComplete(false);
      setDistractions([]);
    }
    setIsPausedByIntervention(false);
    setIsRunning(!isRunning);
  };
  handleStartPauseRef.current = handleStartPause;

  const handleResumeAfterSleep = (resume: boolean) => {
    setShowResumePrompt(false);
    if (resume) {
      setIsRunning(true);
    }
    wasRunningRef.current = false;
  };

  const handleExport = (format: 'csv' | 'json') => {
    postMessage({ type: 'EXPORT_DATA', format });
    setExportStatus('Exporting...');
  };

  const handleReset = () => {
    setTimeLeft(getTimerDuration(timerMode, settings));
    setIsRunning(false);
    setIsComplete(false);
    setIsPausedByIntervention(false);
  };

  const dismissIntervention = () => {
    setShowIntervention(false);
    setIsPausedByIntervention(false);
    if (wasRunningRef.current) {
      setIsRunning(true);
      wasRunningRef.current = false;
    }
  };

  const handleDistractionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!distractionInput.trim()) return;

    const newDistraction: Distraction = {
      note: distractionInput.trim(),
      timestamp: new Date(),
    };

    setDistractions((prev) => [...prev, newDistraction]);
    setDistractionInput('');
    postMessage({ type: 'LOG_DISTRACTION', note: newDistraction.note });

    if (user && settings.cloudSyncEnabled) {
      try {
        await addDoc(collection(db, 'distractions'), {
          userId: user.uid,
          note: newDistraction.note,
          timestamp: serverTimestamp(),
        });
      } catch (error) {
        console.error('[Sentinel] Sync failed:', error);
      }
    }

    dismissIntervention();
  };

  const handleFalseAlarm = () => {
    postMessage({ type: 'FALSE_ALARM' });
    dismissIntervention();
  };

  const handleSnooze = (minutes: number) => {
    postMessage({ type: 'SNOOZE', minutes });
    setIsSnoozed(true);
    setSnoozeSecondsRemaining(minutes * 60);
    dismissIntervention();
  };

  const handleWatchingContent = (minutes: number) => {
    postMessage({ type: 'WATCHING_CONTENT', minutes });
    setIsSnoozed(true);
    setSnoozeSecondsRemaining(minutes * 60);
    dismissIntervention();
  };

  const handleCancelSnooze = () => {
    postMessage({ type: 'CANCEL_SNOOZE' });
    setIsSnoozed(false);
    setSnoozeSecondsRemaining(0);
  };

  const requestReportData = (range: ReportRange) => {
    setReportRange(range);
    setReportLoading(true);
    postMessage({ type: 'GET_REPORT_DATA', range });
    // Also fetch from Firestore if cloud sync is enabled
    if (user && settings.cloudSyncEnabled) {
      fetchFirestoreHistory(range);
    }
  };

  const fetchFirestoreHistory = async (range: ReportRange) => {
    if (!user) return;
    try {
      const since = range === 'today'
        ? new Date(new Date().setHours(0, 0, 0, 0))
        : range === 'week'
        ? new Date(Date.now() - 7 * 86400000)
        : range === 'month'
        ? new Date(Date.now() - 30 * 86400000)
        : new Date(0);

      const sinceTs = Timestamp.fromDate(since);

      const sessionsSnap = await getDocs(
        query(
          collection(db, 'sessions'),
          where('userId', '==', user.uid),
          where('completedAt', '>=', sinceTs),
          orderBy('completedAt', 'desc')
        )
      );

      const distractionsSnap = await getDocs(
        query(
          collection(db, 'distractions'),
          where('userId', '==', user.uid),
          where('timestamp', '>=', sinceTs),
          orderBy('timestamp', 'desc')
        )
      );

      const cloudSessions = sessionsSnap.docs.map(d => d.data());
      const cloudDistractions = distractionsSnap.docs.map(d => d.data());

      setReportData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          // Append cloud counts to local counts
          sessionsCompleted: prev.sessionsCompleted + cloudSessions.length,
          totalFocusSeconds: prev.totalFocusSeconds + cloudSessions.reduce((sum, s) => sum + (s.duration || 0), 0),
          distractionsLogged: prev.distractionsLogged + cloudDistractions.length,
        };
      });

      console.log(`[Sentinel] Firestore: ${cloudSessions.length} sessions, ${cloudDistractions.length} distractions merged`);
    } catch (error) {
      console.error('[Sentinel] Firestore report fetch failed:', error);
    }
  };

  const openReports = () => {
    setView('reports');
    requestReportData(reportRange);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      await signInWithEmailAndPassword(auth, authEmail, authPassword);
      setView('timer');
    } catch (error: any) {
      setAuthError(error.message || 'Login failed');
    }
  };

  const handleSignup = async () => {
    setAuthError('');
    try {
      await createUserWithEmailAndPassword(auth, authEmail, authPassword);
      setView('timer');
    } catch (error: any) {
      setAuthError(error.message || 'Signup failed');
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const getChartData = () => {
    const counts: Record<string, number> = {};
    distractions.forEach((d) => {
      counts[d.note.toLowerCase()] = (counts[d.note.toLowerCase()] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  };

  const modeColor = timerMode === 'pomodoro' ? 'violet' : timerMode === 'shortBreak' ? 'emerald' : 'blue';

  // Daily goal progress
  const goalProgress = calculateGoalProgress(sessionsCompleted, settings);

  // Onboarding flow
  const onboardingSteps = [
    {
      title: 'Welcome to Sentinel',
      body: 'A privacy-first focus timer that gently nudges you back when you drift.',
    },
    {
      title: 'How It Works',
      body: 'Sentinel detects when you stop interacting with your PC and pauses to ask what distracted you.',
    },
    {
      title: 'Keyboard Shortcuts',
      body: 'Ctrl+Shift+S to start/pause. Ctrl+Shift+D to log a distraction. Space to toggle timer. Esc to go back.',
    },
    {
      title: 'Your Data Stays Local',
      body: 'Everything is stored on your machine. Cloud sync is opt-in via Settings.',
    },
  ];

  if (showOnboarding) {
    const step = onboardingSteps[onboardingStep];
    const isLast = onboardingStep === onboardingSteps.length - 1;
    return (
      <div className="h-full w-full flex items-center justify-center bg-transparent p-2">
        <div className="bg-zinc-900/95 backdrop-blur-sm rounded-xl p-5 w-full border border-violet-500/30 space-y-3 text-center">
          <div className="flex justify-center gap-1 mb-2">
            {onboardingSteps.map((_, i) => (
              <div key={i} className={`w-1.5 h-1.5 rounded-full transition-colors ${i === onboardingStep ? 'bg-violet-500' : 'bg-zinc-700'}`} />
            ))}
          </div>
          <p className="text-sm font-semibold text-white">{step.title}</p>
          <p className="text-[11px] text-zinc-400 leading-relaxed">{step.body}</p>
          <div className="flex gap-2 pt-1">
            {onboardingStep > 0 && (
              <button
                onClick={() => setOnboardingStep(s => s - 1)}
                className="flex-1 px-3 py-1.5 text-xs bg-zinc-800/60 text-zinc-300 rounded-lg hover:bg-zinc-700/60 border border-zinc-700/30 transition-colors"
                aria-label="Previous step"
              >
                Back
              </button>
            )}
            <button
              onClick={isLast ? completeOnboarding : () => setOnboardingStep(s => s + 1)}
              className="flex-1 px-3 py-1.5 text-xs bg-violet-600/90 text-white rounded-lg hover:bg-violet-500 transition-colors font-medium"
              autoFocus
              aria-label={isLast ? 'Start using Sentinel' : 'Next step'}
            >
              {isLast ? "Let's Go" : 'Next'}
            </button>
          </div>
          {onboardingStep === 0 && (
            <button
              onClick={completeOnboarding}
              className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Skip intro
            </button>
          )}
        </div>
      </div>
    );
  }

  // Resume after sleep prompt
  if (showResumePrompt) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-transparent p-2" role="dialog" aria-label="Resume session">
        <div className="bg-zinc-900/95 backdrop-blur-sm rounded-xl p-4 w-full border border-violet-500/30 space-y-3">
          <p className="text-sm font-semibold text-white text-center">Welcome back!</p>
          <p className="text-[10px] text-zinc-500 text-center">Your session was paused during sleep. Press Enter to resume or Esc to start fresh.</p>
          <div className="flex gap-2">
            <button
              onClick={() => handleResumeAfterSleep(true)}
              autoFocus
              className="flex-1 px-3 py-1.5 text-xs bg-violet-600/90 text-white rounded-lg hover:bg-violet-500 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-400/50"
            >
              Resume
            </button>
            <button
              onClick={() => handleResumeAfterSleep(false)}
              className="flex-1 px-3 py-1.5 text-xs bg-zinc-800/60 text-zinc-300 rounded-lg hover:bg-zinc-700/60 border border-zinc-700/30 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-400/50"
            >
              Start Fresh
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Intervention Modal
  if (showIntervention) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-transparent p-2" role="dialog" aria-label="Distraction intervention">
        <div className="bg-zinc-900/95 backdrop-blur-sm rounded-xl p-4 w-full border border-violet-500/30 space-y-3">
          {/* Header */}
          <div className="text-center">
            <p className="text-sm font-semibold text-white">Hey, still focused?</p>
            <p className="text-[10px] text-zinc-500 mt-0.5">Timer paused — press Esc to dismiss</p>
          </div>

          {/* Log Distraction */}
          <form onSubmit={handleDistractionSubmit} className="space-y-1.5">
            <input
              type="text"
              value={distractionInput}
              onChange={(e) => setDistractionInput(e.target.value)}
              placeholder="What distracted you?"
              autoFocus
              aria-label="Distraction note"
              className="w-full px-3 py-1.5 text-xs bg-zinc-800/80 text-white rounded-lg border border-zinc-700/50 focus:border-violet-500/50 focus:outline-none focus:ring-2 focus:ring-violet-400/30 placeholder-zinc-500"
            />
            <button
              type="submit"
              disabled={!distractionInput.trim()}
              className="w-full px-3 py-1.5 text-xs font-medium bg-violet-600/90 text-white rounded-lg hover:bg-violet-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-violet-400/50"
            >
              Log Distraction
            </button>
          </form>

          {/* False Alarm */}
          <button
            onClick={handleFalseAlarm}
            className="w-full px-3 py-1.5 text-xs bg-zinc-800/60 text-zinc-300 rounded-lg hover:bg-zinc-700/60 border border-zinc-700/30 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-400/50"
          >
            False Alarm — I'm focused
          </button>

          {/* Snooze Options */}
          <div>
            <p className="text-[10px] text-zinc-500 mb-1.5">Snooze idle detection</p>
            <div className="flex gap-1.5" role="group" aria-label="Snooze duration">
              {[5, 10, 30].map((min) => (
                <button
                  key={min}
                  onClick={() => handleSnooze(min)}
                  aria-label={`Snooze for ${min} minutes`}
                  className="flex-1 px-2 py-1.5 text-[10px] bg-zinc-800/60 text-zinc-400 rounded-lg hover:bg-zinc-700/60 hover:text-zinc-200 border border-zinc-700/30 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-400/50"
                >
                  {min}m
                </button>
              ))}
            </div>
          </div>

          {/* Watching Content */}
          <div>
            <p className="text-[10px] text-zinc-500 mb-1.5">Watching content</p>
            <div className="flex gap-1.5" role="group" aria-label="Watch duration">
              {[30, 60, 90].map((min) => (
                <button
                  key={min}
                  onClick={() => handleWatchingContent(min)}
                  aria-label={`Watch content for ${min} minutes`}
                  className="flex-1 px-2 py-1.5 text-[10px] bg-zinc-800/60 text-zinc-400 rounded-lg hover:bg-zinc-700/60 hover:text-zinc-200 border border-zinc-700/30 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-400/50"
                >
                  {min}m
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Reports View
  if (view === 'reports') {
    const ranges: { key: ReportRange; label: string }[] = [
      { key: 'today', label: 'Today' },
      { key: 'week', label: 'Week' },
      { key: 'month', label: 'Month' },
      { key: 'all', label: 'All' },
    ];

    return (
      <div className="h-full w-full flex flex-col bg-transparent p-3 overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-zinc-400 font-medium">Reports</span>
          <button onClick={() => setView('timer')} className="text-xs text-zinc-500 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-violet-400/50 rounded" aria-label="Back to timer">← Esc</button>
        </div>

        {/* Range Filter */}
        <div className="flex gap-1 mb-3">
          {ranges.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => requestReportData(key)}
              className={`flex-1 px-1.5 py-1 text-[10px] rounded-md transition-colors ${
                reportRange === key
                  ? 'bg-violet-600/90 text-white'
                  : 'text-zinc-500 hover:text-zinc-300 bg-zinc-800/40'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {reportLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-[10px] text-zinc-500 animate-pulse">Loading...</span>
          </div>
        ) : reportData ? (
          <div className="space-y-3">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 gap-1.5">
              <div className="bg-zinc-800/50 rounded-lg p-2 border border-zinc-700/30">
                <p className="text-[10px] text-zinc-500">Focus Time</p>
                <p className="text-sm text-white font-medium">{formatDuration(reportData.totalFocusSeconds)}</p>
              </div>
              <div className="bg-zinc-800/50 rounded-lg p-2 border border-zinc-700/30">
                <p className="text-[10px] text-zinc-500">Sessions</p>
                <p className="text-sm text-white font-medium">{reportData.sessionsCompleted}</p>
              </div>
              <div className="bg-zinc-800/50 rounded-lg p-2 border border-zinc-700/30">
                <p className="text-[10px] text-zinc-500">Distractions</p>
                <p className="text-sm text-amber-400 font-medium">{reportData.distractionsLogged}</p>
              </div>
              <div className="bg-zinc-800/50 rounded-lg p-2 border border-zinc-700/30">
                <p className="text-[10px] text-zinc-500">Avg Session</p>
                <p className="text-sm text-white font-medium">{formatDuration(Math.round(reportData.avgSessionSeconds))}</p>
              </div>
            </div>

            {/* Daily Focus Bar Chart */}
            {reportData.dailyFocus.length > 0 && (
              <div>
                <p className="text-[10px] text-zinc-500 mb-1">Daily Focus (min)</p>
                <div className="h-24 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reportData.dailyFocus.map(d => ({ ...d, focusMin: Math.round(d.focusSeconds / 60) }))}>
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#666' }} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip
                        contentStyle={{ background: '#1e1e22', border: '1px solid #333', borderRadius: 8, fontSize: 10 }}
                        labelStyle={{ color: '#999' }}
                        itemStyle={{ color: '#a78bfa' }}
                        formatter={(value) => [`${value}m`, 'Focus']}
                      />
                      <Bar dataKey="focusMin" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Distraction Breakdown */}
            {reportData.topDistractions.length > 0 && (
              <div>
                <p className="text-[10px] text-zinc-500 mb-1">Top Distractions</p>
                <div className="flex gap-2">
                  <div className="w-16 h-16 shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={reportData.topDistractions.map(d => ({ name: d.name, value: d.count }))} cx="50%" cy="50%" innerRadius={10} outerRadius={24} dataKey="value">
                          {reportData.topDistractions.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex-1 space-y-0.5 overflow-hidden">
                    {reportData.topDistractions.slice(0, 4).map((d, i) => (
                      <div key={d.name} className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                        <span className="text-[10px] text-zinc-400 truncate">{d.name}</span>
                        <span className="text-[10px] text-zinc-600 ml-auto">{d.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Recent Sessions */}
            {reportData.recentSessions.length > 0 && (
              <div>
                <p className="text-[10px] text-zinc-500 mb-1">Recent Sessions</p>
                <div className="space-y-1 max-h-20 overflow-y-auto">
                  {reportData.recentSessions.slice(0, 5).map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-[10px] bg-zinc-800/30 rounded px-2 py-1">
                      <span className="text-zinc-400">{new Date(s.startedAt).toLocaleDateString()}</span>
                      <span className="text-zinc-300">{formatDuration(s.durationSeconds)}</span>
                      <span className={s.completed ? 'text-emerald-400' : 'text-zinc-600'}>{s.completed ? 'Done' : 'Inc.'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* False Alarm Ratio */}
            {(reportData.distractionsLogged + reportData.falseAlarms) > 0 && (
              <div className="text-[10px] text-zinc-500 text-center">
                False alarms: {reportData.falseAlarms} / {reportData.distractionsLogged + reportData.falseAlarms} total ({Math.round(reportData.falseAlarms / (reportData.distractionsLogged + reportData.falseAlarms) * 100)}%)
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-[10px] text-zinc-500">No data available</span>
          </div>
        )}
      </div>
    );
  }

  // Auth View
  if (view === 'auth') {
    return (
      <div className="h-full w-full flex flex-col bg-transparent p-3 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-zinc-400 font-medium">Account</span>
          <button onClick={() => setView('timer')} className="text-xs text-zinc-500 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-violet-400/50 rounded" aria-label="Back to timer">← Esc</button>
        </div>

        {user ? (
          <div className="space-y-2">
            <p className="text-xs text-zinc-300 truncate">{user.email}</p>
            <button
              onClick={handleLogout}
              className="w-full px-3 py-1.5 text-xs bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600/30 transition-colors"
            >
              Logout
            </button>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="space-y-2">
            <input
              type="email"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              placeholder="Email"
              className="w-full px-2 py-1.5 text-xs bg-zinc-800/80 text-white rounded-lg border border-zinc-700/50 focus:border-violet-500/50 focus:outline-none"
            />
            <input
              type="password"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              placeholder="Password"
              className="w-full px-2 py-1.5 text-xs bg-zinc-800/80 text-white rounded-lg border border-zinc-700/50 focus:border-violet-500/50 focus:outline-none"
            />
            {authError && <p className="text-xs text-red-400">{authError}</p>}
            <div className="flex gap-2">
              <button type="submit" className="flex-1 px-2 py-1.5 text-xs bg-violet-600/90 text-white rounded-lg hover:bg-violet-500 transition-colors">
                Login
              </button>
              <button type="button" onClick={handleSignup} className="flex-1 px-2 py-1.5 text-xs bg-zinc-700/80 text-white rounded-lg hover:bg-zinc-600 transition-colors">
                Sign Up
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  // Settings View
  if (view === 'settings') {
    return (
      <div className="h-full w-full flex flex-col bg-transparent p-3 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-zinc-400 font-medium">Settings</span>
          <button onClick={() => setView('timer')} className="text-xs text-zinc-500 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-violet-400/50 rounded" aria-label="Back to timer">← Esc</button>
        </div>

        <div className="space-y-2.5 text-xs">
          {/* Timer Durations */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-zinc-500 block mb-1">Focus</label>
              <input
                type="number"
                value={settings.pomodoroMinutes}
                onChange={(e) => saveSettings({ ...settings, pomodoroMinutes: +e.target.value })}
                className="w-full px-2 py-1 bg-zinc-800/80 text-white rounded-lg border border-zinc-700/50 text-center"
                min={1} max={120}
              />
            </div>
            <div>
              <label className="text-zinc-500 block mb-1">Short</label>
              <input
                type="number"
                value={settings.shortBreakMinutes}
                onChange={(e) => saveSettings({ ...settings, shortBreakMinutes: +e.target.value })}
                className="w-full px-2 py-1 bg-zinc-800/80 text-white rounded-lg border border-zinc-700/50 text-center"
                min={1} max={30}
              />
            </div>
            <div>
              <label className="text-zinc-500 block mb-1">Long</label>
              <input
                type="number"
                value={settings.longBreakMinutes}
                onChange={(e) => saveSettings({ ...settings, longBreakMinutes: +e.target.value })}
                className="w-full px-2 py-1 bg-zinc-800/80 text-white rounded-lg border border-zinc-700/50 text-center"
                min={1} max={60}
              />
            </div>
          </div>

          {/* Timer Presets */}
          <div>
            <label className="text-zinc-500 block mb-1">Presets</label>
            <div className="flex gap-1.5">
              {PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => applyPreset(preset)}
                  className={`flex-1 px-1.5 py-1.5 text-[10px] rounded-lg border transition-colors ${
                    isPresetActive(settings, preset)
                      ? 'bg-violet-600/30 border-violet-500/50 text-violet-300'
                      : 'bg-zinc-800/60 border-zinc-700/30 text-zinc-400 hover:bg-zinc-700/60 hover:text-zinc-200'
                  }`}
                >
                  <span className="block font-medium">{preset.name}</span>
                  <span className="block text-[8px] opacity-60">{preset.focus}/{preset.shortBreak}/{preset.longBreak}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Idle Detection */}
          <div>
            <label className="text-zinc-500 block mb-1">Idle Detection (sec)</label>
            <input
              type="number"
              value={settings.idleThresholdSeconds}
              onChange={(e) => saveSettings({ ...settings, idleThresholdSeconds: +e.target.value })}
              className="w-full px-2 py-1 bg-zinc-800/80 text-white rounded-lg border border-zinc-700/50"
              min={10} max={300}
            />
          </div>

          {/* Toggles */}
          <div className="space-y-2">
            {[
              { label: 'Cloud Sync', key: 'cloudSyncEnabled' as const },
              { label: 'Always on Top', key: 'alwaysOnTop' as const },
              { label: 'Sound', key: 'soundEnabled' as const },
              { label: 'Media Suppress', key: 'suppressDuringMedia' as const },
            ].map(({ label, key }) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-zinc-400">{label}</span>
                <button
                  onClick={() => saveSettings({ ...settings, [key]: !settings[key] })}
                  className={`w-9 h-5 rounded-full transition-colors relative ${settings[key] ? 'bg-violet-600' : 'bg-zinc-700'}`}
                >
                  <div className={`w-3.5 h-3.5 bg-white rounded-full absolute top-0.5 transition-all ${settings[key] ? 'left-[18px]' : 'left-[3px]'}`} />
                </button>
              </div>
            ))}
          </div>

          {/* Daily Focus Goal */}
          <div>
            <label className="text-zinc-500 block mb-1">Daily Goal (min)</label>
            <input
              type="number"
              value={settings.dailyFocusGoalMinutes}
              onChange={(e) => saveSettings({ ...settings, dailyFocusGoalMinutes: +e.target.value })}
              className="w-full px-2 py-1 bg-zinc-800/80 text-white rounded-lg border border-zinc-700/50"
              min={0} max={600}
            />
          </div>

          {/* Data Export */}
          <div>
            <label className="text-zinc-500 block mb-1">Export Data</label>
            <div className="flex gap-2">
              <button
                onClick={() => handleExport('json')}
                className="flex-1 px-2 py-1.5 bg-zinc-800/60 text-zinc-300 rounded-lg hover:bg-zinc-700/60 border border-zinc-700/30 transition-colors"
              >
                JSON
              </button>
              <button
                onClick={() => handleExport('csv')}
                className="flex-1 px-2 py-1.5 bg-zinc-800/60 text-zinc-300 rounded-lg hover:bg-zinc-700/60 border border-zinc-700/30 transition-colors"
              >
                CSV
              </button>
            </div>
            {exportStatus && <p className="text-[10px] text-zinc-500 mt-1 truncate">{exportStatus}</p>}
          </div>

          {/* Update Banner */}
          {updateInfo && (
            <div className="bg-violet-600/20 border border-violet-500/30 rounded-lg p-2">
              <p className="text-[10px] text-violet-300 font-medium">Update available: v{updateInfo.latestVersion}</p>
              <a
                href={updateInfo.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-violet-400 underline hover:text-violet-300"
              >
                Download
              </a>
              <button
                onClick={() => setUpdateInfo(null)}
                className="text-[10px] text-zinc-500 ml-2 hover:text-zinc-300"
              >
                dismiss
              </button>
            </div>
          )}

          {/* Keyboard Shortcuts Info */}
          <div className="text-[10px] text-zinc-600 space-y-0.5">
            <p>Ctrl+Shift+S — Start/Pause</p>
            <p>Ctrl+Shift+D — Log Distraction</p>
            <p>Space — Toggle Timer</p>
            <p>Esc — Go Back</p>
          </div>

          {/* Account */}
          <button
            onClick={() => setView('auth')}
            className="w-full px-2 py-1.5 mt-1 bg-zinc-800/60 text-zinc-300 rounded-lg hover:bg-zinc-700/60 border border-zinc-700/30 transition-colors"
          >
            {user ? `Account: ${user.email?.split('@')[0]}` : 'Login / Sign Up'}
          </button>
        </div>
      </div>
    );
  }

  // Session Complete
  if (isComplete) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-transparent p-2">
        <p className="text-xs text-emerald-400 font-medium mb-1">Session Complete!</p>
        {sessionName && <p className="text-[10px] text-zinc-500 mb-1">{sessionName}</p>}
        {distractions.length > 0 && (
          <div className="w-16 h-16">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={getChartData()} cx="50%" cy="50%" innerRadius={12} outerRadius={24} dataKey="value">
                  {getChartData().map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="flex gap-2 mt-2">
          <button onClick={() => handleModeChange('shortBreak')} className="px-3 py-1 text-xs bg-emerald-600/20 text-emerald-400 rounded-lg hover:bg-emerald-600/30 transition-colors">
            Break
          </button>
          <button onClick={handleStartPause} className="px-3 py-1 text-xs bg-violet-600/90 text-white rounded-lg hover:bg-violet-500 transition-colors">
            Again
          </button>
        </div>
      </div>
    );
  }

  // Main Timer View
  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-transparent select-none p-2" role="main" aria-label="Focus timer">
      {/* Session Name */}
      <input
        type="text"
        value={sessionName}
        onChange={(e) => setSessionName(e.target.value)}
        placeholder="Session name (optional)"
        className="w-32 px-2 py-0.5 mb-1.5 text-[10px] text-center bg-transparent text-zinc-500 border-b border-zinc-800/50 focus:border-violet-500/50 focus:text-zinc-300 focus:outline-none placeholder-zinc-700 transition-colors"
        aria-label="Session name"
      />

      {/* Mode Selector */}
      <div className="flex gap-1 mb-2" role="tablist" aria-label="Timer mode">
        {(['pomodoro', 'shortBreak', 'longBreak'] as TimerMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => handleModeChange(mode)}
            role="tab"
            aria-selected={timerMode === mode}
            className={`px-2.5 py-0.5 text-[10px] rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-violet-400/50 ${
              timerMode === mode
                ? `bg-${modeColor}-600/90 text-white`
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
            }`}
          >
            {mode === 'pomodoro' ? 'Focus' : mode === 'shortBreak' ? 'Short' : 'Long'}
          </button>
        ))}
      </div>

      {/* Timer */}
      <div
        className="text-4xl font-mono text-white font-light tracking-wider cursor-pointer"
        onClick={handleStartPause}
        role="timer"
        aria-live="polite"
        aria-label={`${formatTime(timeLeft)} remaining`}
      >
        {formatTime(timeLeft)}
      </div>

      {/* Paused by intervention indicator */}
      {isPausedByIntervention && !showIntervention && (
        <p className="text-[10px] text-amber-400 mt-1 animate-pulse">Paused — distraction detected</p>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={handleStartPause}
          aria-label={isRunning ? 'Pause timer' : 'Start timer'}
          className={`px-4 py-1 text-xs font-medium rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-violet-400/50 ${
            isRunning
              ? 'bg-zinc-700/80 text-zinc-300 hover:bg-zinc-600'
              : `bg-${modeColor}-600/90 text-white hover:bg-${modeColor}-500`
          }`}
        >
          {isRunning ? 'Pause' : 'Start'}
        </button>
        {(isRunning || isPausedByIntervention) && (
          <button onClick={handleReset} className="px-2 py-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-400/50 rounded" aria-label="Reset timer">
            Reset
          </button>
        )}
      </div>

      {/* Status Bar */}
      <div className="flex items-center gap-3 mt-2 text-[10px] text-zinc-500">
        {sessionsCompleted > 0 && <span>#{sessionsCompleted}</span>}
        {distractions.length > 0 && <span className="text-amber-400">{distractions.length} distractions</span>}
        {user && settings.cloudSyncEnabled && <span className="text-emerald-500">synced</span>}
      </div>

      {/* Daily Goal Progress */}
      {settings.dailyFocusGoalMinutes > 0 && (
        <div className="w-full px-4 mt-2">
          <div className="flex items-center justify-between text-[9px] text-zinc-600 mb-0.5">
            <span>Daily goal</span>
            <span>{goalProgress}%</span>
          </div>
          <div className="w-full h-1 bg-zinc-800/50 rounded-full overflow-hidden" role="progressbar" aria-valuenow={goalProgress} aria-valuemin={0} aria-valuemax={100} aria-label="Daily focus goal progress">
            <div
              className="h-full bg-violet-600/80 rounded-full transition-all"
              style={{ width: `${goalProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Snooze Indicator */}
      {isSnoozed && (
        <div className="flex items-center gap-1.5 mt-1.5">
          <span className="text-[10px] text-amber-400/80">Snoozed {formatSnoozeTime(snoozeSecondsRemaining)}</span>
          <button
            onClick={handleCancelSnooze}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 underline transition-colors"
          >
            cancel
          </button>
        </div>
      )}

      {/* Bottom Nav */}
      <nav className="absolute bottom-2 right-3 flex items-center gap-2" aria-label="Navigation">
        <button onClick={() => setShowPresets(!showPresets)} className="text-zinc-600 hover:text-zinc-400 transition-colors text-[10px] focus:outline-none focus:ring-2 focus:ring-violet-400/50 rounded" aria-label="Timer presets">
          Presets
        </button>
        <button onClick={openReports} className="text-zinc-600 hover:text-zinc-400 transition-colors text-[10px] focus:outline-none focus:ring-2 focus:ring-violet-400/50 rounded" aria-label="View reports">
          Reports
        </button>
        <button onClick={() => setView('settings')} className="text-zinc-600 hover:text-zinc-400 transition-colors text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/50 rounded" aria-label="Open settings">
          &#9881;
        </button>
      </nav>

      {/* Preset Picker Popover */}
      {showPresets && (
        <div className="absolute bottom-8 right-3 bg-zinc-900/95 backdrop-blur-sm rounded-lg border border-zinc-700/50 p-2 space-y-1 shadow-lg">
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              onClick={() => applyPreset(preset)}
              className={`w-full text-left px-2 py-1 text-[10px] rounded transition-colors ${
                isPresetActive(settings, preset)
                  ? 'bg-violet-600/30 text-violet-300'
                  : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
              }`}
            >
              <span className="font-medium">{preset.name}</span>
              <span className="text-zinc-600 ml-1">{preset.focus}/{preset.shortBreak}/{preset.longBreak}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
