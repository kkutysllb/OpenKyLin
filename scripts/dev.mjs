// scripts/dev.mjs
/**
 * Launch the branded desktop dev environment from this product repo:
 * fetch the locked upstream commit, apply branding, install dependencies in
 * the ephemeral checkout (.tmp/dev/qilin-src), then run the upstream desktop
 * dev loop. The user's QiLin working tree is never modified.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchUpstream } from './fetch-upstream.mjs'
import { applyBranding } from './apply-branding.mjs'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const lock = JSON.parse(readFileSync(join(repoRoot, 'upstream/qilin.lock.json'), 'utf8'))
const sourceRoot = resolve(repoRoot, process.env.OPENKYLIN_QILIN_SRC ?? '../QiLin')
const cloneRoot = join(repoRoot, '.tmp', 'dev', 'qilin-src')

if (!existsSync(join(sourceRoot, 'package.json'))) {
  throw new Error(`dev: upstream source not found at ${sourceRoot} (set OPENKYLIN_QILIN_SRC)`)
}

// 1. Fresh branded checkout (fetchUpstream removes any previous one).
await fetchUpstream({ repository: sourceRoot, commit: lock.qilinCommit, qilinVersion: lock.qilinVersion, out: cloneRoot })
await applyBranding({ productRoot: repoRoot, upstreamRoot: cloneRoot, registry: JSON.parse(readFileSync(join(repoRoot, 'patches/registry.json'), 'utf8')) })

// 2. Run the upstream desktop dev loop inside the branded checkout.
//    CI=true lets the first-run dependency install proceed without a TTY;
//    the pnpm content store is warm from the source workspace.
const pnpmBin = join(sourceRoot, 'apps/desktop/node_modules/.bin/pnpm')
const child = spawn(pnpmBin, ['run', 'dev:desktop'], {
  cwd: cloneRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    CI: 'true',
    ELECTRON_RUN_AS_NODE: undefined,
    ELECTRON_MIRROR: process.env.ELECTRON_MIRROR ?? 'https://npmmirror.com/mirrors/electron/',
  },
})
child.on('exit', code => { process.exitCode = code ?? 1 })
