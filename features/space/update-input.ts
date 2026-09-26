import { toApiDateString } from '@/features/space/space-date';
import type { UpdateSpaceInput } from '@/features/space/types';

/** Build an edit payload without turning an omitted relationship date into today. */
export function buildRelationshipUpdateInput(
  name: string,
  partnerName: string,
  relationshipStartDate: Date | null,
): UpdateSpaceInput {
  return {
    name: name.trim(),
    partnerName: partnerName.trim(),
    ...(relationshipStartDate
      ? { relationshipStartDate: toApiDateString(relationshipStartDate) }
      : {}),
  };
}
