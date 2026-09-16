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
  } finally {
    await rm(out, { recursive: true, force: true })
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
  }
})
