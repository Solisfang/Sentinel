import { useState, useEffect, useCallback } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { db, auth } from './firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import type { User } from 'firebase/auth';
import './index.css';

const TIMER_DURATION = 25 * 60; // 25 minutes in seconds
const COLORS = ['#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444'];

interface Distraction {
  note: string;
  timestamp: Date;
}

function App() {
  const [timeLeft, setTimeLeft] = useState(TIMER_DURATION);
  const [isRunning, setIsRunning] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [showIntervention, setShowIntervention] = useState(false);
  const [distractionInput, setDistractionInput] = useState('');
  const [distractions, setDistractions] = useState<Distraction[]>([]);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!isRunning || timeLeft <= 0) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          setIsRunning(false);
          setIsComplete(true);
          syncSessionToFirestore();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, timeLeft]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data.type === 'IDLE_DETECTED') {
          setShowIntervention(true);
        }
      } catch {
        // Ignore non-JSON messages
      }
    };

    if ((window as any).chrome?.webview) {
      (window as any).chrome.webview.addEventListener('message', handleMessage);
      return () => (window as any).chrome.webview.removeEventListener('message', handleMessage);
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const syncSessionToFirestore = useCallback(async () => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'sessions'), {
        userId: user.uid,
        duration: TIMER_DURATION,
        distractions: distractions.map(d => d.note),
        completedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('[Sentinel] Failed to sync session:', error);
    }
  }, [user, distractions]);

  const handleStartPause = () => {
    if (isComplete) {
      setTimeLeft(TIMER_DURATION);
      setIsComplete(false);
      setDistractions([]);
    }
    setIsRunning(!isRunning);
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

    if ((window as any).chrome?.webview) {
      (window as any).chrome.webview.postMessage({
        type: 'LOG_DISTRACTION',
        note: newDistraction.note,
        timestamp: newDistraction.timestamp.toISOString(),
      });
    }

    if (user) {
      try {
        await addDoc(collection(db, 'distractions'), {
          userId: user.uid,
          note: newDistraction.note,
          timestamp: serverTimestamp(),
        });
      } catch (error) {
        console.error('[Sentinel] Failed to sync distraction:', error);
      }
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getChartData = () => {
    const counts: Record<string, number> = {};
    distractions.forEach((d) => {
      const key = d.note.toLowerCase();
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  };

  // Intervention Modal (full overlay)
  if (showIntervention) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-transparent p-2">
        <div className="bg-zinc-900/95 rounded-xl p-4 w-full border border-violet-500/50">
          <h2 className="text-base font-semibold text-white mb-3 text-center">
            Distracted?
          </h2>
          <form onSubmit={handleDistractionSubmit}>
            <input
              type="text"
              value={distractionInput}
              onChange={(e) => setDistractionInput(e.target.value)}
              placeholder="What happened?"
              autoFocus
              className="w-full px-3 py-2 text-sm bg-zinc-800 text-white rounded-lg border border-zinc-700 focus:border-violet-500 focus:outline-none placeholder-zinc-500"
            />
            <p className="text-zinc-500 text-xs mt-2 text-center">
              Press Enter to log
            </p>
          </form>
        </div>
      </div>
    );
  }

  // Session Complete - Mini Pie Chart
  if (isComplete) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-transparent p-2">
        <p className="text-xs text-zinc-400 mb-1">Done!</p>
        {distractions.length > 0 ? (
          <div className="w-20 h-20">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={getChartData()}
                  cx="50%"
                  cy="50%"
                  innerRadius={15}
                  outerRadius={30}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {getChartData().map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-xs text-green-400">Great focus!</p>
        )}
        <button
          onClick={handleStartPause}
          className="mt-2 px-3 py-1 text-xs font-medium rounded-full bg-violet-600 hover:bg-violet-500 text-white transition-colors"
        >
          Restart
        </button>
      </div>
    );
  }

  // Main Timer View - Compact Widget
  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-transparent select-none">
      {/* Timer Display */}
      <div
        className="text-4xl font-mono text-white font-light tracking-wider cursor-pointer"
        onClick={handleStartPause}
        title={isRunning ? 'Click to pause' : 'Click to start'}
      >
        {formatTime(timeLeft)}
      </div>

      {/* Status & Controls */}
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={handleStartPause}
          className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
            isRunning
              ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'
              : 'bg-violet-600 hover:bg-violet-500 text-white'
          }`}
        >
          {isRunning ? 'Pause' : 'Start'}
        </button>

        {distractions.length > 0 && (
          <span className="text-xs text-zinc-500">
            {distractions.length}⚡
          </span>
        )}
      </div>

      {/* Debug button (small) */}
      <button
        onClick={() => setShowIntervention(true)}
        className="mt-2 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
      >
        [test]
      </button>
    </div>
  );
}

export default App;
