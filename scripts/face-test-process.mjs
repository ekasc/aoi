import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/** One request at a time. Helpers never write photo contents or errors to logs. */
export function startFaceHelper(command, args, { timeoutMs = 120_000, ...options } = {}) {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', MKL_NUM_THREADS: '1' }, ...options });
  let pending = null;
  let dead = false;
  let closing = null;
  const exited = new Promise((resolve) => child.once('close', () => { dead = true; resolve(); }));
  const lines = createInterface({ input: child.stdout });
  const fail = () => { dead = true; pending?.reject(new Error('Local helper stopped unexpectedly')); pending = null; };
  child.on('error', fail); child.on('exit', fail);
  child.stdin.on('error', fail);
  const wait = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending = null; dead = true; child.kill('SIGKILL'); reject(new Error('Local helper timed out'));
    }, timeoutMs);
    pending = { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } };
  });
  const ready = wait();
  lines.on('line', (line) => {
    const current = pending; pending = null;
    if (!current) { fail(); child.kill('SIGKILL'); return; }
    try {
      const value = JSON.parse(line);
      if (!value || typeof value !== 'object' || value.error) current.reject(new Error('Local photo operation failed'));
      else current.resolve(value);
    } catch { current.reject(new Error('Invalid local helper response')); }
  });
  return {
    ready,
    async request(value) {
      await ready;
      if (dead || pending) throw new Error('Local helper is unavailable or busy');
      const response = wait();
      child.stdin.write(`${JSON.stringify(value)}\n`, (error) => { if (error) fail(); });
      return response;
    },
    async close() {
      if (!closing) closing = (async () => {
        dead = true;
        pending?.reject(new Error('Local helper closed')); pending = null;
        lines.close();
        if (child.exitCode === null && child.signalCode === null) {
          child.stdin.end();
          const timer = setTimeout(() => child.kill('SIGKILL'), 2_000);
          await exited;
          clearTimeout(timer);
        } else { await exited; }
      })();
      await closing;
    },
  };
}
