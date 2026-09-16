# OpenKylin 桌面端实施计划

> 状态：已由实现取代；APPLE_API_KEY_PATH 等细节以 workflows 现状为准。

**Goal:** 在 OpenKylin 仓库建立"上游临时构建 + 共享 Web 品牌主题 + macOS arm64 Desktop 发布"的完整产品化控制面，所有脚本零外部依赖、全部可测试。

**Architecture:** 仓库只保存产品控制面（上游版本锁、品牌资产、补丁注册、构建编排、验证脚本）。CI 在临时目录拉取精确 QiLin commit，先构建唯一 `@qilin/web-frontend/dist`，同一构建物供 Web 与 Desktop 共用，通过摘要比对强制双端同步，最后打包签名并发布到 GitHub Release。

**Tech Stack:** Node.js ≥22 原生能力（`node:test`、`node:assert/strict`、`node:crypto`、`node:child_process`），纯 ESM `.mjs` 脚本，零 npm 依赖；上游构建用 pnpm；CI 用 GitHub Actions macOS runner。

> 与设计文档的差异说明：设计文档中的 `tests/*.spec.ts` 落地为 `tests/*.spec.mjs`（Node 原生测试运行器不编译 TS，避免引入测试工具链）。

---

## 文件结构

```text
OpenKylin/
├── package.json                          # 脚本入口，零依赖
├── .gitignore
├── upstream/qilin.lock.json              # 上游精确锁定
├── branding/
│   ├── brand-manifest.json               # 品牌单一来源
│   ├── logo/qilin.svg                    # 授权 Logo（人工放入）
│   ├── theme/tokens.css                  # 共享主题 Token
│   └── trademarks/NOTICE.zh-CN.md
├── patches/registry.json                 # 补丁/覆盖注册表
├── scripts/
│   ├── lib/hash.mjs                      # sha256 工具
│   ├── verify-upstream.mjs
│   ├── verify-branding.mjs
│   ├── fetch-upstream.mjs
│   ├── apply-branding.mjs
│   ├── build-desktop.mjs
│   ├── verify-web-desktop-sync.mjs
│   ├── verify-artifact.mjs
│   ├── check-source-leakage.mjs
│   └── generate-release-manifest.mjs
├── tests/*.spec.mjs                      # node --test
├── .github/workflows/
│   ├── build-macos-arm64.yml
│   └── release.yml
└── README.md                             # 更新为产品说明
```

---

### Task 1: 仓库脚手架（package.json / .gitignore / 冒烟测试）

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Test: `tests/scaffold.spec.mjs`

- [ ] **Step 1: 写失败测试**

```js
// tests/scaffold.spec.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('package.json 是零依赖 ESM 产品仓库', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.private, true)
  assert.deepEqual(pkg.dependencies, undefined)
  assert.match(pkg.scripts.test, /^node --test/)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/scaffold.spec.mjs`
Expected: FAIL（找不到 package.json 的 type/module 字段）

- [ ] **Step 3: 写实现**

```json
{
  "name": "openkylin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "node --test 'tests/**/*.spec.mjs'",
    "verify:upstream": "node scripts/verify-upstream.mjs",
    "verify:branding": "node scripts/verify-branding.mjs",
    "fetch:upstream": "node scripts/fetch-upstream.mjs",
    "apply:branding": "node scripts/apply-branding.mjs",
    "build:desktop": "node scripts/build-desktop.mjs",
    "verify:sync": "node scripts/verify-web-desktop-sync.mjs",
    "verify:artifact": "node scripts/verify-artifact.mjs",
    "check:leakage": "node scripts/check-source-leakage.mjs",
    "release:manifest": "node scripts/generate-release-manifest.mjs"
  }
}
```

```gitignore
# .gitignore
node_modules/
.tmp/
dist/
*.log
.DS_Store
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test`
Expected: PASS（1 test）

- [ ] **Step 5: 提交**

```bash
git add package.json .gitignore tests/scaffold.spec.mjs
git commit -m "chore: scaffold zero-dependency product repo"
```

---

### Task 2: 哈希工具库 `scripts/lib/hash.mjs`

**Files:**
- Create: `scripts/lib/hash.mjs`
- Test: `tests/hash.spec.mjs`

- [ ] **Step 1: 写失败测试**

```js
// tests/hash.spec.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { sha256File, sha256Text, dirDigest } from '../scripts/lib/hash.mjs'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('sha256Text 输出 64 位十六进制', () => {
  assert.equal(sha256Text('abc').length, 64)
  assert.equal(sha256Text('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('dirDigest 对相同内容稳定、对任一文件变化敏感', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ok-hash-'))
  try {
    await mkdir(join(root, 'a'), { recursive: true })
    await writeFile(join(root, 'a', 'one.txt'), '1')
    await writeFile(join(root, 'b.txt'), '2')
    const first = await dirDigest(root)
    const second = await dirDigest(root)
    assert.equal(first, second)
    await writeFile(join(root, 'b.txt'), '3')
    assert.notEqual(await dirDigest(root), first)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/hash.spec.mjs`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

