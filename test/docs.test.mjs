import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { root } from './helpers.mjs'

const pairs = [
  ['README.md', 'README.zh-CN.md'],
  ['docs/architecture.md', 'docs/architecture.zh-CN.md'],
  ['docs/adoption.md', 'docs/adoption.zh-CN.md'],
  ['docs/releasing.md', 'docs/releasing.zh-CN.md'],
]

test('bilingual guides keep identical executable examples and navigable local links', () => {
  for (const pair of pairs) {
    const documents = pair.map(path => readFileSync(join(root, path), 'utf8'))
    const blocks = value => [...value.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(match => match[1])
    assert.deepEqual(blocks(documents[0]), blocks(documents[1]), pair.join(' / '))
    for (const [index, document] of documents.entries()) {
      for (const match of document.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const [target, fragment] = match[1].split('#')
        if (/^https?:/.test(target)) continue
        const path = resolve(root, dirname(pair[index]), target)
        assert.ok(existsSync(path), pair[index] + ': missing ' + target)
        if (!fragment) continue
        const headings = [...readFileSync(path, 'utf8').matchAll(/^#+ (.+)$/gm)]
          .map(item => item[1].toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, '').replaceAll(' ', '-'))
        assert.ok(headings.includes(fragment), pair[index] + ': missing anchor ' + fragment)
      }
    }
  }
})
