import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { actionStep, fixture, linkReleaseIt, output, runStep, stubNpmPublication } from './helpers.mjs'
import { composite } from './composite.mjs'

function publicationFixture(t, manager = 'npm', version = '0.2.0', packedVersion = version) {
  const project = fixture(t, version)
  const pkg = JSON.parse(readFileSync(join(project.cwd, 'package.json')))
  project.write('package.json', {
    ...pkg, scripts: { prepack: 'node -e "process.exit(19)"' },
    'release-it': {
      git: { commit: true, tag: true, push: true }, npm: { publish: false },
      hooks: { 'before:init': 'touch consumer-hook-ran' }, plugins: { './unexpected-plugin.mjs': {} },
    },
    ...(manager === 'pnpm' ? { dependencies: {
      'xova-catalog-dependency': 'catalog:', 'xova-workspace-dependency': 'workspace:*',
    } } : {}),
  })
  if (manager === 'pnpm') {
    project.write('pnpm-workspace.yaml', 'packages: [packages/*]\ncatalog:\n  xova-catalog-dependency: ^3.2.1\n')
    project.write('packages/dependency/package.json', { name: 'xova-workspace-dependency', version: '1.2.3' })
  }
  project.write('.release-it.json', { hooks: { 'before:init': 'touch consumer-hook-ran' }, npm: { publish: false } })
  project.write('build.cjs', "const fs=require('node:fs');fs.mkdirSync('dist');fs.copyFileSync('source.js','dist/index.js')\n")
  project.write('verify-package.cjs', [
    "const fs=require('node:fs'), cp=require('node:child_process'), assert=require('node:assert/strict');",
    "const tarball=process.env.TARBALL; assert.ok(require('node:path').isAbsolute(tarball));",
    "const pkg=JSON.parse(cp.execFileSync('tar',['-xOf',tarball,'package/package.json']));",
    'assert.equal(pkg.version,' + JSON.stringify(packedVersion) + ');',
    "assert.match(cp.execFileSync('tar',['-xOf',tarball,'package/dist/index.js'],{encoding:'utf8'}),/answer = 1/);",
    ...(manager === 'pnpm' ? ["assert.deepEqual(pkg.dependencies,{'xova-catalog-dependency':'^3.2.1','xova-workspace-dependency':'1.2.3'});"] : []),
    "fs.writeFileSync('verified.json',JSON.stringify({tarball,digest:require('node:crypto').createHash('sha256').update(fs.readFileSync(tarball)).digest('hex')}));",
  ].join('\n'))
  const sha = project.commit('feat: package verification fixture')
  project.git('tag', '-f', 'v' + version)
  const publisher = stubNpmPublication(project)
  linkReleaseIt(project.cwd)
  const publish = (supplied = {}, env = {}, external) => composite('npm-publish', project.cwd, {
    'release-tag': 'v' + version, 'verify-command': 'node build.cjs',
    'package-manager': manager, 'package-verify-command': 'node verify-package.cjs', ...supplied,
  }, {
    GITHUB_SHA: sha, GITHUB_REF: 'refs/tags/v' + version, ...publisher,
    npm_config_cache: join(project.cwd, '.npm-cache'),
    GITHUB_STEP_SUMMARY: join(project.cwd, 'job-summary'), GITHUB_RUN_ID: '1234', GITHUB_RUN_ATTEMPT: '2',
    ...env,
  }, external)
  return { ...project, sha, publish, publisher }
}

