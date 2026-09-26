import { describe, expect, it } from 'vitest';

import {
  getRelationshipAge,
  RELATIONSHIP_AGE_THRESHOLD_MONTHS,
  relationshipCopy,
} from '@/features/relationship/relationship-age';

describe('relationship age adaptation', () => {
  it('keeps couples in discovery tone until the first calendar anniversary', () => {
    expect(getRelationshipAge('2025-06-14', new Date(2026, 5, 13))).toEqual({
      tone: 'discovery',
      monthsTogether: RELATIONSHIP_AGE_THRESHOLD_MONTHS - 1,
    });
    expect(getRelationshipAge('2025-06-14', new Date(2026, 5, 14)).tone).toBe('established');
  });

  it('handles leap day starts using the last day of February in non-leap years', () => {
    expect(getRelationshipAge('2024-02-29', new Date(2025, 1, 27)).monthsTogether).toBe(11);
    expect(getRelationshipAge('2024-02-29', new Date(2025, 1, 28)).monthsTogether).toBe(12);
  });

  it('treats missing, malformed, future, and invalid calendar dates as neutral', () => {
    for (const value of [null, undefined, '', '2024-02-31', '2024-02-31T12:00:00Z', 'not-a-date']) {
      expect(getRelationshipAge(value, new Date(2026, 0, 1)).tone).toBe('neutral');
    }
    expect(getRelationshipAge('2027-01-01', new Date(2026, 0, 1))).toEqual({
      tone: 'neutral',
      monthsTogether: null,
    });
  });

  it('keeps established empty archives inclusive and does not invent a favorite', () => {
    const copy = relationshipCopy('established');
    expect(copy.memoryBody).toContain('favorite memory');
    expect(copy.memoryButton).toBe('Keep something from today');
  });
});
