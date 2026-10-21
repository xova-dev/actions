import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { publicationResult } from '../lib/publication-result.mjs'
import { fixture, workflow } from './helpers.mjs'

test('publication evidence escapes summary fields and uses distinct safe artifact names for scoped packages', t => {
  const project = fixture(t)
  const env = {
    TARBALL: join(project.cwd, 'package.tgz'), GITHUB_STEP_SUMMARY: join(project.cwd, 'summary'),
    GITHUB_REPOSITORY: 'fixture/project', RELEASE_TAG: 'prefix|<script>`v0.1.0',
    NPM_TOKEN: 'not-part-of-the-result',
  }
  const checked = { version: '0.1.0', 'source-sha': project.git('rev-parse', 'HEAD'), 'npm-tag': 'latest' }
  const scoped = publicationResult(env, checked, '@scope-a/name', 'a'.repeat(64))
  const receipt = readFileSync(scoped['publication-result-path'], 'utf8')
  const summary = readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8')
  assert.match(summary, /prefix&#124;&lt;script&gt;&#96;v0.1.0/)
  assert.doesNotMatch(summary, /<script>|not-part-of-the-result/)
  assert.doesNotMatch(receipt, /not-part-of-the-result|TARBALL|NPM_TOKEN/)
  assert.equal(JSON.parse(receipt).runUrl, null)
  const other = publicationResult(env, checked, '@scope/a-name', 'a'.repeat(64))
  assert.notEqual(scoped['publication-artifact'], other['publication-artifact'])
  for (const result of [scoped, other]) assert.match(result['publication-artifact'], /^[a-zA-Z0-9._-]+$/)
})

test('the release workflow exposes the saved result without involving recovery', () => {
  const definition = workflow('release')
  for (const key of ['tarball-sha256', 'publication-artifact']) {
    assert.equal(definition.on.workflow_call.outputs[key].value, '$' + '{{ jobs.publish.outputs.' + key + ' }}')
    assert.equal(definition.jobs.publish.outputs[key], '$' + '{{ steps.publish.outputs.' + key + ' }}')
  }
  assert.equal(workflow('docs-recover').on.workflow_call.inputs['publication-artifact'], undefined)
})
