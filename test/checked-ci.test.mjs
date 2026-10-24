import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, test } from 'node:test'
import { parse } from 'yaml'
import { checkedCI } from '../lib/checked-ci.mjs'
import { check } from './check.mjs'
import { composite } from './composite.mjs'
import { action, actionStep, fixture, linkReleaseIt, output, root, runStep, stubNpmPublication, workflow } from './helpers.mjs'

beforeEach(t => { t.mock.method(console, 'log', () => {}) })

const sha = 'a'.repeat(40)
const env = {
  EXPECTED_SHA: sha, GITHUB_SHA: sha, GITHUB_REPOSITORY: 'fixture/project', GITHUB_RUN_ID: '99',
  CI_WORKFLOW: '.github/workflows/ci.yml', CONFIG_FILE: '.github/xova.json', CI_WAIT_SECONDS: '0',
}
const base = 'repos/fixture/project/actions/'
const runsPath = base + 'workflows/ci.yml/runs?head_sha=' + sha + '&per_page=100'
const runPath = base + 'runs/42'
const jobsPath = runPath + '/attempts/1/jobs?per_page=100'
const passedRun = () => ({
  id: 42, run_attempt: 1, head_sha: sha, path: '.github/workflows/ci.yml',
  repository: { full_name: 'fixture/project' }, head_repository: { full_name: 'fixture/project' },
  event: 'push', status: 'completed', conclusion: 'success',
})
const passedJob = () => ({
  run_id: 42, run_attempt: 1, head_sha: sha, status: 'completed', conclusion: 'success',
  steps: [{ name: 'Full code checks (.github/xova.json) at ' + sha, status: 'completed', conclusion: 'success' }],
})
const fresh = { 'source-sha': '', 'run-id': '' }

function responses(overrides = {}) {
  const calls = []
  const values = {
    [runsPath]: [{ workflow_runs: [passedRun()] }],
    [runPath]: passedRun(),
    [jobsPath]: [{ jobs: [passedJob()] }],
    ...overrides,
  }
  const api = (path, paginated = false) => {
    calls.push({ path, paginated })
    assert.ok(path in values, 'Unexpected CI API request: ' + path)
    const value = values[path]
    if (value instanceof Error) throw value
    return structuredClone(typeof value === 'function' ? value() : value)
  }
  return { api, calls }
}

test('complete CI reuses only an exact native source and the successful final code guard', async () => {
  const source = responses()
  assert.deepEqual(await checkedCI(env, source), { 'source-sha': sha, 'run-id': '42' })
  assert.deepEqual(source.calls, [
    { path: runsPath, paginated: true }, { path: runPath, paginated: false },
    { path: jobsPath, paginated: true }, { path: runPath, paginated: false },
  ])
  const manual = passedRun()
  manual.event = 'workflow_dispatch'
  assert.deepEqual(await checkedCI(env, responses({ [runsPath]: [{ workflow_runs: [manual] }], [runPath]: manual })), { 'source-sha': sha, 'run-id': '42' })
})

test('pagination includes all CI jobs and does not hide a failed product matrix', async () => {
  const runs = [{ workflow_runs: [] }, { workflow_runs: [passedRun()] }]
  const jobs = [{ jobs: [{ ...passedJob(), steps: [] }] }, { jobs: [passedJob()] }]
  assert.equal((await checkedCI(env, responses({ [runsPath]: runs, [jobsPath]: jobs })))['source-sha'], sha)
  jobs.push({ jobs: [{ ...passedJob(), conclusion: 'failure', steps: [] }] })
  assert.deepEqual(await checkedCI(env, responses({ [runsPath]: runs, [jobsPath]: jobs })), fresh)
})

test('parent commits, other workflows, forks, PRs and the calling run cannot supply CI evidence', async () => {
  for (const change of [
    { head_sha: 'b'.repeat(40) }, { path: '.github/workflows/other.yml' },
    { repository: { full_name: 'other/project' } }, { head_repository: { full_name: 'fork/project' } },
    { event: 'pull_request' }, { event: 'pull_request_target' }, { event: 'workflow_run' }, { id: 99 },
  ]) {
    const source = responses({ [runsPath]: [{ workflow_runs: [{ ...passedRun(), ...change }] }] })
    assert.deepEqual(await checkedCI(env, source), fresh, JSON.stringify(change))
    assert.equal(source.calls.length, 1)
  }
})

