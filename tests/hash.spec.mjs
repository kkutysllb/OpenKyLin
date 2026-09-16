// tests/hash.spec.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { sha256File, sha256Text, dirDigest } from '../scripts/lib/hash.mjs'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('sha256Text 输出 64 位十六进制', () => {
  assert.equal(sha256Text('abc').length, 64)
  assert.equal(sha256Text('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('dirDigest 对相同内容稳定、对任一文件变化敏感', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ok-hash-'))
  try {
    await mkdir(join(root, 'a'), { recursive: true })
    await writeFile(join(root, 'a', 'one.txt'), '1')
    await writeFile(join(root, 'b.txt'), '2')
    const first = await dirDigest(root)
    const second = await dirDigest(root)
    assert.equal(first, second)
    await writeFile(join(root, 'b.txt'), '3')
    assert.notEqual(await dirDigest(root), first)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('dirDigest exclude 命中文件被跳过；无 exclude 行为不变', async () => {
  const a = await mkdtemp(join(tmpdir(), 'ok-hash-a-'))
  const b = await mkdtemp(join(tmpdir(), 'ok-hash-b-'))
  try {
    await writeFile(join(a, 'index.js'), 'code')
    await writeFile(join(a, 'index.js.map'), 'map')
    await writeFile(join(b, 'index.js'), 'code')
    const exclude = [/\.map$/]
    assert.equal(await dirDigest(a, { exclude }), await dirDigest(b, { exclude }))
    assert.notEqual(await dirDigest(a), await dirDigest(b))
  } finally {
    await rm(a, { recursive: true, force: true })
    await rm(b, { recursive: true, force: true })
  }
})

test('dirDigest 拒绝带 /g 标志的 exclude 模式（lastIndex 陷阱）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ok-hash-g-'))
  try {
    await writeFile(join(root, 'one.map'), '1')
    await writeFile(join(root, 'two.map'), '2')
    await assert.rejects(dirDigest(root, { exclude: [/\.map$/g] }), /not allowed/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
