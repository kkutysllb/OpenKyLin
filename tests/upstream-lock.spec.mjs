import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseUpstreamLock } from '../scripts/verify-upstream.mjs'

const lock = JSON.parse(await readFile(new URL('../upstream/qilin.lock.json', import.meta.url), 'utf8'))

test('仓库锁文件通过 schema 校验', () => {
  assert.deepEqual(parseUpstreamLock(lock), lock)
})

test('拒绝坏 commit 与坏 target', () => {
  assert.throws(() => parseUpstreamLock({ ...lock, qilinCommit: 'main' }), /qilinCommit/)
  assert.throws(() => parseUpstreamLock({ ...lock, target: 'linux-x64' }), /target/)
  assert.throws(() => parseUpstreamLock({ ...lock, schemaVersion: 2 }), /schemaVersion/)
})

test('数组输入与版本措辞守卫', () => {
  assert.throws(() => parseUpstreamLock([lock]), /not an object/)
  assert.throws(() => parseUpstreamLock({ ...lock, qilinVersion: '3.0.0-beta.1' }), /exact X\.Y\.Z version/)
})
