import type { CreateCalendarEventInput } from '@/features/calendar/types';

export function createCalendarSeed(now = new Date()): CreateCalendarEventInput[] {
  const todayNine = new Date(now);
  todayNine.setHours(9, 0, 0, 0);

  const todayTenThirty = new Date(todayNine);
  todayTenThirty.setHours(10, 30, 0, 0);

  const tomorrowEighteen = new Date(now);
  tomorrowEighteen.setDate(tomorrowEighteen.getDate() + 1);
  tomorrowEighteen.setHours(18, 30, 0, 0);

  const tomorrowTwenty = new Date(tomorrowEighteen);
  tomorrowTwenty.setHours(20, 0, 0, 0);

  const fridayEight = new Date(now);
  fridayEight.setDate(fridayEight.getDate() + ((5 - fridayEight.getDay() + 7) % 7));
  fridayEight.setHours(8, 0, 0, 0);

  const fridayNine = new Date(fridayEight);
  fridayNine.setHours(9, 0, 0, 0);

  return [
    {
      title: 'Morning deep work',
      startsAt: todayNine.toISOString(),
      endsAt: todayTenThirty.toISOString(),
      actor: 'you',
      actorName: 'You',
      label: {
        preset: 'Work',
      },
    },
    {
      title: 'Dinner reservation',
      startsAt: tomorrowEighteen.toISOString(),
      endsAt: tomorrowTwenty.toISOString(),
      actor: 'partner',
      actorName: 'Alex',
      label: {
        preset: 'Date',
      },
    },
    {
      title: 'Gym',
      startsAt: fridayEight.toISOString(),
      endsAt: fridayNine.toISOString(),
      actor: 'partner',
      actorName: 'Alex',
      label: {
        preset: 'Gym',
      },
    },
  ];
}
