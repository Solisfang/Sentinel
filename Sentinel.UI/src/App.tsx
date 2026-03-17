import { useState, useEffect, useCallback } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { db, auth } from './firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';
import './index.css';

const COLORS = ['#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444'];

interface Settings {
  pomodoroMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  idleThresholdSeconds: number;
  cloudSyncEnabled: boolean;
  soundEnabled: boolean;
  alwaysOnTop: boolean;
}

interface Distraction {
  note: string;
  timestamp: Date;
}

type View = 'timer' | 'settings' | 'auth';
type TimerMode = 'pomodoro' | 'shortBreak' | 'longBreak';

const defaultSettings: Settings = {
  pomodoroMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  idleThresholdSeconds: 45,
  cloudSyncEnabled: false,
  soundEnabled: true,
  alwaysOnTop: true,
};

function App() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [view, setView] = useState<View>('timer');
  const [timerMode, setTimerMode] = useState<TimerMode>('pomodoro');
  const [timeLeft, setTimeLeft] = useState(settings.pomodoroMinutes * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [showIntervention, setShowIntervention] = useState(false);
  const [distractionInput, setDistractionInput] = useState('');
  const [distractions, setDistractions] = useState<Distraction[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [sessionsCompleted, setSessionsCompleted] = useState(0);

  // Listen for auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // Listen for messages from C# backend
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
            if (isRunning) setShowIntervention(true);
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
            syncSessionToFirestore();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, timeLeft, timerMode]);

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

  const getTimerDuration = (mode: TimerMode) => {
    switch (mode) {
      case 'pomodoro': return settings.pomodoroMinutes * 60;
      case 'shortBreak': return settings.shortBreakMinutes * 60;
      case 'longBreak': return settings.longBreakMinutes * 60;
    }
  };

  const handleModeChange = (mode: TimerMode) => {
    setTimerMode(mode);
    setTimeLeft(getTimerDuration(mode));
    setIsRunning(false);
    setIsComplete(false);
  };

  const handleStartPause = () => {
    if (isComplete) {
      setTimeLeft(getTimerDuration(timerMode));
      setIsComplete(false);
      setDistractions([]);
    }
    setIsRunning(!isRunning);
  };

  const handleReset = () => {
    setTimeLeft(getTimerDuration(timerMode));
    setIsRunning(false);
    setIsComplete(false);
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
    setShowIntervention(false);

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

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getChartData = () => {
    const counts: Record<string, number> = {};
    distractions.forEach((d) => {
      counts[d.note.toLowerCase()] = (counts[d.note.toLowerCase()] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  };

  // Intervention Modal
  if (showIntervention) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-transparent p-2">
        <div className="bg-zinc-900/95 rounded-xl p-4 w-full border border-violet-500/50">
          <h2 className="text-sm font-semibold text-white mb-2 text-center">Distracted?</h2>
          <form onSubmit={handleDistractionSubmit}>
            <input
              type="text"
              value={distractionInput}
              onChange={(e) => setDistractionInput(e.target.value)}
              placeholder="What happened?"
              autoFocus
              className="w-full px-3 py-2 text-sm bg-zinc-800 text-white rounded-lg border border-zinc-700 focus:border-violet-500 focus:outline-none placeholder-zinc-500"
            />
          </form>
          <button
            onClick={() => setShowIntervention(false)}
            className="w-full mt-2 text-xs text-zinc-500 hover:text-zinc-300"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Auth View
  if (view === 'auth') {
    return (
      <div className="h-full w-full flex flex-col bg-transparent p-3 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-zinc-400">Account</span>
          <button onClick={() => setView('timer')} className="text-xs text-zinc-500 hover:text-white">←</button>
        </div>

        {user ? (
          <div className="space-y-2">
            <p className="text-xs text-zinc-300 truncate">{user.email}</p>
            <button
              onClick={handleLogout}
              className="w-full px-3 py-1.5 text-xs bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600/30"
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
              className="w-full px-2 py-1.5 text-xs bg-zinc-800 text-white rounded border border-zinc-700 focus:border-violet-500 focus:outline-none"
            />
            <input
              type="password"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              placeholder="Password"
              className="w-full px-2 py-1.5 text-xs bg-zinc-800 text-white rounded border border-zinc-700 focus:border-violet-500 focus:outline-none"
            />
            {authError && <p className="text-xs text-red-400">{authError}</p>}
            <div className="flex gap-2">
              <button type="submit" className="flex-1 px-2 py-1.5 text-xs bg-violet-600 text-white rounded hover:bg-violet-500">
                Login
              </button>
              <button type="button" onClick={handleSignup} className="flex-1 px-2 py-1.5 text-xs bg-zinc-700 text-white rounded hover:bg-zinc-600">
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
          <span className="text-xs text-zinc-400">Settings</span>
          <button onClick={() => setView('timer')} className="text-xs text-zinc-500 hover:text-white">←</button>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <label className="text-zinc-400 block mb-1">Pomodoro (min)</label>
            <input
              type="number"
              value={settings.pomodoroMinutes}
              onChange={(e) => saveSettings({ ...settings, pomodoroMinutes: +e.target.value })}
              className="w-full px-2 py-1 bg-zinc-800 text-white rounded border border-zinc-700"
              min={1}
              max={120}
            />
          </div>

          <div>
            <label className="text-zinc-400 block mb-1">Short Break (min)</label>
            <input
              type="number"
              value={settings.shortBreakMinutes}
              onChange={(e) => saveSettings({ ...settings, shortBreakMinutes: +e.target.value })}
              className="w-full px-2 py-1 bg-zinc-800 text-white rounded border border-zinc-700"
              min={1}
              max={30}
            />
          </div>

          <div>
            <label className="text-zinc-400 block mb-1">Idle Detection (sec)</label>
            <input
              type="number"
              value={settings.idleThresholdSeconds}
              onChange={(e) => saveSettings({ ...settings, idleThresholdSeconds: +e.target.value })}
              className="w-full px-2 py-1 bg-zinc-800 text-white rounded border border-zinc-700"
              min={10}
              max={300}
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Cloud Sync</span>
            <button
              onClick={() => saveSettings({ ...settings, cloudSyncEnabled: !settings.cloudSyncEnabled })}
              className={`w-10 h-5 rounded-full transition-colors ${settings.cloudSyncEnabled ? 'bg-violet-600' : 'bg-zinc-700'}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full transition-transform mx-0.5 ${settings.cloudSyncEnabled ? 'translate-x-5' : ''}`} />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Always on Top</span>
            <button
              onClick={() => saveSettings({ ...settings, alwaysOnTop: !settings.alwaysOnTop })}
              className={`w-10 h-5 rounded-full transition-colors ${settings.alwaysOnTop ? 'bg-violet-600' : 'bg-zinc-700'}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full transition-transform mx-0.5 ${settings.alwaysOnTop ? 'translate-x-5' : ''}`} />
            </button>
          </div>

          <button
            onClick={() => setView('auth')}
            className="w-full px-2 py-1.5 mt-2 bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700"
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
        <p className="text-xs text-green-400 mb-1">Session Complete!</p>
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
          <button onClick={() => handleModeChange('shortBreak')} className="px-2 py-1 text-xs bg-green-600/20 text-green-400 rounded">
            Break
          </button>
          <button onClick={handleStartPause} className="px-2 py-1 text-xs bg-violet-600 text-white rounded">
            Again
          </button>
        </div>
      </div>
    );
  }

  // Main Timer View
  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-transparent select-none p-2">
      {/* Mode Selector */}
      <div className="flex gap-1 mb-2">
        {(['pomodoro', 'shortBreak', 'longBreak'] as TimerMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => handleModeChange(mode)}
            className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
              timerMode === mode ? 'bg-violet-600 text-white' : 'text-zinc-500 hover:text-zinc-300'
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
      >
        {formatTime(timeLeft)}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={handleStartPause}
          className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
            isRunning ? 'bg-zinc-700 text-zinc-300' : 'bg-violet-600 text-white'
          }`}
        >
          {isRunning ? 'Pause' : 'Start'}
        </button>
        {isRunning && (
          <button onClick={handleReset} className="px-2 py-1 text-xs text-zinc-500 hover:text-zinc-300">
            Reset
          </button>
        )}
      </div>

      {/* Status Bar */}
      <div className="flex items-center gap-3 mt-2 text-[10px] text-zinc-500">
        {sessionsCompleted > 0 && <span>🍅 {sessionsCompleted}</span>}
        {distractions.length > 0 && <span>⚡ {distractions.length}</span>}
        {user && settings.cloudSyncEnabled && <span className="text-green-500">☁</span>}
        <button onClick={() => setView('settings')} className="hover:text-zinc-300">⚙</button>
      </div>
    </div>
  );
}

export default App;