for (const manager of ['npm', 'pnpm']) {
  test(manager + ' packs with lifecycle scripts disabled and publishes exactly the tarball checked by the consumer', t => {
    const project = publicationFixture(t, manager)
    const artifacts = []
    const result = project.publish({}, { NPM_TOKEN: 'not-in-publication-result' }, (uses, inputs) => {
      assert.match(uses, /^actions\/upload-artifact@/)
      assert.ok(existsSync(join(project.cwd, 'publication.json')), 'Result upload ran before npm succeeded')
      artifacts.push(inputs)
      return {}
    })
    assert.equal(result.status, 0, result.logs)
    const verified = JSON.parse(readFileSync(join(project.cwd, 'verified.json')))
    const published = JSON.parse(readFileSync(join(project.cwd, 'publication.json')))
    assert.equal(published.args[1], verified.tarball)
    assert.equal(published.digest, verified.digest)
    assert.deepEqual(published.args.slice(2), ['--tag', 'latest', '--access', 'public', '--provenance', '--ignore-scripts'])
    assert.equal(artifacts.length, 1)
    assert.deepEqual(result.outputs, {
      'source-sha': project.sha, version: '0.2.0', 'tarball-sha256': verified.digest,
      'publication-artifact': artifacts[0].name,
    })
    assert.equal(artifacts[0]['if-no-files-found'], 'error')
    assert.equal(artifacts[0].path, join(dirname(verified.tarball), 'publication-result.json'))
    const receipt = JSON.parse(readFileSync(artifacts[0].path, 'utf8'))
    assert.deepEqual(receipt, {
      schemaVersion: 1, status: 'published', repository: 'fixture/project',
      packageName: 'xova-release-fixture', version: '0.2.0', sourceVersion: '0.2.0', npmTag: 'latest',
      releaseTag: 'v0.2.0', sourceSha: project.sha, tarballSha256: published.digest,
      runId: '1234', runAttempt: '2', runUrl: 'https://github.com/fixture/project/actions/runs/1234',
    })
    const summary = readFileSync(join(project.cwd, 'job-summary'), 'utf8')
    assert.match(summary, /npm publication succeeded/)
    assert.ok(summary.includes(project.sha) && summary.includes(verified.digest) && summary.includes(artifacts[0].name))
    assert.ok(summary.includes('published-sha') && summary.includes('release-tag / recovery workflow ref'))
    assert.ok(!summary.includes('not-in-publication-result') && !JSON.stringify(receipt).includes('not-in-publication-result'))
    assert.equal(existsSync(join(project.cwd, 'consumer-hook-ran')), false)
    assert.equal(project.git('rev-parse', 'HEAD'), project.sha)
  })
}

test('release-it publishes prereleases to the selected channel without bumping or Git delivery', t => {
  const project = publicationFixture(t, 'npm', '0.2.0-beta.1')
  const result = project.publish()
  assert.equal(result.status, 0, result.logs)
  const published = JSON.parse(readFileSync(join(project.cwd, 'publication.json')))
  assert.equal(published.args[published.args.indexOf('--tag') + 1], 'next')
  assert.equal(result.outputs['source-sha'], project.sha)
  assert.equal(result.outputs.version, '0.2.0-beta.1')
  assert.equal(JSON.parse(readFileSync(join(dirname(published.args[1]), 'publication-result.json'))).npmTag, 'next')
  assert.equal(project.git('rev-parse', 'HEAD'), project.sha)
  assert.equal(project.git('tag'), 'v0.2.0-beta.1')
})

for (const manager of ['npm', 'pnpm']) {
  test(manager + ' publishes versions with build metadata using the normalized npm registry version', t => {
    for (const [version, registryVersion, channel] of [
      ['0.2.0+build.007', '0.2.0', 'latest'],
      ['0.2.0-beta.1+build.007', '0.2.0-beta.1', 'next'],
    ]) {
      const project = publicationFixture(t, manager, version, manager === 'pnpm' ? registryVersion : version)
      const result = project.publish()
      assert.equal(result.status, 0, result.logs)
      assert.equal(result.outputs['source-sha'], project.sha)
      assert.equal(result.outputs.version, registryVersion)
      const published = JSON.parse(readFileSync(join(project.cwd, 'publication.json')))
      const verified = JSON.parse(readFileSync(join(project.cwd, 'verified.json')))
      assert.equal(published.digest, verified.digest)
      const receipt = JSON.parse(readFileSync(join(dirname(verified.tarball), 'publication-result.json')))
      assert.equal(receipt.sourceVersion, version)
      assert.equal(receipt.version, registryVersion)
      assert.equal(receipt.tarballSha256, published.digest)
      assert.equal(published.args[published.args.indexOf('--tag') + 1], channel)
      assert.equal(JSON.parse(readFileSync(join(project.cwd, 'package.json'))).version, version)
    }
  })
}

test('an npm publication failure exits nonzero and exports no successful publication outputs', t => {
  const project = publicationFixture(t)
  const uploaded = []
  const result = project.publish({}, { PUBLISH_FAILURE: '1' }, uses => { uploaded.push(uses); return {} })
  assert.notEqual(result.status, 0)
  assert.equal(existsSync(join(project.cwd, 'publication.json')), false)
  assert.equal(readFileSync(join(project.cwd, 'runner/output-npm-publish-1'), 'utf8'), '')
  assert.equal(existsSync(join(project.cwd, 'job-summary')), false)
  assert.deepEqual(uploaded, [])
})

