import { appendFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { candidate, pack, verifyPackedCandidate } from './npm.mjs'
import { parse } from '../dist/semver.mjs'

// Use the caller's locked release-it installation, as the native CLI does.
const require = createRequire(resolve('package.json'))
const { Plugin } = await import(pathToFileURL(require.resolve('release-it')))

export default class VerifiedPackage extends Plugin {
  init() {
    this.checked = candidate(process.env)
  }

  async beforeRelease() {
    if (this.config.isDryRun) return false
    const check = command => this.exec(['bash', '-e', '-o', 'pipefail', '-c', command], { options: { external: true, cache: false } })
    await check(process.env.VERIFY_COMMAND)
    const digest = pack(process.env)
    if (process.env.PACKAGE_VERIFY_COMMAND?.trim()) await check(process.env.PACKAGE_VERIFY_COMMAND)
    verifyPackedCandidate(process.env, digest)
  }

  afterRelease() {
    if (this.config.isDryRun) return false
    appendFileSync(process.env.GITHUB_OUTPUT,
      'source-sha=' + this.checked['source-sha'] + '\nversion=' + parse(this.checked.version).version + '\n')
  }
}
