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

/** shell 窗口的标题栏桥 preload（CJS：沙箱 preload 不走 ESM）。 */
const SHELL_PRELOAD = join(HERE, '../preload/shell.cjs')

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
    frame: false,
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
      // 无边框桌面（KCoder 同款观感）：整窗无原生边框与标题栏，红绿灯
      // 以悬浮按钮回归并垂直居中在自绘拖拽带里；拖拽带、标题与面板
      // 按钮由 titlebar.mjs 注入绘制。
      frame: false,
      ...(process.platform === 'darwin'
        ? {
            // y 为实测校准值：Electron 把该值视作按钮组垂直中心（配置 18
            // 实测中心 ≈17.75），取栏高一半让红绿灯与标题文字共享 24px
            // 光学中线
            trafficLightPosition: {
              x: 12,
              y: Math.round(TITLEBAR_HEIGHT / 2),
            },
          }
        : {}),
      // 纯浏览器载体：无 node、仅标题栏白名单桥、sandbox、webSecurity
      // 开启（唯一注入是 titlebar.mjs 的呈现层标题栏）
      webPreferences: {
        preload: SHELL_PRELOAD,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })
    // frameless 的 macOS 窗口默认不带红绿灯：显式召回，位置走
    // trafficLightPosition（老版本 Electron 无此 API 时跳过——红绿灯
    // 缺失只影响关停/缩放按钮，不阻塞窗口）。
    if (process.platform === 'darwin' && typeof shellWindow.setWindowButtonVisibility === 'function') {
      try {
        shellWindow.setWindowButtonVisibility(true)
      } catch (error) {
        console.warn('[windows] setWindowButtonVisibility failed:', error)
      }
    }
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
