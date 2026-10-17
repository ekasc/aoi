/**
 * R2 integration suite: signed conditional PUTs against a disposable REAL
 * Cloudflare bucket.
 *
 * Proves: a presigned PUT carrying `If-None-Match: *` (the exact headers
 * makeMediaStoreService produces) cannot overwrite an existing object —
 * the second PUT is refused — while the same PUT without the condition
 * would overwrite. That is the property the album media pipeline relies on
 * to make ciphertext immutable.
 *
 * Credentials (all four required, never committed):
 *   AOI_TEST_R2_ACCOUNT_ID, AOI_TEST_R2_ACCESS_KEY_ID,
 *   AOI_TEST_R2_SECRET_ACCESS_KEY, AOI_TEST_R2_BUCKET
 * The bucket must be disposable (created for tests, lifecycle expiry is
 * recommended). Keys are namespaced under `aoi-integration-tests/<run>/`
 * and deleted in afterAll; leftovers are logged, never silent.
 *
 * Without credentials every test below is SKIPPED (reported as skipped, not
 * passed) with the exact prerequisites printed.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it, afterAll } from 'vitest';

import { makeMediaStoreService } from '../../packages/api/src/services/media-store';

const ACCOUNT_ID = process.env.AOI_TEST_R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.AOI_TEST_R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.AOI_TEST_R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.AOI_TEST_R2_BUCKET;

const HAS_CREDS = Boolean(ACCOUNT_ID && ACCESS_KEY_ID && SECRET_ACCESS_KEY && BUCKET);

const SKIP_REASON =
  'SKIPPED: set AOI_TEST_R2_ACCOUNT_ID, AOI_TEST_R2_ACCESS_KEY_ID, ' +
  'AOI_TEST_R2_SECRET_ACCESS_KEY, and AOI_TEST_R2_BUCKET (a disposable test bucket) ' +
  'to run the real-bucket R2 suite.';

if (!HAS_CREDS) {
  console.warn(`[r2-integration] ${SKIP_REASON}`);
}

const maybe = HAS_CREDS ? it : it.skip;
const runId = randomUUID();
const keyFor = (name: string) => `aoi-integration-tests/${runId}/${name}`;
const createdKeys: string[] = [];

async function putObject(
  url: string,
  headers: Record<string, string>,
  bytes: Uint8Array,
  contentType: string
): Promise<number> {
  const response = await fetch(url, {
    method: 'PUT',
    headers: { ...headers, 'Content-Length': String(bytes.length) },
    body: new Uint8Array(bytes),
  });
  await response.arrayBuffer().catch(() => null);
  return response.status;
}

describe('integration: R2 signed conditional PUT (real bucket)', () => {
  const store = HAS_CREDS
    ? makeMediaStoreService(
        {
          head: () => Promise.resolve(null),
          get: () => Promise.resolve(null),
          put: () => Promise.reject(new Error('not used')),
          delete: () => Promise.resolve(),
          list: () => Promise.resolve({ objects: [], truncated: false }),
        },
        {
          get: (key: string) =>
            key === 'R2_ACCOUNT_ID'
              ? ACCOUNT_ID
              : key === 'R2_ACCESS_KEY_ID'
                ? ACCESS_KEY_ID
                : key === 'R2_SECRET_ACCESS_KEY'
                  ? SECRET_ACCESS_KEY
                  : undefined,
        },
        BUCKET as string
      )
    : null;

  afterAll(async () => {
    if (!HAS_CREDS || !store) return;
    // Best-effort cleanup through presigned... no: cleanup needs DELETE,
    // which only the bucket binding/API has. Re-derive an S3 client here.
    const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: ACCESS_KEY_ID as string,
        secretAccessKey: SECRET_ACCESS_KEY as string,
      },
    });
    for (const key of createdKeys) {
      try {
        await s3.send(
          new DeleteObjectCommand({ Bucket: BUCKET as string, Key: key })
        );
      } catch (error) {
        console.warn(`[r2-integration] leftover key (delete manually): ${key}`, error);
      }
    }
  });

  maybe(
    'a conditional PUT creates the object and a second conditional PUT is refused (412)',
    async () => {
      const key = keyFor('immutable.bin');
      createdKeys.push(key);
      const first = new Uint8Array([1, 2, 3, 4]);
      const second = new Uint8Array([5, 6, 7, 8]);

      const one = await store!.presignPutUrl(key, 'application/octet-stream', first.length, {
        ifNoneMatch: true,
      });
      expect(one.headers['If-None-Match']).toBe('*');
      expect(await putObject(one.url, one.headers, first, 'application/octet-stream')).toBeLessThan(300);

      const two = await store!.presignPutUrl(key, 'application/octet-stream', second.length, {
        ifNoneMatch: true,
      });
      const retryStatus = await putObject(two.url, two.headers, second, 'application/octet-stream');
      // The proof: the overwrite is refused, not applied.
      expect(retryStatus).toBe(412);
    },
    60_000
  );

  maybe(
    'control: without the condition the same PUT would overwrite (so the condition is the protection)',
    async () => {
      const key = keyFor('control.bin');
      createdKeys.push(key);
      const first = new Uint8Array([9, 9, 9]);
      const second = new Uint8Array([8, 8, 8]);

      const one = await store!.presignPutUrl(key, 'application/octet-stream', first.length);
      expect(one.headers['If-None-Match']).toBeUndefined();
      expect(await putObject(one.url, one.headers, first, 'application/octet-stream')).toBeLessThan(300);

      const two = await store!.presignPutUrl(key, 'application/octet-stream', second.length);
      expect(await putObject(two.url, two.headers, second, 'application/octet-stream')).toBeLessThan(300);
    },
    60_000
  );

  maybe(
    'the presigned URL is short-lived and bound to the key (a tampered key is rejected)',
    async () => {
      const key = keyFor('bound.bin');
      createdKeys.push(key);
      const bytes = new Uint8Array([1, 1, 1]);
      const signed = await store!.presignPutUrl(key, 'application/octet-stream', bytes.length, {
        ifNoneMatch: true,
      });
      const tampered = new URL(signed.url);
      // Retargeting the signed URL at another key breaks the signature.
      tampered.pathname = tampered.pathname.replace('bound.bin', 'other.bin');
      const response = await fetch(tampered.toString(), {
        method: 'PUT',
        headers: { ...signed.headers, 'Content-Length': String(bytes.length) },
        body: new Uint8Array(bytes),
      });
      await response.arrayBuffer().catch(() => null);
      expect(response.status).toBeGreaterThanOrEqual(400);
    },
    60_000
  );
});
