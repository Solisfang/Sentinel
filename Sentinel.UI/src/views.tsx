import { useState, type FormEvent } from 'react';
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
import type {
  DistractionGroup,
  ReportData,
  ReportRange,
  TaxonomyData,
} from './app-types';
import {
  PRESETS,
  formatDuration,
  isPresetActive,
  type Settings,
  type TimerMode,
  type TimerPreset,
} from './utils';
import {
  ActionGrid,
  AppSurface,
  FieldBlock,
  ModalCard,
  ModalLayout,
  ScreenHeader,
  ScreenShell,
  SectionCard,
  ToggleRow,
  buttonClasses,
  cx,
  inputClasses,
} from './ui';

const COLORS = ['#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444'];

const MODE_META: Record<
  TimerMode,
  {
    label: string;
    activeTab: string;
    ctaButton: string;
    compactBadge: string;
  }
> = {
  pomodoro: {
    label: 'Focus',
    activeTab: 'border-violet-400/50 bg-violet-500/20 text-violet-100',
    ctaButton: 'bg-violet-500 text-white hover:bg-violet-400',
    compactBadge: 'text-violet-300',
  },
  shortBreak: {
    label: 'Short',
    activeTab: 'border-emerald-400/50 bg-emerald-500/20 text-emerald-100',
    ctaButton: 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400',
    compactBadge: 'text-emerald-300',
  },
  longBreak: {
    label: 'Long',
    activeTab: 'border-sky-400/50 bg-sky-500/20 text-sky-100',
    ctaButton: 'bg-sky-500 text-zinc-950 hover:bg-sky-400',
    compactBadge: 'text-sky-300',
  },
};

const RANGE_OPTIONS: { key: ReportRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'all', label: 'All' },
];

const SETTINGS_TOGGLES: Array<{
  label: string;
  description: string;
  key: keyof Pick<
    Settings,
    'cloudSyncEnabled' | 'alwaysOnTop' | 'soundEnabled' | 'suppressDuringMedia'
  >;
}> = [
  {
    label: 'Cloud Sync',
    description: 'Back up sessions and distractions to Firestore when you choose to sign in.',
    key: 'cloudSyncEnabled',
  },
  {
    label: 'Always on Top',
    description: 'Keep Sentinel visible above other windows while you focus.',
    key: 'alwaysOnTop',
  },
  {
    label: 'Sound',
    description: 'Play a soft completion sound when a session ends.',
    key: 'soundEnabled',
  },
  {
    label: 'Media Suppress',
    description: 'Avoid false alarms while audio or video is actively playing.',
    key: 'suppressDuringMedia',
  },
];

