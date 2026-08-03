import * as Haptics from 'expo-haptics';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import { apiFetch, isStubMode } from '@/features/api-client';
import type { Squeeze, SqueezeContextValue } from '@/features/squeeze/types';

const SqueezeContext = createContext<SqueezeContextValue | undefined>(undefined);

const PARTNER_REPLY_DELAY_MS = 4000;

function createSqueeze(fromRole: Squeeze['fromRole']): Squeeze {
  return {
    id: `squeeze_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    fromRole,
    sentAt: new Date().toISOString(),
  };
}

/**
 * A wordless "thinking of you" signal between partners.
 *
 * Stub mode simulates the full loop: sending a squeeze makes your partner
 * squeeze back a moment later, so the receive path (overlay + haptics) is
 * real and testable. Remote mode posts to the API; true delivery requires
 * push notifications (see PLAN.md).
 */
export function SqueezeProvider({ children }: PropsWithChildren) {
  const [incomingSqueeze, setIncomingSqueeze] = useState<Squeeze | null>(null);
  const [lastSentAt, setLastSentAt] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (replyTimer.current) {
        clearTimeout(replyTimer.current);
      }
    };
  }, []);

  const scheduleSimulatedReply = useCallback(() => {
    if (replyTimer.current) {
      clearTimeout(replyTimer.current);
    }

    replyTimer.current = setTimeout(() => {
      setIncomingSqueeze(createSqueeze('partner'));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }, PARTNER_REPLY_DELAY_MS);
  }, []);

  const sendSqueeze = useCallback(async () => {
    setIsSending(true);

    try {
      if (isStubMode()) {
        // Simulated delivery loop until push notifications exist.
        scheduleSimulatedReply();
      } else {
        await apiFetch('/v1/squeezes', { method: 'POST', body: '{}' });
      }

      const sentAt = new Date().toISOString();
      setLastSentAt(sentAt);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      // A squeeze that fails to send is silently absorbed — never an error
      // surface for something this tender.
    } finally {
      setIsSending(false);
    }
  }, [scheduleSimulatedReply]);

  const dismissIncoming = useCallback(() => {
    setIncomingSqueeze(null);
  }, []);

  const value = useMemo(
    () => ({
      sendSqueeze,
      incomingSqueeze,
      dismissIncoming,
      lastSentAt,
      isSending,
      deliveryAvailable: true,
    }),
    [dismissIncoming, incomingSqueeze, isSending, lastSentAt, sendSqueeze]
  );

  return <SqueezeContext.Provider value={value}>{children}</SqueezeContext.Provider>;
}

export function useSqueeze(): SqueezeContextValue {
  const context = useContext(SqueezeContext);

  if (!context) {
    throw new Error('useSqueeze must be used within SqueezeProvider');
  }

  return context;
}
