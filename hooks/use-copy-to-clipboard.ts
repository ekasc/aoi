import { useCallback, useEffect, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';

/** How long a confirmation stays up. Long enough to read, short enough to ignore. */
export const COPIED_FEEDBACK_MS = 2200;

/**
 * Write to the clipboard, and say so for a moment.
 *
 * One flag, one timer, in one place. Two screens now put a code on the
 * clipboard (the setup beat, and the empty sky while you wait for your
 * partner) and a second hand-rolled copy of this is how the two drift apart.
 *
 * A refused clipboard is not an error worth surfacing: the code is still on
 * screen, and the reader can select it.
 */
export function useCopyToClipboard(resetAfterMs: number = COPIED_FEEDBACK_MS) {
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  const copy = useCallback(
    (value: string) => {
      if (!value) {
        return;
      }
      void Clipboard.setStringAsync(value).then(
        () => {
          // The value, not a boolean: one screen may hold several copyable
          // things and a single flag would report the wrong one as copied. A
          // caller asking about a value it did not copy gets `false`.
          setCopiedValue(value);
          if (timer.current) {
            clearTimeout(timer.current);
          }
          timer.current = setTimeout(() => setCopiedValue(null), resetAfterMs);
        },
        () => {},
      );
    },
    [resetAfterMs],
  );

  return {
    /** True only for the value most recently written. */
    copied: (value: string) => copiedValue === value,
    copy,
  };
}
