import { join } from 'node:path'
import { composite } from './composite.mjs'
import { output, runStep, workflow } from './helpers.mjs'

// Execute the shipped check job, replacing only hosted checkout/tool/artifact APIs.
// This supports the expressions used by check.yml, not general Actions scheduling.
export function check(project, supplied = {}, hosted = () => ({})) {
  const definition = workflow('check')
  const sha = project.git('rev-parse', 'HEAD')
  const inputs = { ...Object.fromEntries(Object.entries(definition.on.workflow_call.inputs).map(([key, value]) => [key, value.default])), ...supplied }
  const steps = {}
  const github = { sha, event: { before: '', pull_request: { base: { sha: '' } } } }
  const evaluate = expression => Function('inputs', 'steps', 'github', 'fromJSON', 'toJSON', 'return (' + expression.replace(/'[^']*'|"[^"]*"|\.([\w-]+)/g, (match, key) => key ? '["' + key + '"]' : match) + ')')(inputs, steps, github, JSON.parse, JSON.stringify)
  const interpolate = value => String(value).replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, expression) => evaluate(expression))
  const resolve = fields => Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, interpolate(value)]))
  const environment = { GITHUB_SHA: sha }
  for (const step of definition.jobs.check.steps) {
    if (step.if && !evaluate(step.if)) continue
    let result
    if (step.uses?.startsWith('$/actions/')) {
      result = composite(step.uses.slice('$/actions/'.length), project.cwd, resolve(step.with), environment, hosted)
    } else if (step.uses) {
      hosted(step.uses, resolve(step.with))
      result = { status: 0, outputs: {} }
    } else {
      const executed = runStep(step.run, join(project.cwd, interpolate(step['working-directory'] || '.')), { ...environment, ...resolve(step.env) })
      result = { status: executed.status, logs: output(executed), outputs: {} }
    }
    if (result.status !== 0) return { ...result, outputs: {} }
    Object.assign(environment, result.environment)
    if (step.id) steps[step.id] = { outputs: result.outputs }
  }
  return { status: 0, outputs: resolve(definition.jobs.check.outputs) }
}
