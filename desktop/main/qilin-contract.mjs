// desktop/main/qilin-contract.mjs
/**
 * 上游 QiLin 契约适配层（KCoder host & sidecar 机制的桌面壳）。
 *
 * 桌面端与 QiLin 的关系是"宿主与侧车"：QiLin web 侧车拥有 agent loop、
 * API 网关、会话与持久化（`$QILIN_HOME`），桌面壳只负责进程与窗口，
 * 绝不侵入其运行时。shell 窗口加载的就是 `qilin web` 侧车本身——因此
 * 桌面工作区与上游 QiLin 的 web 端是同一份实现、同一份数据，天然完全
 * 一致；QiLin 升级自动跟随，无需桌面侧改动。
 *
 * 本文件是桌面壳对上游约定的唯一引用点；升级上游后若行为不符，只
 * 需要修改这里。
 *
 * 契约依据（upstream 3.0.0, commit 81072195ac724ff63f49450da02768032a1b50fe）：
 * - 就绪行：packages/bundle/web-app/src/index.ts `printUrl`
 *   `<label>: http://127.0.0.1:<port>/workspace?token=<launch-token> (LAN: …)`
 *   ——loader 结算后打印，是就绪信号；URL 携带进程 launch token，首次
 *   加载经 302 换取设备 cookie 后落回干净的 entry URL（packages/client/
 *   connection/src/browser-auth.ts），因此导航白名单必须按 origin 判断。
 *   label 由 web-runtime 行决定：产品 profile（web-brand 层）为 `qilin`，
 *   unbranded web profile 为 `qilin web`（packages/bundle/web-brand/
 *   cordis.patch.yml）。
 * - CLI：裸 `qilin` 启动**产品面**（shipped profile `qilin` = base +
 *   web-app + web-brand，apps/cli/src/args.ts `PRODUCT_PROFILE` 与
 *   packages/boot/app-boot/src/profile.ts `PROFILE_TEMPLATES`）——web-brand
 *   层把 `ui-brand`（麒麟印章品牌位）与 `ui-theme-brand`（宣纸/墨色主题
 *   层）插入浏览器模块清单，这就是"与上游 QiLin 产品 web 端完全一致"的
 *   上游原生开关；`qilin web` 是 **unbranded** web 面（鲸鱼兜底，无品牌
 *   层）。launcher  flags 之后的 token 全部直通 booted app
 *   （allowUnknownOption + passThroughOptions），因此 `--port 0 --no-open`
 *   直接跟在裸命令后：`--port 0` 让 OS 分配端口，`--no-open` 抑制默认
 *   浏览器（桌面壳就是它的浏览器）。
 * - 构建产物 bin：apps/cli/package.json `bin.qilin = lib/bin.js`。
 * - Harness home：packages/util/home-paths `QILIN_HOME`，默认 `~/.qilin`，
 *   与 qilin CLI / 浏览器端共享同一份数据（会话、凭据、插件）。
 * - Electron 二进制：品牌化 checkout 的 apps/desktop devDependencies
 *   （dev 态借用，与上游同版本；打包态由发行链自带）。
 *
 * @module desktop/main/qilin-contract
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 就绪行的解析规则：`qilin: http://127.0.0.1:<port>…`（产品 profile）或 `qilin web: …`（unbranded web profile）。 */
export const READY_LINE_RE = /^qilin(?: web)?: (http:\/\/127\.0\.0\.1:\d+(?:\/[^\s]*)?)/

/** 就绪等待上限（毫秒）：qilin 需等 loader 结算后才打印 URL；首次冷启动还要初始化 profile。 */
export const READY_TIMEOUT_MS = 120_000

/** 崩溃自动重启次数上限。 */
export const MAX_AUTO_RESTARTS = 3

/** 优雅退出宽限（毫秒）：SIGTERM 之后仍未退出则 SIGKILL。 */
export const TERM_GRACE_MS = 5_000

/** 侧车日志环形缓冲容量（诊断信息展示尾部）。 */
export const LOG_RING_SIZE = 500

/** 上游 web profile 名称（unbranded 面；产品面为裸 `qilin`）。 */
export const WEB_PROFILE = 'web'

/** 品牌化上游 checkout 内的 CLI bin（相对 checkout 根）。 */
export const UPSTREAM_BIN = join('apps', 'cli', 'lib', 'bin.js')

