import { execFileSync } from 'node:child_process';

export function gitHead(cwd) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
}

export function gitIsDirty(cwd) {
  return execFileSync('git', ['status', '--porcelain=v1'], { cwd, encoding: 'utf8' }).trim().length > 0;
}
