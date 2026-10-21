import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const directories = ['.github/workflows', ...readdirSync('examples', { withFileTypes: true })
  .filter(entry => entry.isDirectory()).map(entry => join('examples', entry.name))]
const files = directories.flatMap(directory => readdirSync(directory)
  .filter(name => /\.ya?ml$/.test(name)).map(name => join(directory, name)))
const localExamples = directories.filter(directory => directory.startsWith('examples/')
  && files.some(file => file.startsWith(directory + '/') && readFileSync(file, 'utf8').includes('./.github/workflows/')))

function actionFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return actionFiles(path)
    return entry.isFile() && /^action\.ya?ml$/.test(entry.name) ? [path] : []
  })
}

// actionlint 1.7.12 predates same-commit references; tests check their contracts.
const checks = [
  ['actionlint', ['-color', '-ignore', 'specifying action "\\$/actions/[a-z-]+" in invalid format because ref is missing', ...files.filter(file => !localExamples.some(directory => file.startsWith(directory + '/')))]],
  ['action-validator', actionFiles('actions')],
]
let status = 0
for (const [tool, args] of checks) {
  const result = spawnSync(tool, args, { stdio: 'inherit' })
  if (result.error) console.error(result.error.message)
  if (result.status !== 0 && status === 0) status = result.status ?? 1
}
process.exitCode = status
// Local workflow calls resolve in the consumer layout, not this toolkit's root.
for (const directory of localExamples) {
  const temporary = mkdtempSync(join(tmpdir(), 'xova-lint-'))
  try {
    const initialized = spawnSync('git', ['init', '-q', temporary], { encoding: 'utf8' })
    if (initialized.status !== 0) throw new Error('Could not initialize the consumer lint layout.')
    const workflows = join(temporary, '.github/workflows')
    mkdirSync(workflows, { recursive: true })
    const names = readdirSync(directory).filter(name => /\.ya?ml$/.test(name))
    for (const name of names) cpSync(join(directory, name), join(workflows, name))
    const result = spawnSync('actionlint', names.map(name => join('.github/workflows', name)), { cwd: temporary, stdio: 'inherit' })
    if (result.error) console.error(result.error.message)
    if (result.status !== 0) {
      console.error('Consumer workflow example: ' + directory)
      if (!process.exitCode) process.exitCode = result.status ?? 1
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}
