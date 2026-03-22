import { useState, useEffect, useCallback, useRef } from 'react';
import type { FormEvent } from 'react';
import { db, auth } from './firebase';
import {
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  getDocs,
  Timestamp,
} from 'firebase/firestore';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import {
  formatTime,
  formatSnoozeTime,
  getTimerDuration,
  calculateGoalProgress,
  defaultSettings,
} from './utils';
import type { Settings, TimerMode, TimerPreset } from './utils';
import type { ReportData, ReportRange, TaxonomyData } from './app-types';
import {
  AuthScreen,
  CompactTimerScreen,
  InterventionModal,
  OnboardingModal,
  ReportsScreen,
  ResumePromptModal,
  SessionCompleteScreen,
  SettingsScreen,
  TaxonomyManagerScreen,
  TimerScreen,
} from './views';
import {
  buildQuickSuggestions,
  getMappedCategoryForNote,
  normalizeDistractionNote,
} from './taxonomy';
import './index.css';

interface Distraction {
  note: string;
  categoryName: string | null;
  timestamp: Date;
}

type View = 'timer' | 'settings' | 'auth' | 'reports' | 'taxonomy';

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
  const [taxonomyData, setTaxonomyData] = useState<TaxonomyData>({
    recentEntries: [],
    groups: [],
    categories: [],
  });
  const [taxonomyReturnView, setTaxonomyReturnView] = useState<'timer' | 'settings' | 'reports' | 'auth'>('timer');
  const [categorySelection, setCategorySelection] = useState('__auto__');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return localStorage.getItem('sentinel_onboarded') !== 'true';
  });
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [sessionName, setSessionName] = useState('');
  const [showPresets, setShowPresets] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{ latestVersion: string; downloadUrl: string } | null>(null);
  const [isCompactMode, setIsCompactMode] = useState(false);
  const wasRunningRef = useRef(false);
  const handleStartPauseRef = useRef(() => {});
  const timerAnchorRef = useRef<{ startedAt: number; startTimeLeft: number } | null>(null);

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
            if (typeof data.todaySessionsCompleted === 'number') {
              setSessionsCompleted(data.todaySessionsCompleted);
            }
            postMessage({ type: 'GET_TAXONOMY_DATA' });
            break;
          case 'IDLE_DETECTED':
            if (isRunning) {
              wasRunningRef.current = true;
              setIsRunning(false);
              setIsPausedByIntervention(true);
              setShowIntervention(true);
              postMessage({ type: 'GET_TAXONOMY_DATA' });
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
          case 'TAXONOMY_DATA':
            setTaxonomyData(data.data);
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
              postMessage({ type: 'GET_TAXONOMY_DATA' });
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
          case 'COMPACT_MODE_CHANGED':
            setIsCompactMode(data.isCompact);
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

  useEffect(() => {
    if (!isSnoozed || snoozeSecondsRemaining <= 0) return;

    const interval = setInterval(() => {
      setSnoozeSecondsRemaining((prev) => {
        if (prev <= 1) {
          setIsSnoozed(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isSnoozed, snoozeSecondsRemaining]);

  useEffect(() => {
    if (!showIntervention) return;
    if (!distractionInput.trim()) {
      setCategorySelection('__auto__');
      setNewCategoryName('');
    }
  }, [distractionInput, showIntervention]);

  useEffect(() => {
    if (!isRunning || timeLeft <= 0) {
      timerAnchorRef.current = null;
      return;
    }

    // Anchor the timer to wall-clock time to prevent drift from setInterval inaccuracy
    if (!timerAnchorRef.current) {
      timerAnchorRef.current = { startedAt: Date.now(), startTimeLeft: timeLeft };
    }

    const anchor = timerAnchorRef.current;

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - anchor.startedAt) / 1000);
      const remaining = Math.max(0, anchor.startTimeLeft - elapsed);

      if (remaining <= 0) {
        clearInterval(interval);
        timerAnchorRef.current = null;
        setTimeLeft(0);
        setIsRunning(false);
        setIsComplete(true);
        if (timerMode === 'pomodoro') {
          setSessionsCompleted((count) => count + 1);
          postMessage({
            type: 'LOG_SESSION',
            durationSeconds: getTimerDuration('pomodoro', settings),
            sessionName: sessionName || undefined,
          });
          postMessage({ type: 'PLAY_SOUND' });
          void syncSessionToFirestore();
        }
      } else {
        setTimeLeft(remaining);
      }
    }, 250); // Poll 4x/sec for responsive display, drift-free via anchor

    return () => clearInterval(interval);
  }, [isRunning, timeLeft, timerMode]);

  // Notify C# when timer starts/stops so idle monitor only runs during active sessions
  useEffect(() => {
    postMessage({ type: 'TIMER_RUNNING', running: isRunning });
  }, [isRunning]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
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

      if (event.key === 'Enter' && !event.ctrlKey && !event.shiftKey) {
        if (showResumePrompt) {
          event.preventDefault();
          handleResumeAfterSleep(true);
        }
      }

      if (event.key === ' ' && view === 'timer' && !showIntervention && !showResumePrompt && !showOnboarding) {
        const target = event.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          event.preventDefault();
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
        distractions: distractions.map((item) => item.note),
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

  const requestTaxonomyData = () => {
    postMessage({ type: 'GET_TAXONOMY_DATA' });
  };

  const resetDistractionDraft = () => {
    setDistractionInput('');
    setCategorySelection('__auto__');
    setNewCategoryName('');
  };

  const getResolvedCategoryName = (note: string) => {
    switch (categorySelection) {
      case '__auto__':
        return getMappedCategoryForNote(taxonomyData.groups, note);
      case '__none__':
        return null;
      case '__new__':
        return newCategoryName.trim() || null;
      default:
        return categorySelection.trim() || null;
    }
  };

  const submitDistraction = async (note: string, categoryName?: string | null) => {
    const cleanNote = note.trim();
    if (!cleanNote) return;

    const forceUncategorized = categoryName === undefined && categorySelection === '__none__';
    const resolvedCategoryName =
      categoryName !== undefined
        ? categoryName
        : getResolvedCategoryName(cleanNote);

    const newDistraction: Distraction = {
      note: cleanNote,
      categoryName: resolvedCategoryName,
      timestamp: new Date(),
    };

    setDistractions((prev) => [...prev, newDistraction]);
    resetDistractionDraft();
    postMessage({
      type: 'LOG_DISTRACTION',
      note: cleanNote,
      categoryName: resolvedCategoryName,
      forceUncategorized,
    });

    if (user && settings.cloudSyncEnabled) {
      try {
        await addDoc(collection(db, 'distractions'), {
          userId: user.uid,
          note: cleanNote,
          categoryName: resolvedCategoryName,
          timestamp: serverTimestamp(),
        });
      } catch (error) {
        console.error('[Sentinel] Sync failed:', error);
      }
    }

    requestTaxonomyData();
    dismissIntervention();
  };

  const toggleCompact = () => {
    postMessage({ type: 'TOGGLE_COMPACT' });
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
    if (isRunning && !window.confirm('Reset the current timer? Progress will be lost.')) {
      return;
    }
    setTimeLeft(getTimerDuration(timerMode, settings));
    setIsRunning(false);
    setIsComplete(false);
    setIsPausedByIntervention(false);
  };

  const dismissIntervention = () => {
    setShowIntervention(false);
    setIsPausedByIntervention(false);
    resetDistractionDraft();
    postMessage({ type: 'INTERVENTION_DISMISSED' });
    if (wasRunningRef.current) {
      setIsRunning(true);
      wasRunningRef.current = false;
    }
  };

  const handleDistractionSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!distractionInput.trim()) return;
    await submitDistraction(distractionInput);
  };

  const handleQuickSuggestionSubmit = async (note: string, categoryName: string | null) => {
    await submitDistraction(note, categoryName);
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

  const handleSaveTaxonomyGroup = (
    normalizedNote: string,
    note: string,
    categoryName: string | null,
  ) => {
    postMessage({
      type: 'UPDATE_DISTRACTION_GROUP',
      normalizedNote,
      note,
      categoryName,
    });
    requestTaxonomyData();
    if (reportData) {
      requestReportData(reportRange);
    }
  };

  const handleRenameCategory = (oldName: string, newName: string) => {
    postMessage({
      type: 'RENAME_CATEGORY',
      oldName,
      newName,
    });
    requestTaxonomyData();
    if (reportData) {
      requestReportData(reportRange);
    }
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

    if (user && settings.cloudSyncEnabled) {
      void fetchFirestoreHistory(range);
    }
  };

  const fetchFirestoreHistory = async (range: ReportRange) => {
    if (!user) return;

    try {
      const since =
        range === 'today'
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
          orderBy('completedAt', 'desc'),
        ),
      );

      const distractionsSnap = await getDocs(
        query(
          collection(db, 'distractions'),
          where('userId', '==', user.uid),
          where('timestamp', '>=', sinceTs),
          orderBy('timestamp', 'desc'),
        ),
      );

      const cloudSessions = sessionsSnap.docs.map((doc) => doc.data());
      const cloudDistractions = distractionsSnap.docs.map((doc) => doc.data());

      // Cloud data supplements the local report only if local counts are zero
      // (i.e., the data only exists in Firestore, not locally). This avoids
      // double-counting when the same session/distraction was saved to both.
      if (cloudSessions.length > 0 || cloudDistractions.length > 0) {
        setReportData((prev) => {
          if (!prev) return prev;
          // Only merge cloud data if local has nothing (cross-device scenario)
          if (prev.sessionsCompleted > 0 || prev.distractionsLogged > 0) {
            return prev;
          }
          return {
            ...prev,
            sessionsCompleted: cloudSessions.length,
            totalFocusSeconds: cloudSessions.reduce((sum, session) => sum + (session.duration || 0), 0),
            distractionsLogged: cloudDistractions.length,
          };
        });
      }

      console.log(
        `[Sentinel] Firestore: ${cloudSessions.length} sessions, ${cloudDistractions.length} distractions merged`,
      );
    } catch (error) {
      console.error('[Sentinel] Firestore report fetch failed:', error);
    }
  };

  const openReports = () => {
    setView('reports');
    requestReportData(reportRange);
  };

  const openTaxonomy = (returnView: 'timer' | 'settings' | 'reports' | 'auth' = 'timer') => {
    setTaxonomyReturnView(returnView);
    setView('taxonomy');
    requestTaxonomyData();
  };

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError('');

    try {
      await signInWithEmailAndPassword(auth, authEmail, authPassword);
      setView('timer');
    } catch (error: any) {
      const code = error?.code ?? '';
      if (code === 'auth/user-not-found' || code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials') {
        setAuthError('No account found with this email. Please sign up first.');
      } else if (code === 'auth/wrong-password') {
        setAuthError('Incorrect password. Please try again.');
      } else if (code === 'auth/too-many-requests') {
        setAuthError('Too many failed attempts. Please try again later.');
      } else if (code === 'auth/invalid-email') {
        setAuthError('Invalid email address.');
      } else {
        setAuthError(error.message || 'Login failed. Please try again.');
      }
    }
  };

  const handleSignup = async () => {
    setAuthError('');

    try {
      await createUserWithEmailAndPassword(auth, authEmail, authPassword);
      setView('timer');
    } catch (error: any) {
      const code = error?.code ?? '';
      if (code === 'auth/email-already-in-use') {
        setAuthError('An account with this email already exists. Please log in instead.');
      } else if (code === 'auth/weak-password') {
        setAuthError('Password is too weak. Use at least 6 characters.');
      } else if (code === 'auth/invalid-email') {
        setAuthError('Invalid email address.');
      } else {
        setAuthError(error.message || 'Signup failed. Please try again.');
      }
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const getChartData = () => {
    const counts: Record<string, number> = {};
    distractions.forEach((distraction) => {
      const key = (distraction.categoryName ?? distraction.note).toLowerCase();
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  };

  const goalProgress = calculateGoalProgress(sessionsCompleted, settings);
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
  const timeLabel = formatTime(timeLeft);
  const chartData = getChartData();
  const userEmail = user?.email ?? null;
  const isSynced = Boolean(user && settings.cloudSyncEnabled);
  const timerDuration = getTimerDuration(timerMode, settings);
  const timerProgress =
    timerDuration > 0
      ? Math.max(0, Math.min(100, Math.round(((timerDuration - timeLeft) / timerDuration) * 100)))
      : 0;
  const quickSuggestions = buildQuickSuggestions(taxonomyData);
  const inferredCategoryName = distractionInput.trim()
    ? getMappedCategoryForNote(taxonomyData.groups, distractionInput)
    : null;
  const categoryOptions = taxonomyData.categories.filter(
    (category, index, array) =>
      array.findIndex(
        (candidate) =>
          normalizeDistractionNote(candidate) === normalizeDistractionNote(category),
      ) === index,
  );
  const baseNavigation = {
    onOpenTimer: () => setView('timer'),
    onOpenReports: openReports,
    onOpenSettings: () => setView('settings'),
    onOpenAccount: () => setView('auth'),
  };

  if (showOnboarding) {
    return (
      <OnboardingModal
        steps={onboardingSteps}
        stepIndex={onboardingStep}
        onBack={() => setOnboardingStep((step) => step - 1)}
        onAdvance={
          onboardingStep === onboardingSteps.length - 1
            ? completeOnboarding
            : () => setOnboardingStep((step) => step + 1)
        }
        onSkip={completeOnboarding}
      />
    );
  }

  if (showResumePrompt) {
    return (
      <ResumePromptModal
        onResume={() => handleResumeAfterSleep(true)}
        onStartFresh={() => handleResumeAfterSleep(false)}
      />
    );
  }

  if (showIntervention) {
    return (
      <InterventionModal
        distractionInput={distractionInput}
        categorySelection={categorySelection}
        newCategoryName={newCategoryName}
        inferredCategoryName={inferredCategoryName}
        categoryOptions={categoryOptions}
        quickSuggestions={quickSuggestions}
        onDistractionChange={setDistractionInput}
        onCategorySelectionChange={setCategorySelection}
        onNewCategoryChange={setNewCategoryName}
        onSubmit={handleDistractionSubmit}
        onQuickLog={handleQuickSuggestionSubmit}
        onFalseAlarm={handleFalseAlarm}
        onSnooze={handleSnooze}
        onWatchingContent={handleWatchingContent}
      />
    );
  }

  if (view === 'reports') {
    return (
      <ReportsScreen
        reportRange={reportRange}
        reportLoading={reportLoading}
        reportData={reportData}
        onBack={() => setView('timer')}
        onSelectRange={requestReportData}
        onOpenTaxonomy={() => openTaxonomy('reports')}
        navigation={{
          ...baseNavigation,
          onOpenTaxonomy: () => openTaxonomy('reports'),
        }}
      />
    );
  }

  if (view === 'taxonomy') {
    return (
      <TaxonomyManagerScreen
        taxonomyData={taxonomyData}
        onBack={() => setView(taxonomyReturnView)}
        onSaveGroup={handleSaveTaxonomyGroup}
        onRenameCategory={handleRenameCategory}
        navigation={{
          ...baseNavigation,
          onOpenTaxonomy: () => setView('taxonomy'),
        }}
      />
    );
  }

  if (view === 'auth') {
    return (
      <AuthScreen
        userEmail={userEmail}
        authEmail={authEmail}
        authPassword={authPassword}
        authError={authError}
        onAuthEmailChange={setAuthEmail}
        onAuthPasswordChange={setAuthPassword}
        onLogin={handleLogin}
        onSignup={handleSignup}
        onLogout={handleLogout}
        onBack={() => setView('timer')}
        navigation={{
          ...baseNavigation,
          onOpenTaxonomy: () => openTaxonomy('auth'),
        }}
      />
    );
  }

  if (view === 'settings') {
    return (
      <SettingsScreen
        settings={settings}
        exportStatus={exportStatus}
        updateInfo={updateInfo}
        userEmail={userEmail}
        onBack={() => setView('timer')}
        onSaveSettings={saveSettings}
        onApplyPreset={applyPreset}
        onExport={handleExport}
        onOpenAuth={() => setView('auth')}
        onOpenTaxonomy={() => openTaxonomy('settings')}
        onDismissUpdate={() => setUpdateInfo(null)}
        navigation={{
          ...baseNavigation,
          onOpenTaxonomy: () => openTaxonomy('settings'),
        }}
      />
    );
  }

  if (isComplete) {
    return (
      <SessionCompleteScreen
        sessionName={sessionName}
        chartData={chartData}
        onTakeBreak={() => handleModeChange('shortBreak')}
        onAgain={handleStartPause}
      />
    );
  }

  if (isCompactMode) {
    return (
      <CompactTimerScreen
        timerMode={timerMode}
        timeLabel={timeLabel}
        isRunning={isRunning}
        progressPercent={timerProgress}
        overlayStyle={settings.overlayStyle}
        distractionCount={distractions.length}
        onStartPause={handleStartPause}
        onReset={handleReset}
        onExpand={toggleCompact}
        onClose={() => postMessage({ type: 'OVERLAY_CLOSE' })}
      />
    );
  }

  return (
    <TimerScreen
      sessionName={sessionName}
      onSessionNameChange={setSessionName}
      timerMode={timerMode}
      timeLabel={timeLabel}
      isRunning={isRunning}
      isPausedByIntervention={isPausedByIntervention}
      showIntervention={showIntervention}
      sessionsCompleted={sessionsCompleted}
      distractionCount={distractions.length}
      isSynced={isSynced}
      dailyGoalMinutes={settings.dailyFocusGoalMinutes}
      goalProgress={goalProgress}
      timerProgress={timerProgress}
      isSnoozed={isSnoozed}
      snoozeText={formatSnoozeTime(snoozeSecondsRemaining)}
      showPresets={showPresets}
      settings={settings}
      onModeChange={handleModeChange}
      onStartPause={handleStartPause}
      onReset={handleReset}
      onCancelSnooze={handleCancelSnooze}
      onToggleCompact={toggleCompact}
      onTogglePresets={() => setShowPresets((value) => !value)}
      onOpenReports={openReports}
      onOpenSettings={() => setView('settings')}
      onApplyPreset={applyPreset}
      navigation={{
        ...baseNavigation,
        onOpenTaxonomy: () => openTaxonomy('timer'),
      }}
    />
  );
}

export default App;
