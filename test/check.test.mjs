import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { check } from './check.mjs'
import { fixture, root, workflow } from './helpers.mjs'

function configured(t, mutate = () => {}) {
  const project = fixture(t)
  const config = { schemaVersion: 1, setup: { 'install-command': ':' }, code: { 'check-command': 'node --check source.js' }, docs: { 'check-command': 'node --check source.js', 'build-command': 'mkdir -p site/.well-known && cp source.js site/index.html && cp source.js site/.well-known/metadata', 'site-directory': 'site' } }
  mutate(config)
  project.write('.github/xova.json', config)
  project.commit('chore: configure checks')
  return project
}

test('release, recovery and standalone documentation use one config-driven build with explicit artifact settings', t => {
  for (const name of ['release', 'docs-recover']) {
    const call = workflow(name).jobs.documentation
    assert.equal(call.uses, './.github/workflows/check.yml')
    assert.equal(call.with.kind, 'docs')
    for (const key of ['config-file', 'artifact-name', 'retention-days']) assert.match(call.with[key], new RegExp('inputs.' + key))
  }
  const project = configured(t)
  const uploads = []
  const built = check(project, { kind: 'docs', 'artifact-name': 'docs-api', 'retention-days': 3 }, (uses, inputs) => {
    if (uses.startsWith('actions/upload-artifact@')) uploads.push(inputs)
    return {}
  })
  assert.equal(built.status, 0, built.logs)
  assert.equal(built.outputs['source-sha'], project.git('rev-parse', 'HEAD'))
  assert.equal(uploads.length, 1)
  assert.equal(uploads[0].name, 'docs-api')
  assert.equal(uploads[0]['retention-days'], '3')
  assert.equal(uploads[0]['include-hidden-files'], 'true')
  assert.match(readFileSync(join(uploads[0].path, 'site/.well-known/metadata'), 'utf8'), /answer/)
})

test('the shared check job stops invalid configuration, installation/check failures and changed sources before success', t => {
  for (const [name, mutate, kind] of [
    ['invalid configuration', config => { config.unknown = true }, 'docs'],
    ['installation failure', config => { config.setup['install-command'] = 'exit 17' }, 'docs'],
    ['dirty installation', config => { config.setup['install-command'] = 'printf changed > source.js' }, 'docs'],
    ['documentation failure', config => { config.docs['check-command'] = 'exit 18' }, 'docs'],
    ['dirty documentation', config => { config.docs['build-command'] = 'mkdir site && cp source.js site/index.html && printf changed > source.js' }, 'docs'],
    ['code failure', config => { config.code['check-command'] = 'exit 19' }, 'code'],
    ['dirty code', config => { config.code['check-command'] = 'printf changed > source.js' }, 'code'],
  ]) {
    const project = configured(t, mutate)
    const result = check(project, { kind }, uses => { assert.doesNotMatch(uses, /upload-artifact/, name); return {} })
    assert.notEqual(result.status, 0, name)
    assert.deepEqual(result.outputs, {}, name)
  }
  const wrongSource = configured(t)
  assert.notEqual(check(wrongSource, { 'source-sha': 'b'.repeat(40) }).status, 0)
  assert.equal(existsSync(join(wrongSource.cwd, 'site')), false)
  for (const file of ['', ' ', 'missing.json']) {
    const project = configured(t, config => { config.setup['install-command'] = 'touch install-ran' })
    const rejected = check(project, { kind: 'docs', 'config-file': file })
    assert.notEqual(rejected.status, 0)
    assert.deepEqual(rejected.outputs, {})
    assert.equal(existsSync(join(project.cwd, 'install-ran')), false)
  }
})

test('code and docs checks accept incomplete commands belonging only to other tasks', t => {
  const code = configured(t, config => {
    config.npm = {}
    config.docs = { provider: 'pages' }
  })
  const checked = check(code, { kind: 'code' })
  assert.equal(checked.status, 0, checked.logs)
  assert.equal(checked.outputs['source-sha'], code.git('rev-parse', 'HEAD'))
  const docs = configured(t, config => {
    config.code = {}
    config.npm = {}
  })
  const built = check(docs, { kind: 'docs' })
  assert.equal(built.status, 0, built.logs)
  assert.equal(built.outputs['source-sha'], docs.git('rev-parse', 'HEAD'))
})

test('independent source guards reject installation and command mutations before successful outputs', t => {
  const mutations = [
    'printf changed > source.js',
    'printf changed > source.js && git add source.js && git restore --worktree source.js',
    'git -c commit.gpgsign=false commit --allow-empty -qm fixture',
  ]
  for (const kind of ['code', 'docs']) {
    for (const mutate of mutations) {
      const installed = configured(t, config => {
        config.setup['install-command'] = mutate
        config.code['check-command'] = 'touch check-ran && git restore source.js'
        config.docs['check-command'] = 'touch check-ran && git restore source.js'
      })
      const stopped = check(installed, { kind }, uses => { assert.doesNotMatch(uses, /upload-artifact/); return {} })
      assert.notEqual(stopped.status, 0, kind + ' / installation / ' + mutate)
      assert.deepEqual(stopped.outputs, {})
      assert.equal(existsSync(join(installed.cwd, 'check-ran')), false)
      const checked = configured(t, config => { config[kind]['check-command'] = mutate })
      const rejected = check(checked, { kind }, uses => { assert.doesNotMatch(uses, /upload-artifact/); return {} })
      assert.notEqual(rejected.status, 0, kind + ' / check / ' + mutate)
      assert.deepEqual(rejected.outputs, {})
    }
  }
  const project = configured(t)
  const changedAfterUpload = check(project, { kind: 'docs' }, uses => {
    if (uses.startsWith('actions/upload-artifact@')) project.write('.github/xova.json', '{}')
    return {}
  })
  assert.notEqual(changedAfterUpload.status, 0, changedAfterUpload.logs)
  assert.deepEqual(changedAfterUpload.outputs, {})
})

test('standard workflows expose only configuration and runtime selectors', () => {
  const contracts = {
    check: ['kind', 'config-file', 'source-sha', 'detect-changes', 'artifact-name', 'retention-days'],
    release: ['config-file', 'release-tag', 'expected-sha', 'artifact-name', 'retention-days', 'deploy-docs'],
    'docs-recover': ['config-file', 'release-tag', 'published-sha', 'artifact-name', 'retention-days'],
    'docs-deploy': ['config-file', 'expected-sha', 'release-tag', 'artifact-name'],
  }
  for (const [name, keys] of Object.entries(contracts)) {
    assert.deepEqual(Object.keys(workflow(name).on.workflow_call.inputs), keys)
    assert.equal(workflow(name).on.workflow_call.inputs['config-file'].default, '.github/xova.json')
  }
  assert.deepEqual(readdirSync(join(root, '.github/workflows')).filter(name => /\.ya?ml$/.test(name)).sort(), [...Object.keys(contracts).map(name => name + '.yml'), 'ci.yml'].sort())
  const publish = workflow('release').jobs.publish
  assert.deepEqual(publish.permissions, { contents: 'read', 'id-token': 'write' })
  assert.match(publish.environment, /config\).npm.environment-name/)
  assert.equal(publish.concurrency['cancel-in-progress'], false)
  for (const name of ['release', 'docs-recover']) {
    for (const id of ['source', 'documentation']) assert.deepEqual(workflow(name).jobs[id].permissions, { contents: 'read' })
  }
})
