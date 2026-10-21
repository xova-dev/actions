import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { action, output, root, runStep } from './helpers.mjs'

// Execute shipped steps; the caller supplies tools and substitutes hosted APIs.
export function composite(name, cwd, supplied = {}, env = {}, external = () => ({})) {
  const definition = action(name)
  const inputs = Object.fromEntries(Object.entries(definition.inputs || {}).map(([key, value]) => [key, value.default ?? '']))
  Object.assign(inputs, supplied)
  const temporary = env.RUNNER_TEMP || join(cwd, 'runner')
  mkdirSync(temporary, { recursive: true })
  const context = {
    inputs, steps: {}, runner: { temp: temporary, os: 'fixture-os', arch: 'fixture-arch' },
    github: { action_path: join(root, 'actions', name), workspace: cwd, job: 'fixture', token: 'fixture-token' },
  }
  // Substitute GitHub's expression/hash service, not the cache actions themselves.
  const hashFiles = (...patterns) => {
    const files = [...new Set(patterns.flatMap(pattern => [...globSync(pattern, { cwd })]))].sort()
    return files.length ? createHash('sha256').update(Buffer.concat(files.map(file => readFileSync(join(cwd, file))))).digest('hex') : ''
  }
  const evaluate = expression => Function('inputs', 'steps', 'runner', 'github', 'fromJSON', 'hashFiles', 'return (' + expression.replace(/'[^']*'|"[^"]*"|\.([\w-]+)/g, (match, key) => key ? '["' + key + '"]' : match) + ')')(inputs, context.steps, context.runner, context.github, JSON.parse, hashFiles)
  const interpolate = value => String(value).replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, expression) => {
    const result = evaluate(expression)
    assert.notEqual(result, undefined, 'Unresolved composite expression: ' + expression)
    return String(result)
  })
  const environment = {}
  const environmentPath = join(temporary, 'environment-' + name)
  writeFileSync(environmentPath, '')
  let logs = ''
  for (const [index, item] of definition.runs.steps.entries()) {
    if (item.if && !evaluate(item.if)) continue
    let fields
    if (item.uses) {
      fields = external(item.uses, Object.fromEntries(Object.entries(item.with || {}).map(([key, value]) => [key, interpolate(value)])))
    } else {
      const directory = resolve(cwd, interpolate(item['working-directory'] || '.'))
      const outputPath = join(temporary, 'output-' + name + '-' + index)
      writeFileSync(outputPath, '')
      const stepEnv = Object.fromEntries(Object.entries(item.env || {}).map(([key, value]) => [key, interpolate(value)]))
      const result = runStep(item.run, directory, { ...env, ...environment, ...stepEnv, GITHUB_OUTPUT: outputPath, GITHUB_ENV: environmentPath, RUNNER_TEMP: temporary })
      logs += output(result)
      if (result.status !== 0) return { status: result.status, logs, outputs: {} }
      fields = Object.fromEntries(readFileSync(outputPath, 'utf8').trim().split('\n').filter(Boolean).map(line => {
        const equals = line.indexOf('=')
        return [line.slice(0, equals), line.slice(equals + 1)]
      }))
      for (const line of readFileSync(environmentPath, 'utf8').trim().split('\n').filter(Boolean)) {
        const equals = line.indexOf('=')
        environment[line.slice(0, equals)] = line.slice(equals + 1)
      }
    }
    if (item.id) context.steps[item.id] = { outputs: fields }
  }
  return { status: 0, logs, environment, outputs: Object.fromEntries(Object.entries(definition.outputs || {}).map(([key, value]) => [key, interpolate(value.value)])) }
}
