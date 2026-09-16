// tests/desktop-shell.spec.mjs
/**
 * 桌面壳（KCoder host & sidecar 机制）产品层测试：
 * 契约纯函数（就绪行解析、导航白名单、侧车命令）、启动页资产存在性、
 * dev 脚本的 checkout 复用 stamp 逻辑。不依赖 Electron 与上游 checkout。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
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

test('侧车命令：裸 qilin 产品面 + --expose-internals + --port 0 --no-open', () => {
  // 裸 `qilin` 启动产品面（base + web-app + web-brand：麒麟印章 + 主题层），
  // launcher flags 之后的 token 直通 booted app
  assert.deepEqual(sidecarArgs('/r/apps/cli/lib/bin.js'), [
    '--expose-internals',
    '/r/apps/cli/lib/bin.js',
    '--port',
    '0',
    '--no-open',
  ])
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
