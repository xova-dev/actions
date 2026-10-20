import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const directories = ['.github/workflows', ...readdirSync('examples', { withFileTypes: true })
  .filter(entry => entry.isDirectory()).map(entry => join('examples', entry.name))]
const files = directories.flatMap(directory => readdirSync(directory)
  .filter(name => /\.ya?ml$/.test(name)).map(name => join(directory, name)))

function actionFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return actionFiles(path)
    return entry.isFile() && /^action\.ya?ml$/.test(entry.name) ? [path] : []
  })
}

// actionlint 1.7.12 predates same-commit references; tests check their contracts.
const checks = [
  ['actionlint', ['-color', '-ignore', 'specifying action "\\$/actions/[a-z-]+" in invalid format because ref is missing', ...files]],
  ['action-validator', actionFiles('actions')],
]
let status = 0
for (const [tool, args] of checks) {
  const result = spawnSync(tool, args, { stdio: 'inherit' })
  if (result.error) console.error(result.error.message)
  if (result.status !== 0 && status === 0) status = result.status ?? 1
}
process.exitCode = status
