// Public configuration cases; task requirements evolve independently of migration evidence.
export const tasks = ['code', 'docs', 'release', 'recovery', 'deploy']
export const sampleConfig = () => ({
  schemaVersion: 1,
  setup: {},
  code: { 'check-command': 'npm test' },
  npm: { 'verify-command': 'npm run build' },
  docs: { provider: 'pages', 'check-command': 'npm test', 'build-command': 'npm run docs:build', 'site-directory': 'site' },
})
const clone = value => JSON.parse(JSON.stringify(value))
const text = value => typeof value === 'string' && /^[^\r\n\0]*$/.test(value)
const command = value => text(value) && /\S/.test(value)

export function projectCases() {
  const cases = []
  function add(name, input, accepted = () => true) {
    for (const task of tasks) cases.push({ name: name + ' / ' + task, input: clone(input), task, valid: accepted(task) })
  }
  add('complete configuration with defaults', sampleConfig())
  add('minimal configuration', { schemaVersion: 1 }, () => false)
  add('npm only', { schemaVersion: 1, npm: { 'verify-command': 'npm run build' } }, task => task === 'release')
  add('docs only', { schemaVersion: 1, docs: sampleConfig().docs }, task => ['docs', 'deploy', 'recovery'].includes(task))
  for (const input of [null, false, 0, '', [], {}, 'not an object']) add('invalid root ' + JSON.stringify(input), input, () => false)
  const defaults = sampleConfig()
  defaults.setup = { 'working-directory': 'packages/widget', 'install-command': 'pnpm install --frozen-lockfile' }
  add('documentation inherits setup', defaults)
  for (const section of ['setup', 'code', 'npm', 'docs']) {
    const omitted = sampleConfig()
    delete omitted[section]
    add('omitted ' + section, omitted, task => section === 'setup' || (section === 'code' && task !== 'code')
      || (section === 'npm' && task !== 'release') || (section === 'docs' && ['code', 'release'].includes(task)))
    for (const value of [null, [], [1], {}, true, 0, '']) {
      const input = sampleConfig()
      input[section] = value
      add(section + ' object boundary ' + JSON.stringify(value), input, task => value !== null && !Array.isArray(value) && typeof value === 'object'
        && (section === 'setup' || (section === 'code' && task !== 'code')
          || (section === 'npm' && task !== 'release') || (section === 'docs' && ['code', 'release'].includes(task))))
    }
  }
  for (const section of ['', 'setup', 'code', 'npm', 'docs']) {
    for (const key of ['unexpected', '__proto__', 'constructor', 'prototype', 'toString']) {
      const input = sampleConfig()
      Object.defineProperty(section ? input[section] : input, key, { value: 'unexpected', enumerable: true })
      add('unknown field ' + section + '/' + key, input, () => false)
    }
  }
  const fields = [
    ['$schema', 'metadata'], ['schemaVersion', 'version'],
    ...['node-version', 'install-command', 'working-directory'].map(key => ['setup.' + key, 'command']),
    ['setup.toolchain', ['node', 'mise']], ['code.check-command', 'command'], ['code.docs-only-command', 'text'],
    ['code.docs-only-paths', 'patterns'], ['npm.package-manager', ['npm', 'pnpm']],
    ...['verify-command', 'npm-tag', 'environment-name'].map(key => ['npm.' + key, 'command']),
    ...['tag-prefix', 'package-verify-command'].map(key => ['npm.' + key, 'text']),
    ['docs.provider', ['none', 'pages', 'cloudflare']], ['docs.deployment-policy', ['always', 'latest-stable']],
    ...['check-command', 'build-command', 'site-directory'].map(key => ['docs.' + key, 'docs-required']),
    ...['working-directory', 'install-command', 'site-id', 'deploy-command'].map(key => ['docs.' + key, 'command']),
    ...['environment-name', 'concurrency-group'].map(key => ['docs.' + key, 'text']),
  ]
  const values = [null, false, 0, 1, [], {}, '', ' ', '\t', '\n', 'value', '中文', 'first\nsecond', 'tail\n', 'tail\r', 'tail\r\n', '\u0000', '\\', ['docs/**'], [''], [null], ['\n'], ['tail\n']]
  for (const [path, rule] of fields) {
    for (const value of [...values, ...(Array.isArray(rule) ? rule : [])]) {
      const input = sampleConfig()
      const [section, key] = path.split('.')
      ;(key ? input[section] : input)[key || section] = value
      add(path + ' = ' + JSON.stringify(value), input, task => {
        if (Array.isArray(rule)) return rule.includes(value) && !(path === 'docs.provider' && value === 'none' && ['recovery', 'deploy'].includes(task))
        if (rule === 'version') return value === 1
        if (rule === 'metadata') return typeof value === 'string'
        if (rule === 'patterns') return Array.isArray(value) && value.every(command)
        if (rule === 'command') return command(value)
        if (rule === 'docs-required') return text(value) && (['code', 'deploy'].includes(task) || Boolean(value.trim()))
        return text(value)
      })
    }
  }
  for (const provider of ['pages', 'cloudflare']) {
    const input = sampleConfig()
    input.docs.provider = provider
    input.docs['site-directory'] = ''
    add('empty deployment path / ' + provider, input, task => task === 'code' || (task === 'deploy' && provider === 'pages'))
  }
  return cases
}
