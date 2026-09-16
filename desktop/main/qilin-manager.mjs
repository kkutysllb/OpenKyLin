// desktop/main/qilin-manager.mjs
/**
 * QiLin web 侧车进程管理器（KCoder host & sidecar 机制）。
 *
 * 职责：spawn `qilin web --port <稳定端口> --no-open` → 从 stdout 解析就绪行
 * （含 launch token 的完整 URL）→ 广播状态；崩溃自动重启（指数退避，
 * 上限见 {@link MAX_AUTO_RESTARTS}）；应用退出时优雅关闭
 * （SIGTERM → 宽限 → SIGKILL），绝不留孤儿进程。
 *
 * 端口优先复用 QILIN_HOME 的记忆端口（登录 cookie 绑定 host:port，端口
 * 稳定 = 凭证跨启动存活），占用则向 OS 要新口并重记；`--no-open`
 * 抑制默认浏览器——桌面壳的 shell 窗口就是它的浏览器。
 *
 * @module desktop/main/qilin-manager
 */

import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import net from 'node:net'
import {
  LOG_RING_SIZE,
  MAX_AUTO_RESTARTS,
  READY_TIMEOUT_MS,
  TERM_GRACE_MS,
  parseReadyLine,
  qilinHome,
  readPersistedPort,
  resolveSidecar,
  persistPort,
} from './qilin-contract.mjs'

/**
 * 探测 127.0.0.1 上某端口是否已被占用。
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isPortBusy(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    const done = (busy) => {
      socket.destroy()
      resolve(busy)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

/**
 * 向 OS 要一个空闲回环端口（listen(0) 后立刻释放；存在 TOCTOU 窗口，
 * 由侧车绑定失败的退出-重启路径兜底）。
 * @returns {Promise<number>}
 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

/**
 * @typedef {'stopped' | 'starting' | 'ready' | 'restarting' | 'failed'} QilinState
 *
 * @typedef {{ stream: 'stdout' | 'stderr', line: string, at: number }} QilinLogLine
 *
 * @typedef {{ state: QilinState, url: string | null, source: string | null, error: string | null, restartsLeft: number }} QilinStatus
 */

/** 事件负载：状态快照与日志行。 */
export class QilinManager extends EventEmitter {
  /** @type {import('node:child_process').ChildProcess | null} */
  #child = null
  /** @type {QilinState} */
  #state = 'stopped'
  /** @type {string | null} */
  #url = null
  /** @type {string | null} */
  #error = null
  /** @type {string | null} */
  #source = null
  #restartsLeft = MAX_AUTO_RESTARTS
  /** @type {QilinLogLine[]} */
  #logs = []
  #readyTimer = null
  #backoffTimer = null
  #stopping = false
  #exitedAfterStop = true
  /** @type {{ runRoot?: string } | null} */
  #options = null

  /** 当前快照。@returns {QilinStatus} */
  get status() {
    return {
      state: this.#state,
      url: this.#url,
      source: this.#source,
      error: this.#error,
      restartsLeft: this.#restartsLeft,
    }
  }

  /** 日志尾部（最多 {@link LOG_RING_SIZE} 行）。@returns {QilinLogLine[]} */
  get logTail() {
    return [...this.#logs]
  }

  /**
   * 启动（或在新运行树可用后再次尝试启动）qilin 侧车。
   * 已在运行时是幂等的 no-op。端口选择是异步的（探记忆端口占用），
   * spawn 在 #launch 中进行；starting 状态同步置位，并发调用安全。
   *
   * @param {{ runRoot?: string }} [options] - 品牌化运行树（dev 态为 .tmp/dev/qilin-src）。
   * @returns {QilinStatus}
   */
  start(options = {}) {
    if (this.#child !== null || this.#state === 'starting' || this.#state === 'restarting') {
      return this.status
    }
    this.#options = options
    this.#stopping = false
    // 先置 starting 再异步选口：双击/重试并发下第二次调用被状态闸拦下
    this.#setValues({ state: 'starting', error: null })
    void this.#launch(options)
    return this.status
  }

  /**
   * 选侧车端口：优先复用记忆端口（空闲时）；否则向 OS 要新口并重记。
   * 登录会话 cookie 绑定 host:port，端口稳定 = 凭证跨启动存活。
   * @returns {Promise<number>}
   */
  async #pickPort() {
    const home = qilinHome()
    const persisted = readPersistedPort(home)
    if (persisted !== null && !(await isPortBusy(persisted))) return persisted
    const port = await findFreePort()
    persistPort(port, home)
    return port
  }

