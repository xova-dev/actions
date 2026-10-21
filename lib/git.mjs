import { execFileSync } from 'node:child_process'

export const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

export function assertClean() {
  git('diff', '--quiet', '--no-ext-diff')
  git('diff', '--cached', '--quiet', '--no-ext-diff')
}
