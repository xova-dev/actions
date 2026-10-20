#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const require = createRequire(import.meta.url)

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { cwd: { type: 'string', default: process.cwd() } },
  })
  const [mode, version] = positionals
  const semver = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
  const match = typeof version === 'string' && version.match(semver)
  if (!['preview', 'prepare'].includes(mode) || positionals.length !== 2 || !match
    || match[4]?.split('.').some(part => /^0[0-9]+$/.test(part)))
    throw new Error('Usage: node scripts/release.mjs <preview|prepare> <X.Y.Z[-prerelease]> [--cwd <project>]')

  const cwd = resolve(values.cwd)
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('rev-parse', '--verify', 'HEAD')
  const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
  if (manifest.version === version)
    throw new Error(`The project already has version ${version}; inspect the existing preparation instead of bumping again.`)
  if (mode === 'prepare') {
    if (git('status', '--porcelain=v1'))
      throw new Error('Preparation needs a clean worktree and index. Preserve existing work before preparing a release.')
    const tag = spawnSync('git', ['rev-parse', '--verify', `refs/tags/v${version}`], { cwd, stdio: 'ignore' })
    if (tag.status === 0)
      throw new Error(`Tag v${version} already exists; inspect it before preparing this version.`)
  }

  const cli = join(dirname(require.resolve('changelogen')), 'cli.mjs')
  const args = [cli, '-r', version, '--no-commit', '--no-tag', '--no-push', '--no-github', '--no-publish']
  if (mode === 'prepare') args.push('--bump', '--clean')
  else args.push('--no-output', '--no-bump', '--no-release')
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`Changelogen failed (${result.status ?? result.signal}); inspect the worktree for partial changes before retrying.`)
  if (mode === 'prepare')
    console.log(`Prepared ${version}. Review the diff and add release notes or migration documents as needed. Nothing was committed, tagged, pushed or published.`)
}
catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
