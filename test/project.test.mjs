import assert from 'node:assert/strict'
import { cpSync, existsSync, readFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { composite } from './composite.mjs'
import { actionStep, fixture, linkReleaseIt, output, root, runStep, stubNpmPublication, workflow } from './helpers.mjs'

const settings = () => ({
  schemaVersion: 1, setup: { 'install-command': ':' },
  code: { 'check-command': 'node --check source.js', 'docs-only-command': 'true', 'docs-only-paths': ['docs/**', 'README.md'] },
  npm: { 'verify-command': 'mkdir dist && cp source.js dist/index.js' },
  docs: { provider: 'pages', 'check-command': 'node --check source.js', 'build-command': 'mkdir site && cp source.js site/index.html', 'site-directory': 'site' },
})
function configured(t, config = settings()) {
  const project = fixture(t)
  project.write('.github/xova.json', config)
  const sha = project.commit('chore: configure project')
  const read = (task = 'code', inputs = {}, env = {}) => composite('project-config', project.cwd, {
    task, 'expected-sha': project.git('rev-parse', 'HEAD'), ...inputs,
  }, env)
  return { ...project, sha, read }
}

test('project configuration supplies shared defaults and remains independent of toolkit dependencies', t => {
  const project = configured(t)
  const toolkit = join(project.cwd, 'downloaded-toolkit')
  for (const name of ['lib', 'dist']) cpSync(join(root, name), join(toolkit, name), { recursive: true })
  const result = runStep(actionStep('project-config', 'config').run, project.cwd, {
    XOVA_ACTION_PATH: join(toolkit, 'actions/project-config'), CONFIG_FILE: '.github/xova.json', EXPECTED_SHA: project.sha, PROJECT_TASK: 'code',
  })
  assert.equal(result.status, 0, output(result))
  assert.equal(existsSync(join(toolkit, 'node_modules')), false)
  const parsed = project.read()
  assert.equal(parsed.status, 0, parsed.logs)
  const config = JSON.parse(parsed.outputs.config)
  assert.equal(config.setup.toolchain, 'node')
  assert.equal(config.docs['install-command'], ':')
  assert.equal(config.docs['working-directory'], config.setup['working-directory'])
  assert.equal(parsed.outputs['source-sha'], project.sha)
})

test('source guards run without configuration readers or unrelated runtime bundles', t => {
  const project = configured(t)
  const toolkit = 'source-toolkit'
  for (const name of ['cli.mjs', 'git.mjs'])
    project.write(toolkit + '/lib/' + name, readFileSync(join(root, 'lib', name), 'utf8'))
  project.write(toolkit + '/actions/check-source/action.yml', readFileSync(join(root, 'actions/check-source/action.yml'), 'utf8'))
  const checked = runStep(actionStep('check-source', 'source').run, project.cwd, {
    XOVA_ACTION_PATH: join(project.cwd, toolkit, 'actions/check-source'), EXPECTED_SHA: project.sha,
  })
  assert.equal(checked.status, 0, output(checked))
  assert.equal(readFileSync(join(project.cwd, 'step-output'), 'utf8'), 'source-sha=' + project.sha + '\n')
})

test('the schema rejects unknown fields, invalid types, empty commands and unsupported selections', t => {
  for (const mutate of [
    config => { config.schemaVersion = 2 },
    config => { config.extra = true },
    config => { config.setup = null },
    config => { config.setup.toolchain = 'unknown' },
    config => { config.npm['package-manager'] = 'unknown' },
    config => { config.docs.provider = 'unknown' },
    config => { config.docs['deployment-policy'] = 'unknown' },
    config => { config.code['check-command'] = '  ' },
    config => { config.code['check-command'] = 'echo first\necho second' },
    config => { config.code['docs-only-paths'] = 'docs/**' },
    config => { config.code['check-comand'] = 'true' },
  ]) {
    const config = settings()
    mutate(config)
    const project = configured(t, config)
    const result = project.read()
    assert.notEqual(result.status, 0, JSON.stringify(config))
    assert.match(result.logs, /Invalid project configuration/)
    assert.deepEqual(result.outputs, {})
  }
})

test('configuration must belong to the exact clean tracked source and stay within the repository', t => {
  const project = configured(t)
  assert.notEqual(project.read('code', { 'expected-sha': 'a'.repeat(40) }).status, 0)
  project.write('untracked.json', settings())
  assert.notEqual(project.read('code', { 'config-file': 'untracked.json' }).status, 0)
  project.write('.github/xov*.json', settings())
  assert.notEqual(project.read('code', { 'config-file': '.github/xov*.json' }).status, 0, 'A filename must not be interpreted as a Git pathspec')
  const outside = configured(t)
  symlinkSync(join(outside.cwd, '.github/xova.json'), join(project.cwd, 'external.json'))
  assert.notEqual(project.read('code', { 'config-file': 'external.json' }).status, 0)
  project.write('.github/xova.json', { ...settings(), setup: { 'install-command': 'touch not-executed' } })
  assert.notEqual(project.read().status, 0)
  assert.equal(existsSync(join(project.cwd, 'not-executed')), false)
})

test('docs-only optimization handles real changes and never replaces final-candidate checks', t => {
  for (const [file, changed] of [['docs/guide.md', 'false'], ['README.md', 'false'], ['source.js', 'true'], ['.github/xova.json', 'true']]) {
    const project = configured(t)
    project.write(file, file.endsWith('.json') ? { ...settings(), setup: { 'node-version': '26' } } : 'changed')
    project.commit('docs: or source changes')
    const inputs = { 'detect-changes': 'true', 'base-sha': project.sha }
    const ordinary = project.read('code', inputs, { GITHUB_EVENT_NAME: 'push' })
    assert.equal(ordinary.status, 0, ordinary.logs)
    assert.equal(ordinary.outputs['code-changed'], changed, file)
    const release = project.read('release', inputs)
    assert.equal(release.status, 0, release.logs)
    assert.equal(release.outputs['code-changed'], 'true')
  }
  const renamed = configured(t)
  renamed.write('docs/README.md', 'documentation')
  renamed.git('mv', 'source.js', 'docs/source.js')
  renamed.commit('docs: move source')
  assert.equal(renamed.read('code', { 'detect-changes': 'true', 'base-sha': renamed.sha }, { GITHUB_EVENT_NAME: 'push' }).outputs['code-changed'], 'true')
  const tagged = configured(t)
  tagged.write('docs/guide.md', 'documentation')
  tagged.commit('docs: tagged candidate')
  for (const env of [{ GITHUB_EVENT_NAME: 'release' }, { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/tags/v0.1.0' }, { GITHUB_EVENT_NAME: 'workflow_dispatch' }])
    assert.equal(tagged.read('code', { 'detect-changes': 'true', 'base-sha': tagged.sha }, env).outputs['code-changed'], 'true')
})

test('missing bases, empty diffs and manual runs conservatively retain complete code checks', t => {
  const project = configured(t)
  for (const base of ['', '0'.repeat(40), 'b'.repeat(40), project.sha]) {
    const result = project.read('code', { 'detect-changes': 'true', 'base-sha': base })
    assert.equal(result.status, 0, result.logs)
    assert.equal(result.outputs['code-changed'], 'true')
  }
  const invalid = project.read('typo')
  assert.notEqual(invalid.status, 0)
})

test('configuration uses the action default and rejects empty or missing file selections', t => {
  const project = configured(t)
  assert.equal(project.read('release').status, 0)
  for (const value of ['', '  ', 'missing.json']) {
    const rejected = project.read('release', { 'config-file': value })
    assert.notEqual(rejected.status, 0, value)
    assert.deepEqual(rejected.outputs, {})
  }
  const unconfigured = configured(t)
  unconfigured.git('rm', '.github/xova.json')
  unconfigured.commit('chore: remove configuration')
  const missing = unconfigured.read('release')
  assert.notEqual(missing.status, 0)
  assert.match(missing.logs, /ENOENT/)
  assert.deepEqual(missing.outputs, {})
})

test('configured publication builds, tests and publishes the same bytes through native release-it', t => {
  const project = configured(t)
  project.git('tag', '-f', 'v0.1.0')
  linkReleaseIt(project.cwd)
  const resolved = project.read('release')
  assert.equal(resolved.status, 0, resolved.logs)
  const { npm } = JSON.parse(resolved.outputs.config)
  const published = composite('npm-publish', project.cwd, { ...npm, 'release-tag': 'v0.1.0', 'expected-sha': project.sha,
    'package-verify-command': 'test -f "$TARBALL"',
  }, { ...stubNpmPublication(project), GITHUB_SHA: project.sha, GITHUB_REF: 'refs/tags/v0.1.0' })
  assert.equal(published.status, 0, published.logs)
  const record = JSON.parse(readFileSync(join(project.cwd, 'publication.json')))
  assert.equal(record.digest, published.outputs['tarball-sha256'])
  assert.equal(published.outputs['source-sha'], project.sha)
})

test('independent docs checks and delivery share configuration without an npm package or release', t => {
  const config = settings()
  delete config.npm
  delete config.code
  config.docs['deployment-policy'] = 'always'
  const project = configured(t, config)
  project.git('rm', 'package.json')
  const sha = project.commit('docs: standalone site')
  const checked = project.read('docs')
  assert.equal(checked.status, 0, checked.logs)
  const { docs } = JSON.parse(checked.outputs.config)
  let artifact
  const built = composite('docs-build', project.cwd, { ...docs, 'expected-sha': sha }, {}, (_, inputs) => { artifact = inputs.path; return {} })
  assert.equal(built.status, 0, built.logs)
  const selected = project.read('deploy')
  assert.equal(selected.status, 0, selected.logs)
  assert.deepEqual(JSON.parse(selected.outputs.config).docs, docs)
  const deployed = composite('docs-pages', project.cwd, { 'expected-sha': sha }, {}, (uses, inputs) => {
    if (uses.startsWith('actions/download-artifact@')) return { 'download-path': artifact }
    if (uses.startsWith('actions/upload-pages-artifact@'))
      assert.equal(readFileSync(join(inputs.path, 'index.html'), 'utf8'), readFileSync(join(project.cwd, 'source.js'), 'utf8'))
    return { page_url: 'https://example.invalid/docs/' }
  })
  assert.equal(deployed.status, 0, deployed.logs)
  assert.equal(existsSync(join(project.cwd, 'package.json')), false)
})

test('check receipts follow successful work and the final source guard', t => {
  const definition = workflow('check')
  assert.deepEqual(Object.keys(definition.jobs), ['check'])
  const job = definition.jobs.check
  const confirm = job.steps.at(-1)
  assert.equal(confirm.id, 'checked')
  assert.equal(confirm.uses, '$/actions/check-source')
  assert.equal(job.steps.filter(step => step.uses === '$/actions/project-config').length, 1)
  assert.equal(confirm.if, undefined, 'The final guard must retain the default success condition')
  assert.equal(job.outputs['source-sha'], '$' + '{{ steps.checked.outputs.source-sha }}')
  assert.match(job.outputs['code-changed'], /steps.checked.outputs.source-sha != ''/)
  for (const step of job.steps) assert.equal(step['continue-on-error'], undefined)
  const project = configured(t)
  const command = job.steps.find(step => step.name === 'Check source').run
  const failed = runStep(command, project.cwd, { COMMAND: 'exit 23' })
  assert.equal(failed.status, 23)
  assert.equal(existsSync(join(project.cwd, 'step-output')), false)
  assert.equal(runStep(command, project.cwd, { COMMAND: 'printf changed > source.js' }).status, 0)
  const changed = composite('check-source', project.cwd, { 'expected-sha': project.sha })
  assert.notEqual(changed.status, 0, changed.logs)
  assert.deepEqual(changed.outputs, {})
  for (const name of ['release', 'docs-recover']) {
    for (const item of Object.values(workflow(name).jobs))
      for (const value of Object.values(item.with || {})) assert.doesNotMatch(value, /code-changed|detect-changes/)
  }
})
