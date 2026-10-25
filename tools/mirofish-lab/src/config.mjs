import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { readJson } from './lib/io.mjs';
import { labPaths } from './lib/paths.mjs';

function merge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return override ?? base;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = value && typeof value === 'object' && !Array.isArray(value) ? merge(base?.[key] ?? {}, value) : value;
  }
  return out;
}

function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

export function loadConfig(overrides = {}) {
  const paths = labPaths();
  const examplePath = join(paths.configDir, 'lab.example.json');
  const localPath = join(paths.configDir, 'lab.local.json');
  let config = readJson(examplePath);
  if (existsSync(localPath)) {
    config = merge(config, readJson(localPath));
  }

  config.mirofish.baseUrl = process.env.MIROFISH_BASE_URL ?? config.mirofish.baseUrl;
  config.simulation.model = process.env.MIROFISH_MODEL ?? config.simulation.model;
  config.simulation.seedVersion = process.env.MIROFISH_SEED_VERSION ?? config.simulation.seedVersion;
  config.simulation.maxRounds = envInt('MIROFISH_MAX_ROUNDS', config.simulation.maxRounds);
  config.simulation.repeatCount = envInt('MIROFISH_REPEAT', config.simulation.repeatCount);
  config.simulation.interviewAgents = envInt('MIROFISH_INTERVIEW_AGENTS', config.simulation.interviewAgents);
  return merge(config, overrides);
}

export function requireLiveConfig(config) {
  const errors = [];
  if (!/^https?:\/\/(127\.0\.0\.1|localhost):\d+$/.test(config.mirofish.baseUrl)) {
    errors.push(
      `mirofish.baseUrl must be a loopback address; got ${config.mirofish.baseUrl}. The simulation server must not be public.`
    );
  }
  if (!config.simulation.maxRounds || config.simulation.maxRounds < 1 || config.simulation.maxRounds > 40) {
    errors.push('simulation.maxRounds must be between 1 and 40 (MiroFish itself recommends starting below 40).');
  }
  if (!config.simulation.repeatCount || config.simulation.repeatCount < 1 || config.simulation.repeatCount > 5) {
    errors.push('simulation.repeatCount must be between 1 and 5.');
  }
  return errors;
}
