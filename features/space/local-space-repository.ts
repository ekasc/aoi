import AsyncStorage from '@react-native-async-storage/async-storage';

import { createInviteCode, normalizeInviteCode } from '@/features/space/invite-code';
import type {
  ImportedMilestone,
  JoinSpaceInput,
  RelationshipSpace,
  SpaceRepository,
  UpdateSpaceInput,
} from '@/features/space/types';

const SPACE_USER_KEY_PREFIX = 'aoi.space.by-user.v1.';
const SPACE_INVITE_KEY_PREFIX = 'aoi.space.by-invite.v1.';
const SPACE_MILESTONES_KEY_PREFIX = 'aoi.space.milestones.v1.';

function spaceUserKey(userId: string) {
  return `${SPACE_USER_KEY_PREFIX}${userId}`;
}

function spaceInviteKey(inviteCode: string) {
  return `${SPACE_INVITE_KEY_PREFIX}${normalizeInviteCode(inviteCode)}`;
}

function spaceMilestonesKey(userId: string) {
  return `${SPACE_MILESTONES_KEY_PREFIX}${userId}`;
}

async function readJson<T>(key: string): Promise<T | null> {
  const rawValue = await AsyncStorage.getItem(key);

  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as T;
  } catch {
    await AsyncStorage.removeItem(key);
    return null;
  }
}

async function writeJson<T>(key: string, value: T) {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

async function createUniqueInviteCode() {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const inviteCode = createInviteCode();
    const existing = await readJson<RelationshipSpace>(spaceInviteKey(inviteCode));

    if (!existing) {
      return inviteCode;
    }
  }

  throw new Error('Unable to generate invite code. Please try again.');
}

export const localSpaceRepository: SpaceRepository = {
  async getSpaceForUser(userId) {
    return readJson<RelationshipSpace>(spaceUserKey(userId));
  },

  async createSpace(input) {
    const now = new Date().toISOString();
    const inviteCode = await createUniqueInviteCode();
    const nextSpace: RelationshipSpace = {
      id: `space_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      name: input.name.trim(),
      createdByUserId: input.createdByUserId,
      partnerName: input.partnerName.trim(),
      relationshipStartDate: input.relationshipStartDate,
      inviteCode,
      createdAt: now,
      updatedAt: now,
    };

    await Promise.all([
      writeJson(spaceUserKey(input.createdByUserId), nextSpace),
      writeJson(spaceInviteKey(inviteCode), nextSpace),
    ]);

    return nextSpace;
  },

  async joinSpace(input: JoinSpaceInput) {
    const inviteCode = normalizeInviteCode(input.inviteCode);
    const space = await readJson<RelationshipSpace>(spaceInviteKey(inviteCode));

    if (!space) {
      throw new Error('Invite code not found.');
    }

    await writeJson(spaceUserKey(input.userId), space);
    return space;
  },

  async updateSpaceForUser(userId: string, input: UpdateSpaceInput) {
    const currentSpace = await readJson<RelationshipSpace>(spaceUserKey(userId));

    if (!currentSpace) {
      return null;
    }

    const nextSpace: RelationshipSpace = {
      ...currentSpace,
      name: input.name?.trim() || currentSpace.name,
      partnerName: input.partnerName?.trim() || currentSpace.partnerName,
      relationshipStartDate:
        input.relationshipStartDate || currentSpace.relationshipStartDate,
      updatedAt: new Date().toISOString(),
    };

    await Promise.all([
      writeJson(spaceUserKey(userId), nextSpace),
      writeJson(spaceInviteKey(nextSpace.inviteCode), nextSpace),
    ]);

    return nextSpace;
  },

  async clearSpaceForUser(userId: string) {
    await AsyncStorage.multiRemove([spaceUserKey(userId), spaceMilestonesKey(userId)]);
  },

  async getImportedMilestonesForUser(userId: string) {
    const milestones = await readJson<ImportedMilestone[]>(spaceMilestonesKey(userId));
    return milestones ?? [];
  },

  async appendImportedMilestonesForUser(
    userId: string,
    milestones: ImportedMilestone[]
  ) {
    const currentMilestones = await this.getImportedMilestonesForUser(userId);
    const byId = new Map<string, ImportedMilestone>();

    [...currentMilestones, ...milestones].forEach((milestone) => {
      byId.set(milestone.id, milestone);
    });

    const nextMilestones = Array.from(byId.values()).sort(
      (left, right) =>
        new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime()
    );

    await writeJson(spaceMilestonesKey(userId), nextMilestones);
    return nextMilestones;
  },

  async clearImportedMilestonesForUser(userId: string) {
    await AsyncStorage.removeItem(spaceMilestonesKey(userId));
  },
};
