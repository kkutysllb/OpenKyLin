// tests/release-manifest.spec.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildManifest } from '../scripts/generate-release-manifest.mjs'

test('清单合并锁、同步报告与校验和', () => {
  const manifest = buildManifest({
    lock: { productVersion: '0.1.0', qilinVersion: '3.0.0', qilinCommit: 'a'.repeat(40), target: 'mac-arm64' },
    sync: { match: true, webBundleSha256: 'b'.repeat(64) },
    checksums: 'x'.repeat(64) + '  app.dmg\n' + 'y'.repeat(64) + '  app.zip',
  })
  assert.equal(manifest.productVersion, '0.1.0')
  assert.equal(manifest.qilinCommit, 'a'.repeat(40))
  assert.equal(manifest.sync.webBundleSha256, 'b'.repeat(64))
  assert.deepEqual(manifest.artifacts, ['app.dmg', 'app.zip'])
  assert.equal(manifest.schemaVersion, 1)
})

test('同步失败时拒绝生成', () => {
  assert.throws(() => buildManifest({
    lock: { productVersion: '0.1.0', qilinVersion: '3.0.0', qilinCommit: 'a'.repeat(40), target: 'mac-arm64' },
    sync: { match: false, webBundleSha256: 'b'.repeat(64), desktopBundleSha256: 'c'.repeat(64) },
    checksums: '',
  }), /refusing to record/)
})
