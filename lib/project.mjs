import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, matchesGlob, relative, resolve } from 'node:path'
import { git, source } from './git.mjs'
import { parseProjectConfig } from '../dist/project-config.mjs'

// Configuration is data from the checked source, never an imported JS module.
export function projectConfig(env) {
  const identity = source(env)
  if (!env.CONFIG_FILE?.trim()) throw new Error('config-file must select a tracked project JSON file.')
  const root = realpathSync(process.cwd())
  const selected = resolve(root, env.CONFIG_FILE)
  const path = relative(root, realpathSync(selected))
  if (!path || path === '..' || path.startsWith('../') || isAbsolute(path))
    throw new Error('Project configuration must be inside the checked repository.')
  git('--literal-pathspecs', 'ls-files', '--error-unmatch', '--', path, relative(root, selected))
  const config = parseProjectConfig(JSON.parse(readFileSync(resolve(root, path), 'utf8')), env.PROJECT_TASK)
  const { code } = config
  let changed = true
  // This optimization belongs only to ordinary code checks. Releases never use it.
  if (env.PROJECT_TASK === 'code' && env.DETECT_CHANGES === 'true' && code['docs-only-command'].trim()
    && ['push', 'pull_request'].includes(env.GITHUB_EVENT_NAME) && !env.GITHUB_REF?.startsWith('refs/tags/')
    && code['docs-only-paths'].length && /^[0-9a-f]{40}$/.test(env.BASE_SHA || '') && !/^0+$/.test(env.BASE_SHA)) {
    try {
      const range = env.GITHUB_EVENT_NAME === 'pull_request' ? env.BASE_SHA + '...HEAD' : env.BASE_SHA + '..HEAD'
      const files = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', range], { encoding: 'utf8' }).split('\0').filter(Boolean)
      changed = files.length === 0 || !files.every(file => file !== path && file !== relative(root, selected)
        && code['docs-only-paths'].some(pattern => matchesGlob(file, pattern)))
    } catch {
      // An unavailable base must run the full checks, never silently skip them.
      changed = true
    }
  }
  return { ...identity, config: JSON.stringify(config), 'code-changed': String(changed) }
}
