import { localSpaceRepository } from '@/features/space/local-space-repository';
import type { SpaceRepository } from '@/features/space/types';

let spaceRepository: SpaceRepository = localSpaceRepository;

export function getSpaceRepository() {
  return spaceRepository;
}

export function setSpaceRepository(repository: SpaceRepository) {
  spaceRepository = repository;
}
