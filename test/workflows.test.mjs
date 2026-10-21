import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { parse } from 'yaml'
import { action, actionStep, fixture, linkReleaseIt, output, root, runStep, workflow } from './helpers.mjs'
import { composite } from './composite.mjs'

const fields = cwd => Object.fromEntries(readFileSync(join(cwd, 'step-output'), 'utf8').trim().split('\n').filter(Boolean).map(line => {
  const split = line.indexOf('=')
  return [line.slice(0, split), line.slice(split + 1)]
}))
function candidate(project, env = {}) {
  return runStep(actionStep('npm-publish', 'candidate').run, project.cwd, {
    RELEASE_TAG: 'v0.2.0', NPM_TAG: 'auto', VERIFY_COMMAND: 'npm test',
    GITHUB_SHA: project.git('rev-parse', 'HEAD'), GITHUB_REF: 'refs/tags/' + (env.RELEASE_TAG || 'v0.2.0'), ...env,
  })
}
function releaseCandidate(t, version = '0.2.0') {
  const project = fixture(t)
  const manifest = JSON.parse(readFileSync(join(project.cwd, 'package.json')))
  project.write('package.json', { ...manifest, version })
  project.write('docs/releases/' + version + '.md', 'Release notes\n')
  project.write('docs/migrations/' + version + '.md', 'Migration\n')
  project.write('source.js', 'export const answer = 2\n')
  const sha = project.commit('chore(release): v' + version)
  project.git('tag', 'v' + version)
  return { ...project, sha }
}
function bundle(project, env = {}) {
  return runStep(actionStep('docs-build', 'bundle').run, project.cwd, {
    EXPECTED_SHA: project.git('rev-parse', 'HEAD'), SITE_DIRECTORY: 'dist', ...env,
  })
}
function artifact(project) {
  project.write('dist/index.html', '<h1>Docs</h1>')
  const result = bundle(project)
  assert.equal(result.status, 0, output(result))
  return fields(project.cwd)['artifact-directory']
}

test('final tagged candidate accepts release notes, migrations and source changes together', t => {
  const project = releaseCandidate(t)
  const result = candidate(project)
  assert.equal(result.status, 0, output(result))
  assert.deepEqual(fields(project.cwd), { 'source-sha': project.sha, version: '0.2.0', 'npm-tag': 'latest' })
})

test('an annotated release tag on a merge candidate does not require a special commit shape', t => {
  const project = fixture(t)
  project.git('checkout', '-qb', 'release')
  const pkg = JSON.parse(readFileSync(join(project.cwd, 'package.json')))
  project.write('package.json', { ...pkg, version: '0.2.0' })
  project.commit('chore: prepare version')
  project.git('checkout', '-q', 'main')
  project.write('README.md', 'release documentation')
  project.commit('docs: update guide')
  project.git('-c', 'commit.gpgsign=false', 'merge', '--no-ff', '-qm', 'Merge release', 'release')
  project.git('tag', '-a', 'v0.2.0', '-m', 'Release')
  assert.equal(candidate(project).status, 0)
})

test('tag mismatch, moved checkout and empty verification cannot bypass candidate checks', t => {
  const project = releaseCandidate(t)
  assert.notEqual(candidate(project, { RELEASE_TAG: 'v0.9.0' }).status, 0)
  assert.notEqual(candidate(project, { VERIFY_COMMAND: '  ' }).status, 0)
  assert.notEqual(candidate(project, { EXPECTED_SHA: 'b'.repeat(40) }).status, 0)
  project.write('source.js', 'export const answer = 3\n')
  project.commit('fix: newer code')
  assert.notEqual(candidate(project).status, 0)
})

test('prereleases select next or an explicit channel and cannot use latest', t => {
  const project = releaseCandidate(t, '0.2.0-beta.1')
  const env = { RELEASE_TAG: 'v0.2.0-beta.1' }
  assert.equal(candidate(project, env).status, 0)
  assert.match(readFileSync(join(project.cwd, 'step-output'), 'utf8'), /npm-tag=next/)
  assert.equal(candidate(project, { ...env, NPM_TAG: 'beta' }).status, 0)
  assert.notEqual(candidate(project, { ...env, NPM_TAG: 'latest' }).status, 0)
})

test('canonical build metadata is preserved without making a stable version a prerelease', t => {
  for (const [version, tag] of [['0.2.0+build-1', 'latest'], ['0.2.0-beta.1+build.7', 'next']]) {
    const project = releaseCandidate(t, version)
    const result = candidate(project, { RELEASE_TAG: 'v' + version })
    assert.equal(result.status, 0, output(result))
    assert.deepEqual(fields(project.cwd), { 'source-sha': project.sha, version, 'npm-tag': tag })
  }
})