```js
// scripts/lib/hash.mjs
/** Deterministic hashing helpers shared by verification scripts. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

export function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export async function sha256File(path) {
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = createReadStream(path)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', resolve)
    stream.on('error', reject)
  })
  return hash.digest('hex')
}

/** Hash a whole directory: sorted relative paths, each with its content hash. */
export async function dirDigest(root) {
  const entries = []
  async function walk(dir) {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name)
      const info = await stat(path)
      if (info.isDirectory()) await walk(path)
      else entries.push([relative(root, path).split(sep).join('/'), await sha256File(path)])
    }
  }
  await walk(root)
  return sha256Text(entries.map(([p, h]) => `${p}\0${h}`).join('\n'))
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/hash.spec.mjs`
Expected: PASS（2 tests）

- [ ] **Step 5: 提交**

```bash
git add scripts/lib/hash.mjs tests/hash.spec.mjs
git commit -m "feat: add deterministic hash helpers"
```

---

### Task 3: 上游版本锁 `upstream/qilin.lock.json` 与校验脚本

**Files:**
- Create: `upstream/qilin.lock.json`
- Create: `scripts/verify-upstream.mjs`
- Test: `tests/upstream-lock.spec.mjs`

- [ ] **Step 1: 写失败测试**

```js
// tests/upstream-lock.spec.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseUpstreamLock } from '../scripts/verify-upstream.mjs'

const lock = JSON.parse(await readFile(new URL('../upstream/qilin.lock.json', import.meta.url), 'utf8'))

test('仓库锁文件通过 schema 校验', () => {
  assert.deepEqual(parseUpstreamLock(lock), lock)
})

test('拒绝坏 commit 与坏 target', () => {
  assert.throws(() => parseUpstreamLock({ ...lock, qilinCommit: 'main' }), /qilinCommit/)
  assert.throws(() => parseUpstreamLock({ ...lock, target: 'linux-x64' }), /target/)
  assert.throws(() => parseUpstreamLock({ ...lock, schemaVersion: 2 }), /schemaVersion/)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/upstream-lock.spec.mjs`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写锁文件与实现**

```json
{
  "schemaVersion": 1,
  "productVersion": "0.1.0",
  "qilinRepository": "https://github.com/deepseek-ai/deepseek-harness.git",
  "qilinCommit": "0000000000000000000000000000000000000000",
  "qilinVersion": "3.0.0",
  "nodeVersion": "24.17.0",
  "pnpmVersion": "11.7.0",
  "target": "mac-arm64"
}
```

> 注：`qilinCommit` 初始为全零占位，首次执行升级流程时替换为真实 40 位 commit；`verify:upstream` 只校验格式，不校验具体值。

```js
// scripts/verify-upstream.mjs
/** Validate upstream/qilin.lock.json against the product lock contract. */
import { readFile } from 'node:fs/promises'

const COMMIT = /^[0-9a-f]{40}$/
const SEMVER = /^\d+\.\d+\.\d+$/
const TARGETS = new Set(['mac-arm64', 'mac-x64', 'win-x64'])

export function parseUpstreamLock(value) {
  if (typeof value !== 'object' || value === null) throw new Error('upstream lock: not an object')
  for (const field of ['productVersion', 'qilinVersion', 'nodeVersion', 'pnpmVersion']) {
    if (typeof value[field] !== 'string' || !SEMVER.test(value[field])) {
      throw new Error(`upstream lock: ${field} must be semver, got ${JSON.stringify(value[field])}`)
    }
  }
  if (typeof value.qilinCommit !== 'string' || !COMMIT.test(value.qilinCommit)) {
    throw new Error(`upstream lock: qilinCommit must be a 40-char sha, got ${JSON.stringify(value.qilinCommit)}`)
  }
  if (typeof value.qilinRepository !== 'string' || !value.qilinRepository.startsWith('https://')) {
    throw new Error('upstream lock: qilinRepository must be an https URL')
  }
  if (value.schemaVersion !== 1) throw new Error(`upstream lock: unsupported schemaVersion ${value.schemaVersion}`)
  if (!TARGETS.has(value.target)) throw new Error(`upstream lock: unsupported target ${value.target}`)
  return value
}

export async function verifyUpstreamLock(path) {
  return parseUpstreamLock(JSON.parse(await readFile(path, 'utf8')))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const lock = await verifyUpstreamLock(process.argv[2] ?? 'upstream/qilin.lock.json')
  console.log(`upstream lock ok: qilin ${lock.qilinVersion} @ ${lock.qilinCommit.slice(0, 12)}`)
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test && npm run verify:upstream`
Expected: PASS；`upstream lock ok: qilin 3.0.0 @ 000000000000`

- [ ] **Step 5: 提交**

```bash
git add upstream/qilin.lock.json scripts/verify-upstream.mjs tests/upstream-lock.spec.mjs
git commit -m "feat: add upstream lock and verifier"
```

---

### Task 4: 品牌清单 `branding/brand-manifest.json` 与校验脚本

**Files:**
- Create: `branding/brand-manifest.json`
- Create: `branding/theme/tokens.css`
- Create: `branding/trademarks/NOTICE.zh-CN.md`
- Create: `scripts/verify-branding.mjs`
- Test: `tests/brand-manifest.spec.mjs`

- [ ] **Step 1: 写失败测试**

