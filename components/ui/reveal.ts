import { FadeIn, FadeInDown, FadeOut, ReduceMotion } from 'react-native-reanimated';

import { Motion } from '@/constants/theme';

/**
 * The app's two reveal curves, as builders ready for `entering` / `exiting`.
 *
 * They exist so a screen never has to choose a duration and an easing on its
 * own. A dozen `entering` props each rolling their own numbers is exactly how
 * one transition came to feel different in two places, and it is why this app
 * could animate things arriving but had nothing to say about them leaving:
 * only one file in the codebase bothered with an `exiting`, so every dismissal
 * hard-cut instead.
 *
 * `leaving` is quicker than `arriving` on purpose. Arriving wants the reader's
 * eye; leaving wants to be got out of the way.
 *
 * Every builder is already system-reduced-motion aware, so a screen cannot
 * forget: there is no way to ask one of these for motion the reader declined.
 */
export const Reveal = {
  /** Something appearing in place. */
  in: (duration: number = Motion.base) =>
    FadeIn.duration(duration).reduceMotion(ReduceMotion.System),

  /** Something appearing having come from slightly below or beside. */
  up: (duration: number = Motion.base) =>
    FadeInDown.duration(duration).reduceMotion(ReduceMotion.System),

  /** Something going away. */
  out: (duration: number = Motion.exit) =>
    FadeOut.duration(duration).reduceMotion(ReduceMotion.System),

  /**
   * Per-item step for a group entering together. Kept small: a stagger is a
   * way of ordering a reveal, not a queue, and anything past about 40ms per
   * item stops reading as one movement.
   */
  stagger: (index: number, step: number = Motion.stagger) => step * index,
} as const;
