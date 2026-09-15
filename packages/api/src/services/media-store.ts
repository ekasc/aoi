import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Context, Data, Effect, Layer } from 'effect';

import type { R2Bucket, R2GetOptions, R2Object, R2ObjectBody, R2PutOptions } from '../env';

/**
 * MediaStore — the private R2 surface. Server-side access (head/get/put/
 * delete/list) goes through the `MEDIA` runtime binding; the S3 API is used
 * for exactly ONE thing: presigning the direct PUT (the user's device uploads
 * straight to R2, the key never leaves the server).
 *
 * Deterministic, stable keys only — never durable signed URLs:
 * - original: `media/{mediaId}/original.{ext}`
 * - display:  `media/{mediaId}/display.webp`
 * - thumb:    `media/{mediaId}/thumb.webp`
 *
 * The presigner needs R2 S3 API credentials (R2_ACCOUNT_ID /
 * R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY — user-owned secrets). When they
 * are missing, presigning fails with a fixed, contained error; reads/serves
 * through the binding keep working.
 */

export const MEDIA_PRESIGN_TTL_SEC = 3600;

export interface MediaStoreService {
  readonly bucket: R2Bucket;
  readonly bucketName: string;
  /** Short-lived presigned PUT for the direct device upload. */
  readonly presignPutUrl: (key: string, contentType: string, sizeBytes: number) => Promise<string>;
  readonly head: (key: string) => Promise<R2Object | null>;
  readonly get: (key: string, options?: R2GetOptions) => Promise<R2ObjectBody | null>;
  readonly put: (key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string, options?: R2PutOptions) => Promise<R2Object>;
  readonly delete: (key: string) => Promise<void>;
  readonly list: (options?: { prefix?: string; limit?: number; cursor?: string }) => Promise<{
    objects: R2Object[];
    truncated: boolean;
    cursor?: string;
  }>;
}

export class MediaStore extends Context.Tag('aoi/MediaStore')<MediaStoreService, MediaStoreService>() {}

interface R2Creds {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function readR2Creds(config: { get: (key: string) => string | undefined }): R2Creds | null {
  const accountId = config.get('R2_ACCOUNT_ID');
  const accessKeyId = config.get('R2_ACCESS_KEY_ID');
  const secretAccessKey = config.get('R2_SECRET_ACCESS_KEY');
  if (!accountId || !accessKeyId || !secretAccessKey) {
    return null;
  }
  return { accountId, accessKeyId, secretAccessKey };
}

export function makeMediaStoreService(
  bucket: R2Bucket,
  config: { get: (key: string) => string | undefined },
  bucketName: string
): MediaStoreService {
  let s3Client: S3Client | null = null;
  let creds: R2Creds | null = null;

  const presignPutUrl = async (key: string, contentType: string, sizeBytes: number): Promise<string> => {
    // Resolve credentials lazily so reads/serves never need them.
    if (!creds) {
      creds = readR2Creds(config);
    }
    if (!creds) {
      throw new Error('R2 credentials are not configured');
    }
    if (!s3Client) {
      s3Client = new S3Client({
        region: 'auto',
        endpoint: `https://${creds.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: creds.accessKeyId,
          secretAccessKey: creds.secretAccessKey,
        },
      });
    }
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: contentType,
      ContentLength: sizeBytes,
    });
    return getSignedUrl(s3Client, command, { expiresIn: MEDIA_PRESIGN_TTL_SEC });
  };

  return {
    bucket,
    bucketName,
    presignPutUrl,
    head: (key) => bucket.head(key),
    get: (key, options) => bucket.get(key, options),
    put: (key, value, options) => bucket.put(key, value, options),
    delete: (key) => bucket.delete(key),
    list: (options) => bucket.list(options),
  };
}

export const makeMediaStoreLayer = (
  bucket: R2Bucket,
  config: { get: (key: string) => string | undefined },
  bucketName = 'aoi-media'
): Layer.Layer<MediaStoreService> =>
  Layer.succeed(MediaStore, makeMediaStoreService(bucket, config, bucketName));

/** Effect accessor: run a media-store operation with typed containment. */
export const mediaStoreOp = <A>(
  program: (store: MediaStoreService) => Promise<A>
): Effect.Effect<A, MediaStoreError, MediaStoreService> =>
  Effect.flatMap(MediaStore, (s) =>
    Effect.tryPromise({
      try: () => program(s),
      catch: (cause) => new MediaStoreError({ cause }),
    })
  );

export class MediaStoreError extends Data.TaggedError('MediaStoreError')<{
  readonly cause?: unknown;
}> {}
