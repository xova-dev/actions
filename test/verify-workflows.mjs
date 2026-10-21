import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validate } from '../lib/docs.mjs'

// Shared by hosted CI and local integration tests; never publishes or deploys.
assert.match(process.env.GITHUB_SHA || '', /^[0-9a-f]{40}$/, 'A native source SHA is required.')
assert.equal(process.env.CODE_SOURCE_SHA, process.env.GITHUB_SHA, 'Code workflow source differs from the native source.')
assert.equal(process.env.CODE_CHANGED, 'true', 'The code workflow must run the full check path.')
assert.equal(process.env.DOCS_SOURCE_SHA, process.env.GITHUB_SHA, 'Docs workflow source differs from the native source.')
const identity = validate({ ...process.env, EXPECTED_SHA: process.env.GITHUB_SHA })
assert.equal(identity['source-sha'], process.env.DOCS_SOURCE_SHA)
const site = join(process.env.ARTIFACT_DIRECTORY, 'site')
assert.match(readFileSync(join(site, 'index.html'), 'utf8'), /<h1>Documentation<\/h1>/)
assert.equal(readFileSync(join(site, '.well-known/security.txt'), 'utf8'), 'Contact: mailto:security@example.invalid\n')
