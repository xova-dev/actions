import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { test } from 'node:test'
import { parse } from 'yaml'
import { action, actionStep, fixture, linkReleaseIt, output, root, runStep, stubNpmPublication, workflow } from './helpers.mjs'
import { composite } from './composite.mjs'

const example = (directory, file) => parse(readFileSync(join(root, 'examples', directory, file), 'utf8'))

test('a downloaded toolkit verifies and publishes with bundled semver and no toolkit node_modules', t => {
  const project = fixture(t, '0.2.0')
  const toolkit = join(project.cwd, 'downloaded-toolkit')
  for (const directory of ['actions', 'lib', 'config', 'dist'])
    cpSync(join(root, directory), join(toolkit, directory), { recursive: true })
  linkReleaseIt(project.cwd)
  const env = {
    ...stubNpmPublication(project), XOVA_ACTION_PATH: join(toolkit, 'actions/npm-publish'),
    RELEASE_TAG: 'v0.2.0', NPM_TAG: 'auto', VERIFY_COMMAND: 'mkdir dist && cp source.js dist/index.js',
    GITHUB_SHA: project.git('rev-parse', 'HEAD'), GITHUB_REF: 'refs/tags/v0.2.0',
  }
  const candidate = runStep(actionStep('npm-publish', 'candidate').run, project.cwd, env)
  assert.equal(candidate.status, 0, output(candidate))
  const result = runStep(actionStep('npm-publish', 'publish').run, project.cwd, {
    ...env, NPM_TAG: 'latest', EXPECTED_SHA: env.GITHUB_SHA, EXPECTED_VERSION: '0.2.0',
  })
  assert.equal(result.status, 0, output(result))
  assert.equal(existsSync(join(toolkit, 'node_modules')), false)
  assert.equal(existsSync(join(project.cwd, 'publication.json')), true)
})

for (const [directory, packageDirectory, tag] of [
  ['npm-package', '.', 'v1.0.0'], ['subpackage', 'packages/widget', 'widget@2.0.0'],
]) {
  test(directory + ' installs, verifies, builds and packs through the public composite without mise or pnpm', t => {
    const project = fixture(t)
    cpSync(join(root, 'examples', directory), project.cwd, { recursive: true, filter: path => basename(path) !== 'node_modules' })
    const sha = project.commit('feat: independent consumer')
    project.git('tag', tag)
    const document = example(directory, 'publish.yml')
    const call = directory === 'npm-package' ? document.jobs.publish : document.jobs.publish.steps.at(-1)
    const contract = workflow('npm-publish').on.workflow_call.inputs
    const install = directory === 'npm-package' ? contract['install-command'].default : document.jobs.publish.steps.find(item => item.run).run
    const env = { npm_config_cache: join(project.cwd, '.cache'), npm_config_audit: 'false', npm_config_fund: 'false', npm_config_userconfig: '/dev/null' }
    // Exercise source installation offline; CI separately installs all locked dev tools.
    const installed = runStep(install + ' --omit=dev', join(project.cwd, packageDirectory), env)
    assert.equal(installed.status, 0, output(installed))
    linkReleaseIt(join(project.cwd, packageDirectory))
    const supplied = Object.fromEntries(Object.entries(call.with).filter(([key]) => key in action('npm-publish').inputs))
    supplied['release-tag'] = tag
    const result = composite('npm-publish', project.cwd, supplied, {
      ...env, GITHUB_SHA: sha, GITHUB_REF: 'refs/tags/' + tag, GITHUB_REPOSITORY: 'example/project',
      ...stubNpmPublication(project),
    })
    assert.equal(result.status, 0, result.logs)
    assert.equal(result.outputs['source-sha'], sha)
    const { args: published } = JSON.parse(readFileSync(join(project.cwd, 'publication.json')))
    assert.ok(published.includes('--provenance'))
    assert.ok(published.includes('--ignore-scripts'))
    const built = execFileSync('tar', ['-xOf', published[1], 'package/dist/index.mjs'], { encoding: 'utf8' })
    assert.match(built, directory === 'npm-package' ? /answer = 42/ : /widget = 'ready'/)
    const packed = JSON.parse(execFileSync('tar', ['-xOf', published[1], 'package/package.json'], { encoding: 'utf8' }))
    assert.equal(packed.repository.url, 'git+https://github.com/example/project.git')
    if (directory === 'subpackage') assert.equal(packed.repository.directory, 'packages/widget')
    assert.equal(existsSync(join(project.cwd, 'mise.toml')), false)
    assert.equal(existsSync(join(project.cwd, 'pnpm-lock.yaml')), false)
  })
}

