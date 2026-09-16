// tests/artifact.spec.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { findLeaks } from '../scripts/check-source-leakage.mjs'
import { parseArtifactReport } from '../scripts/verify-artifact.mjs'

test('泄漏扫描命中 .ts 源码与 git 元数据', () => {
  const leaks = findLeaks([
    'app/resources/qilin/node_modules/x/lib.js',
    'app/resources/qilin/node_modules/x/src/foo.ts',
    'app/.git/HEAD',
  ])
  assert.deepEqual(leaks, [
    'app/resources/qilin/node_modules/x/src/foo.ts',
    'app/.git/HEAD',
  ])
})

test('产物报告校验版本绑定', () => {
  assert.throws(() => parseArtifactReport({
    runtime: { version: '3.0.0', nodeVersion: '24.17.0', pnpmVersion: '11.7.0' },
    lock: { qilinVersion: '3.1.0', nodeVersion: '24.17.0', pnpmVersion: '11.7.0' },
  }), /version mismatch/)
  assert.deepEqual(parseArtifactReport({
    runtime: { version: '3.0.0', nodeVersion: '24.17.0', pnpmVersion: '11.7.0' },
    lock: { qilinVersion: '3.0.0', nodeVersion: '24.17.0', pnpmVersion: '11.7.0' },
  }), { ok: true })
})
