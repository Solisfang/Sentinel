import type { DistractionGroup, TaxonomyData } from './app-types';

export interface QuickSuggestion {
  note: string;
  categoryName: string | null;
  source: 'Recent' | 'Frequent';
}

export function normalizeDistractionNote(note: string): string {
  return note.trim().toLowerCase();
}

export function getMappedCategoryForNote(
  groups: DistractionGroup[],
  note: string,
): string | null {
  const normalized = normalizeDistractionNote(note);
  if (!normalized) return null;

  return groups.find((group) => group.normalizedNote === normalized)?.categoryName ?? null;
}

export function buildQuickSuggestions(taxonomyData: TaxonomyData): QuickSuggestion[] {
  const suggestions: QuickSuggestion[] = [];
  const seen = new Set<string>();

  for (const entry of taxonomyData.recentEntries) {
    if (!entry.normalizedNote || seen.has(entry.normalizedNote)) continue;
    suggestions.push({
      note: entry.note,
      categoryName: entry.categoryName,
      source: 'Recent',
    });
    seen.add(entry.normalizedNote);
    if (suggestions.length >= 2) break;
  }

  const frequentGroups = [...taxonomyData.groups].sort((left, right) => right.count - left.count);
  for (const group of frequentGroups) {
    if (!group.normalizedNote || seen.has(group.normalizedNote)) continue;
    suggestions.push({
      note: group.note,
      categoryName: group.categoryName,
      source: 'Frequent',
    });
    seen.add(group.normalizedNote);
    if (suggestions.length >= 5) return suggestions;
  }

  const recentGroups = [...taxonomyData.groups].sort(
    (left, right) => new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime(),
  );
  for (const group of recentGroups) {
    if (!group.normalizedNote || seen.has(group.normalizedNote)) continue;
    suggestions.push({
      note: group.note,
      categoryName: group.categoryName,
      source: 'Frequent',
    });
    seen.add(group.normalizedNote);
    if (suggestions.length >= 5) break;
  }

  return suggestions;
}
