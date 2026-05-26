import { isStubMode } from '@/features/api-client';
import { localSpaceRepository } from '@/features/space/local-space-repository';
import { remoteSpaceRepository } from '@/features/space/remote-space-repository';
import type { SpaceRepository } from '@/features/space/types';

let spaceRepository: SpaceRepository;

export function getSpaceRepository() {
  if (!spaceRepository) {
    spaceRepository = isStubMode() ? localSpaceRepository : remoteSpaceRepository;
  }
  return spaceRepository;
}

export function setSpaceRepository(repository: SpaceRepository) {
  spaceRepository = repository;
}
