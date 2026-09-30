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
  const [copied, setCopied] = useState(false);
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
          setCopied(true);
          if (timer.current) {
            clearTimeout(timer.current);
          }
          timer.current = setTimeout(() => setCopied(false), resetAfterMs);
        },
        () => {},
      );
    },
    [resetAfterMs],
  );

  return { copied, copy };
}
