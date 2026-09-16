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
