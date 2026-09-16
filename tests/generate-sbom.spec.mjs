// tests/generate-sbom.spec.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSbom, collectPackages } from '../scripts/generate-sbom.mjs'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const lock = { productVersion: '0.1.0', qilinVersion: '3.0.0', qilinCommit: 'a'.repeat(40) }

test('buildSbom 产出 SPDX 2.3 文档：产品包 + 去重排序组件 + purl', () => {
  const doc = buildSbom({
    packages: [
      { name: 'zlib', version: '1.0.0', license: null },
      { name: '@scope/cli', version: '3.0.0', license: 'MIT' },
      { name: 'zlib', version: '1.0.0', license: null },
    ],
    lock,
    versions: { node: '24.17.0', pnpm: '11.7.0' },
    created: '2026-09-16T00:00:00.000Z',
  })
  assert.equal(doc.spdxVersion, 'SPDX-2.3')
  assert.equal(doc.dataLicense, 'CC0-1.0')
  assert.equal(doc.SPDXID, 'SPDXRef-DOCUMENT')
  assert.deepEqual(doc.documentDescribes, ['SPDXRef-OpenKylin-Desktop'])
  assert.equal(doc.creationInfo.created, '2026-09-16T00:00:00.000Z')
  const [product, ...components] = doc.packages
  assert.equal(product.SPDXID, 'SPDXRef-OpenKylin-Desktop')
  assert.match(product.sourceInfo, /qilin 3\.0\.0 @ a{40}/)
  assert.match(product.sourceInfo, /node 24\.17\.0/)
  assert.deepEqual(components.map(p => p.name), ['@scope/cli', 'zlib'])
  assert.equal(components[0].licenseConcluded, 'MIT')
  assert.equal(components[1].licenseConcluded, 'NOASSERTION')
  assert.equal(components[0].externalRefs[0].referenceLocator, 'pkg:npm/%40scope/cli@3.0.0')
  const describes = doc.relationships.find(r => r.relatedSpdxElement === 'SPDXRef-OpenKylin-Desktop')
  assert.equal(describes.relationshipType, 'DESCRIBES')
})

test('collectPackages 遍历 scoped 与嵌套 node_modules 并按名+版本去重', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ok-sbom-'))
  try {
    const modules = join(root, 'node_modules')
    await mkdir(join(modules, 'zlib'), { recursive: true })
    await writeFile(join(modules, 'zlib', 'package.json'), JSON.stringify({ name: 'zlib', version: '1.0.0' }))
    await mkdir(join(modules, '@scope', 'cli'), { recursive: true })
    await writeFile(join(modules, '@scope', 'cli', 'package.json'), JSON.stringify({ name: '@scope/cli', version: '3.0.0', license: 'MIT' }))
    await mkdir(join(modules, 'zlib', 'node_modules', 'dep'), { recursive: true })
    await writeFile(join(modules, 'zlib', 'node_modules', 'dep', 'package.json'), JSON.stringify({ name: 'dep', version: '2.0.0' }))
    await mkdir(join(modules, 'notapkg'), { recursive: true })
    const found = await collectPackages(root)
    assert.deepEqual(found.map(p => `${p.name}@${p.version}`), ['@scope/cli@3.0.0', 'dep@2.0.0', 'zlib@1.0.0'])
    assert.equal(found.find(p => p.name === 'zlib').license, null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
