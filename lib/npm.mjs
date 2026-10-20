import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const manifest = () => JSON.parse(readFileSync('package.json', 'utf8'))

function repositoryIdentity(repository) {
  let value = typeof repository === 'string' ? repository : repository?.url
  if (typeof value !== 'string') return null
  value = value.replace(/^github:/, '')
  if (/^[\w.-]+\/[\w.-]+$/.test(value)) return value.replace(/\.git$/, '')
  value = value.replace(/^git@github\.com:/, 'ssh://git@github.com/').replace(/^git\+/, '')
  try {
    const url = new URL(value)
    if (!['https:', 'http:', 'git:', 'ssh:'].includes(url.protocol)
      || url.hostname !== 'github.com' || url.port || url.password
      || (url.username && url.username !== 'git') || url.search || url.hash) return null
    const path = url.pathname.replace(/^\//, '').replace(/\/$/, '').replace(/\.git$/, '')
    return /^[\w.-]+\/[\w.-]+$/.test(path) ? path : null
  } catch {
    return null
  }
}

export function candidate(env) {
  const pkg = manifest()
  if (!pkg.name || pkg.private || typeof pkg.version !== 'string')
    throw new Error('A named, non-private package with a version is required.')
  if (!env.GITHUB_REPOSITORY || repositoryIdentity(pkg.repository) !== env.GITHUB_REPOSITORY)
    throw new Error('package.json repository must identify GITHUB_REPOSITORY on github.com with matching owner/name case for npm provenance.')
  if (!env.VERIFY_COMMAND?.trim()) throw new Error('Candidate verification cannot be empty.')
  const prefix = env.TAG_PREFIX ?? 'v'
  if (env.RELEASE_TAG !== prefix + pkg.version)
    throw new Error('Release tag must match the tag prefix and package.json version.')
  const sha = git('rev-parse', 'HEAD')
  if (env.EXPECTED_SHA && env.EXPECTED_SHA !== sha)
    throw new Error('The tag moved away from the previously checked candidate.')
  if (git('rev-parse', '--verify', 'refs/tags/' + env.RELEASE_TAG + '^{commit}') !== sha)
    throw new Error('Checkout must be the tagged candidate.')
  if (env.GITHUB_SHA !== sha || env.GITHUB_REF !== 'refs/tags/' + env.RELEASE_TAG)
    throw new Error('Publication must run at the release tag with matching GITHUB_SHA. Dispatch with --ref <release-tag>.')
  const prerelease = pkg.version.split('+')[0].includes('-')
  const tag = env.NPM_TAG === 'auto' ? (prerelease ? 'next' : 'latest') : env.NPM_TAG
  if (!/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(tag || '') || (prerelease && tag === 'latest'))
    throw new Error('Invalid npm dist-tag, or prerelease promotion to latest.')
  return { 'source-sha': sha, version: pkg.version, 'npm-tag': tag }
}

export function pack(env) {
  const checked = candidate(env)
  if (checked.version !== env.EXPECTED_VERSION)
    throw new Error('Verification changed the package version.')
  execFileSync('git', ['diff', '--exit-code'], { stdio: 'pipe' })
  execFileSync('git', ['diff', '--cached', '--exit-code'], { stdio: 'pipe' })
  const directory = mkdtempSync(join(env.RUNNER_TEMP, 'xova-npm-'))
  const [info, ...extra] = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], { encoding: 'utf8' }))
  const pkg = manifest()
  if (!info || extra.length || info.name !== pkg.name || info.version !== pkg.version
    || !info.filename || basename(info.filename) !== info.filename)
    throw new Error('Packed package identity does not match the candidate.')
  // Packing must not mutate tracked inputs either.
  execFileSync('git', ['diff', '--exit-code'], { stdio: 'pipe' })
  execFileSync('git', ['diff', '--cached', '--exit-code'], { stdio: 'pipe' })
  return { ...checked, tarball: join(directory, info.filename) }
}
