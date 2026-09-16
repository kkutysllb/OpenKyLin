// tests/fetch-upstream.spec.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchUpstream } from '../scripts/fetch-upstream.mjs'

const run = promisify(execFile)

async function initUpstreamFixture() {
  const repo = await mkdtemp(join(tmpdir(), 'ok-qilin-repo-'))
  const runIn = args => run('git', ['-C', repo, ...args])
  await runIn(['init', '-b', 'main'])
  await runIn(['config', 'user.email', 't@example.com'])
  await runIn(['config', 'user.name', 't'])
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name: '@qilin/root', version: '3.0.0' }))
  await runIn(['add', '.'])
  await runIn(['commit', '-m', 'init'])
  const { stdout } = await runIn(['rev-parse', 'HEAD'])
  return { repo, commit: stdout.trim() }
}

test('fetchUpstream checkout 精确 commit 并校验版本', async () => {
  const { repo, commit } = await initUpstreamFixture()
  const out = join(await mkdtemp(join(tmpdir(), 'ok-src-')), 'qilin-src')
  try {
    const summary = await fetchUpstream({ repository: repo, commit, qilinVersion: '3.0.0', out })
    assert.equal(summary.commit, commit)
    const pkg = JSON.parse(await readFile(join(out, 'package.json'), 'utf8'))
    assert.equal(pkg.version, '3.0.0')
    const receipt = JSON.parse(await readFile(join(out, '.openkylin-upstream.json'), 'utf8'))
    assert.equal(receipt.commit, summary.commit)
  } finally {
    await rm(out, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test('版本不匹配时失败', async () => {
  const { repo, commit } = await initUpstreamFixture()
  const out = join(await mkdtemp(join(tmpdir(), 'ok-never-')), 'qilin-src')
  try {
    await assert.rejects(
      fetchUpstream({ repository: repo, commit, qilinVersion: '9.9.9', out }),
      /version mismatch/,
    )
  } finally {
    await rm(out, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test('repository 以 - 开头被拒绝，坏 commit 格式被拒绝', async () => {
  const sha = '0'.repeat(40)
  await assert.rejects(
    fetchUpstream({ repository: '--upload-pack=evil', commit: sha, qilinVersion: '3.0.0', out: join(tmpdir(), 'ok-rejected') }),
    /repository must not/,
  )
  await assert.rejects(
    fetchUpstream({ repository: 'https://example.invalid/repo.git', commit: 'main', qilinVersion: '3.0.0', out: join(tmpdir(), 'ok-rejected') }),
    /commit must be a 40-char sha/,
  )
})
