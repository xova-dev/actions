import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

export const root = fileURLToPath(new URL('../', import.meta.url))
export const workflow = name => parse(readFileSync(join(root, '.github/workflows', name + '.yml'), 'utf8'))
export const action = name => parse(readFileSync(join(root, 'actions', name, 'action.yml'), 'utf8'))
export const actionStep = (name, id) => action(name).runs.steps.find(item => item.id === id || item.name === id)
export function fixture(t, version = '0.1.0') {
  const cwd = mkdtempSync(join(tmpdir(), 'xova-actions-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const write = (path, value) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true })
    writeFileSync(join(cwd, path), typeof value === 'string' ? value : JSON.stringify(value))
  }
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const commit = message => {
    git('add', '.')
    git('-c', 'commit.gpgsign=false', 'commit', '-qm', message)
    return git('rev-parse', 'HEAD')
  }
  git('init', '-q', '--initial-branch=main')
  git('config', 'user.name', 'Release Fixture [bot]')
  git('config', 'user.email', 'fixture@example.invalid')
  git('config', 'tag.gpgSign', 'false')
  git('config', 'core.hooksPath', '/dev/null')
  write('package.json', { name: 'xova-release-fixture', version, repository: 'github:fixture/project', files: ['dist/'] })
  write('source.js', 'export const answer = 1\n')
  write('CHANGELOG.md', '# Changelog\n')
  commit('chore: initial')
  git('tag', 'v' + version)
  return { cwd, write, git, commit }
}

export function runStep(run, cwd, env = {}) {
  return spawnSync('/bin/bash', ['-e', '-o', 'pipefail', '-c', run], {
    cwd, encoding: 'utf8', timeout: 30000,
    env: {
      ...process.env, npm_config_registry: 'http://127.0.0.1:9', npm_config_userconfig: '/dev/null',
      XOVA_ACTION_PATH: join(root, 'actions/npm-publish'), GITHUB_REPOSITORY: 'fixture/project',
      GITHUB_OUTPUT: join(cwd, 'step-output'), RUNNER_TEMP: join(cwd, 'runner'), ...env,
    },
  })
}
export const output = result => result.stdout + result.stderr
export const step = (name, id) => Object.values(workflow(name).jobs).flatMap(job => job.steps || []).find(item => item.id === id)

// Use the locked native CLI without network installation in temporary consumers.
export function linkReleaseIt(directory) {
  mkdirSync(join(directory, 'node_modules/.bin'), { recursive: true })
  symlinkSync(join(root, 'node_modules/release-it'), join(directory, 'node_modules/release-it'))
  symlinkSync('../release-it/bin/release-it.js', join(directory, 'node_modules/.bin/release-it'))
}

// Intercept only remote publication; execute all other npm commands normally.
export function stubNpmPublication(project) {
  const npm = execFileSync('/usr/bin/which', ['npm'], { encoding: 'utf8' }).trim()
  project.write('bin/npm.cjs', '#!' + process.execPath + '\n' + [
    "const fs=require('node:fs'), cp=require('node:child_process');",
    "if(process.argv[2]==='publish'){if(process.env.PUBLISH_FAILURE)process.exit(42);fs.writeFileSync(process.env.PUBLISH_RECORD,JSON.stringify({args:process.argv.slice(2),digest:require('node:crypto').createHash('sha256').update(fs.readFileSync(process.argv[3])).digest('hex')}));}",
    "else {const r=cp.spawnSync(process.env.FIXTURE_NPM,process.argv.slice(2),{stdio:'inherit'});process.exit(r.status??1);}",
  ].join('\n'))
  chmodSync(join(project.cwd, 'bin/npm.cjs'), 0o755)
  symlinkSync('npm.cjs', join(project.cwd, 'bin/npm'))
  symlinkSync('/bin/bash', join(project.cwd, 'bin/bash'))
  return {
    PATH: join(project.cwd, 'bin') + ':' + process.env.PATH,
    FIXTURE_NPM: npm, PUBLISH_RECORD: join(project.cwd, 'publication.json'),
  }
}
