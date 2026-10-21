import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fixture, output, root } from './helpers.mjs'

test('bundle validation rejects missing or changed code and license without rewriting them', t => {
  const project = fixture(t)
  project.write('scripts/build.mjs', readFileSync(join(root, 'scripts/build.mjs'), 'utf8'))
  const source = readFileSync(join(root, 'config/project.mjs'), 'utf8')
  project.write('config/project.mjs', source)
  mkdirSync(join(project.cwd, 'node_modules'))
  for (const name of ['esbuild', 'semver', 'valibot', '@valibot/to-json-schema']) {
    mkdirSync(join(project.cwd, 'node_modules', name, '..'), { recursive: true })
    symlinkSync(join(root, 'node_modules', name), join(project.cwd, 'node_modules', name))
  }
  const build = (...args) => spawnSync(process.execPath, ['scripts/build.mjs', ...args], {
    cwd: project.cwd, encoding: 'utf8', timeout: 30000,
  })
  const missing = build('--check')
  assert.notEqual(missing.status, 0, output(missing))
  assert.equal(existsSync(join(project.cwd, 'dist')), false)
  assert.equal(existsSync(join(project.cwd, 'config/project.schema.json')), false)
  const generated = build()
  assert.equal(generated.status, 0, output(generated))
  const valid = build('--check')
  assert.equal(valid.status, 0, output(valid))
  for (const name of ['dist/semver.mjs', 'dist/semver.LICENSE', 'dist/project-config.mjs', 'dist/valibot.LICENSE', 'config/project.schema.json']) {
    const path = join(project.cwd, name)
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
  project.write('config/project.mjs', source.replace("'node-version': v.optional(command, '24')", "'node-version': v.optional(command, '26')"))
  assert.notEqual(build('--check').status, 0, 'A changed schema passed distribution validation')
  const before = readFileSync(join(project.cwd, 'dist/project-config.mjs'))
  project.write('config/project.mjs', source.replace('v.pipe(v.string(), v.regex', 'v.pipe(v.string(), v.check(() => true), v.regex'))
  const unsupported = build()
  assert.notEqual(unsupported.status, 0, 'An unsupported check was silently omitted from JSON Schema')
  assert.match(output(unsupported), /check/)
  assert.deepEqual(readFileSync(join(project.cwd, 'dist/project-config.mjs')), before)
})
