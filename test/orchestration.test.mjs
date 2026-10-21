import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { composite } from './composite.mjs'
import { fixture, output, runStep, workflow } from './helpers.mjs'

const e = value => '$' + '{{ ' + value + ' }}'
const eligible = "inputs.deployment-policy == 'always' || steps.policy.outputs.eligible == 'true'"

test('source preflight rejects wrong native identity and invalid recovery settings before emitting outputs', t => {
  const project = fixture(t)
  const sha = project.git('rev-parse', 'HEAD')
  const inputs = { 'release-tag': 'v0.1.0', 'expected-sha': sha, 'docs-provider': 'pages' }
  const env = { GITHUB_SHA: sha, GITHUB_REF: 'refs/tags/v0.1.0' }
  for (const mode of ['release', 'recovery']) {
    const accepted = composite('release-source', project.cwd, { ...inputs, mode }, env)
    assert.equal(accepted.status, 0, accepted.logs)
    assert.equal(accepted.outputs['source-sha'], sha)
  }
  for (const [changed, native] of [
    [{}, { GITHUB_REF: 'refs/heads/main' }],
    [{ 'release-tag': 'v0.2.0' }, {}],
    [{ 'expected-sha': 'b'.repeat(40) }, {}],
    [{ mode: 'recovery', 'expected-sha': '' }, {}],
    [{ mode: 'recovery', 'docs-provider': 'none' }, {}],
    [{ 'docs-provider': 'typo' }, {}],
    [{ 'deployment-policy': 'typo' }, {}],
    [{ mode: 'typo' }, {}],
  ]) {
    const rejected = composite('release-source', project.cwd, { ...inputs, ...changed }, { ...env, ...native })
    assert.notEqual(rejected.status, 0, rejected.logs)
    assert.deepEqual(rejected.outputs, {})
  }
})

test('publication waits for successful source and documentation while supporting an npm-only flow', () => {
  const release = workflow('release')
  assert.deepEqual(release.jobs.publish.needs, ['source', 'documentation'])
  const expression = release.jobs.publish.if.slice(3, -2).replaceAll('inputs.docs-provider', 'inputs.provider')
  // Only this status expression uses the same boolean/comparison operators in JS and Actions.
  const permitted = Function('needs', 'inputs', 'cancelled', 'return (' + expression + ')')
  const check = (source, documentation, provider, cancelled = false) => permitted({ source: { result: source }, documentation: { result: documentation } }, { provider }, () => cancelled)
  assert.equal(check('success', 'skipped', 'none'), true)
  assert.equal(check('success', 'success', 'pages'), true)
  for (const args of [['failure', 'skipped', 'none'], ['cancelled', 'success', 'pages'], ['success', 'failure', 'pages'], ['success', 'skipped', 'pages'], ['success', 'success', 'pages', true]])
    assert.equal(check(...args), false, args.join('/'))
  assert.equal(release.jobs.documentation.with['source-ref'], e('needs.source.outputs.source-sha'))
  assert.equal(release.jobs.publish.with['expected-sha'], e('needs.source.outputs.source-sha'))
  assert.deepEqual(release.jobs.deploy.needs, ['source', 'documentation', 'publish'])
  assert.equal(release.jobs.deploy.with['expected-sha'], e('needs.source.outputs.source-sha'))
})

test('the recovery graph rebuilds the confirmed source and contains no npm publication path', () => {
  const visited = new Set()
  function visit(name) {
    assert.ok(!['release', 'npm-publish'].includes(name), 'Recovery reached publication')
    if (visited.has(name)) return
    visited.add(name)
    for (const job of Object.values(workflow(name).jobs)) {
      if (job.uses?.startsWith('./.github/workflows/')) visit(job.uses.split('/').at(-1).replace('.yml', ''))
      for (const step of job.steps || []) assert.notEqual(step.uses, '$/actions/npm-publish')
    }
  }
  visit('docs-recover')
  const recovery = workflow('docs-recover')
  assert.equal(recovery.jobs.source.steps.at(-1).with.mode, 'recovery')
  assert.equal(recovery.jobs.source.steps.at(-1).with['expected-sha'], e('inputs.published-sha'))
  assert.equal(recovery.jobs.documentation.needs, 'source')
  assert.equal(recovery.jobs.documentation.with['source-ref'], e('needs.source.outputs.source-sha'))
  assert.equal(recovery.jobs.deploy.uses, workflow('release').jobs.deploy.uses)
})

