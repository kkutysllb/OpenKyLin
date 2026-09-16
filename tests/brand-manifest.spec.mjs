// tests/brand-manifest.spec.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseBrandManifest, contrastRatio } from '../scripts/verify-branding.mjs'

const manifest = JSON.parse(await readFile(new URL('../branding/brand-manifest.json', import.meta.url), 'utf8'))

test('品牌清单通过 schema 与对比度校验', () => {
  assert.deepEqual(parseBrandManifest(manifest), manifest)
})

test('sharedThemeVersion 必须存在', () => {
  assert.equal(manifest.sharedThemeVersion, '1')
  assert.throws(() => parseBrandManifest({ ...manifest, sharedThemeVersion: '' }), /sharedThemeVersion/)
  assert.throws(() => parseBrandManifest({ ...manifest, sharedThemeVersion: undefined }), /sharedThemeVersion/)
})

test('contrastRatio 满足 WCAG 数学', () => {
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21)
  assert.throws(() => contrastRatio('#000000', '#000000'), /contrast/)
})

test('每个主题的 paper/ink 对比度 ≥ 4.5', () => {
  for (const scheme of ['light', 'dark']) {
    const { paper, ink } = manifest.theme[scheme]
    assert.ok(contrastRatio(ink, paper) >= 4.5, `${scheme} contrast`)
  }
})