test('a docs-only consumer builds and reaches Pages without package.json, npm publication or a GitHub Release', t => {
  const project = fixture(t)
  rmSync(join(project.cwd, 'package.json'))
  cpSync(join(root, 'examples/docs-only'), project.cwd, { recursive: true })
  const sha = project.commit('docs: independent documentation')
  const document = example('docs-only', 'docs.yml')
  const supplied = { ...document.jobs.build.steps.at(-1).with, 'expected-sha': sha }
  let artifact
  const build = composite('docs-build', project.cwd, supplied, {}, (uses, inputs) => {
    assert.match(uses, /^actions\/upload-artifact@/)
    assert.equal(inputs['include-hidden-files'], 'true')
    artifact = inputs.path
    return {}
  })
  assert.equal(build.status, 0, build.logs)
  const called = []
  const deploy = composite('docs-pages', project.cwd, { 'expected-sha': build.outputs['source-sha'] }, {}, (uses, inputs) => {
    called.push(uses)
    if (uses.startsWith('actions/download-artifact@')) return { 'download-path': artifact }
    if (uses.startsWith('actions/upload-pages-artifact@')) {
      assert.ok(existsSync(join(inputs.path, 'index.html')))
      assert.equal(inputs['include-hidden-files'], 'true')
      assert.equal(readFileSync(join(inputs.path, '.well-known/security.txt'), 'utf8'), 'Contact: mailto:security@example.invalid\n')
    }
    return { page_url: 'https://example.invalid/docs/' }
  })
  assert.equal(deploy.status, 0, deploy.logs)
  assert.equal(deploy.outputs['page-url'], 'https://example.invalid/docs/')
  assert.ok(called.some(uses => uses.startsWith('actions/deploy-pages@')))
  assert.equal(existsSync(join(project.cwd, 'package.json')), false)
  assert.equal('release-tag' in action('docs-pages').inputs, false)
  writeFileSync(join(artifact, 'site/index.html'), 'changed after upload')
  const rejected = composite('docs-pages', project.cwd, { 'expected-sha': sha }, {}, uses => {
    assert.match(uses, /^actions\/download-artifact@/, 'Invalid artifact reached Pages')
    return { 'download-path': artifact }
  })
  assert.notEqual(rejected.status, 0)
})

test('two deployment targets restore their own artifacts and run caller deployment commands', t => {
  const project = fixture(t)
  const sha = project.git('rev-parse', 'HEAD')
  const document = example('multi-site', 'docs.yml')
  const sites = document.jobs.deploy.strategy.matrix.site
  const groups = new Set()
  const downloads = new Set()
  for (const site of sites) {
    const source = 'built/' + site
    project.write(source + '/index.html', site)
    let artifact
    const build = composite('docs-build', project.cwd, {
      'expected-sha': sha, 'check-command': 'test -f ' + source + '/index.html',
      'build-command': 'true', 'site-directory': source, 'artifact-name': 'docs-' + site,
    }, {}, (uses, inputs) => { artifact = inputs.path; return {} })
    assert.equal(build.status, 0, build.logs)
    const deploy = composite('docs-cloudflare', project.cwd, {
      'expected-sha': sha, 'artifact-name': 'docs-' + site, 'site-directory': 'sites/' + site + '/dist',
      'deploy-command': 'cp sites/' + site + '/dist/index.html deployed-' + site,
    }, {}, (uses, inputs) => {
      assert.equal(inputs.name, 'docs-' + site)
      downloads.add(inputs.path)
      return { 'download-path': artifact }
    })
    assert.equal(deploy.status, 0, deploy.logs)
    assert.equal(readFileSync(join(project.cwd, 'deployed-' + site), 'utf8'), site)
    const group = workflow('docs-cloudflare').jobs.deploy.concurrency.group
      .replaceAll('$' + '{{ github.repository }}', 'fixture/project').replaceAll('$' + '{{ inputs.site-id }}', site)
    groups.add(group)
  }
  assert.equal(groups.size, 2)
  assert.equal(downloads.size, 2, 'Repeated actions shared an artifact download directory')
})
