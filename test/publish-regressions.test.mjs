import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseProjectConfig } from '../dist/project-config.mjs'
import { actionStep, fixture, output, root, runStep } from './helpers.mjs'

test('publication rejects event SHA or ref mismatches before exporting the candidate', t => {
  const project = fixture(t, '0.2.0')
  const sha = project.git('rev-parse', 'HEAD')
  const env = {
    RELEASE_TAG: 'v0.2.0', NPM_TAG: 'auto', VERIFY_COMMAND: 'pnpm check',
    EXPECTED_SHA: sha, GITHUB_SHA: sha, GITHUB_REF: 'refs/tags/v0.2.0',
  }
  const validate = actionStep('npm-publish', 'candidate').run
  for (const event of ['release', 'workflow_dispatch']) {
    const result = runStep(validate, project.cwd, { ...env, GITHUB_EVENT_NAME: event })
    assert.equal(result.status, 0, output(result))
  }
  for (const mismatch of [
    { GITHUB_SHA: 'b'.repeat(40), GITHUB_REF: 'refs/heads/main' },
    { GITHUB_SHA: 'b'.repeat(40) },
    { GITHUB_REF: 'refs/heads/main' },
    { GITHUB_REF: 'refs/tags/v0.1.0' },
    { GITHUB_SHA: '' },
    { GITHUB_REF: '' },
  ]) {
    project.write('step-output', '')
    const result = runStep(validate, project.cwd, { ...env, GITHUB_EVENT_NAME: 'workflow_dispatch', ...mismatch })
    assert.notEqual(result.status, 0, 'Publication accepted a mismatched event: ' + JSON.stringify(mismatch))
    assert.equal(readFileSync(join(project.cwd, 'step-output'), 'utf8'), '')
  }
})

test('RSP consumer verification installs a packed package with a cold npm cache', async t => {
  const project = fixture(t)
  const home = join(project.cwd, 'home')
  mkdirSync(home)
  const tools = join(project.cwd, 'tools')
  mkdirSync(tools)
  symlinkSync('/bin/bash', join(tools, 'bash'))
  const packEnv = {
    PATH: process.env.PATH, HOME: home, CI: 'true',
    npm_config_userconfig: '/dev/null', npm_config_cache: join(project.cwd, 'packing-cache'),
  }
  function pack(directory, manifest, source) {
    project.write(directory + '/package.json', manifest)
    project.write(directory + '/index.js', source)
    const [result] = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', project.cwd], {
      cwd: join(project.cwd, directory), encoding: 'utf8', env: packEnv,
    }))
    return join(project.cwd, result.filename)
  }
  const dependency = pack('dependency', { name: 'xova-cold-cache-dependency', version: '1.0.0' }, "module.exports = 'cold-cache-installed'\n")
  let requests = 0
  const server = createServer((request, response) => {
    if (request.url !== '/dependency.tgz') { response.writeHead(404).end(); return }
    requests++
    response.writeHead(200, { 'content-type': 'application/octet-stream' })
    response.end(readFileSync(dependency))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  const registry = 'http://127.0.0.1:' + server.address().port
  const tarball = pack('package-to-install', {
    name: 'xova-rsp-install-fixture', version: '1.0.0',
    dependencies: { 'xova-cold-cache-dependency': registry + '/dependency.tgz' },
  }, "module.exports = require('xova-cold-cache-dependency')\n")
  project.write('package.json', { name: 'xova-rsp-check-fixture', version: '1.0.0', private: true, scripts: { 'test:pack': 'node verify-clean-install.mjs' } })
  project.write('verify-clean-install.mjs', [
    "import assert from 'node:assert/strict'",
    "import { spawnSync } from 'node:child_process'",
    "import { mkdirSync, writeFileSync } from 'node:fs'",
    "import { createRequire } from 'node:module'",
    "import { join } from 'node:path'",
    "const consumer = join(process.cwd(), 'clean-consumer')",
    "mkdirSync(consumer)",
    "writeFileSync(join(consumer, 'package.json'), JSON.stringify({name:'consumer',version:'1.0.0',private:true}))",
    "const allowNetwork = process.env.RSP_INSTALL_ALLOW_NETWORK === '1'",
    "const env = {PATH:process.env.PATH, HOME:process.env.FIXTURE_HOME, CI:'true', npm_config_userconfig:'/dev/null', npm_config_registry:process.env.FIXTURE_REGISTRY, npm_config_cache:join(process.cwd(),'.cache/rsp-package-install')}",
    "const result = spawnSync('npm', ['install','--ignore-scripts','--no-audit','--no-fund',...(allowNetwork ? [] : ['--offline']),process.env.FIXTURE_TARBALL], {cwd:consumer,env,stdio:'inherit'})",
    "if (result.status !== 0) process.exit(result.status || 1)",
    "const require = createRequire(join(consumer, 'package.json'))",
    "assert.equal(require('xova-rsp-install-fixture'), 'cold-cache-installed')",
    "writeFileSync('check-passed', String(allowNetwork))",
  ].join('\n'))
  const config = parseProjectConfig(JSON.parse(readFileSync(join(root, 'examples/rsp/xova.json'), 'utf8')), 'release')
  const command = config.npm['package-verify-command']
  const result = await new Promise((resolve, reject) => {
    const child = spawn('bash', ['-e', '-o', 'pipefail', '-c', command], {
      cwd: project.cwd, timeout: 20000,
      env: {
        PATH: tools + ':' + process.env.PATH, HOME: home, CI: 'true', npm_config_userconfig: '/dev/null',
        RSP_INSTALL_ALLOW_NETWORK: '',
        FIXTURE_HOME: home, FIXTURE_REGISTRY: registry, FIXTURE_TARBALL: tarball,
      },
    })
    let logs = ''
    child.stdout.on('data', data => { logs += data })
    child.stderr.on('data', data => { logs += data })
    child.on('error', reject)
    child.on('close', status => resolve({ status, logs }))
  })
  assert.equal(result.status, 0, result.logs)
  assert.equal(readFileSync(join(project.cwd, 'check-passed'), 'utf8'), 'true')
  assert.ok(requests > 0, 'The cold cache did not fetch the local dependency tarball')
})
