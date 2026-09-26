import { describe, expect, it } from 'vitest';

import { buildRelationshipUpdateInput } from '@/features/space/update-input';

describe('buildRelationshipUpdateInput', () => {
  it('omits an unset relationship date instead of synthesizing today', () => {
    expect(buildRelationshipUpdateInput(' Us ', ' Them ', null)).toEqual({
      name: 'Us',
      partnerName: 'Them',
    });
  });

  it('serializes a selected date as a local calendar date', () => {
    expect(buildRelationshipUpdateInput('Us', 'Them', new Date(2024, 1, 29))).toEqual({
      name: 'Us',
      partnerName: 'Them',
      relationshipStartDate: '2024-02-29',
    });
  });
});
