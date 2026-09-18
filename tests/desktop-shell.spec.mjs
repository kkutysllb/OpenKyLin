// tests/desktop-shell.spec.mjs
/**
 * 桌面壳（KCoder host & sidecar 机制）产品层测试：
 * 契约纯函数（就绪行解析、导航白名单、侧车命令）、启动页资产存在性、
 * dev 脚本的 checkout 复用 stamp 逻辑。不依赖 Electron 与上游 checkout。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import {
  MAX_AUTO_RESTARTS,
  READY_LINE_RE,
  READY_TIMEOUT_MS,
  TERM_GRACE_MS,
  isAllowedNavigation,
  parseReadyLine,
  qilinHome,
  sidecarArgs,
  urlOrigin,
} from '../desktop/main/qilin-contract.mjs'
import { brandingFingerprint } from '../scripts/lib/dev-stamp.mjs'
import {
  TERMINAL_PACKAGE,
  ensureBuiltinTerminal,
} from '../scripts/lib/terminal-builtin.mjs'
import {
  sessionTitleOf,
  pickSession,
} from '../desktop/main/workspace.mjs'

test('就绪行解析完整 URL（产品 profile 的 `qilin:` label，含 token 与 LAN 后缀）', () => {
  // 产品面（web-brand 层）把 web-runtime label 设为 `qilin`
  assert.equal(
    parseReadyLine('qilin: http://127.0.0.1:4567/workspace?token=test-token (LAN: http://192.168.1.5:4567/workspace?token=test-token)'),
    'http://127.0.0.1:4567/workspace?token=test-token',
  )
  // unbranded web profile 仍是 `qilin web:`
  assert.equal(parseReadyLine('qilin web: http://127.0.0.1:4567/?token=abc'), 'http://127.0.0.1:4567/?token=abc')
  assert.equal(parseReadyLine('qilin: http://127.0.0.1:4567/'), 'http://127.0.0.1:4567/')
})

test('就绪行拒绝非回环、非 http 与无关日志行', () => {
  assert.equal(parseReadyLine('LAN: http://127.0.0.1:9999/'), null, '只认行首的 qilin 就绪行')
  assert.equal(parseReadyLine('qilin: http://localhost:4567/'), null, '就绪地址固定为 127.0.0.1 字面量')
  assert.equal(parseReadyLine('qilin: https://127.0.0.1:4567/'), null)
  assert.equal(parseReadyLine('some other log line'), null)
  assert.equal(READY_LINE_RE.test('xqilin: http://127.0.0.1:1/'), false)
})

test('导航白名单按 origin 判断（token 换 cookie 的 302 落回同源）', () => {
  const origin = 'http://127.0.0.1:4567'
  assert.equal(isAllowedNavigation('http://127.0.0.1:4567/', origin), true, '干净根地址')
  assert.equal(isAllowedNavigation('http://127.0.0.1:4567/session/abc', origin), true, 'SPA 会话路由')
  assert.equal(isAllowedNavigation('http://127.0.0.1:4567/assets/app.js', origin), true, '静态资源')
  assert.equal(isAllowedNavigation('http://127.0.0.1:9999/', origin), false, '端口变化 = 别的进程')
  assert.equal(isAllowedNavigation('https://127.0.0.1:4567/', origin), false, '协议收紧')
  assert.equal(isAllowedNavigation('file:///etc/passwd', origin), false)
  assert.equal(isAllowedNavigation('not a url', origin), false)
  assert.equal(isAllowedNavigation('http://127.0.0.1:4567/', ''), false, '空 origin 一律拒绝')
})

test('urlOrigin 忽略查询与路径', () => {
  assert.equal(urlOrigin('http://127.0.0.1:4567/?token=x'), 'http://127.0.0.1:4567')
  assert.equal(urlOrigin('::bad::'), null)
})

test('侧车命令：裸 qilin 产品面 + --expose-internals + 稳定端口 + --no-open', () => {
  // 裸 `qilin` 启动产品面（base + web-app + web-brand：麒麟印章 + 主题层），
  // launcher flags 之后的 token 直通 booted app。端口由调用方传入：
  // 登录会话 cookie 绑定 host:port，端口漂移 = 凭证每次启动失效
  assert.deepEqual(sidecarArgs('/r/apps/cli/lib/bin.js', 41780), [
    '--expose-internals',
    '/r/apps/cli/lib/bin.js',
    '--port',
    '41780',
    '--no-open',
  ])
  assert.deepEqual(sidecarArgs('/r/apps/cli/lib/bin.js'), [
    '--expose-internals',
    '/r/apps/cli/lib/bin.js',
    '--port',
    '0',
    '--no-open',
  ], '缺省仍为 OS 分配（0）')
})

test('侧车端口记忆：round-trip、非法值拒绝、坏 JSON 容错', async () => {
  const { readPersistedPort, persistPort, SIDECAR_PORT_FILE } = await import('../desktop/main/qilin-contract.mjs')
  const home = await mkdtemp(join(tmpdir(), 'ok-port-'))
  try {
    assert.equal(readPersistedPort(home), null, '无记忆文件 → null')
    persistPort(41780, home)
    assert.equal(readPersistedPort(home), 41780)
    await writeFile(join(home, SIDECAR_PORT_FILE), JSON.stringify({ port: 80 }), 'utf8')
    assert.equal(readPersistedPort(home), null, '越界端口（<1024）→ null')
    await writeFile(join(home, SIDECAR_PORT_FILE), '{broken', 'utf8')
    assert.equal(readPersistedPort(home), null, '坏 JSON → null')
    await writeFile(join(home, SIDECAR_PORT_FILE), JSON.stringify({ port: 99999 }), 'utf8')
    assert.equal(readPersistedPort(home), null, '越界端口（>65535）→ null')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('进程纪律常量与 KCoder 机制一致', () => {
  assert.equal(MAX_AUTO_RESTARTS, 3)
  assert.equal(TERM_GRACE_MS, 5_000)
  assert.ok(READY_TIMEOUT_MS >= 60_000, '就绪上限需覆盖上游 profile 初始化冷启动')
})

test('qilin home 与 CLI/浏览器端共享（QILIN_HOME 覆盖优先）', () => {
  assert.equal(qilinHome({ QILIN_HOME: '/data/qilin' }), '/data/qilin')
  assert.equal(qilinHome({ QILIN_HOME: '   ' }), qilinHome({}), '空白覆盖视同未设置')
})

test('启动页资产齐备（splash.html + preload + 主进程三件套）', async () => {
  for (const rel of [
    'desktop/renderer/splash.html',
    'desktop/preload/splash.mjs',
    'desktop/main/index.mjs',
    'desktop/main/windows.mjs',
    'desktop/main/qilin-manager.mjs',
    'desktop/main/qilin-contract.mjs',
  ]) {
    await assert.doesNotReject(access(new URL(`../${rel}`, import.meta.url)), undefined, rel)
  }
  const splash = await readFile(new URL('../desktop/renderer/splash.html', import.meta.url), 'utf8')
  assert.match(splash, /云门正在开启/, '启动页主文案（与共享壳层 locale 一致）')
  assert.match(splash, /基于 QiLin 构建/, '品牌副标题')
  assert.match(splash, /重试启动/, '失败恢复入口')
  assert.match(splash, /Content-Security-Policy/, '本地页面也有 CSP')
})

test('branding 指纹随品牌输入变化（stamp 复用的守门依据）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ok-stamp-'))
  try {
    await mkdir(join(dir, 'patches'), { recursive: true })
    await mkdir(join(dir, 'branding/theme'), { recursive: true })
    await writeFile(join(dir, 'patches/registry.json'), JSON.stringify({
      schemaVersion: 1,
      patches: [{ patch: 'patches/shared-web-branding.patch' }],
      overwrites: [{ mode: 'add', source: 'branding/theme/tokens.css', target: 'apps/desktop/renderer/ok-theme.css' }],
    }))
    await writeFile(join(dir, 'patches/shared-web-branding.patch'), 'a\n')
    await writeFile(join(dir, 'branding/theme/tokens.css'), 'b\n')
    const before = brandingFingerprint(dir)
    assert.equal(brandingFingerprint(dir), before, '输入不变 → 指纹稳定')
    await writeFile(join(dir, 'patches/shared-web-branding.patch'), 'a2\n')
    assert.notEqual(brandingFingerprint(dir), before, 'patch 内容变化 → 指纹变化')
    await writeFile(join(dir, 'patches/shared-web-branding.patch'), 'a\n')
    await writeFile(join(dir, 'branding/theme/tokens.css'), 'b2\n')
    assert.notEqual(brandingFingerprint(dir), before, '覆盖源变化 → 指纹变化')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

/* ---------- 标题栏工作区解析（workspace.mjs 纯函数） ---------- */

