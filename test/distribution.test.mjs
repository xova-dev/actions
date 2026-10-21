import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fixture, output, root } from './helpers.mjs'

test('bundle validation rejects missing or changed code and license without rewriting them', t => {
  const project = fixture(t)
  project.write('scripts/build.mjs', readFileSync(join(root, 'scripts/build.mjs'), 'utf8'))
  mkdirSync(join(project.cwd, 'node_modules'))
  for (const name of ['esbuild', 'semver'])
    symlinkSync(join(root, 'node_modules', name), join(project.cwd, 'node_modules', name))
  const build = (...args) => spawnSync(process.execPath, ['scripts/build.mjs', ...args], {
    cwd: project.cwd, encoding: 'utf8', timeout: 30000,
  })
  const missing = build('--check')
  assert.notEqual(missing.status, 0, output(missing))
  assert.equal(existsSync(join(project.cwd, 'dist')), false)
  const generated = build()
  assert.equal(generated.status, 0, output(generated))
  const valid = build('--check')
  assert.equal(valid.status, 0, output(valid))
  for (const name of ['semver.mjs', 'semver.LICENSE']) {
    const path = join(project.cwd, 'dist', name)
    const original = readFileSync(path, 'utf8')
    const changed = original + '\nchanged\n'
    writeFileSync(path, changed)
    const stale = build('--check')
    assert.notEqual(stale.status, 0, output(stale))
    assert.equal(readFileSync(path, 'utf8'), changed)
    rmSync(path)
    const absent = build('--check')
    assert.notEqual(absent.status, 0, output(absent))
    assert.equal(existsSync(path), false)
    writeFileSync(path, original)
  }
})
