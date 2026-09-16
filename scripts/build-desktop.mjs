// scripts/build-desktop.mjs
/** Orchestrate the upstream build inside the ephemeral checkout (dry-plan or exec). */
import { spawnSync } from 'node:child_process'
import { basename } from 'node:path'

const TARGETS = { 'mac-arm64': 'package:desktop:mac:arm64', 'mac-x64': 'package:desktop:mac:x64' }

/**
 * Build step plan. Steps run with the process CWD, which the release workflow
 * pins to the ephemeral upstream checkout (working-directory).
 * @param {{ target: string, pnpm?: string }} options
 * @returns {Array<{ cwd: string, command: string, args: string[] }>}
 */
export function planBuild({ target, pnpm = 'pnpm' }) {
  const script = TARGETS[target]
  if (!script) throw new Error(`build-desktop: unsupported target ${target}`)
  return [
    { cwd: '.', args: ['install', '--frozen-lockfile'] },
    { cwd: '.', args: ['run', 'build'] },
    { cwd: '.', args: ['run', script] },
  ].map(step => ({ cwd: step.cwd, command: pnpm, args: step.args }))
}

/**
 * Parse the CLI argv after the script entry: one optional target plus --dry-run.
 * @param {string[]} args - Positional and flag arguments from process.argv.slice(2).
 * @returns {{ target: string, dryRun: boolean }} Validated invocation.
 */
export function parseCliArgs(args) {
  const positional = args.filter(arg => !arg.startsWith('--'))
  if (positional.length > 1) {
    throw new Error(`build-desktop: expected at most one target, got ${positional.join(', ')}`)
  }
  return { target: positional[0] ?? 'mac-arm64', dryRun: args.includes('--dry-run') }
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(basename(process.argv[1]))) {
  const { target, dryRun } = parseCliArgs(process.argv.slice(2))
  const steps = planBuild({ target })
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