const SHORTCUTS = [
  'Ctrl+Shift+S - Start/Pause',
  'Ctrl+Shift+D - Log Distraction',
  'Space - Toggle Timer',
  'Esc - Go Back',
];

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
      <ModalCard className="w-full max-w-[var(--modal-max)] text-center">
        <div className="space-y-5">
          <div className="flex justify-center gap-2">
            {steps.map((_, index) => (
              <div
                key={index}
                className={cx(
                  'h-2 w-2 rounded-full transition-colors',
                  index === stepIndex ? 'bg-violet-400' : 'bg-zinc-700',
                )}
              />
            ))}
          </div>
          <div className="space-y-3">
            <p className="text-xl font-semibold text-white">{step.title}</p>
            <p className="text-sm leading-relaxed text-zinc-400">{step.body}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {!isFirst && (
              <button
                type="button"
                onClick={onBack}
                className={buttonClasses.secondary}
                aria-label="Previous step"
              >
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
              {isLast ? "Let's Go" : 'Next'}
            </button>
          </div>
          {isFirst && (
            <button type="button" onClick={onSkip} className={buttonClasses.ghost}>
              Skip intro
            </button>
          )}
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
      <ModalCard className="w-full max-w-[var(--modal-max)]">
        <div className="space-y-5">
          <div className="space-y-2 text-center">
            <p className="text-xl font-semibold text-white">Welcome back!</p>
            <p className="text-sm leading-relaxed text-zinc-400">
              Your session was paused during sleep. Press Enter to resume or Esc to start fresh.
            </p>
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
  const effectiveCategoryLabel =
    categorySelection === '__auto__'
      ? inferredCategoryName ?? 'Uncategorized'
      : categorySelection === '__none__'
        ? 'Uncategorized'
        : categorySelection === '__new__'
          ? newCategoryName.trim() || 'New category'
          : categorySelection;

  return (
    <ModalLayout role="dialog" aria-label="Distraction intervention">
      <ModalCard className="w-full max-w-[var(--modal-max)]">
        <div className="space-y-5">
          <div className="space-y-2 text-center">
            <p className="text-xl font-semibold text-white">Hey, still focused?</p>
            <p className="text-sm leading-relaxed text-zinc-400">Timer paused - press Esc to dismiss</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-3">
            <input
              type="text"
              value={distractionInput}
              onChange={(event) => onDistractionChange(event.target.value)}
              placeholder="What distracted you?"
              autoFocus
              aria-label="Distraction note"
              className={inputClasses.base}
            />
            <button
              type="submit"
              disabled={!distractionInput.trim() || (categorySelection === '__new__' && !newCategoryName.trim())}
              className={buttonClasses.primary}
            >
              Log Distraction
            </button>
          </form>

          {quickSuggestions.length > 0 && (
            <FieldBlock
              label="Quick reuse"
              description="Tap a recent or frequent distraction to log it instantly."
            >
              <div className="flex flex-wrap gap-2" role="group" aria-label="Quick distraction suggestions">
                {quickSuggestions.map((suggestion) => (
                  <button
                    key={`${suggestion.source}-${suggestion.note}`}
                    type="button"
                    onClick={() => onQuickLog(suggestion.note, suggestion.categoryName)}
                    className="sentinel-panel flex items-center gap-2 rounded-full px-3 py-2 text-sm text-zinc-200 transition-colors hover:border-violet-400/40 hover:bg-violet-500/12"
                  >
                    <span>{suggestion.note}</span>
                    <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                      {suggestion.source}
                    </span>
                  </button>
                ))}
              </div>
            </FieldBlock>
          )}

          {distractionInput.trim() && (
            <FieldBlock
              label="Category (optional)"
              description="Group repeat distractions for cleaner reports without losing the raw label."
            >
              <div className="space-y-3">
                <select
                  value={categorySelection}
                  onChange={(event) => onCategorySelectionChange(event.target.value)}
                  className={inputClasses.base}
                  aria-label="Distraction category"
                >
                  <option value="__auto__">
                    {inferredCategoryName
                      ? `Suggested: ${inferredCategoryName}`
                      : 'No category (default)'}
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

                {categorySelection === '__new__' ? (
                  <input
                    type="text"
                    value={newCategoryName}
                    onChange={(event) => onNewCategoryChange(event.target.value)}
                    placeholder="New category name"
                    className={inputClasses.base}
                    aria-label="New category name"
                  />
                ) : (
                  <p className="text-sm text-zinc-500">Current category: {effectiveCategoryLabel}</p>
                )}
              </div>
            </FieldBlock>
          )}

          <button type="button" onClick={onFalseAlarm} className={buttonClasses.secondary}>
            False Alarm - I'm focused
          </button>

          <FieldBlock
            label="Snooze idle detection"
            description="Pause interventions for a short stretch while you stay on task."
          >
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Snooze duration">
              {[5, 10, 30].map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => onSnooze(minutes)}
                  aria-label={`Snooze for ${minutes} minutes`}
                  className={buttonClasses.secondary}
                >
                  {minutes}m
                </button>
              ))}
            </div>
          </FieldBlock>

          <FieldBlock
            label="Watching content"
            description="Suppress idle detection during tutorials, talks, or other passive learning."
          >
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Watch duration">
              {[30, 60, 90].map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => onWatchingContent(minutes)}
                  aria-label={`Watch content for ${minutes} minutes`}
                  className={buttonClasses.secondary}
                >
                  {minutes}m
                </button>
              ))}
            </div>
          </FieldBlock>
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
}

