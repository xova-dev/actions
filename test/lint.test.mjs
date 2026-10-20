import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { parse, stringify } from 'yaml'
import { fixture, output, root } from './helpers.mjs'

function lintFixture(t) {
  const project = fixture(t)
  const workflow = 'on: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n'
  project.write('.github/workflows/check.yml', workflow)
  project.write('examples/sample/check.yml', workflow)
  const action = readFileSync(join(root, 'actions/latest-release/action.yml'), 'utf8')
  project.write('actions/fixture/action.yml', action)
  const lint = () => spawnSync(process.execPath, [join(root, 'scripts/lint.mjs')], {
    cwd: project.cwd, encoding: 'utf8', timeout: 30000,
  })
  return { ...project, lint, action }
}

test('lint rejects malformed composite metadata including nested action.yaml definitions', t => {
  const project = lintFixture(t)
  const valid = project.lint()
  assert.equal(valid.status, 0, output(valid))
  const mutations = [
    definition => { delete definition.runs.steps[0].shell },
    definition => { definition.runs.steps[0]['working-directroy'] = '.' },
    definition => { definition.inputs['expected-sha'].required = 'sometimes' },
  ]
  for (const mutate of mutations) {
    const definition = parse(project.action)
    mutate(definition)
    project.write('actions/nested/group/action.yaml', stringify(definition))
    const rejected = project.lint()
    assert.notEqual(rejected.status, 0, 'Invalid composite action passed lint')
    assert.match(output(rejected), /actions\/nested\/group\/action.yaml/)
  }
})

test('lint still reports workflow errors when composite metadata is valid', t => {
  const project = lintFixture(t)
  project.write('examples/sample/check.yml', 'on: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n        invalid: value\n')
  const rejected = project.lint()
  assert.notEqual(rejected.status, 0)
  assert.match(output(rejected), /examples\/sample\/check.yml/)
})
