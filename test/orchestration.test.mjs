import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { composite } from './composite.mjs'
import { action, fixture, output, runStep, workflow } from './helpers.mjs'

const e = value => '$' + '{{ ' + value + ' }}'
const eligible = "fromJSON(needs.validate.outputs.config).docs.deployment-policy == 'always' || steps.policy.outputs.eligible == 'true'"

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
  const expression = release.jobs.publish.if.slice(3, -2).replaceAll('needs.source.outputs.docs-provider', 'inputs.provider')
  // Only this status expression uses the same boolean/comparison operators in JS and Actions.
  const permitted = Function('needs', 'inputs', 'cancelled', 'return (' + expression + ')')
  const check = (source, documentation, provider, cancelled = false) => permitted({ source: { result: source }, documentation: { result: documentation } }, { provider }, () => cancelled)
  assert.equal(check('success', 'skipped', 'none'), true)
  assert.equal(check('success', 'success', 'pages'), true)
  for (const args of [['failure', 'skipped', 'none'], ['cancelled', 'success', 'pages'], ['success', 'failure', 'pages'], ['success', 'skipped', 'pages'], ['success', 'success', 'pages', true]])
    assert.equal(check(...args), false, args.join('/'))
  assert.equal(release.jobs.documentation.with['source-sha'], e('needs.source.outputs.source-sha'))
  assert.equal(release.jobs.publish.steps.at(-1).with['expected-sha'], e('needs.source.outputs.source-sha'))
  assert.deepEqual(release.jobs.deploy.needs, ['source', 'documentation', 'publish'])
  assert.equal(release.jobs.deploy.with['expected-sha'], e('needs.source.outputs.source-sha'))
})

function recoveryGraph() {
  return {
    workflows: Object.fromEntries(['docs-recover', 'check', 'docs-deploy'].map(name => [name, workflow(name)])),
    actions: Object.fromEntries(['release-source', 'project-config', 'check-source', 'setup', 'docs-build', 'latest-release', 'docs-pages', 'docs-cloudflare'].map(name => [name, action(name)])),
  }
}

function assertRecoveryBoundary(graph) {
  const visited = new Set()
  const hosted = new Set(['actions/checkout', 'actions/setup-node', 'jdx/mise-action', 'actions/upload-artifact', 'actions/download-artifact', 'actions/configure-pages', 'actions/upload-pages-artifact', 'actions/deploy-pages'])
  function steps(items) {
    for (const step of items) {
      if (!step.uses) continue
      if (step.uses.startsWith('$/actions/')) {
        const name = step.uses.slice('$/actions/'.length)
        assert.ok(graph.actions[name], 'Unexpected recovery action: ' + name)
        if (visited.has('action:' + name)) continue
        visited.add('action:' + name)
        steps(graph.actions[name].runs.steps)
      } else assert.ok(hosted.has(step.uses.split('@')[0]), 'Unexpected recovery dependency: ' + step.uses)
    }
  }
  function visit(name) {
    assert.ok(graph.workflows[name], 'Unexpected recovery workflow: ' + name)
    if (visited.has(name)) return
    visited.add(name)
    const definition = graph.workflows[name]
    for (const [id, job] of Object.entries(definition.jobs)) {
      assert.equal(job['continue-on-error'], undefined)
      if (['source', 'documentation', 'check', 'validate'].includes(id)) {
        assert.deepEqual(job.permissions || definition.permissions, { contents: 'read' })
        assert.equal(job.environment, undefined)
        assert.equal(job.secrets, undefined)
      }
      if (job.uses) {
        assert.match(job.uses, /^\.\/\.github\/workflows\//)
        visit(job.uses.split('/').at(-1).replace('.yml', ''))
      }
      steps(job.steps || [])
    }
  }
  visit('docs-recover')
}

test('the recovery graph rebuilds the confirmed source without reaching publication through workflows or composites', () => {
  assertRecoveryBoundary(recoveryGraph())
  const recovery = workflow('docs-recover')
  assert.equal(recovery.jobs.source.steps.at(-1).with.mode, 'recovery')
  assert.equal(recovery.jobs.source.steps.at(-1).with['expected-sha'], e('inputs.published-sha'))
  assert.equal(recovery.jobs.documentation.needs, 'source')
  assert.equal(recovery.jobs.documentation.with['source-sha'], e('needs.source.outputs.source-sha'))
  assert.equal(recovery.jobs.deploy.uses, workflow('release').jobs.deploy.uses)
})

test('recovery boundary rejects hidden publishers and elevated build/source grants', () => {
  for (const mutate of [
    graph => { graph.workflows['docs-recover'].jobs.documentation.uses = './.github/workflows/release.yml' },
    graph => { graph.actions.setup.runs.steps.push({ uses: '$/actions/npm-publish' }) },
    graph => { graph.actions['docs-build'].runs.steps.push({ uses: '$/actions/npm-publish' }) },
    graph => { graph.actions['check-source'].runs.steps.push({ uses: '$/actions/npm-publish' }) },
    graph => { graph.workflows['docs-recover'].jobs.source.permissions['id-token'] = 'write' },
    graph => { graph.workflows.check.permissions.contents = 'write' },
    graph => { graph.workflows['docs-recover'].jobs.documentation.environment = 'npm-publish' },
  ]) {
    const graph = recoveryGraph()
    mutate(graph)
    assert.throws(() => assertRecoveryBoundary(graph))
  }
})

test('deployment requires a tracked valid provider and a tag for stable policy before selecting a platform', t => {
  const run = workflow('docs-deploy').jobs.validate.steps.find(step => step.name === 'Require a release for stable deployment policy').run
  for (const [provider, policy, tag, accepted] of [
    ['pages', 'always', '', true], ['cloudflare', 'latest-stable', 'v0.1.0', true],
    ['pages', 'latest-stable', '', false], ['none', 'always', '', false],
    ['typo', 'always', '', false], ['pages', 'typo', 'v0.1.0', false],
  ]) {
    const project = fixture(t)
    project.write('.github/xova.json', { schemaVersion: 1, docs: { provider, 'deployment-policy': policy, 'site-directory': 'site' } })
    const sha = project.commit('chore: deployment selection')
    const selected = composite('project-config', project.cwd, { task: 'deploy', 'expected-sha': sha })
    const result = selected.status === 0 ? runStep(run, project.cwd, { POLICY: policy, RELEASE_TAG: tag }) : selected
    assert.equal(result.status === 0, accepted, result.logs || output(result))
  }
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
    assert.match(job.concurrency.group, /docs.concurrency-group/)
    const policy = job.steps.findIndex(step => step.id === 'policy')
    const adapter = job.steps.findIndex(step => step.uses === '$/actions/' + name)
    assert.ok(policy >= 0 && adapter > policy)
    assert.equal(job.steps[policy].if, "fromJSON(needs.validate.outputs.config).docs.deployment-policy == 'latest-stable'")
    assert.equal(job.steps[adapter].if, eligible)
    for (const step of job.steps.filter(step => step.uses?.startsWith('actions/checkout@') || step.uses === '$/actions/setup'))
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
