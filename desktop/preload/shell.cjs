// desktop/preload/shell.cjs
/**
 * shell 窗口 preload 桥（最小白名单）。
 *
 * 只暴露标题栏需要的两个只读动作：解析当前工作区、在 Finder 中打开。
 * 沙箱窗口的 preload 必须是 CommonJS（Electron 的 sandbox preload 不走
 * ESM），且除 `electron` 外无任何 require 能力——这正好限定桥面。
 *
 * @module desktop/preload/shell
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('okShell', {
  /** 当前会话工作区：{ name, path } | null。hint 可带页面读到的 sessionId。 */
  workspace: (hint) => ipcRenderer.invoke('ok:workspace', hint),
  /** 在系统文件管理器中打开当前工作区目录。 */
  revealWorkspace: (hint) => ipcRenderer.invoke('ok:workspace:reveal', hint),
})