test('green docs-only runs, skipped checks and mismatched configurations require complete checks', async () => {
  for (const job of [
    { ...passedJob(), steps: [] },
    { ...passedJob(), conclusion: 'skipped' },
    { ...passedJob(), status: 'in_progress' },
    { ...passedJob(), head_sha: 'b'.repeat(40) },
    { ...passedJob(), run_id: 41 },
    { ...passedJob(), run_attempt: 2 },
    ...[
      { name: 'Confirm checked source' },
      { name: 'Full code checks (other.json) at ' + sha },
      { name: 'Full code checks (.github/xova.json) at ' + 'b'.repeat(40) },
      { status: 'in_progress' }, { conclusion: 'skipped' }, { conclusion: 'failure' },
    ].map(change => ({ ...passedJob(), steps: [{ ...passedJob().steps[0], ...change }] })),
  ]) assert.deepEqual(await checkedCI(env, responses({ [jobsPath]: [{ jobs: [job] }] })), fresh, JSON.stringify(job))
})

test('the newest matching CI run must succeed; old successful attempts do not override failures', async () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'action_required', 'skipped', null]) {
    const source = responses({
      [runsPath]: [{ workflow_runs: [{ ...passedRun(), id: 41 }, passedRun()] }],
      [runPath]: { ...passedRun(), conclusion },
    })
    assert.deepEqual(await checkedCI(env, source), fresh, conclusion)
    assert.equal(source.calls.some(call => call.path.includes('/jobs')), false)
  }
  assert.deepEqual(await checkedCI(env, responses({ [runsPath]: [{ workflow_runs: [] }] })), fresh)
})

test('run-attempt evidence is checked again before reuse and cannot survive a concurrent rerun', async () => {
  const attempt2 = { ...passedRun(), run_attempt: 2 }
  const source = responses({
    [runPath]: attempt2,
    [runPath + '/attempts/2/jobs?per_page=100']: [{ jobs: [{ ...passedJob(), steps: [] }] }],
  })
  assert.deepEqual(await checkedCI(env, source), fresh)
  assert.equal(source.calls.some(call => call.path === jobsPath), false)
  const secondAttemptJobs = runPath + '/attempts/2/jobs?per_page=100'
  assert.equal((await checkedCI(env, responses({ [runPath]: attempt2, [secondAttemptJobs]: [{ jobs: [{ ...passedJob(), run_attempt: 2 }] }] })))['source-sha'], sha)
  assert.deepEqual(await checkedCI(env, responses({ [runPath]: attempt2, [secondAttemptJobs]: [{ jobs: [passedJob()] }] })), fresh)
  for (const change of [
    { run_attempt: 2 }, { status: 'queued', conclusion: null }, { conclusion: 'failure' },
    { head_sha: 'b'.repeat(40) }, { id: 43 },
  ]) {
    let reads = 0
    assert.deepEqual(await checkedCI(env, responses({ [runPath]: () => ++reads === 1 ? passedRun() : { ...passedRun(), ...change } })), fresh)
  }
})

test('pending CI is awaited within a bounded clock and otherwise falls back to fresh checks', async () => {
  let time = 0
  const waits = []
  const pending = { ...passedRun(), status: 'in_progress', conclusion: null }
  const source = responses({ [runPath]: () => time === 0 ? pending : passedRun() })
  const clock = { now: () => time, sleep: async milliseconds => { waits.push(milliseconds); time += milliseconds } }
  assert.equal((await checkedCI({ ...env, CI_WAIT_SECONDS: '20' }, { ...source, ...clock }))['source-sha'], sha)
  assert.deepEqual(waits, [15000])
  for (const status of ['queued', 'in_progress', 'waiting', 'requested', 'pending', 'unknown']) {
    time = 0
    waits.length = 0
    const source = responses({ [runPath]: { ...pending, status } })
    assert.deepEqual(await checkedCI({ ...env, CI_WAIT_SECONDS: '2' }, { ...source, ...clock }), fresh)
    assert.match(console.log.mock.calls.at(-1).arguments[0], /^::warning::/)
    assert.ok(time <= 2000)
    assert.deepEqual(await checkedCI(env, { ...source, ...clock, sleep: () => assert.fail('Zero wait slept') }), fresh)
  }
})