test('provider selection rejects unknown values and missing release tags instead of silently skipping', t => {
  const project = fixture(t)
  const run = workflow('docs-deploy').jobs.validate.steps[0].run
  for (const [provider, policy, tag, accepted] of [
    ['pages', 'always', '', true], ['cloudflare', 'latest-stable', 'v0.1.0', true],
    ['pages', 'latest-stable', '', false], ['none', 'always', '', false],
    ['typo', 'always', '', false], ['pages', 'typo', 'v0.1.0', false],
  ]) {
    const result = runStep(run, project.cwd, { PROVIDER: provider, POLICY: policy, RELEASE_TAG: tag, TOOLCHAIN: 'node' })
    assert.equal(result.status === 0, accepted, output(result))
  }
  assert.notEqual(runStep(run, project.cwd, { PROVIDER: 'cloudflare', POLICY: 'always', TOOLCHAIN: 'typo' }).status, 0)
})

test('both providers evaluate latest-stable after their shared environment and concurrency gate', () => {
  const deployment = workflow('docs-deploy')
  assert.equal(deployment.jobs.pages.permissions, undefined, 'Pages must inherit caller grants without requiring them for Cloudflare calls')
  assert.deepEqual(deployment.jobs.cloudflare.permissions, { contents: 'read' })
  for (const provider of ['pages', 'cloudflare']) {
    const name = 'docs-' + provider
    const job = deployment.jobs[provider]
    assert.ok(job.environment)
    assert.equal(job.concurrency['cancel-in-progress'], false)
    assert.match(job.concurrency.group, /inputs.concurrency-group/)
    const policy = job.steps.findIndex(step => step.id === 'policy')
    const adapter = job.steps.findIndex(step => step.uses === '$/actions/' + name)
    assert.ok(policy >= 0 && adapter > policy)
    assert.equal(job.steps[policy].if, "inputs.deployment-policy == 'latest-stable'")
    assert.equal(job.steps[adapter].if, eligible)
    for (const step of job.steps.filter(step => step.uses?.startsWith('actions/checkout@') || step.name === 'Install deployment dependencies'))
      assert.equal(step.if, eligible)
  }
})

test('a recovery source builds one new artifact and restores its bytes without an npm package', t => {
  const project = fixture(t)
  project.git('rm', 'package.json')
  const sha = project.commit('docs: documentation-only source')
  project.git('tag', 'docs@1')
  const gated = composite('release-source', project.cwd, { mode: 'recovery', 'release-tag': 'docs@1', 'expected-sha': sha, 'docs-provider': 'pages' }, { GITHUB_SHA: sha, GITHUB_REF: 'refs/tags/docs@1' })
  assert.equal(gated.status, 0, gated.logs)
  project.write('site/index.html', '<h1>Recovered</h1>')
  let artifact
  const built = composite('docs-build', project.cwd, { 'expected-sha': gated.outputs['source-sha'], 'check-command': 'test -f site/index.html', 'build-command': 'true', 'site-directory': 'site' }, {}, (_, inputs) => { artifact = inputs.path; return {} })
  assert.equal(built.status, 0, built.logs)
  const hosted = (uses, inputs) => {
    if (uses.startsWith('actions/download-artifact@')) return { 'download-path': artifact }
    if (uses.startsWith('actions/upload-pages-artifact@')) assert.equal(readFileSync(inputs.path + '/index.html', 'utf8'), '<h1>Recovered</h1>')
    return { page_url: 'https://example.invalid/recovered' }
  }
  assert.equal(composite('docs-pages', project.cwd, { 'expected-sha': sha }, {}, hosted).status, 0)
  writeFileSync(artifact + '/site/index.html', 'tampered')
  assert.notEqual(composite('docs-pages', project.cwd, { 'expected-sha': sha }, {}, hosted).status, 0)
})
