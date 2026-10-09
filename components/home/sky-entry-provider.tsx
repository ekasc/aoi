import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Easing, cancelAnimation, runOnJS, useAnimatedReaction, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { haptics } from '@/features/haptics/haptics';
import { Motion } from '@/constants/theme';
import { SKY_ARRIVAL_MS, SKY_LANDED_AT } from '@/components/setup/sky-handover';

export type SkyEntry = {
  kind: 'created' | 'joined';
  name: string;
  photoUri: string | null;
  inviteCode: string;
  partnerName: string;
};
type EntryState = { kind: 'arriving'; details: SkyEntry; source: ReactElement }
  | { kind: 'welcome' | 'fading'; details: SkyEntry } | null;
type SkyEntryContextValue = {
  entry: EntryState;
  progress: SharedValue<number> | undefined;
  arrival: SharedValue<number> | undefined;
  prepare: (details: SkyEntry, source: ReactElement) => void;
  reveal: () => void;
  enter: () => void;
};

const SkyEntryContext = createContext<SkyEntryContextValue>({
  entry: null, progress: undefined, arrival: undefined, prepare: () => {}, reveal: () => {}, enter: () => {},
});

export function useSkyEntry() {
  return useContext(SkyEntryContext);
}

// Carries the outgoing form and foreground crossfade clocks, never the sky.
export function SkyEntryProvider({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const [entry, setEntry] = useState<EntryState>(null);
  const entering = useRef(false);
  const revealing = useRef(false);
  const revealFrame = useRef<number | null>(null);
  const progress = useSharedValue(1);
  const arrival = useSharedValue(1);
  const prepare = useCallback((details: SkyEntry, source: ReactElement) => {
    cancelAnimation(progress);
    cancelAnimation(arrival);
    if (revealFrame.current !== null) cancelAnimationFrame(revealFrame.current);
    entering.current = false;
    revealing.current = false;
    progress.set(0);
    arrival.set(0);
    setEntry({ kind: 'arriving', details, source });
  }, [arrival, progress]);
  const finishArrival = useCallback(() => {
    setEntry((current) => current?.kind === 'arriving' ? { kind: 'welcome', details: current.details } : current);
  }, []);
  const reveal = useCallback(() => {
    if (entry?.kind !== 'arriving' || revealing.current) return;
    revealing.current = true;
    if (reduceMotion) {
      arrival.set(1);
      finishArrival();
      return;
    }
    // Layout precedes the canvas's first draw. Keep the opaque source through
    // that frame so shader compilation cannot consume the reveal animation.
    revealFrame.current = requestAnimationFrame(() => {
      revealFrame.current = requestAnimationFrame(() => {
        revealFrame.current = null;
        arrival.set(withTiming(1, { duration: Motion.base, easing: Easing.bezier(0.22, 1, 0.36, 1) }, (finished) => {
          if (finished) runOnJS(finishArrival)();
        }));
      });
    });
  }, [arrival, entry, finishArrival, reduceMotion]);
  const finish = useCallback(() => {
    setEntry(null);
    entering.current = false;
  }, []);
  const enter = useCallback(() => {
    if (entry?.kind !== 'welcome' || entering.current) return;
    entering.current = true;
    haptics.tap();
    if (reduceMotion) {
      progress.set(1);
      setEntry(null);
      entering.current = false;
      return;
    }
    setEntry({ kind: 'fading', details: entry.details });
    // One master clock for the whole arrival. Each layer takes its own window
    // of it (see ARRIVAL_WINDOWS), so the staging is one gesture rather than
    // three animations that happen to overlap.
    //
    // The easing is deliberately mild. A strong ease-out (the 0.22/1/0.36/1
    // this used to be) front-loads the value so hard that the clock is spent by
    // 60% of its duration: the arrival measured 260ms against a 420ms request,
    // which is a dissolve with extra steps. A gentle curve spreads the motion
    // across the time it claims, so the duration means what it says.
    progress.set(withTiming(1, { duration: SKY_ARRIVAL_MS, easing: Easing.bezier(0.32, 0.72, 0.4, 1) }, (finished) => {
      if (finished) runOnJS(finish)();
    }));
  }, [entry, finish, progress, reduceMotion]);

  // The landing, not the end. The sky contracts into the header partway
  // through and the ground follows it; the moment it settles is when the space
  // becomes real, so that is where the one haptic belongs. Driven by the
  // animation's own value rather than a parallel timer, so it cannot drift from
  // what is on screen.
  const landed = useRef(false);
  useAnimatedReaction(
    () => (progress.value ?? 0) >= SKY_LANDED_AT,
    (crossed, previous) => {
      // `previous === undefined` is the first observation, not a crossing: the
      // clock starts at 1, so the very first read is already past the
      // threshold. Only a real below-to-above transition is a landing.
      if (crossed && previous === false && !landed.current) {
        landed.current = true;
        runOnJS(haptics.soft)();
      }
      if (!crossed) {
        landed.current = false;
      }
    },
  );

  useEffect(() => () => {
    cancelAnimation(progress);
    cancelAnimation(arrival);
    if (revealFrame.current !== null) cancelAnimationFrame(revealFrame.current);
  }, [arrival, progress]);

  return (
    <SkyEntryContext.Provider value={{ entry, progress, arrival, prepare, reveal, enter }}>
      {children}
    </SkyEntryContext.Provider>
  );
}