test('API permission, transport and incomplete-response errors never grant reuse', async () => {
  for (const path of [runsPath, runPath, jobsPath]) {
    for (const value of [new Error('HTTP 403'), new Error('HTTP 404'), new Error('timeout'), null, {}])
      assert.deepEqual(await checkedCI(env, responses({ [path]: value })), fresh)
  }
  await checkedCI(env, responses({ [runsPath]: new Error('HTTP 403') }))
  assert.match(console.log.mock.calls.at(-1).arguments[0], /^::warning::/)
  for (const pages of [[], [{ jobs: [] }], [{ jobs: [passedJob()] }, {}]])
    assert.deepEqual(await checkedCI(env, responses({ [jobsPath]: pages })), fresh)
})

test('invalid native sources and selectors stop before any CI API calls', async () => {
  for (const change of [
    { EXPECTED_SHA: '' }, { GITHUB_SHA: 'b'.repeat(40) }, { GITHUB_REPOSITORY: '../other' },
    { CI_WORKFLOW: 'ci.yml' }, { CI_WORKFLOW: '.github/workflows/../ci.yml' },
    { CONFIG_FILE: '' }, { CONFIG_FILE: '../config.json' }, { CONFIG_FILE: 'config\n.json' },
    { CI_WAIT_SECONDS: '-1' }, { CI_WAIT_SECONDS: '1.5' }, { CI_WAIT_SECONDS: '1801' },
  ]) await assert.rejects(checkedCI({ ...env, ...change }, { api: () => assert.fail('Invalid input called GitHub') }), { code: 'INVALID_CI_INPUT' })
})

test('the shipped final guard distinguishes real complete checks from docs-only checks and failed checks', t => {
  const project = fixture(t)
  project.write('.github/xova.json', {
    schemaVersion: 1, setup: { 'install-command': ':' },
    code: { 'check-command': 'node --check source.js', 'docs-only-command': ':', 'docs-only-paths': ['docs/**'] },
  })
  const base = project.commit('chore: configure')
  project.write('docs/guide.md', 'Only documentation changed.')
  const source = project.commit('chore(release): candidate with documentation')
  const complete = check(project)
  assert.equal(complete.status, 0, complete.logs)
  assert.equal(complete.steps.at(-1).name, 'Full code checks (.github/xova.json) at ' + source)
  const reduced = check(project, { 'detect-changes': true }, undefined, { event_name: 'push', ref: 'refs/heads/main', event: { before: base } })
  assert.equal(reduced.status, 0, reduced.logs)
  assert.equal(reduced.outputs['code-changed'], 'false')
  assert.equal(reduced.steps.at(-1).name, 'Confirm checked source')
  project.write('source.js', 'invalid javascript {')
  project.commit('test: failing source')
  assert.notEqual(check(project).status, 0)
  assert.equal(workflow('check').jobs.check.steps.at(-1).uses, '$/actions/check-source')
})

