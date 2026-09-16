// desktop/main/workspace.mjs
/**
 * 标题栏"工作区"解析：当前会话 → 本地目录（Finder 打开）。
 *
 * 数据源是桌面壳自家的 QILIN_HOME 落盘元数据：
 * `$QILIN_HOME/storages/session_projcache/sessions/session-<id>.json`
 * ——上游会话投影缓存，明文 JSON，含 `record.identity.cwd`（工作区
 * 绝对路径）与 `record.rows.title.val`（会话标题），会话创建/更新即写。
 * 主进程直接读文件即可，无需任何网络通路（不碰 RPC、不碰 cookie）。
 *
 * "当前会话"判定（三层，命中即停）：
 * 1. 标题精确匹配：窗口标题（document.title 截掉 " — QiLin" 尾）===
 *    缓存里的 rows.title.val；
 * 2. 页面提示的会话 id（注入标题栏从上游 crumb 读取，命中文件名）；
 * 3. 最近写入（mtime 最新 = 最近活动的会话）。
 *
 * 任何失败软降级为 null（标题栏隐藏工作区段），绝不影响主流程。
 * 纯函数（sessionTitleOf / pickSession）单独导出供单测。
 *
 * @module desktop/main/workspace
 */

import { basename } from 'node:path'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 上游 DocumentTitle 投射的固定尾巴（截掉后才是纯会话标题）。 */
const TITLE_SUFFIX = ' — QiLin'

/** 投影缓存目录（相对 QILIN_HOME）。 */
const PROJCACHE_DIR = join('storages', 'session_projcache', 'sessions')

/** 解析结果缓存时长：文件扫描很轻，5s 足够新鲜。 */
const CACHE_TTL_MS = 5_000

/**
 * 从窗口标题提取纯会话标题（截掉上游 DocumentTitle 的固定尾巴）。
 * @param {string} documentTitle - window/document 标题。
 * @returns {string} 会话标题（无尾巴时原样返回）。
 */
export function sessionTitleOf(documentTitle) {
  const title = String(documentTitle ?? '')
  return title.endsWith(TITLE_SUFFIX) ? title.slice(0, -TITLE_SUFFIX.length) : title
}

/**
 * 会话投影条目 → 当前工作区（目录基名 + 绝对路径）。
 *
 * @param {Array<{ id: string, cwd: string, title: string, mtime: number }>} entries -
 *   投影缓存条目（cwd/title 齐备才算候选）。
 * @param {{ title?: string, sessionId?: string | null }} [hint] -
 *   title = 纯会话标题；sessionId = 页面 crumb 提示（命中文件名即可）。
 * @returns {{ name: string, path: string } | null}
 */
export function pickSession(entries, hint = undefined) {
  if (!Array.isArray(entries) || entries.length === 0) return null
  const hintId = typeof hint?.sessionId === 'string' && hint.sessionId !== '' ? hint.sessionId : null
  const hintTitle = typeof hint?.title === 'string' && hint.title !== '' ? hint.title : null
  // mtime 降序为基准序（最近活动优先），逐层命中收窄
  const ordered = [...entries].sort((left, right) => right.mtime - left.mtime)
  const byTitle = hintTitle !== null ? ordered.find((entry) => entry.title === hintTitle) : undefined
  const byId = hintId !== null ? ordered.find((entry) => entry.id.includes(hintId)) : undefined
  const chosen = byTitle ?? byId ?? ordered[0]
  const name = basename(chosen.cwd)
  return name === '' || chosen.cwd === '' ? null : { name, path: chosen.cwd }
}

/**
 * 创建工作区解析器（带 5s 缓存；标题/提示变化自动失效）。
 *
 * @param {() => { home: string, getTitle: () => string }} source -
 *   QiLin home（与侧车同一 qilinHome）与当前窗口标题的实时取值。
 * @returns {{ workspace: (hint?: { sessionId?: string | null }) => Promise<{ name: string, path: string } | null> }}
 */
export function createWorkspaceResolver(source) {
  /** @type {{ key: string, value: { name: string, path: string } | null, at: number } | null} */
  let cache = null

  function scanCacheDir(home) {
    const dir = join(home, PROJCACHE_DIR)
    const entries = []
    let files = []
    try {
      files = readdirSync(dir)
    } catch {
      return entries // home 尚未初始化：无可解析会话
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const full = join(dir, file)
      try {
        const record = JSON.parse(readFileSync(full, 'utf8'))?.record
        const cwd = record?.identity?.cwd
        const title = record?.rows?.title?.val
        if (typeof cwd !== 'string' || cwd === '') continue
        entries.push({
          id: file.replace(/\.json$/u, ''),
          cwd,
          title: typeof title === 'string' ? title : '',
          mtime: statSync(full).mtimeMs,
        })
      } catch {
        // 单文件损坏/并发写入：跳过该条
      }
    }
    return entries
  }

  return {
    async workspace(hint = undefined) {
      const { home, getTitle } = source()
      if (typeof home !== 'string' || home === '') return null
      const title = sessionTitleOf(getTitle())
      const key = `${home}|${title}|${typeof hint?.sessionId === 'string' ? hint.sessionId : ''}`
      if (cache !== null && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) {
        return cache.value
      }
      let value = null
      try {
        value = pickSession(scanCacheDir(home), { title, sessionId: hint?.sessionId ?? null })
      } catch {
        value = null
      }
      cache = { key, value, at: Date.now() }
      return value
    },
  }
}
