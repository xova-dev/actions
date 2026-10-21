import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseProjectConfig } from '../dist/project-config.mjs'
import { projectCases, sampleConfig, tasks } from './project-cases.mjs'
import { root } from './helpers.mjs'

const clone = value => JSON.parse(JSON.stringify(value))

test('configuration preserves the accepted/rejected JSON contract across every task', () => {
  for (const { name, input, task, valid } of projectCases()) {
    if (valid) assert.doesNotThrow(() => parseProjectConfig(clone(input), task), name)
    else assert.throws(() => parseProjectConfig(clone(input), task), /project configuration|project setting|configuration is required|deployment provider/i, name)
  }
})

test('missing settings receive the complete defaults while empty strings and null stay distinct', () => {
  assert.deepEqual(parseProjectConfig({ schemaVersion: 1, npm: { 'verify-command': 'npm run build' } }, 'release'), {
    schemaVersion: 1,
    setup: { toolchain: 'node', 'node-version': '24', 'install-command': 'npm ci', 'working-directory': '.', cache: { npm: '', pnpm: '', uv: '' } },
    code: null,
    npm: { 'package-manager': 'npm', 'verify-command': 'npm run build', 'package-verify-command': '', 'tag-prefix': 'v', 'npm-tag': 'auto', 'environment-name': 'npm-publish' },
    docs: { provider: 'none', 'check-command': '', 'build-command': '', 'site-directory': '', 'working-directory': '.', 'install-command': 'npm ci', cache: { npm: '', pnpm: '', uv: '' }, 'environment-name': '', 'concurrency-group': '', 'site-id': 'documentation', 'deploy-command': 'npm exec --no -- wrangler deploy', 'deployment-policy': 'latest-stable' },
  })
  const raw = { schemaVersion: 1, setup: { 'working-directory': 'packages/widget', 'install-command': 'pnpm install --frozen-lockfile' }, npm: { 'verify-command': 'pnpm build', 'tag-prefix': '' } }
  const parsed = parseProjectConfig(clone(raw), 'release')
  assert.equal(parsed.npm['tag-prefix'], '')
  assert.equal(parsed.docs['working-directory'], raw.setup['working-directory'])
  assert.equal(parsed.docs['install-command'], raw.setup['install-command'])
  for (const field of ['working-directory', 'install-command']) {
    assert.throws(() => parseProjectConfig({ ...raw, docs: { [field]: '' } }, 'release'), /Invalid project configuration/)
    assert.throws(() => parseProjectConfig({ ...raw, docs: { [field]: null } }, 'release'), /Invalid project configuration/)
  }
  const input = { schemaVersion: 1, code: { 'check-command': 'npm test' } }
  const first = parseProjectConfig(clone(input), 'code')
  first.code['docs-only-paths'].push('changed')
  first.setup['node-version'] = 'changed'
  const second = parseProjectConfig(clone(input), 'code')
  assert.deepEqual(second.code['docs-only-paths'], [])
  assert.equal(second.setup['node-version'], '24')
})