test('the public action awaits the CLI result without toolkit dependencies or remote writes', t => {
  const project = fixture(t)
  project.write('api-responses.json', {
    [runsPath]: [{ workflow_runs: [passedRun()] }], [runPath]: passedRun(), [jobsPath]: [{ jobs: [passedJob()] }],
  })
  project.write('bin/gh.cjs', '#!' + process.execPath + '\n' + [
    "const fs = require('node:fs');",
    "const args = process.argv.slice(2);",
    "if (args[0] !== 'api') process.exit(90);",
    "fs.appendFileSync(process.env.API_CALLS, JSON.stringify(args) + '\\n');",
    "const data = JSON.parse(fs.readFileSync(process.env.API_RESPONSES))[args[1]];",
    "if (!data) process.exit(91);",
    "console.log(JSON.stringify(data));",
  ].join('\n'))
  chmodSync(join(project.cwd, 'bin/gh.cjs'), 0o755)
  symlinkSync('gh.cjs', join(project.cwd, 'bin/gh'))
  const result = composite('checked-ci', project.cwd, { 'expected-sha': sha, 'wait-seconds': '0' }, {
    GITHUB_SHA: sha, GITHUB_RUN_ID: '99', PATH: join(project.cwd, 'bin') + ':' + process.env.PATH,
    API_CALLS: join(project.cwd, 'calls'), API_RESPONSES: join(project.cwd, 'api-responses.json'),
  })
  assert.equal(result.status, 0, result.logs)
  assert.deepEqual(result.outputs, { 'source-sha': sha, 'run-id': '42', 'input-error': 'false' })
  const calls = readFileSync(join(project.cwd, 'calls'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(calls[0], ['api', runsPath, '--paginate', '--slurp'])
  assert.deepEqual(calls[2], ['api', jobsPath, '--paginate', '--slurp'])
})

// Model the shipped jobs' direct dependencies and GitHub's implicit success().
// Host cancellation/results remain an external scheduling boundary.
function jobExpression(job, value, results, cancelled = false, source = sha, steps = {}) {
  if (typeof value !== 'string') return value
  const needs = Object.fromEntries([job.needs || []].flat().map(id => [id, results[id]]))
  const expression = value.replace(/^\$\{\{\s*|\s*\}\}$/g, '')
  const success = () => Object.values(needs).every(job => job.result === 'success')
  return Function('needs', 'github', 'cancelled', 'success', 'failure', 'always', 'steps', 'return (' + expression
    .replace(/'[^']*'|\.([\w-]+)/g, (match, key) => key ? '["' + key + '"]' : match) + ')')(
    needs, { sha: source }, () => cancelled, success, () => Object.values(needs).some(job => job.result === 'failure'), () => true, steps)
}

function jobAllowed(job, results, cancelled = false, source = sha) {
  const expression = job.if || 'true'
  const hasStatusCheck = /\b(success|failure|cancelled|always)\s*\(/.test(expression.replace(/'[^']*'/g, ''))
  if (!hasStatusCheck && ![job.needs || []].flat().every(id => results[id].result === 'success')) return false
  return jobExpression(job, expression, results, cancelled, source)
}

// Model only failure aggregation, not GitHub's scheduler or cancellation policy.
function hasUntoleratedFailure(definition, results, source = sha) {
  return Object.entries(results).some(([id, result]) => result.result === 'failure'
    && !jobExpression(definition.jobs[id], definition.jobs[id]['continue-on-error'] ?? false, results, false, source))
}

test('consumer publication uses complete CI or successful full fallback and preserves tarball verification', () => {
  for (const [directory, id] of [['rsp', 'check'], ['matrix', 'checks']]) {
    const definition = parse(readFileSync(join(root, 'examples', directory, 'publish.yml'), 'utf8'))
    const { ci, release } = definition.jobs
    const fallback = definition.jobs[id]
    assert.deepEqual(ci.permissions, { contents: 'read', actions: 'read' })
    assert.equal(ci['continue-on-error'], true)
    assert.equal(ci.steps.at(-1).uses, 'xova-dev/actions/actions/checked-ci@v1')
    assert.equal(ci.steps.at(-1).with['expected-sha'], '$' + '{{ github.sha }}')
    assert.equal(ci.outputs['input-error'], '$' + '{{ steps.ci.outputs.input-error }}')
    assert.equal(fallback.needs, 'ci')
    assert.equal(fallback.with['detect-changes'], undefined)
    assert.deepEqual(release.needs, ['ci', id])
    assert.equal(fallback['continue-on-error'], undefined)
    assert.equal(release['continue-on-error'], undefined)
    const needs = (ciSHA, result, checkedSHA = '') => ({ ci: { result: 'success', outputs: { 'source-sha': ciSHA } }, [id]: { result, outputs: { 'source-sha': checkedSHA } } })
    assert.equal(jobAllowed(fallback, needs(sha, 'skipped')), false)
    assert.equal(jobAllowed(release, needs(sha, 'skipped')), true)
    assert.equal(jobAllowed(fallback, needs('', 'success', sha)), true)
    assert.equal(jobAllowed(release, needs('', 'success', sha)), true)
    for (const result of ['failure', 'cancelled', 'skipped']) assert.equal(jobAllowed(release, needs('', result)), false)
    for (const source of ['', 'b'.repeat(40)]) assert.equal(jobAllowed(release, needs('', 'success', source)), false)
    assert.equal(jobAllowed(fallback, needs('b'.repeat(40), 'skipped')), true)
    assert.equal(jobAllowed(release, needs('b'.repeat(40), 'skipped')), false)
    assert.equal(jobAllowed(release, needs(sha, 'skipped'), true), false)
    for (const result of ['failure', 'cancelled', 'skipped']) {
      const failed = needs(sha, 'skipped')
      failed.ci.result = result
      assert.equal(jobAllowed(release, failed), false)
    }
    assert.match(release.with['expected-sha'], new RegExp('needs.' + id + '.outputs.source-sha \\|\\| needs.ci.outputs.source-sha'))
    const config = JSON.parse(readFileSync(join(root, 'examples', directory, 'xova.json')))
    assert.match(config.npm['package-verify-command'], /test:pack/)
  }
  const publish = workflow('release').jobs.publish.steps.at(-1)
  assert.equal(publish.uses, '$/actions/npm-publish')
  assert.match(publish.with['package-verify-command'], /npm.package-verify-command/)
  assert.ok(action('npm-publish').runs.steps.some(step => step.name === 'Verify and publish with release-it'))
})

test('failed lookup outcomes never export reusable SHA even if their conclusion was tolerated', () => {
  for (const directory of ['rsp', 'matrix']) {
    const definition = parse(readFileSync(join(root, 'examples', directory, 'publish.yml'), 'utf8'))
    const ci = definition.jobs.ci
    for (const outcome of ['success', 'failure', 'cancelled', 'skipped']) {
      const steps = { ci: { outcome, conclusion: 'success', outputs: { 'source-sha': sha, 'input-error': 'true' } } }
      assert.equal(jobExpression(ci, ci.outputs['source-sha'], {}, false, sha, steps), outcome === 'success' ? sha : '')
      assert.equal(jobExpression(ci, ci.outputs['input-error'], {}, false, sha, steps), 'true')
    }
  }
})

test('fatal input errors retain their marker through a failed lookup and block both paths', t => {
  const project = fixture(t)
  const result = runStep(actionStep('checked-ci', 'ci').run, project.cwd, {
    ...env, EXPECTED_SHA: 'b'.repeat(40), XOVA_ACTION_PATH: join(root, 'actions/checked-ci'),
  })
  assert.notEqual(result.status, 0, output(result))
  const outputs = Object.fromEntries(readFileSync(join(project.cwd, 'step-output'), 'utf8').trim().split('\n').map(line => line.split('=')))
  assert.deepEqual(outputs, { 'input-error': 'true' })
  assert.match(action('checked-ci').outputs['input-error'].value, /steps.ci.outputs.input-error/)
  for (const [directory, id] of [['rsp', 'check'], ['matrix', 'checks']]) {
    const definition = parse(readFileSync(join(root, 'examples', directory, 'publish.yml'), 'utf8'))
    const { jobs } = definition
    const report = jobs['ci-status']
    const reported = runStep(report.steps[0].run, project.cwd, { INPUT_ERROR: outputs['input-error'] })
    assert.notEqual(reported.status, 0)
    assert.match(output(reported), /::error::/)
    for (const result of ['success', 'failure', 'cancelled']) {
      const needs = {
        ci: { result, outputs: { ...outputs, 'source-sha': sha } },
        [id]: { result: 'success', outputs: { 'source-sha': sha } },
      }
      assert.equal(jobAllowed(jobs[id], needs), false)
      assert.equal(jobAllowed(jobs.release, needs), false)
      assert.equal(jobAllowed(report, needs), true)
      assert.equal(jobExpression(report, report['continue-on-error'], needs), false)
      const blocked = { ...needs, [id]: { result: 'skipped' }, release: { result: 'skipped' }, 'ci-status': { result: 'failure' } }
      assert.equal(hasUntoleratedFailure(definition, blocked), true, 'Fatal input errors left a successful workflow')
      const swallowed = structuredClone(definition)
      swallowed.jobs['ci-status']['continue-on-error'] = true
      assert.equal(hasUntoleratedFailure(swallowed, blocked), false, 'The fatal reporting gate is not covered')
    }
  }
})

test('failed and timed-out lookup steps require full fallback despite implicit status gates', t => {
  for (const timeout of [false, true]) {
    const project = fixture(t)
    project.write('.github/xova.json', {
      schemaVersion: 1, setup: { 'install-command': ':' },
      code: { 'check-command': 'node --check source.js && touch fallback-ran' },
    })
    const source = project.commit('test: complete fallback')
    // Replace the external Node runtime to exercise failure before the lookup CLI
    // can produce outputs. exec ensures timeout kills the process without orphans.
    project.write('bin/node', '#!/bin/bash\nprintf started > "$LOOKUP_STARTED"\n' + (timeout ? 'while :; do :; done\n' : 'exit 17\n'))
    chmodSync(join(project.cwd, 'bin/node'), 0o755)
    const outputPath = join(project.cwd, 'lookup-output')
    const failed = spawnSync('/bin/bash', ['-e', '-o', 'pipefail', '-c', 'exec ' + actionStep('checked-ci', 'ci').run], {
      cwd: project.cwd, encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL',
      env: { ...process.env, PATH: join(project.cwd, 'bin'), GITHUB_OUTPUT: outputPath,
        XOVA_ACTION_PATH: join(root, 'actions/checked-ci'), LOOKUP_STARTED: join(project.cwd, 'lookup-started') },
    })
    assert.equal(existsSync(join(project.cwd, 'lookup-started')), true)
    if (timeout) assert.equal(failed.error?.code, 'ETIMEDOUT')
    else assert.equal(failed.status, 17)
    assert.equal(existsSync(outputPath), false, 'An infrastructure failure fabricated CI evidence')
    const complete = check(project)
    assert.equal(complete.status, 0, complete.logs)
    assert.equal(existsSync(join(project.cwd, 'fallback-ran')), true)
    assert.equal(complete.outputs['source-sha'], source)
    for (const [directory, id] of [['rsp', 'check'], ['matrix', 'checks']]) {
      const definition = parse(readFileSync(join(root, 'examples', directory, 'publish.yml'), 'utf8'))
      const { jobs } = definition
      const report = jobs['ci-status']
      // A host timeout can arrive with no outputs. Also accept an interrupted
      // lookup job while the publication workflow itself has not been cancelled.
      for (const result of ['failure', 'cancelled']) {
        for (const outputs of [{}, { 'input-error': 'false', 'source-sha': source }]) {
          const needs = { ci: { result, outputs }, [id]: { result: 'skipped', outputs: {} } }
          assert.equal(jobAllowed(report, needs, false, source), true)
          assert.equal(jobExpression(report, report['continue-on-error'], needs, false, source), true)
          const reported = runStep(report.steps[0].run, project.cwd, { INPUT_ERROR: outputs['input-error'] || '' })
          assert.equal(reported.status, 0, output(reported))
          assert.match(output(reported), /::warning::/)
          assert.equal(jobAllowed(jobs[id], needs, false, source), true)
          assert.equal(jobAllowed(jobs.release, needs, false, source), false, 'Lookup failure alone authorized publication')
          // The original predicate and removing the explicit status function
          // both reproduce the implicit success() bug for failed dependencies.
          assert.equal(jobAllowed({ ...jobs[id], if: "needs.ci.outputs.source-sha == ''" }, needs, false, source), false)
          assert.equal(jobAllowed({ ...jobs[id], if: jobs[id].if.replace('!cancelled() && ', '') }, needs, false, source), false)
          for (const checkedSHA of ['', 'b'.repeat(40), source]) {
            needs[id] = { result: 'success', outputs: { 'source-sha': checkedSHA } }
            assert.equal(jobAllowed(jobs.release, needs, false, source), checkedSHA === source)
          }
          for (const checkedResult of ['failure', 'cancelled', 'skipped']) {
            needs[id] = { result: checkedResult, outputs: { 'source-sha': source } }
            assert.equal(jobAllowed(jobs.release, needs, false, source), false)
            if (checkedResult === 'failure') assert.equal(hasUntoleratedFailure(definition, {
              ...needs, release: { result: 'skipped' }, 'ci-status': { result: 'success' },
            }, source), true, 'Complete fallback failure was tolerated')
          }
          needs[id] = { result: 'success', outputs: complete.outputs }
          if (result === 'failure') {
            const recovered = { ...needs, release: { result: 'success' }, 'ci-status': { result: 'success' } }
            assert.equal(hasUntoleratedFailure(definition, recovered, source), false, 'Recovered lookup failure kept the workflow failed')
            const strict = structuredClone(definition)
            strict.jobs.ci['continue-on-error'] = false
            assert.equal(hasUntoleratedFailure(strict, recovered, source), true)
            recovered['ci-status'].result = 'failure'
            assert.equal(hasUntoleratedFailure(definition, recovered, source), false, 'Optional warning reporting became fatal')
          }
          assert.equal(jobAllowed({ ...jobs.release, if: jobs.release.if.replace('!cancelled() && ', '') }, needs, false, source), false)
          assert.equal(jobAllowed(jobs[id], needs, true, source), false)
          assert.equal(jobAllowed(jobs.release, needs, true, source), false)
          needs.ci.result = 'skipped'
          assert.equal(jobAllowed(jobs[id], needs, false, source), false)
          assert.equal(jobAllowed(jobs.release, needs, false, source), false)
        }
      }
    }
  }
})

test('reused and fallback CI both require tests of the exact publication tarball', async t => {
  const definition = parse(readFileSync(join(root, 'examples/rsp/publish.yml'), 'utf8'))
  for (const scenario of ['reuse', 'missing CI', 'job failure', 'job timeout']) {
    const reuse = scenario === 'reuse'
    for (const packagePasses of [true, false]) {
      const project = fixture(t)
      project.write('.github/xova.json', {
        schemaVersion: 1, setup: { 'install-command': ':' },
        code: { 'check-command': 'node --check source.js && touch source-checked' },
      })
      const source = project.commit('chore(release): final candidate')
      project.git('tag', '-f', 'v0.1.0')
      const checked = check(project)
      assert.equal(checked.status, 0, checked.logs)
      rmSync(join(project.cwd, 'source-checked'))
      const run = { ...passedRun(), head_sha: source }
      const job = { ...passedJob(), head_sha: source, steps: checked.steps }
      const ci = scenario.startsWith('job ') ? {} : await checkedCI({ ...env, EXPECTED_SHA: source, GITHUB_SHA: source }, { api: (path, paginated = false) => {
        if (path.includes('/workflows/')) return [{ workflow_runs: reuse ? [run] : [] }]
        if (path.includes('/jobs?')) return [{ jobs: [job] }]
        assert.equal(paginated, false)
        return run
      } })
      if (!scenario.startsWith('job ')) assert.equal(ci['source-sha'], reuse ? source : '', JSON.stringify(console.log.mock.calls.map(call => call.arguments)))
      // A timed-out host job is a failed dependency with potentially no outputs.
      const needs = { ci: { result: scenario.startsWith('job ') ? 'failure' : 'success', outputs: ci }, check: { result: 'skipped', outputs: {} } }
      const report = definition.jobs['ci-status']
      let reportResult = 'skipped'
      if (jobAllowed(report, needs, false, source)) {
        const reported = runStep(report.steps[0].run, project.cwd, { INPUT_ERROR: ci['input-error'] || '' })
        assert.equal(reported.status, 0, output(reported))
        assert.match(output(reported), /::warning::/)
        reportResult = 'success'
      }
      if (jobAllowed(definition.jobs.check, needs, false, source)) {
        const fallback = check(project)
        assert.equal(fallback.status, 0, fallback.logs)
        needs.check = { result: 'success', outputs: fallback.outputs }
      }
      assert.equal(existsSync(join(project.cwd, 'source-checked')), !reuse)
      assert.equal(jobAllowed(definition.jobs.release, needs, false, source), true)
      const expected = needs.check.outputs['source-sha'] || ci['source-sha']
      assert.equal(expected, source)
      linkReleaseIt(project.cwd)
      const published = composite('npm-publish', project.cwd, {
        'release-tag': 'v0.1.0', 'expected-sha': expected,
        'verify-command': 'mkdir -p dist && cp source.js dist/index.js',
        'package-verify-command': 'cp "$TARBALL" checked.tgz' + (packagePasses ? '' : ' && exit 23'),
      }, { ...stubNpmPublication(project), GITHUB_SHA: source, GITHUB_REF: 'refs/tags/v0.1.0' })
      assert.equal(published.status === 0, packagePasses, published.logs)
      assert.equal(existsSync(join(project.cwd, 'checked.tgz')), true)
      assert.equal(existsSync(join(project.cwd, 'publication.json')), packagePasses)
      assert.equal(hasUntoleratedFailure(definition, { ...needs, 'ci-status': { result: reportResult }, release: { result: packagePasses ? 'success' : 'failure' } }, source), !packagePasses)
      if (packagePasses) {
        const digest = createHash('sha256').update(readFileSync(join(project.cwd, 'checked.tgz'))).digest('hex')
        assert.equal(JSON.parse(readFileSync(join(project.cwd, 'publication.json'))).digest, digest)
        assert.equal(published.outputs['tarball-sha256'], digest)
      }
    }
  }
})
