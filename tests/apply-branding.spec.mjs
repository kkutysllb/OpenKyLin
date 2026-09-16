// tests/apply-branding.spec.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sha256Text } from '../scripts/lib/hash.mjs'
import { applyBranding } from '../scripts/apply-branding.mjs'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ok-brand-'))
  const upstream = join(root, 'upstream')
  await mkdir(join(upstream, 'apps', 'desktop', 'renderer'), { recursive: true })
  await writeFile(join(upstream, 'apps', 'desktop', 'renderer', 'startup.css'), 'body{}')
  const product = join(root, 'product')
  await mkdir(join(product, 'branding', 'shell'), { recursive: true })
  await writeFile(join(product, 'branding', 'shell', 'startup.css'), 'body{background:#F7F3EA}')
  return { root, upstream, product }
}

test('覆盖文件：SHA 匹配则替换并写回执', async () => {
  const { root, upstream, product } = await fixture()
  const registry = {
    schemaVersion: 1,
    overwrites: [{
      source: 'branding/shell/startup.css',
      target: 'apps/desktop/renderer/startup.css',
      expectSha256: sha256Text('body{}'),
    }],
    patches: [],
  }
  try {
    const applied = await applyBranding({ productRoot: product, upstreamRoot: upstream, registry })
    assert.equal(applied.overwrites.length, 1)
    const body = await readFile(join(upstream, 'apps', 'desktop', 'renderer', 'startup.css'), 'utf8')
    assert.match(body, /#F7F3EA/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('SHA 不匹配立即失败且不写目标', async () => {
  const { root, upstream, product } = await fixture()
  const registry = {
    schemaVersion: 1,
    overwrites: [{ source: 'branding/shell/startup.css', target: 'apps/desktop/renderer/startup.css', expectSha256: 'deadbeef' }],
    patches: [],
  }
  try {
    await assert.rejects(applyBranding({ productRoot: product, upstreamRoot: upstream, registry }), /sha mismatch/)
    const body = await readFile(join(upstream, 'apps', 'desktop', 'renderer', 'startup.css'), 'utf8')
    assert.equal(body, 'body{}')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('mode=add：目标不存在则创建，已存在则拒绝', async () => {
  const { root, upstream, product } = await fixture()
  const newTarget = 'apps/desktop/renderer/ok-theme.css'
  const registry = {
    schemaVersion: 1,
    overwrites: [{
      mode: 'add',
      source: 'branding/shell/startup.css',
      target: newTarget,
    }],
    patches: [],
  }
  try {
    const applied = await applyBranding({ productRoot: product, upstreamRoot: upstream, registry })
    assert.equal(applied.overwrites.length, 1)
    assert.match(await readFile(join(upstream, newTarget), 'utf8'), /#F7F3EA/)
    await assert.rejects(
      applyBranding({ productRoot: product, upstreamRoot: upstream, registry }),
      /already exists/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
