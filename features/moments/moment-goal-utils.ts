import type { Moment } from '@/features/moments/types';

const DAY_IN_MS = 1000 * 60 * 60 * 24;

export function isUpcomingGoal(moment: Moment, now = new Date()) {
  if (moment.type !== 'goal') {
    return false;
  }

  if (!moment.targetAt) {
    return true;
  }

  const targetDate = new Date(moment.targetAt);

  if (Number.isNaN(targetDate.getTime())) {
    return true;
  }

  return targetDate.getTime() > now.getTime();
}

export function getGoalHorizon(
  moment: Moment,
  now = new Date()
): 'Soon' | 'This year' | 'Later' | 'Someday' {
  if (moment.type !== 'goal' || !moment.targetAt) {
    return 'Someday';
  }

  const targetDate = new Date(moment.targetAt);

  if (Number.isNaN(targetDate.getTime())) {
    return 'Someday';
  }

  const diffDays = Math.ceil((targetDate.getTime() - now.getTime()) / DAY_IN_MS);

  if (diffDays <= 45) {
    return 'Soon';
  }

  if (diffDays <= 365) {
    return 'This year';
  }

  return 'Later';
}
