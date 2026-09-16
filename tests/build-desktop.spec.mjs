// tests/build-desktop.spec.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { planBuild, parseCliArgs } from '../scripts/build-desktop.mjs'

test('构建计划：先上游安装，再统一构建，再目标打包', () => {
  const steps = planBuild({ target: 'mac-arm64' })
  const scripts = steps.map(step => step.args.join(' '))
  assert.match(scripts[0], /install --frozen-lockfile/)
  assert.match(scripts[1], /run build$/)            // 上游统一构建（含 build:web）
  assert.match(scripts[2], /package:desktop:mac:arm64/)
  assert.equal(steps.length, 3)
})

test('不支持的目标被拒绝', () => {
  assert.throws(() => planBuild({ target: 'linux-x64' }), /unsupported target/)
})

test('多余位置参数被拒绝', () => {
  // CLI-level guard; export the arg parsing so the test can call it directly.
  assert.throws(() => parseCliArgs(['mac-arm64', 'mac-x64']), /at most one target/)
  assert.deepEqual(parseCliArgs(['mac-arm64', '--dry-run']), { target: 'mac-arm64', dryRun: true, stage: 'package' })
  assert.deepEqual(parseCliArgs(['--dry-run']), { target: 'mac-arm64', dryRun: true, stage: 'package' })
  assert.deepEqual(parseCliArgs([]), { target: 'mac-arm64', dryRun: false, stage: 'package' })
})

test('--stage=build 只产出安装与统一构建两步', () => {
  const steps = planBuild({ target: 'mac-arm64', stage: 'build' })
  assert.equal(steps.length, 2)
  assert.match(steps.map(s => s.args.join(' ')).join('\n'), /install --frozen-lockfile/)
  assert.doesNotMatch(steps.map(s => s.args.join(' ')).join('\n'), /package:desktop/)
})

test('未知 stage 与未知 flag 被拒绝', () => {
  assert.throws(() => planBuild({ target: 'mac-arm64', stage: 'bogus' }), /unknown stage/)
  assert.throws(() => parseCliArgs(['--foo']), /unknown flag/)
  assert.deepEqual(parseCliArgs(['--stage=build', '--dry-run']), { target: 'mac-arm64', dryRun: true, stage: 'build' })
})
