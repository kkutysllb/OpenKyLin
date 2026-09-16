// desktop/preload/splash.mjs
/**
 * 启动页 preload：contextBridge 白名单。
 *
 * 启动页是桌面壳自有的本地页面（不是上游 Web UI），只暴露状态订阅、
 * 重试与复制诊断三个入口；渲染端零 Node 能力。
 *
 * @module desktop/preload/splash
 */

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('openkylin', {
  /**
   * 订阅侧车状态推送。
   * @param {(status: import('../main/qilin-manager.mjs').QilinStatus) => void} callback
   */
  onState(callback) {
    ipcRenderer.on('splash:state', (_event, status) => { callback(status) })
  },
  /** 请求重启侧车（失败恢复入口）。 */
  retry() {
    void ipcRenderer.invoke('splash:retry')
  },
  /** 复制诊断信息（状态快照 + 日志尾部）到剪贴板；返回文本。 */
  copyDiagnostics() {
    return ipcRenderer.invoke('splash:copy')
  },
})
