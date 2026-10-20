import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { actionStep, fixture, output, runStep } from './helpers.mjs'

test('candidate accepts common npm repository forms while matching GitHub identity', t => {
  const project = fixture(t)
  const pkg = JSON.parse(readFileSync(join(project.cwd, 'package.json')))
  for (const repository of [
    'fixture/project', 'github:fixture/project', 'https://github.com/fixture/project',
    'git+https://github.com/fixture/project.git', 'git://github.com/fixture/project.git',
    'git@github.com:fixture/project.git', 'git+ssh://git@github.com/fixture/project.git',
    { type: 'git', url: 'https://github.com/fixture/project.git', directory: 'packages/widget' },
  ]) {
    project.write('package.json', { ...pkg, repository })
    const sha = project.commit('chore: package metadata')
    project.git('tag', '-f', 'v0.1.0')
    const result = runStep(actionStep('npm-publish', 'candidate').run, project.cwd, {
      RELEASE_TAG: 'v0.1.0', NPM_TAG: 'auto', VERIFY_COMMAND: 'npm test',
      GITHUB_SHA: sha, GITHUB_REF: 'refs/tags/v0.1.0',
    })
    assert.equal(result.status, 0, JSON.stringify(repository) + ': ' + output(result))
  }
})

test('invalid or mismatched repository metadata fails before verification and candidate outputs', t => {
  const project = fixture(t)
  const pkg = JSON.parse(readFileSync(join(project.cwd, 'package.json')))
  for (const repository of [
    undefined, {}, { url: 42 }, 42, 'not a repository',
    'https://gitlab.com/fixture/project.git', 'https://github.com/other/project.git',
    'https://github.com/Fixture/project.git', 'https://github.com/fixture/project/extra',
    'https://github.com/fixture/project.git?secret=do-not-echo',
    'https://token:do-not-echo@github.com/fixture/project.git',
  ]) {
    project.write('package.json', { ...pkg, repository })
    const sha = project.commit('chore: invalid metadata')
    project.git('tag', '-f', 'v0.1.0')
    project.write('step-output', '')
    const result = runStep(actionStep('npm-publish', 'candidate').run, project.cwd, {
      RELEASE_TAG: 'v0.1.0', NPM_TAG: 'auto', VERIFY_COMMAND: 'npm test',
      GITHUB_SHA: sha, GITHUB_REF: 'refs/tags/v0.1.0',
    })
    assert.notEqual(result.status, 0, JSON.stringify(repository))
    assert.match(output(result), /repository/)
    assert.doesNotMatch(output(result), /do-not-echo/)
    assert.equal(readFileSync(join(project.cwd, 'step-output'), 'utf8'), '')
  }
})
