// desktop/main/titlebar.mjs
/**
 * 自绘标题栏——KCoder `SHELL_TITLEBAR_JS` 的忠实移植（同源机制：主进程
 * executeJavaScript 注入，值取自 KCoder 主进程常量）。
 *
 * 几何（KCoder 实测常量）：
 *   高度 48px；darwin leftPad=78 / padRight=0；红绿灯 {x:12, y:18}；
 *   标题起排 = max(78px + 附加左缩进, 侧边栏宽 + 12px)——跟随侧栏右缘
 *   对齐主内容列（ResizeObserver 探 [class*="sidebarCol"]，与 KCoder
 *   同款探针；QiLin AppFrame 同样有 sidebarCol 类）。
 *
 * 结构（照抄 KCoder）：工作区按钮（文件夹图标 + 名字，点击打开目录）+
 * " / " + 任务标题（尾部省略）+ 预设徽章（上游 AgentPresetLabel 收纳到
 * 此处）。配色：--dsw-specific-sidebar-fill，回退深浅双色；文字色深浅
 * 固定 rgba（KCoder 同款）。
 *
 * 与 KCoder 的差异仅两处（QiLin 侧无对应物时的等价替换）：
 * 1. 工作区名/路径来源：KCoder 读 DSH web 写入的 CSS 变量；QiLin 由
 *    主进程读会话投影缓存（workspace.mjs）经 IPC 桥供给；
 * 2. 右侧按钮：KCoder 的面板按钮是其 web 自有件；此处为注入的窗口级
 *    组件——编辑器/终端选择（自持菜单，真实应用图标，直启上游
 *    /open-in-app 接口）、右侧边栏开关（最右槽位）、内嵌终端
 *    （dsh-terminal 插件按宿主契约挂载于 right:44px 槽位）。
 *
 * @module desktop/main/titlebar
 */

/** 标题栏高度（像素）：KCoder SHELL_TITLEBAR_HEIGHT。 */
export const TITLEBAR_HEIGHT = 48

/** darwin 左基线（KCoder TITLEBAR_PLATFORM.darwin.leftPad）。 */
const LEFT_PAD = 78