/** 品牌化上游 checkout 内可借用的 Electron 二进制（相对 checkout 根）。 */
export const UPSTREAM_ELECTRON = join('apps', 'desktop', 'node_modules', '.bin', 'electron')

/**
 * 从一行 stdout 解析侧车就绪 URL。
 *
 * @param {string} line - 侧车 stdout 的一行。
 * @returns {string | null} 完整就绪 URL（含 launch token）；不匹配返回 null。
 */
export function parseReadyLine(line) {
  const match = READY_LINE_RE.exec(line)
  return match === null ? null : match[1]
}

/**
 * 提取 URL 的 origin（scheme + host + port），忽略路径与查询。
 *
 * @param {string} url - 任意 URL。
 * @returns {string | null} 无法解析时返回 null。
 */
export function urlOrigin(url) {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * 判断一次导航是否允许停留在侧车页面。
 *
 * 规则：仅允许与当前侧车就绪 URL 同 origin 的 http 导航。token 换
 * cookie 后的 302、SPA 内部路由与静态资源都在同一 origin 下；任何
 * 其他地址（外链、file://、别的端口）都不许停留。
 *
 * @param {string} url - 将要导航到的地址。
 * @param {string} allowedOrigin - 当前侧车就绪 URL 的 origin。
 * @returns {boolean}
 */
export function isAllowedNavigation(url, allowedOrigin) {
  if (allowedOrigin === '') return false
  let target
  try {
    target = new URL(url)
  } catch {
    return false
  }
  return target.protocol === 'http:' && target.origin === allowedOrigin
}

/**
 * 侧车进程的完整参数（裸 `qilin` = 产品面 profile，麒麟印章品牌层与
 * 宣纸/墨色主题层随 web-brand bundle 生效；`--expose-internals` 供 web
 * profile 的 HMR 服务使用 node internal ESM loader，生产侧车带上无害）。
 *
 * @param {string} binPath - 品牌化 checkout 内 apps/cli/lib/bin.js 的绝对路径。
 * @returns {string[]} 解释器参数 + CLI flags。
 */
export function sidecarArgs(binPath) {
  return ['--expose-internals', binPath, '--port', '0', '--no-open']
}

/**
 * 解析一条可执行的 qilin 侧车命令。
 *
 * 优先级：
 * 1. `QILIN_BIN` 环境变量（可执行文件或 `node script.js` 形式）
 * 2. `OPENKYLIN_QILIN_RUN` 指向的品牌化运行树（dev 态为
 *    `.tmp/dev/qilin-src`；其 apps/cli/lib/bin.js 已构建）
 *
 * @param {{ runRoot?: string, env?: NodeJS.ProcessEnv }} options
 * @returns {{ source: string, command: string, baseArgs: string[], cwd: string, env: NodeJS.ProcessEnv, describe: string } | null}
 *   找不到可用来源时返回 null。
 */
export function resolveSidecar(options = {}) {
  const env = options.env ?? process.env
  // 1) 显式环境变量：支持 "qilin" 或 "node /path/bin.js"
  const envBin = env.QILIN_BIN
  if (envBin !== undefined && envBin !== '') {
    const parts = envBin.split(/\s+/)
    return {
      source: 'env',
      command: parts[0],
      baseArgs: parts.slice(1),
      cwd: options.runRoot ?? process.cwd(),
      env: {},
      describe: `$QILIN_BIN: ${envBin}`,
    }
  }
  // 2) 品牌化运行树的构建产物
  if (options.runRoot !== undefined) {
    const bin = join(options.runRoot, UPSTREAM_BIN)
    if (existsSync(bin)) {
      return {
        source: 'runtime',
        command: 'node',
        baseArgs: sidecarArgs(bin),
        cwd: options.runRoot,
        env: {},
        describe: `node ${bin} --port 0 --no-open（产品面）`,
      }
    }
  }
  return null
}

/**
 * QiLin Harness home（与 qilin CLI / 浏览器端共享同一份数据）。
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function qilinHome(env = process.env) {
  const override = env.QILIN_HOME
  if (typeof override === 'string' && override.trim() !== '') return override
  return join(homedir(), '.qilin')
}

/**
 * 品牌化运行树内可借用的 Electron 二进制路径（dev 态）。
 *
 * @param {string} runRoot - 品牌化 checkout 根。
 * @returns {string | null} 二进制存在返回路径，否则 null。
 */
export function electronBinary(runRoot) {
  const bin = join(runRoot, UPSTREAM_ELECTRON)
  return existsSync(bin) ? bin : null
}
