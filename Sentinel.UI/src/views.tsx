import { useMemo, useState, type FormEvent } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DistractionGroup, ReportData, ReportRange, TaxonomyData } from './app-types';
import {
  PRESETS,
  formatDuration,
  isPresetActive,
  type OverlayStyle,
  type Settings,
  type TimerMode,
  type TimerPreset,
} from './utils';
import {
  ActionGrid,
  FieldBlock,
  Glyph,
  ModalCard,
  ModalLayout,
  ScreenHeader,
  ScreenShell,
  SectionCard,
  WorkspaceLayout,
} from './ui';
import { buttonClasses, cx, inputClasses } from './ui-utils';

const COLORS = ['#7c4dff', '#00affe', '#3ce36a', '#f59e0b', '#ec4899', '#ef4444'];

const MODE_META: Record<
  TimerMode,
  {
    label: string;
    accent: string;
    accentSoft: string;
    accentText: string;
    topbarLabel: string;
  }
> = {
  pomodoro: {
    label: 'Focus',
    accent: '#7c4dff',
    accentSoft: 'rgba(124, 77, 255, 0.18)',
    accentText: '#cdbdff',
    topbarLabel: 'Focus Active',
  },
  shortBreak: {
    label: 'Short Break',
    accent: '#3ce36a',
    accentSoft: 'rgba(60, 227, 106, 0.16)',
    accentText: '#a8f4bc',
    topbarLabel: 'Short Break',
  },
  longBreak: {
    label: 'Long Break',
    accent: '#00affe',
    accentSoft: 'rgba(0, 175, 254, 0.16)',
    accentText: '#b7e8ff',
    topbarLabel: 'Long Break',
  },
};

const RANGE_OPTIONS: { key: ReportRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'all', label: 'All' },
];

const SHORTCUTS = [
  'Ctrl+Shift+S - Start or pause the timer',
  'Ctrl+Shift+D - Log a distraction immediately',
  'Space - Toggle the active timer',
  'Esc - Go back or dismiss the current surface',
];

/* ------------------------------------------------------------------ */
/*  Pagination                                                        */
/* ------------------------------------------------------------------ */

const PAGE_SIZE = 10;

function usePagination<T>(items: T[], pageSize = PAGE_SIZE) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const slice = items.slice(safePage * pageSize, safePage * pageSize + pageSize);

  return {
    page: safePage,
    totalPages,
    slice,
    setPage,
    hasPrev: safePage > 0,
    hasNext: safePage < totalPages - 1,
    prev: () => setPage((p) => Math.max(0, p - 1)),
    next: () => setPage((p) => Math.min(totalPages - 1, p + 1)),
    total: items.length,
    rangeLabel: items.length
      ? `${safePage * pageSize + 1}–${Math.min((safePage + 1) * pageSize, items.length)} of ${items.length}`
      : '',
  };
}

