// desktop/main/index.mjs
/**
 * OpenKylin Desktop 主进程入口（KCoder host & sidecar 机制）。
 *
 * 启动流程：单实例锁 → app ready → 中文品牌启动页 → 启动 qilin web
 * 侧车（OS 分配端口）→ 就绪后 shell 窗口加载侧车 URL（与上游 web 端
 * 完全同一份实现）。退出时优雅关停侧车，绝不留孤儿进程。
 *
 * 运行树来源：`OPENKYLIN_QILIN_RUN`（dev 脚本传入品牌化 checkout），
 * 缺省回退到仓库内 `.tmp/dev/qilin-src`。
 *
 * @module desktop/main
 */

import { clipboard, ipcMain, app, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { qilinHome } from './qilin-contract.mjs'
import { qilinManager } from './qilin-manager.mjs'
import { createWorkspaceResolver } from './workspace.mjs'
import { closeSplash, getShellWindow, showShellWindow, showSplash } from './windows.mjs'

/** 产品仓库根（desktop/main 的上上级）。 */
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** 品牌化 qilin 运行树：环境变量优先，缺省为 dev 脚本的标准落位。 */
const RUN_ROOT = process.env.OPENKYLIN_QILIN_RUN ?? join(REPO_ROOT, '.tmp', 'dev', 'qilin-src')

// 受限执行环境（CI 容器、嵌套沙箱）可把 userData 重定向到可写目录；
// 普通桌面环境下不设置，Electron 使用系统默认位置。
if (process.env.OPENKYLIN_USER_DATA !== undefined && process.env.OPENKYLIN_USER_DATA !== '') {
  app.setPath('userData', process.env.OPENKYLIN_USER_DATA)
}

/** 组装诊断文本（状态快照 + 日志尾部），供启动页「复制诊断信息」。 */
function diagnosticsText() {
  const status = qilinManager.status
  const lines = [
    'OpenKylin Desktop 诊断信息',
    `时间：${new Date().toISOString()}`,
    `运行树：${RUN_ROOT}`,
    `QiLin home：${qilinHome()}`,
    `Electron：${process.versions.electron}  Node：${process.versions.node}`,
    `状态：${JSON.stringify(status)}`,
    '',
    '--- 侧车日志尾部 ---',
    ...qilinManager.logTail.map((entry) => `[${entry.stream}] ${entry.line}`),
  ]
  return lines.join('\n')
}

/* ---------- 启动页 IPC（白名单：重试 / 复制诊断） ---------- */

ipcMain.handle('splash:retry', () => {
  qilinManager.restart()
  return true
})
ipcMain.handle('splash:copy', () => {
  const text = diagnosticsText()
  clipboard.writeText(text)
  return text
})

/* ---------- 标题栏 IPC：工作区解析 + Finder 打开（白名单桥） ---------- */

// 解析"当前会话 → 本地目录"：读自家 QILIN_HOME 的会话投影缓存（明文
// JSON，含 cwd 与标题），按窗口标题/页面提示定位当前会话——零网络通路。
const workspaceResolver = createWorkspaceResolver(() => ({
  home: qilinHome(),
  getTitle: () => getShellWindow()?.webContents.getTitle() ?? '',
}))

ipcMain.handle('ok:workspace', (_event, hint) => workspaceResolver.workspace(hint))
ipcMain.handle('ok:workspace:reveal', async (_event, hint) => {
  const workspace = await workspaceResolver.workspace(hint)
  if (workspace === null) return { ok: false, reason: 'no-workspace' }
  const error = await shell.openPath(workspace.path)
  return error === '' ? { ok: true } : { ok: false, reason: error }
})

/* ---------- 单实例：第二次启动只聚焦现有窗口 ---------- */

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const status = qilinManager.status
    if (status.state === 'ready' && status.url !== null) {
      showShellWindow(status.url)
    }
  })

  app.whenReady().then(() => {
    // 启动即显示中文品牌启动页；侧车在后台准备
    showSplash()

    qilinManager.on('state-changed', (status) => {
      if (status.state === 'ready' && status.url !== null) {
        closeSplash()
        showShellWindow(status.url)
      }
      // starting/restarting/failed 由启动页渲染（含重试入口）
    })

    qilinManager.start({ runRoot: RUN_ROOT })

    app.on('activate', () => {
      // macOS dock 图标点击/Cmd+Tab 切回：侧车就绪则回到工作区
      const status = qilinManager.status
      if (status.state === 'ready' && status.url !== null) {
        showShellWindow(status.url)
      }
    })
  })

  /* ---------- 退出序列：优雅关停侧车，绝不留孤儿进程 ---------- */

  app.on('before-quit', (event) => {
    if (qilinManager.status.state === 'stopped' || qilinManager.status.state === 'failed') return
    event.preventDefault()
    void qilinManager.stop().then(() => {
      app.exit(0)
    })
  })

  app.on('window-all-closed', () => {
    // 启动页被用户关闭（尚未就绪）或工作区关闭：直接退出（含 macOS，
    // 首版不做托盘保活；退出序列会先优雅关停侧车）
    app.quit()
  })

  /* ---------- 终端信号兜底：dev 下 Ctrl+C 也不留孤儿进程 ---------- */

  const signalShutdown = (signal) => {
    process.removeAllListeners(signal)
    void qilinManager.stop().finally(() => app.exit(0))
  }
  process.on('SIGINT', () => signalShutdown('SIGINT'))
  process.on('SIGTERM', () => signalShutdown('SIGTERM'))

  /* ---------- 开发期主进程崩溃可读 ---------- */

  process.on('uncaughtException', (error) => {
    console.error('[openkylin] uncaught exception:', error)
  })
}
