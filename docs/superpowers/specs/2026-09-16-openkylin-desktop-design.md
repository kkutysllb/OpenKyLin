# OpenKylin 桌面端设计

- 日期：2026-09-16
- 状态：已修订，待复审
- 首发平台：macOS Apple Silicon（arm64）
- 产品形态：基于 QiLin 构建的中文桌面智能工作台
- 交付策略：上游源码临时构建，下游产品化，GitHub Release 发布构建物
- 一致性原则：Web 与 Desktop 使用同一版本、同一份 Web Client 构建物和同一套产品主题

## 1. 目标与约束

### 1.1 目标

OpenKylin 提供一个面向 macOS Apple Silicon 的桌面应用，复用 QiLin 已有 Electron Desktop Shell、Desktop Host、Web Client、插件管理、运行时隔离和自动更新能力，同时加入中文产品体验和具有中国文化辨识度的视觉系统。

首版重点是让用户像使用原生桌面应用一样运行 QiLin Web 工作区：启动时有本地加载页，运行时不开放 Web 监听端口，工作区、会话、插件和更新功能保持上游能力。

Web 与 Desktop 的工作区必须保持功能和样式一致。Web 是用户工作区的单一产品实现，Desktop 只提供原生窗口、启动、更新和受控系统能力，不维护第二套聊天、Session、工具、设置或主题实现。中国文化视觉主题必须注入共享 Web Client，并由桌面壳复用同一套 Token；不能只在 Desktop 单独覆盖。

### 1.2 硬约束

1. `OpenKylin` 仓库不提交 QiLin 源码。
2. `OpenKylin` 仓库不提交 QiLin 的 `node_modules`、构建缓存、运行时依赖树或未审计二进制文件。
3. CI 在临时目录拉取精确锁定的 QiLin commit，构建结束后销毁源码目录。
4. Git 仓库只保存产品化控制面、品牌资产、补丁、上游版本锁定信息、构建清单和发布元数据。
5. 安装包、ZIP 和 DMG 进入 GitHub Release，不长期提交到 Git 历史。
6. QiLin Logo 按已确认的授权范围使用，并保留商标归属说明。
7. 首版不重新实现 QiLin Host 协议或 Session 持久化格式。
8. Web 与 Desktop 的用户工作区必须由同一份 Web Client 构建物提供；禁止维护 Desktop 专属 Web UI 分支。
9. 每次上游升级必须同时构建和验证 Web、Desktop 两个交付面；任一同步检查失败都不得发布。

### 1.3 非目标

- 首版不支持 Linux 或 Windows 发布。
- 首版不重写 QiLin 主工作区的交互模型。
- 首版不维护 Desktop 专属的 Web Client、组件样式或功能分支。
- 首版不将 QiLin 源码复制到 OpenKylin 的 Git 子目录、Git submodule 或 vendored 目录。
- 首版不维护独立于上游的 Host 协议、核心插件体系或 Session 格式。
- 首版不加入开机启动、全局快捷键、文件关联、系统级常驻服务等深度系统集成能力。
- 首版不把中国文化元素做成高密度装饰或替代技术状态信息。

## 2. 总体方案

采用“上游源码临时构建 + 下游品牌 Patch + 构建物发布”的路线。

```text
OpenKylin 产品仓库
  │
  ├─ 读取 upstream/qilin.lock.json
  ├─ 拉取临时 QiLin 源码
  ├─ 校验 commit、版本和依赖
  ├─ 应用共享 Web 品牌主题与最小桌面壳层补丁
  ├─ 调用上游 Web/Desktop 构建命令
  ├─ 签名、公证、运行时和泄漏检查
  └─ 发布 DMG、ZIP、SHA-256、SBOM 和清单
```

QiLin 只存在于 CI 临时工作区：

```text
$GITHUB_WORKSPACE/OpenKylin/       # 产品仓库
$RUNNER_TEMP/qilin-src/            # 临时上游源码
$RUNNER_TEMP/qilin-build/          # 上游构建和准备目录
$RUNNER_TEMP/openkylin-artifacts/  # 最终产物
```

构建脚本必须显式传递源码目录和构建目录，不允许通过当前工作目录、缓存恢复或隐式相对路径把上游源码写回产品仓库。

## 3. 运行时架构

沿用本地 QiLin 的 Electron 桌面结构：

