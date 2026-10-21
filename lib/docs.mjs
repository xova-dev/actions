import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { sha, source } from './git.mjs'

function child(root, target) {
  const path = relative(root, target)
  if (!path || path === '..' || path.startsWith('../') || isAbsolute(path))
    throw new Error('The site must be a subdirectory of the project.')
}

function digest(directory) {
  const hash = createHash('sha256')
  let files = 0
  function visit(path, name) {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) throw new Error('Documentation artifacts cannot contain symlinks.')
    if (stat.isDirectory()) {
      for (const item of readdirSync(path).sort()) visit(join(path, item), name ? name + '/' + item : item)
    } else if (stat.isFile()) {
      const bytes = readFileSync(path)
      hash.update(Buffer.byteLength(name) + ':' + name + ':' + bytes.length + ':')
      hash.update(bytes)
      files++
    } else throw new Error('Documentation artifacts must contain only regular files and directories.')
  }
  if (!lstatSync(directory).isDirectory()) throw new Error('The site must be a directory.')
  visit(directory, '')
  if (!files) throw new Error('The documentation site is empty.')
  return hash.digest('hex')
}

export function bundle(env) {
  const identity = source(env)
  const site = resolve(env.SITE_DIRECTORY)
  child(realpathSync(process.cwd()), realpathSync(site))
  const siteDigest = digest(site)
  if (!env.GITHUB_REPOSITORY) throw new Error('A source repository is required.')
  const directory = mkdtempSync(join(env.RUNNER_TEMP, 'xova-docs-'))
  cpSync(site, join(directory, 'site'), { recursive: true })
  writeFileSync(join(directory, 'source.json'), JSON.stringify({
    schemaVersion: 1, repository: env.GITHUB_REPOSITORY, sha: identity['source-sha'], siteDigest,
  }) + '\n')
  return { ...identity, 'artifact-directory': directory }
}

export function validate(env) {
  const directory = resolve(env.ARTIFACT_DIRECTORY)
  if (lstatSync(directory).isSymbolicLink() || lstatSync(join(directory, 'source.json')).isSymbolicLink())
    throw new Error('Artifact metadata cannot be a symlink.')
  const metadata = JSON.parse(readFileSync(join(directory, 'source.json'), 'utf8'))
  if (metadata.schemaVersion !== 1) throw new Error('Unsupported documentation artifact schema.')
  if (!env.GITHUB_REPOSITORY || metadata.repository !== env.GITHUB_REPOSITORY || metadata.sha !== sha(env.EXPECTED_SHA))
    throw new Error('Documentation artifact repository or source SHA does not match.')
  if (metadata.siteDigest !== digest(join(directory, 'site')))
    throw new Error('Documentation artifact content does not match its digest.')
  return { 'source-sha': metadata.sha }
}

export function restore(env) {
  source(env)
  const identity = validate(env)
  const root = realpathSync(process.cwd())
  const target = resolve(env.SITE_DIRECTORY)
  child(root, target)
  let parent = dirname(target)
  while (!existsSync(parent)) parent = dirname(parent)
  const actual = realpathSync(parent)
  if (actual !== root) child(root, actual)
  rmSync(target, { recursive: true, force: true })
  mkdirSync(dirname(target), { recursive: true })
  cpSync(join(resolve(env.ARTIFACT_DIRECTORY), 'site'), target, { recursive: true })
  return identity
}
