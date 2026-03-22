export type ReportRange = 'today' | 'week' | 'month' | 'all';

export interface ReportBreakdownItem {
  name: string;
  count: number;
  categoryName?: string | null;
}

export interface ReportData {
  totalFocusSeconds: number;
  sessionsCompleted: number;
  distractionsLogged: number;
  falseAlarms: number;
  avgSessionSeconds: number;
  dailyFocus: { date: string; focusSeconds: number; sessions: number; distractions: number }[];
  topCategories: ReportBreakdownItem[];
  topDistractions: ReportBreakdownItem[];
  recentSessions: SessionHistoryEntry[];
}

export interface SessionHistoryEntry {
  startedAt: string;
  durationSeconds: number;
  completed: boolean;
  endedEarly: boolean;
  sessionName: string | null;
  completedAt: string | null;
  distractionsCount: number;
  falseAlarmCount: number;
}

export interface DistractionEntry {
  id: number;
  note: string;
  normalizedNote: string;
  categoryName: string | null;
  timestamp: string;
}

export interface DistractionGroup {
  note: string;
  normalizedNote: string;
  categoryName: string | null;
  count: number;
  lastSeenAt: string;
}

export interface TaxonomyData {
  recentEntries: DistractionEntry[];
  groups: DistractionGroup[];
  categories: string[];
}