```text
OpenKylin Desktop
└── Electron Shell
    ├── 本地中文启动页和错误恢复页
    ├── 原生菜单、窗口和单实例控制
    ├── qilin-app:// 私有资源协议
    ├── preload 暴露的受控 API
    └── Desktop Host 子进程
        ├── 应用内置 Node.js
        ├── 应用内置 pnpm
        ├── 匹配版本的 QiLin Desktop Host
        ├── 匹配版本的 Web Client
        └── 匹配版本的生产依赖树
```

### 3.1 复用的上游能力

上游 QiLin `apps/desktop` 和 `apps/desktop-host` 已经提供以下能力，本项目优先复用，不复制实现：

- Electron 主进程生命周期和窗口管理；
- `qilin-app://` 私有协议；
- Desktop Host 的 Node 子进程管理；
- 带版本的分帧字节管道和背压；
- Desktop profile 和插件管理；
- 内置 Node.js 与 pnpm 的准备流程；
- `desktop-runtime.json` 运行时身份与文件完整性；
- macOS arm64 打包、签名、公证和更新元数据；
- `electron-updater` 更新流程；
- 启动失败后的重试、禁用插件和重置配置恢复操作；
- `apps/web` 生成的 `@qilin/web-frontend/dist` Web Client 构建物；Desktop Host 通过同一包的 `dist/index.html` 提供工作区资源。

### 3.2 版本绑定

一个 OpenKylin 发布版本绑定一份精确的 QiLin 构建组合。`upstream/qilin.lock.json` 至少包含：

```json
{
  "schemaVersion": 1,
  "productVersion": "0.1.0",
  "qilinRepository": "https://github.com/deepseek-ai/deepseek-harness.git",
  "qilinCommit": "0123456789abcdef0123456789abcdef01234567",
  "qilinVersion": "3.0.0",
  "nodeVersion": "24.17.0",
  "pnpmVersion": "11.7.0",
  "target": "mac-arm64"
}
```

实际发布时，`productVersion`、上游包版本、Desktop Host 版本、内置 Node 版本、pnpm 版本和目标架构必须通过构建检查彼此一致。禁止使用浮动分支、`latest` 标签或未锁定的依赖解析结果。

### 3.3 Web 与 Desktop 同源同步

Web 与 Desktop 的工作区使用同一份 `@qilin/web-frontend/dist` 构建物，不允许分别维护两套前端代码或分别打包两份可能不同的 UI。同步规则如下：

1. CI 在临时 QiLin 工作树中先构建一次 `@qilin/web-frontend`，生成 canonical Web Client 目录和内容摘要。
2. Web 交付面由 `qilin web` 提供该构建物；Desktop 运行时由 `@qilin/desktop-host` 的 `assetHandler` 读取同一构建物中的 `dist/index.html` 和静态资源。
3. Desktop 只在运行时向 HTML 注入桌面传输脚本和必要的协议适配，不修改 React 组件、CSS、路由、文案目录或功能注册表。
4. 中国文化主题、品牌色、共享 Logo 使用规则和中文产品文案必须进入共享 Web Client 或上游已有的 `@qilin/client-ui-theme` / `@qilin/client-ui-theme-brand` 注入点，不能只覆盖 `apps/desktop/renderer`。
5. 构建清单记录 `webClientVersion`、`webBundleSha256`、共享主题版本和功能目录摘要；Web 目录与 Desktop 运行时资源的摘要不一致时，构建失败。
6. 每个上游升级同时执行 Web 浏览器端和 Desktop 端的同一组功能场景测试，并执行关键页面的结构、主题 Token 和可见文案一致性检查。

允许存在的 Desktop 专属界面仅限于原生窗口生命周期相关内容：启动页、Host 错误恢复、原生菜单、系统更新确认和插件事务恢复页。这些界面不能替代 Web 工作区已有功能，也不能产生与 Web 工作区相冲突的主题或交互规则。

### 3.4 同步发布单元

Web 与 Desktop 不拥有独立版本线。一个发布单元由以下事实组成：

```json
{
  "qilinCommit": "0123456789abcdef0123456789abcdef01234567",
  "webClientVersion": "3.0.0",
  "webBundleSha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "sharedThemeVersion": "1",
  "featureCatalogSha256": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  "desktopTarget": "mac-arm64"
}
```

其中 `webBundleSha256` 必须由 Web 发布目录和 Desktop 运行时携带的同一目录分别计算并比对。`featureCatalogSha256` 用于检测功能注册表、路由和插件入口是否来自同一构建。Web 与 Desktop 任一事实不一致时，Release workflow 直接失败，不允许通过更改显示版本号掩盖漂移。

