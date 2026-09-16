// tests/web-desktop-sync.spec.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareWebDesktop, DEFAULT_BUNDLE_EXCLUDE } from '../scripts/verify-web-desktop-sync.mjs'

async function dist(root) {
  await mkdir(join(root, 'dist'), { recursive: true })
  await writeFile(join(root, 'dist', 'index.html'), '<html></html>')
  return join(root, 'dist')
}

test('同一构建物摘要一致；篡改后不一致', async () => {
  const a = await mkdtemp(join(tmpdir(), 'ok-sync-a-'))
  const b = await mkdtemp(join(tmpdir(), 'ok-sync-b-'))
  try {
    const web = await dist(a)
    const desktop = await dist(b)
    const report = await compareWebDesktop({ webDist: web, desktopDist: desktop })
    assert.equal(report.match, true)
    assert.equal(report.webBundleSha256, report.desktopBundleSha256)
    assert.equal(report.webBundleSha256.length, 64)
    await writeFile(join(desktop, 'index.html'), '<html>changed</html>')
    const changed = await compareWebDesktop({ webDist: web, desktopDist: desktop })
    assert.equal(changed.match, false)
    assert.notEqual(changed.webBundleSha256, changed.desktopBundleSha256)
  } finally {
    await rm(a, { recursive: true, force: true })
    await rm(b, { recursive: true, force: true })
  }
})

test('默认排除 map/preview；exclude:[] 时恢复全等', async () => {
  assert.ok(DEFAULT_BUNDLE_EXCLUDE.length > 0)
  assert.ok(DEFAULT_BUNDLE_EXCLUDE.every(pattern => pattern instanceof RegExp))
  const a = await mkdtemp(join(tmpdir(), 'ok-sync-a-'))
  const b = await mkdtemp(join(tmpdir(), 'ok-sync-b-'))
  try {
    const web = await dist(a)
    const desktop = await dist(b)
    await writeFile(join(web, 'index.js.map'), 'sourcemap')
    await writeFile(join(web, 'preview.html'), '<html>preview</html>')
    await mkdir(join(web, 'preview'), { recursive: true })
    await writeFile(join(web, 'preview', 'vfs-image.tar.gz'), 'blob')
    const defaulted = await compareWebDesktop({ webDist: web, desktopDist: desktop })
    assert.equal(defaulted.match, true)
    const strict = await compareWebDesktop({ webDist: web, desktopDist: desktop, exclude: [] })
    assert.equal(strict.match, false)
  } finally {
    await rm(a, { recursive: true, force: true })
    await rm(b, { recursive: true, force: true })
  }
})
