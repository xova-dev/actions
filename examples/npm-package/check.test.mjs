import assert from 'node:assert/strict'
import { test } from 'node:test'
import { answer } from './source.mjs'

test('the package exposes its answer', () => assert.equal(answer, 42))
