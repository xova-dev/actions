import { createHash } from 'node:crypto'
import { appendFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse } from '../dist/semver.mjs'

const cell = value => '<code>' + String(value ?? 'unavailable').replace(/[&<>|`\r\n]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '|': '&#124;', '`': '&#96;', '\r': '&#13;', '\n': '&#10;',
})[character]) + '</code>'

// Called only after release-it's npm publisher has succeeded. Never infer deployment.
export function publicationResult(env, checked, packageName, tarballSha256) {
  const version = parse(checked.version).version
  const identity = createHash('sha256').update(packageName + '@' + version).digest('hex').slice(0, 16)
  const artifactName = 'npm-publication-' + packageName.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 64) + '-' + identity
  const result = {
    schemaVersion: 1, status: 'published', repository: env.GITHUB_REPOSITORY,
    packageName, version, sourceVersion: checked.version, npmTag: checked['npm-tag'],
    releaseTag: env.RELEASE_TAG, sourceSha: checked['source-sha'], tarballSha256,
    runId: env.GITHUB_RUN_ID || null, runAttempt: env.GITHUB_RUN_ATTEMPT || null,
    runUrl: env.GITHUB_RUN_ID ? 'https://github.com/' + env.GITHUB_REPOSITORY + '/actions/runs/' + encodeURIComponent(env.GITHUB_RUN_ID) : null,
  }
  const path = join(dirname(env.TARBALL), 'publication-result.json')
  writeFileSync(path, JSON.stringify(result, null, 2) + '\n')
  if (env.GITHUB_STEP_SUMMARY) {
    const rows = [
      ['Repository', result.repository], ['Package', packageName], ['npm version', version],
      ['Source version', checked.version], ['npm dist-tag', result.npmTag],
      ['release-tag / recovery workflow ref', result.releaseTag], ['published-sha', result.sourceSha],
      ['Tarball SHA-256', tarballSha256], ['Workflow run', result.runUrl],
      ['Run attempt', result.runAttempt], ['Publication artifact', artifactName],
    ]
    try {
      appendFileSync(env.GITHUB_STEP_SUMMARY, '## npm publication succeeded\n\n'
        + '| Field | Value |\n| --- | --- |\n' + rows.map(([key, value]) => '| ' + key + ' | ' + cell(value) + ' |').join('\n')
        + '\n\nThis records npm publication only, not documentation deployment. For documentation recovery, confirm this npm job and provenance, then select the recorded release-tag as the workflow ref and pass release-tag/published-sha to the consumer recovery entry.\n')
    } catch {
      // The receipt is already saved. A presentation failure must not prevent its upload.
      console.warn('::warning::npm publication succeeded, but writing its summary failed. The JSON result is still saved for artifact upload.')
    }
  }
  return {
    'source-sha': result.sourceSha, version, 'tarball-sha256': tarballSha256,
    'publication-artifact': artifactName, 'publication-result-path': path,
  }
}
