import { appendFileSync, mkdirSync } from 'node:fs'

try {
  // Source/artifact guards must not load configuration or npm-only dependencies.
  const route = new Map([
    ['project-config', ['./project.mjs', 'projectConfig']],
    ['release-source', ['./release-source.mjs', 'releaseSource']],
    ['npm-candidate', ['./npm.mjs', 'candidate']],
    ['source', ['./git.mjs', 'source']],
    ['docs-bundle', ['./docs.mjs', 'bundle']],
    ['docs-validate', ['./docs.mjs', 'validate']],
    ['docs-restore', ['./docs.mjs', 'restore']],
    ['latest-release', ['./latest-release.mjs', 'latestRelease']],
  ]).get(process.argv[2])
  if (!route) throw new Error('Unknown toolkit command.')
  const command = (await import(route[0]))[route[1]]
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
