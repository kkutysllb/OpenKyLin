// scripts/dev.mjs
/**
 * Launch the branded desktop dev environment from this product repo (KCoder
 * host & sidecar mechanism):
 *
 *   1. prepare the branded upstream checkout at .tmp/dev/qilin-src — reused
 *      as-is when its stamp still matches the lock and the branding inputs
 *      (protecting node_modules and build artifacts from the destructive
 *      re-clone); otherwise fetch the locked commit and apply branding;
 *   2. make sure the sidecar build artifacts exist (apps/cli/lib/bin.js +
 *      apps/web/dist) and the borrowable Electron binary, building them via
 *      the upstream toolchain when missing;
 *   3. spawn the OpenKylin desktop shell, which starts `qilin web` on a stable persisted port
 *      as a sidecar and loads it in the shell window — the exact same web
 *      build the upstream browser UI serves.
 *
 * The user's QiLin working tree is never modified.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { writeFile as writeFilePromise } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchUpstream } from './fetch-upstream.mjs'
import { applyBranding } from './apply-branding.mjs'
import { DEV_STAMP_FILE, brandingFingerprint, checkoutReusable } from './lib/dev-stamp.mjs'
import { ensureBuiltinTerminal } from './lib/terminal-builtin.mjs'
import { qilinHome } from '../desktop/main/qilin-contract.mjs'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const lock = JSON.parse(readFileSync(join(repoRoot, 'upstream/qilin.lock.json'), 'utf8'))
const sourceRoot = resolve(repoRoot, process.env.OPENKYLIN_QILIN_SRC ?? '../QiLin')
const cloneRoot = join(repoRoot, '.tmp', 'dev', 'qilin-src')

if (!existsSync(join(sourceRoot, 'package.json'))) {
  throw new Error(`dev: upstream source not found at ${sourceRoot} (set OPENKYLIN_QILIN_SRC)`)
}

/** Build artifacts the desktop shell needs from the branded checkout. */
const SIDE_CAR_BIN = join('apps', 'cli', 'lib', 'bin.js')
const WEB_DIST_INDEX = join('apps', 'web', 'dist', 'index.html')
const UPSTREAM_ELECTRON = join('apps', 'desktop', 'node_modules', '.bin', 'electron')

// 1. Branded checkout: reuse when the stamp matches, rebuild otherwise.
if (checkoutReusable(lock, repoRoot, cloneRoot)) {
  console.log(`dev: reusing branded checkout at ${cloneRoot} (stamp matches lock ${lock.qilinCommit.slice(0, 12)})`)
} else {
  console.log(`dev: preparing branded checkout at ${cloneRoot} …`)
  // fetchUpstream removes any previous checkout before cloning the locked commit.
  await fetchUpstream({ repository: sourceRoot, commit: lock.qilinCommit, qilinVersion: lock.qilinVersion, out: cloneRoot })
  const registry = JSON.parse(readFileSync(join(repoRoot, 'patches/registry.json'), 'utf8'))
  await applyBranding({ productRoot: repoRoot, upstreamRoot: cloneRoot, registry })
  await writeFilePromise(
    join(cloneRoot, DEV_STAMP_FILE),
    `${JSON.stringify({ commit: lock.qilinCommit, brandingFingerprint: brandingFingerprint(repoRoot) }, null, 2)}\n`,
  )
}

