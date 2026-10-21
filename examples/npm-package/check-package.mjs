import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const cwd = mkdtempSync(join(tmpdir(), 'xova-package-consumer-'))
try {
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ private: true }))
  execFileSync('npm', ['install', process.env.TARBALL, '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd, stdio: 'inherit' })
  const { answer } = await import(pathToFileURL(join(cwd, 'node_modules/xova-npm-consumer-example/dist/index.mjs')))
  assert.equal(answer, 42)
} finally {
  rmSync(cwd, { recursive: true, force: true })
}
