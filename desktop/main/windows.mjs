// desktop/main/windows.mjs
/**
 * 窗口层：承载 qilin Web UI 的主窗口（shell）+ 中文品牌启动页（splash）。
 *
 * shell 窗口加载的就是 `qilin web` 就绪行打印的同一个地址（含 launch
 * token），同源 fetch 与 WebSocket 直接命中 qilin 的 API 网关。这就是
 * "桌面端与上游 web 端完全一致"的机制保证：同一个 server、同一份构建
 * 物、同一套主题，没有任何桌面侧的二次实现。唯一例外是自绘标题栏
 * （titlebar.mjs）：呈现层的窗口组件重绘，不触碰上游 DOM 结构与功能。
 *
 * @module desktop/main/windows
 */

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, nativeTheme, shell } from 'electron'
import { isAllowedNavigation, urlOrigin } from './qilin-contract.mjs'
import { qilinManager } from './qilin-manager.mjs'
import { attachTitlebar, TITLEBAR_HEIGHT } from './titlebar.mjs'

/** 本文件所在目录（desktop/main）——ESM 主进程没有 __dirname。 */
const HERE = import.meta.dirname

/** 桌面壳自有页面（启动页）的 preload 绝对路径。 */
const SPLASH_PRELOAD = join(HERE, '../preload/splash.mjs')

/** 启动页 HTML 的本地 URL。 */
const SPLASH_URL = pathToFileURL(join(HERE, '../renderer/splash.html')).href

/** 按系统主题选窗口底色（共享主题 Token 的 paper 对），避免加载期白闪/黑闪。 */
export function splashBackgroundColor() {
  return nativeTheme.shouldUseDarkColors ? '#17191C' : '#F7F3EA'
}

/** @type {BrowserWindow | null} */
let splashWindow = null
/** @type {BrowserWindow | null} */
let shellWindow = null

/**
 * 创建并显示中文品牌启动页。
 *
 * 立即向其转发当前侧车状态，并订阅后续状态变化（renderer 经 preload
 * 的 onState 渲染 starting/restarting/failed 态）。
 *
 * @returns {BrowserWindow}
 */
export function showSplash() {
  if (splashWindow !== null && !splashWindow.isDestroyed()) return splashWindow
  const win = new BrowserWindow({
    width: 560,
    height: 420,
    minWidth: 480,
    minHeight: 360,
    title: 'QiLin Desktop',
    resizable: false,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: splashBackgroundColor(),
    webPreferences: {
      preload: SPLASH_PRELOAD,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  })
  splashWindow = win
  win.once('ready-to-show', () => win.show())
  // 状态转发：启动页渲染的是侧车状态机
  const forward = (status) => {
    if (!win.isDestroyed()) win.webContents.send('splash:state', status)
  }
  qilinManager.on('state-changed', forward)
  win.on('closed', () => {
    qilinManager.removeListener('state-changed', forward)
    splashWindow = null
  })
  void win.loadURL(SPLASH_URL)
  return win
}

/** 关闭启动页（进入 shell 或应用退出时）。 */
export function closeSplash() {
  if (splashWindow !== null && !splashWindow.isDestroyed()) splashWindow.close()
  splashWindow = null
}

/**
 * 创建（或复用并导航到 qilin 地址）shell 窗口。
 *
 * @param {string} qilinUrl - qilin web 就绪地址（http://127.0.0.1:<port>/?token=…）。
 */
export function showShellWindow(qilinUrl) {
  const allowedOrigin = urlOrigin(qilinUrl) ?? ''
  if (shellWindow === null || shellWindow.isDestroyed()) {
    shellWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 960,
      minHeight: 600,
      show: false,
      title: 'QiLin Desktop',
      backgroundColor: splashBackgroundColor(),
      // KCoder 式自绘标题栏（macOS）：隐藏原生标题栏、保留红绿灯并把它
      // 垂直居中到自绘拖拽带里；拖拽带与标题文字由 titlebar.mjs 注入。
      ...(process.platform === 'darwin'
        ? {
            titleBarStyle: 'hidden',
            trafficLightPosition: {
              x: 12,
              y: Math.max(6, Math.round((TITLEBAR_HEIGHT - 12) / 2)),
            },
          }
        : {}),
      // 纯浏览器载体：无 node、无 preload、sandbox、webSecurity 开启
      // （唯一注入是 titlebar.mjs 的呈现层标题栏）
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })
    attachTitlebar(shellWindow)
    shellWindow.once('ready-to-show', () => {
      shellWindow?.maximize()
      shellWindow?.show()
    })
    // 只允许停留在 qilin 回环地址；外链交给系统浏览器
    shellWindow.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
    })
    shellWindow.webContents.on('will-navigate', (event, url) => {
      // 实时取当前侧车地址（侧车重启端口会变，不能用创建时的闭包值）
      const current = qilinManager.status.url ?? qilinUrl
      const origin = urlOrigin(current) ?? allowedOrigin
      if (!isAllowedNavigation(url, origin)) {
        event.preventDefault()
        void shell.openExternal(url)
      }
    })
    // qilin Web UI 无需任何浏览器特权
    shellWindow.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
      callback(false)
    })
  }
  // 已在承载同一侧车实例 → 只恢复展示，绝不变相重载整页。
  // token 换 cookie 后的 302 会落在同一 origin，getURL 以干净根地址
  // 开头，前缀判断成立；侧车重启端口变化 → 前缀不匹配 → 加载新实例。
  const currentOrigin = urlOrigin(qilinManager.status.url ?? qilinUrl) ?? allowedOrigin
  const loadedOrigin = urlOrigin(shellWindow.webContents.getURL())
  if (loadedOrigin === null || loadedOrigin !== currentOrigin) {
    void shellWindow.loadURL(qilinManager.status.url ?? qilinUrl)
  }
  if (shellWindow.isMinimized()) shellWindow.restore()
  if (!shellWindow.isVisible()) shellWindow.show()
  shellWindow.focus()
}

/** 供单实例/激活路径引用。 */
export function getShellWindow() {
  return shellWindow
}
