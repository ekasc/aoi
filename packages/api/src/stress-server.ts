import { randomUUID, createHash, createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import sharp from 'sharp';

import { createApp } from './create-app';
import { makeTestHarness } from './effects/test-harness';
import type { MediaStoreService } from './services/media-store';

const profiles = {
  established: { couples: 50, backgroundMoments: 800, moments: 5000, events: 2000, lists: 50, items: 5000, letters: 200 },
  heavy: { couples: 100, backgroundMoments: 1000, moments: 20000, events: 10000, lists: 100, items: 20000, letters: 1000 },
} as const;
const profileName = process.env.AOI_STRESS_PROFILE ?? 'established';
if (profileName !== 'established' && profileName !== 'heavy') throw new Error('Unknown stress profile');
const profile = profiles[profileName];
const port = Number(process.env.PORT ?? '8092');
const baseUrl = process.env.AOI_STRESS_PUBLIC_URL ?? `http://127.0.0.1:${port}`;
const output = path.resolve(process.env.AOI_STRESS_OUTPUT ?? `.expo/aoi-debug/performance/stress-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
const now = Date.now();
const day = 86400000;
const run = randomUUID();
const controlToken = `stress-control-${run}`;

// The album's presigned PUT leg terminates here, like the E2E server's: no cloud
// bucket is needed, and the conditional-create semantics are real.
const uploadSecret = randomUUID().replaceAll('-', '');
function signUpload(key: string, expiresAt: number): string {
  return createHmac('sha256', uploadSecret).update(`${key}:${expiresAt}`).digest('hex');
}
const uploadedObjects = new Map<string, { bytes: Uint8Array; contentType: string }>();
const UPLOAD_TTL_MS = 60 * 60 * 1000;

const stressMediaStore: MediaStoreService = {
  bucket: null as never,
  bucketName: 'aoi-stress',
  presignPutUrl: async (key, contentType, _sizeBytes, options) => {
    const expiresAt = Date.now() + UPLOAD_TTL_MS;
    return {
      url: `${baseUrl}/v1/e2e/uploads/${encodeURIComponent(key)}?expiresAt=${expiresAt}&sig=${signUpload(key, expiresAt)}`,
      headers: {
        'Content-Type': contentType,
        ...(options?.ifNoneMatch ? { 'If-None-Match': '*' } : {}),
      },
    };
  },
  head: async (key) => {
    const entry = uploadedObjects.get(key);
    if (!entry) return null;
    return {
      key,
      size: entry.bytes.byteLength,
      httpEtag: `etag-${createHash('md5').update(entry.bytes).digest('hex')}`,
      uploaded: new Date(0),
      writeHttpMetadata() {},
    };
  },
  get: async (key) => {
    const entry = uploadedObjects.get(key);
    if (!entry) return null;
    const bytes = entry.bytes;
    return {
      key,
      size: bytes.byteLength,
      httpEtag: `etag-${key}`,
      uploaded: new Date(0),
      httpMetadata: { contentType: entry.contentType },
      writeHttpMetadata() {},
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    };
  },
  put: async (key, value, options) => {
    const bytes =
      typeof value === 'string'
        ? new TextEncoder().encode(value)
        : value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : value instanceof Uint8Array
            ? value
            : new Uint8Array(await new Response(value as ReadableStream).arrayBuffer());
    uploadedObjects.set(key, {
      bytes,
      contentType: options?.httpMetadata?.contentType ?? 'application/octet-stream',
    });
    return { key, size: bytes.byteLength, httpEtag: `etag-${key}`, uploaded: new Date(0), writeHttpMetadata() {} };
  },
  delete: async (key) => {
    uploadedObjects.delete(key);
  },
  list: async () => ({ objects: [], truncated: false }),
};
const harness = makeTestHarness({ filename: path.join(output, 'data.sqlite'), initialMs: now, mediaStore: stressMediaStore });
const db = harness.d1.rawDb;
const id = (kind: number, couple: number, index: number) => `${run.slice(0, 8)}-0000-4000-8000-${String(kind * 10000000 + couple * 100000 + index).padStart(12, '0')}`;
const token = (couple: number) => `stress-${run}-${couple}`;
const clientSpaces: { spaceId: string; userId: string; token: string }[] = [];

const seedStarted = performance.now();
db.transaction(() => {
  const user = db.prepare('insert into users (id,email,name,email_verified,created_at,updated_at) values (?,?,?,1,?,?)');
  const session = db.prepare('insert into user_sessions (id,user_id,token,expires_at,created_at,updated_at) values (?,?,?,?,?,?)');
  const space = db.prepare('insert into spaces (id,name,partner_name,relationship_start_date,created_by_user_id,created_at,updated_at) values (?,?,?,?,?,?,?)');
  const member = db.prepare("insert into space_members (space_id,user_id,role,state,joined_at) values (?,?,?,'active',?)");
  const moment = db.prepare('insert into moments (id,space_id,created_by_user_id,author_role,author_name,type,title,body,occurred_at,media_preview,audio_uri,created_at,updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const event = db.prepare('insert into calendar_events (id,space_id,created_by_user_id,actor,actor_name,title,starts_at,ends_at,label_preset,together,created_at,updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?)');
  const collection = db.prepare('insert into collections (id,space_id,created_by_user_id,name,position,created_at,updated_at) values (?,?,?,?,?,?,?)');
  const item = db.prepare('insert into collection_items (id,collection_id,space_id,created_by_user_id,title,note,position,created_at,updated_at) values (?,?,?,?,?,?,?,?,?)');
  const letter = db.prepare('insert into letters (id,space_id,author_user_id,caption,body,sealed_until,created_at) values (?,?,?,?,?,?,?)');
  for (let couple = 0; couple < profile.couples; couple++) {
    const userId = id(1, couple, 0);
    const partnerId = id(1, couple, 1);
    const spaceId = id(2, couple, 0);
    for (const [userKey, name] of [[userId, 'Maya Stress'], [partnerId, 'June Stress']]) {
      user.run(userKey, `${userKey}@stress.invalid`, name, now - 1825 * day, now);
    }
    session.run(id(9, couple, 0), userId, token(couple), now + day, now, now);
    space.run(spaceId, `Synthetic archive ${couple}`, 'June Stress', '2021-01-01', userId, now - 1825 * day, now);
    member.run(spaceId, userId, 'you', now - 1825 * day);
    member.run(spaceId, partnerId, 'partner', now - 1825 * day);
    clientSpaces.push({ spaceId, userId, token: token(couple) });
    const count = couple === 0 ? profile.moments : profile.backgroundMoments;
    for (let index = 0; index < count; index++) {
      const at = now - Math.floor(index * 1825 * day / count);
      const own = index % 2 === 0;
      const kind = index % 10 === 0 ? 'trace' : index % 3 !== 0 ? 'media' : 'note';
      const photo = kind === 'media' ? `${baseUrl}/__stress/photo/${run}/${couple}-${index}.jpg` : null;
      const audio = kind === 'trace' ? `${baseUrl}/__stress/audio/${run}/${couple}-${index}.wav` : null;
      moment.run(id(3, couple, index), spaceId, own ? userId : partnerId, own ? 'you' : 'partner', own ? 'Maya Stress' : 'June Stress', kind,
        `Memory ${index}`, 'Synthetic weekend memory with varied dates, authors, and media. '.repeat(6 + index % 12), at, photo, audio, at, at);
    }
    const eventCount = couple === 0 ? profile.events : 100;
    for (let index = 0; index < eventCount; index++) {
      const at = now - 730 * day + Math.floor(index * 1095 * day / eventCount);
      const own = index % 2 === 0;
      event.run(id(4, couple, index), spaceId, own ? userId : partnerId, own ? 'you' : 'partner', own ? 'Maya Stress' : 'June Stress', `Plan ${index}`, at, at + (30 + index % 180) * 60000, ['Work', 'Date', 'Gym', 'Family'][index % 4], index % 3 === 0 ? 1 : 0, at, at);
    }
    if (couple !== 0) continue;
    for (let index = 0; index < profile.lists; index++) collection.run(id(5, couple, index), spaceId, userId, `Stress list ${index}`, index, now, now);
    for (let index = 0; index < profile.items; index++) item.run(id(6, couple, index), id(5, couple, index % profile.lists), spaceId, userId, `Thing ${index}`, 'Synthetic item note. '.repeat(10), index, now, now);
    for (let index = 0; index < profile.letters; index++) letter.run(id(7, couple, index), spaceId, index % 2 ? partnerId : userId, `Letter ${index}`, 'A synthetic letter kept for later. '.repeat(50), now + (index % 30) * day, now - index * day);
  }
})();

const pictures: Buffer[] = [];
for (let image = 0; image < 12; image++) {
  const pixels = Buffer.alloc(1024 * 768 * 3);
  let seed = image + 1;
  for (let index = 0; index < pixels.length; index++) {
    seed = Math.imul(seed, 1664525) + 1013904223;
    pixels[index] = seed >>> 24;
  }
  pictures.push(await sharp(pixels, { raw: { width: 1024, height: 768, channels: 3 } }).jpeg({ quality: 78 }).toBuffer());
}
const wav = Buffer.alloc(44 + 16000 * 15 * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
for (let index = 0; index < 16000 * 15; index++) wav.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 220 / 16000) * 800), 44 + index * 2);

const app = createApp(harness.layer);

// Local byte transport for the album's presigned uploads.
const uploads = new Hono();
uploads.put('/v1/e2e/uploads/:key', async (c) => {
  const key = decodeURIComponent(c.req.param('key'));
  const expiresAt = Number(c.req.query('expiresAt') ?? '0');
  const sig = c.req.query('sig') ?? '';
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Upload URL expired' } }, 400);
  }
  const expected = signUpload(key, expiresAt);
  if (sig.length !== expected.length) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Bad upload signature' } }, 403);
  }
  let different = 0;
  for (let index = 0; index < expected.length; index += 1) {
    different |= sig.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  if (different !== 0) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Bad upload signature' } }, 403);
  }
  if ((c.req.header('if-none-match') ?? '').trim() === '*' && uploadedObjects.has(key)) {
    return c.json({ error: { code: 'CONFLICT', message: 'Object exists' } }, 412);
  }
  uploadedObjects.set(key, {
    bytes: new Uint8Array(await c.req.arrayBuffer()),
    contentType: c.req.header('content-type') ?? 'application/octet-stream',
  });
  return c.json({ ok: true });
});
app.route('/', uploads);
const requests: { method: string; path: string; origin: string | null; cursor: boolean; status: number; ms: number; at: number; bytes: number | null }[] = [];
let stopping = false;
let server: ReturnType<typeof serve>;
function shutdown() {
  if (stopping) return;
  stopping = true;
  fs.writeFileSync(path.join(output, 'requests.json'), JSON.stringify(requests, null, 2));
  server.close(() => { db.close(); console.log(JSON.stringify({ stopped: true, requests: requests.length })); process.exit(0); });
  setTimeout(() => {
    if ('closeAllConnections' in server && typeof server.closeAllConnections === 'function') server.closeAllConnections();
  }, 1000).unref();
}
server = serve({ hostname: '0.0.0.0', port, fetch: async (request) => {
  const url = new URL(request.url);
  if (url.pathname === '/__stress/shutdown' && request.headers.get('authorization') === `Bearer ${controlToken}` && request.method === 'POST') {
    setTimeout(shutdown, 50);
    return Response.json({ ok: true });
  }
  if (url.pathname === '/__stress/manifest') return Response.json({ run, profile: profileName, counts: profile });
  if (url.pathname === '/__stress/metrics' && request.headers.get('authorization') === `Bearer ${controlToken}`) return Response.json(requests);
  const start = performance.now();
  await new Promise(resolve => setTimeout(resolve, url.pathname.startsWith('/__stress/') ? 80 : 60));
  let response: Response;
  let bytes: number | null = null;
  if (url.pathname.startsWith('/__stress/photo/')) {
    const index = [...url.pathname].reduce((sum, char) => sum + char.charCodeAt(0), 0) % pictures.length;
    bytes = pictures[index].length;
    response = new Response(new Uint8Array(pictures[index]), { headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(pictures[index].length), 'Cache-Control': 'public,max-age=3600', 'Access-Control-Allow-Origin': '*' } });
  } else if (url.pathname.startsWith('/__stress/audio/')) {
    bytes = wav.length;
    response = new Response(new Uint8Array(wav), { headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(wav.length), 'Access-Control-Allow-Origin': '*' } });
  } else response = await app.fetch(request);
  // `at` is the server's own clock, deliberately kept separate from any device
  // timestamp: the two are never subtracted from each other.
  if (requests.length < 100000) requests.push({ method: request.method, path: url.pathname, origin: request.headers.get('origin'), cursor: url.searchParams.has('cursor'), status: response.status, ms: Math.round(performance.now() - start), at: Date.now(), bytes });
  return response;
} });
const manifest = { run, profile: profileName, counts: profile, baseUrl, loopbackUrl: `http://127.0.0.1:${port}`, controlToken, clients: clientSpaces, pictureBytes: pictures.map(picture => picture.length), seedMs: Math.round(performance.now() - seedStarted), output };
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ ready: true, output, counts: profile }));
setTimeout(shutdown, 10 * 60000).unref();
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
