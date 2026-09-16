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
npm run verify:upstream           # 校验上游锁
npm run verify:branding           # 校验品牌清单与对比度
npm run fetch:upstream -- <repo> <commit> <version> <out>
npm run apply:branding -- <productRoot> <upstreamRoot> <registry.json>
npm run verify:sync -- <webDist> <desktopDist> [report.json]
npm run verify:artifact -- <desktop-runtime.json> <lock> <artifactDir> [checksumsOut]
npm run release:manifest -- <lock> <sync> <checksums> [manifestOut]
```

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
