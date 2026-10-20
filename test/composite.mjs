import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { action, output, root, runStep } from './helpers.mjs'

// Execute the shipped composite's shell steps; substitute only hosted Actions APIs.
export function composite(name, cwd, supplied = {}, env = {}, external = () => ({})) {
  const definition = action(name)
  const inputs = Object.fromEntries(Object.entries(definition.inputs || {}).map(([key, value]) => [key, value.default ?? '']))
  Object.assign(inputs, supplied)
  const temporary = env.RUNNER_TEMP || join(cwd, 'runner')
  mkdirSync(temporary, { recursive: true })
  const context = {
    inputs, steps: {}, runner: { temp: temporary },
    github: { action_path: join(root, 'actions', name), job: 'fixture', token: 'fixture-token' },
  }
  const interpolate = value => String(value).replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, key) => {
    let result = context
    for (const part of key.trim().split('.')) result = result?.[part]
    assert.notEqual(result, undefined, 'Unresolved composite expression: ' + key)
    return String(result)
  })
  let logs = ''
  for (const [index, item] of definition.runs.steps.entries()) {
    let fields
    if (item.uses) {
      fields = external(item.uses, Object.fromEntries(Object.entries(item.with || {}).map(([key, value]) => [key, interpolate(value)])))
    } else {
      const directory = resolve(cwd, interpolate(item['working-directory'] || '.'))
      const outputPath = join(temporary, 'output-' + name + '-' + index)
      writeFileSync(outputPath, '')
      const stepEnv = Object.fromEntries(Object.entries(item.env || {}).map(([key, value]) => [key, interpolate(value)]))
      const result = runStep(item.run, directory, { ...env, ...stepEnv, GITHUB_OUTPUT: outputPath, RUNNER_TEMP: temporary })
      logs += output(result)
      if (result.status !== 0) return { status: result.status, logs, outputs: {} }
      fields = Object.fromEntries(readFileSync(outputPath, 'utf8').trim().split('\n').filter(Boolean).map(line => {
        const equals = line.indexOf('=')
        return [line.slice(0, equals), line.slice(equals + 1)]
      }))
    }
    if (item.id) context.steps[item.id] = { outputs: fields }
  }
  return { status: 0, logs, outputs: Object.fromEntries(Object.entries(definition.outputs || {}).map(([key, value]) => [key, interpolate(value.value)])) }
}