同步优先级如下：

1. 功能实现和主题实现只存在于上游共享 Web Client；
2. Web 交付和 Desktop 内嵌 Web 交付使用同一构建目录；
3. 平台差异只允许出现在传输适配、文件/目录选择、窗口、菜单、更新和启动恢复；
4. 任何需要同时改变 Web 和 Desktop 工作区的需求，先修改共享 Web Client，再由两个交付面共同验收。

## 4. OpenKylin 仓库布局

建议目录如下：

```text
OpenKylin/
├── README.md
├── upstream/
│   └── qilin.lock.json
├── branding/
│   ├── brand-manifest.json
│   ├── logo/
│   │   ├── qilin.svg
│   │   └── qilin-mono.svg
│   ├── icons/
│   │   ├── icon.icns
│   │   └── icon-source.svg
│   ├── splash/
│   │   ├── startup-background.svg
│   │   └── startup-mark.svg
│   ├── theme/
│   │   ├── tokens.css
│   │   └── motifs.svg
│   └── trademarks/
│       └── NOTICE.zh-CN.md
├── patches/
│   ├── shared-web-branding.patch
│   ├── desktop-branding.patch
│   └── desktop-locale.patch
├── scripts/
│   ├── fetch-upstream.mjs
│   ├── verify-upstream.mjs
│   ├── apply-branding.mjs
│   ├── verify-web-desktop-sync.mjs
│   ├── build-desktop.mjs
│   ├── verify-artifact.mjs
│   └── generate-release-manifest.mjs
├── tests/
│   ├── brand-manifest.spec.ts
│   ├── upstream-lock.spec.ts
│   ├── patch-compatibility.spec.ts
│   ├── web-desktop-sync.spec.ts
│   ├── artifact-verifier.spec.ts
│   └── source-leakage.spec.ts
├── .github/
│   └── workflows/
│       ├── build-macos-arm64.yml
│       └── release.yml
└── releases/
    ├── manifest.json
    └── checksums-sha256.txt
```

`releases/` 只保存文本清单和可审计元数据。DMG、ZIP 和其他大文件只作为 GitHub Release 附件。

## 5. 构建与升级流程

### 5.1 标准构建流程

```text
校验 qilin.lock.json
  ↓
临时 clone QiLin 并 checkout 精确 commit
  ↓
验证 Git commit、tag、package.json 版本和锁文件
  ↓
安装冻结依赖
  ↓
构建唯一的 @qilin/web-frontend/dist
  ↓
运行上游构建和 Desktop Host 构建
  ↓
将同一 Web 构建物接入 Web 与 Desktop
  ↓
分别计算 Web 目录、Desktop 运行时资源和功能目录摘要
  ↓
应用共享品牌资源、主题注入和最小壳层 Patch
  ↓
运行 Web/Desktop 同步测试
  ↓
执行 package:desktop:mac:arm64
  ↓
对应用和 DMG 执行签名、公证和钉票
  ↓
校验 runtime manifest、版本绑定和源码泄漏
  ↓
生成 SHA-256、SBOM、构建证明和 release-manifest
  ↓
上传 GitHub Release
```

所有品牌注入必须在签名之前完成。签名、公证和钉票之后只允许读取和验证，不允许再修改应用资源。

### 5.2 上游升级流程

1. 提交 PR，只修改 `upstream/qilin.lock.json` 和必要的品牌兼容记录。
2. CI 拉取新的精确 QiLin commit。
3. 校验上游版本、Node/pnpm 版本和依赖锁定状态。
4. 应用品牌资源和 Patch；目标文件的预期 SHA 不匹配时立即失败。
5. 运行 Web 浏览器端与 Desktop 端相同的功能场景、主题 Token、可见文案和资源摘要同步测试。
6. 运行产品层测试、上游 Desktop smoke test 和 macOS arm64 打包验证。
7. 对新安装包执行签名、公证、启动和更新测试。
8. 完成人工验收后合并锁文件 PR，并创建对应的 OpenKylin 发布版本。

Patch 不允许模糊匹配、自动跳过或在失败后生成半品牌化产物。每个 Patch 记录适用的上游 commit 或明确的上游版本范围；涉及壳层之外的改动需要单独设计评审。

### 5.3 构建缓存治理