test('a failing consumer check stops the composite before packing or publication', t => {
  const project = fixture(t, '0.2.0')
  linkReleaseIt(project.cwd)
  const result = composite('npm-publish', project.cwd, { 'release-tag': 'v0.2.0', 'verify-command': 'exit 23' }, {
    GITHUB_SHA: project.git('rev-parse', 'HEAD'), GITHUB_REF: 'refs/tags/v0.2.0',
  })
  assert.notEqual(result.status, 0)
  assert.match(result.logs, /exited with code 23/)
  assert.equal(readdirSync(join(project.cwd, 'runner'), { recursive: true }).some(name => name.endsWith('.tgz')), false)
})

test('documentation artifacts reject changed sources, unsafe paths, empty sites and symlinks', t => {
  const project = fixture(t)
  const directory = artifact(project)
  const metadata = JSON.parse(readFileSync(join(directory, 'source.json')))
  assert.equal(metadata.schemaVersion, 1)
  assert.equal(metadata.sha, project.git('rev-parse', 'HEAD'))
  assert.equal(bundle(project, { SITE_DIRECTORY: '.' }).status === 0, false)
  assert.notEqual(bundle(project, { EXPECTED_SHA: 'a'.repeat(40) }).status, 0)
  mkdirSync(join(project.cwd, 'empty'))
  assert.notEqual(bundle(project, { SITE_DIRECTORY: 'empty' }).status, 0)
  const outside = fixture(t)
  outside.write('secret', 'keep')
  symlinkSync(join(outside.cwd, 'secret'), join(project.cwd, 'dist/link'))
  assert.notEqual(bundle(project).status, 0)
})

test('deployment adapters validate schema, repository, SHA and content without release or npm state', t => {
  const project = fixture(t)
  const directory = artifact(project)
  const metadata = JSON.parse(readFileSync(join(directory, 'source.json')))
  const validate = actionStep('docs-pages', 'Validate documentation artifact').run
  const env = { ARTIFACT_DIRECTORY: directory, EXPECTED_SHA: metadata.sha }
  assert.equal(runStep(validate, project.cwd, env).status, 0)
  for (const mutation of [{ schemaVersion: 2 }, { repository: 'other/project' }, { sha: 'b'.repeat(40) }, { siteDigest: 'bad' }]) {
    writeFileSync(join(directory, 'source.json'), JSON.stringify({ ...metadata, ...mutation }))
    assert.notEqual(runStep(validate, project.cwd, env).status, 0)
  }
  writeFileSync(join(directory, 'source.json'), JSON.stringify(metadata))
  writeFileSync(join(directory, 'site/index.html'), 'tampered')
  assert.notEqual(runStep(validate, project.cwd, env).status, 0)
})

test('Cloudflare restores only matching artifacts and protects root and symlinked destinations', t => {
  const project = fixture(t)
  const directory = artifact(project)
  project.write('public/stale.html', 'stale')
  const restore = actionStep('docs-cloudflare', 'Restore verified documentation').run
  const env = { ARTIFACT_DIRECTORY: directory, EXPECTED_SHA: project.git('rev-parse', 'HEAD'), SITE_DIRECTORY: 'public' }
  const result = runStep(restore, project.cwd, env)
  assert.equal(result.status, 0, output(result))
  assert.equal(readFileSync(join(project.cwd, 'public/index.html'), 'utf8'), '<h1>Docs</h1>')
  assert.equal(existsSync(join(project.cwd, 'public/stale.html')), false)
  for (const target of ['.', '..']) assert.notEqual(runStep(restore, project.cwd, { ...env, SITE_DIRECTORY: target }).status, 0)
  const outside = fixture(t)
  outside.write('public/keep.txt', 'keep')
  symlinkSync(outside.cwd, join(project.cwd, 'linked'))
  assert.notEqual(runStep(restore, project.cwd, { ...env, SITE_DIRECTORY: 'linked/public' }).status, 0)
  assert.equal(readFileSync(join(outside.cwd, 'public/keep.txt'), 'utf8'), 'keep')
  assert.notEqual(runStep(restore, project.cwd, { ...env, EXPECTED_SHA: 'a'.repeat(40) }).status, 0)
  project.write('source.js', 'changed deployment checkout')
  assert.notEqual(runStep(restore, project.cwd, env).status, 0)
})

test('documentation check failures stop builds and artifact uploads', t => {
  const project = fixture(t)
  const result = composite('docs-build', project.cwd, {
    'expected-sha': project.git('rev-parse', 'HEAD'), 'check-command': 'exit 29',
    'build-command': 'touch build-ran', 'site-directory': 'dist',
  }, {}, () => { assert.fail('A failing check reached artifact upload') })
  assert.equal(result.status, 29)
  assert.equal(existsSync(join(project.cwd, 'build-ran')), false)
})

