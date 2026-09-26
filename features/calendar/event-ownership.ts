import type { CalendarEvent } from './types';

export type EventOwnershipTone = 'you' | 'partner' | 'together';

export type EventOwnership = {
  tone: EventOwnershipTone;
  /** The tint this plan draws with, in every view. */
  color: string;
  /** Short, human word for whose plan it is. */
  label: string;
};

export type OwnershipPalette = {
  /** The viewer's accent. */
  ownColor: string;
  /** The partner's accent. */
  partnerColor: string;
};

/** Every tone, in the order a legend reads them. */
export const EVENT_OWNERSHIP_ORDER: EventOwnershipTone[] = [
  'you',
  'partner',
  'together',
];

export type OwnershipInkPalette = {
  /** The viewer's accent at an ink lightness, for marks on the page. */
  ownInkColor: string;
  partnerInkColor: string;
};

/**
 * The mark colour for a plan. Marks are small ink where fills would be mud
 * — currently the year view's day dots — and on the palettes whose accent
 * is a bright fill colour that dot lands near 1.5:1 on the page. Marks
 * therefore take the ink variant, while fills keep the brand accent.
 */
export function ownershipInkForTone(
  tone: EventOwnershipTone,
  ink: OwnershipInkPalette,
): string {
  return tone === 'partner' ? ink.partnerInkColor : ink.ownInkColor;
}

/** The tint and the word for one tone, so a legend and a plan agree. */
export function ownershipForTone(
  tone: EventOwnershipTone,
  palette: OwnershipPalette,
): EventOwnership {
  switch (tone) {
    case 'you':
      return { tone, color: palette.ownColor, label: 'You' };
    case 'partner':
      return { tone, color: palette.partnerColor, label: 'Partner' };
    case 'together':
      return { tone, color: palette.ownColor, label: 'Together' };
  }
}

/**
 * Whose plan it is, decided in one place. The month grid and the day timeline
 * both read ownership from here, so a shared plan cannot take the viewer's
 * accent in the grid and the partner's in the day.
 */
export function getEventOwnership(
  event: CalendarEvent,
  palette: OwnershipPalette,
): EventOwnership {
  if (event.together) {
    return ownershipForTone('together', palette);
  }
  return ownershipForTone(event.isOwn ? 'you' : 'partner', palette);
}