export function ReportsScreen({
  reportRange,
  reportLoading,
  reportData,
  onBack,
  onSelectRange,
  onOpenTaxonomy,
}: ReportsScreenProps) {
  return (
    <AppSurface role="main" aria-label="Reports">
      <ScreenShell wide>
        <ScreenHeader
          title="Reports"
          subtitle="A calmer overview of your focus patterns, distractions, and momentum."
          onBack={onBack}
          backLabel="Back"
          backAriaLabel="Back to timer"
        />

        <SectionCard title="Range" description="Choose the time window to summarize.">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {RANGE_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => onSelectRange(key)}
                className={cx(
                  buttonClasses.secondary,
                  reportRange === key && 'border-violet-400/50 bg-violet-500/20 text-violet-100',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </SectionCard>

        {reportLoading ? (
          <SectionCard bodyClassName="min-h-40 items-center justify-center">
            <span className="text-sm text-zinc-500 animate-pulse">Loading...</span>
          </SectionCard>
        ) : reportData ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryStat label="Focus Time" value={formatDuration(reportData.totalFocusSeconds)} />
              <SummaryStat label="Sessions" value={String(reportData.sessionsCompleted)} />
              <SummaryStat
                label="Distractions"
                value={String(reportData.distractionsLogged)}
                valueClassName="text-amber-300"
              />
              <SummaryStat
                label="Avg Session"
                value={formatDuration(Math.round(reportData.avgSessionSeconds))}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.95fr)]">
              <div className="space-y-4">
                {reportData.dailyFocus.length > 0 && (
                  <SectionCard
                    title="Daily Focus"
                    description="Minutes of focused work completed each day in the selected range."
                  >
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={reportData.dailyFocus.map((entry) => ({
                            ...entry,
                            focusMin: Math.round(entry.focusSeconds / 60),
                          }))}
                        >
                          <XAxis
                            dataKey="date"
                            tick={{ fontSize: 11, fill: '#a1a1aa' }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis hide />
                          <Tooltip
                            cursor={{ fill: 'rgba(139, 92, 246, 0.08)' }}
                            contentStyle={{
                              background: '#1f1f24',
                              border: '1px solid rgba(167, 139, 250, 0.24)',
                              borderRadius: 14,
                              fontSize: 12,
                            }}
                            labelStyle={{ color: '#a1a1aa' }}
                            itemStyle={{ color: '#c4b5fd' }}
                            formatter={(value) => [`${value}m`, 'Focus']}
                          />
                          <Bar dataKey="focusMin" fill="#8b5cf6" radius={[8, 8, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </SectionCard>
                )}

                {reportData.recentSessions.length > 0 && (
                  <SectionCard
                    title="Recent Sessions"
                    description="Your most recent completed and in-progress sessions."
                  >
                    <div className="space-y-2">
                      {reportData.recentSessions.slice(0, 5).map((session, index) => (
                        <div
                          key={`${session.startedAt}-${index}`}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-white/6 bg-black/10 px-4 py-3 text-sm"
                        >
                          <span className="truncate text-zinc-400">
                            {new Date(session.startedAt).toLocaleDateString()}
                          </span>
                          <span className="text-zinc-200">
                            {formatDuration(session.durationSeconds)}
                          </span>
                          <span
                            className={session.completed ? 'text-emerald-300' : 'text-zinc-500'}
                          >
                            {session.completed ? 'Done' : 'Inc.'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </SectionCard>
                )}
              </div>

              <div className="space-y-4">
                {reportData.topCategories.length > 0 && (
                  <SectionCard
                    title="Top Categories"
                    description="Grouped interruptions so repeat habits are easier to understand at a glance."
                  >
                    <div className="flex flex-col gap-4 sm:flex-row lg:flex-col xl:flex-row">
                      <div className="mx-auto h-36 w-36 shrink-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={reportData.topCategories.map((item) => ({
                                name: item.name,
                                value: item.count,
                              }))}
                              cx="50%"
                              cy="50%"
                              innerRadius={28}
                              outerRadius={54}
                              dataKey="value"
                            >
                              {reportData.topCategories.map((_, index) => (
                                <Cell key={index} fill={COLORS[index % COLORS.length]} />
                              ))}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex-1 space-y-2 overflow-hidden">
                        {reportData.topCategories.slice(0, 4).map((item, index) => (
                          <div key={item.name} className="flex items-center gap-3">
                            <div
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ background: COLORS[index % COLORS.length] }}
                            />
                            <span className="truncate text-sm text-zinc-300">{item.name}</span>
                            <span className="ml-auto text-sm text-zinc-500">{item.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </SectionCard>
                )}

                {reportData.topDistractions.length > 0 && (
                  <SectionCard
                    title="Raw Labels"
                    description="The original distraction labels you've logged, including any category mapping."
                  >
                    <div className="space-y-2">
                      {reportData.topDistractions.slice(0, 6).map((item) => (
                        <div
                          key={item.name}
                          className="flex items-center gap-3 rounded-2xl border border-white/6 bg-black/10 px-4 py-3 text-sm"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-zinc-200">{item.name}</p>
                            <p className="truncate text-xs text-zinc-500">
                              {item.categoryName ?? 'Uncategorized'}
                            </p>
                          </div>
                          <span className="text-zinc-500">{item.count}</span>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={onOpenTaxonomy}
                      className={cx(buttonClasses.secondary, 'mt-4')}
                    >
                      Manage Categories
                    </button>
                  </SectionCard>
                )}

                {(reportData.distractionsLogged + reportData.falseAlarms) > 0 && (
                  <SectionCard
                    title="Intervention Accuracy"
                    description="How often a pause was a false alarm instead of a real distraction."
                  >
                    <div className="space-y-2">
                      <p className="text-3xl font-semibold text-white">
                        {Math.round(
                          (reportData.falseAlarms /
                            (reportData.distractionsLogged + reportData.falseAlarms)) *
                            100,
                        )}
                        %
                      </p>
                      <p className="text-sm leading-relaxed text-zinc-400">
                        {reportData.falseAlarms} false alarms out of{' '}
                        {reportData.distractionsLogged + reportData.falseAlarms} interventions.
                      </p>
                    </div>
                  </SectionCard>
                )}
              </div>
            </div>
          </>
        ) : (
          <SectionCard bodyClassName="min-h-40 items-center justify-center">
            <span className="text-sm text-zinc-500">No data available</span>
          </SectionCard>
        )}
      </ScreenShell>
    </AppSurface>
  );
}

interface TaxonomyManagerScreenProps {
  taxonomyData: TaxonomyData;
  onBack: () => void;
  onSaveGroup: (normalizedNote: string, note: string, categoryName: string | null) => void;
  onRenameCategory: (oldName: string, newName: string) => void;
}

export function TaxonomyManagerScreen({
  taxonomyData,
  onBack,
  onSaveGroup,
  onRenameCategory,
}: TaxonomyManagerScreenProps) {
  const [search, setSearch] = useState('');
  const [onlyUncategorized, setOnlyUncategorized] = useState(false);

  const filteredGroups = taxonomyData.groups.filter((group) => {
    const matchesSearch =
      !search.trim() ||
      group.note.toLowerCase().includes(search.trim().toLowerCase()) ||
      (group.categoryName ?? '').toLowerCase().includes(search.trim().toLowerCase());

    const matchesCategory = !onlyUncategorized || !group.categoryName;
    return matchesSearch && matchesCategory;
  });

  return (
    <AppSurface role="main" aria-label="Distraction taxonomy">
      <ScreenShell wide>
        <ScreenHeader
          title="Distraction Taxonomy"
          subtitle="Edit repeated distraction labels, clean up categories, and make reports easier to trust."
          onBack={onBack}
          backLabel="Back"
          backAriaLabel="Back to timer"
        />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.95fr)]">
          <SectionCard
            title="Manage Labels"
            description="These grouped labels drive quick suggestions and category-aware reports."
          >
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search distraction labels or categories"
                className={inputClasses.base}
                aria-label="Search distraction taxonomy"
              />
              <button
                type="button"
                onClick={() => setOnlyUncategorized((value) => !value)}
                className={cx(
                  buttonClasses.secondary,
                  onlyUncategorized && 'border-amber-400/50 bg-amber-500/20 text-amber-100',
                )}
              >
                {onlyUncategorized ? 'Showing uncategorized' : 'Only uncategorized'}
              </button>
            </div>

            {filteredGroups.length > 0 ? (
              <div className="space-y-3">
                {filteredGroups.map((group) => (
                  <TaxonomyGroupEditor
                    key={`${group.normalizedNote}-${group.note}-${group.categoryName ?? 'none'}-${group.count}`}
                    group={group}
                    categories={taxonomyData.categories}
                    onSave={onSaveGroup}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-[calc(var(--card-radius)-6px)] border border-dashed border-white/10 bg-black/10 px-4 py-6 text-sm text-zinc-500">
                No distraction labels match the current filters yet.
              </div>
            )}
          </SectionCard>

          <div className="space-y-4">
            <SectionCard
              title="Categories"
              description="Rename categories globally when you want to clean up your reporting language."
            >
              {taxonomyData.categories.length > 0 ? (
                <div className="space-y-3">
                  {taxonomyData.categories.map((category) => (
                    <CategoryRenameRow
                      key={category}
                      category={category}
                      onRename={onRenameCategory}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-[calc(var(--card-radius)-6px)] border border-dashed border-white/10 bg-black/10 px-4 py-6 text-sm text-zinc-500">
                  Categories appear here after you start mapping distractions.
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Recent Logs"
              description="The latest saved distractions and the categories currently attached to them."
            >
              {taxonomyData.recentEntries.length > 0 ? (
                <div className="space-y-2">
                  {taxonomyData.recentEntries.slice(0, 8).map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-2xl border border-white/6 bg-black/10 px-4 py-3 text-sm"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-zinc-200">{entry.note}</span>
                        <span className="text-zinc-500">
                          {new Date(entry.timestamp).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-zinc-500">
                        {entry.categoryName ?? 'Uncategorized'}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-[calc(var(--card-radius)-6px)] border border-dashed border-white/10 bg-black/10 px-4 py-6 text-sm text-zinc-500">
                  Logged distractions will appear here once a session has been interrupted.
                </div>
              )}
            </SectionCard>
          </div>
        </div>
      </ScreenShell>
    </AppSurface>
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
}: AuthScreenProps) {
  return (
    <AppSurface role="main" aria-label="Account">
      <ScreenShell className="min-h-full justify-center">
        <ScreenHeader
          title="Account"
          subtitle="Sign in only if you want optional cloud backup and cross-device history."
          onBack={onBack}
          backLabel="Back"
          backAriaLabel="Back to timer"
        />

        <SectionCard
          title="Sentinel Account"
          description={
            userEmail
              ? 'You are signed in and can sync when Cloud Sync is enabled.'
              : 'Everything works locally without an account. Sign in only if you want cloud sync.'
          }
        >
          {userEmail ? (
            <div className="space-y-4">
              <p className="rounded-2xl border border-white/6 bg-black/10 px-4 py-3 text-sm text-zinc-300">
                {userEmail}
              </p>
              <button type="button" onClick={onLogout} className={buttonClasses.danger}>
                Logout
              </button>
            </div>
          ) : (
            <form onSubmit={onLogin} className="space-y-4">
              <FieldBlock label="Email" description="Use your Firebase email/password account.">
                <input
                  type="email"
                  value={authEmail}
                  onChange={(event) => onAuthEmailChange(event.target.value)}
                  placeholder="Email"
                  className={inputClasses.base}
                />
              </FieldBlock>

              <FieldBlock label="Password" description="Your password never replaces local-only mode.">
                <input
                  type="password"
                  value={authPassword}
                  onChange={(event) => onAuthPasswordChange(event.target.value)}
                  placeholder="Password"
                  className={inputClasses.base}
                />
              </FieldBlock>

              {authError && <p className="text-sm text-red-300">{authError}</p>}

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
      </ScreenShell>
    </AppSurface>
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
}: SettingsScreenProps) {
  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    onSaveSettings({ ...settings, [key]: value });
  };

  return (
    <AppSurface role="main" aria-label="Settings">
      <ScreenShell wide>
        <ScreenHeader
          title="Settings"
          subtitle="Tune session timing, interventions, exports, and account options without losing the current look and feel."
          onBack={onBack}
          backLabel="Back"
          backAriaLabel="Back to timer"
        />

        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard
            title="Timer & Presets"
            description="Set the core rhythm for focus, short breaks, and longer resets."
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
              description="Quick starting points for classic pomodoros, deep work blocks, or short sprints."
            >
              <div className="grid gap-3 min-[520px]:grid-cols-3">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => onApplyPreset(preset)}
                    className={cx(
                      'sentinel-panel min-h-[var(--control-height)] px-4 py-4 text-left transition-colors',
                      isPresetActive(settings, preset)
                        ? 'border-violet-400/50 bg-violet-500/20 text-violet-100'
                        : 'border-white/6 text-zinc-200 hover:border-zinc-500/40 hover:bg-white/6',
                    )}
                  >
                    <span className="block text-sm font-semibold">{preset.name}</span>
                    <span className="mt-1 block text-xs text-zinc-400">
                      {preset.focus}/{preset.shortBreak}/{preset.longBreak}
                    </span>
                  </button>
                ))}
              </div>
            </FieldBlock>
          </SectionCard>

          <SectionCard
            title="Idle & Behavior"
            description="Control when Sentinel steps in and how the desktop wrapper behaves."
          >
            <FieldBlock
              label="Idle Detection"
              description="How long Sentinel waits without input before showing the intervention modal."
            >
              <input
                type="number"
                value={settings.idleThresholdSeconds}
                onChange={(event) => updateSetting('idleThresholdSeconds', Number(event.target.value))}
                min={10}
                max={300}
                className={inputClasses.base}
              />
            </FieldBlock>

            <div className="space-y-3">
              {SETTINGS_TOGGLES.map((toggle) => (
                <ToggleRow
                  key={toggle.key}
                  label={toggle.label}
                  description={toggle.description}
                  checked={settings[toggle.key]}
                  onToggle={() => updateSetting(toggle.key, !settings[toggle.key])}
                />
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="Goals & Export"
            description="Track your target and keep portable copies of your data."
          >
            <FieldBlock
              label="Daily Focus Goal"
              description="Set a daily target in minutes for the progress bar on the timer screen."
            >
              <input
                type="number"
                value={settings.dailyFocusGoalMinutes}
                onChange={(event) => updateSetting('dailyFocusGoalMinutes', Number(event.target.value))}
                min={0}
                max={600}
                className={inputClasses.base}
              />
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
              {exportStatus && <p className="text-sm text-zinc-400">{exportStatus}</p>}
            </FieldBlock>
          </SectionCard>

          <SectionCard
            title="Account & Shortcuts"
            description="Manage optional sign-in and keep the most useful keyboard actions close."
          >
            {updateInfo && (
              <div className="rounded-[calc(var(--card-radius)-6px)] border border-violet-400/30 bg-violet-500/12 px-4 py-4">
                <p className="text-sm font-medium text-violet-100">
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
              <div className="rounded-[calc(var(--card-radius)-6px)] border border-white/6 bg-black/10 px-4 py-4">
                <div className="space-y-2 text-sm text-zinc-300">
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
      </ScreenShell>
    </AppSurface>
  );
}

interface SessionCompleteScreenProps {
  sessionName: string;
  chartData: { name: string; value: number }[];
  onTakeBreak: () => void;
  onAgain: () => void;
}

export function SessionCompleteScreen({
  sessionName,
  chartData,
  onTakeBreak,
  onAgain,
}: SessionCompleteScreenProps) {
  return (
    <AppSurface>
      <ScreenShell className="min-h-full justify-center">
        <SectionCard className="text-center" bodyClassName="items-center">
          <div className="space-y-2">
            <p className="text-2xl font-semibold text-emerald-300">Session Complete!</p>
            {sessionName && <p className="text-sm text-zinc-400">{sessionName}</p>}
          </div>

          {chartData.length > 0 && (
            <div className="h-32 w-32">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={chartData} cx="50%" cy="50%" innerRadius={24} outerRadius={48} dataKey="value">
                    {chartData.map((_, index) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          <ActionGrid className="w-full">
            <button type="button" onClick={onTakeBreak} className={buttonClasses.secondary}>
              Break
            </button>
            <button type="button" onClick={onAgain} className={buttonClasses.primary}>
              Again
            </button>
          </ActionGrid>
        </SectionCard>
      </ScreenShell>
    </AppSurface>
  );
}

interface CompactTimerScreenProps {
  timerMode: TimerMode;
  timeLabel: string;
  isRunning: boolean;
  onStartPause: () => void;
  onExpand: () => void;
}

export function CompactTimerScreen({
  timerMode,
  timeLabel,
  isRunning,
  onStartPause,
  onExpand,
}: CompactTimerScreenProps) {
  return (
    <AppSurface role="main" aria-label="Corner overlay timer" className="flex select-none items-center px-4">
      <div className="sentinel-panel flex w-full items-center justify-between gap-3 px-4 py-3">
        <span
          className={cx(
            'text-xs font-semibold uppercase tracking-[0.16em]',
            MODE_META[timerMode].compactBadge,
          )}
        >
          {MODE_META[timerMode].label}
        </span>
        <button
          type="button"
          onClick={onStartPause}
          className="text-2xl font-light tracking-[0.18em] text-white transition-colors hover:text-violet-200"
          role="timer"
          aria-live="polite"
        >
          {timeLabel}
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onStartPause}
            className={cx(buttonClasses.compact, isRunning ? 'text-zinc-200' : 'text-white')}
          >
            {isRunning ? 'Pause' : 'Start'}
          </button>
          <button
            type="button"
            onClick={onExpand}
            className={buttonClasses.ghost}
            aria-label="Expand to full window"
            title="Expand"
          >
            Expand
          </button>
        </div>
      </div>
    </AppSurface>
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
  isSnoozed: boolean;
  snoozeText: string;
  showPresets: boolean;
  settings: Settings;
  onModeChange: (mode: TimerMode) => void;
  onStartPause: () => void;
  onReset: () => void;
  onCancelSnooze: () => void;
  onToggleCompact: () => void;
  onTogglePresets: () => void;
  onOpenReports: () => void;
  onOpenSettings: () => void;
  onApplyPreset: (preset: TimerPreset) => void;
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
  isSnoozed,
  snoozeText,
  showPresets,
  settings,
  onModeChange,
  onStartPause,
  onReset,
  onCancelSnooze,
  onToggleCompact,
  onTogglePresets,
  onOpenReports,
  onOpenSettings,
  onApplyPreset,
}: TimerScreenProps) {
  const modeMeta = MODE_META[timerMode];

  return (
    <AppSurface role="main" aria-label="Focus timer">
      <ScreenShell className="min-h-full justify-center">
        <div className="flex flex-1 flex-col justify-center gap-5">
          <SectionCard className="text-center" bodyClassName="items-center gap-5">
            <div className="w-full max-w-sm">
              <input
                type="text"
                value={sessionName}
                onChange={(event) => onSessionNameChange(event.target.value)}
                placeholder="Session name (optional)"
                className={cx(inputClasses.subtle, 'text-center')}
                aria-label="Session name"
              />
            </div>

            <div className="grid w-full max-w-sm grid-cols-3 gap-2" role="tablist" aria-label="Timer mode">
              {(['pomodoro', 'shortBreak', 'longBreak'] as TimerMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onModeChange(mode)}
                  role="tab"
                  aria-selected={timerMode === mode}
                  className={cx(
                    buttonClasses.secondary,
                    'min-h-11 px-3 py-2 text-sm',
                    timerMode === mode && MODE_META[mode].activeTab,
                  )}
                >
                  {MODE_META[mode].label}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                {modeMeta.label} Session
              </p>
              <button
                type="button"
                className="text-6xl font-light tracking-[0.18em] text-white transition-colors hover:text-violet-100 sm:text-7xl"
                onClick={onStartPause}
                role="timer"
                aria-live="polite"
                aria-label={`${timeLabel} remaining`}
              >
                {timeLabel}
              </button>
            </div>

            {isPausedByIntervention && !showIntervention && (
              <p className="text-sm text-amber-300 animate-pulse">Paused - distraction detected</p>
            )}

            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={onStartPause}
                aria-label={isRunning ? 'Pause timer' : 'Start timer'}
                className={cx('sentinel-button', 'sentinel-button--inline', modeMeta.ctaButton)}
              >
                {isRunning ? 'Pause' : 'Start'}
              </button>
              {(isRunning || isPausedByIntervention) && (
                <button
                  type="button"
                  onClick={onReset}
                  className={cx(buttonClasses.secondary, 'sentinel-button--inline')}
                  aria-label="Reset timer"
                >
                  Reset
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-zinc-500">
              {sessionsCompleted > 0 && <span>#{sessionsCompleted}</span>}
              {distractionCount > 0 && (
                <span className="text-amber-300">{distractionCount} distractions</span>
              )}
              {isSynced && <span className="text-emerald-300">synced</span>}
            </div>

            {dailyGoalMinutes > 0 && (
              <div className="w-full max-w-sm space-y-2">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.14em] text-zinc-500">
                  <span>Daily goal</span>
                  <span>{goalProgress}%</span>
                </div>
                <div
                  className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-900/80"
                  role="progressbar"
                  aria-valuenow={goalProgress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Daily focus goal progress"
                >
                  <div
                    className="h-full rounded-full bg-violet-500/80 transition-all"
                    style={{ width: `${goalProgress}%` }}
                  />
                </div>
              </div>
            )}

            {isSnoozed && (
              <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
                <span className="text-amber-300">Snoozed {snoozeText}</span>
                <button type="button" onClick={onCancelSnooze} className={buttonClasses.ghost}>
                  Cancel
                </button>
              </div>
            )}
          </SectionCard>

          <div className="relative">
            <div className="sentinel-panel sentinel-card">
              <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="Navigation">
                <button
                  type="button"
                  onClick={onToggleCompact}
                  className={buttonClasses.ghost}
                  aria-label="Switch to corner overlay mode"
                  title="Overlay mode"
                >
                  Overlay
                </button>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={onTogglePresets}
                    className={cx(buttonClasses.secondary, 'sentinel-button--inline')}
                  >
                    Presets
                  </button>
                  <button
                    type="button"
                    onClick={onOpenReports}
                    className={cx(buttonClasses.secondary, 'sentinel-button--inline')}
                  >
                    Reports
                  </button>
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className={cx(buttonClasses.secondary, 'sentinel-button--inline')}
                  >
                    Settings
                  </button>
                </div>
              </nav>
            </div>

            {showPresets && (
              <div className="absolute bottom-[calc(100%+0.75rem)] right-0 w-full max-w-xs rounded-[calc(var(--card-radius)-2px)] border border-white/8 bg-[#1f1f25]/96 p-3 shadow-2xl backdrop-blur-xl">
                <div className="space-y-2">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => onApplyPreset(preset)}
                      className={cx(
                        'w-full rounded-2xl border px-4 py-3 text-left transition-colors',
                        isPresetActive(settings, preset)
                          ? 'border-violet-400/50 bg-violet-500/20 text-violet-100'
                          : 'border-white/6 text-zinc-300 hover:border-zinc-500/40 hover:bg-white/6',
                      )}
                    >
                      <span className="block text-sm font-semibold">{preset.name}</span>
                      <span className="mt-1 block text-xs text-zinc-500">
                        {preset.focus}/{preset.shortBreak}/{preset.longBreak}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </ScreenShell>
    </AppSurface>
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
    <div className="rounded-[calc(var(--card-radius)-6px)] border border-white/6 bg-black/10 px-4 py-4">
      <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.14em] text-zinc-500">
        <span>{group.count} logs</span>
        <span>Last seen {new Date(group.lastSeenAt).toLocaleDateString()}</span>
      </div>

      <div className="mt-3 grid gap-3">
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
            className={inputClasses.base}
            aria-label={`New category for ${group.note}`}
          />
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-zinc-500">
            Reporting bucket: {resolvedCategoryName ?? 'Uncategorized'}
          </p>
          <button
            type="button"
            onClick={() => onSave(group.normalizedNote, note, resolvedCategoryName)}
            className={buttonClasses.secondary}
            disabled={!note.trim() || (categorySelection === '__new__' && !newCategoryName.trim())}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function CategoryRenameRow({
  category,
  onRename,
}: {
  category: string;
  onRename: (oldName: string, newName: string) => void;
}) {
  const [draft, setDraft] = useState(category);

  return (
    <div className="rounded-[calc(var(--card-radius)-6px)] border border-white/6 bg-black/10 px-4 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className={inputClasses.base}
          aria-label={`Rename category ${category}`}
        />
        <button
          type="button"
          onClick={() => onRename(category, draft)}
          className={buttonClasses.secondary}
          disabled={!draft.trim() || draft.trim() === category}
        >
          Rename
        </button>
      </div>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="sentinel-panel rounded-[calc(var(--card-radius)-2px)] px-4 py-4">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">{label}</p>
      <p className={cx('mt-2 text-2xl font-semibold text-white', valueClassName)}>{value}</p>
    </div>
  );
}

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
    <div className="space-y-2">
      <label className="text-sm font-medium text-zinc-300">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(Number(event.target.value))}
        className={inputClasses.centered}
      />
    </div>
  );
}
