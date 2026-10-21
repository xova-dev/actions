import * as v from 'valibot'

const text = v.pipe(v.string(), v.regex(/^[^\r\n\0]*$/))
const command = v.pipe(v.string(), v.regex(/^(?=[\s\S]*\S)[^\r\n\0]*$/))
const cachePath = v.union([v.literal(''), command])
const cache = v.strictObject({
  npm: v.optional(cachePath, ''),
  pnpm: v.optional(cachePath, ''),
  uv: v.optional(cachePath, ''),
})

// Structural input rules are also exported as JSON Schema by pnpm build.
export const projectSchema = v.strictObject({
  $schema: v.optional(v.string()),
  schemaVersion: v.literal(1),
  setup: v.optional(v.strictObject({
    toolchain: v.optional(v.picklist(['node', 'mise']), 'node'),
    'node-version': v.optional(command, '24'),
    'install-command': v.optional(command, 'npm ci'),
    'working-directory': v.optional(command, '.'),
    cache: v.optional(cache, {}),
  }), {}),
  code: v.optional(v.strictObject({
    'check-command': v.optional(command),
    'docs-only-command': v.optional(text, ''),
    'docs-only-paths': v.optional(v.array(command), []),
  })),
  npm: v.optional(v.strictObject({
    'package-manager': v.optional(v.picklist(['npm', 'pnpm']), 'npm'),
    'verify-command': v.optional(command),
    'package-verify-command': v.optional(text, ''),
    'tag-prefix': v.optional(text, 'v'),
    'npm-tag': v.optional(command, 'auto'),
    'environment-name': v.optional(command, 'npm-publish'),
  })),
  docs: v.optional(v.strictObject({
    provider: v.optional(v.picklist(['none', 'pages', 'cloudflare']), 'none'),
    'check-command': v.optional(text, ''),
    'build-command': v.optional(text, ''),
    'site-directory': v.optional(text, ''),
    'working-directory': v.optional(command),
    'install-command': v.optional(command),
    cache: v.optional(cache),
    'environment-name': v.optional(text, ''),
    'concurrency-group': v.optional(text, ''),
    'site-id': v.optional(command, 'documentation'),
    'deploy-command': v.optional(command, 'npm exec --no -- wrangler deploy'),
    'deployment-policy': v.optional(v.picklist(['always', 'latest-stable']), 'latest-stable'),
  }), {}),
})

function required(value, keys, name) {
  for (const key of keys)
    if (!value?.[key]?.trim()) throw new Error('Required project setting: ' + name + '.' + key)
}

export function parseProjectConfig(input, task) {
  if (!['code', 'docs', 'release', 'recovery', 'deploy'].includes(task))
    throw new Error('Invalid project setting: task')
  // Valibot accepts empty arrays as object shapes; JSON object inputs must reject them.
  const array = [['', input], ...Object.entries(input ?? {}),
    ...['setup', 'docs'].map(section => [section + '/cache', input?.[section]?.cache])].find(([, value]) => Array.isArray(value))
  if (array) throw new Error('Invalid project configuration at /' + array[0] + ': expected object')
  const result = v.safeParse(projectSchema, input)
  if (!result.success) {
    const issue = result.issues[0]
    const path = issue.path?.map(item => String(item.key).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')
    // Default library diagnostics may include input values; report only location/type.
    throw new Error('Invalid project configuration at /' + (path || '') + ': ' + issue.type)
  }
  const { setup, code, npm, docs } = result.output
  docs['working-directory'] ??= setup['working-directory']
  docs['install-command'] ??= setup['install-command']
  docs.cache ??= { ...setup.cache }
  if (['docs', 'recovery'].includes(task) || (task === 'release' && docs.provider !== 'none'))
    required(docs, ['check-command', 'build-command', 'site-directory'], 'docs')
  if (task === 'deploy' && docs.provider === 'cloudflare') required(docs, ['site-directory'], 'docs')
  if (task === 'code') required(code, ['check-command'], 'code')
  if (task === 'release' && !npm) throw new Error('npm configuration is required.')
  if (task === 'release') required(npm, ['verify-command'], 'npm')
  if (['recovery', 'deploy'].includes(task) && docs.provider === 'none')
    throw new Error('Documentation delivery requires a deployment provider.')
  return { schemaVersion: 1, setup, code: code || null, npm: npm || null, docs }
}
