import { appendFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { candidate, pack, verifyPackedCandidate } from './npm.mjs'
import { publicationResult } from './publication-result.mjs'

// Use the caller's locked release-it installation, as the native CLI does.
const require = createRequire(resolve('package.json'))
const { Plugin } = await import(pathToFileURL(require.resolve('release-it')))

export default class VerifiedPackage extends Plugin {
  init() {
    this.checked = candidate(process.env)
    this.packageName = JSON.parse(readFileSync('package.json', 'utf8')).name
  }

  async beforeRelease() {
    if (this.config.isDryRun) return false
    const check = command => this.exec(['bash', '-e', '-o', 'pipefail', '-c', command], { options: { external: true, cache: false } })
    await check(process.env.VERIFY_COMMAND)
    const digest = pack(process.env)
    if (process.env.PACKAGE_VERIFY_COMMAND?.trim()) await check(process.env.PACKAGE_VERIFY_COMMAND)
    verifyPackedCandidate(process.env, digest)
    this.tarballSha256 = digest
  }

  afterRelease() {
    if (this.config.isDryRun) return false
    // Git/GitHub/GitLab publishers are disabled by this preset; npm sets this only after publication.
    if (this.config.getContext('isReleased') !== true)
      throw new Error('The native npm publisher did not confirm publication; no successful result was generated.')
    let result
    try {
      result = publicationResult(process.env, this.checked, this.packageName, this.tarballSha256)
    } catch (error) {
      throw new Error('npm publication succeeded, but saving its result failed. Do not republish; inspect this npm job and provenance.', { cause: error })
    }
    for (const [key, value] of Object.entries(result))
      appendFileSync(process.env.GITHUB_OUTPUT, key + '=' + value + '\n')
  }
}
