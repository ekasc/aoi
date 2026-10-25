import * as SecureStore from 'expo-secure-store';
import { useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';

import { readRecoveryEntropy } from '@/features/album/protocol-local-state';

const KEY_PREFIX = 'aoi.album.recovery-phrase-confirmed.';

function keyFor(spaceId: string) {
  return `${KEY_PREFIX}${spaceId}`;
}

/** Whether this device has confirmed the recovery phrase for this Space. */
export async function readRecoveryPhraseConfirmed(spaceId: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(keyFor(spaceId))) === 'true';
  } catch {
    // A keychain read failure must not turn into a permanent nag. The phrase
    // screen still works; this only controls the reminder.
    return true;
  }
}

export async function markRecoveryPhraseConfirmed(spaceId: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(keyFor(spaceId), 'true');
  } catch {
    // The confirmation remains valid for this session even if the marker
    // cannot be persisted.
  }
}

/**
 * `null` until the stored answer is known. A new archive is `false`, which is
 * what makes the Us screen ask for the phrase before it can be forgotten.
 */
export function useRecoveryPhraseConfirmed(spaceId: string | null | undefined): boolean | null {
  const focused = useIsFocused();
  const [confirmed, setConfirmed] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    if (!spaceId) {
      queueMicrotask(() => {
        if (active) setConfirmed(null);
      });
      return () => {
        active = false;
      };
    }
    if (!focused) return () => {
      active = false;
    };
    void (async () => {
      try {
        // Only the device that holds the archive's recovery entropy can show
        // the phrase. A partner's phone must not be nagged into a screen that
        // would tell them the phrase lives elsewhere.
        const entropy = await readRecoveryEntropy(spaceId);
        if (!active) return;
        if (!entropy) {
          setConfirmed(true);
          return;
        }
        const value = await readRecoveryPhraseConfirmed(spaceId);
        if (active) setConfirmed(value);
      } catch {
        if (active) setConfirmed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [focused, spaceId]);

  return confirmed;
}