test('dirty documentation source stops before checks, builds and artifact uploads', t => {
  for (const staged of [false, true]) {
    const project = fixture(t)
    project.write('source.js', 'uncommitted documentation source')
    if (staged) project.git('add', 'source.js')
    const result = composite('docs-build', project.cwd, {
      'expected-sha': project.git('rev-parse', 'HEAD'), 'check-command': 'touch check-ran',
      'build-command': 'mkdir dist && cp source.js dist/index.html && git restore --staged --worktree source.js',
      'site-directory': 'dist',
    }, {}, () => { assert.fail('Dirty source reached artifact upload') })
    assert.notEqual(result.status, 0, result.logs)
    assert.equal(existsSync(join(project.cwd, 'check-ran')), false)
    assert.equal(existsSync(join(project.cwd, 'dist')), false)
  }
})

test('artifact directory allocation failures stop before provider download', t => {
  const project = fixture(t)
  project.write('not-a-directory', 'keep')
  for (const name of ['docs-pages', 'docs-cloudflare']) {
    project.write('step-output', '')
    const result = runStep(actionStep(name, 'directory').run, project.cwd, { RUNNER_TEMP: join(project.cwd, 'not-a-directory') })
    assert.notEqual(result.status, 0, output(result))
    assert.equal(readFileSync(join(project.cwd, 'step-output'), 'utf8'), '')
  }
})

test('recipes select node or mise explicitly and reject unknown toolchains', t => {
  const project = fixture(t)
  const setup = action('setup')
  for (const job of [workflow('release').jobs.publish, workflow('check').jobs.check]) {
    assert.equal(job.steps.filter(item => item.uses === '$/actions/setup').length, 1)
    const validate = setup.runs.steps.find(item => item.name === 'Validate toolchain selection')
    for (const toolchain of ['node', 'mise', 'unknown']) {
      const result = runStep(validate.run, project.cwd, { TOOLCHAIN: toolchain })
      assert.equal(result.status === 0, toolchain !== 'unknown')
    }
    const selected = mode => setup.runs.steps.filter(item => item.uses && /^(actions\/setup-node|jdx\/mise-action)@/.test(item.uses)).filter(item => {
      if (!item.if) return true
      const match = item.if.match(/^inputs\.toolchain == '([^']+)'$/)
      assert.ok(match, 'Unsupported toolchain selector')
      return match[1] === mode
    }).map(item => item.uses.split('@')[0])
    assert.deepEqual(selected('node'), ['actions/setup-node'])
    assert.deepEqual(selected('mise'), ['jdx/mise-action'])
  }
})

function checkInputs(contract, call, location) {
  for (const [key, value] of Object.entries(contract.inputs || {}))
    if (value.required) assert.ok(key in (call.with || {}), location + ': missing ' + key)
  for (const key of Object.keys(call.with || {})) assert.ok(key in contract.inputs, location + ': unknown ' + key)
  for (const [key, value] of Object.entries(contract.secrets || {}))
    if (value.required) assert.ok(key in (call.secrets || {}), location + ': missing secret ' + key)
}

test('all consumer and same-commit recipe calls satisfy actual action/workflow contracts', () => {
  const files = []
  for (const directory of readdirSync(join(root, 'examples')))
    for (const file of readdirSync(join(root, 'examples', directory)))
      if (file.endsWith('.yml')) files.push(join(root, 'examples', directory, file))
  for (const name of readdirSync(join(root, '.github/workflows')))
    if (name.endsWith('.yml')) files.push(join(root, '.github/workflows', name))
  for (const file of files) {
    const document = parse(readFileSync(file, 'utf8'))
    for (const job of Object.values(document.jobs)) {
      if (job.uses?.startsWith('xova-dev/actions/')) {
        const name = job.uses.match(/\/([^/]+)\.yml@/)[1]
        checkInputs(workflow(name).on.workflow_call, job, file)
      }
      if (job.uses?.startsWith('./.github/workflows/')) {
        const name = job.uses.split('/').at(-1)
        const target = file.includes('/examples/') ? join(file, '..', name) : join(root, '.github/workflows', name)
        checkInputs(parse(readFileSync(target, 'utf8')).on.workflow_call, job, file)
      }
      for (const item of job.steps || []) {
        const match = item.uses?.match(/^(?:\$\/|xova-dev\/actions\/)actions\/([a-z-]+)(?:@.*)?$/)
        if (match) checkInputs(action(match[1]), item, file)
      }
      for (const dependency of [job.needs || []].flat()) assert.ok(dependency in document.jobs, file + ': unknown dependency ' + dependency)
    }
  }
})