test('窗口标题截掉上游 DocumentTitle 尾巴，取纯会话标题', () => {
  assert.equal(sessionTitleOf('项目核心引擎递归自进化能力 — QiLin'), '项目核心引擎递归自进化能力')
  assert.equal(sessionTitleOf('QiLin Desktop'), 'QiLin Desktop', '无尾巴原样返回')
  assert.equal(sessionTitleOf(undefined), '', '空值容错')
})

test('会话投影 → 当前工作区：标题精确优先，crumb 提示次之，mtime 兜底', () => {
  // 数据源 = QILIN_HOME 的 session_projcache（identity.cwd + rows.title.val）
  const entries = [
    { id: 'session-aaa', cwd: '/Users/libing/kk_Projects/OpenKylin', title: '旧会话', mtime: 100 },
    { id: 'session-bbb', cwd: '/Users/libing/kk_Projects/DSH-Desktop', title: '你好问候', mtime: 300 },
    { id: 'session-ccc', cwd: '/tmp/third', title: '无题', mtime: 200 },
  ]
  assert.deepEqual(
    pickSession(entries, { title: '你好问候' }),
    { name: 'DSH-Desktop', path: '/Users/libing/kk_Projects/DSH-Desktop' },
    '窗口标题 === 缓存标题 → 精确命中',
  )
  assert.deepEqual(
    pickSession(entries, { sessionId: 'session-aaa' }),
    { name: 'OpenKylin', path: '/Users/libing/kk_Projects/OpenKylin' },
    'crumb 提示命中文件名 → 该会话工作区',
  )
  assert.deepEqual(
    pickSession(entries),
    { name: 'DSH-Desktop', path: '/Users/libing/kk_Projects/DSH-Desktop' },
    '无提示 → mtime 最新（最近活动会话）',
  )
  assert.deepEqual(
    pickSession([{ id: 's', cwd: '/tmp/x', title: '', mtime: 1 }], { title: '别的' }),
    { name: 'x', path: '/tmp/x' },
    '标题不齐的条目仍可作兜底候选',
  )
  assert.equal(pickSession([], {}), null, '空清单 → null')
  assert.equal(pickSession('not-an-array'), null, '非法输入容错')
})