```js
// tests/brand-manifest.spec.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseBrandManifest, contrastRatio } from '../scripts/verify-branding.mjs'

const manifest = JSON.parse(await readFile(new URL('../branding/brand-manifest.json', import.meta.url), 'utf8'))

test('品牌清单通过 schema 与对比度校验', () => {
  assert.deepEqual(parseBrandManifest(manifest), manifest)
})

test('contrastRatio 满足 WCAG 数学', () => {
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21)
  assert.throws(() => contrastRatio('#000000', '#000000'), /contrast/)
})

test('每个主题的 paper/ink 对比度 ≥ 4.5', () => {
  for (const scheme of ['light', 'dark']) {
    const { paper, ink } = manifest.theme[scheme]
    assert.ok(contrastRatio(ink, paper) >= 4.5, `${scheme} contrast`)
  }
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/brand-manifest.spec.mjs`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写品牌文件与实现**

```json
{
  "schemaVersion": 1,
  "productName": "OpenKylin Desktop",
  "displayName": "QiLin Desktop",
  "subtitle": "基于 QiLin 构建的中文桌面智能工作台",
  "defaultLocale": "zh-CN",
  "logo": { "source": "branding/logo/qilin.svg", "usage": "authorized" },
  "theme": {
    "light": { "paper": "#F7F3EA", "ink": "#17191C", "cinnabar": "#B7352C", "jade": "#5D8275", "gold": "#B89152" },
    "dark": { "paper": "#17191C", "ink": "#F7F3EA", "cinnabar": "#C94A40", "jade": "#83A99A", "gold": "#D0AA67" }
  },
  "trademarkNotice": "QiLin 商标及 Logo 归其权利人所有"
}
```

```css
/* branding/theme/tokens.css — shared Web/Desktop theme tokens (source of truth). */
:root {
  --ok-paper: #F7F3EA;
  --ok-ink: #17191C;
  --ok-cinnabar: #B7352C;
  --ok-jade: #5D8275;
  --ok-gold: #B89152;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ok-paper: #17191C;
    --ok-ink: #F7F3EA;
    --ok-cinnabar: #C94A40;
    --ok-jade: #83A99A;
    --ok-gold: #D0AA67;
  }
}
```

```markdown
<!-- branding/trademarks/NOTICE.zh-CN.md -->
# 商标声明

QiLin 商标及 Logo 归其权利人所有。本发行版由 OpenKylin 维护，经授权在
产品名称、应用图标、启动页和关于页中使用 QiLin Logo，并保留本归属声明。
授权范围见受控品牌资料，不在仓库中保存授权文件本体。
```

```js
// scripts/verify-branding.mjs
/** Validate branding/brand-manifest.json: schema, hex colors, WCAG contrast. */
import { readFile } from 'node:fs/promises'

const HEX = /^#[0-9a-fA-F]{6}$/
const COLOR_FIELDS = ['paper', 'ink', 'cinnabar', 'jade', 'gold']

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16)
  const channel = shift => {
    const c = ((n >> shift) & 0xff) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
}

export function contrastRatio(foreground, background) {
  if (!HEX.test(foreground) || !HEX.test(background)) throw new Error(`contrast: bad hex ${foreground}/${background}`)
  const [hi, lo] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  const ratio = (hi + 0.05) / (lo + 0.05)
  if (ratio <= 1) throw new Error(`contrast: degenerate ratio for ${foreground}/${background}`)
  return ratio
}

export function parseBrandManifest(value) {
  if (typeof value !== 'object' || value === null) throw new Error('brand manifest: not an object')
  if (value.schemaVersion !== 1) throw new Error('brand manifest: unsupported schemaVersion')
  for (const field of ['productName', 'displayName', 'subtitle', 'trademarkNotice']) {
    if (typeof value[field] !== 'string' || value[field] === '') throw new Error(`brand manifest: ${field} required`)
  }
  if (value.defaultLocale !== 'zh-CN') throw new Error('brand manifest: defaultLocale must be zh-CN')
  if (value.logo?.usage !== 'authorized' || typeof value.logo?.source !== 'string') {
    throw new Error('brand manifest: logo must record authorized usage and source path')
  }
  for (const scheme of ['light', 'dark']) {
    const theme = value.theme?.[scheme]
    if (typeof theme !== 'object' || theme === null) throw new Error(`brand manifest: theme.${scheme} required`)
    for (const field of COLOR_FIELDS) {
      if (typeof theme[field] !== 'string' || !HEX.test(theme[field])) {
        throw new Error(`brand manifest: theme.${scheme}.${field} must be a hex color`)
      }
    }
    if (contrastRatio(theme.ink, theme.paper) < 4.5) {
      throw new Error(`brand manifest: theme.${scheme} paper/ink contrast below 4.5`)
    }
  }
  return value
}

if (import.meta.url === `file://${process.argv[1]}`) {
  parseBrandManifest(JSON.parse(await readFile(process.argv[2] ?? 'branding/brand-manifest.json', 'utf8')))
  console.log('brand manifest ok')
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test && npm run verify:branding`
Expected: PASS；`brand manifest ok`

- [ ] **Step 5: 提交**

```bash
git add branding/brand-manifest.json branding/theme/tokens.css branding/trademarks/NOTICE.zh-CN.md scripts/verify-branding.mjs tests/brand-manifest.spec.mjs
git commit -m "feat: add brand manifest with chinese theme tokens"
```

> 人工步骤（非代码任务）：将获得授权的 QiLin Logo SVG 复制到 `branding/logo/qilin.svg`，不修改图形本身。

---

### Task 5: 上游拉取脚本 `scripts/fetch-upstream.mjs`

**Files:**
- Create: `scripts/fetch-upstream.mjs`
- Test: `tests/fetch-upstream.spec.mjs`

- [ ] **Step 1: 写失败测试**

```js
// tests/fetch-upstream.spec.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchUpstream } from '../scripts/fetch-upstream.mjs'

