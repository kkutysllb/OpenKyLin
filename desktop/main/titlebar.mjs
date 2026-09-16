// desktop/main/titlebar.mjs
/**
 * 自绘标题栏（KCoder 式重绘）：hidden 标题栏 + 页面顶部注入一条拖拽区，
 * 替代被隐藏的原生标题栏组件。
 *
 * 这是桌面壳对上游 Web UI 的**唯一**注入，且严格限于呈现层：
 * - 顶部固定一条 `app-region: drag` 的拖拽带（双击缩放由系统接管），
 *   红绿灯由 `trafficLightPosition` 垂直居中在这条带里；
 * - 背景色实时解析上游主题 token（`--dsw-specific-sidebar-fill`，回退
 *   body 实际底色），与侧边栏融为一体，主题切换自动跟随；
 * - 带内文字 = `document.title`（上游 DocumentTitle 投射会话标题）；
 * - body 等高 padding 把全部内容下移，侧边栏 logo 行与折叠按钮让开
 *   红绿灯区域。
 *
 * 不触碰上游 DOM 结构、组件、路由与功能——上游升级自动跟随；上游若
 * 更名 token，回退链（token → body 底色 → 静态色）保证标题栏仍可用。
 *
 * @module desktop/main/titlebar
 */

/** 标题栏高度（像素）：与 macOS 标准标题栏视觉等高。 */
export const TITLEBAR_HEIGHT = 36

/** 注入页面的自绘脚本（幂等；一次加载只装一条标题栏）。 */
const INJECT_SCRIPT = `(() => {
  if (window.__okTitlebar) return
  window.__okTitlebar = true
  const H = ${TITLEBAR_HEIGHT}
  const style = document.createElement('style')
  style.textContent = [
    'html { --ok-tb-h: ' + H + 'px; }',
    'body { padding-top: var(--ok-tb-h) !important; box-sizing: border-box !important; }',
    '#ok-titlebar {',
    '  position: fixed; top: 0; left: 0; right: 0; height: var(--ok-tb-h);',
    '  -webkit-app-region: drag; -webkit-user-select: none; user-select: none;',
    '  display: flex; align-items: center; justify-content: center;',
    '  z-index: 2147483000; background: var(--ok-tb-bg, #f8f5ee);',
    '}',
    '#ok-titlebar > span {',
    '  font-family: -apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif;',
    '  font-size: 13px; font-weight: 500; opacity: .92;',
    '  color: var(--ok-tb-fg, #221d15); pointer-events: none;',
    '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60vw;',
    '}',
  ].join('\\n')
  document.documentElement.appendChild(style)
  const bar = document.createElement('div')
  bar.id = 'ok-titlebar'
  const label = document.createElement('span')
  bar.appendChild(label)
  document.body.appendChild(bar)
  const resolve = () => {
    const cs = getComputedStyle(document.body)
    const bg = cs.getPropertyValue('--dsw-specific-sidebar-fill').trim()
      || cs.backgroundColor
      || '#f8f5ee'
    const fg = cs.getPropertyValue('--dsw-alias-label-primary').trim() || '#221d15'
    bar.style.setProperty('--ok-tb-bg', bg)
    bar.style.setProperty('--ok-tb-fg', fg)
    label.textContent = document.title || 'QiLin Desktop'
  }
  resolve()
  // 主题切换（token 落点可能在样式表或属性上）与标题变化统一用低频
  // 轮询跟随：每秒两次 getComputedStyle + title 读取，开销可忽略。
  setInterval(resolve, 500)
})()`

/**
 * 给 shell 窗口挂上自绘标题栏：每次文档就绪（含刷新/导航）注入一次，
 * 脚本自身幂等。
 *
 * @param {import('electron').BrowserWindow} win - shell 窗口。
 */
export function attachTitlebar(win) {
  const inject = () => {
    if (!win.isDestroyed()) {
      win.webContents.executeJavaScript(INJECT_SCRIPT).catch((error) => {
        console.error('[titlebar] inject failed:', error)
      })
    }
  }
  win.webContents.on('dom-ready', inject)
  // 已加载完成的窗口（复用路径）也要补一次
  if (!win.webContents.isLoading()) inject()
}