缓存只允许保存可验证的依赖下载缓存和构建工具缓存，不允许保存 QiLin 源码目录、完整工作树或包含源码的压缩包。缓存 key 必须包含上游 commit、OpenKylin 产品版本、Node/pnpm 版本、目标平台和目标架构。

构建结束前运行源码泄漏扫描，检查 GitHub Artifact、Release 文件和应用资源中是否包含 QiLin Git 元数据、源码目录、TypeScript 源文件、构建缓存和不应发布的临时路径。

## 6. 品牌和中文体验

### 6.1 品牌关系

产品名称建议使用 `OpenKylin Desktop`，界面副标题使用“基于 QiLin 构建的中文桌面智能工作台”。QiLin Logo 作为获得授权的主品牌标识使用。关于页、发行说明和安装包元数据中明确标识商标归属及 OpenKylin 的维护关系。

建议固定显示：

```text
QiLin Desktop
基于 QiLin 构建的中文桌面智能工作台
QiLin 商标及 Logo 归其权利人所有
本发行版由 OpenKylin 维护
```

授权证明和 Logo 来源记录只保存在受控的品牌资料中，不写入运行时秘密或构建日志。

### 6.2 视觉原则

“中国文化”作为共享 Web Client 的设计语汇和细节层，不替代桌面效率工具的结构。Web 浏览器和 Desktop 的工作区必须读取相同的主题 Token、字体回退、组件样式和状态颜色；Electron 启动页、原生菜单和错误恢复页只做平台外壳适配。界面优先保证信息层级、对比度、键盘操作、错误可读性和减少动效支持。

建议使用：

- 墨黑、宣纸白、朱砂红、玉青色、低饱和鎏金；
- 如意云纹或流云线稿作为低对比度背景；
- 印章式状态标签；
- 玉璧形进度环或状态环；
- 窗棂比例的分栏和卡片细节；
- 轻量的纸张纹理，不使用影响文本识别的噪点。

禁止使用：

- 大面积书法字体作为操作文字；
- 高饱和传统图案覆盖工作区；
- 用文化隐喻替代“重试、更新、禁用插件、重置”等技术操作；
- 未记录来源或授权的字体、图像和传统纹样素材。

### 6.3 主题 Token

`branding/brand-manifest.json` 是品牌配置的单一来源：

```json
{
  "schemaVersion": 1,
  "productName": "OpenKylin Desktop",
  "displayName": "QiLin Desktop",
  "subtitle": "基于 QiLin 构建的中文桌面智能工作台",
  "defaultLocale": "zh-CN",
  "logo": {
    "source": "branding/logo/qilin.svg",
    "usage": "authorized"
  },
  "theme": {
    "light": {
      "paper": "#F7F3EA",
      "ink": "#17191C",
      "cinnabar": "#B7352C",
      "jade": "#5D8275",
      "gold": "#B89152"
    },
    "dark": {
      "paper": "#17191C",
      "ink": "#F7F3EA",
      "cinnabar": "#C94A40",
      "jade": "#83A99A",
      "gold": "#D0AA67"
    }
  },
  "trademarkNotice": "QiLin 商标及 Logo 归其权利人所有"
}
```

构建脚本校验 Logo 格式、尺寸、透明边界、主题对比度、中文 locale 完整性以及 About 页和 Release manifest 中的商标声明一致性。

### 6.4 页面设计

#### 启动页

启动页由 Electron 本地资源提供，不依赖 Desktop Host。默认中文内容为：

```text
QiLin Logo
云门正在开启
正在准备你的工作区……
QiLin Desktop · 基于 QiLin 构建
```

加载环使用朱砂作为主要进度色，背景只放低对比度流云线稿。启动失败时保留明确的诊断信息和以下恢复入口：

- 重试启动；
- 禁用全部第三方插件并重试；
- 重置 Desktop 并重试；
- 重新安装应用的指导；
- 复制诊断信息。

#### 主工作区

主工作区继续使用上游 QiLin Web Client。OpenKylin 的中国文化主题、默认中文 locale、品牌色和品牌相关空状态必须通过共享 Web Client 注入，Web 浏览器和 Desktop 使用完全相同的组件、CSS、路由、功能注册和可见文案。Desktop 只额外提供窗口标题和原生壳层能力，不重写聊天、Session、工具和文件操作的核心交互。

#### 插件管理页

