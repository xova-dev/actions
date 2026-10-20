import assert from 'node:assert/strict'
import { test } from 'node:test'
import { widget } from './source.mjs'

test('the widget is ready', () => assert.equal(widget, 'ready'))
