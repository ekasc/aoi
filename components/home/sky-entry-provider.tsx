import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Easing, cancelAnimation, runOnJS, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { haptics } from '@/features/haptics/haptics';
import { Motion } from '@/constants/theme';

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
    progress.set(withTiming(1, { duration: Motion.base, easing: Easing.bezier(0.22, 1, 0.36, 1) }, (finished) => {
      if (finished) runOnJS(finish)();
    }));
  }, [entry, finish, progress, reduceMotion]);

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