  /** 解析命令 → 选口 → spawn（start 的异步主体）。 */
  async #launch(options) {
    const port = await this.#pickPort()
    // 选口期间用户已停止（启动页关闭等）：放弃 spawn
    if (this.#stopping || this.#state === 'stopped') return
    const command = resolveSidecar({ runRoot: options.runRoot, port })
    if (command === null) {
      this.#fail(
        `未找到可用的 qilin 运行树：${options.runRoot ?? '(未指定)'} 下没有 apps/cli/lib/bin.js。`
        + ' 请先运行 npm run dev 准备品牌化运行树，或设置 QILIN_BIN。',
      )
      return
    }
    this.#source = command.source

    const args = [...command.baseArgs]
    this.#appendLog('stdout', `$ ${command.describe}`)
    const child = spawn(command.command, args, {
      cwd: command.cwd,
      env: { ...process.env, ...command.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.#child = child
    this.#exitedAfterStop = false
    this.#startWatchdog(child)

    child.stdout?.on('data', (chunk) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line === '') continue
        this.#appendLog('stdout', line)
        const url = parseReadyLine(line)
        if (url !== null) this.#onReady(url)
      }
    })
    child.stderr?.on('data', (chunk) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line !== '') this.#appendLog('stderr', line)
      }
    })
    child.on('error', (error) => {
      this.#child = null
      this.#fail(`无法启动 qilin 进程：${String(error)}`)
    })
    child.on('exit', (code, signal) => {
      this.#child = null
      this.#clearReadyTimer()
      if (this.#exitedAfterStop) return
      if (this.#stopping) {
        this.#setValues({ state: 'stopped' })
        return
      }
      // 意外退出：自动重启直到额度耗尽
      this.#appendLog('stderr', `qilin 进程退出（code=${String(code)} signal=${String(signal)}）`)
      if (this.#restartsLeft > 0) {
        this.#scheduleRestart()
      } else {
        this.#fail(`qilin 连续崩溃，已停止自动重启（最后退出 code=${String(code)}）`)
      }
    })

    this.#readyTimer = setTimeout(() => {
      if (this.#state === 'starting' || this.#state === 'restarting') {
        this.#fail(
          `等待就绪超时（${String(READY_TIMEOUT_MS / 1000)}s）。详见下方日志；`
          + '上游首次冷启动较慢（profile 初始化与依赖结算），可重试。',
        )
        void this.stop()
      }
    }, READY_TIMEOUT_MS)
  }

  /** 重启：优雅停止后重新启动。@returns {QilinStatus} */
  restart() {
    void this.stop().then(() => {
      this.#restartsLeft = MAX_AUTO_RESTARTS
      this.start(this.#options ?? {})
    })
    return { ...this.status, state: 'restarting' }
  }

  /** 优雅停止；resolve 于进程真正退出（或本就不在运行）。 */
  async stop() {
    this.#stopping = true
    this.#clearTimers()
    const child = this.#child
    if (child === null || child.exitCode !== null || child.signalCode !== null) {
      this.#child = null
      this.#setValues({ state: 'stopped' })
      return
    }
    await new Promise((resolve) => {
      const done = () => {
        child.removeAllListeners('exit')
        clearTimeout(killTimer)
        resolve(undefined)
      }
      const killTimer = setTimeout(() => {
        this.#appendLog('stderr', '优雅退出超时，发送 SIGKILL')
        child.kill('SIGKILL')
      }, TERM_GRACE_MS)
      child.once('exit', done)
      child.kill('SIGTERM')
    })
    this.#child = null
    this.#exitedAfterStop = true
    this.#setValues({ state: 'stopped' })
  }

  /* ---------- 内部 ---------- */

  /**
   * 孤儿兜底 watchdog（detached，父进程死后仍存活）。
   *
   * Electron 主进程被 SIGKILL/SIGTERM 直杀时（Chromium 拦截信号，不走
   * Node 层 handler，也不会触发 before-quit），优雅退出序列没有机会
   * 运行。watchdog 每秒探测主进程存活性，发现主进程死亡后对侧车执行
   * 与优雅退出相同的 SIGTERM → 宽限 → SIGKILL 序列，然后自杀。正常
   * 退出路径下 watchdog 探测到主进程死亡时侧车早已退出，两次 no-op。
   *
   * @param {import('node:child_process').ChildProcess} child - 侧车进程。
   */
  #startWatchdog(child) {
    if (child.pid === undefined) return
    // 单引号内的进程文本独立于闭包，避免序列化主进程的其他状态。
    const script = [
      'const mainPid = Number(process.argv[1])',
      'const sidecarPid = Number(process.argv[2])',
      'const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }',
      'const tick = setInterval(() => {',
      '  if (alive(mainPid)) return',
      '  clearInterval(tick)',
      '  try { process.kill(sidecarPid, "SIGTERM") } catch {}',
      '  setTimeout(() => { try { process.kill(sidecarPid, "SIGKILL") } catch {} ; process.exit(0) }, 5000)',
      '}, 1000)',
    ].join('\n')
    const watchdog = spawn(process.execPath, ['-e', script, String(process.pid), String(child.pid)], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'ignore',
      detached: true,
    })
    watchdog.unref()
    // 侧车先退（正常/崩溃路径）：watchdog 无事可做，让它自己探测到后退出；
    // 这里只负责不把它算作需要管理的子进程。
  }

  #onReady(url) {
    if (this.#state === 'ready') return
    this.#clearReadyTimer()
    this.#restartsLeft = MAX_AUTO_RESTARTS
    this.#setValues({ state: 'ready', url, error: null })
  }

  #scheduleRestart() {
    const attempt = MAX_AUTO_RESTARTS - this.#restartsLeft + 1
    this.#restartsLeft -= 1
    const delay = Math.min(1_000 * 2 ** (attempt - 1), 8_000)
    this.#setValues({ state: 'restarting' })
    this.#appendLog('stderr', `将在 ${String(delay)}ms 后自动重启（剩余 ${String(this.#restartsLeft)} 次）`)
    this.#backoffTimer = setTimeout(() => {
      this.#backoffTimer = null
      this.start(this.#options ?? {})
    }, delay)
  }

  #fail(message) {
    this.#clearTimers()
    this.#setValues({ state: 'failed', error: message })
  }

  #setValues(patch) {
    if (patch.state !== undefined) this.#state = patch.state
    if (patch.url !== undefined) this.#url = patch.url
    if (patch.error !== undefined) this.#error = patch.error
    if (patch.source !== undefined) this.#source = patch.source
    this.emit('state-changed', this.status)
  }

  /**
   * @param {'stdout' | 'stderr'} stream
   * @param {string} line
   */
  #appendLog(stream, line) {
    /** @type {QilinLogLine} */
    const entry = { stream, line, at: Date.now() }
    this.#logs.push(entry)
    if (this.#logs.length > LOG_RING_SIZE) this.#logs.splice(0, this.#logs.length - LOG_RING_SIZE)
    this.emit('log', entry)
  }

  #clearReadyTimer() {
    if (this.#readyTimer !== null) {
      clearTimeout(this.#readyTimer)
      this.#readyTimer = null
    }
  }

  #clearTimers() {
    this.#clearReadyTimer()
    if (this.#backoffTimer !== null) {
      clearTimeout(this.#backoffTimer)
      this.#backoffTimer = null
    }
  }
}

/** 进程级单例（主进程内共享）。 */
export const qilinManager = new QilinManager()
