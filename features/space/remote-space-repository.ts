import { apiFetch } from '@/features/api-client';
import type {
  RelationshipSpace,
  SpaceRepository,
  CreateSpaceInput,
  JoinSpaceInput,
  UpdateSpaceInput,
  ImportedMilestone,
  ImportedMilestoneInput,
} from '@/features/space/types';

interface SpaceResponse {
  space: RelationshipSpace | null;
  inviteCode?: string | null;
}

interface CreateSpaceResponse {
  space: RelationshipSpace;
  inviteCode: string;
}

export const remoteSpaceRepository: SpaceRepository = {
  async getSpaceForUser(_userId: string): Promise<RelationshipSpace | null> {
    const data = await apiFetch<SpaceResponse>('/v1/spaces/current');
    return data.space;
  },

  async createSpace(input: CreateSpaceInput): Promise<RelationshipSpace> {
    // Partner name and start date are optional end to end: the Worker
    // accepts them absent (nullable columns), so only send what the user
    // actually provided — never fabricate (no placeholder names, no
    // defaulted dates). yourName travels for local display; the server
    // derives authorship from the session, not this field.
    const data = await apiFetch<CreateSpaceResponse>('/v1/spaces', {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        yourName: input.yourName,
        ...(input.partnerName?.trim()
          ? { partnerName: input.partnerName.trim() }
          : {}),
        ...(input.relationshipStartDate
          ? { relationshipStartDate: input.relationshipStartDate }
          : {}),
        photoUri: input.photoUri || undefined,
      }),
    });
    return data.space;
  },

  async joinSpace(input: JoinSpaceInput): Promise<RelationshipSpace> {
    const data = await apiFetch<{ space: RelationshipSpace }>('/v1/spaces/join', {
      method: 'POST',
      body: JSON.stringify({ inviteCode: input.inviteCode }),
    });
    return data.space;
  },

  async regenerateInvite(_userId: string): Promise<string> {
    const data = await apiFetch<{ inviteCode: string }>('/v1/spaces/current/invite', {
      method: 'POST',
    });
    return data.inviteCode;
  },

  async updateSpaceForUser(
    _userId: string,
    input: UpdateSpaceInput
  ): Promise<RelationshipSpace | null> {
    const data = await apiFetch<SpaceResponse>('/v1/spaces/current', {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
    return data.space;
  },

  async clearSpaceForUser(_userId: string): Promise<void> {
    // No dedicated leave endpoint yet — skip for MVP
  },

  async leaveSpace(_userId: string): Promise<void> {
    await apiFetch('/v1/spaces/leave', { method: 'POST' });
  },

  async getImportedMilestonesForUser(_userId: string): Promise<ImportedMilestone[]> {
    return apiFetch<ImportedMilestone[]>('/v1/spaces/current/imported-milestones');
  },

  async appendImportedMilestonesForUser(
    _userId: string,
    milestones: ImportedMilestoneInput[]
  ): Promise<ImportedMilestone[]> {
    // The API supports creating one at a time, so we batch them
    const results: ImportedMilestone[] = [];
    for (const milestone of milestones) {
      const created = await apiFetch<ImportedMilestone>('/v1/spaces/current/imported-milestones', {
        method: 'POST',
        body: JSON.stringify(milestone),
      });
      results.push(created);
    }
    return results;
  },

  async clearImportedMilestonesForUser(_userId: string): Promise<void> {
    // No dedicated delete-all endpoint yet
  },
};
