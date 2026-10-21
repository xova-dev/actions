import assert from 'node:assert/strict'
import { chmodSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { composite } from './composite.mjs'
import { fixture } from './helpers.mjs'

function cached(t) {
  const project = fixture(t)
  project.write('pnpm-lock.yaml', 'locked node dependencies\n')
  project.write('tests/skills/uv.lock', 'locked python dependencies\n')
  project.write('bin/uv', '#!/bin/bash\nif [ "$UV_LOOKUP_FAILURE" = 1 ]; then exit 37; fi\ntest "$*" = "cache dir"\nprintf "%s\\n" "$UV_CACHE_DIR"\n')
  chmodSync(join(project.cwd, 'bin/uv'), 0o755)
  const env = { PATH: join(project.cwd, 'bin') + ':' + process.env.PATH,
    npm_config_cache: join(project.cwd, 'npm-downloads'), UV_CACHE_DIR: join(project.cwd, 'uv-downloads') }
  return { ...project, env }
}

test('enabled caches precede real installation on hits and misses without selecting another runtime', t => {
  for (const hit of ['true', 'false']) {
    const project = cached(t)
    const calls = []
    const cache = { npm: 'pnpm-lock.yaml', pnpm: 'pnpm-lock.yaml', uv: 'tests/skills/uv.lock' }
    const run = () => composite('setup', project.cwd, {
      toolchain: 'mise', cache: JSON.stringify(cache),
      'install-command': 'printf "%s" "$NPM_CONFIG_CACHE" > observed-cache',
    }, project.env, (uses, inputs) => {
      assert.equal(existsSync(join(project.cwd, 'observed-cache')), false)
      calls.push({ uses: uses.split('@')[0], inputs })
      return { 'cache-hit': hit }
    })
    const result = run()
    assert.equal(result.status, 0, result.logs)
    assert.equal(readFileSync(join(project.cwd, 'observed-cache'), 'utf8'), project.env.npm_config_cache)
    assert.deepEqual(calls.map(call => call.uses), ['jdx/mise-action', 'actions/setup-node', 'actions/setup-node', 'actions/cache'])
    for (const call of calls.filter(call => call.uses === 'actions/setup-node')) {
      assert.equal(call.inputs['node-version'], undefined)
      assert.equal(call.inputs['cache-dependency-path'], 'pnpm-lock.yaml')
    }
    assert.equal(calls.at(-1).inputs.path, project.env.UV_CACHE_DIR)
    assert.match(calls.at(-1).inputs.key, /^uv-v1-fixture-os-fixture-arch-/)
  }
})

test('disabled caches need no lockfiles or uv and never skip installation', t => {
  const project = fixture(t)
  const calls = []
  const result = composite('setup', project.cwd, { 'install-command': 'touch installed' }, {}, (uses, inputs) => {
    calls.push(uses.split('@')[0])
    assert.equal(inputs['package-manager-cache'], 'false')
    return {}
  })
  assert.equal(result.status, 0, result.logs)
  assert.deepEqual(calls, ['actions/setup-node'])
  assert.ok(existsSync(join(project.cwd, 'installed')))
})

test('a missing uv lockfile or failed cache lookup stops before caching or installation', t => {
  for (const failure of ['missing-lock', 'lookup']) {
    const project = cached(t)
    const result = composite('setup', project.cwd, {
      cache: JSON.stringify({ uv: failure === 'missing-lock' ? 'missing.lock' : 'tests/skills/uv.lock' }),
      'install-command': 'touch installed',
    }, { ...project.env, UV_LOOKUP_FAILURE: failure === 'lookup' ? '1' : '' }, uses => {
      assert.doesNotMatch(uses, /^actions\/cache@/)
      return {}
    })
    assert.notEqual(result.status, 0)
    assert.equal(existsSync(join(project.cwd, 'installed')), false)
  }
})
