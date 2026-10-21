export function releaseSource(env) {
  if (!env.RELEASE_TAG || /[\r\n]/.test(env.RELEASE_TAG)
    || !/^[0-9a-f]{40}$/.test(env.GITHUB_SHA || '')
    || env.GITHUB_REF !== 'refs/tags/' + env.RELEASE_TAG)
    throw new Error('Run at the selected release tag with its native source SHA.')
  if (!['release', 'recovery'].includes(env.RELEASE_MODE))
    throw new Error('Unknown release source mode.')
  if ((env.RELEASE_MODE === 'recovery' && !env.EXPECTED_SHA)
    || (env.EXPECTED_SHA && env.EXPECTED_SHA !== env.GITHUB_SHA))
    throw new Error('The native source must match the checked or confirmed published SHA.')
  const providers = env.RELEASE_MODE === 'recovery' ? ['pages', 'cloudflare'] : ['none', 'pages', 'cloudflare']
  if (!providers.includes(env.DOCS_PROVIDER)) throw new Error('Unknown documentation provider.')
  if (!['always', 'latest-stable'].includes(env.DEPLOYMENT_POLICY))
    throw new Error('Unknown documentation deployment policy.')
  return { 'source-sha': env.GITHUB_SHA }
}
