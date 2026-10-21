import { execFileSync } from 'node:child_process'

export const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

export function assertClean() {
  git('diff', '--quiet', '--no-ext-diff')
  git('diff', '--cached', '--quiet', '--no-ext-diff')
}

export function sha(value) {
  if (!/^[0-9a-f]{40}$/.test(value || '')) throw new Error('An exact source SHA is required.')
  return value
}

export function source(env) {
  assertClean()
  const head = git('rev-parse', 'HEAD')
  if (head !== sha(env.EXPECTED_SHA)) throw new Error('Checkout differs from the selected source.')
  return { 'source-sha': head }
}
