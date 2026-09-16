// tests/release-manifest.spec.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildManifest } from '../scripts/generate-release-manifest.mjs'

const okLock = { productVersion: '0.1.0', qilinVersion: '3.0.0', qilinCommit: 'a'.repeat(40), target: 'mac-arm64' }
const okBrand = { sharedThemeVersion: '1' }

test('清单合并锁、同步报告与校验和', () => {
  const manifest = buildManifest({
    lock: okLock,
    sync: { match: true, webBundleSha256: 'b'.repeat(64) },
    checksums: 'x'.repeat(64) + '  app.dmg\n' + 'y'.repeat(64) + '  app.zip',
    brand: okBrand,
  })
  assert.equal(manifest.productVersion, '0.1.0')
  assert.equal(manifest.qilinCommit, 'a'.repeat(40))
  assert.equal(manifest.sync.webBundleSha256, 'b'.repeat(64))
  assert.equal(manifest.sharedThemeVersion, '1')
  assert.deepEqual(manifest.artifacts, ['app.dmg', 'app.zip'])
  assert.equal(manifest.schemaVersion, 1)
})

test('同步失败时拒绝生成', () => {
  assert.throws(() => buildManifest({
    lock: okLock,
    sync: { match: false, webBundleSha256: 'b'.repeat(64), desktopBundleSha256: 'c'.repeat(64) },
    checksums: '',
    brand: okBrand,
  }), /refusing to record/)
})

test('空产物清单与缺摘要的同步报告被拒绝', () => {
  assert.throws(() => buildManifest({
    lock: okLock,
    sync: { match: true, webBundleSha256: 'b'.repeat(64) },
    checksums: '\n\n',
    brand: okBrand,
  }), /no artifacts/)
  assert.throws(() => buildManifest({
    lock: okLock,
    sync: { match: true },
    checksums: 'x'.repeat(64) + '  app.dmg',
    brand: okBrand,
  }), /webBundleSha256/)
})

test('缺少品牌清单或主题版本时拒绝生成', () => {
  assert.throws(() => buildManifest({ lock: okLock, sync: { match: true, webBundleSha256: 'b'.repeat(64) }, checksums: 'x', brand: undefined }), /sharedThemeVersion/)
  assert.throws(() => buildManifest({ lock: okLock, sync: { match: true, webBundleSha256: 'b'.repeat(64) }, checksums: 'x', brand: { sharedThemeVersion: '' } }), /sharedThemeVersion/)
})
