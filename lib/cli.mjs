import { appendFileSync, mkdirSync } from 'node:fs'
import { candidate } from './npm.mjs'
import { bundle, restore, source, validate } from './docs.mjs'
import { latestRelease } from './latest-release.mjs'
import { releaseSource } from './release-source.mjs'

try {
  const command = { 'release-source': releaseSource, 'npm-candidate': candidate, 'docs-source': source, 'docs-bundle': bundle, 'docs-validate': validate, 'docs-restore': restore, 'latest-release': latestRelease }[process.argv[2]]
  if (!command) throw new Error('Unknown toolkit command.')
  if (process.env.RUNNER_TEMP) mkdirSync(process.env.RUNNER_TEMP, { recursive: true })
  const outputs = command(process.env)
  for (const [key, value] of Object.entries(outputs)) {
    if (/[\r\n]/.test(String(value))) throw new Error('Action outputs cannot contain newlines.')
    appendFileSync(process.env.GITHUB_OUTPUT, key + '=' + value + '\n')
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
