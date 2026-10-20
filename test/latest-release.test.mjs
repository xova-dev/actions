import assert from 'node:assert/strict'
import { chmodSync, readFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fixture } from './helpers.mjs'
import { composite } from './composite.mjs'

function policy(t) {
  const project = fixture(t)
  const sha = project.git('rev-parse', 'HEAD')
  const tag = 'widget@0.2.0'
  const selected = 'repos/fixture/project/releases/tags/' + encodeURIComponent(tag)
  const latest = 'repos/fixture/project/releases/latest'
  const commit = 'repos/fixture/project/commits/' + encodeURIComponent('refs/tags/' + tag)
  project.write('bin/gh.cjs', '#!' + process.execPath + '\n' + [
    "const fs = require('node:fs');",
    "const path = process.argv.at(-1);",
    "fs.appendFileSync(process.env.API_CALLS, path + '\\n');",
    "const response = JSON.parse(fs.readFileSync(process.env.API_RESPONSES))[path];",
    "if (!response) { console.error('Unexpected API request: ' + path); process.exit(99); }",
    "if (response.error) { console.error(response.error); process.exit(17); }",
    "console.log(JSON.stringify(response));",
  ].join('\n'))
  chmodSync(join(project.cwd, 'bin/gh.cjs'), 0o755)
  symlinkSync('gh.cjs', join(project.cwd, 'bin/gh'))
  const run = (overrides = {}) => {
    project.write('responses.json', {
      [selected]: { tag_name: tag, prerelease: false, draft: false },
      [latest]: { tag_name: tag, prerelease: false, draft: false },
      [commit]: { sha }, ...overrides,
    })
    project.write('calls', '')
    return composite('latest-release', project.cwd, { 'release-tag': tag, 'expected-sha': sha }, {
      PATH: join(project.cwd, 'bin') + ':' + process.env.PATH,
      API_CALLS: join(project.cwd, 'calls'), API_RESPONSES: join(project.cwd, 'responses.json'),
    })
  }
  return { run, selected, latest, commit, calls: () => readFileSync(join(project.cwd, 'calls'), 'utf8').trim().split('\n') }
}

test('a first prerelease or draft skips stable docs without querying a missing latest release', t => {
  const api = policy(t)
  for (const release of [{ prerelease: true }, { draft: true }]) {
    const result = api.run({ [api.selected]: { tag_name: 'widget@0.2.0', ...release }, [api.latest]: { error: 'HTTP 404: Not Found' } })
    assert.equal(result.status, 0, result.logs)
    assert.equal(result.outputs.eligible, 'false')
    assert.deepEqual(api.calls(), [api.selected])
  }
})

test('stable policy accepts the exact latest tag, skips older releases and rejects moved tags', t => {
  const api = policy(t)
  const current = api.run()
  assert.equal(current.status, 0, current.logs)
  assert.equal(current.outputs.eligible, 'true')
  assert.deepEqual(api.calls(), [api.selected, api.latest, api.commit])
  const old = api.run({ [api.latest]: { tag_name: 'widget@0.3.0', prerelease: false, draft: false } })
  assert.equal(old.status, 0, old.logs)
  assert.equal(old.outputs.eligible, 'false')
  const moved = api.run({ [api.commit]: { sha: 'b'.repeat(40) } })
  assert.notEqual(moved.status, 0)
  assert.match(moved.logs, /source SHA/)
})

test('missing releases, authentication, permission, service and transport errors remain failures', t => {
  const api = policy(t)
  for (const endpoint of [api.selected, api.latest, api.commit]) {
    for (const error of ['HTTP 404: Not Found', 'HTTP 401: Bad credentials', 'HTTP 403: Forbidden', 'HTTP 500: Internal Server Error', 'network timeout']) {
      const result = api.run({ [endpoint]: { error } })
      assert.notEqual(result.status, 0, endpoint + ': ' + error)
      assert.deepEqual(result.outputs, {})
    }
  }
})
