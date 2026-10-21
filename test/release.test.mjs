import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fixture, output, root } from './helpers.mjs'

function consumer(t, overrides = {}) {
  const project = fixture(t)
  project.write('.release-it.json', { extends: [join(root, 'config')], ...overrides })
  project.commit('chore: inherit shared release-it configuration')
  return project
}

function release(project, version, ...args) {
  return spawnSync(process.execPath, [join(root, 'node_modules/release-it/bin/release-it.js'), version, '--ci', ...args], {
    cwd: project.cwd, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, CI: '1', NO_COLOR: '1', npm_config_registry: 'http://127.0.0.1:9', npm_config_userconfig: '/dev/null' },
  })
}

test('native preview leaves files, index, commits and tags unchanged', t => {
  const project = consumer(t)
  project.write('source.js', 'export const answer = 2\n')
  const head = project.commit('feat: add answer')
  const result = release(project, '0.2.0', '--dry-run')
  assert.equal(result.status, 0, output(result))
  assert.match(result.stdout, /0\.2\.0/)
  assert.equal(JSON.parse(readFileSync(join(project.cwd, 'package.json'))).version, '0.1.0')
  assert.equal(readFileSync(join(project.cwd, 'CHANGELOG.md'), 'utf8'), '# Changelog\n')
  assert.equal(project.git('status', '--porcelain=v1'), '')
  assert.equal(project.git('rev-parse', 'HEAD'), head)
  assert.equal(project.git('tag'), 'v0.1.0')
})

test('native preparation updates version/changelog, runs consumer hooks and skips version lifecycle scripts', t => {
  const project = consumer(t, { hooks: { 'after:bump': 'node -e "require(\'node:fs\').writeFileSync(\'prepared-version\', require(\'./package.json\').version)"' } })
  const pkg = JSON.parse(readFileSync(join(project.cwd, 'package.json')))
  project.write('package.json', { ...pkg, scripts: { preversion: 'touch lifecycle-ran', version: 'exit 17', postversion: 'exit 18' } })
  const head = project.commit('feat: prepare with native hooks')
  const result = release(project, '0.2.0-beta.1')
  assert.equal(result.status, 0, output(result))
  assert.equal(JSON.parse(readFileSync(join(project.cwd, 'package.json'))).version, '0.2.0-beta.1')
  assert.equal(readFileSync(join(project.cwd, 'prepared-version'), 'utf8'), '0.2.0-beta.1')
  assert.match(readFileSync(join(project.cwd, 'CHANGELOG.md'), 'utf8'), /prepare with native hooks/)
  assert.equal(existsSync(join(project.cwd, 'lifecycle-ran')), false)
  assert.equal(project.git('rev-parse', 'HEAD'), head)
  assert.equal(project.git('tag'), 'v0.1.0')
  assert.equal(project.git('diff', '--cached', '--name-only'), '')
  assert.deepEqual(project.git('diff', '--name-only').split('\n').sort(), ['CHANGELOG.md', 'package.json'])
})

test('native dirty-worktree validation preserves staged and untracked work', t => {
  const project = consumer(t)
  project.write('source.js', 'existing work\n')
  project.git('add', 'source.js')
  project.write('notes.txt', 'keep me')
  const before = project.git('status', '--porcelain=v1')
  const result = release(project, '0.2.0')
  assert.notEqual(result.status, 0)
  assert.equal(project.git('status', '--porcelain=v1'), before)
  assert.equal(readFileSync(join(project.cwd, 'notes.txt'), 'utf8'), 'keep me')
})

test('first native release creates and stages the changelog without committing or tagging', t => {
  const project = consumer(t)
  project.git('tag', '-d', 'v0.1.0')
  project.git('rm', 'CHANGELOG.md')
  const head = project.commit('feat: first release without a changelog')
  const result = release(project, '1.0.0')
  assert.equal(result.status, 0, output(result))
  assert.equal(JSON.parse(readFileSync(join(project.cwd, 'package.json'))).version, '1.0.0')
  assert.match(readFileSync(join(project.cwd, 'CHANGELOG.md'), 'utf8'), /first release/)
  assert.equal(project.git('diff', '--cached', '--name-only'), 'CHANGELOG.md')
  assert.equal(project.git('rev-parse', 'HEAD'), head)
  assert.equal(project.git('tag'), '')
})

test('changelog write errors exit nonzero and retain the failed work for inspection', t => {
  const project = consumer(t)
  const path = join(project.cwd, 'CHANGELOG.md')
  chmodSync(path, 0o444)
  t.after(() => { if (existsSync(path)) chmodSync(path, 0o644) })
  const head = project.git('rev-parse', 'HEAD')
  const result = release(project, '0.2.0')
  assert.notEqual(result.status, 0, output(result))
  assert.match(output(result), /EACCES|EPERM|permission denied/i)
  assert.equal(readFileSync(path, 'utf8'), '# Changelog\n')
  assert.equal(project.git('rev-parse', 'HEAD'), head)
  assert.equal(project.git('tag'), 'v0.1.0')
})

test('native configuration prepares a subdirectory package with a namespaced tag independently of the root', t => {
  const project = consumer(t)
  project.write('packages/widget/package.json', { name: 'xova-widget-release-fixture', version: '1.0.0', repository: 'github:fixture/project' })
  project.write('packages/widget/CHANGELOG.md', '# Changelog\n')
  project.write('packages/widget/.release-it.json', { extends: [join(root, 'config')], git: { tagName: 'widget@${version}' } })
  const head = project.commit('feat: add workspace widget')
  project.git('tag', 'widget@1.0.0')
  const result = release({ cwd: join(project.cwd, 'packages/widget') }, '1.1.0')
  assert.equal(result.status, 0, output(result))
  assert.equal(JSON.parse(readFileSync(join(project.cwd, 'packages/widget/package.json'))).version, '1.1.0')
  assert.match(readFileSync(join(project.cwd, 'packages/widget/CHANGELOG.md'), 'utf8'), /1\.1\.0/)
  assert.equal(JSON.parse(readFileSync(join(project.cwd, 'package.json'))).version, '0.1.0')
  assert.equal(project.git('rev-parse', 'HEAD'), head)
  assert.equal(project.git('tag'), 'v0.1.0\nwidget@1.0.0')
})

test('native preparation keeps pnpm catalogs, lockfiles and private workspace versions intact', t => {
  const project = consumer(t)
  const pkg = JSON.parse(readFileSync(join(project.cwd, 'package.json')))
  project.write('package.json', { ...pkg, dependencies: { 'xova-dependency': 'catalog:' } })
  project.write('pnpm-workspace.yaml', 'packages: [docs]\ncatalog:\n  xova-dependency: ^1.2.3\n')
  project.write('pnpm-lock.yaml', 'lockfileVersion: "9.0"\nimporters:\n  .: {}\n  docs: {}\n')
  project.write('docs/package.json', { name: 'private-docs', version: '1.0.0', private: true })
  project.commit('feat: pnpm catalog preparation fixture')
  const result = release(project, '0.2.0')
  assert.equal(result.status, 0, output(result))
  assert.deepEqual(JSON.parse(readFileSync(join(project.cwd, 'package.json'))).dependencies, { 'xova-dependency': 'catalog:' })
  assert.equal(JSON.parse(readFileSync(join(project.cwd, 'docs/package.json'))).version, '1.0.0')
  assert.deepEqual(project.git('diff', '--name-only').split('\n').sort(), ['CHANGELOG.md', 'package.json'])
})
