import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  AuthScreen,
  CompactTimerScreen,
  InterventionModal,
  OnboardingModal,
  ReportsScreen,
  SessionCompleteScreen,
  SettingsScreen,
  TaxonomyManagerScreen,
  TimerScreen,
} from './views';
import { defaultSettings } from './utils';

const navigation = {
  onOpenTimer: vi.fn(),
  onOpenReports: vi.fn(),
  onOpenTaxonomy: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenAccount: vi.fn(),
};

describe('SettingsScreen', () => {
  it('renders grouped settings sections inside the shared shell', () => {
    const { container } = render(
      <SettingsScreen
        settings={defaultSettings}
        exportStatus={null}
        updateInfo={null}
        userEmail={null}
        onBack={vi.fn()}
        onSaveSettings={vi.fn()}
        onApplyPreset={vi.fn()}
        onExport={vi.fn()}
        onOpenAuth={vi.fn()}
        onOpenTaxonomy={vi.fn()}
        onDismissUpdate={vi.fn()}
        navigation={navigation}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByLabelText('Back to timer')).toBeInTheDocument();
    expect(container.querySelector('[data-ui="screen-shell"]')).toBeInTheDocument();
    expect(screen.getByText('Timer & Presets')).toBeInTheDocument();
    expect(screen.getByText('Idle & Behavior')).toBeInTheDocument();
    expect(screen.getByText('Goals & Export')).toBeInTheDocument();
    expect(screen.getByText('Account & Shortcuts')).toBeInTheDocument();
    expect(screen.getByText('Data Organization')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Manage Categories' }).length).toBeGreaterThan(0);
  });
});

describe('ReportsScreen', () => {
  it('renders the shared report shell with filters and empty state', () => {
    const { container } = render(
      <ReportsScreen
        reportRange="week"
        reportLoading={false}
        reportData={null}
        onBack={vi.fn()}
        onSelectRange={vi.fn()}
        onOpenTaxonomy={vi.fn()}
        navigation={navigation}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument();
    expect(screen.getByLabelText('Back to timer')).toBeInTheDocument();
    expect(container.querySelector('[data-ui="screen-shell"]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Week' })).toBeInTheDocument();
    expect(screen.getByText('No data available')).toBeInTheDocument();
  });
});

describe('InterventionModal', () => {
  it('renders quick pills and category controls for faster logging', () => {
    render(
      <InterventionModal
        distractionInput="twitter"
        categorySelection="__auto__"
        newCategoryName=""
        inferredCategoryName="Social Media"
        categoryOptions={['Social Media', 'Messaging']}
        quickSuggestions={[
          { note: 'twitter', categoryName: 'Social Media', source: 'Recent' },
          { note: 'instagram', categoryName: 'Social Media', source: 'Frequent' },
        ]}
        onDistractionChange={vi.fn()}
        onCategorySelectionChange={vi.fn()}
        onNewCategoryChange={vi.fn()}
        onSubmit={vi.fn()}
        onQuickLog={vi.fn()}
        onFalseAlarm={vi.fn()}
        onSnooze={vi.fn()}
        onWatchingContent={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Quick distraction suggestions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /twitter/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Distraction category')).toBeInTheDocument();
    expect(screen.getByText('Current category: Social Media')).toBeInTheDocument();
  });
});

describe('TaxonomyManagerScreen', () => {
  it('renders taxonomy editing controls and recent history', () => {
    render(
      <TaxonomyManagerScreen
        taxonomyData={{
          recentEntries: [
            {
              id: 1,
              note: 'twitter',
              normalizedNote: 'twitter',
              categoryName: 'Social Media',
              timestamp: new Date().toISOString(),
            },
          ],
          groups: [
            {
              note: 'twitter',
              normalizedNote: 'twitter',
              categoryName: 'Social Media',
              count: 4,
              lastSeenAt: new Date().toISOString(),
            },
          ],
          categories: ['Social Media'],
        }}
        onBack={vi.fn()}
        onSaveGroup={vi.fn()}
        onRenameCategory={vi.fn()}
        navigation={navigation}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Distraction Taxonomy' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search distraction labels or categories')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
  });
});

describe('AuthScreen', () => {
  it('renders account auth controls inside the shared shell', () => {
    const { container } = render(
      <AuthScreen
        userEmail={null}
        authEmail=""
        authPassword=""
        authError=""
        onAuthEmailChange={vi.fn()}
        onAuthPasswordChange={vi.fn()}
        onLogin={vi.fn()}
        onSignup={vi.fn()}
        onLogout={vi.fn()}
        onBack={vi.fn()}
        navigation={navigation}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument();
    expect(screen.getByLabelText('Back to timer')).toBeInTheDocument();
    expect(container.querySelector('[data-ui="screen-shell"]')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Email')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign Up' })).toBeInTheDocument();
  });
});

// P3-4: InterventionModal interaction tests
describe('InterventionModal interactions', () => {
  const baseProps = {
    distractionInput: '',
    categorySelection: '__auto__',
    newCategoryName: '',
    inferredCategoryName: null as string | null,
    categoryOptions: ['Social Media', 'Messaging'],
    quickSuggestions: [
      { note: 'twitter', categoryName: 'Social Media' as string | null, source: 'Recent' as const },
      { note: 'instagram', categoryName: 'Social Media' as string | null, source: 'Frequent' as const },
    ],
    onDistractionChange: vi.fn(),
    onCategorySelectionChange: vi.fn(),
    onNewCategoryChange: vi.fn(),
    onSubmit: vi.fn(),
    onQuickLog: vi.fn(),
    onFalseAlarm: vi.fn(),
    onSnooze: vi.fn(),
    onWatchingContent: vi.fn(),
  };

  it('calls onSubmit when form is submitted', () => {
    const onSubmit = vi.fn((e) => e.preventDefault());
    render(
      <InterventionModal {...baseProps} distractionInput="YouTube" onSubmit={onSubmit} />,
    );

    fireEvent.submit(screen.getByRole('button', { name: 'Log Distraction' }).closest('form')!);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('calls onQuickLog when a quick suggestion is clicked', () => {
    const onQuickLog = vi.fn();
    render(
      <InterventionModal {...baseProps} onQuickLog={onQuickLog} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /twitter/i }));
    expect(onQuickLog).toHaveBeenCalledWith('twitter', 'Social Media');
  });

  it('calls onFalseAlarm when False Alarm is clicked', () => {
    const onFalseAlarm = vi.fn();
    render(
      <InterventionModal {...baseProps} onFalseAlarm={onFalseAlarm} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'False Alarm' }));
    expect(onFalseAlarm).toHaveBeenCalledOnce();
  });

  it('calls onSnooze with correct duration', () => {
    const onSnooze = vi.fn();
    render(
      <InterventionModal {...baseProps} onSnooze={onSnooze} />,
    );

    fireEvent.click(screen.getByLabelText('Snooze for 10 minutes'));
    expect(onSnooze).toHaveBeenCalledWith(10);
  });

  it('calls onWatchingContent with correct duration', () => {
    const onWatchingContent = vi.fn();
    render(
      <InterventionModal {...baseProps} onWatchingContent={onWatchingContent} />,
    );

    fireEvent.click(screen.getByLabelText('Watch content for 60 minutes'));
    expect(onWatchingContent).toHaveBeenCalledWith(60);
  });

  it('disables Log Distraction button when input is empty', () => {
    render(<InterventionModal {...baseProps} distractionInput="" />);

    expect(screen.getByRole('button', { name: 'Log Distraction' })).toBeDisabled();
  });
});