test('each task requires only the commands and delivery settings it consumes', () => {
  for (const [input, accepted] of [
    [{ schemaVersion: 1, code: { 'check-command': 'npm test' }, npm: {}, docs: { provider: 'pages' } }, ['code', 'deploy']],
    [{ schemaVersion: 1, code: {}, npm: {}, docs: sampleConfig().docs }, ['docs', 'recovery', 'deploy']],
    [{ schemaVersion: 1, code: { 'check-command': 'npm test' }, docs: { provider: 'cloudflare', 'site-directory': 'site' } }, ['code', 'deploy']],
    [{ schemaVersion: 1, code: {}, npm: { 'verify-command': 'npm run build' } }, ['release']],
    [{ schemaVersion: 1, code: {}, npm: {}, docs: { ...sampleConfig().docs, provider: 'none' } }, ['docs']],
    [{ schemaVersion: 1, code: {}, npm: { 'verify-command': 'npm run build' }, docs: sampleConfig().docs }, ['docs', 'release', 'recovery', 'deploy']],
  ]) {
    for (const task of tasks) {
      if (accepted.includes(task)) assert.doesNotThrow(() => parseProjectConfig(clone(input), task), task)
      else assert.throws(() => parseProjectConfig(clone(input), task), undefined, task)
    }
  }
  for (const [section, key, accepted] of [
    ['code', 'check-command', ['docs', 'release', 'recovery', 'deploy']],
    ['npm', 'verify-command', ['code', 'docs', 'recovery', 'deploy']],
    ['docs', 'check-command', ['code', 'deploy']],
    ['docs', 'build-command', ['code', 'deploy']],
    ['docs', 'site-directory', ['code', 'deploy']],
  ]) {
    const input = sampleConfig()
    delete input[section][key]
    for (const task of tasks) {
      if (accepted.includes(task)) assert.doesNotThrow(() => parseProjectConfig(clone(input), task), section + '.' + key + ' / ' + task)
      else assert.throws(() => parseProjectConfig(clone(input), task), new RegExp('Required project setting: ' + section + '\.' + key))
    }
  }
  for (const task of tasks) {
    const config = sampleConfig()
    // Irrelevant sections still reject malformed values and unknown fields.
    config.code['check-command'] = ''
    assert.throws(() => parseProjectConfig(clone(config), task), /Invalid project configuration/)
    config.code = { 'check-command': 'npm test' }
    config.npm['verify-command'] = null
    assert.throws(() => parseProjectConfig(clone(config), task), /Invalid project configuration/)
  }
})

test('dependency caches are explicit, strict and inherited or replaced for documentation', () => {
  const input = sampleConfig()
  input.setup.cache = { npm: 'pnpm-lock.yaml', pnpm: 'pnpm-lock.yaml', uv: 'tests/skills/uv.lock' }
  for (const task of tasks) {
    const parsed = parseProjectConfig(clone(input), task)
    assert.deepEqual(parsed.docs.cache, input.setup.cache)
    parsed.docs.cache.uv = ''
    assert.equal(parsed.setup.cache.uv, 'tests/skills/uv.lock')
    assert.deepEqual(parseProjectConfig({ ...clone(input), docs: { ...input.docs, cache: { pnpm: 'pnpm-lock.yaml' } } }, task).docs.cache,
      { npm: '', pnpm: 'pnpm-lock.yaml', uv: '' })
    assert.deepEqual(parseProjectConfig({ ...clone(input), docs: { ...input.docs, cache: {} } }, task).docs.cache,
      { npm: '', pnpm: '', uv: '' })
    for (const section of ['setup', 'docs']) {
      for (const cache of [null, [], ['pnpm-lock.yaml'], 'pnpm', { unknown: 'lock' }, { npm: false }, { pnpm: ' ' }, { uv: 'a\nb' }]) {
        const invalid = clone(input)
        invalid[section].cache = cache
        assert.throws(() => parseProjectConfig(invalid, task), /Invalid project configuration/)
      }
    }
  }
})

test('diagnostics report the setting path without exposing rejected values', () => {
  const secret = 'fixture-sensitive-value'
  for (const input of [
    { schemaVersion: 1, setup: { toolchain: secret } },
    { schemaVersion: 1, code: { 'check-command': secret + '\ninvalid' } },
    { schemaVersion: 1, docs: { provider: secret } },
  ]) {
    assert.throws(() => parseProjectConfig(input, 'code'), error => {
      assert.match(error.message, /Invalid project configuration at \//)
      assert.ok(!error.message.includes(secret))
      return true
    })
  }
})

test('the actual npm/docs and Matrix example configurations remain usable in their intended paths', () => {
  const docs = JSON.parse(readFileSync(join(root, 'examples/project/xova.json'), 'utf8'))
  for (const task of ['code', 'docs']) assert.doesNotThrow(() => parseProjectConfig(clone(docs), task))
  const matrix = JSON.parse(readFileSync(join(root, 'examples/matrix/xova.json'), 'utf8'))
  for (const task of ['code', 'docs', 'release', 'recovery', 'deploy']) {
    const result = parseProjectConfig(clone(matrix), task)
    assert.equal(result.setup.toolchain, 'mise')
    assert.equal(result.npm['package-manager'], 'pnpm')
    assert.equal(result.docs['concurrency-group'], 'github-pages')
  }
})
