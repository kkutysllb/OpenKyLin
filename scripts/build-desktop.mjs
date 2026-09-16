// scripts/build-desktop.mjs
/** Orchestrate the upstream build inside the ephemeral checkout (dry-plan or exec). */
import { spawnSync } from 'node:child_process'
import { basename } from 'node:path'

const TARGETS = { 'mac-arm64': 'package:desktop:mac:arm64', 'mac-x64': 'package:desktop:mac:x64' }

/**
 * Build step plan. Steps run with the process CWD, which the release workflow
 * pins to the ephemeral upstream checkout (working-directory).
 * @param {{ target: string, pnpm?: string, stage?: 'build' | 'package' }} options
 * @returns {Array<{ cwd: string, command: string, args: string[] }>}
 */
export function planBuild({ target, pnpm = 'pnpm', stage = 'package' }) {
  const script = TARGETS[target]
  if (!script) throw new Error(`build-desktop: unsupported target ${target}`)
  if (stage !== 'build' && stage !== 'package') throw new Error(`build-desktop: unknown stage ${stage}`)
  const steps = [
    { cwd: '.', args: ['install', '--frozen-lockfile'] },
    { cwd: '.', args: ['run', 'build'] },
    { cwd: '.', args: ['run', script] },
  ]
  return steps
    .slice(0, stage === 'build' ? 2 : 3)
    .map(step => ({ cwd: step.cwd, command: pnpm, args: step.args }))
}

const KNOWN_FLAGS = new Set(['--dry-run', '--stage'])

/**
 * Parse the CLI argv after the script entry: one optional target plus flags.
 * @param {string[]} args - Positional and flag arguments from process.argv.slice(2).
 * @returns {{ target: string, dryRun: boolean, stage: 'build' | 'package' }} Validated invocation.
 */
export function parseCliArgs(args) {
  for (const arg of args.filter(candidate => candidate.startsWith('--'))) {
    if (!KNOWN_FLAGS.has(arg.split('=')[0])) {
      throw new Error(`build-desktop: unknown flag ${arg}`)
    }
  }
  const positional = args.filter(arg => !arg.startsWith('--'))
  if (positional.length > 1) {
    throw new Error(`build-desktop: expected at most one target, got ${positional.join(', ')}`)
  }
  const stageEntry = args.find(arg => arg.startsWith('--stage='))
  const stage = stageEntry === undefined ? 'package' : stageEntry.slice('--stage='.length)
  return { target: positional[0] ?? 'mac-arm64', dryRun: args.includes('--dry-run'), stage }
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(basename(process.argv[1]))) {
  const { target, dryRun, stage } = parseCliArgs(process.argv.slice(2))
  const steps = planBuild({ target, stage })
  if (dryRun) {
    for (const step of steps) console.log(`[${step.cwd}] ${step.command} ${step.args.join(' ')}`)
  } else {
    for (const step of steps) {
      const result = spawnSync(step.command, step.args, { cwd: step.cwd === '.' ? process.cwd() : step.cwd, stdio: 'inherit' })
      if (result.error !== undefined) throw new Error(`build-desktop: ${step.args.join(' ')} failed to start`, { cause: result.error })
      if (result.status !== 0) throw new Error(`build-desktop: ${step.args.join(' ')} exited ${String(result.status ?? result.signal)}`)
    }
  }
}