工作区内的插件和设置能力必须复用 Web Client 中的同一套页面、组件、主题 Token、状态和事务反馈。Desktop 原生菜单可以提供进入插件事务恢复窗口的入口，但该窗口只负责桌面 profile 的生命周期恢复，不复制 Web 的插件设置和管理页面。启用使用玉青色，更新和主要操作使用朱砂色，完成状态可用低饱和鎏金点缀；npm 包名、版本号、错误信息和依赖诊断保持技术准确。

#### 更新提示

更新弹窗显示当前版本、目标版本、匹配的 QiLin 版本和“安装后重新启动”说明。关于页显示 OpenKylin 维护关系、上游 commit、构建时间、目标架构和签名状态。

## 7. 数据流和边界

```text
用户启动应用
  ↓
Electron 获取单实例锁
  ↓
读取 resources/qilin/desktop-runtime.json
  ↓
初始化或复用 Desktop profile
  ↓
显示中文品牌启动页
  ↓
启动内置 Node + Desktop Host
  ↓
qilin-app:// 加载匹配版本 Web Client
  ↓
Renderer 调用受控 preload API
  ↓
主进程校验 sender 和请求范围
  ↓
分帧字节管道传输到 Desktop Host
  ↓
QiLin Agent / Plugin / Session 运行
  ↓
流式响应返回 Renderer
```

必须维持以下边界：

- Renderer 不获得 Node Integration、原始 Electron IPC、shell 或任意文件系统能力；
- IPC 只接受来自自有 `qilin-app://` 页面且符合结构化 schema 的调用；
- 不开放 loopback Web server 和外部可访问端口；
- Host 使用应用内置 Node，插件事务使用应用内置 pnpm；
- Desktop profile 与 CLI 可执行包、插件激活、锁文件和 `node_modules` 隔离；
- 上游运行时、Web Client、Host 和 Electron Shell 必须为同一版本组合；
- 产品层不绕过上游插件安装、原生构建许可和运行时完整性检查。

## 8. 错误恢复

| 故障 | 处理方式 |
|---|---|
| 运行时文件清单缺失或哈希不匹配 | 阻止 Host 启动，显示安装损坏和重新安装指导 |
| Desktop Host 启动失败 | 提供重试、禁用第三方插件、重置 Desktop |
| 插件 peer 依赖不兼容 | 保留插件文件，展示冲突插件和版本，允许禁用或更新 |
| QiLin 与 Desktop Host 版本不匹配 | 阻止启动，不降级、不静默替换 |
| 更新签名或下载校验失败 | 保留当前版本，显示更新失败，不替换现有安装 |
| 单实例锁冲突 | 聚焦现有窗口，不创建第二个 Host |
| 重置 Desktop | 二次确认，明确会删除 Desktop profile 和第三方插件但保留共享任务、设置和凭据 |

错误页面必须优先保证恢复能力，文化元素不能遮挡错误详情、按钮和复制诊断入口。

## 9. 测试与验收

### 9.1 产品层测试

- `qilin.lock.json` 和 `brand-manifest.json` schema 校验；
- 上游 commit、tag、QiLin 版本和锁文件一致性；
- Patch 目标文件 SHA 和适用版本检查；
- 中文 locale 完整性和默认 locale 检查；
- 主题色对比度、Logo 尺寸和透明边界检查；
- Release manifest、SHA-256 和 SBOM 生成；
- 源码、Git 元数据、构建缓存和临时路径泄漏扫描。

### 9.2 Web/Desktop 一致性测试

- Web 浏览器端和 Desktop 端加载的 `@qilin/web-frontend/dist` 文件清单与 `webBundleSha256` 完全一致；
- 同一组用户场景在 Web 和 Desktop 上通过：新建会话、发送消息、流式响应、Session 切换、文件选择、设置、插件/工具入口、错误提示和恢复后的重试；
- 关键页面的组件结构、路由、可见文案和主题 Token 名称一致；平台差异只允许出现在传输适配和原生窗口能力；
- 共享 Web 主题 Token 的任一变更同时反映在 Web 和 Desktop，禁止只修改 `apps/desktop/renderer` 使 Desktop 单独变色；
- Desktop 不包含 Web Client 的第二份组件、CSS、路由或功能注册实现；
- Web 与 Desktop 的构建清单记录同一 QiLin commit、Web Client 版本、主题版本和功能目录摘要。

### 9.3 桌面壳测试

