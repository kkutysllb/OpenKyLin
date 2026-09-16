# OpenKylin

基于 QiLin 构建的中文桌面智能工作台（macOS Apple Silicon 首发）。
QiLin 商标及 Logo 归其权利人所有；本发行版由 OpenKylin 维护。

## 仓库边界

本仓库**不包含 QiLin 源码**。CI 按 `upstream/qilin.lock.json` 锁定的精确 commit
在临时目录拉取上游、注入共享 Web 品牌主题后构建；安装包发布到 GitHub Release，
仓库只保留清单与校验元数据。完整约束见
[设计文档](docs/superpowers/specs/2026-09-16-openkylin-desktop-design.md)。

## 常用命令

```sh
npm test                          # 全部产品层测试（Node 原生 runner）
npm run dev                       # 启动品牌化桌面开发环境（见下节）
npm run verify:upstream           # 校验上游锁
npm run verify:branding           # 校验品牌清单与对比度
npm run fetch:upstream -- <repo> <commit> <version> <out>
npm run apply:branding -- <productRoot> <upstreamRoot> <registry.json>
npm run verify:sync -- <webDist> <desktopDist> [report.json]
npm run verify:artifact -- <desktop-runtime.json> <lock> <artifactDir> [checksumsOut]
npm run release:manifest -- <lock> <sync> <checksums> [manifestOut]
```

## 桌面开发环境（KCoder host & sidecar 机制）

`npm run dev` 参考 KCoder（DSH Desktop）的实现机制，把桌面端做成 qilin web
侧车的**宿主**，而不是另一套工作区实现：

```
OpenKylin Desktop（Electron 壳，desktop/ 目录，零 npm 依赖）
  ├─ 中文品牌启动页（splash，本地资源，不依赖侧车；失败态有重试/复制诊断）
  ├─ spawn  node apps/cli/lib/bin.js --port 0 --no-open   （品牌化侧车，产品面）
  ├─ stdout 就绪行 qilin: http://127.0.0.1:<port>/workspace?token=…
  └─ shell 窗口 loadURL 上述地址 —— 与浏览器访问 web 端是同一个 server、
     同一份 Web Client 构建物、同一套主题与数据（$QILIN_HOME）
```

侧车启动的是上游**产品面**（裸 `qilin`，shipped profile `qilin` = base +
web-app + web-brand），而非 unbranded 的 `qilin web` 面：web-brand 层把
麒麟印章品牌位与宣纸/墨色主题层（`ui-brand` + `ui-theme-brand`）插入浏览
器模块清单——这是上游原生的产品视觉，`shared-web-branding.patch` 再把印
章渐变与印章色 token 统一到 OpenKylin 朱砂（`#B7352C`/`#C94A40`）。桌面
工作区与上游 QiLin 的 web 端因此**按构造完全一致**：shell 窗口是侧车的纯
浏览器载体（sandbox、无 preload、无任何注入），QiLin 升级自动跟随。安全
边界：导航只允许停留在当前侧车 origin，外链转系统浏览器，权限请求一律
拒绝；进程纪律：侧车崩溃指数退避重启（上限 3 次），退出走 SIGTERM → 5s
宽限 → SIGKILL，另有 detached watchdog 兜底——即使主进程被 `kill -9`
也不留孤儿侧车。

dev 脚本按 stamp 复用 `.tmp/dev/qilin-src`（锁 commit + 品牌输入指纹匹
配时不重建，保住 node_modules 与构建产物）；侧车构建物（CLI bin 与 Web
dist）缺失时自动经上游工具链补建（`CI=true pnpm install → build:qilin`，
后者是绑定客户端公共环境的上游产品构建：版本徽章、commit 与构建 profile
随产物烘焙）；Electron 二进制取自品牌化 checkout（与上游同版本，下载缺
失时自动执行 electron install.js 补装）。上游
契约（就绪行、flags、bin 路径、home）集中在
`desktop/main/qilin-contract.mjs`，升级上游只改这一个文件。

受限执行环境（CI 容器、嵌套沙箱）可用的逃生口，普通终端无需设置：
`OPENKYLIN_USER_DATA`（重定向 Electron userData）、`QILIN_HOME`（重定向
harness home）、`ELECTRON_DISABLE_SANDBOX`（绕过外层沙箱对 Chromium OS
sandbox 的干扰）、`OPENKYLIN_ELECTRON_NO_GPU=1`（无头/CPU-only runner 追加
`--disable-gpu`）、`OPENKYLIN_ELECTRON_ARGS`（追加任意 Electron 开关，空白
分隔）、`OPENKYLIN_QILIN_RUN`（显式指定品牌化运行树）。

## 首次发布前置（人工）

1. 将授权 Logo 放入 `branding/logo/qilin.svg`。
2. 用真实上游 40 位 commit 替换锁文件全零占位。
3. 针对锁定 commit 依次生成三个品牌补丁，并确认与 `patches/registry.json` 登记一致：
   - `patches/shared-web-branding.patch`（共享 Web Client 的中国文化主题/品牌文案，scope `packages/client`）；
   - `patches/desktop-locale.patch`（桌面壳中文文案，scope `apps/desktop`）；
   - `patches/desktop-branding.patch`（桌面壳品牌化：窗口标题/关于页/启动页视觉，scope `apps/desktop`）。
   任一补丁缺失时 CI 在 Apply branding 步骤失败（设计上的 loud fail，不生成半品牌化产物）。
4. 配置 `release` environment：
   - vars：`QILIN_DESKTOP_APP_ID`、`QILIN_DESKTOP_MACOS_SIGNING_IDENTITY`、`QILIN_DESKTOP_MACOS_TEAM_ID`、`OPENKYLIN_UPDATE_ORIGIN`（`https://github.com/<owner>/<repo>/releases/latest/download`）；
   - secrets：`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`、`APPLE_API_KEY_PEM`（App Store Connect API 私钥，打包步写入临时 .p8）。

## 更新通道说明

自动更新走 electron-updater generic provider，指向本仓库 GitHub Release 的
`releases/latest/download` 动态路径。上游 `production` 更新环境指向其官方域名，
本项目**不得使用**；发布统一走 `QILIN_DESKTOP_AUTO_UPDATE_ENV=test` +
`DOWNLOAD_TEST_ORIGIN` 机制（仅指打包期写入的更新 URL 选择，不代表质量环境）。

## 设计规范

- 中国文化主题为共享 Web Client 注入（`branding/brand-manifest.json` + `branding/theme/tokens.css`），Web 与 Desktop 同源；Desktop 壳层（启动页/错误恢复/菜单）只做平台适配。
- accent token（朱砂/玉青/鎏金）仅作点缀、大文本或状态图形用途；正文文本一律使用 ink/paper 对（对比度 ≥ 4.5，CI 强制）。

## 跟进项

- **双端同场景 e2e**：设计 §9.2 要求 Web 浏览器端与 Desktop 端跑同一组功能场景（新建会话、发送消息、流式响应、Session 切换、设置、错误提示与恢复重试）及文案/主题 Token 一致性检查；当前由构建物摘要门禁（webBundleSha256 全等）保证同源，场景级 e2e 需在首次真实构建可产出后补齐（拟复用上游 `apps/web/tests` fixture 形态）。
- `verify-upstream` 默认路径改为模块相对定位；CLI 入口守卫改用 `pathToFileURL` 精确比较（累积审查 Nice-to-have）。