/* ---------- 标题栏 / 无边框窗口（呈现层契约，源文件标记） ---------- */

test('自绘标题栏：KCoder SHELL_TITLEBAR_JS 移植 + 窗口级按钮', async () => {
  const source = await readFile(new URL('../desktop/main/titlebar.mjs', import.meta.url), 'utf8')
  // KCoder 实测常量：48px 栏、darwin leftPad 78、侧栏右缘跟随
  assert.match(source, /TITLEBAR_HEIGHT = 48/, '高度照抄 KCoder（红绿灯 y 自动=18）')
  assert.match(source, /LEFT_PAD = 78/, 'darwin 左基线照抄 KCoder')
  assert.match(source, /sidebarCol/, '侧栏右缘探针（KCoder 同款，标题对齐主内容列）')
  assert.match(source, /--ok-sidebar-w/, '侧栏宽度变量驱动标题起排')
  // 工作区段：文件夹图标 + 弱化色 + " / " 分隔（KCoder 同款）
  assert.match(source, /ok-ws-btn/, '工作区实体按钮（点击打开目录）')
  assert.match(source, /translateY\(\.5px\)/, '图标光学中心微调（KCoder 同款）')
  assert.match(source, /_titleRow.*_label/s, '预设徽章收纳上游 AgentPresetLabel')
  // 编辑器选择：自持菜单直启上游接口，零模拟点击
  assert.match(source, /open-in-app\/apps/, '应用清单走上游 HTTP 接口')
  assert.match(source, /open-in-app\/open/, '启动走上游 HTTP 接口')
  assert.match(source, /qilin\.open-in-app\.choice/, '记忆选择与上游同键互通')
  assert.match(source, /data-sidebar-right-toggle/, '右侧边栏开关镜像上游稳定 data 钩子')
  assert.match(source, /data-sidebar-right-expand/, '面板收起态的展开按钮同样镜像')
  assert.match(source, /__dsh_desktop_titlebar/, '终端插件挂载哨兵（KCoder 宿主契约同款 id）')
  assert.match(source, /__dsh_kc_term_btn \{ color: var\(--ok-tb-fg/, '插件按钮配色对齐本栏前景（上游硬编码浅色）')
  assert.match(source, /header\[class\*="_header"\]:has\(\[class\*="_titleRow"\]\)/, '会话头重复行整行收掉，空间归还主工作区')
  assert.match(source, /okShell\?\.revealWorkspace/, '工作区名点击 → 主进程 Finder 打开')
  assert.match(source, /bridge\?\.workspace/, '工作区名经桥解析（页面只传只读提示）')
  assert.match(source, /--ok-tb-h/, '高度变量供上游 inset 消费（设置页覆盖层让位）')
  assert.match(source, /-webkit-app-region: ?no-drag/, '可点元素不落拖拽区')
  // 实心栏下侧栏顶部收紧：类名为哈希前缀子串探针（如 _34ohLq_logoRow），
  // 且必须限定 sidebarCol 列内——否则匹配不上运行时 DOM 或误伤其它包
  assert.match(source, /ok-tb-solid \[class\*="sidebarCol"\] \[class\*="_logoRow"\]/, 'logoRow 顶部收紧（60px figma 行高压到 44px）')
  assert.match(source, /ok-tb-solid \[class\*="sidebarCol"\] \[class\*="_collapsed"\] \[class\*="_logoRow"\]/, '折叠 rail 几何显式还原')
  assert.match(source, /ok-tb-solid \[class\*="sidebarCol"\] > \[class\*="_root"\]/, '侧栏根 padding-top 归零')
})

test('窗口层：整窗无边框 + 红绿灯召回 + 沙箱 preload 白名单桥', async () => {
  const windows = await readFile(new URL('../desktop/main/windows.mjs', import.meta.url), 'utf8')
  assert.match(windows, /frame: false/, 'shell 窗口无边框')
  assert.match(windows, /setWindowButtonVisibility\(true\)/, 'macOS frameless 红绿灯显式召回')
  assert.match(windows, /trafficLightPosition[\s\S]*?y: Math\.round\(TITLEBAR_HEIGHT \/ 2\)/, '红绿灯垂直中心 = 栏高一半（与标题文字共享 24px 光学中线）')
  assert.match(windows, /preload: SHELL_PRELOAD/, 'shell 窗口挂标题栏桥')
  await assert.doesNotReject(access(new URL('../desktop/preload/shell.cjs', import.meta.url)))
  const preload = await readFile(new URL('../desktop/preload/shell.cjs', import.meta.url), 'utf8')
  assert.match(preload, /contextBridge/, '桥面走 contextBridge')
  assert.match(preload, /ok:workspace/, 'IPC 白名单：工作区解析')
  assert.match(preload, /require\('electron'\)/, '沙箱 preload 仅 CJS')
  const splash = await readFile(new URL('../desktop/renderer/splash.html', import.meta.url), 'utf8')
  assert.match(splash, /-webkit-app-region: drag/, '无边框启动页整页可拖')
})

test('设置页覆盖层 inset 补丁已注册且命中上游锚点', async () => {
  const registry = JSON.parse(await readFile(new URL('../patches/registry.json', import.meta.url), 'utf8'))
  assert.ok(
    registry.patches.some((entry) => entry.patch === 'patches/desktop-titlebar-inset.patch'),
    'registry 必须列出 inset 补丁（否则 checkout 不带此修复）',
  )
  const patch = await readFile(new URL('../patches/desktop-titlebar-inset.patch', import.meta.url), 'utf8')
  assert.match(patch, /SettingsRoot\.module\.css/, '命中设置页壳样式')
  assert.match(patch, /landing\.css/, '命中 landing 页 site-header（logo/标签/主题切换）')
  assert.doesNotMatch(patch, /auth\.css/, '注册登录页保持纯 web 观感（无痕覆盖不压内容、不让位）')
  assert.match(patch, /top: var\(--ok-tb-h, 0px\)/, 'fixed 覆盖层让出标题栏；纯 web 回落 0')
})

/* ---------- 内置终端插件（vendor 物化） ---------- */

test('vendored dsh-terminal 是合法的 dsh bundle 层', async () => {
  const manifest = JSON.parse(await readFile(new URL('../vendor/dsh-terminal/package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.name, TERMINAL_PACKAGE)
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml', '上游 dsh 兼容层读取的 bundle 声明')
  assert.equal(manifest.qilin?.bundle?.patch, './cordis.patch.yml', 'QiLin 插件管理器只认的原生 bundle 键（缺失即"没有声明组合包"）')
  assert.equal(manifest.exports?.['./client'], './client.js', 'client 交付物（xterm.js 面板）')
  await assert.doesNotReject(access(new URL('../vendor/dsh-terminal/entry.js', import.meta.url)), undefined, 'entry.js')
  await assert.doesNotReject(access(new URL('../vendor/dsh-terminal/vendor/xterm.js', import.meta.url)), undefined, 'xterm vendor')
  const client = await readFile(new URL('../vendor/dsh-terminal/client.js', import.meta.url), 'utf8')
  assert.match(client, /--dsh-sidebar-width/, 'KCoder 宿主变量探针保留')
  assert.match(client, /querySelector\('\[data-rightbar-col\]'\)/, 'QiLin 右栏回退探针（变量缺失时量列宽）')
  assert.match(client, /ResizeObserver\(readRightPanel\)/, '右栏开合/拖宽驱动面板重排（不侵占右侧栏下方区域）')
})

test('内置终端物化：进 profile 私有安装锚 + 注册 bundle 层（幂等，pty 缺失不阻塞）', async () => {
  const repoRoot = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
  const home = await mkdtemp(join(tmpdir(), 'ok-terminal-home-'))
  const previousEnv = process.env.OPENKYLIN_NO_BUILTIN_TERMINAL
  delete process.env.OPENKYLIN_NO_BUILTIN_TERMINAL
  try {
    // 预置可解析的假 node-pty 探针（共享锚）：测试环境不真装 native 包；
    // 共享锚副本经 ancestor 解析可达，同样应让 pty 探测通过
    const fakePty = join(home, 'profiles', 'node_modules', 'node-pty')
    await mkdir(fakePty, { recursive: true })
    await writeFile(join(fakePty, 'package.json'), JSON.stringify({ name: 'node-pty', main: 'index.js' }))
    await writeFile(join(fakePty, 'index.js'), 'module.exports = {}\n')
    // 预置 alpha.2 前的旧共享锚布局：物化时应清走，避免双副本
    const legacy = join(home, 'profiles', 'node_modules', '@kkutysllb', 'dsh-terminal')
    await mkdir(legacy, { recursive: true })

    const first = ensureBuiltinTerminal({ repoRoot, home })
    assert.equal(first.installed, true, '物化成功')
    assert.equal(first.pty, true, '探针在 → 不触发 npm')

    const destination = join(home, 'profiles', 'qilin', 'node_modules', '@kkutysllb', 'dsh-terminal')
    const copied = JSON.parse(await readFile(join(destination, 'package.json'), 'utf8'))
    assert.equal(copied.name, TERMINAL_PACKAGE, '包已拷贝到 profile 私有安装锚（runtime+enforce 解析可达）')
    assert.equal(existsSync(legacy), false, '旧共享锚副本被清理（enforce 禁区不留死层包）')

    const manifest = JSON.parse(await readFile(join(home, 'profiles', 'qilin', 'package.json'), 'utf8'))
    assert.deepEqual(
      manifest.qilin.profile.bundles,
      ['@qilin/base', '@qilin/web-app', '@qilin/web-brand', TERMINAL_PACKAGE],
      'bundle 层按序追加',
    )

    const second = ensureBuiltinTerminal({ repoRoot, home })
    assert.equal(second.installed, true, '幂等重跑不抛错')

    process.env.OPENKYLIN_NO_BUILTIN_TERMINAL = '1'
    assert.equal(ensureBuiltinTerminal({ repoRoot, home }).reason, 'disabled-by-env', '环境开关可关闭')
  } finally {
    if (previousEnv === undefined) delete process.env.OPENKYLIN_NO_BUILTIN_TERMINAL
    else process.env.OPENKYLIN_NO_BUILTIN_TERMINAL = previousEnv
    await rm(home, { recursive: true, force: true })
  }
})

test('dev 脚本已接入内置终端物化步骤', async () => {
  const dev = await readFile(new URL('../scripts/dev.mjs', import.meta.url), 'utf8')
  assert.match(dev, /ensureBuiltinTerminal/, 'launch 前物化')
})
