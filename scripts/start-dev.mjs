#!/usr/bin/env node
import { spawn } from 'node:child_process';

/**
 * Start Metro with the dev Worker defaults.
 *
 * `expo start` reads .env after this process starts. Setting these here means
 * `pnpm run start --dev-client` works without exporting every public variable,
 * while an explicit shell value still wins.
 *
 * The local iOS build was made with AOI_DEV_NO_CAPABILITIES=1, so Metro must
 * serve the same `.dev` config or it will offer Apple sign-in the native build
 * cannot complete.
 */
const defaults = {
  AOI_DEV_NO_CAPABILITIES: '1',
  EXPO_PUBLIC_AUTH_STUB_MODE: 'false',
  EXPO_PUBLIC_AUTH_API_BASE_URL: 'https://aoi-api.ekasc.workers.dev',
  EXPO_PUBLIC_GOOGLE_CLIENT_ID:
    '27942860919-5ia9au1hqc6gl6faqr4ou1o6gctqo36v.apps.googleusercontent.com',
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID:
    '27942860919-4vl2396jsee0j0h2tjnp27b9dohac6rh.apps.googleusercontent.com',
};

for (const [key, value] of Object.entries(defaults)) {
  if (process.env[key] === undefined || process.env[key] === '') {
    process.env[key] = value;
  }
}

const args = process.argv.slice(2);
process.stdout.write(
  `Metro: ${process.env.EXPO_PUBLIC_AUTH_API_BASE_URL} (stub ${process.env.EXPO_PUBLIC_AUTH_STUB_MODE})\n`
);

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(command, ['expo', 'start', ...args], {
  env: process.env,
  stdio: 'inherit',
  shell: false,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