function PaginationBar({
  rangeLabel,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: {
  rangeLabel: string;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (!rangeLabel) return null;
  return (
    <div className="flex items-center justify-between gap-4 pt-1">
      <span className="text-xs text-(--text-muted)">{rangeLabel}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          disabled={!hasPrev}
          className={cx(buttonClasses.ghost, 'min-w-0 px-2.5 py-1 text-xs')}
          aria-label="Previous page"
        >
          ← Prev
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasNext}
          className={cx(buttonClasses.ghost, 'min-w-0 px-2.5 py-1 text-xs')}
          aria-label="Next page"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

interface WorkspaceNavigation {
  onOpenTimer: () => void;
  onOpenReports: () => void;
  onOpenHistory: () => void;
  onOpenTaxonomy: () => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
}

interface OnboardingModalProps {
  steps: { title: string; body: string }[];
  stepIndex: number;
  onBack: () => void;
  onAdvance: () => void;
  onSkip: () => void;
}

export function OnboardingModal({
  steps,
  stepIndex,
  onBack,
  onAdvance,
  onSkip,
}: OnboardingModalProps) {
  const step = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  return (
    <ModalLayout>
      <ModalCard className="w-full max-w-152">
        <div className="space-y-7">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              {steps.map((_, index) => (
                <span
                  key={index}
                  className="h-2.5 w-2.5 rounded-full transition-colors"
                  style={{ background: index === stepIndex ? '#7c4dff' : 'rgba(148, 142, 161, 0.32)' }}
                />
              ))}
            </div>
            <button type="button" onClick={onSkip} className={buttonClasses.ghost}>
              Skip intro
            </button>
          </div>

          <div className="space-y-4">
            <p className="sentinel-eyebrow">Welcome to Sentinel</p>
            <div className="space-y-3">
              <h1 className="text-3xl font-extrabold tracking-tight text-(--text-primary)">
                {step.title}
              </h1>
              <p className="text-sm leading-7 text-(--text-secondary)">{step.body}</p>
            </div>
          </div>

          <div className="sentinel-panel rounded-[calc(var(--card-radius)-4px)] px-5 py-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-[rgba(124,77,255,0.16)] text-(--primary)">
                <Glyph name="spark" className="h-4 w-4" />
              </span>
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-(--text-primary)">Step {stepIndex + 1}</p>
                <p className="text-sm leading-6 text-(--text-secondary)">
                  Sentinel is local-first, interruption-aware, and designed to stay calm while you work.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {!isFirst && (
              <button type="button" onClick={onBack} className={buttonClasses.secondary}>
                Back
              </button>
            )}
            <button
              type="button"
              onClick={onAdvance}
              className={cx(buttonClasses.primary, isFirst && 'sm:col-span-2')}
              autoFocus
              aria-label={isLast ? 'Start using Sentinel' : 'Next step'}
            >
              {isLast ? 'Enter Sentinel' : 'Next'}
            </button>
          </div>
        </div>
      </ModalCard>
    </ModalLayout>
  );
}

interface ResumePromptModalProps {
  onResume: () => void;
  onStartFresh: () => void;
}

export function ResumePromptModal({ onResume, onStartFresh }: ResumePromptModalProps) {
  return (
    <ModalLayout role="dialog" aria-label="Resume session">
      <ModalCard className="w-full max-w-136">
        <div className="space-y-6">
          <div className="space-y-3 text-center">
            <p className="sentinel-eyebrow">Session Paused</p>
            <h1 className="text-3xl font-extrabold tracking-tight text-(--text-primary)">Welcome back</h1>
            <p className="text-sm leading-7 text-(--text-secondary)">
              Your session paused while the machine slept. Press Enter to continue where you left off,
              or start a fresh block instead.
            </p>
          </div>

          <div className="sentinel-panel rounded-[calc(var(--card-radius)-4px)] px-5 py-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-[rgba(60,227,106,0.14)] text-(--tertiary)">
                <Glyph name="target" className="h-4 w-4" />
              </span>
              <p className="text-sm leading-6 text-(--text-secondary)">
                Resuming keeps your momentum and preserves the original timer state.
              </p>
            </div>
          </div>

          <ActionGrid>
            <button type="button" onClick={onResume} autoFocus className={buttonClasses.primary}>
              Resume
            </button>
            <button type="button" onClick={onStartFresh} className={buttonClasses.secondary}>
              Start Fresh
            </button>
          </ActionGrid>
        </div>
      </ModalCard>
    </ModalLayout>
  );
}

/* ------------------------------------------------------------------ */
/*  Confirm Modal                                                     */
/* ------------------------------------------------------------------ */

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <ModalLayout role="dialog" aria-label={title}>
      <ModalCard className="w-full max-w-md">
        <div className="space-y-5">
          <div className="space-y-2">
            <h1 className="text-xl font-bold tracking-tight text-(--text-primary)">{title}</h1>
            <p className="text-sm leading-6 text-(--text-secondary)">{message}</p>
          </div>
          <ActionGrid>
            <button
              type="button"
              onClick={onConfirm}
              autoFocus
              className={danger ? buttonClasses.danger : buttonClasses.primary}
            >
              {confirmLabel}
            </button>
            <button type="button" onClick={onCancel} className={buttonClasses.secondary}>
              {cancelLabel}
            </button>
          </ActionGrid>
        </div>
      </ModalCard>
    </ModalLayout>
  );
}

interface InterventionModalProps {
  distractionInput: string;
  categorySelection: string;
  newCategoryName: string;
  inferredCategoryName: string | null;
  categoryOptions: string[];
  quickSuggestions: { note: string; categoryName: string | null; source: 'Recent' | 'Frequent' }[];
  onDistractionChange: (value: string) => void;
  onCategorySelectionChange: (value: string) => void;
  onNewCategoryChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onQuickLog: (note: string, categoryName: string | null) => void;
  onFalseAlarm: () => void;
  onSnooze: (minutes: number) => void;
  onWatchingContent: (minutes: number) => void;
}

export function InterventionModal({
  distractionInput,
  categorySelection,
  newCategoryName,
  inferredCategoryName,
  categoryOptions,
  quickSuggestions,
  onDistractionChange,
  onCategorySelectionChange,
  onNewCategoryChange,
  onSubmit,
  onQuickLog,
  onFalseAlarm,
  onSnooze,
  onWatchingContent,
}: InterventionModalProps) {
  return (
    <ModalLayout role="dialog" aria-label="Distraction intervention">
      <ModalCard className="w-full max-w-136">
        <div className="space-y-5">
          {/* Header */}
          <div className="space-y-1">
            <p className="sentinel-eyebrow">Attention Check</p>
            <h1 className="text-2xl font-bold tracking-tight text-(--text-primary)">Drift detected?</h1>
          </div>

          {/* Form */}
          <form onSubmit={onSubmit} className="space-y-3">
            <input
              type="text"
              value={distractionInput}
              onChange={(event) => onDistractionChange(event.target.value)}
              placeholder="What pulled you away?"
              autoFocus
              aria-label="Distraction note"
              className={inputClasses.base}
            />

            {quickSuggestions.length > 0 && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Quick distraction suggestions">
                {quickSuggestions.map((suggestion) => (
                  <button
                    key={`${suggestion.source}-${suggestion.note}`}
                    type="button"
                    onClick={() => onQuickLog(suggestion.note, suggestion.categoryName)}
                    className={buttonClasses.chip}
                  >
                    <span>{suggestion.note}</span>
                    <span className="text-[0.64rem] uppercase tracking-[0.18em] text-(--text-muted)">
                      {suggestion.source}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {distractionInput.trim() && (
              <div className="space-y-2">
                <select
                  value={categorySelection}
                  onChange={(event) => onCategorySelectionChange(event.target.value)}
                  className={inputClasses.base}
                  aria-label="Distraction category"
                >
                  <option value="__auto__">
                    {inferredCategoryName ? `Suggested: ${inferredCategoryName}` : 'No category'}
                  </option>
                  <option value="__none__">Keep uncategorized</option>
                  {categoryOptions
                    .filter((category) => category !== inferredCategoryName)
                    .map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  <option value="__new__">Create new category</option>
                </select>

                {categorySelection === '__new__' && (
                  <input
                    type="text"
                    value={newCategoryName}
                    onChange={(event) => onNewCategoryChange(event.target.value)}
                    placeholder="New category name"
                    maxLength={50}
                    className={inputClasses.base}
                    aria-label="New category name"
                  />
                )}
              </div>
            )}

            <ActionGrid>
              <button
                type="submit"
                disabled={!distractionInput.trim() || (categorySelection === '__new__' && !newCategoryName.trim())}
                className={buttonClasses.primary}
              >
                Log it
              </button>
              <button type="button" onClick={onFalseAlarm} className={buttonClasses.secondary}>
                False Alarm
              </button>
            </ActionGrid>
          </form>

          {/* Snooze + Watch row */}
          <div className="sentinel-panel rounded-[calc(var(--card-radius)-4px)] divide-y divide-(--border)">
            <div className="flex items-center gap-3 px-4 py-3">
              <Glyph name="moon" className="h-4 w-4 shrink-0 text-(--text-muted)" />
              <span className="flex-1 text-sm font-medium text-(--text-secondary)">Snooze</span>
              <div className="flex gap-2" role="group" aria-label="Snooze duration">
                {[5, 10, 30].map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    onClick={() => onSnooze(minutes)}
                    aria-label={`Snooze ${minutes} minutes`}
                    className={cx(buttonClasses.secondary, 'min-w-0 px-3 py-1.5 text-sm')}
                  >
                    {minutes}m
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3 px-4 py-3">
              <Glyph name="play" className="h-4 w-4 shrink-0 text-(--text-muted)" />
              <span className="flex-1 text-sm font-medium text-(--text-secondary)">Watching</span>
              <div className="flex gap-2" role="group" aria-label="Watch duration">
                {[30, 60, 90].map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    onClick={() => onWatchingContent(minutes)}
                    aria-label={`Watch ${minutes} minutes`}
                    className={cx(buttonClasses.secondary, 'min-w-0 px-3 py-1.5 text-sm')}
                  >
                    {minutes}m
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ModalCard>
    </ModalLayout>
  );
}

interface ReportsScreenProps {
  reportRange: ReportRange;
  reportLoading: boolean;
  reportData: ReportData | null;
  onBack: () => void;
  onSelectRange: (range: ReportRange) => void;
  onOpenTaxonomy: () => void;
  navigation: WorkspaceNavigation;
}

export function ReportsScreen({
  reportRange,
  reportLoading,
  reportData,
  onBack,
  onSelectRange,
  onOpenTaxonomy,
  navigation,
}: ReportsScreenProps) {
  // Pagination for Recent Sessions
  const SESSIONS_PER_PAGE = 10;
  const [sessionPage, setSessionPage] = useState<number>(0);
  const sessions = reportData?.recentSessions ?? [];
  const totalSessionPages = Math.max(1, Math.ceil(sessions.length / SESSIONS_PER_PAGE));
  const pagedSessions = sessions.slice(sessionPage * SESSIONS_PER_PAGE, (sessionPage + 1) * SESSIONS_PER_PAGE);
  return (
    <WorkspaceLayout
      activeView="reports"
      navigation={workspaceNavigation(navigation)}
      statusLabel="Insight View"
      statusDetail="Focus patterns, interruption trends, and category-aware reporting."
      topbarMeta={<TopbarPill label={labelForRange(reportRange)} icon="reports" />}
      role="main"
      aria-label="Reports"
    >
      <ScreenShell wide>
        <ScreenHeader
          eyebrow="Analytics"
          title="Reports"
          subtitle="A calmer overview of your focus patterns, distractions, and category mappings."
          onBack={onBack}
          backLabel="Back"
          backAriaLabel="Back to timer"
          actions={
            <button type="button" onClick={onOpenTaxonomy} className={buttonClasses.inline}>
              Manage Taxonomy
            </button>
          }
        />

        <SectionCard
          title="Window"
          description="Choose the time range you want to analyze."
          icon="reports"
        >
          <div className="flex flex-wrap gap-2">
            {RANGE_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => onSelectRange(key)}
                className={buttonClasses.pill}
                aria-pressed={reportRange === key}
              >
                {label}
              </button>
            ))}
          </div>
        </SectionCard>

        {reportLoading ? (
          <SectionCard bodyClassName="min-h-48 items-center justify-center">
            <span className="animate-pulse text-sm text-(--text-muted)">Loading focus data...</span>
          </SectionCard>
        ) : reportData ? (
          <>
            {/* Metrics Row */}
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                icon="target"
                label="Focus Time"
                value={formatDuration(reportData.totalFocusSeconds)}
                detail="Total completed focus duration"
                accent="#3ce36a"
              />
              <MetricCard
                icon="bolt"
                label="Sessions"
                value={String(reportData.recentSessions?.length ?? 0)}
                detail="Recent sessions"
                accent="#7c4dff"
              />
              <MetricCard
                icon="taxonomy"
                label="Categories"
                value={String(reportData.topCategories?.length ?? 0)}
                detail="Active categories"
                accent="#00affe"
              />
              <MetricCard
                icon="reports"
                label="Distractions"
                value={String(reportData.topDistractions?.length ?? 0)}
                detail="Top distractions"
                accent="#ef4444"
              />
            </div>

            {/* Restored detailed report sections */}
            <div className="grid gap-8 grid-cols-1 md:grid-cols-2 w-full">
              <div className="flex flex-col gap-8 min-h-0 min-w-0 flex-1">
                <SectionCard
                  title="Focus Intensity"
                  description="Minutes of focused work completed each day in the selected range."
                  icon="reports"
                >
                  {/* ...existing Focus Intensity chart code... */}
                  {reportData.dailyFocus && reportData.dailyFocus.length > 0 ? (
                    <div className="h-72 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={reportData.dailyFocus.map((entry) => ({
                            ...entry,
                            focusMin: Math.round(entry.focusSeconds / 60),
                          }))}
                        >
                          <XAxis
                            dataKey="date"
                            tick={{ fontSize: 11, fill: '#948ea1' }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis hide />
                          <Tooltip
                            cursor={{ fill: 'rgba(124, 77, 255, 0.08)' }}
                            contentStyle={{
                              background: '#201f1f',
                              border: '1px solid rgba(73, 68, 85, 0.25)',
                              borderRadius: 16,
                              fontSize: 12,
                              boxShadow: '0 16px 40px rgba(0, 0, 0, 0.28)',
                            }}
                            labelStyle={{ color: '#948ea1' }}
                            itemStyle={{ color: '#cdbdff' }}
                            formatter={(value) => [`${value}m`, 'Focus']}
                          />
                          <Bar dataKey="focusMin" fill="#7c4dff" radius={[10, 10, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="sentinel-empty-state text-sm">No daily focus data in this range yet.</div>
                  )}
                </SectionCard>

                <SectionCard
                  title="Recent Sessions"
                  description="Your latest completed and in-progress sessions."
                  icon="timer"
                >
                  {sessions.length > 0 ? (
                    <>
                      <div className="space-y-3">
                        {pagedSessions.map((session, index) => (
                          <div
                            key={`${session.startedAt}-${index}`}
                            className="rounded-[calc(var(--card-radius)-6px)] border border-[rgba(73,68,85,0.18)] bg-[rgba(14,14,14,0.18)] px-4 py-3"
                          >
                            <div className="flex items-center justify-between gap-4">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-(--text-primary)">
                                  {session.sessionName || new Date(session.startedAt).toLocaleDateString()}
                                </p>
                                <p className="text-xs text-(--text-muted)">
                                  {new Date(session.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  {session.completedAt &&
                                    ` — ${new Date(session.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-semibold text-(--text-primary)">
                                  {formatDuration(session.durationSeconds)}
                                </p>
                                <p className="text-xs text-(--text-muted)">
                                  {session.endedEarly && <span className="text-amber-400">Ended early · </span>}
                                  {session.distractionsCount > 0 && `${session.distractionsCount} distraction${session.distractionsCount !== 1 ? 's' : ''}`}
                                  {session.distractionsCount > 0 && session.falseAlarmCount > 0 && ' · '}
                                  {session.falseAlarmCount > 0 && `${session.falseAlarmCount} false alarm${session.falseAlarmCount !== 1 ? 's' : ''}`}
                                  {session.distractionsCount === 0 && session.falseAlarmCount === 0 && !session.endedEarly && (session.completed ? 'Clean session' : 'In progress')}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-col items-center gap-2 mt-6">
                        <div className="flex gap-4">
                          <button
                            type="button"
                            className={buttonClasses.inline}
                            onClick={() => setSessionPage((p) => Math.max(0, p - 1))}
                            disabled={sessionPage === 0}
                          >
                            Previous
                          </button>
                          <span className="text-xs text-(--text-muted) px-2 py-1 rounded bg-[rgba(73,68,85,0.10)]">
                            Page {sessionPage + 1} of {totalSessionPages}
                          </span>
                          <button
                            type="button"
                            className={buttonClasses.inline}
                            onClick={() => setSessionPage((p) => Math.min(totalSessionPages - 1, p + 1))}
                            disabled={sessionPage >= totalSessionPages - 1}
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="sentinel-empty-state text-sm">Completed sessions will appear here as you work.</div>
                  )}
                </SectionCard>

              </div>

              <div className="flex flex-col gap-8 min-h-0 min-w-0 flex-1">
                <SectionCard
                  title="Top Categories"
                  description="Grouped interruptions so repeat habits are easier to understand at a glance."
                  icon="taxonomy"
                >
                  {/* ...existing Top Categories code... */}
                  {reportData.topCategories && reportData.topCategories.length > 0 ? (
                    <div className="flex flex-col gap-5 md:flex-row xl:flex-col">
                      <div className="mx-auto h-44 w-44 shrink-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={reportData.topCategories.map((item) => ({
                                name: item.name,
                                value: item.count,
                              }))}
                              cx="50%"
                              cy="50%"
                              innerRadius={42}
                              outerRadius={68}
                              dataKey="value"
                            >
                              {reportData.topCategories.map((_, index) => (
                                <Cell key={index} fill={COLORS[index % COLORS.length]} />
                              ))}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                      </div>

                      <div className="flex-1 space-y-3">
                        {reportData.topCategories.slice(0, 5).map((item, index) => (
                          <InsightRow
                            key={item.name}
                            label={item.name}
                            value={item.count}
                            accent={COLORS[index % COLORS.length]}
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="sentinel-empty-state text-sm">
                      Categories appear after you start grouping distractions.
                    </div>
                  )}
                </SectionCard>
                {reportData.dailyFocus && reportData.dailyFocus.length > 0 && (
                  <SectionCard
                    title="Daily Breakdown"
                    description="Focus time, sessions, and distractions per day."
                    icon="reports"
                  >
                    {/* ...existing Daily Breakdown code... */}
                    <div className="space-y-2">
                      {reportData.dailyFocus.slice(-10).map((day) => {
                        const focusMin = Math.round(day.focusSeconds / 60);
                        const barPct = Math.min(100, Math.round((focusMin / 120) * 100));
                        return (
                          <div
                            key={day.date}
                            className="flex items-center gap-3 rounded-[calc(var(--card-radius)-6px)] border border-[rgba(73,68,85,0.18)] bg-[rgba(14,14,14,0.18)] px-4 py-2.5"
                          >
                            <span className="w-16 shrink-0 text-xs font-medium text-(--text-muted)">{day.date}</span>
                            <div className="flex flex-1 items-center gap-4 text-sm text-(--text-secondary)">
                              <span className="flex items-center gap-1.5">
                                <Glyph name="timer" className="h-3 w-3 text-(--text-muted)" />
                                {focusMin}m
                              </span>
                              <span className="flex items-center gap-1.5">
                                <Glyph name="bolt" className="h-3 w-3 text-(--text-muted)" />
                                {day.sessions}
                              </span>
                              {day.distractions > 0 && (
                                <span className="flex items-center gap-1.5 text-amber-400">
                                  <Glyph name="spark" className="h-3 w-3" />
                                  {day.distractions}
                                </span>
                              )}
                            </div>
                            <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-[rgba(73,68,85,0.25)]">
                              <div className="h-full rounded-full bg-[#7c4dff]" style={{ width: `${barPct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </SectionCard>
                )}
                <SectionCard
                  title="Intervention Accuracy"
                  description="How often a pause ended up being a false alarm instead of a real distraction."
                  icon="spark"
                >
                  {/* ...existing Intervention Accuracy code... */}
                  <div className="space-y-2">
                    <p className="text-4xl font-extrabold tracking-tight text-(--text-primary)">
                      {(() => {
                        const total = (reportData.distractionsLogged ?? 0) + (reportData.falseAlarms ?? 0);
                        if (!total) return '100';
                        return Math.round(((total - (reportData.falseAlarms ?? 0)) / total) * 100);
                      })()}%
                    </p>
                    <p className="text-sm leading-7 text-(--text-secondary)">
                      {(reportData.falseAlarms ?? 0)} false alarms out of{' '}
                      {(reportData.distractionsLogged ?? 0) + (reportData.falseAlarms ?? 0)} interventions.
                    </p>
                  </div>
                </SectionCard>
                
                {/* <SectionCard
                  title="Raw Labels"
                  description="The original distraction notes you logged, along with their current category."
                  icon="taxonomy"
                  actions={
                    <button type="button" onClick={onOpenTaxonomy} className={buttonClasses.inline}>
                      Manage Categories
                    </button>
                  }
                >
                  
                  {reportData.topDistractions && reportData.topDistractions.length > 0 ? (
                    <div className="space-y-3">
                      {reportData.topDistractions.map((item) => (
                        <div
                          key={item.name}
                          className="rounded-[calc(var(--card-radius)-6px)] border border-[rgba(73,68,85,0.18)] bg-[rgba(14,14,14,0.18)] px-4 py-3"
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-(--text-primary)">{item.name}</p>
                              <p className="truncate text-xs text-(--text-muted)">{item.categoryName ?? 'Uncategorized'}</p>
                            </div>
                            <span className="text-sm text-(--text-secondary)">{item.count}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="sentinel-empty-state text-sm">No distractions logged in this range yet.</div>
                  )}
                </SectionCard>         */}
              </div>
            </div>
          </>
        ) : (
          <SectionCard bodyClassName="min-h-48 items-center justify-center">
            <span className="text-sm text-(--text-muted)">No data available</span>
          </SectionCard>
        )}
      </ScreenShell>
    </WorkspaceLayout>
  );
}

/* ------------------------------------------------------------------ */
/*  Session History Screen                                            */
/* ------------------------------------------------------------------ */

interface SessionHistoryScreenProps {
  reportData: ReportData | null;
  reportLoading: boolean;
  onBack: () => void;
  onSelectRange: (range: ReportRange) => void;
  navigation: WorkspaceNavigation;
}

export function SessionHistoryScreen({
  reportData,
  reportLoading,
  onBack,
  onSelectRange,
  navigation,
}: SessionHistoryScreenProps) {
  const [range, setRange] = useState<ReportRange>('all');

  const handleRange = (r: ReportRange) => {
    setRange(r);
    onSelectRange(r);
  };

  const sessions = useMemo(() => reportData?.recentSessions ?? [], [reportData]);
  const pager = usePagination(sessions);

  // Reset to page 0 when range changes
  const handleRangeWithReset = (r: ReportRange) => {
    pager.setPage(0);
    handleRange(r);
  };

  const totalFocus = useMemo(
    () => sessions.reduce((sum, s) => sum + s.durationSeconds, 0),
    [sessions],
  );
  const totalDistractions = useMemo(
    () => sessions.reduce((sum, s) => sum + s.distractionsCount, 0),
    [sessions],
  );

  return (
    <WorkspaceLayout
      activeView="history"
      navigation={workspaceNavigation(navigation)}
      statusLabel="Session History"
      statusDetail="Browse all your completed focus sessions."
      topbarMeta={<TopbarPill label="History" icon="history" />}
      role="main"
      aria-label="Session History"
    >
      <ScreenShell wide>
        <ScreenHeader
          eyebrow="Sessions"
          title="History"
          subtitle="A detailed log of every focus session you've completed."
          onBack={onBack}
          backLabel="Back"
          backAriaLabel="Back to timer"
        />

        <SectionCard
          title="Window"
          description="Choose the time range to view sessions from."
          icon="history"
        >
          <div className="flex flex-wrap gap-2">
            {RANGE_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => handleRangeWithReset(key)}
                className={buttonClasses.pill}
                aria-pressed={range === key}
              >
                {label}
              </button>
            ))}
          </div>
        </SectionCard>

        {!reportLoading && sessions.length > 0 && (
          <div className="grid gap-6 sm:grid-cols-3">
            <MetricCard
              icon="target"
              label="Total Focus"
              value={formatDuration(totalFocus)}
              detail={`Across ${sessions.length} session${sessions.length !== 1 ? 's' : ''}`}
              accent="#3ce36a"
            />
            <MetricCard
              icon="bolt"
              label="Sessions"
              value={String(sessions.length)}
              detail={`Avg ${formatDuration(Math.round(totalFocus / sessions.length))}`}
            />
            <MetricCard
              icon="reports"
              label="Distractions"
              value={String(totalDistractions)}
              detail="Total interruptions"
              accent="#00affe"
            />
          </div>
        )}

        {reportLoading ? (
          <SectionCard bodyClassName="min-h-48 items-center justify-center">
            <span className="animate-pulse text-sm text-(--text-muted)">Loading sessions...</span>
          </SectionCard>
        ) : sessions.length > 0 ? (
          <SectionCard
            title={`${sessions.length} Session${sessions.length !== 1 ? 's' : ''}`}
            description="Sorted most-recent first."
            icon="timer"
          >
            <div className="space-y-3">
              {pager.slice.map((session, index) => (
                <div
                  key={`${session.startedAt}-${index}`}
                  className="rounded-[calc(var(--card-radius)-6px)] border border-[rgba(73,68,85,0.18)] bg-[rgba(14,14,14,0.18)] px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-(--text-primary)">
                        {session.sessionName || new Date(session.startedAt).toLocaleDateString()}
                      </p>
                      <p className="text-xs text-(--text-muted)">
                        {new Date(session.startedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {session.completedAt &&
                          ` — ${new Date(session.completedAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-(--text-primary)">
                        {formatDuration(session.durationSeconds)}
                      </p>
                      <p className="text-xs text-(--text-muted)">
                        {session.endedEarly && <span className="text-amber-400">Ended early · </span>}
                        {session.distractionsCount > 0 &&
                          `${session.distractionsCount} distraction${session.distractionsCount !== 1 ? 's' : ''}`}
                        {session.distractionsCount > 0 && session.falseAlarmCount > 0 && ' · '}
                        {session.falseAlarmCount > 0 &&
                          `${session.falseAlarmCount} false alarm${session.falseAlarmCount !== 1 ? 's' : ''}`}
                        {session.distractionsCount === 0 &&
                          session.falseAlarmCount === 0 &&
                          !session.endedEarly &&
                          (session.completed ? 'Clean session' : 'In progress')}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <PaginationBar
              rangeLabel={pager.rangeLabel}
              hasPrev={pager.hasPrev}
              hasNext={pager.hasNext}
              onPrev={pager.prev}
              onNext={pager.next}
            />
          </SectionCard>
        ) : (
          <SectionCard bodyClassName="min-h-48 items-center justify-center">
            <span className="text-sm text-(--text-muted)">No sessions found in this range.</span>
          </SectionCard>
        )}
      </ScreenShell>
    </WorkspaceLayout>
  );
}

/* ------------------------------------------------------------------ */
/*  Taxonomy Manager Screen                                           */
/* ------------------------------------------------------------------ */

interface TaxonomyManagerScreenProps {
  taxonomyData: TaxonomyData;
  onBack: () => void;
  onSaveGroup: (normalizedNote: string, note: string, categoryName: string | null) => void;
  // onRenameCategory: (oldName: string, newName: string) => void;
  navigation: WorkspaceNavigation;
}

export function TaxonomyManagerScreen({
  taxonomyData,
  onBack,
  onSaveGroup,
  navigation,
}: Omit<TaxonomyManagerScreenProps, 'onRenameCategory'>) {
  const [search, setSearch] = useState('');
  const [onlyUncategorized, setOnlyUncategorized] = useState(false);

  const filteredGroups = useMemo(
    () =>
      taxonomyData.groups.filter((group) => {
        const matchesSearch =
          !search.trim() ||
          group.note.toLowerCase().includes(search.trim().toLowerCase()) ||
          (group.categoryName ?? '').toLowerCase().includes(search.trim().toLowerCase());
        const matchesCategory = !onlyUncategorized || !group.categoryName;
        return matchesSearch && matchesCategory;
      }),
    [taxonomyData.groups, search, onlyUncategorized],
  );

  const groupPager = usePagination(filteredGroups);
  const logPager = usePagination(taxonomyData.recentEntries, 8);

  // Reset group page when filters change
  const uncategorizedCount = useMemo(
    () => taxonomyData.groups.filter((g) => !g.categoryName).length,
    [taxonomyData.groups],
  );
  const categorizedPct = taxonomyData.groups.length
    ? Math.round(((taxonomyData.groups.length - uncategorizedCount) / taxonomyData.groups.length) * 100)
    : 0;
  const totalLogs = useMemo(
    () => taxonomyData.groups.reduce((sum, g) => sum + g.count, 0),
    [taxonomyData.groups],
  );

  return (
    <WorkspaceLayout
      activeView="taxonomy"
      navigation={workspaceNavigation(navigation)}
      statusLabel={`${taxonomyData.groups.length} tracked labels`}
      statusDetail="Edit mappings, clean category names, and tighten the reporting engine."
      topbarMeta={<TopbarPill label="Taxonomy Manager" icon="taxonomy" />}
      role="main"
      aria-label="Distraction taxonomy"
    >
      <ScreenShell wide>
        <ScreenHeader
          eyebrow="Classification"
          title="Distraction Taxonomy"
          subtitle="Edit repeated labels, clean up categories, and make reports easier to trust over time."
          onBack={onBack}
          backLabel="Back"
          backAriaLabel="Back to timer"
        />

        {/* ── Summary strip ────────────────────────────────────── */}
        {taxonomyData.groups.length > 0 && (
          <div className="grid gap-6 sm:grid-cols-4">
            <MetricCard
              icon="taxonomy"
              label="Labels"
              value={String(taxonomyData.groups.length)}
              detail="Unique distraction labels"
              accent="#7c4dff"
            />
            <MetricCard
              icon="target"
              label="Categorized"
              value={`${categorizedPct}%`}
              detail={`${uncategorizedCount} still unmapped`}
              accent={categorizedPct >= 80 ? '#3ce36a' : '#f59e0b'}
            />
            <MetricCard
              icon="bolt"
              label="Categories"
              value={String(taxonomyData.categories.length)}
              detail="Active reporting buckets"
              accent="#00affe"
            />
            <MetricCard
              icon="reports"
              label="Total Logs"
              value={String(totalLogs)}
              detail="Distractions recorded"
              accent="#cdbdff"
            />
          </div>
        )}

        <div className="grid gap-8 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)]">
          {/* ── Left column: Manage Labels ─────────────────────── */}
          <SectionCard
            title="Manage Labels"
            description="These grouped labels drive quick suggestions and category-aware reporting."
            icon="taxonomy"
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-(--text-muted)">
                  <Glyph name="search" className="h-4 w-4" />
                </span>
                <input
                  type="text"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    groupPager.setPage(0);
                  }}
                  placeholder="Search distraction labels or categories"
                  className={inputClasses.search}
                  aria-label="Search distraction taxonomy"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setOnlyUncategorized(false);
                    groupPager.setPage(0);
                  }}
                  className={buttonClasses.pill}
                  aria-pressed={!onlyUncategorized}
                >
                  All ({taxonomyData.groups.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOnlyUncategorized((v) => !v);
                    groupPager.setPage(0);
                  }}
                  className={buttonClasses.pill}
                  aria-pressed={onlyUncategorized}
                >
                  Uncategorized ({uncategorizedCount})
                </button>
              </div>
            </div>

            {filteredGroups.length > 0 ? (
              <>
                <div className="space-y-3">
                  {groupPager.slice.map((group) => (
                    <TaxonomyGroupEditor
                      key={`${group.normalizedNote}-${group.note}-${group.categoryName ?? 'none'}-${group.count}`}
                      group={group}
                      categories={taxonomyData.categories}
                      onSave={onSaveGroup}
                    />
                  ))}
                </div>
                <PaginationBar
                  rangeLabel={groupPager.rangeLabel}
                  hasPrev={groupPager.hasPrev}
                  hasNext={groupPager.hasNext}
                  onPrev={groupPager.prev}
                  onNext={groupPager.next}
                />
              </>
            ) : (
              <div className="sentinel-empty-state text-sm">
                No distraction labels match the current filters yet.
              </div>
            )}
          </SectionCard>

          {/* ── Right column: Categories + Recent Logs ─────────── */}
              <div className="flex flex-col gap-8 min-h-0 min-w-0 flex-1">
            <SectionCard
              title="Categories"
              description="Rename categories globally whenever you want cleaner reporting language."
              icon="spark"
            >
              {taxonomyData.categories.length > 0 ? (
                <div className="space-y-3">
                  {taxonomyData.categories.map((category) => (
                    <div key={category} className="flex items-center justify-between">
                      <span className="text-sm font-medium text-(--text-primary)">{category}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="sentinel-empty-state text-sm">
                  Categories appear here after you start mapping distractions.
                </div>
              )}
              {/* No Save/Cancel row here */}
            </SectionCard>

            <SectionCard
              title="Recent Logs"
              description="The latest saved distractions and the categories currently attached to them."
              icon="reports"
            >
              {taxonomyData.recentEntries.length > 0 ? (
                <>
                  <div className="space-y-3">
                    {logPager.slice.map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-[calc(var(--card-radius)-6px)] border border-[rgba(73,68,85,0.18)] bg-[rgba(14,14,14,0.18)] px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-(--text-primary)">{entry.note}</p>
                            <p className="truncate text-xs text-(--text-muted)">
                              {entry.categoryName ?? 'Uncategorized'}
                            </p>
                          </div>
                          <span className="text-xs uppercase tracking-[0.16em] text-(--text-muted)">
                            {new Date(entry.timestamp).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <PaginationBar
                    rangeLabel={logPager.rangeLabel}
                    hasPrev={logPager.hasPrev}
                    hasNext={logPager.hasNext}
                    onPrev={logPager.prev}
                    onNext={logPager.next}
                  />
                </>
              ) : (
                <div className="sentinel-empty-state text-sm">
                  Logged distractions will appear here after the first intervention is saved.
                </div>
              )}
            </SectionCard>
          </div>
        </div>
      </ScreenShell>
    </WorkspaceLayout>
  );
}

interface AuthScreenProps {
  userEmail: string | null;
  authEmail: string;
  authPassword: string;
  authError: string;
  onAuthEmailChange: (value: string) => void;
  onAuthPasswordChange: (value: string) => void;
  onLogin: (event: FormEvent<HTMLFormElement>) => void;
  onSignup: () => void;
  onLogout: () => void;
  onBack: () => void;
  navigation: WorkspaceNavigation;
}

export function AuthScreen({
  userEmail,
  authEmail,
  authPassword,
  authError,
  onAuthEmailChange,
  onAuthPasswordChange,
  onLogin,
  onSignup,
  onLogout,
  onBack,
  navigation,
}: AuthScreenProps) {
  return (
    <WorkspaceLayout
      activeView="account"
      navigation={workspaceNavigation(navigation)}
      statusLabel={userEmail ? 'Account Connected' : 'Local-First Mode'}
      statusDetail={
        userEmail
          ? 'Cloud sync is available whenever it is enabled in settings.'
          : 'Everything works locally without signing in.'
      }
      topbarMeta={<TopbarPill label="Account" icon="account" />}
      role="main"
      aria-label="Account"
    >
      <ScreenShell wide>
        <ScreenHeader
          eyebrow="Identity"
          title="Account"
          subtitle="Sign in only if you want optional cloud backup and cross-device history. Sentinel stays fully usable in local-only mode."
          onBack={onBack}
          backLabel="Back"
          backAriaLabel="Back to timer"
        />

        <div className="grid gap-8 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <SectionCard
            title="Identity & Continuity"
            description="Sentinel is built for local-first privacy. Syncing your data is optional and always secondary to the machine you control."
            icon="shield"
            className="h-full"
            bodyClassName="gap-4"
          >
            <div className="rounded-[calc(var(--card-radius)-6px)] border border-[rgba(73,68,85,0.18)] bg-[rgba(14,14,14,0.18)] p-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-[rgba(60,227,106,0.14)] text-(--tertiary)">
                  <Glyph name="shield" className="h-4 w-4" />
                </span>
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold text-(--text-primary)">Zero-friction local mode</p>
                  <p className="text-sm leading-6 text-(--text-secondary)">
                    You can continue using Sentinel without an account. Sessions, reports, and distraction history
                    still work from the local SQLite store.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[calc(var(--card-radius)-6px)] border border-[rgba(73,68,85,0.18)] bg-[rgba(14,14,14,0.18)] p-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-[rgba(0,175,254,0.14)] text-(--secondary)">
                  <Glyph name="cloud" className="h-4 w-4" />
                </span>
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold text-(--text-primary)">Optional universal sync</p>
                  <p className="text-sm leading-6 text-(--text-secondary)">
                    When enabled, cloud sync lets you preserve sessions across devices without changing the local-first
                    default experience.
                  </p>
                </div>
              </div>
            </div>
          </SectionCard>

          <div className="space-y-8">
            <SectionCard
              title={userEmail ? 'Current Account' : 'Sign In'}
              description={
                userEmail
                  ? 'Your account is available for optional sync and backup.'
                  : 'Use your Firebase email and password only if you want cloud sync.'
              }
              icon="account"
              className="relative overflow-hidden"
            >
              <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-[rgba(124,77,255,0.08)] blur-3xl" />

              {userEmail ? (
                <div className="relative space-y-4">
                  <div className="rounded-[calc(var(--card-radius)-6px)] border border-[rgba(73,68,85,0.18)] bg-[rgba(14,14,14,0.18)] px-4 py-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-(--text-muted)">Signed In As</p>
                    <p className="mt-2 text-base font-semibold text-(--text-primary)">{userEmail}</p>
                  </div>
                  <button type="button" onClick={onLogout} className={buttonClasses.danger}>
                    Logout
                  </button>
                </div>
              ) : (
                <form onSubmit={onLogin} className="relative space-y-4">
                  <FieldBlock label="Email Address" description="Use the account tied to optional cloud sync.">
                    <input
                      type="email"
                      value={authEmail}
                      onChange={(event) => onAuthEmailChange(event.target.value)}
                      placeholder="Email"
                      className={inputClasses.base}
                    />
                  </FieldBlock>

                  <FieldBlock label="Password" description="Local-only mode remains available even without signing in.">
                    <input
                      type="password"
                      value={authPassword}
                      onChange={(event) => onAuthPasswordChange(event.target.value)}
                      placeholder="Password"
                      className={inputClasses.base}
                    />
                  </FieldBlock>

                  {authError && <p className="text-sm text-[#ffb4ab]">{authError}</p>}

                  <ActionGrid>
                    <button type="submit" className={buttonClasses.primary}>
                      Login
                    </button>
                    <button type="button" onClick={onSignup} className={buttonClasses.secondary}>
                      Sign Up
                    </button>
                  </ActionGrid>
                </form>
              )}
            </SectionCard>

            <div className="grid gap-6 md:grid-cols-2">
              <SectionCard
                title="Stay Local"
                description="Everything still works with no account at all."
                icon="database"
                className="h-full"
              >
                <p className="text-sm leading-6 text-(--text-secondary)">
                  Sessions, distractions, taxonomy management, and reports all remain available from local storage.
                </p>
              </SectionCard>

              <SectionCard
                title="Keyboard Ready"
                description="Your shortcuts keep working across the entire app."
                icon="keyboard"
                className="h-full"
              >
                <p className="text-sm leading-6 text-(--text-secondary)">
                  Use global shortcuts to start a session, log distractions, and move quickly without leaving your
                  workspace.
                </p>
              </SectionCard>
            </div>
          </div>
        </div>
      </ScreenShell>
    </WorkspaceLayout>
  );
}

interface SettingsScreenProps {
  settings: Settings;
  exportStatus: string | null;
  updateInfo: { latestVersion: string; downloadUrl: string } | null;
  userEmail: string | null;
  onBack: () => void;
  onSaveSettings: (settings: Settings) => void;
  onApplyPreset: (preset: TimerPreset) => void;
  onExport: (format: 'csv' | 'json') => void;
  onOpenAuth: () => void;
  onOpenTaxonomy: () => void;
  onDismissUpdate: () => void;
  onSeedDatabase: () => void;
  navigation: WorkspaceNavigation;
}

export function SettingsScreen({
  settings,
  exportStatus,
  updateInfo,
  userEmail,
  onBack,
  onSaveSettings,
  onApplyPreset,
  onExport,
  onOpenAuth,
  onOpenTaxonomy,
  onDismissUpdate,
  onSeedDatabase,
  navigation,
}: SettingsScreenProps) {
  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    onSaveSettings({ ...settings, [key]: value });
  };
  const [pendingDeletePresetIndex, setPendingDeletePresetIndex] = useState<number | null>(null);
  const [newPresetNameInput, setNewPresetNameInput] = useState('');
  const [showPresetNameInput, setShowPresetNameInput] = useState(false);

  return (
  <>
    <WorkspaceLayout
      activeView="settings"
      navigation={workspaceNavigation(navigation)}
      statusLabel="Configuration"
      statusDetail="Refine your focus rhythm, interventions, exports, and account behavior."
      topbarMeta={<TopbarPill label="System Settings" icon="settings" />}
      role="main"
      aria-label="Settings"
    >
      <ScreenShell wide>
        <ScreenHeader
          eyebrow="System"
          title="Settings"
          subtitle="Tune session timing, interventions, exports, and account options without changing the way Sentinel works."
          onBack={onBack}
          backLabel="Back"
          backAriaLabel="Back to timer"
        />

        <div className="grid gap-8 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.95fr)]">
          <div className="space-y-8">
            <SectionCard
              title="Timer & Presets"
              description="Set the core rhythm for focus, short breaks, and longer resets."
              icon="timer"
            >
              <FieldBlock
                label="Timer Durations"
                description="These values update the main timer immediately."
              >
                <div className="grid gap-3 min-[520px]:grid-cols-3">
                  <NumberField
                    label="Focus"
                    value={settings.pomodoroMinutes}
                    min={1}
                    max={120}
                    onChange={(value) => updateSetting('pomodoroMinutes', value)}
                  />
                  <NumberField
                    label="Short"
                    value={settings.shortBreakMinutes}
                    min={1}
                    max={30}
                    onChange={(value) => updateSetting('shortBreakMinutes', value)}
                  />
                  <NumberField
                    label="Long"
                    value={settings.longBreakMinutes}
                    min={1}
                    max={60}
                    onChange={(value) => updateSetting('longBreakMinutes', value)}
                  />
                </div>
              </FieldBlock>

              <FieldBlock
                label="Presets"
                description="Quick starting points. You can also save your current timer values as a custom preset."
              >
                <div className="grid gap-3 min-[520px]:grid-cols-3">
                  {PRESETS.map((preset) => (
                    <PresetChoice
                      key={preset.name}
                      preset={preset}
                      active={isPresetActive(settings, preset)}
                      onClick={() => onApplyPreset(preset)}
                    />
                  ))}
                  {(settings.customPresets ?? []).map((preset, index) => (
                    <div key={`custom-${preset.name}-${index}`} className="relative">
                      <PresetChoice
                        preset={preset}
                        active={isPresetActive(settings, preset)}
                        onClick={() => onApplyPreset(preset)}
                      />
                      <button
                        type="button"
                        onClick={() => setPendingDeletePresetIndex(index)}
                        className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500/80 text-xs text-white hover:bg-red-500"
                        aria-label={`Delete ${preset.name} preset`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                {!isPresetActive(settings, PRESETS[0]) && !isPresetActive(settings, PRESETS[1]) && !isPresetActive(settings, PRESETS[2]) && (
                  showPresetNameInput ? (
                    <div className="flex gap-2 items-center w-full max-w-md mx-auto mt-2">
                      <input
                        type="text"
                        value={newPresetNameInput}
                        onChange={(e) => setNewPresetNameInput(e.target.value)}
                        placeholder="Preset name"
                        maxLength={40}
                        autoFocus
                        className={cx(inputClasses.base, 'flex-1 min-w-0')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newPresetNameInput.trim()) {
                            onSaveSettings({ ...settings, customPresets: [...(settings.customPresets ?? []), { name: newPresetNameInput.trim(), focus: settings.pomodoroMinutes, shortBreak: settings.shortBreakMinutes, longBreak: settings.longBreakMinutes }] });
                            setNewPresetNameInput('');
                            setShowPresetNameInput(false);
                          }
                          if (e.key === 'Escape') { setNewPresetNameInput(''); setShowPresetNameInput(false); }
                        }}
                      />
                      <button
                        type="button"
                        disabled={!newPresetNameInput.trim() || (settings.customPresets ?? []).some(p => p.name.toLowerCase() === newPresetNameInput.trim().toLowerCase())}
                        onClick={() => {
                          if (!newPresetNameInput.trim()) return;
                          onSaveSettings({ ...settings, customPresets: [...(settings.customPresets ?? []), { name: newPresetNameInput.trim(), focus: settings.pomodoroMinutes, shortBreak: settings.shortBreakMinutes, longBreak: settings.longBreakMinutes }] });
                          setNewPresetNameInput('');
                          setShowPresetNameInput(false);
                        }}
                        className={buttonClasses.primary}
                      >
                        Save
                      </button>
                      <button type="button" onClick={() => { setNewPresetNameInput(''); setShowPresetNameInput(false); }} className={buttonClasses.secondary}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                  <button
                    type="button"
                    onClick={() => setShowPresetNameInput(true)}
                    className={buttonClasses.inline}
                  >
                    Save Current as Preset
                  </button>
                  )
                )}
              </FieldBlock>

              <FieldBlock
                label="Export Data"
                description="Create JSON or CSV exports without leaving the app."
              >
                <ActionGrid>
                  <button type="button" onClick={() => onExport('json')} className={buttonClasses.secondary}>
                    JSON
                  </button>
                  <button type="button" onClick={() => onExport('csv')} className={buttonClasses.secondary}>
                    CSV
                  </button>
                </ActionGrid>
                {exportStatus && <p className="text-sm text-(--text-muted)">{exportStatus}</p>}
              </FieldBlock>
              <FieldBlock
                label="Demo Data"
                description="Load sample sessions and distractions to explore all features. Safe to run once — ignored if data already exists."
              >
                <button type="button" onClick={onSeedDatabase} className={buttonClasses.secondary}>
                  Load Demo Data
                </button>
              </FieldBlock>
            </SectionCard>
          </div>

          <div className="space-y-8">
              <SectionCard
                title="Presets"
                description="Quick starting points. Apply one to jump straight into a session."
                icon="bolt"
              >
                <div className="grid gap-3 min-[520px]:grid-cols-3">
                  {PRESETS.map((preset) => (
                    <PresetChoice
                      key={preset.name}
                      preset={preset}
                      active={isPresetActive(settings, preset)}
                      onClick={() => onApplyPreset(preset)}
                    />
                  ))}
                  {(settings.customPresets ?? []).map((preset, index) => (
                    <div key={`custom-${preset.name}-${index}`} className="relative">
                      <PresetChoice
                        preset={preset}
                        active={isPresetActive(settings, preset)}
                        onClick={() => onApplyPreset(preset)}
                      />
                      <button
                        type="button"
                        onClick={() => setPendingDeletePresetIndex(index)}
                        className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500/80 text-xs text-white hover:bg-red-500"
                        aria-label={`Delete ${preset.name} preset`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                {!isPresetActive(settings, PRESETS[0]) && !isPresetActive(settings, PRESETS[1]) && !isPresetActive(settings, PRESETS[2]) && (
                  showPresetNameInput ? (
                    <div className="flex gap-2 items-center">
                      <input
                        type="text"
                        value={newPresetNameInput}
                        onChange={(e) => setNewPresetNameInput(e.target.value)}
                        placeholder="Preset name"
                        maxLength={40}
                        autoFocus
                        className={cx(inputClasses.base, 'flex-1')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newPresetNameInput.trim()) {
                            onSaveSettings({ ...settings, customPresets: [...(settings.customPresets ?? []), { name: newPresetNameInput.trim(), focus: settings.pomodoroMinutes, shortBreak: settings.shortBreakMinutes, longBreak: settings.longBreakMinutes }] });
                            setNewPresetNameInput('');
                            setShowPresetNameInput(false);
                          }
                          if (e.key === 'Escape') { setNewPresetNameInput(''); setShowPresetNameInput(false); }
                        }}
                      />
                      <button
                        type="button"
                        disabled={!newPresetNameInput.trim()}
                        onClick={() => {
                          if (!newPresetNameInput.trim()) return;
                          onSaveSettings({ ...settings, customPresets: [...(settings.customPresets ?? []), { name: newPresetNameInput.trim(), focus: settings.pomodoroMinutes, shortBreak: settings.shortBreakMinutes, longBreak: settings.longBreakMinutes }] });
                          setNewPresetNameInput('');
                          setShowPresetNameInput(false);
                        }}
                        className={buttonClasses.primary}
                      >
                        Save
                      </button>
                      <button type="button" onClick={() => { setNewPresetNameInput(''); setShowPresetNameInput(false); }} className={buttonClasses.secondary}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowPresetNameInput(true)}
                      className={buttonClasses.inline}
                    >
                      Save Current as Preset
                    </button>
                  )
                )}
              </SectionCard>

            <SectionCard
              title="Account & Shortcuts"
              description="Manage optional sign-in and keep the most useful keyboard actions close."
              icon="account"
            >
              {updateInfo && updateInfo.downloadUrl && /^https:\/\/github\.com\//.test(updateInfo.downloadUrl) && (
                <div className="rounded-[calc(var(--card-radius)-6px)] border border-[rgba(124,77,255,0.26)] bg-[rgba(124,77,255,0.12)] px-4 py-4">
                  <p className="text-sm font-semibold text-(--primary)">
                    Update available: v{updateInfo.latestVersion}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <a
                      href={updateInfo.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="sentinel-inline-button"
                    >
                      Download
                    </a>
                    <button type="button" onClick={onDismissUpdate} className={buttonClasses.ghost}>
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              <FieldBlock
                label="Account"
                description={
                  userEmail
                    ? `Signed in as ${userEmail}`
                    : 'Sign in if you want cloud backup. Local mode works without an account.'
                }
              >
                <button type="button" onClick={onOpenAuth} className={buttonClasses.secondary}>
                  {userEmail ? `Manage ${userEmail.split('@')[0]}` : 'Login / Sign Up'}
                </button>
              </FieldBlock>

              <FieldBlock
                label="Keyboard Shortcuts"
                description="Useful desktop shortcuts that work from anywhere."
              >
                <div className="rounded-[calc(var(--card-radius)-6px)] border border-[rgba(73,68,85,0.18)] bg-[rgba(14,14,14,0.18)] px-4 py-4">
                  <div className="space-y-3 text-sm text-(--text-secondary)">
                    {SHORTCUTS.map((shortcut) => (
                      <p key={shortcut}>{shortcut}</p>
                    ))}
                  </div>
                </div>
              </FieldBlock>
            </SectionCard>

            <SectionCard
              title="Data Organization"
              description="Review repeated distractions, adjust categories, and keep reporting tidy over time."
              icon="taxonomy"
            >
              <FieldBlock
                label="Distraction Taxonomy"
                description="Open the manager for editing labels, categories, and historical mappings."
              >
                <button type="button" onClick={onOpenTaxonomy} className={buttonClasses.secondary}>
                  Manage Categories
                </button>
              </FieldBlock>
            </SectionCard>
          </div>
        </div>
      </ScreenShell>
    </WorkspaceLayout>
    {pendingDeletePresetIndex !== null && (
      <ConfirmModal
        title="Delete Preset"
        message={`Delete "${(settings.customPresets ?? [])[pendingDeletePresetIndex]?.name ?? 'this preset'}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          const updated = (settings.customPresets ?? []).filter((_, i) => i !== pendingDeletePresetIndex);
          onSaveSettings({ ...settings, customPresets: updated });
          setPendingDeletePresetIndex(null);
        }}
        onCancel={() => setPendingDeletePresetIndex(null)}
      />
    )}
  </>
  );
}

interface SessionCompleteScreenProps {
  sessionName: string;
  chartData: { name: string; value: number }[];
  onTakeBreak: () => void;
  onAgain: () => void;
  onExit: () => void;
}

export function SessionCompleteScreen({
  sessionName,
  chartData,
  onTakeBreak,
  onAgain,
  onExit,
}: SessionCompleteScreenProps) {
  return (
    <ModalLayout>
      <ModalCard className="w-full max-w-136">
        <div className="space-y-6 text-center">
          <div className="space-y-3">
            <p className="sentinel-eyebrow">Session Complete</p>
            <h1 className="text-3xl font-extrabold tracking-tight text-(--text-primary)">
              Focus block finished
            </h1>
            {sessionName && <p className="text-sm text-(--text-secondary)">{sessionName}</p>}
          </div>

          {chartData.length > 0 && (
            <div className="mx-auto h-40 w-40">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={chartData} cx="50%" cy="50%" innerRadius={34} outerRadius={60} dataKey="value">
                    {chartData.map((_, index) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          <p className="text-sm leading-7 text-(--text-secondary)">
            Take a reset or jump directly into the next deep work block.
          </p>

          <ActionGrid>
            <button type="button" onClick={onTakeBreak} className={buttonClasses.secondary}>
              Take Break
            </button>
            <button type="button" onClick={onAgain} className={buttonClasses.primary}>
              Start Again
            </button>
            <button type="button" onClick={onExit} className={buttonClasses.secondary}>
              Exit
            </button>
          </ActionGrid>
        </div>
      </ModalCard>
    </ModalLayout>
  );
}

interface CompactTimerScreenProps {
  timerMode: TimerMode;
  timeLabel: string;
  isRunning: boolean;
  progressPercent: number;
  overlayStyle: OverlayStyle;
  distractionCount: number;
  onStartPause: () => void;
  onReset: () => void;
  onExpand: () => void;
  onClose: () => void;
}

export function CompactTimerScreen({
  timerMode,
  timeLabel,
  isRunning,
  progressPercent,
  overlayStyle,
  distractionCount,
  onStartPause,
  onReset,
  onExpand,
  onClose,
}: CompactTimerScreenProps) {
  const modeMeta = MODE_META[timerMode];

  if (overlayStyle === 'pill') {
    return (
      <div
        role="main"
        aria-label="Mini overlay timer"
        className="sentinel-glass-overlay flex h-full w-full select-none flex-col overflow-hidden"
      >
        <div
          className="sentinel-overlay-drag flex items-center justify-between px-3 pt-2"
          onDoubleClick={onExpand}
        >
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: modeMeta.accent }} />
            <span className="text-[0.6rem] font-semibold uppercase tracking-widest" style={{ color: modeMeta.accent }}>
              {modeMeta.label}
            </span>
          </div>
          <div className="sentinel-overlay-nodrag flex items-center gap-1">
            <button type="button" onClick={onExpand} className="sentinel-overlay-btn" aria-label="Expand" title="Double-click anywhere or click here to expand">
              <Glyph name="overlay" className="h-3 w-3" />
            </button>
            <button type="button" onClick={onClose} className="sentinel-overlay-btn sentinel-overlay-btn--close" aria-label="Close" title="Close">
              &times;
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onStartPause}
          className="flex flex-1 items-center justify-center [font-family:var(--font-display)] text-2xl font-extrabold tracking-tighter text-(--text-primary)"
          role="timer"
          aria-live="polite"
          aria-label={`${timeLabel} remaining`}
        >
          {timeLabel}
        </button>
        <div className="absolute bottom-0 left-0 h-0.75 w-full bg-[rgba(53,53,52,0.6)]">
          <div className="h-full transition-[width] duration-500" style={{ width: `${progressPercent}%`, background: `linear-gradient(to right, ${modeMeta.accent}, ${modeMeta.accent}88)`, boxShadow: `0 0 8px ${modeMeta.accent}66` }} />
        </div>
      </div>
    );
  }

  if (overlayStyle === 'monitoring') {
    return (
      <div
        role="main"
        aria-label="Mini overlay timer"
        className="sentinel-glass-overlay flex h-full w-full select-none flex-col overflow-hidden"
      >
        <div
          className="sentinel-overlay-drag flex items-center justify-between px-3 pt-2"
          onDoubleClick={onExpand}
        >
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: modeMeta.accent }} />
            <span className="text-[0.6rem] font-semibold uppercase tracking-widest" style={{ color: modeMeta.accent }}>
              {modeMeta.label}
            </span>
          </div>
          <div className="sentinel-overlay-nodrag flex items-center gap-1">
            <button type="button" onClick={onExpand} className="sentinel-overlay-btn" aria-label="Expand" title="Double-click anywhere or click here to expand">
              <Glyph name="overlay" className="h-3 w-3" />
            </button>
            <button type="button" onClick={onClose} className="sentinel-overlay-btn sentinel-overlay-btn--close" aria-label="Close" title="Close">
              &times;
            </button>
          </div>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-1 -mt-0.5">
          <span className="[font-family:var(--font-display)] text-3xl font-extrabold tracking-tighter text-(--text-primary) leading-none">
            {timeLabel}
          </span>
          <span className="text-[0.58rem] uppercase tracking-[0.14em] text-(--text-muted)">
            {isRunning ? 'In deep work' : 'Ready'}
            {distractionCount > 0 && ` \u00b7 ${distractionCount} drift${distractionCount > 1 ? 's' : ''}`}
          </span>
        </div>
        <div className="sentinel-overlay-nodrag flex items-center justify-center gap-3 pb-2">
          <button type="button" onClick={onStartPause} className="sentinel-overlay-btn" aria-label={isRunning ? 'Pause' : 'Start'} title={isRunning ? 'Pause' : 'Start'}>
            <Glyph name={isRunning ? 'pause' : 'play'} className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onReset} className="sentinel-overlay-btn" aria-label="Reset" title="Reset">
            <Glyph name="stop" className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="absolute bottom-0 left-0 h-0.75 w-full bg-[rgba(53,53,52,0.6)]">
          <div className="h-full transition-[width] duration-500" style={{ width: `${progressPercent}%`, background: `linear-gradient(to right, ${modeMeta.accent}, ${modeMeta.accent}88)`, boxShadow: `0 0 8px ${modeMeta.accent}66` }} />
        </div>
      </div>
    );
  }

  // Default: "compact" — Functional Compact
  return (
    <div
      role="main"
      aria-label="Mini overlay timer"
      className="sentinel-glass-overlay flex h-full w-full select-none flex-col overflow-hidden"
    >
      <div
        className="sentinel-overlay-drag flex items-center justify-between px-3 pt-2"
        onDoubleClick={onExpand}
      >
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: modeMeta.accent }} />
          <span className="text-[0.6rem] font-semibold uppercase tracking-widest" style={{ color: modeMeta.accent }}>
            {modeMeta.label}
          </span>
        </div>
        <div className="sentinel-overlay-nodrag flex items-center gap-1">
          <button type="button" onClick={onExpand} className="sentinel-overlay-btn" aria-label="Expand" title="Double-click anywhere or click here to expand">
            <Glyph name="overlay" className="h-3 w-3" />
          </button>
          <button type="button" onClick={onClose} className="sentinel-overlay-btn sentinel-overlay-btn--close" aria-label="Close" title="Close">
            &times;
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={onStartPause}
        className="flex flex-1 items-center justify-center [font-family:var(--font-display)] text-3xl font-extrabold tracking-tighter text-(--text-primary) leading-none"
        role="timer"
        aria-live="polite"
        aria-label={`${timeLabel} remaining`}
      >
        {timeLabel}
      </button>
      <div className="sentinel-overlay-nodrag flex items-center justify-center gap-3 pb-2">
        <button type="button" onClick={onStartPause} className="sentinel-overlay-btn" aria-label={isRunning ? 'Pause' : 'Start'} title={isRunning ? 'Pause' : 'Start'}>
          <Glyph name={isRunning ? 'pause' : 'play'} className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={onReset} className="sentinel-overlay-btn" aria-label="Reset" title="Reset">
          <Glyph name="stop" className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="absolute bottom-0 left-0 h-0.75 w-full bg-[rgba(53,53,52,0.6)]">
        <div className="h-full transition-[width] duration-500" style={{ width: `${progressPercent}%`, background: `linear-gradient(to right, ${modeMeta.accent}, ${modeMeta.accent}88)`, boxShadow: `0 0 8px ${modeMeta.accent}66` }} />
      </div>
    </div>
  );
}

interface TimerScreenProps {
  sessionName: string;
  onSessionNameChange: (value: string) => void;
  timerMode: TimerMode;
  timeLabel: string;
  isRunning: boolean;
  isPausedByIntervention: boolean;
  showIntervention: boolean;
  sessionsCompleted: number;
  distractionCount: number;
  isSynced: boolean;
  dailyGoalMinutes: number;
  goalProgress: number;
  timerProgress: number;
  isSnoozed: boolean;
  snoozeText: string;
  showPresets: boolean;
  settings: Settings;
  onModeChange: (mode: TimerMode) => void;
  onStartPause: () => void;
  onReset: () => void;
  onEndSession: () => void;
  onCancelSnooze: () => void;
  onToggleCompact: () => void;
  onTogglePresets: () => void;
  onOpenReports: () => void;
  onOpenSettings: () => void;
  onApplyPreset: (preset: TimerPreset) => void;
  navigation: WorkspaceNavigation;
}

export function TimerScreen({
  sessionName,
  onSessionNameChange,
  timerMode,
  timeLabel,
  isRunning,
  isPausedByIntervention,
  showIntervention,
  sessionsCompleted,
  distractionCount,
  isSynced,
  dailyGoalMinutes,
  goalProgress,
  timerProgress,
  isSnoozed,
  snoozeText,
  showPresets,
  settings,
  onModeChange,
  onStartPause,
  onReset,
  onEndSession,
  onCancelSnooze,
  onToggleCompact,
  onTogglePresets,
  // onOpenReports,
  // onOpenSettings,
  onApplyPreset,
  navigation,
}: TimerScreenProps) {
  const modeMeta = MODE_META[timerMode];
  const statusLabel = isRunning ? modeMeta.topbarLabel : `${modeMeta.label} Ready`;
  const statusDetail = isSnoozed
    ? `Interventions snoozed for ${snoozeText}.`
    : isSynced
      ? 'Cloud sync is enabled for this workspace.'
      : 'Local-first mode keeps everything on this machine.';

  return (
    <WorkspaceLayout
      activeView="timer"
      navigation={workspaceNavigation(navigation)}
      statusLabel={statusLabel}
      statusDetail={statusDetail}
      topbarMeta={<TopbarPill label={modeMeta.label} icon="target" accent={modeMeta.accent} />}
      role="main"
      aria-label="Focus timer"
    >
      <ScreenShell wide className="justify-center">
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1.15fr)_20rem]">
          <div className="space-y-8">
            <div className="space-y-3">
              <p className="sentinel-eyebrow">Current Session</p>
              <div className="max-w-xl">
                <input
                  type="text"
                  value={sessionName}
                  onChange={(event) => onSessionNameChange(event.target.value)}
                  placeholder="Name this focus session..."
                  className={inputClasses.subtle}
                  aria-label="Session name"
                />
              </div>
            </div>

            <div className="sentinel-panel flex flex-wrap gap-2 p-2" role="tablist" aria-label="Timer mode">
              {(['pomodoro', 'shortBreak', 'longBreak'] as TimerMode[]).map((mode) => {
                const isActive = timerMode === mode;
                const meta = MODE_META[mode];
                const locked = isRunning && !isActive;

                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onModeChange(mode)}
                    disabled={locked}
                    role="tab"
                    aria-selected={isActive}
                    title={locked ? 'Stop the timer before switching modes' : undefined}
                    className="flex-1 rounded-2xl px-4 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                    style={
                      isActive
                        ? {
                            background: meta.accentSoft,
                            color: meta.accentText,
                            boxShadow: `inset 0 0 0 1px ${meta.accent}`,
                          }
                        : {
                            color: 'var(--text-muted)',
                          }
                    }
                  >
                    {meta.label}
                  </button>
                );
              })}
            </div>

            <section className="sentinel-panel sentinel-card sentinel-focus-stage">
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.22em] text-(--text-muted)">{modeMeta.label} Session</p>
                    <p className="text-sm text-(--text-secondary)">
                      {isRunning ? 'Timer is live and tracking your work.' : 'Start when you are ready to settle in.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={onToggleCompact} className={buttonClasses.icon} aria-label="Switch to mini overlay">
                      <Glyph name="pip" className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={onTogglePresets} className={buttonClasses.inline}>
                      Presets
                    </button>
                  </div>
                </div>

                <div className="flex flex-col items-center justify-center gap-4 text-center">
                  <ProgressRing progress={timerProgress} accent={modeMeta.accent} timeLabel={timeLabel} />

                  {isPausedByIntervention && !showIntervention && (
                    <p className="rounded-full bg-[rgba(0,175,254,0.12)] px-4 py-2 text-sm text-(--secondary)">
                      Timer paused because a distraction was detected.
                    </p>
                  )}

                  {isSnoozed && (
                    <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
                      <span className="rounded-full bg-[rgba(60,227,106,0.12)] px-4 py-2 text-(--tertiary)">
                        Snoozed for {snoozeText}
                      </span>
                      <button type="button" onClick={onCancelSnooze} className={buttonClasses.ghost}>
                        Cancel
                      </button>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={onStartPause}
                      aria-label={isRunning ? 'Pause timer' : 'Start timer'}
                      className={buttonClasses.primary}
                      style={{ minWidth: '10rem' }}
                    >
                      {isRunning ? 'Pause Session' : 'Start Focus'}
                    </button>
                    {(isRunning || isPausedByIntervention || timerProgress > 0) && (
                      <button type="button" onClick={onReset} className={buttonClasses.secondary} style={{ minWidth: '8rem' }}>
                        Reset
                      </button>
                    )}
                    {timerMode === 'pomodoro' && (isRunning || timerProgress > 0) && (
                      <button type="button" onClick={onEndSession} className={buttonClasses.inline}>
                        End Session
                      </button>
                    )}
                  </div>
                </div>

                {showPresets && (
                  <div className="rounded-[calc(var(--card-radius)-6px)] border border-[rgba(73,68,85,0.18)] bg-[rgba(14,14,14,0.18)] p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-(--text-primary)">Focus Presets</p>
                        <p className="text-xs text-(--text-muted)">Apply a saved rhythm instantly.</p>
                      </div>
                      <button type="button" onClick={onTogglePresets} className={buttonClasses.ghost}>
                        Hide
                      </button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {PRESETS.map((preset) => (
                        <PresetChoice
                          key={preset.name}
                          preset={preset}
                          active={isPresetActive(settings, preset)}
                          onClick={() => onApplyPreset(preset)}
                        />
                      ))}
                      {(settings.customPresets ?? []).map((preset, index) => (
                        <PresetChoice
                          key={`custom-${preset.name}-${index}`}
                          preset={preset}
                          active={isPresetActive(settings, preset)}
                          onClick={() => onApplyPreset(preset)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

            </section>
          </div>

          <div className="space-y-8">
            <SectionCard
              title="Session Snapshot"
              description="A quick read on your current focus block."
              icon="reports"
            >
              <InsightRow label="Mode" value={modeMeta.label} accent={modeMeta.accent} />
              <InsightRow label="State" value={isRunning ? 'Running' : 'Paused'} accent={modeMeta.accent} />
              <InsightRow label="Cloud Sync" value={isSynced ? 'Enabled' : 'Local Only'} accent={isSynced ? '#3ce36a' : '#948ea1'} />
              <InsightRow label="Interventions" value={isSnoozed ? `Snoozed ${snoozeText}` : 'Watching for drift'} accent={isSnoozed ? '#3ce36a' : '#00affe'} />
            </SectionCard>

            {/* <SectionCard
              title="Workspace Actions"
              description="Jump into the full dashboard without losing timer context."
              icon="dashboard"
            >
              <div className="grid gap-3">
                <button type="button" onClick={onOpenReports} className={buttonClasses.secondary}>
                  Open Reports
                </button>
                <button type="button" onClick={navigation.onOpenTaxonomy} className={buttonClasses.secondary}>
                  Open Taxonomy
                </button>
                <button type="button" onClick={onOpenSettings} className={buttonClasses.secondary}>
                  Open Settings
                </button>
              </div>
            </SectionCard> */}

            <SectionCard
              title="Progress Today"
              description="Quick pulse on today's output."
              icon="target"
            >
              <InsightRow label="Completed" value={sessionsCompleted} accent="#3ce36a" />
              <InsightRow label="Distractions" value={distractionCount} accent="#00affe" />
              {dailyGoalMinutes > 0 && (
                <InsightRow label="Goal" value={`${Math.round(goalProgress)}%`} accent="#cdbdff" />
              )}
            </SectionCard>
          </div>
        </div>
      </ScreenShell>
    </WorkspaceLayout>
  );
}

function workspaceNavigation(navigation: WorkspaceNavigation) {
  return {
    timer: navigation.onOpenTimer,
    reports: navigation.onOpenReports,
    history: navigation.onOpenHistory,
    taxonomy: navigation.onOpenTaxonomy,
    settings: navigation.onOpenSettings,
    account: navigation.onOpenAccount,
  };
}

function labelForRange(range: ReportRange) {
  return RANGE_OPTIONS.find((option) => option.key === range)?.label ?? 'Custom';
}

// function interventionAccuracy(reportData: ReportData) {
//   const total = reportData.distractionsLogged + reportData.falseAlarms;
//   if (!total) return 100;
//   return Math.round(((total - reportData.falseAlarms) / total) * 100);
// }

function TopbarPill({
  label,
  icon,
  accent,
}: {
  label: string;
  icon: Parameters<typeof Glyph>[0]['name'];
  accent?: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-[rgba(73,68,85,0.22)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-(--text-secondary)"
      style={accent ? { color: accent } : undefined}
    >
      <Glyph name={icon} className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon,
  accent = '#cdbdff',
}: {
  label: string;
  value: string;
  detail: string;
  icon: Parameters<typeof Glyph>[0]['name'];
  accent?: string;
}) {
  return (
    <div className="sentinel-panel sentinel-card sentinel-metric-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-(--text-muted)">
            {label}
          </p>
          <p className="mt-2 text-2xl font-extrabold tracking-tight" style={{ color: accent }}>
            {value}
          </p>
          <p className="mt-1.5 text-sm leading-6 text-(--text-secondary)">{detail}</p>
        </div>
        <span
          className="inline-flex h-11 w-11 items-center justify-center rounded-2xl"
          style={{ background: `${accent}20`, color: accent }}
        >
          <Glyph name={icon} className="h-5 w-5" />
        </span>
      </div>
    </div>
  );
}

function InsightRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent: string;
}) {
  return (
    <div className="rounded-[calc(var(--card-radius)-6px)] border border-[rgba(73,68,85,0.18)] bg-[rgba(14,14,14,0.18)] px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm text-(--text-secondary)">{label}</span>
        <span className="text-sm font-semibold" style={{ color: accent }}>
          {value}
        </span>
      </div>
    </div>
  );
}

function ProgressRing({
  progress,
  accent,
  timeLabel,
}: {
  progress: number;
  accent: string;
  timeLabel: string;
}) {
  const safeProgress = Math.max(0, Math.min(100, progress));
  const radius = 120;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - safeProgress / 100);

  return (
    <div className="relative flex h-56 w-56 items-center justify-center sm:h-64 sm:w-64">
      <svg viewBox="0 0 280 280" className="h-full w-full -rotate-90">
        <circle
          cx="140"
          cy="140"
          r={radius}
          fill="transparent"
          stroke="rgba(73, 68, 85, 0.28)"
          strokeWidth="8"
        />
        <circle
          cx="140"
          cy="140"
          r={radius}
          fill="transparent"
          stroke={accent}
          strokeWidth="8"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 16px ${accent}55)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="[font-family:var(--font-display)] text-5xl font-extrabold tracking-tight text-(--text-primary) sentinel-focus-glow sm:text-6xl">
          {timeLabel}
        </span>
        <span className="mt-2 text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-(--text-muted)">
          {safeProgress}% complete
        </span>
      </div>
    </div>
  );
}

function PresetChoice({
  preset,
  active,
  onClick,
}: {
  preset: TimerPreset;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full h-full rounded-[calc(var(--card-radius)-6px)] border px-4 py-4 text-left transition-colors"
      style={
        active
          ? {
              borderColor: 'rgba(124, 77, 255, 0.45)',
              background: 'rgba(124, 77, 255, 0.16)',
              color: '#cdbdff',
            }
          : {
              borderColor: 'rgba(73, 68, 85, 0.22)',
              background: 'rgba(14, 14, 14, 0.18)',
              color: 'var(--text-primary)',
            }
      }
    >
      <span className="block text-sm font-semibold">{preset.name}</span>
      <span className="mt-1 block text-xs text-(--text-muted)">
        {preset.focus}/{preset.shortBreak}/{preset.longBreak}
      </span>
    </button>
  );
}

function TaxonomyGroupEditor({
  group,
  categories,
  onSave,
}: {
  group: DistractionGroup;
  categories: string[];
  onSave: (normalizedNote: string, note: string, categoryName: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState(group.note);
  const [categorySelection, setCategorySelection] = useState(group.categoryName ?? '__none__');
  const [newCategoryName, setNewCategoryName] = useState('');

  const resolvedCategoryName =
    categorySelection === '__none__'
      ? null
      : categorySelection === '__new__'
        ? newCategoryName.trim() || null
        : categorySelection;

  return (
    <div className="rounded-[calc(var(--card-radius)-6px)] border border-[rgba(73,68,85,0.18)] bg-[rgba(14,14,14,0.18)] px-4 py-3">
      {/* ── Summary row (always visible) ─── */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={expanded}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-(--text-primary)">{group.note}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span
              className="inline-block rounded-full px-2 py-0.5 text-[0.64rem] font-semibold uppercase tracking-[0.12em]"
              style={
                group.categoryName
                  ? { background: 'rgba(124, 77, 255, 0.14)', color: '#cdbdff' }
                  : { background: 'rgba(148, 142, 161, 0.14)', color: 'var(--text-muted)' }
              }
            >
              {group.categoryName ?? 'Uncategorized'}
            </span>
            <span className="text-[0.64rem] text-(--text-muted)">
              {group.count} log{group.count !== 1 ? 's' : ''} · last {new Date(group.lastSeenAt).toLocaleDateString()}
            </span>
          </div>
        </div>
        <span className="shrink-0 text-xs text-(--text-muted)">{expanded ? '▲' : '▼'}</span>
      </button>

      {/* ── Edit panel (expanded) ─── */}
      {expanded && (
        <div className="mt-3 grid gap-3 border-t border-[rgba(73,68,85,0.18)] pt-3">
          <input
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={inputClasses.base}
            aria-label={`Label for ${group.note}`}
          />

          <select
            value={categorySelection}
            onChange={(event) => setCategorySelection(event.target.value)}
            className={inputClasses.base}
            aria-label={`Category for ${group.note}`}
          >
            <option value="__none__">Uncategorized</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
            <option value="__new__">Create new category</option>
          </select>

          {categorySelection === '__new__' && (
            <input
              type="text"
              value={newCategoryName}
              onChange={(event) => setNewCategoryName(event.target.value)}
              placeholder="New category name"
              maxLength={50}
              className={inputClasses.base}
              aria-label={`New category for ${group.note}`}
            />
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-(--text-muted)">
              Bucket: {resolvedCategoryName ?? 'Uncategorized'}
            </p>
            <button
              type="button"
              onClick={() => onSave(group.normalizedNote, note, resolvedCategoryName)}
              className={cx(buttonClasses.secondary, 'sm:w-auto')}
              disabled={!note.trim() || (categorySelection === '__new__' && !newCategoryName.trim())}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// function CategoryRenameRow({
//   category,
//   onRename,
// }: {
//   category: string;
//   onRename: (oldName: string, newName: string) => void;
// }) {
//   const [isEditing, setIsEditing] = useState(false);
//   const [nextName, setNextName] = useState(category);
//
//   if (isEditing) {
//     return (
//       <div className="flex items-center gap-2 rounded border border-[rgba(124,77,255,0.3)] bg-[rgba(14,14,14,0.18)] px-2 py-1.5 w-full max-w-md mx-auto">
//         <input
//           type="text"
//           value={nextName}
//           onChange={(event) => setNextName(event.target.value)}
//           onKeyDown={(e) => {
//             if (e.key === 'Enter' && nextName.trim() && nextName.trim() !== category) {
//               onRename(category, nextName.trim());
//               setIsEditing(false);
//             }
//             if (e.key === 'Escape') {
//               setNextName(category);
//               setIsEditing(false);
//             }
//           }}
//           autoFocus
//           aria-label={`Rename ${category}`}
//           className={cx(inputClasses.base, 'flex-1 min-w-0')}
//         />
//         <button
//           type="button"
//           onClick={() => { onRename(category, nextName.trim()); setIsEditing(false); }}
//           disabled={!nextName.trim() || nextName.trim() === category}
//           className={cx(buttonClasses.primary, 'px-3 py-1.5 text-sm')}
//         >
//           Save
//         </button>
//         <button
//           type="button"
//           onClick={() => { setNextName(category); setIsEditing(false); }}
//           className={cx(buttonClasses.secondary, 'px-3 py-1.5 text-sm')}
//         >
//           Cancel
//         </button>
//       </div>
//     );
//   }
//
//   return (
//     <button
//       type="button"
//       onClick={() => setIsEditing(true)}
//       className="flex w-full items-center justify-between rounded-[calc(var(--card-radius)-6px)] border border-[rgba(73,68,85,0.18)] bg-[rgba(14,14,14,0.18)] px-4 py-2.5 text-left transition-colors hover:border-[rgba(124,77,255,0.3)] hover:bg-[rgba(124,77,255,0.05)]"
//       aria-label={`Edit category ${category}`}
//     >
//       <span className="text-sm font-medium text-(--text-primary)">{category}</span>
//       <Glyph name="spark" className="h-3.5 w-3.5 text-(--text-muted)" />
//     </button>
//   );
// }

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="rounded-[calc(var(--card-radius)-6px)] border border-[rgba(73,68,85,0.18)] bg-[rgba(14,14,14,0.18)] px-4 py-3">
      <span className="mb-2 block text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-(--text-muted)">
        {label}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => {
          const raw = Number(event.target.value);
          if (Number.isNaN(raw)) return;
          onChange(Math.min(max, Math.max(min, raw)));
        }}
        className={cx(inputClasses.base, 'min-h-0 border-0 bg-transparent px-0 py-0 text-3xl font-extrabold tracking-tight shadow-none')}
      />
    </label>
  );
}
