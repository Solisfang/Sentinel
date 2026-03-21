import { describe, expect, it } from 'vitest';
import { buildQuickSuggestions, getMappedCategoryForNote, normalizeDistractionNote } from './taxonomy';

describe('taxonomy helpers', () => {
  it('normalizes distraction labels for matching', () => {
    expect(normalizeDistractionNote('  Twitter  ')).toBe('twitter');
  });

  it('finds an existing mapped category by note', () => {
    expect(
      getMappedCategoryForNote(
        [
          {
            note: 'twitter',
            normalizedNote: 'twitter',
            categoryName: 'Social Media',
            count: 3,
            lastSeenAt: new Date().toISOString(),
          },
        ],
        'Twitter',
      ),
    ).toBe('Social Media');
  });

  it('builds de-duplicated quick suggestions from recent and frequent history', () => {
    const suggestions = buildQuickSuggestions({
      recentEntries: [
        {
          id: 1,
          note: 'twitter',
          normalizedNote: 'twitter',
          categoryName: 'Social Media',
          timestamp: new Date().toISOString(),
        },
        {
          id: 2,
          note: 'slack',
          normalizedNote: 'slack',
          categoryName: 'Messaging',
          timestamp: new Date().toISOString(),
        },
      ],
      groups: [
        {
          note: 'twitter',
          normalizedNote: 'twitter',
          categoryName: 'Social Media',
          count: 10,
          lastSeenAt: new Date().toISOString(),
        },
        {
          note: 'slack',
          normalizedNote: 'slack',
          categoryName: 'Messaging',
          count: 7,
          lastSeenAt: new Date().toISOString(),
        },
        {
          note: 'youtube',
          normalizedNote: 'youtube',
          categoryName: 'Learning',
          count: 6,
          lastSeenAt: new Date().toISOString(),
        },
        {
          note: 'instagram',
          normalizedNote: 'instagram',
          categoryName: 'Social Media',
          count: 4,
          lastSeenAt: new Date().toISOString(),
        },
      ],
      categories: ['Social Media', 'Messaging', 'Learning'],
    });

    expect(suggestions.map((suggestion) => suggestion.note)).toEqual([
      'twitter',
      'slack',
      'youtube',
      'instagram',
    ]);
    expect(suggestions[0]?.source).toBe('Recent');
    expect(suggestions[2]?.source).toBe('Frequent');
  });
});
