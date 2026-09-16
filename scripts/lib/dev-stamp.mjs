// scripts/lib/dev-stamp.mjs
/**
 * Dev checkout 复用 stamp：branding 输入指纹与锁 commit 的组合。
 *
 * `fetchUpstream` 是破坏性重建（rm + clone），会连带毁掉已安装的
 * node_modules 与构建产物。dev 脚本在重建前先用本模块判断现有
 * checkout 是否仍然匹配锁与品牌输入——匹配则原样复用。
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** dev stamp 文件名（落在品牌化 checkout 根）。 */
export const DEV_STAMP_FILE = '.openkylin-dev-stamp.json'

/**
 * 全部品牌输入（registry + patches + overwrite 源文件）的指纹。
 * 任一输入变化都会使指纹变化，从而触发 checkout 重建。
 *
 * @param {string} productRoot - 产品仓库根。
 * @returns {string} sha256 十六进制摘要。
 */
export function brandingFingerprint(productRoot) {
  const registry = JSON.parse(readFileSync(join(productRoot, 'patches/registry.json'), 'utf8'))
  const hash = createHash('sha256')
  hash.update(readFileSync(join(productRoot, 'patches/registry.json')))
  for (const entry of registry.patches ?? []) {
    hash.update(`patch:${entry.patch}\n`)
    hash.update(readFileSync(join(productRoot, entry.patch)))
  }
  for (const entry of registry.overwrites ?? []) {
    hash.update(`overwrite:${entry.target}\n`)
    hash.update(readFileSync(join(productRoot, entry.source)))
  }
  return hash.digest('hex')
}

/**
 * 判断现有 checkout 是否仍匹配锁 commit 与当前品牌输入。
 *
 * @param {{ qilinCommit: string }} lock - 上游锁。
 * @param {string} productRoot - 产品仓库根。
 * @param {string} out - 品牌化 checkout 根。
 * @returns {boolean} 可安全复用时 true；stamp 缺失/不匹配/损坏时 false。
 */
export function checkoutReusable(lock, productRoot, out) {
  try {
    const stamp = JSON.parse(readFileSync(join(out, DEV_STAMP_FILE), 'utf8'))
    return stamp.commit === lock.qilinCommit && stamp.brandingFingerprint === brandingFingerprint(productRoot)
  } catch {
    return false
  }
}
