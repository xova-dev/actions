import assert from 'node:assert/strict'
import { cpSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { validate } from '../lib/docs.mjs'
import { check } from './check.mjs'
import { action, fixture, output, root, runStep, workflow } from './helpers.mjs'

const e = value => '$' + '{{ ' + value + ' }}'

function assertReadOnlyBoundary(ci, shared, definition, setup = action('setup')) {
  assert.deepEqual(ci.permissions, { contents: 'read' })
  assert.deepEqual(shared.permissions, { contents: 'read' })
  assert.equal(ci.env, undefined)
  assert.equal(shared.env, undefined)
  const allowed = new Set(['actions/checkout', 'actions/setup-node', 'jdx/mise-action', 'actions/upload-artifact', 'actions/download-artifact'])
  const local = { 'docs-build': definition, setup, 'project-config': action('project-config'), 'check-source': action('check-source') }
  function inspect(steps) {
    for (const step of steps) {
      if (!step.uses) continue
      if (step.uses.startsWith('$/actions/')) {
        const dependency = local[step.uses.slice('$/actions/'.length)]
        assert.ok(dependency, 'Unexpected local action in CI integration: ' + step.uses)
        assert.equal(dependency.runs.using, 'composite')
        inspect(dependency.runs.steps)
      } else assert.ok(allowed.has(step.uses.split('@')[0]), 'Unexpected action in CI integration: ' + step.uses)
    }
  }
  for (const kind of ['code', 'docs']) {
    assert.equal(ci.jobs[kind].uses, './.github/workflows/check.yml')
    assert.equal(ci.jobs[kind].needs, undefined)
  }
  for (const job of [ci.jobs.code, ci.jobs.docs, ci.jobs.verify, ...Object.values(shared.jobs)]) {
    assert.equal(job.environment, undefined)
    assert.equal(job.secrets, undefined)
    assert.equal(job.env, undefined)
    assert.equal(job['continue-on-error'], undefined)
    if (job.permissions) assert.deepEqual(job.permissions, { contents: 'read' })
    inspect(job.steps || [])
  }
}

test('CI runs code/docs checks in parallel and verifies both outputs and the downloaded artifact', () => {
  const ci = workflow('ci')
  assert.deepEqual(Object.keys(ci.jobs), ['check', 'code', 'docs', 'verify'])
  assert.equal(ci.jobs.check.needs, undefined)
  for (const kind of ['code', 'docs']) {
    assert.equal(ci.jobs[kind].with.kind, kind)
    assert.equal(ci.jobs[kind].with['source-sha'], e('github.sha'))
    assert.equal(ci.jobs[kind].with['config-file'], ci.jobs.docs.with['config-file'])
  }
  const config = JSON.parse(readFileSync(join(root, ci.jobs.code.with['config-file']), 'utf8'))
  assert.equal(config.setup['install-command'], ':')
  assert.equal(config.npm, undefined)
  const verify = ci.jobs.verify
  assert.deepEqual(verify.needs, ['code', 'docs'])
  assert.equal(verify.if, undefined, 'Failed or skipped producers must not reach verification')
  assert.equal(verify.steps.find(step => step.uses?.startsWith('actions/download-artifact@')).with.name, action('docs-build').inputs['artifact-name'].default)
  assert.deepEqual(verify.steps.at(-1).env, {
    CODE_SOURCE_SHA: e('needs.code.outputs.source-sha'), CODE_CHANGED: e('needs.code.outputs.code-changed'),
    DOCS_SOURCE_SHA: e('needs.docs.outputs.source-sha'), ARTIFACT_DIRECTORY: e('steps.download.outputs.download-path'),
  })
  assert.equal(verify.steps.at(-1).run, 'node test/verify-workflows.mjs')
  assertReadOnlyBoundary(ci, workflow('check'), action('docs-build'))
})

test('CI integration rejects nested publishers, elevated grants and production environments', () => {
  for (const mutate of [
    ({ definition }) => definition.runs.steps.push({ uses: '$/actions/npm-publish' }),
    ({ shared }) => { shared.jobs.check.permissions = { contents: 'write' } },
    ({ shared }) => { shared.jobs.check.steps.push({ uses: './.github/workflows/release.yml' }) },
    ({ setup }) => { setup.runs.steps.push({ uses: '$/actions/npm-publish' }) },
    ({ ci }) => { ci.jobs.code.permissions = { 'id-token': 'write' } },
    ({ ci }) => { ci.jobs.docs.environment = 'production' },
    ({ ci }) => { ci.jobs.verify.environment = 'production' },
  ]) {
    const graph = { ci: workflow('ci'), shared: workflow('check'), definition: action('docs-build'), setup: action('setup') }
    mutate(graph)
    assert.throws(() => assertReadOnlyBoundary(graph.ci, graph.shared, graph.definition, graph.setup))
  }
})

function project(t) {
  const value = fixture(t)
  for (const directory of ['docs-only', 'project'])
    cpSync(join(root, 'examples', directory), join(value.cwd, 'examples', directory), { recursive: true })
  for (const file of ['source.mjs', 'check.test.mjs'])
    value.write('examples/npm-package/' + file, readFileSync(join(root, 'examples/npm-package', file), 'utf8'))
  value.write('test/verify-workflows.mjs', readFileSync(join(root, 'test/verify-workflows.mjs'), 'utf8'))
  symlinkSync(join(root, 'lib'), join(value.cwd, 'lib'), 'dir')
  value.commit('test: configure workflow integration')
  return value
}

function runPaths(project) {
  const ci = workflow('ci')
  const sha = project.git('rev-parse', 'HEAD')
  const code = check(project, { ...ci.jobs.code.with, 'source-sha': sha }, uses => {
    assert.doesNotMatch(uses, /upload-artifact/, 'The code path uploaded a documentation artifact')
    return {}
  })
  assert.equal(code.status, 0, code.logs)
  let artifact
  const docs = check(project, { ...ci.jobs.docs.with, 'source-sha': sha }, (uses, values) => {
    if (uses.startsWith('actions/upload-artifact@')) {
      assert.equal(values['include-hidden-files'], 'true')
      assert.equal(artifact, undefined, 'The docs path uploaded more than one artifact')
      artifact = values.path
    }
    return {}
  })
  assert.equal(docs.status, 0, docs.logs)
  assert.ok(artifact)
  return { CODE_SOURCE_SHA: code.outputs['source-sha'], CODE_CHANGED: code.outputs['code-changed'], DOCS_SOURCE_SHA: docs.outputs['source-sha'], GITHUB_SHA: sha, ARTIFACT_DIRECTORY: artifact }
}

test('the shared code path runs the existing npm assertions and rejects a wrong exported value', t => {
  const value = project(t)
  value.write('examples/npm-package/source.mjs', 'export const answer = 41\n')
  const sha = value.commit('test: break the example export')
  const failed = check(value, { ...workflow('ci').jobs.code.with, 'source-sha': sha })
  assert.notEqual(failed.status, 0, failed.logs)
  assert.match(failed.logs, /the package exposes its answer/)
  assert.match(failed.logs, /AssertionError/)
  assert.deepEqual(failed.outputs, {})
})

test('the shared CI verifier accepts real workflow outputs and rejects missing/wrong receipts and altered artifacts', t => {
  const value = project(t)
  const env = runPaths(value)
  const run = workflow('ci').jobs.verify.steps.at(-1).run
  const verified = runStep(run, value.cwd, env)
  assert.equal(verified.status, 0, output(verified))
  for (const changed of [
    { CODE_SOURCE_SHA: '' }, { CODE_SOURCE_SHA: 'b'.repeat(40) },
    { CODE_CHANGED: '' }, { CODE_CHANGED: 'false' },
    { DOCS_SOURCE_SHA: '' }, { DOCS_SOURCE_SHA: 'b'.repeat(40) },
    { GITHUB_SHA: '' }, { GITHUB_SHA: 'invalid' }, { GITHUB_REPOSITORY: 'other/project' },
  ]) {
    const rejected = runStep(run, value.cwd, { ...env, ...changed })
    assert.notEqual(rejected.status, 0, JSON.stringify(changed))
  }
  const metadataPath = join(env.ARTIFACT_DIRECTORY, 'source.json')
  const metadata = readFileSync(metadataPath, 'utf8')
  writeFileSync(metadataPath, JSON.stringify({ ...JSON.parse(metadata), sha: 'b'.repeat(40) }))
  assert.notEqual(runStep(run, value.cwd, env).status, 0)
  writeFileSync(metadataPath, metadata)
  writeFileSync(join(env.ARTIFACT_DIRECTORY, 'site/.well-known/security.txt'), 'changed hidden bytes')
  const changed = runStep(run, value.cwd, env)
  assert.notEqual(changed.status, 0)
  assert.match(output(changed), /digest/)
})

test('the verifier also rejects unexpected HTML and hidden content with valid artifact digests', t => {
  for (const [before, after] of [['Documentation', 'Unexpected'], ['security@example.invalid', 'other@example.invalid']]) {
    const value = project(t)
    const builder = 'examples/docs-only/build.mjs'
    value.write(builder, readFileSync(join(value.cwd, builder), 'utf8').replaceAll(before, after))
    value.commit('test: produce unexpected documentation')
    const env = runPaths(value)
    assert.doesNotThrow(() => validate({ ...env, EXPECTED_SHA: env.GITHUB_SHA, GITHUB_REPOSITORY: 'fixture/project' }))
    assert.notEqual(runStep(workflow('ci').jobs.verify.steps.at(-1).run, value.cwd, env).status, 0)
  }
})