test('a skipped native npm publisher cannot generate successful publication evidence', t => {
  const project = publicationFixture(t)
  mkdirSync(join(project.cwd, 'runner'))
  const result = runStep(actionStep('npm-publish', 'publish').run.trimEnd() + ' --no-npm.publish', project.cwd, {
    ...project.publisher, RELEASE_TAG: 'v0.2.0', NPM_TAG: 'latest',
    VERIFY_COMMAND: 'node build.cjs', PACKAGE_VERIFY_COMMAND: 'node verify-package.cjs',
    EXPECTED_SHA: project.sha, EXPECTED_VERSION: '0.2.0',
    GITHUB_SHA: project.sha, GITHUB_REF: 'refs/tags/v0.2.0',
  })
  assert.notEqual(result.status, 0, output(result))
  assert.match(output(result), /npm publisher did not confirm publication/)
  assert.equal(existsSync(join(project.cwd, 'publication.json')), false)
  assert.equal(existsSync(join(project.cwd, 'step-summary')), false)
  assert.equal(existsSync(join(project.cwd, 'step-output')), false)
  const verified = JSON.parse(readFileSync(join(project.cwd, 'verified.json')))
  assert.equal(existsSync(join(dirname(verified.tarball), 'publication-result.json')), false)
})

test('a summary-writing failure warns and still uploads the successful JSON evidence', t => {
  const project = publicationFixture(t)
  const uploaded = []
  const result = project.publish({}, { GITHUB_STEP_SUMMARY: project.cwd }, (_, inputs) => { uploaded.push(inputs); return {} })
  assert.equal(result.status, 0, result.logs)
  assert.match(result.logs, /::warning::.*summary.*JSON result/)
  const published = JSON.parse(readFileSync(join(project.cwd, 'publication.json')))
  const receipt = JSON.parse(readFileSync(join(dirname(published.args[1]), 'publication-result.json')))
  assert.equal(receipt.tarballSha256, published.digest)
  assert.equal(receipt.sourceSha, project.sha)
  assert.equal(uploaded.length, 1)
  assert.equal(uploaded[0].path, join(dirname(published.args[1]), 'publication-result.json'))
  assert.equal(result.outputs['source-sha'], project.sha)
  assert.equal(result.outputs['publication-artifact'], uploaded[0].name)
})

test('a JSON-writing failure after npm succeeds remains fatal and explicitly warns against republishing', t => {
  const project = publicationFixture(t)
  project.write('block-result.cjs', "require('node:fs').mkdirSync(require('node:path').join(require('node:path').dirname(process.env.TARBALL), 'publication-result.json'))")
  const uploaded = []
  const result = project.publish({ 'package-verify-command': 'node verify-package.cjs && node block-result.cjs' }, {}, (_, inputs) => { uploaded.push(inputs); return {} })
  assert.notEqual(result.status, 0)
  assert.match(result.logs, /npm publication succeeded, but saving its result failed/)
  assert.match(result.logs, /Do not republish/)
  assert.equal(existsSync(join(project.cwd, 'publication.json')), true)
  assert.equal(existsSync(join(project.cwd, 'job-summary')), false)
  assert.deepEqual(uploaded, [])
})

test('an artifact upload failure retains the successful npm summary and result bytes', t => {
  const project = publicationFixture(t)
  assert.throws(() => project.publish({}, {}, () => {
    throw new Error('Artifact service unavailable')
  }), /Artifact service unavailable/)
  const published = JSON.parse(readFileSync(join(project.cwd, 'publication.json')))
  const receipt = JSON.parse(readFileSync(join(dirname(published.args[1]), 'publication-result.json')))
  assert.equal(receipt.tarballSha256, published.digest)
  const summary = readFileSync(join(project.cwd, 'job-summary'), 'utf8')
  assert.match(summary, /npm publication succeeded/)
  assert.ok(summary.includes(receipt.sourceSha) && summary.includes(receipt.tarballSha256))
})

test('npm dry-run configuration cannot be reported as successful publication', t => {
  for (const source of ['environment', 'project config']) {
    const project = publicationFixture(t, 'pnpm')
    if (source === 'project config') project.write('.npmrc', 'dry-run=true\n')
    const result = project.publish({}, source === 'environment' ? { npm_config_dry_run: 'true' } : {})
    assert.notEqual(result.status, 0, source + ' dry-run was accepted: ' + result.logs)
    assert.match(result.logs, /dry-run/)
    assert.equal(readFileSync(join(project.cwd, 'runner/output-npm-publish-0'), 'utf8'), '')
    assert.equal(existsSync(join(project.cwd, 'dist')), false)
    assert.equal(existsSync(join(project.cwd, 'publication.json')), false)
  }
})

