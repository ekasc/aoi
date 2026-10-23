import type { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

/**
 * The optional guide a person opens from Account.
 *
 * Four rows, one line each, in the order of the tabs: what this place is for,
 * and what each tab holds. It is a door sign, not a manual — anything longer
 * is read as a lecture and skipped, so the copy stays at one sentence per
 * feature and nothing else is covered here.
 */
export type TourFeature = {
  id: string;
  /** The same glyph the tab bar uses, so the row matches the button. */
  icon: ComponentProps<typeof Ionicons>['name'];
  title: string;
  line: string;
};

export const TOUR_TITLE = 'This is your space';
export const TOUR_LEAD = 'A shared space for you and your partner.';
/** One line under the map: where to begin, and where this guide lives. */
export const TOUR_FOOTER =
  'Start in Memories with one thing you want to keep. Tap your avatar for Account and this guide.';

export const TOUR_FEATURES: readonly TourFeature[] = [
  {
    id: 'memories',
    icon: 'book-outline',
    title: 'Memories',
    line: 'Save photos, notes, videos and voice memories together.',
  },
  {
    id: 'us',
    icon: 'sparkles-outline',
    title: 'Us',
    line: 'Add photos to your shared sky. Dated memories live in Memories.',
  },
  {
    id: 'plans',
    icon: 'calendar-outline',
    title: 'Plans',
    line: 'Add dates and see what you have planned together.',
  },
  {
    id: 'lists',
    icon: 'grid-outline',
    title: 'Lists',
    line: 'Keep ideas, favorites and things to do together.',
  },
];
