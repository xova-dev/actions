import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, renameSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { assertClean, git } from './git.mjs'
import { parse, validRange } from '../dist/semver.mjs'

const manifest = () => JSON.parse(readFileSync('package.json', 'utf8'))
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex')

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
  assertClean()
  const pkg = manifest()
  const manager = env.PACKAGE_MANAGER || 'npm'
  if (!['npm', 'pnpm'].includes(manager))
    throw new Error('package-manager must be npm or pnpm; install the selected tool before invoking the action.')
  const dependencies = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
    .flatMap(key => Object.values(pkg[key] || {}))
  if (manager === 'npm' && dependencies.some(value => /^(catalog|workspace):/.test(value)))
    throw new Error('npm pack does not resolve catalog:/workspace: dependencies. Select package-manager=pnpm for pnpm packages.')
  if (!pkg.name || pkg.private || typeof pkg.version !== 'string')
    throw new Error('A named, non-private package with a version is required.')
  const version = parse(pkg.version)
  if (!version || pkg.version !== version.version + (version.build.length ? '+' + version.build.join('.') : ''))
    throw new Error('package.json version must be a canonical SemVer, including any prerelease or build metadata.')
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
  if (env.EXPECTED_VERSION && env.EXPECTED_VERSION !== pkg.version)
    throw new Error('Verification changed the package version.')
  const prerelease = version.prerelease.length > 0
  const tag = env.NPM_TAG === 'auto' ? (prerelease ? 'next' : 'latest') : env.NPM_TAG
  if (!/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(tag || '') || validRange(tag) || (prerelease && tag === 'latest'))
    throw new Error('Invalid npm dist-tag, or prerelease promotion to latest.')
  const dryRun = execFileSync('npm', ['config', 'get', 'dry-run', '--workspaces=false'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  if (dryRun !== 'false')
    throw new Error('npm dry-run must be disabled for publication. Use the preparation preview for dry runs.')
  return { 'source-sha': sha, version: pkg.version, 'npm-tag': tag }
}

export function pack(env) {
  candidate(env)
  const directory = dirname(env.TARBALL)
  const manager = env.PACKAGE_MANAGER || 'npm'
  const result = JSON.parse(execFileSync(manager, [
    'pack', manager === 'pnpm' ? '--config.ignore-scripts=true' : '--ignore-scripts',
    '--json', '--pack-destination', directory,
  ], { encoding: 'utf8' }))
  const [info, ...extra] = Array.isArray(result) ? result : [result]
  const pkg = manifest()
  const tarball = info?.filename && resolve(directory, info.filename)
  if (!info || extra.length || !tarball || dirname(tarball) !== directory)
    throw new Error('Packed package identity does not match the candidate.')
  const packed = JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' }))
  // pnpm drops build metadata while packing; npm drops it in registry metadata.
  if (packed.name !== pkg.name || (packed.version !== pkg.version && packed.version !== parse(pkg.version).version) || packed.private
    || repositoryIdentity(packed.repository) !== env.GITHUB_REPOSITORY)
    throw new Error('Packed package name, version, visibility or repository does not match the candidate.')
  assertClean()
  renameSync(tarball, env.TARBALL)
  return digest(env.TARBALL)
}

export function verifyPackedCandidate(env, expectedDigest) {
  candidate(env)
  if (!expectedDigest || digest(env.TARBALL) !== expectedDigest)
    throw new Error('Package verification changed the tarball. Publish only the originally packed bytes.')
}
