import { join } from 'node:path'
import { composite } from './composite.mjs'
import { output, runStep, workflow } from './helpers.mjs'

// Execute the shipped check job, replacing only hosted checkout/tool/artifact APIs.
// This supports the expressions used by check.yml, not general Actions scheduling.
export function check(project, supplied = {}, hosted = () => ({}), context = {}) {
  const definition = workflow('check')
  const sha = project.git('rev-parse', 'HEAD')
  const inputs = { ...Object.fromEntries(Object.entries(definition.on.workflow_call.inputs).map(([key, value]) => [key, value.default])), ...supplied }
  const steps = {}
  const github = { sha, ...context, event: { before: '', pull_request: { base: { sha: '' } }, ...context.event } }
  const format = (text, ...values) => text.replace(/\{(\d+)\}/g, (_, index) => values[index])
  const evaluate = expression => Function('inputs', 'steps', 'github', 'fromJSON', 'toJSON', 'format', 'return (' + expression.replace(/'[^']*'|"[^"]*"|\.([\w-]+)/g, (match, key) => key ? '["' + key + '"]' : match) + ')')(inputs, steps, github, JSON.parse, JSON.stringify, format)
  const interpolate = value => String(value).replace(/\$\{\{\s*([\s\S]+?)\s*\}\}/g, (_, expression) => evaluate(expression))
  const resolve = fields => Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, interpolate(value)]))
  const environment = { GITHUB_SHA: sha, GITHUB_EVENT_NAME: github.event_name, GITHUB_REF: github.ref }
  const executedSteps = []
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
    executedSteps.push({ name: interpolate(step.name || step.id || step.uses), status: 'completed', conclusion: 'success' })
    Object.assign(environment, result.environment)
    if (step.id) steps[step.id] = { outputs: result.outputs }
  }
  return { status: 0, outputs: resolve(definition.jobs.check.outputs), steps: executedSteps }
}