// P3-7: Render tests for TimerScreen, CompactTimerScreen, SessionCompleteScreen, OnboardingModal
describe('TimerScreen', () => {
  it('renders timer controls and session name input', () => {
    render(
      <TimerScreen
        sessionName=""
        onSessionNameChange={vi.fn()}
        timerMode="pomodoro"
        timeLabel="25:00"
        isRunning={false}
        isPausedByIntervention={false}
        showIntervention={false}
        sessionsCompleted={0}
        distractionCount={0}
        isSynced={false}
        dailyGoalMinutes={120}
        goalProgress={0}
        timerProgress={0}
        isSnoozed={false}
        snoozeText="0s"
        showPresets={false}
        settings={defaultSettings}
        onModeChange={vi.fn()}
        onStartPause={vi.fn()}
        onReset={vi.fn()}
        onCancelSnooze={vi.fn()}
        onToggleCompact={vi.fn()}
        onTogglePresets={vi.fn()}
        onOpenReports={vi.fn()}
        onOpenSettings={vi.fn()}
        onApplyPreset={vi.fn()}
        navigation={navigation}
      />,
    );

    expect(screen.getByLabelText('Session name')).toBeInTheDocument();
    expect(screen.getByLabelText('Focus timer')).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Timer mode' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Focus/i })).toBeInTheDocument();
  });
});