- 启动页和错误页在无 Host 时可渲染；
- 中文启动、菜单、更新、插件和恢复文案完整；
- Logo 保持授权文件的比例、裁切和颜色规则；
- 单实例、窗口聚焦和 Host 关闭行为正确；
- 插件管理操作执行前停止 Host，完成后重新启动 Host；
- 更新确认、取消和失败路径不破坏当前安装；
- 外部导航、任意窗口打开和不受控 IPC 被拒绝；
- `qilin-app://` 路径越界和非允许方法被拒绝。

### 9.4 macOS arm64 构建 Smoke Test

- `pnpm run package:desktop:mac:arm64` 在受控 macOS arm64 runner 上完成；
- 打包应用的 `desktop-runtime.json` 校验通过；
- 内置 Node、pnpm、QiLin 和 Desktop Host 版本相互匹配；
- 应用启动后不创建 Web 监听端口；
- 新 profile 可初始化，插件 profile 可正常读取；
- 启动失败可触发恢复操作；
- 应用退出时 Desktop Host 正常停止；
- DMG 通过签名和公证验证；
- ZIP 可被更新元数据识别；
- 应用安装后中文 UI、Session、设置、插件和文件操作无回归。

### 9.5 发布验收标准

发布前必须全部满足：

1. OpenKylin Git 历史不含 QiLin 源码、`node_modules`、构建缓存或未审计二进制。
2. 给定版本锁可以在干净 macOS arm64 runner 上重建对应版本。
3. 上游 commit、QiLin 版本、Desktop 版本、Node 版本、pnpm 版本和目标架构可追溯。
4. 中文启动页、菜单、更新提示、错误恢复页和关于页可用。
5. QiLin Logo 按授权规范显示，未拉伸、裁切或错误变色。
6. Web 浏览器端与 Desktop 工作区使用同一份 Web Client 构建物，聊天、Session、插件、设置、工具、文件操作和错误反馈在两端不回归。
7. 应用不开放监听端口，Renderer 不能访问 Node、shell 或任意文件系统。
8. 签名 DMG 能通过 macOS 安全校验，ZIP 可用于自动更新。
9. GitHub Release 包含 DMG、ZIP、SHA-256、SBOM 和 `release-manifest.json`。
10. 上游升级时，Patch 不匹配或 Web/Desktop 同步摘要不一致会使 CI 失败，不生成未品牌化、半品牌化或双端漂移的产物。

## 10. 风险和控制

| 风险 | 控制措施 |
|---|---|
| 上游重构导致 Patch 失效 | Patch 锁定 commit，应用前后校验 SHA，失败即停 |
| Desktop Shell、Host 和 QiLin 版本分裂 | 单一版本锁、运行时清单和启动前版本校验 |
| 签名后修改资源破坏公证 | 所有品牌注入在签名前完成，签名后只验证 |
| 构建缓存泄漏上游源码 | 缓存白名单、缓存 key 隔离、产物扫描和上传前检查 |
| Logo 授权范围发生变化 | 品牌 manifest、归属声明和授权资料纳入发布审计 |
| 新上游依赖引入供应链风险 | 依赖锁、SBOM、许可证扫描和构建证明 |
| 文化元素降低可读性 | 对比度、键盘操作、字体回退和减少动效测试 |
| 插件事务导致 Host 无法恢复 | 复用上游 profile 锁、显式错误页和禁用插件恢复路径 |
| Web 与 Desktop 的功能或样式漂移 | 单一 Web 构建物、双端资源摘要、同一组场景测试和发布阻断门禁 |

## 11. 关键决策记录

- 选择“临时拉取上游源码”而不是 Git submodule，因为仓库需要只跟踪上游版本和产品化层，不暴露 QiLin 源码为本仓库内容。
- 选择上游 Desktop Shell 作为运行时基础，而不是重新实现协议，因为本地 QiLin 已有经过测试的 Host、私有协议、profile 隔离和发布脚本。
- 选择配置注入和文件覆盖优先、最小 Patch 兜底，以降低上游升级冲突。
- 选择 GitHub Release 保存安装包，Git 仓库保存清单，以避免二进制膨胀并保留可审计的发布历史。
- 选择“现代桌面工具 + 中国文化细节”，而不是完整古风皮肤，以保证效率、可读性和桌面使用连续性。
- 选择 Web Client 作为工作区唯一实现，Desktop 只复用其构建物并提供原生壳层；以资源摘要、功能目录摘要和双端同场景测试阻止后续同步漂移。
