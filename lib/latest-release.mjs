import { execFileSync } from 'node:child_process'

export function latestRelease(env) {
  if (!env.RELEASE_TAG || !/^[0-9a-f]{40}$/.test(env.EXPECTED_SHA || '') || !env.GITHUB_REPOSITORY)
    throw new Error('A release tag, exact source SHA and repository are required.')
  const api = path => JSON.parse(execFileSync('gh', ['api', 'repos/' + env.GITHUB_REPOSITORY + '/' + path], { encoding: 'utf8' }))
  const selected = api('releases/tags/' + encodeURIComponent(env.RELEASE_TAG))
  if (selected.prerelease || selected.draft) return { eligible: 'false' }
  const latest = api('releases/latest')
  if (latest.tag_name !== env.RELEASE_TAG || latest.prerelease || latest.draft)
    return { eligible: 'false' }
  const commit = api('commits/' + encodeURIComponent('refs/tags/' + env.RELEASE_TAG)).sha
  if (commit !== env.EXPECTED_SHA) throw new Error('The release tag differs from the selected source SHA.')
  return { eligible: 'true' }
}
