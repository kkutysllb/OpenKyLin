// scripts/lib/terminal-builtin.mjs
/**
 * 内置终端插件物化：把仓库内 vendor 的 @kkutysllb/dsh-terminal 安放到
 * QiLin profile 的安装树并注册为 bundle 层。
 *
 * 机制（对齐上游 profile 语义，QiLin 3.0.2 / dsh alpha.2 合并后）：
 * - QiLin 的 dsh 兼容层接受 `qilin.bundle.patch` / `dsh.bundle.patch` 声明的
 *   bundle 层；层包从 profile 锚解析；
 * - 因此"内置" = ① 包目录物化到 **profile 私有安装锚**
 *   （`$QILIN_HOME/profiles/qilin/node_modules`）。共享
 *   `$QILIN_HOME/profiles/node_modules` 在新的 runtime+enforce 解析下是
 *   安装保留区：裸包名解析的原生查找在那里被截断，generation 表又不含
 *   bundle 层包自身，物化到共享目录的层包会 `failed to import`；
 *   profile 私有 node_modules 是原生解析第一跳，层包可被直接导入；
 *   ② `profiles/qilin/package.json` 的 `qilin.profile.bundles` 追加层名；
 *   ③ 尽力装 node-pty（同锚优先；插件懒加载、缺失时自身渲染降级卡，
 *   不阻塞；共享锚的既有副本也可达，作回退）。
 *
 * 任何失败都不抛出——终端缺失只损失功能，绝不阻断桌面启动。
 *
 * @module scripts/lib/terminal-builtin
 */

import { spawnSync } from 'node:child_process'
import {
  cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

/** 内置终端插件的包名与仓内 vendor 源。 */
export const TERMINAL_PACKAGE = '@kkutysllb/dsh-terminal'

/**
 * 确保内置终端在 profile 中可用（幂等；可经 OPENKYLIN_NO_BUILTIN_TERMINAL=1 关闭）。
 *
 * @param {{ repoRoot: string, home: string, log?: (line: string) => void }} options -
 *   repoRoot：产品仓根（vendor 源所在）；home：QiLin home（与侧车同一 qilinHome）。
 * @returns {{ installed: boolean, pty: boolean, reason?: string }}
 */
export function ensureBuiltinTerminal({ repoRoot, home, log = () => {} }) {
  if (process.env.OPENKYLIN_NO_BUILTIN_TERMINAL === '1') {
    return { installed: false, pty: false, reason: 'disabled-by-env' }
  }
  try {
    const source = join(repoRoot, 'vendor', 'dsh-terminal')
    const sourceVersion = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version
    // QiLin 产品面（裸 `qilin`）固定引导 profiles/qilin；与 ② 的 bundle 注册同 profile。
    const profileDir = join(home, 'profiles', 'qilin')
    const installRoot = join(profileDir, 'node_modules')
    const destination = join(installRoot, ...TERMINAL_PACKAGE.split('/'))

    // ① 物化包目录（版本变化即覆盖；直提包无构建产物，整目录拷贝即安装）。
    //    alpha.2 前的旧布局在共享 profiles/node_modules，遇到即清走，避免
    //    双副本漂移与共享区里的死层包。
    const legacyDestination = join(home, 'profiles', 'node_modules', ...TERMINAL_PACKAGE.split('/'))
    if (existsSync(legacyDestination)) {
      rmSync(legacyDestination, { recursive: true, force: true })
      log(`dev: builtin terminal legacy shared-anchor copy removed (${legacyDestination})`)
    }
    const destinationVersion = existsSync(join(destination, 'package.json'))
      ? JSON.parse(readFileSync(join(destination, 'package.json'), 'utf8')).version
      : null
    if (destinationVersion !== sourceVersion) {
      rmSync(destination, { recursive: true, force: true })
      mkdirSync(destination, { recursive: true })
      cpSync(source, destination, { recursive: true })
      log(`dev: builtin terminal materialized at ${destination} (v${sourceVersion})`)
    }

    // ② 注册 profile bundle 层（清单不存在则按上游模板形状预创建）
    const manifestPath = join(profileDir, 'package.json')
    const templateBundles = ['@qilin/base', '@qilin/web-app', '@qilin/web-brand']
    let manifest
    if (existsSync(manifestPath)) {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } else {
      mkdirSync(profileDir, { recursive: true })
      manifest = {
        name: 'qilin-profile-qilin',
        private: true,
        qilin: { profile: { bundles: [...templateBundles], patchReload: 'live' } },
      }
    }
    const declaration = manifest.qilin?.profile ?? manifest.dsh?.profile
    if (declaration === undefined) {
      manifest.qilin = { ...manifest.qilin, profile: { bundles: [...templateBundles], patchReload: 'live' } }
    }
    const bundles = manifest.qilin.profile.bundles
    if (!Array.isArray(bundles)) throw new Error('profile manifest bundles is not an array')
    if (!bundles.includes(TERMINAL_PACKAGE)) bundles.push(TERMINAL_PACKAGE)
    writeIfChanged(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    // ③ node-pty 尽力安装（同 range 契约 ^1.1.0；profile 私有锚优先，共享锚
    //    既有副本也可达（ancestor 解析）时跳过；失败交给插件降级卡）
    const pty = ensureNodePty(installRoot, join(home, 'profiles', 'node_modules'), log)
    return { installed: true, pty }
  } catch (error) {
    log(`dev: builtin terminal skipped (${error instanceof Error ? error.message : String(error)})`)
    return { installed: false, pty: false, reason: 'ensure-failed' }
  }
}

/** 写入前先比较，避免无谓的 mtime 抖动。 */
function writeIfChanged(path, content) {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return
  writeFileSync(path, content)
}

/**
 * 探测安装锚能否拿到 node-pty（真实目录或 pnpm symlink 都算）。profile
 * 私有锚优先；共享锚的副本经 ancestor 解析同样可达，也计入。
 */
function ptyResolvable(...anchors) {
  return anchors.some((anchor) => existsSync(join(anchor, 'node-pty', 'package.json')))
}

function ensureNodePty(installRoot, sharedRoot, log) {
  if (ptyResolvable(installRoot, sharedRoot)) return true
  const result = spawnSync('npm', [
    'install', '--prefix', installRoot, '--no-save', '--no-package-lock',
    '--loglevel=error', 'node-pty@^1.1.0',
  ], { stdio: 'pipe', timeout: 180_000 })
  if (ptyResolvable(installRoot, sharedRoot)) {
    log('dev: node-pty installed into profile install root')
    return true
  }
  log(`dev: node-pty unavailable (${result.error?.message ?? `exit ${result.status}`}); terminal will show its degradation card`)
  return false
}
