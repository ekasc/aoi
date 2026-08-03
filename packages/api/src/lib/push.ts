import { and, eq, inArray } from 'drizzle-orm';
import type { PushNotificationKind } from '@aoi/shared';
import { db } from '../db/index.js';
import { pushTokens, spaceMembers } from '../db/schema.js';

/**
 * Push delivery backbone.
 *
 * Ground rules honored here:
 * - Push NEVER breaks a request: every failure is swallowed and, at most,
 *   logged in development (tender-error policy).
 * - Privacy: payloads carry a kind + fixed vague copy. Nothing content-shaped
 *   (moment text, location, answers) ever enters a message — the copy builder
 *   below takes no content by design.
 * - Tokens are never logged.
 */

const DEFAULT_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

// Injectable endpoint: tests override it, and a self-hosted relay could
// replace Expo's service via EXPO_PUSH_ENDPOINT without code changes.
let pushEndpoint = process.env.EXPO_PUSH_ENDPOINT?.trim() || DEFAULT_PUSH_ENDPOINT;

export function getPushEndpoint(): string {
  return pushEndpoint;
}

export function setPushEndpoint(nextEndpoint: string): void {
  pushEndpoint = nextEndpoint;
}

// Expo accepts up to 100 messages per request.
const PUSH_BATCH_SIZE = 100;

// A hung Expo endpoint must never stall callers — abort the request instead.
const PUSH_FETCH_TIMEOUT_MS = 10_000;

// Ticket errors that mean the token itself is dead (device uninstalled the
// app, token invalidated). Other errors ("MessageTooBig", rate limits, ...)
// are transient — keep the token.
const DEAD_TOKEN_ERRORS = new Set(['DeviceNotRegistered', 'InvalidPushToken']);

export type PushMessage = {
  title: string;
  body: string;
  /** String-only values — Expo serializes them for APNs/FCM. */
  data?: Record<string, string>;
  /** Aoi notifications are silent by default (ground rules). */
  sound?: boolean;
};

type ExpoPushTicket = {
  id?: string;
  status: 'ok' | 'error';
  details?: { error?: string };
};

type ExpoPushResponse = {
  data?: ExpoPushTicket[] | ExpoPushTicket;
  errors?: { message?: string }[];
};

/**
 * Warm, vague copy per kind — NEVER content. A push must tell the partner
 * that something happened, never what was written.
 */
export function buildPushCopy(kind: PushNotificationKind): { title: string; body: string } {
  switch (kind) {
    case 'squeeze':
      return { title: 'A squeeze for you', body: 'Your partner is thinking of you.' };
    case 'moment_added':
      return { title: 'They kept a moment', body: 'Something new landed in your space.' };
    case 'moment_edited':
      return { title: 'A moment changed', body: 'Your partner touched up something they kept.' };
    case 'moment_deleted':
      return { title: 'A moment moved on', body: 'Your space shifted a little.' };
  }
}

async function postToExpo(
  messages: Record<string, unknown>[]
): Promise<ExpoPushTicket[]> {
  const response = await fetch(pushEndpoint, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate', 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(PUSH_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Push endpoint responded ${response.status}`);
  }

  const parsed = (await response.json()) as ExpoPushResponse;

  if (Array.isArray(parsed.data)) {
    return parsed.data;
  }

  if (parsed.data && typeof parsed.data === 'object') {
    return [parsed.data];
  }

  return [];
}

function toExpoMessage(token: string, message: PushMessage): Record<string, unknown> {
  return {
    to: token,
    title: message.title,
    body: message.body,
    // Silent by default — memories must never become noise.
    sound: message.sound === true ? 'default' : null,
    ...(message.data ? { data: message.data } : {}),
  };
}

/**
 * Send a push to all of a user's registered devices. Batches messages to the
 * Expo endpoint, inspects the returned tickets, and removes tokens that Expo
 * reports as dead. Never throws.
 */
export async function sendPushToUser(
  userId: string,
  message: PushMessage
): Promise<void> {
  try {
    const tokens = await db
      .select({ expoPushToken: pushTokens.expoPushToken })
      .from(pushTokens)
      .where(eq(pushTokens.userId, userId));

    if (tokens.length === 0) {
      return;
    }

    const deadTokens: string[] = [];

    for (let start = 0; start < tokens.length; start += PUSH_BATCH_SIZE) {
      const batch = tokens.slice(start, start + PUSH_BATCH_SIZE);

      try {
        const tickets = await postToExpo(
          batch.map((row) => toExpoMessage(row.expoPushToken, message))
        );

        tickets.forEach((ticket, index) => {
          if (
            ticket.status === 'error' &&
            ticket.details?.error &&
            DEAD_TOKEN_ERRORS.has(ticket.details.error)
          ) {
            const dead = batch[index]?.expoPushToken;
            if (dead) {
              deadTokens.push(dead);
            }
          }
        });
      } catch (batchError) {
        // One bad batch must not stop the rest (nor ever surface anywhere).
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            '[aoi-api] push batch failed:',
            batchError instanceof Error ? batchError.message : String(batchError)
          );
        }
      }
    }

    if (deadTokens.length > 0) {
      // Scoped to the recipient: a token can only be cleaned up for the user
      // it currently belongs to.
      await db
        .delete(pushTokens)
        .where(
          and(
            eq(pushTokens.userId, userId),
            inArray(pushTokens.expoPushToken, deadTokens)
          )
        );
    }
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[aoi-api] push send failed:',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

/**
 * Notify the OTHER active member of a two-person space. The reusable hook
 * every partner-facing feature (squeezes, moments, and future location
 * requests/proposals) delivers through. Never throws.
 *
 * Deliberately takes NO data parameter: payloads carry the kind only. If a
 * future kind ever needs extras, re-add it deliberately — never as an
 * open-ended hole in the privacy contract.
 */
export async function notifyPartnerInSpace(
  spaceId: string,
  fromUserId: string,
  kind: PushNotificationKind
): Promise<void> {
  try {
    const members = await db
      .select({ userId: spaceMembers.userId })
      .from(spaceMembers)
      .where(
        and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.state, 'active'))
      );

    const partner = members.find((member) => member.userId !== fromUserId);

    if (!partner) {
      return;
    }

    const copy = buildPushCopy(kind);

    await sendPushToUser(partner.userId, {
      title: copy.title,
      body: copy.body,
      data: { kind },
    });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[aoi-api] partner notify failed:',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}