// 2. Ensure the sidecar artifacts and the borrowable Electron binary exist.
//    Artifacts are built through the upstream canonical product build
//    (`build:qilin` = native + build:lib + build:web with the bound client
//    environment) so baked public values — the version badge, commit, build
//    profile — match the product surface this shell serves. CI=true lets the
//    first-run dependency install proceed without a TTY.
const missing = [
  SIDE_CAR_BIN,
  WEB_DIST_INDEX,
].filter(rel => !existsSync(join(cloneRoot, rel)))
if (missing.length > 0) {
  console.log(`dev: building missing sidecar artifacts (${missing.join(', ')}) …`)
  const pnpmBin = join(sourceRoot, 'apps/desktop/node_modules/.bin/pnpm')
  const pnpm = existsSync(pnpmBin) ? pnpmBin : 'pnpm'
  for (const args of [['install'], ['run', 'build:qilin']]) {
    const code = await new Promise((resolveExit, reject) => {
      const child = spawn(pnpm, args, {
        cwd: cloneRoot,
        stdio: 'inherit',
        env: { ...process.env, CI: 'true', ELECTRON_RUN_AS_NODE: undefined },
      })
      child.on('error', reject)
      child.on('exit', c => { resolveExit(c ?? 1) })
    })
    if (code !== 0) throw new Error(`dev: pnpm ${args.join(' ')} exited with ${code}`)
  }
}
// The Electron npm shim (.bin/electron) exists even when its binary was never
// downloaded (pnpm skips non-allowlisted build scripts), so verify the actual
// dist and run electron's own installer (mirror-friendly) when missing.
const electronPkgDir = join(cloneRoot, 'apps', 'desktop', 'node_modules', 'electron')
const electronDistReady = existsSync(join(electronPkgDir, 'path.txt'))
if (!existsSync(join(cloneRoot, UPSTREAM_ELECTRON)) || !electronDistReady) {
  if (!existsSync(join(electronPkgDir, 'install.js'))) {
    throw new Error(
      `dev: Electron package missing at ${electronPkgDir}; `
      + `run the install step above inside ${cloneRoot} (CI=true pnpm install).`,
    )
  }
  console.log('dev: Electron binary not downloaded yet; running electron install.js …')
  const code = await new Promise((resolveExit, reject) => {
    const child = spawn('node', ['install.js'], {
      cwd: electronPkgDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        CI: 'true',
        ELECTRON_RUN_AS_NODE: undefined,
        ELECTRON_MIRROR: process.env.ELECTRON_MIRROR ?? 'https://npmmirror.com/mirrors/electron/',
      },
    })
    child.on('error', reject)
    child.on('exit', c => { resolveExit(c ?? 1) })
  })
  if (code !== 0 || !existsSync(join(electronPkgDir, 'path.txt'))) {
    throw new Error(`dev: electron install.js exited with ${code} and no dist landed; check network or set ELECTRON_MIRROR`)
  }
}

// 3. Materialize the built-in terminal plugin into the QiLin profile
//    (idempotent; never blocks launch — see scripts/lib/terminal-builtin.mjs).
ensureBuiltinTerminal({ repoRoot, home: qilinHome(), log: (line) => console.log(line) })

// 4. Run the OpenKylin desktop shell: it spawns `qilin web` (stable persisted port) from the
//    branded checkout and loads the very same web UI the upstream browser
//    serves (complete web/desktop parity by construction).
//    OPENKYLIN_ELECTRON_NO_GPU=1 appends --disable-gpu for headless/CPU-only
//    runners; normal desktop terminals leave it unset.
const electronBin = join(cloneRoot, UPSTREAM_ELECTRON)
const shellEntry = join(repoRoot, 'desktop', 'main', 'index.mjs')
const electronArgs = [shellEntry]
if (process.env.OPENKYLIN_ELECTRON_NO_GPU === '1') electronArgs.push('--disable-gpu')
// Extra Electron CLI switches for restricted environments, split on whitespace
// (e.g. OPENKYLIN_ELECTRON_ARGS="--remote-debugging-port=9333").
if (process.env.OPENKYLIN_ELECTRON_ARGS !== undefined && process.env.OPENKYLIN_ELECTRON_ARGS.trim() !== '') {
  electronArgs.push(...process.env.OPENKYLIN_ELECTRON_ARGS.trim().split(/\s+/))
}
console.log(`dev: starting OpenKylin desktop shell\n  electron: ${electronBin}\n  entry:    ${shellEntry}\n  run root: ${cloneRoot}`)
const child = spawn(electronBin, electronArgs, {
  cwd: repoRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    OPENKYLIN_QILIN_RUN: cloneRoot,
    ELECTRON_RUN_AS_NODE: undefined,
  },
})
child.on('exit', code => { process.exitCode = code ?? 1 })
