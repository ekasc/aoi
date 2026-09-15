const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite web bundles its wa-sqlite WASM binary via
// `import wasmModule from './wa-sqlite/wa-sqlite.wasm'`. Metro only resolves
// extensions listed in assetExts/sourceExts, and `wasm` is in neither by
// default, so the web bundle fails with "Unable to resolve module
// ./wa-sqlite/wa-sqlite.wasm". Treat .wasm as an asset (native graphs never
// import it — only the web SQLite worker does).
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}
if (!config.resolver.sourceExts.includes('wasm')) {
  config.resolver.sourceExts.push('wasm');
}

// `tslib` ships an ESM entry (`modules/index.js`, selected via the package
// exports `import` condition) that default-imports its own CJS build. The CJS
// build sets `__esModule` without defining a `default` export, so under
// Metro's Node-side loader (expo-router route-manifest evaluation, which
// pulls `moti` -> `framer-motion` ESM -> `tslib` ESM) the interop yields
// `undefined` and crashes with "Cannot destructure property '__extends' of
// 'tslib.default'". Always resolve the canonical CJS build (`main`) —
// identical helpers, no behavior change.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'tslib') {
    return {
      filePath: require.resolve('tslib/tslib.js', {
        paths: [path.dirname(context.originModulePath), __dirname],
      }),
      type: 'sourceFile',
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

// ── Dev debug sink ───────────────────────────────────────────────────────
// A tiny HTTP receiver mounted on the Metro origin. The app on a physical
// device pushes artifacts here that the agent can't otherwise see —
// screenshots (react-native-view-shot) and element-picker selections — and
// everything lands in `.expo/aoi-debug/` (gitignored) for the agent to read.
// It exists only while `expo start` runs, so it can never ship. Expo CLI
// preserves a custom `enhanceMiddleware`, so this chains onto Metro's rather
// than replacing it.
const fs = require('fs');

const DEBUG_PREFIX = '/__aoi_debug';
const DEBUG_DIR = path.join(__dirname, '.expo', 'aoi-debug');

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg'];

function isScreenshotImage(name) {
  const lower = name.toLowerCase();
  return IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 16 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function writeDebugFile(subdir, name, contents) {
  const dir = path.join(DEBUG_DIR, subdir);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, name);
  fs.writeFileSync(target, contents);
  return target;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function handleDebugRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === `${DEBUG_PREFIX}/latest`) {
    const kind = url.searchParams.get('kind') === 'select' ? 'selections' : 'screenshots';
    const dir = path.join(DEBUG_DIR, kind);
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((file) => !file.startsWith('.')).sort();
    } catch {
      files = [];
    }
    const images = kind === 'screenshots' ? files.filter(isScreenshotImage) : files;
    const latest = images[images.length - 1] || null;
    sendJson(res, 200, {
      ok: true,
      kind,
      latest,
      path: latest ? path.join(dir, latest) : null,
      files: images.slice(-20),
    });
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith(`${DEBUG_PREFIX}/file/`)) {
    const rel = decodeURIComponent(url.pathname.slice(`${DEBUG_PREFIX}/file/`.length));
    const root = path.resolve(DEBUG_DIR);
    const target = path.resolve(root, `.${path.sep}${rel}`);
    if ((target !== root && !target.startsWith(`${root}${path.sep}`)) || !fs.existsSync(target)) {
      sendJson(res, 404, { ok: false, error: 'not found' });
      return;
    }
    const lowerTarget = target.toLowerCase();
    res.statusCode = 200;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Content-Type',
      lowerTarget.endsWith('.png')
        ? 'image/png'
        : /\.jpe?g$/.test(lowerTarget)
          ? 'image/jpeg'
          : 'application/json'
    );
    fs.createReadStream(target).pipe(res);
    return;
  }

  const SCREENSHOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
  function screenshotMetaPath(id) {
    return path.join(DEBUG_DIR, 'screenshots', `${id}.json`);
  }

  if (req.method === 'POST' && url.pathname === `${DEBUG_PREFIX}/screenshot-meta`) {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!SCREENSHOT_ID_PATTERN.test(id)) {
      sendJson(res, 400, { ok: false, error: 'invalid screenshot id' });
      return;
    }
    if (body.accessibility !== undefined && (typeof body.accessibility !== 'object' || body.accessibility === null)) {
      sendJson(res, 400, { ok: false, error: 'invalid accessibility payload' });
      return;
    }
    const dir = path.join(DEBUG_DIR, 'screenshots');
    fs.mkdirSync(dir, { recursive: true });
    const metaPath = screenshotMetaPath(id);
    let record = { id };
    try {
      record = { ...JSON.parse(fs.readFileSync(metaPath, 'utf8')), id };
    } catch {
      record = { id };
    }
    record = {
      ...record,
      label: typeof body.label === 'string' ? body.label : 'manual',
      screen: body.screen && typeof body.screen === 'object' ? body.screen : null,
      platform: typeof body.platform === 'string' ? body.platform : null,
      accessibility: body.accessibility ?? null,
      at: new Date().toISOString(),
    };
    fs.writeFileSync(metaPath, JSON.stringify(record, null, 2));
    sendJson(res, 200, {
      ok: true,
      metaPath,
      accessibilityCount: record.accessibility?.count ?? 0,
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === `${DEBUG_PREFIX}/screenshot-upload`) {
    const id = (url.searchParams.get('id') || '').trim();
    if (!SCREENSHOT_ID_PATTERN.test(id)) {
      sendJson(res, 400, { ok: false, error: 'invalid screenshot id' });
      return;
    }
    const data = await readBody(req);
    if (!data.length) {
      sendJson(res, 400, { ok: false, error: 'empty screenshot upload' });
      return;
    }
    const extension =
      data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
        ? '.jpg'
        : data.length >= 8 &&
            data[0] === 0x89 &&
            data[1] === 0x50 &&
            data[2] === 0x4e &&
            data[3] === 0x47 &&
            data[4] === 0x0d &&
            data[5] === 0x0a &&
            data[6] === 0x1a &&
            data[7] === 0x0a
          ? '.png'
          : null;
    if (!extension) {
      sendJson(res, 415, { ok: false, error: 'unsupported screenshot upload' });
      return;
    }
    const imagePath = writeDebugFile('screenshots', `${id}${extension}`, data);
    const metaPath = screenshotMetaPath(id);
    let record = { id, screenshot: imagePath, uploadedAt: new Date().toISOString() };
    try {
      record = {
        ...JSON.parse(fs.readFileSync(metaPath, 'utf8')),
        ...record,
      };
    } catch {
      // A sidecar is optional for a fire-and-forget upload.
    }
    fs.writeFileSync(metaPath, JSON.stringify(record, null, 2));
    sendJson(res, 200, {
      ok: true,
      path: imagePath,
      metaPath,
      accessibilityCount: record.accessibility?.count ?? 0,
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === `${DEBUG_PREFIX}/screenshot`) {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const id = stamp();
    const pngPath = writeDebugFile(
      'screenshots',
      `${id}.png`,
      Buffer.from(body.pngBase64 || '', 'base64')
    );
    const metaPath = writeDebugFile(
      'screenshots',
      `${id}.json`,
      JSON.stringify({ ...body, pngBase64: undefined, screenshot: pngPath }, null, 2)
    );
    sendJson(res, 200, {
      ok: true,
      path: pngPath,
      metaPath,
      accessibilityCount: body.accessibility?.count ?? 0,
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === `${DEBUG_PREFIX}/select`) {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const id = stamp();
    let pngPath = null;
    if (body.pngBase64) {
      pngPath = writeDebugFile('selections', `${id}.png`, Buffer.from(body.pngBase64, 'base64'));
    }
    const record = { ...body, pngBase64: undefined, screenshot: pngPath, at: new Date().toISOString() };
    const jsonPath = writeDebugFile('selections', `${id}.json`, JSON.stringify(record, null, 2));
    fs.appendFileSync(path.join(DEBUG_DIR, 'events.jsonl'), `${JSON.stringify(record)}\n`);
    sendJson(res, 200, { ok: true, path: jsonPath, screenshot: pngPath });
    return;
  }

  sendJson(res, 404, { ok: false, error: 'unknown debug endpoint' });
}

const previousEnhanceMiddleware = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (metroMiddleware, server) => {
  const withDebugSink = (req, res, next) => {
    if (!req.url || !req.url.startsWith(DEBUG_PREFIX)) {
      return metroMiddleware(req, res, next);
    }
    handleDebugRequest(req, res).catch((error) => {
      sendJson(res, 500, { ok: false, error: error.message });
    });
  };
  return previousEnhanceMiddleware
    ? previousEnhanceMiddleware(withDebugSink, server)
    : withDebugSink;
};

module.exports = config;