/** 注入页面的自绘脚本（幂等；一次加载只装一条标题栏）。 */
const INJECT_SCRIPT = `(() => {
  if (window.__okTitlebar) return
  window.__okTitlebar = true
  const H = ${TITLEBAR_HEIGHT}
  const LEFT_PAD = ${LEFT_PAD}
  const pad = document.createElement('style')
  pad.textContent = [
    'html { --ok-tb-h: ' + H + 'px; }',
    // 实心模式（应用主框架）才下推内容；landing/登录页保持无痕覆盖
    'body.ok-tb-solid { padding-top: var(--ok-tb-h) !important; box-sizing: border-box !important; }',
  ].join('\\n')
  document.head.append(pad)

  const bar = document.createElement('div')
  bar.id = 'ok-titlebar'
  bar.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:0', 'height:' + H + 'px',
    'z-index:2147483000',
    '-webkit-app-region:drag', 'user-select:none',
    'display:flex', 'align-items:center', 'justify-content:flex-start',
    'font:500 13px -apple-system,"PingFang SC","Segoe UI",sans-serif',
  ].join(';')

  // 双段结构（KCoder 同款）：工作区前缀（弱化色，含 " / " 分隔）+
  // 标题主体（省略号打在标题尾部；工作区自身过长独立截断）
  const label = document.createElement('span')
  label.style.cssText = [
    'flex:0 1 auto',
    'margin-left:max(calc(' + LEFT_PAD + 'px + var(--ok-extra-left, 0px)), var(--ok-sidebar-w, 0px) + 12px)',
    'max-width:calc(100% - max(calc(' + LEFT_PAD + 'px + var(--ok-extra-left, 0px)), var(--ok-sidebar-w, 0px) + 12px) - 134px)',
    'display:flex', 'align-items:center', 'min-width:0', 'white-space:nowrap',
  ].join(';')
  // 工作区段：实体按钮（文件夹图标 + 名字；点击打开工作区目录）
  const wsBtn = document.createElement('button')
  wsBtn.id = 'ok-ws-btn'
  wsBtn.type = 'button'
  wsBtn.style.cssText = [
    'all:unset', 'box-sizing:border-box', 'flex:none', 'display:inline-flex', 'align-items:center', 'gap:5px',
    'max-width:240px', 'min-width:0', 'padding:3px 7px', 'border-radius:7px',
    'cursor:pointer', '-webkit-app-region:no-drag', 'pointer-events:auto',
  ].join(';')
  const wsIco = document.createElement('span')
  wsIco.style.cssText = 'flex:none;display:inline-flex;width:16px;height:16px'
  wsIco.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><path d="M1.8 4.4c0-.7.6-1.3 1.3-1.3h2.8c.4 0 .8.2 1 .5l1 1.1h3.9c.7 0 1.3.6 1.3 1.3v5.6c0 .7-.6 1.3-1.3 1.3H3.1c-.7 0-1.3-.6-1.3-1.3V4.4Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>'
  const wsName = document.createElement('span')
  wsName.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:400;line-height:1;display:block'
  wsBtn.append(wsIco, wsName)
  const wsSep = document.createElement('span')
  wsSep.style.cssText = 'flex:none;font-weight:400'
  wsSep.textContent = ' / '
  const ttlTag = document.createElement('span')
  ttlTag.style.cssText = 'flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis'
  // 预设徽章（KCoder 同款 pill；上游 AgentPresetLabel 收纳至此）
  const presetTag = document.createElement('span')
  presetTag.style.cssText = 'flex:none;display:inline-flex;align-items:center;line-height:1;max-width:150px;overflow:hidden;text-overflow:ellipsis;margin-left:9px;padding:3px 8px;border-radius:99px;font-size:10px;font-weight:500;letter-spacing:.2px;background:color-mix(in srgb,currentColor 12%,transparent);opacity:.82;cursor:default'
  label.append(wsBtn, wsSep, ttlTag, presetTag)
  bar.append(label)
  document.body.append(bar)

  // 工作区按钮 hover/图标规则（KCoder 同款；svg 16px 块化 + 半像素下移
  // 补字体光学中心）
  const wsStyle = document.createElement('style')
  wsStyle.textContent = [
    '#ok-ws-btn{transition:background .12s ease}',
    '#ok-ws-btn:hover{background:color-mix(in srgb,currentColor 10%,transparent)}',
    '#ok-ws-btn svg{width:16px;height:16px;display:block;transform:translateY(.5px)}',
    // 右侧窗口级按钮（注入组件；槽位固定，不参与 flex 流）
    '#ok-titlebar .ok-btn{position:absolute;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;gap:1px;height:26px;border:none;border-radius:7px;padding:0 4px;background:transparent;color:var(--ok-tb-fg,#221d15);opacity:.82;cursor:pointer;font-family:inherit;pointer-events:auto;-webkit-app-region:no-drag}',
    '#ok-titlebar .ok-btn:hover{background:color-mix(in srgb,currentColor 10%,transparent);opacity:1}',
    '#ok-titlebar .ok-btn[hidden]{display:none}',
    '#ok-titlebar .ok-btn svg{display:block;flex:none}',
    '#ok-titlebar .ok-btn-panel{right:10px;width:30px}',
    '#ok-titlebar .ok-btn-app{right:76px;width:44px}',
    '#ok-titlebar .ok-app-ico{width:15px;height:15px;flex:none;background:center / contain no-repeat}',
    '#ok-menu{position:fixed;z-index:2147483001;min-width:168px;padding:4px;border-radius:10px;background:var(--ok-tb-bg,#f8f5ee);color:var(--ok-tb-fg,#221d15);box-shadow:0 10px 28px rgba(0,0,0,.22);font-family:-apple-system,"PingFang SC","Hiragino Sans GB",sans-serif;-webkit-app-region:no-drag}',
    '#ok-menu[hidden]{display:none}',
    '#ok-menu .ok-mi{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:0;border-radius:7px;background:transparent;color:inherit;cursor:pointer;font-family:inherit;font-size:13px;text-align:left}',
    '#ok-menu .ok-mi:hover{background:color-mix(in srgb,currentColor 10%,transparent)}',
    '#ok-menu .ok-mi img{width:18px;height:18px;flex:none}',
    '#ok-menu .ok-mi .ok-check{margin-left:auto;opacity:.7}',
    // 标题栏接管后，页内重复原件隐藏（仅桌面壳；只动呈现不改结构，
    // 纯 web 无此样式不受影响；隐藏元素的 .click() 转发仅用于无浮层
    // 的 plain toggle）
    'div[class*="_headerUtilities"] div[class*="_split"] { display: none !important; }',
    'button[data-sidebar-right-expand], button[data-sidebar-right-toggle] { display: none !important; }',
    'header[class*="_header"]:has([class*="_titleRow"]) { display: none !important; }',
    // 实心标题栏下压缩侧栏顶部留白：figma 的 60px logoRow + 6px 根内边
    // 距按纯 web 顶格设计，叠在 48px 标题栏下红绿灯与商标间距过大。
    // 挂在 body.ok-tb-solid 下（纯 web 与无痕页不受影响）；类名用子串
    // 探针（构建产物为哈希前缀形态，如 _34ohLq_logoRow），并限定在
    // sidebarCol 列内，避免误伤其它包的 _root/_logoRow
    'body.ok-tb-solid [class*="sidebarCol"] > [class*="_root"] { padding-top: 0; }',
    'body.ok-tb-solid [class*="sidebarCol"] > [class*="_root"][class*="_collapsed"] { padding-top: 6px; }',
    'body.ok-tb-solid [class*="sidebarCol"] [class*="_logoRow"] { height: 44px; padding: 4px 0 4px 4px; margin-bottom: 6px; }',
    // 折叠 rail 保持上游自身几何（上一条优先级更高，须显式还原）
    'body.ok-tb-solid [class*="sidebarCol"] [class*="_collapsed"] [class*="_logoRow"] { height: 36px; padding: 0; margin-bottom: 12px; }',
    // 内置终端插件按 KCoder 宿主契约挂载于 right:44px 槽位；配色对齐本栏
    '#ok-titlebar #__dsh_kc_term_btn { color: var(--ok-tb-fg, #221d15) !important; opacity: .82; }',
  ].join('\\n')
  document.head.append(wsStyle)

  /* ---- 侧边栏右边线探测（KCoder 同款探针；QiLin AppFrame 同有 sidebarCol） ----
     兼作页面判型：探到 sidebarCol = 应用主框架 → 实心标题栏；一直探不到
     （landing / 登录注册页）= 保持透明无痕覆盖（仅拖拽区 + 红绿灯）。
     注意：watchSidebarCol 只定义不调用——调用点在脚本末尾（全部常量
     定义之后），否则注入已渲染完成的 workspace 文档时 setSolid(true)
     会撞上 btnApp/apply 的暂时性死区，整个脚本当场崩溃。 */
  let solid = false
  const setSolid = (on) => {
    if (on === solid) return
    solid = on
    document.body.classList.toggle('ok-tb-solid', on)
    label.style.display = on ? '' : 'none'
    btnApp.hidden = !on
    btnPanel.hidden = !on
    // 无痕模式拖拽带右侧留 64px 不覆盖：登陆页主题切换按钮
    // （top:1rem; right:1rem; 30px 见方）在带下完全裸露可点击
    bar.style.right = on ? '0' : '64px'
    apply()
  }
  const watchSidebarCol = () => {
    const el = document.querySelector('[class*="sidebarCol"]')
    if (el === null) { setSolid(false); requestAnimationFrame(watchSidebarCol); return }
    setSolid(true)
    const push = () => {
      document.documentElement.style.setProperty(
        '--ok-sidebar-w', Math.round(el.getBoundingClientRect().width) + 'px')
    }
    new ResizeObserver(push).observe(el)
    push()
    // SPA 离开主框架（登出回 landing/登录页）：降回无痕并恢复轮询
    const mo = new MutationObserver(() => {
      if (document.querySelector('[class*="sidebarCol"]') !== null) return
      mo.disconnect()
      watchSidebarCol()
    })
    mo.observe(document.body, { childList: true, subtree: true })
  }

  /* ---- 右侧窗口级按钮 ---- */
  const ICONS = {
    panel: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">'
      + '<rect x="1.7" y="2.7" width="12.6" height="10.6" rx="2.2"/>'
      + '<path d="M9.8 2.7v10.6"/>'
      + '<rect x="9.8" y="2.7" width="4.5" height="10.6" rx="0" fill="currentColor" stroke="none" opacity=".28"/></svg>',
    chev: '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">'
      + '<path d="M4 6.5 8 10.5 12 6.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  }
  const mk = (className, html, tip) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = className
    btn.title = tip
    btn.setAttribute('aria-label', tip)
    btn.innerHTML = html
    return btn
  }
  const btnApp = mk('ok-btn ok-btn-app', '<span class="ok-app-ico"></span>' + ICONS.chev, '在编辑器 / 终端中打开')
  const btnPanel = mk('ok-btn ok-btn-panel', ICONS.panel, '右侧边栏')
  const termHost = document.createElement('span')
  termHost.id = '__dsh_desktop_titlebar'
  bar.append(btnApp, btnPanel, termHost)
  // 无痕安全默认：全部隐藏 + 拖拽带右缩 64px，待探针确认主框架
  // （setSolid(true)）再亮相；避免探针未落定时 landing/登录页闪出
  // 工作区条目或盖住主题切换按钮
  label.style.display = 'none'
  btnApp.hidden = true
  btnPanel.hidden = true
  bar.style.right = '64px'
  const menu = document.createElement('div')
  menu.id = 'ok-menu'
  menu.hidden = true
  document.body.append(menu)
  const q = (sel) => document.querySelector(sel)

  // 编辑器/终端选择：原生同款观感（真实应用图标），自持菜单直启上游接口
  const CHOICE_KEY = 'qilin.open-in-app.choice'
  const APP_LABELS = {
    finder: '访达', explorer: '文件资源管理器', filemanager: '文件管理器',
    cursor: 'Cursor', vscode: 'VS Code', vscodeinsiders: 'VS Code Insiders',
    windsurf: 'Windsurf', zed: 'Zed', sublimetext: 'Sublime Text',
    xcode: 'Xcode', androidstudio: 'Android Studio', fork: 'Fork',
    terminal: '终端', iterm: 'iTerm', iterm2: 'iTerm2',
  }
  let appsCache = null
  let appsAt = 0
  let currentChoice = null
  const readChoice = () => {
    try {
      const value = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? '""')
      return typeof value === 'string' && value !== '' ? value : null
    } catch { return null }
  }
  const fetchApps = async () => {
    if (appsCache !== null && Date.now() - appsAt < 60_000) return appsCache
    try {
      const response = await fetch('/open-in-app/apps', { headers: { accept: 'application/json' } })
      const payload = await response.json()
      appsCache = Array.isArray(payload.apps) ? payload.apps.filter(id => typeof id === 'string') : []
      appsAt = Date.now()
    } catch {
      appsCache = appsCache ?? []
    }
    return appsCache
  }
  const applyChoiceIcon = () => {
    const id = currentChoice ?? appsCache?.[0] ?? 'finder'
    btnApp.querySelector('.ok-app-ico').style.backgroundImage
      = 'url("/open-in-app/icon/' + encodeURIComponent(id) + '")'
  }
  void fetchApps().then(() => { currentChoice = readChoice(); applyChoiceIcon() })
  const closeMenu = () => { menu.hidden = true }
  const launch = async (id) => {
    try { localStorage.setItem(CHOICE_KEY, JSON.stringify(id)) } catch { /* 私有模式等：仅记忆失败 */ }
    currentChoice = id
    applyChoiceIcon()
    let path = null
    try { path = (await window.okShell?.workspace())?.path ?? null } catch { path = null }
    if (path === null) { btnApp.title = '暂无活动会话工作区'; return }
    btnApp.title = '在编辑器 / 终端中打开'
    try {
      await fetch('/open-in-app/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app: id, path }),
      })
    } catch { /* 启动失败静默（上游原按钮同样无 UI 报错） */ }
  }
  const openMenu = async () => {
    const apps = await fetchApps()
    currentChoice = readChoice()
    menu.innerHTML = ''
    for (const id of apps) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'ok-mi'
      const img = document.createElement('img')
      img.src = '/open-in-app/icon/' + encodeURIComponent(id)
      img.alt = ''
      const text = document.createElement('span')
      text.textContent = APP_LABELS[id] ?? id
      item.append(img, text)
      if (id === currentChoice) {
        const check = document.createElement('span')
        check.className = 'ok-check'
        check.textContent = '✓'
        item.append(check)
      }
      item.addEventListener('click', () => { closeMenu(); void launch(id) })
      menu.append(item)
    }
    if (apps.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'ok-mi'
      empty.textContent = '未检测到可用应用'
      menu.append(empty)
    }
    const rect = btnApp.getBoundingClientRect()
    menu.style.top = (rect.bottom + 6) + 'px'
    menu.style.right = Math.max(8, window.innerWidth - rect.right) + 'px'
    menu.hidden = false
  }
  btnApp.addEventListener('click', () => { if (menu.hidden) void openMenu(); else closeMenu() })
  document.addEventListener('pointerdown', (event) => {
    if (menu.hidden) return
    if (menu.contains(event.target) || btnApp.contains(event.target)) return
    closeMenu()
  }, true)

  // 右侧边栏开关（plain toggle 转发，无浮层链路）
  btnPanel.addEventListener('click', () => {
    (q('[data-sidebar-right-toggle]') ?? q('[data-sidebar-right-expand]'))?.click()
  })

  // 工作区点击 → 主进程解析 cwd 后 Finder 打开
  wsBtn.addEventListener('click', () => {
    const crumb = q('[class*="_crumbCurrent"]')
    const hint = crumb !== null && crumb.textContent !== '' ? { sessionId: crumb.textContent.trim() } : undefined
    void window.okShell?.revealWorkspace?.(hint)
  })

  /* ---- 工作区名/路径（IPC 桥 → 主进程读会话投影缓存） ---- */
  let workspaceBusy = false
  // " / " 分隔只在两端都有内容时显示：工作区段（refreshWorkspace）与
  // 会话标题（apply）各自置位，分隔符在两者齐备时才亮相
  let wsVisible = false
  let ttlVisible = false
  const syncSep = () => { wsSep.style.display = wsVisible && ttlVisible ? '' : 'none' }
  const refreshWorkspace = () => {
    const bridge = window.okShell
    if (workspaceBusy || bridge?.workspace === undefined) return
    const crumb = q('[class*="_crumbCurrent"]')
    const hint = crumb !== null && crumb.textContent !== '' ? { sessionId: crumb.textContent.trim() } : undefined
    workspaceBusy = true
    Promise.resolve(bridge.workspace(hint))
      .then((value) => {
        if (value !== null && value !== undefined && typeof value.name === 'string' && value.name !== '') {
          wsName.textContent = value.name
          wsBtn.dataset.path = value.path
          wsBtn.title = '打开工作区目录：' + value.path
          wsBtn.style.display = 'inline-flex'
          wsVisible = true
        } else {
          wsBtn.style.display = 'none'
          wsVisible = false
        }
        syncSep()
      })
      .catch(() => {})
      .finally(() => { workspaceBusy = false })
  }

  /* ---- 重画（KCoder apply 同款：配色/标题/徽章 + 异步落定自愈） ---- */
  const apply = () => {
    let color = ''
    try { color = getComputedStyle(document.body).getPropertyValue('--dsw-specific-sidebar-fill').trim() } catch {}
    const dark = document.body.hasAttribute('data-ds-dark-theme')
      || document.documentElement.style.colorScheme === 'dark'
    const bg = color !== '' ? color : (dark ? '#1B1B1C' : '#F9FAFB')
    // 无痕模式：透明覆盖，不铺底色（landing/登录页）
    bar.style.background = solid ? bg : 'transparent'
    menu.style.setProperty('--ok-tb-bg', bg)
    label.style.color = dark ? 'rgba(232,234,237,.9)' : 'rgba(26,29,33,.75)'
    bar.style.setProperty('--ok-tb-fg', dark ? 'rgba(232,234,237,.9)' : 'rgba(26,29,33,.75)')
    menu.style.setProperty('--ok-tb-fg', dark ? 'rgba(232,234,237,.9)' : 'rgba(26,29,33,.75)')
    const raw = (document.title || '').trim() || 'QiLin Desktop'
    // 会话标题 = document.title 去掉 " — 产品名" 尾巴；没有尾巴说明在
    // 无会话页（首页/登录页），此时 title 就是产品名本身——不显示，
    // 避免 "工作区 / QiLin" 这种品牌名当标题的错乱拼接
    const sepAt = raw.lastIndexOf(' — ')
    const sessionTitle = sepAt > 0 ? raw.slice(0, sepAt) : ''
    ttlTag.textContent = sessionTitle
    ttlTag.style.display = sessionTitle === '' ? 'none' : ''
    ttlVisible = sessionTitle !== ''
    syncSep()
    ttlTag.title = raw
    // 预设徽章：读上游会话头里的 AgentPresetLabel（该行已被本栏收纳隐藏）
    const preset = q('[class*="_titleRow"] span[class*="_label"]')?.textContent.trim() ?? ''
    presetTag.textContent = preset
    presetTag.style.display = preset !== '' ? '' : 'none'
    presetTag.title = preset
    btnPanel.hidden = !solid || q('[data-sidebar-right-toggle], [data-sidebar-right-expand]') === null
  }
  let settleTimers = []
  const applyWithSettle = () => {
    apply()
    for (const t of settleTimers) clearTimeout(t)
    settleTimers = [120, 400].map((d) => setTimeout(apply, d))
  }
  window.__okTitlebarApply = applyWithSettle
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyWithSettle) } catch {}

  let lastTitle = ''
  const tick = () => {
    const raw = document.title || ''
    if (raw !== lastTitle) {
      lastTitle = raw
      refreshWorkspace()
    }
    apply()
  }
  const mount = () => {
    applyWithSettle()
    refreshWorkspace()
    new MutationObserver(applyWithSettle).observe(document.documentElement, {
      attributes: true, attributeFilter: ['style', 'class'],
    })
    new MutationObserver(applyWithSettle).observe(document.body, {
      attributes: true, attributeFilter: ['data-ds-dark-theme', 'class'],
    })
    const titleEl = document.querySelector('title')
    if (titleEl) new MutationObserver(applyWithSettle).observe(titleEl, {
      childList: true, characterData: true, subtree: true,
    })
    setInterval(tick, 500)
  }
  // 页面判型探针：必须在全部常量定义之后启动（见上方注释）
  watchSidebarCol()
  if (document.body) mount()
  else document.addEventListener('DOMContentLoaded', mount, { once: true })
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
      win.webContents.executeJavaScript(INJECT_SCRIPT, true).catch((error) => {
        console.error('[titlebar] inject failed:', error)
      })
    }
  }
  win.webContents.on('dom-ready', inject)
  // 已加载完成的窗口（复用路径）也要补一次
  if (!win.webContents.isLoading()) inject()
}
