import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import type { QueueBatchLike } from '../../env';
import {
  DlqSender,
  MAX_JOB_ATTEMPTS,
  QueueHandlers,
  consumeQueueBatch,
  type QueueHandler,
} from '../../programs/queue';
import { Logger } from '../../effects/logger';
import { makeCaptureLogger } from '../../effects/logger';
import { makeFakeDlq } from '../../effects/test-harness';

function message(body: unknown, opts?: { attempts?: number; id?: string }) {
  let acked = false;
  let retried = false;
  return {
    id: opts?.id ?? 'msg-1',
    timestamp: new Date(),
    body,
    attempts: opts?.attempts ?? 1,
    ack() {
      acked = true;
    },
    retry() {
      retried = true;
    },
    get acked() {
      return acked;
    },
    get retried() {
      return retried;
    },
  };
}

type MessageLike = ReturnType<typeof message>;

function batchOf(msgs: MessageLike[]): QueueBatchLike {
  return { messages: msgs, queue: 'aoi-queue', retryAll() {}, ackAll() {} };
}

function runBatch(
  msgs: MessageLike[],
  handlers: Partial<Record<string, QueueHandler>>
): Promise<{ acked: number; retried: number; dlq: unknown[]; loggerEntries: unknown[] }> {
  const fake = makeFakeDlq();
  const logger = makeCaptureLogger();
  const layer = Layer.mergeAll(
    Layer.succeed(QueueHandlers, { handlers }),
    Layer.succeed(DlqSender, {
      send: (body) =>
        Effect.tryPromise({
          try: () => fake.dlq.send(body),
          catch: () => new Error('dlq failed'),
        }).pipe(Effect.catchAll(() => Effect.void)),
    }),
    logger.layer
  );
  return Effect.runPromise(Effect.provide(consumeQueueBatch(batchOf(msgs)), layer)).then(() => ({
    acked: msgs.filter((m) => (m as { acked: boolean }).acked).length,
    retried: msgs.filter((m) => (m as { retried: boolean }).retried).length,
    dlq: fake.capturedDlq,
    loggerEntries: logger.entries,
  }));
}

describe('queue consumer', () => {
  it('acks a well-formed job handled successfully', async () => {
    const handled: unknown[] = [];
    const out = await runBatch(
      [message({ type: 'push.deliver', kind: 'squeeze', spaceId: 's1', fromUserId: 'u1' })],
      {
        'push.deliver': (job) =>
          Effect.sync(() => {
            handled.push(job);
          }),
      }
    );
    expect(out.acked).toBe(1);
    expect(out.retried).toBe(0);
    expect(out.dlq).toEqual([]);
    expect(handled).toHaveLength(1);
  });

  it('sends undecodable messages straight to the DLQ (poison messages)', async () => {
    const out = await runBatch([message({ hello: 'world' })], {});
    expect(out.dlq).toHaveLength(1);
    expect((out.dlq[0] as { _meta: { reason: string } })._meta.reason).toBe('decode');
    expect(out.acked).toBe(1);
  });

  it('sends known-but-unhandled job types to the DLQ', async () => {
    const out = await runBatch([message({ type: 'media.sanitize', mediaId: 'm1' })], {});
    expect(out.dlq).toHaveLength(1);
    expect((out.dlq[0] as { _meta: { reason: string } })._meta.reason).toBe('no-handler');
    expect(out.acked).toBe(1);
  });

  it('retries business failures up to the attempt cap, then DLQs', async () => {
    const failing: QueueHandler = () => Effect.fail(new Error('expo down'));

    const early = await runBatch(
      [message({ type: 'push.deliver', kind: 'squeeze', spaceId: 's1', fromUserId: 'u1' }, { attempts: 2 })],
      { 'push.deliver': failing }
    );
    expect(early.retried).toBe(1);
    expect(early.dlq).toEqual([]);

    const exhausted = await runBatch(
      [message({ type: 'push.deliver', kind: 'squeeze', spaceId: 's1', fromUserId: 'u1' }, { attempts: MAX_JOB_ATTEMPTS })],
      { 'push.deliver': failing }
    );
    expect(exhausted.dlq).toHaveLength(1);
    expect((exhausted.dlq[0] as { _meta: { reason: string } })._meta.reason).toBe('failed');
    expect(exhausted.acked).toBe(1);
    expect(exhausted.retried).toBe(0);
  });

  it('never throws out of the consumer (containment)', async () => {
    const throwing: QueueHandler = () => {
      throw new Error('handler exploded synchronously');
    };
    const out = await runBatch(
      [message({ type: 'push.deliver', kind: 'squeeze', spaceId: 's1', fromUserId: 'u1' }, { attempts: MAX_JOB_ATTEMPTS })],
      { 'push.deliver': throwing }
    );
    expect(out.dlq).toHaveLength(1);
    expect(out.acked).toBe(1);
  });

  it('handles a mixed batch independently per message', async () => {
    const out = await runBatch(
      [
        message({ type: 'push.deliver', kind: 'squeeze', spaceId: 's1', fromUserId: 'u1' }, { id: 'good' }),
        message({ garbage: true }, { id: 'poison' }),
      ],
      {
        'push.deliver': () => Effect.void,
      }
    );
    expect(out.acked).toBe(2);
    expect(out.dlq).toHaveLength(1);
    expect((out.dlq[0] as { _meta: { reason: string } })._meta.reason).toBe('decode');
  });
});
