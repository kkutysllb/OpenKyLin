// tests/scaffold.spec.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('package.json 是零依赖 ESM 产品仓库', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.private, true)
  assert.deepEqual(pkg.dependencies, undefined)
  assert.match(pkg.scripts.test, /^node --test/)
})