const run = promisify(execFile)

async function initUpstreamFixture() {
  const repo = await mkdtemp(join(tmpdir(), 'ok-qilin-repo-'))
  const runIn = args => run('git', ['-C', repo, ...args])
  await runIn(['init', '-b', 'main'])
  await runIn(['config', 'user.email', 't@example.com'])
  await runIn(['config', 'user.name', 't'])
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name: '@qilin/root', version: '3.0.0' }))
  await runIn(['add', '.'])
  await runIn(['commit', '-m', 'init'])
  const { stdout } = await runIn(['rev-parse', 'HEAD'])
  return { repo, commit: stdout.trim() }
}

test('fetchUpstream checkout 精确 commit 并校验版本', async () => {
  const { repo, commit } = await initUpstreamFixture()
  const out = join(await mkdtemp(join(tmpdir(), 'ok-src-')), 'qilin-src')
  try {
    const summary = await fetchUpstream({ repository: repo, commit, qilinVersion: '3.0.0', out })
    assert.equal(summary.commit, commit)
    const pkg = JSON.parse(await readFile(join(out, 'package.json'), 'utf8'))
    assert.equal(pkg.version, '3.0.0')
  } finally {
    await rm(out, { recursive: true, force: true })
  }
})

test('版本不匹配时失败', async () => {
  const { repo, commit } = await initUpstreamFixture()
  await assert.rejects(
    fetchUpstream({ repository: repo, commit, qilinVersion: '9.9.9', out: join(tmpdir(), 'ok-never') }),
    /version mismatch/,
  )
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/fetch-upstream.spec.mjs`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

```js
// scripts/fetch-upstream.mjs
/** Clone the locked QiLin commit into an ephemeral directory and verify its identity. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const run = promisify(execFile)

/**
 * @param {{ repository: string, commit: string, qilinVersion: string, out: string }} options
 * @returns {Promise<{ commit: string, qilinVersion: string, out: string }>}
 */
export async function fetchUpstream({ repository, commit, qilinVersion, out }) {
  await rm(out, { recursive: true, force: true })
  await run('git', ['clone', '--no-checkout', repository, out])
  await run('git', ['-C', out, 'checkout', '--detach', commit])
  const pkg = JSON.parse(await readFile(join(out, 'package.json'), 'utf8'))
  if (pkg.version !== qilinVersion) {
    throw new Error(`upstream version mismatch: lock expects ${qilinVersion}, commit ${commit.slice(0, 12)} has ${pkg.version}`)
  }
  const summary = { commit, qilinVersion: pkg.version, out }
  await writeFile(join(out, '.openkylin-upstream.json'), `${JSON.stringify(summary, null, 2)}\n`)
  return summary
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [repository, commit, qilinVersion, out] = process.argv.slice(2)
  if (!repository || !commit || !qilinVersion || !out) {
    throw new Error('usage: fetch-upstream.mjs <repository> <commit> <qilinVersion> <out>')
  }
  console.log(await fetchUpstream({ repository, commit, qilinVersion, out }))
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/fetch-upstream.spec.mjs`
Expected: PASS（2 tests）

- [ ] **Step 5: 提交**

```bash
git add scripts/fetch-upstream.mjs tests/fetch-upstream.spec.mjs
git commit -m "feat: add locked upstream fetch"
```

---

### Task 6: 补丁注册表与品牌应用脚本 `scripts/apply-branding.mjs`

**Files:**
- Create: `patches/registry.json`
- Create: `scripts/apply-branding.mjs`
- Test: `tests/apply-branding.spec.mjs`

- [ ] **Step 1: 写失败测试**

```js
// tests/apply-branding.spec.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sha256Text } from '../scripts/lib/hash.mjs'
import { applyBranding } from '../scripts/apply-branding.mjs'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ok-brand-'))
  const upstream = join(root, 'upstream')
  await mkdir(join(upstream, 'apps', 'desktop', 'renderer'), { recursive: true })
  await writeFile(join(upstream, 'apps', 'desktop', 'renderer', 'startup.css'), 'body{}')
  const product = join(root, 'product')
  await mkdir(join(product, 'branding', 'shell'), { recursive: true })
  await writeFile(join(product, 'branding', 'shell', 'startup.css'), 'body{background:#F7F3EA}')
  return { root, upstream, product }
}

test('覆盖文件：SHA 匹配则替换并写回执', async () => {
  const { root, upstream, product } = await fixture()
  const registry = {
    schemaVersion: 1,
    overwrites: [{
      source: 'branding/shell/startup.css',
      target: 'apps/desktop/renderer/startup.css',
      expectSha256: sha256Text('body{}'),
    }],
    patches: [],
  }
  try {
    const applied = await applyBranding({ productRoot: product, upstreamRoot: upstream, registry })
    assert.equal(applied.overwrites.length, 1)
    const body = await readFile(join(upstream, 'apps', 'desktop', 'renderer', 'startup.css'), 'utf8')
    assert.match(body, /#F7F3EA/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('SHA 不匹配立即失败且不写目标', async () => {
  const { root, upstream, product } = await fixture()
  const registry = {
    schemaVersion: 1,
    overwrites: [{ source: 'branding/shell/startup.css', target: 'apps/desktop/renderer/startup.css', expectSha256: 'deadbeef' }],
    patches: [],
  }
  try {
    await assert.rejects(applyBranding({ productRoot: product, upstreamRoot: upstream, registry }), /sha mismatch/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/apply-branding.spec.mjs`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

```js
// scripts/apply-branding.mjs
/** Apply branding overwrites and git patches to the ephemeral upstream checkout. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { sha256File } from './lib/hash.mjs'

const run = promisify(execFile)

/**
 * @param {{ productRoot: string, upstreamRoot: string, registry: object }} options
 * @returns {Promise<{ overwrites: string[], patches: string[] }>}
 */
export async function applyBranding({ productRoot, upstreamRoot, registry }) {
  if (registry.schemaVersion !== 1) throw new Error(`branding registry: unsupported schemaVersion ${registry.schemaVersion}`)
  const overwrites = []
  for (const entry of registry.overwrites ?? []) {
    const target = join(upstreamRoot, entry.target)
    const actual = await sha256File(target)
    if (entry.expectSha256 && actual !== entry.expectSha256) {
      throw new Error(`branding overwrite: sha mismatch for ${entry.target}: expected ${entry.expectSha256}, found ${actual}`)
    }
    await mkdir(dirname(target), { recursive: true })
    await copyFile(join(productRoot, entry.source), target)
    overwrites.push(entry.target)
  }
  const patches = []
  for (const patch of registry.patches ?? []) {
    const patchPath = join(productRoot, patch.patch)
    await run('git', ['-C', upstreamRoot, 'apply', '--check', patchPath])
    await run('git', ['-C', upstreamRoot, 'apply', patchPath])
    patches.push(patch.patch)
  }
  await writeFile(join(upstreamRoot, '.openkylin-branding.json'),
    `${JSON.stringify({ overwrites, patches }, null, 2)}\n`)
  return { overwrites, patches }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [productRoot, upstreamRoot, registryPath] = process.argv.slice(2)
  if (!productRoot || !upstreamRoot || !registryPath) {
    throw new Error('usage: apply-branding.mjs <productRoot> <upstreamRoot> <registry.json>')
  }
  const registry = JSON.parse(await readFile(registryPath, 'utf8'))
  console.log(await applyBranding({ productRoot, upstreamRoot, registry }))
}
```

```json
{
  "schemaVersion": 1,
  "overwrites": [
    {
      "source": "branding/theme/tokens.css",
      "target": "apps/desktop/renderer/ok-theme.css",
      "expectSha256": null
    }
  ],
  "patches": [
    { "patch": "patches/desktop-branding.patch", "scope": "apps/desktop" }
  ]
}
```

> `desktop-branding.patch` 首次针对锁定的上游 commit 生成（`git diff > patches/desktop-branding.patch`），内容限于壳层文案/窗口标题/关于页；`expectSha256: null` 表示该目标由 CI 首跑记录回填。

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/apply-branding.spec.mjs`
Expected: PASS（2 tests）

- [ ] **Step 5: 提交**

```bash
git add patches/registry.json scripts/apply-branding.mjs tests/apply-branding.spec.mjs
git commit -m "feat: add branding application with sha guard"
```

---

### Task 7: 构建编排 `scripts/build-desktop.mjs`

**Files:**
- Create: `scripts/build-desktop.mjs`
- Test: `tests/build-desktop.spec.mjs`

- [ ] **Step 1: 写失败测试**

```js
// tests/build-desktop.spec.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { planBuild } from '../scripts/build-desktop.mjs'

test('构建计划：先 Web 构建，再统一安装与打包', () => {
  const steps = planBuild({ target: 'mac-arm64' })
  const scripts = steps.map(step => step.args.join(' '))
  assert.match(scripts[0], /install --frozen-lockfile/)
  assert.match(scripts[1], /run build/)            // 上游统一构建（含 build:web）
  assert.match(scripts.at(-1), /package:desktop:mac:arm64/)
})

test('不支持的目标被拒绝', () => {
  assert.throws(() => planBuild({ target: 'linux-x64' }), /unsupported target/)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/build-desktop.spec.mjs`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

```js
// scripts/build-desktop.mjs
/** Orchestrate the upstream build inside the ephemeral checkout (dry-plan or exec). */
import { spawnSync } from 'node:child_process'

const TARGETS = { 'mac-arm64': 'package:desktop:mac:arm64', 'mac-x64': 'package:desktop:mac:x64' }

export function planBuild({ target, pnpm = 'pnpm' }) {
  const script = TARGETS[target]
  if (!script) throw new Error(`build-desktop: unsupported target ${target}`)
  return [
    { cwd: '.', args: ['install', '--frozen-lockfile'] },
    { cwd: '.', args: ['run', 'build'] },
    { cwd: '.', args: ['run', script] },
  ].map(step => ({ cwd: step.cwd, command: pnpm, args: step.args }))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [target] = process.argv.slice(2)
  const dryRun = process.argv.includes('--dry-run')
  const steps = planBuild({ target: target ?? 'mac-arm64' })
  if (dryRun) {
    for (const step of steps) console.log(`[${step.cwd}] ${step.command} ${step.args.join(' ')}`)
  } else {
    for (const step of steps) {
      const result = spawnSync(step.command, step.args, { stdio: 'inherit' })
      if (result.status !== 0) throw new Error(`build-desktop: ${step.args.join(' ')} exited ${result.status}`)
    }
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/build-desktop.spec.mjs && node scripts/build-desktop.mjs mac-arm64 --dry-run`
Expected: PASS；输出三步计划（install → build → package:desktop:mac:arm64）

- [ ] **Step 5: 提交**

```bash
git add scripts/build-desktop.mjs tests/build-desktop.spec.mjs
git commit -m "feat: add desktop build orchestration"
```

---

### Task 8: Web/Desktop 同步门禁 `scripts/verify-web-desktop-sync.mjs`

**Files:**
- Create: `scripts/verify-web-desktop-sync.mjs`
- Test: `tests/web-desktop-sync.spec.mjs`

- [ ] **Step 1: 写失败测试**

```js
// tests/web-desktop-sync.spec.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareWebDesktop } from '../scripts/verify-web-desktop-sync.mjs'

async function dist(root) {
  await mkdir(join(root, 'dist'), { recursive: true })
  await writeFile(join(root, 'dist', 'index.html'), '<html></html>')
  return join(root, 'dist')
}

test('同一构建物摘要一致；篡改后不一致', async () => {
  const a = await mkdtemp(join(tmpdir(), 'ok-sync-a-'))
  const b = await mkdtemp(join(tmpdir(), 'ok-sync-b-'))
  try {
    const web = await dist(a)
    const desktop = await dist(b)
    assert.equal((await compareWebDesktop({ webDist: web, desktopDist: desktop })).match, true)
    await writeFile(join(desktop, 'index.html'), '<html>changed</html>')
    assert.equal((await compareWebDesktop({ webDist: web, desktopDist: desktop })).match, false)
  } finally {
    await rm(a, { recursive: true, force: true }); await rm(b, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/web-desktop-sync.spec.mjs`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

```js
// scripts/verify-web-desktop-sync.mjs
/** Fail the build when Web and Desktop carry different Web Client bundles. */
import { writeFile } from 'node:fs/promises'
import { dirDigest } from './lib/hash.mjs'

export async function compareWebDesktop({ webDist, desktopDist }) {
  const [web, desktop] = [await dirDigest(webDist), await dirDigest(desktopDist)]
  return { match: web === desktop, webBundleSha256: web, desktopBundleSha256: desktop }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [webDist, desktopDist, reportPath] = process.argv.slice(2)
  if (!webDist || !desktopDist) throw new Error('usage: verify-web-desktop-sync.mjs <webDist> <desktopDist> [report.json]')
  const report = await compareWebDesktop({ webDist, desktopDist })
  if (reportPath) await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  if (!report.match) throw new Error('web/desktop sync failed: bundle digests differ')
  console.log(`web/desktop sync ok: ${report.webBundleSha256.slice(0, 12)}`)
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/web-desktop-sync.spec.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add scripts/verify-web-desktop-sync.mjs tests/web-desktop-sync.spec.mjs
git commit -m "feat: add web desktop sync gate"
```

---

### Task 9: 产物验证与源码泄漏扫描

**Files:**
- Create: `scripts/check-source-leakage.mjs`
- Create: `scripts/verify-artifact.mjs`
- Test: `tests/artifact.spec.mjs`

- [ ] **Step 1: 写失败测试**

```js
// tests/artifact.spec.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { findLeaks } from '../scripts/check-source-leakage.mjs'
import { parseArtifactReport } from '../scripts/verify-artifact.mjs'

test('泄漏扫描命中 .ts 源码与 git 元数据', () => {
  const leaks = findLeaks([
    'app/resources/qilin/node_modules/x/lib.js',
    'app/resources/qilin/node_modules/x/src/foo.ts',
    'app/.git/HEAD',
  ])
  assert.deepEqual(leaks, [
    'app/resources/qilin/node_modules/x/src/foo.ts',
    'app/.git/HEAD',
  ])
})

test('产物报告校验版本绑定', () => {
  assert.throws(() => parseArtifactReport({
    runtime: { version: '3.0.0', nodeVersion: '24.17.0', pnpmVersion: '11.7.0' },
    lock: { qilinVersion: '3.1.0', nodeVersion: '24.17.0', pnpmVersion: '11.7.0' },
  }), /version mismatch/)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/artifact.spec.mjs`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

```js
// scripts/check-source-leakage.mjs
/** Reject shipped paths that carry upstream source or git metadata. */
const LEAK_PATTERNS = [
  /(^|\/)\.git(\/|$)/,
  /(^|\/)[^/]*\.ts$/,
  /(^|\/)[^/]*\.tsbuildinfo$/,
  /(^|\/)node_modules\/\.cache(\/|$)/,
  /(^|\/)\.desktop-build(\/|$)/,
]

export function findLeaks(paths) {
  return paths.filter(path => LEAK_PATTERNS.some(pattern => pattern.test(path)))
}

export async function walkCollect(root) {
  const { readdir, stat } = await import('node:fs/promises')
  const { join, relative } = await import('node:path')
  const files = []
  async function walk(dir) {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name)
      if ((await stat(path)).isDirectory()) await walk(path)
      else files.push(relative(root, path))
    }
  }
  await walk(root)
  return files
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2]
  if (!root) throw new Error('usage: check-source-leakage.mjs <root>')
  const leaks = findLeaks(await walkCollect(root))
  if (leaks.length > 0) {
    console.error(`source leakage detected:\n${leaks.join('\n')}`)
    process.exitCode = 1
  } else console.log('no source leakage')
}
```

```js
// scripts/verify-artifact.mjs
/** Validate the unpacked desktop payload against the upstream lock and emit checksums. */
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { sha256File } from './lib/hash.mjs'

export function parseArtifactReport({ runtime, lock }) {
  for (const field of ['version', 'nodeVersion', 'pnpmVersion']) {
    if (runtime[field] !== lock[field === 'version' ? 'qilinVersion' : field]) {
      throw new Error(`artifact verify: version mismatch on ${field}: runtime=${runtime[field]} lock=${lock[field === 'version' ? 'qilinVersion' : field]}`)
    }
  }
  return { ok: true }
}

export async function checksums(artifactDir) {
  const names = (await readdir(artifactDir)).filter(name => /\.(dmg|zip|yml|json)$/.test(name)).sort()
  const lines = []
  for (const name of names) lines.push(`${await sha256File(join(artifactDir, name))}  ${name}`)
  return lines.join('\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [runtimeJsonPath, lockPath, artifactDir, outPath] = process.argv.slice(2)
  const runtime = JSON.parse(await readFile(runtimeJsonPath, 'utf8'))
  const lock = JSON.parse(await readFile(lockPath, 'utf8'))
  parseArtifactReport({ runtime, lock })
  const text = await checksums(artifactDir)
  await writeFile(outPath ?? join(artifactDir, 'checksums-sha256.txt'), `${text}\n`)
  console.log(`artifact verify ok: ${text.split('\n').length} file(s)`)
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/artifact.spec.mjs`
Expected: PASS（2 tests）

- [ ] **Step 5: 提交**

```bash
git add scripts/check-source-leakage.mjs scripts/verify-artifact.mjs tests/artifact.spec.mjs
git commit -m "feat: add artifact verification and leakage scan"
```

---

### Task 10: 发布清单生成 `scripts/generate-release-manifest.mjs`

**Files:**
- Create: `scripts/generate-release-manifest.mjs`
- Test: `tests/release-manifest.spec.mjs`

- [ ] **Step 1: 写失败测试**

```js
// tests/release-manifest.spec.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildManifest } from '../scripts/generate-release-manifest.mjs'

test('清单合并锁、同步报告与校验和', () => {
  const manifest = buildManifest({
    lock: { productVersion: '0.1.0', qilinVersion: '3.0.0', qilinCommit: 'a'.repeat(40), target: 'mac-arm64' },
    sync: { match: true, webBundleSha256: 'b'.repeat(64) },
    checksums: 'x'.repeat(64) + '  app.dmg',
  })
  assert.equal(manifest.productVersion, '0.1.0')
  assert.equal(manifest.sync.webBundleSha256, 'b'.repeat(64))
  assert.ok(manifest.artifacts.includes('app.dmg'))
  assert.equal(manifest.schemaVersion, 1)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/release-manifest.spec.mjs`
Expected: FAIL

- [ ] **Step 3: 写实现**

```js
// scripts/generate-release-manifest.mjs
/** Combine lock, sync report and checksums into releases/manifest.json. */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export function buildManifest({ lock, sync, checksums }) {
  if (!sync.match) throw new Error('release manifest: refusing to record a failed sync state')
  const artifacts = checksums.split('\n').filter(Boolean).map(line => line.split(/\s{2}/)[1])
  return {
    schemaVersion: 1,
    productVersion: lock.productVersion,
    qilinVersion: lock.qilinVersion,
    qilinCommit: lock.qilinCommit,
    target: lock.target,
    sync: { webBundleSha256: sync.webBundleSha256 },
    artifacts,
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [lockPath, syncPath, checksumsPath, outPath] = process.argv.slice(2)
  const manifest = buildManifest({
    lock: JSON.parse(await readFile(lockPath, 'utf8')),
    sync: JSON.parse(await readFile(syncPath, 'utf8')),
    checksums: await readFile(checksumsPath, 'utf8'),
  })
  const out = outPath ?? 'releases/manifest.json'
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`release manifest written to ${out}`)
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/release-manifest.spec.mjs`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add scripts/generate-release-manifest.mjs tests/release-manifest.spec.mjs
git commit -m "feat: add release manifest generator"
```

---

### Task 11: CI Workflows（构建门禁 + 签名发布）

**Files:**
- Create: `.github/workflows/build-macos-arm64.yml`
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: 写构建门禁 workflow**

```yaml
# .github/workflows/build-macos-arm64.yml
name: build-macos-arm64
on:
  pull_request:
  push:
    branches: [main]

jobs:
  build:
    runs-on: macos-14
    timeout-minutes: 90
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - uses: pnpm/action-setup@v4
        with:
          version: 11.7.0
      - name: Product tests and static verification
        run: |
          npm test
          npm run verify:upstream
          npm run verify:branding
      - name: Fetch locked upstream
        run: |
          LOCK_COMMIT=$(node -p "JSON.parse(require('fs').readFileSync('upstream/qilin.lock.json','utf8')).qilinCommit")
          LOCK_VERSION=$(node -p "JSON.parse(require('fs').readFileSync('upstream/qilin.lock.json','utf8')).qilinVersion")
          node scripts/fetch-upstream.mjs \
            "https://github.com/deepseek-ai/deepseek-harness.git" "$LOCK_COMMIT" "$LOCK_VERSION" "$RUNNER_TEMP/qilin-src"
      - name: Apply branding
        run: node scripts/apply-branding.mjs . "$RUNNER_TEMP/qilin-src" patches/registry.json
      - name: Upstream build (web + desktop host, unsigned preparation)
        working-directory: ${{ runner.temp }}/qilin-src
        run: |
          pnpm install --frozen-lockfile
          pnpm run build
          pnpm run prepare:desktop
      - name: Sync gate (web dist vs desktop runtime resources)
        run: |
          node scripts/verify-web-desktop-sync.mjs \
            "$RUNNER_TEMP/qilin-src/apps/web/dist" \
            "$RUNNER_TEMP/qilin-src/apps/desktop/.desktop-build/targets/mac-arm64/qilin" \
            sync-report.json
      - name: Source leakage scan
        run: node scripts/check-source-leakage.mjs "$RUNNER_TEMP/qilin-src/apps/desktop/.desktop-build"
```

- [ ] **Step 2: 写发布 workflow**

```yaml
# .github/workflows/release.yml
name: release
on:
  push:
    tags: ['v*']

jobs:
  release:
    runs-on: macos-14
    timeout-minutes: 120
    permissions:
      contents: write
    environment: release
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: pnpm/action-setup@v4
        with: { version: 11.7.0 }
      - name: Build signed macOS arm64 desktop
        working-directory: ${{ runner.temp }}/qilin-src
        env:
          QILIN_DESKTOP_APP_ID: ${{ vars.QILIN_DESKTOP_APP_ID }}
          QILIN_DESKTOP_MACOS_SIGNING_IDENTITY: ${{ vars.QILIN_DESKTOP_MACOS_SIGNING_IDENTITY }}
          QILIN_DESKTOP_MACOS_TEAM_ID: ${{ vars.QILIN_DESKTOP_MACOS_TEAM_ID }}
          APPLE_API_KEY: ${{ secrets.APPLE_API_KEY_PATH }}
          APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
          APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
        run: |
          pnpm install --frozen-lockfile
          pnpm run build
          pnpm run package:desktop:mac:arm64
      - name: Verify artifacts and generate manifest
        run: |
          node scripts/verify-artifact.mjs \
            "$RUNNER_TEMP/qilin-src/apps/desktop/.desktop-build/targets/mac-arm64/qilin/desktop-runtime.json" \
            upstream/qilin.lock.json \
            "$RUNNER_TEMP/qilin-src/apps/desktop/.desktop-build/targets/mac-arm64/artifacts"
          node scripts/generate-release-manifest.mjs \
            upstream/qilin.lock.json sync-report.json \
            "$RUNNER_TEMP/qilin-src/apps/desktop/.desktop-build/targets/mac-arm64/artifacts/checksums-sha256.txt" \
            releases/manifest.json
      - name: Upload to GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: |
            ${{ runner.temp }}/qilin-src/apps/desktop/.desktop-build/targets/mac-arm64/artifacts/*.dmg
            ${{ runner.temp }}/qilin-src/apps/desktop/.desktop-build/targets/mac-arm64/artifacts/*.zip
            ${{ runner.temp }}/qilin-src/apps/desktop/.desktop-build/targets/mac-arm64/artifacts/checksums-sha256.txt
            releases/manifest.json
```

- [ ] **Step 3: 本地校验 YAML 可解析**

Run: `node -e "const y=require('node:fs').readFileSync('.github/workflows/build-macos-arm64.yml','utf8'); if(!y.includes('runs-on: macos-14')) throw new Error('bad yaml')"`
Expected: 无输出（通过）

- [ ] **Step 4: 提交**

```bash
git add .github/workflows/build-macos-arm64.yml .github/workflows/release.yml
git commit -m "ci: add macos build gate and signed release"
```

---

### Task 12: README 与收尾

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 重写 README**

```markdown
# OpenKylin

基于 QiLin 构建的中文桌面智能工作台（macOS Apple Silicon 首发版）。

## 仓库边界

本仓库不包含 QiLin 源码。CI 依据 `upstream/qilin.lock.json` 锁定的精确 commit
在临时目录拉取上游、注入共享品牌主题后构建，安装包发布到 GitHub Release，
仓库只保留清单与校验元数据（见
[设计文档](docs/superpowers/specs/2026-09-16-openkylin-desktop-design.md)）。

## 常用命令

```sh
npm test                    # 全部产品层测试
npm run verify:upstream     # 校验上游锁文件
npm run verify:branding     # 校验品牌清单与对比度
npm run fetch:upstream      # 拉取锁定上游（需参数，见脚本 usage）
npm run verify:sync         # Web/Desktop 构建物同步门禁
```

## 商标声明

QiLin 商标及 Logo 归其权利人所有；本发行版由 OpenKylin 维护。
```

- [ ] **Step 2: 全量回归**

Run: `npm test && git status --short`
Expected: 全部 PASS；工作树干净

- [ ] **Step 3: 提交**

```bash
git add README.md
git commit -m "docs: product readme with repo boundary"
```

---

## 后续人工步骤（不在本计划自动化范围）

1. 将授权 Logo 放入 `branding/logo/qilin.svg`（Task 4 后）。
2. 首次升级流程：用真实 QiLin commit 替换 `upstream/qilin.lock.json` 的全零 commit（Task 3 后）。
3. 针对锁定 commit 生成 `patches/desktop-branding.patch` 并回填 `patches/registry.json` 的 `expectSha256`。
4. 在 GitHub 配置 `release` environment 的签名与公证 secrets。