test('an npm packer cannot silently publish pnpm catalog or workspace protocols', t => {
  const project = publicationFixture(t, 'pnpm')
  const result = project.publish({ 'package-manager': 'npm' })
  assert.notEqual(result.status, 0)
  assert.match(result.logs, /catalog:\/workspace:/)
  assert.equal(existsSync(join(project.cwd, 'dist')), false)
  assert.equal(existsSync(join(project.cwd, 'publication.json')), false)
})

test('an unsupported package manager fails before project checks', t => {
  const project = publicationFixture(t)
  const result = project.publish({ 'package-manager': 'yarn' })
  assert.notEqual(result.status, 0)
  assert.match(result.logs, /package-manager must be npm or pnpm/)
  assert.equal(existsSync(join(project.cwd, 'dist')), false)
})

test('invalid or noncanonical package versions fail before checks and candidate outputs', t => {
  for (const version of ['banana', '1.2', '01.2.3', 'v1.2.3', '1.2.3-beta.01']) {
    const project = publicationFixture(t, 'npm', version)
    const result = project.publish()
    assert.notEqual(result.status, 0, version + ' passed candidate preflight: ' + result.logs)
    assert.match(result.logs, /[Ss]em[Vv]er/)
    assert.equal(readFileSync(join(project.cwd, 'runner/output-npm-publish-0'), 'utf8'), '')
    assert.equal(existsSync(join(project.cwd, 'dist')), false)
    assert.equal(existsSync(join(project.cwd, 'publication.json')), false)
  }
})

test('dist-tags interpreted as semver ranges fail before checks and candidate outputs', t => {
  for (const tag of ['v1', 'v1.4', 'x', 'X']) {
    const project = publicationFixture(t)
    const result = project.publish({ 'npm-tag': tag })
    assert.notEqual(result.status, 0, tag + ' passed candidate preflight: ' + result.logs)
    assert.match(result.logs, /dist-tag/)
    assert.equal(readFileSync(join(project.cwd, 'runner/output-npm-publish-0'), 'utf8'), '')
    assert.equal(existsSync(join(project.cwd, 'dist')), false)
    assert.equal(existsSync(join(project.cwd, 'publication.json')), false)
  }
})

test('a dirty candidate cannot build from uncommitted source and restore it before packing', t => {
  const project = publicationFixture(t)
  project.write('source.js', 'export const answer = 999\n')
  const result = project.publish({
    'verify-command': 'node build.cjs && git restore source.js', 'package-verify-command': '',
  })
  assert.notEqual(result.status, 0, result.logs)
  assert.equal(existsSync(join(project.cwd, 'dist')), false)
  assert.equal(existsSync(join(project.cwd, 'publication.json')), false)
})

for (const [reason, metadata] of [
  ['another repository', { repository: 'github:other/project' }],
  ['a private package', { private: true }],
  ['another version', { version: '0.9.0' }],
]) {
  test('pnpm alternate publish directory rejects ' + reason, t => {
    const project = publicationFixture(t, 'pnpm')
    const pkg = JSON.parse(readFileSync(join(project.cwd, 'package.json')))
    project.write('package.json', { ...pkg, publishConfig: { directory: 'package' } })
    project.write('package/package.json', { name: pkg.name, version: pkg.version, repository: pkg.repository, ...metadata })
    const sha = project.commit('chore: alternate publish directory')
    project.git('tag', '-f', 'v0.2.0')
    const result = project.publish({ 'package-verify-command': '' }, { GITHUB_SHA: sha })
    assert.notEqual(result.status, 0, result.logs)
    assert.match(result.logs, /[Pp]acked package/)
    assert.equal(existsSync(join(project.cwd, 'publication.json')), false)
  })
}

for (const [reason, command] of [
  ['a failing tarball check', 'exit 31'],
  ['changed tarball bytes', 'printf changed >> "$TARBALL"'],
  ['npm dry-run enabled by the package check', 'printf "dry-run=true\n" > .npmrc'],
  ['changed source', 'printf changed >> source.js'],
  ['a replaced candidate commit', 'printf changed >> source.js && git -c commit.gpgsign=false commit -am "fix: changed candidate"'],
]) {
  test(reason + ' stops before publication', t => {
    const project = publicationFixture(t)
    const uploaded = []
    const result = project.publish({ 'package-verify-command': command }, {}, uses => { uploaded.push(uses); return {} })
    assert.notEqual(result.status, 0, result.logs)
    assert.equal(existsSync(join(project.cwd, 'publication.json')), false)
    assert.equal(existsSync(join(project.cwd, 'job-summary')), false)
    assert.deepEqual(uploaded, [])
  })
}
