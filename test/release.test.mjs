import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fixture, output, root } from './helpers.mjs'

function release(project, mode, version, extra = []) {
  return spawnSync(process.execPath, [join(root, 'scripts/release.mjs'), mode, version, '--cwd', project.cwd, ...extra], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, CI: '1', NO_COLOR: '1' },
  })
}

test('preview uses the explicit version without changing files, index, commits or tags', t => {
  const project = fixture(t)
  project.write('source.js', 'export const answer = 2\n')
  const head = project.commit('feat: add answer')
  const before = project.git('status', '--porcelain=v1')
  const result = release(project, 'preview', '0.2.0')
  assert.equal(result.status, 0, output(result))
  assert.match(result.stdout, /0\.2\.0/)
  assert.equal(JSON.parse(readFileSync(join(project.cwd, 'package.json'))).version, '0.1.0')
  assert.equal(readFileSync(join(project.cwd, 'CHANGELOG.md'), 'utf8'), '# Changelog\n')
  assert.equal(project.git('status', '--porcelain=v1'), before)
  assert.equal(project.git('rev-parse', 'HEAD'), head)
  assert.equal(project.git('tag'), 'v0.1.0')
})

test('prepare updates release files but leaves Git delivery untouched', t => {
  const project = fixture(t)
  project.write('source.js', 'export const answer = 2\n')
  const head = project.commit('feat: add answer')
  const result = release(project, 'prepare', '0.2.0')
  assert.equal(result.status, 0, output(result))
  assert.equal(JSON.parse(readFileSync(join(project.cwd, 'package.json'))).version, '0.2.0')
  assert.match(readFileSync(join(project.cwd, 'CHANGELOG.md'), 'utf8'), /0\.2\.0/)
  assert.equal(project.git('rev-parse', 'HEAD'), head)
  assert.equal(project.git('tag'), 'v0.1.0')
  assert.equal(project.git('diff', '--cached', '--name-only'), '')
  assert.deepEqual(project.git('diff', '--name-only').split('\n').sort(), ['CHANGELOG.md', 'package.json'])
})

test('prepare preserves dirty staged and untracked work and refuses an existing target tag', t => {
  const project = fixture(t)
  project.write('source.js', 'existing work\n')
  project.git('add', 'source.js')
  project.write('notes.txt', 'keep me')
  const before = project.git('status', '--porcelain=v1')
  const result = release(project, 'prepare', '0.2.0')
  assert.notEqual(result.status, 0)
  assert.match(output(result), /clean worktree/)
  assert.equal(project.git('status', '--porcelain=v1'), before)
  assert.equal(readFileSync(join(project.cwd, 'notes.txt'), 'utf8'), 'keep me')
  project.commit('chore: preserve work')
  project.git('tag', 'v0.2.0')
  const tagged = release(project, 'prepare', '0.2.0')
  assert.notEqual(tagged.status, 0)
  assert.match(output(tagged), /already exists/)
})

test('invalid or repeated versions and extra publication flags fail before mutation', t => {
  const project = fixture(t)
  for (const version of ['v0.2.0', '0.2', '00.2.0', '0.2.0-01', '0.1.0']) {
    assert.notEqual(release(project, 'prepare', version).status, 0, version)
  }
  assert.notEqual(release(project, 'prepare', '0.2.0', ['--push']).status, 0)
  assert.equal(project.git('status', '--porcelain=v1'), '')
})

test('first release preparation works without a previous tag', t => {
  const project = fixture(t)
  project.git('tag', '-d', 'v0.1.0')
  project.write('source.js', 'first release feature\n')
  project.commit('feat: first release')
  const result = release(project, 'prepare', '1.0.0')
  assert.equal(result.status, 0, output(result))
  assert.equal(JSON.parse(readFileSync(join(project.cwd, 'package.json'))).version, '1.0.0')
  assert.equal(project.git('tag'), '')
})