describe('CompactTimerScreen', () => {
  const compactProps = {
    timerMode: 'pomodoro' as const,
    timeLabel: '24:30',
    isRunning: true,
    progressPercent: 2,
    overlayStyle: 'compact' as const,
    distractionCount: 1,
    onStartPause: vi.fn(),
    onReset: vi.fn(),
    onExpand: vi.fn(),
    onClose: vi.fn(),
  };

  it('renders compact overlay with timer', () => {
    render(<CompactTimerScreen {...compactProps} />);

    expect(screen.getByLabelText('Mini overlay timer')).toBeInTheDocument();
    expect(screen.getByText('24:30')).toBeInTheDocument();
  });

  it('renders pill overlay style', () => {
    render(<CompactTimerScreen {...compactProps} overlayStyle="pill" />);

    expect(screen.getByLabelText('Mini overlay timer')).toBeInTheDocument();
    expect(screen.getByLabelText(/remaining/)).toBeInTheDocument();
  });

  it('renders monitoring overlay style', () => {
    render(<CompactTimerScreen {...compactProps} overlayStyle="monitoring" />);

    expect(screen.getByLabelText('Mini overlay timer')).toBeInTheDocument();
    expect(screen.getByText(/1 drift/)).toBeInTheDocument();
  });
});

describe('SessionCompleteScreen', () => {
  it('renders completion message and action buttons', () => {
    const onTakeBreak = vi.fn();
    const onAgain = vi.fn();

    render(
      <SessionCompleteScreen
        sessionName="Deep Work"
        chartData={[{ name: 'Focus', value: 25 }]}
        onTakeBreak={onTakeBreak}
        onAgain={onAgain}
      />,
    );

    expect(screen.getByText('Session Complete')).toBeInTheDocument();
    expect(screen.getByText('Focus block finished')).toBeInTheDocument();
    expect(screen.getByText('Deep Work')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Take Break' }));
    expect(onTakeBreak).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Start Again' }));
    expect(onAgain).toHaveBeenCalledOnce();
  });
});

describe('OnboardingModal', () => {
  const steps = [
    { title: 'Welcome', body: 'Welcome to Sentinel' },
    { title: 'Timer', body: 'Start your first session' },
    { title: 'Done', body: 'You are all set' },
  ];

  it('renders the current step and navigation', () => {
    render(
      <OnboardingModal
        steps={steps}
        stepIndex={0}
        onBack={vi.fn()}
        onAdvance={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip intro' })).toBeInTheDocument();
  });

  it('calls onAdvance when Continue is clicked', () => {
    const onAdvance = vi.fn();
    render(
      <OnboardingModal
        steps={steps}
        stepIndex={0}
        onBack={vi.fn()}
        onAdvance={onAdvance}
        onSkip={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    expect(onAdvance).toHaveBeenCalledOnce();
  });

  it('calls onSkip when Skip intro is clicked', () => {
    const onSkip = vi.fn();
    render(
      <OnboardingModal
        steps={steps}
        stepIndex={1}
        onBack={vi.fn()}
        onAdvance={vi.fn()}
        onSkip={onSkip}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Skip intro' }));
    expect(onSkip).toHaveBeenCalledOnce();
  });
});
