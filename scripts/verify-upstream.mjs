/** Validate upstream/qilin.lock.json against the product lock contract. */
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

const COMMIT = /^[0-9a-f]{40}$/
const SEMVER = /^\d+\.\d+\.\d+$/
const TARGETS = new Set(['mac-arm64', 'mac-x64', 'win-x64'])

export function parseUpstreamLock(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('upstream lock: not an object')
  for (const field of ['productVersion', 'qilinVersion', 'nodeVersion', 'pnpmVersion']) {
    if (typeof value[field] !== 'string' || !SEMVER.test(value[field])) {
      throw new Error(`upstream lock: ${field} must be an exact X.Y.Z version, got ${JSON.stringify(value[field])}`)
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

if (process.argv[1] !== undefined && import.meta.url.endsWith(basename(process.argv[1]))) {
  const lock = await verifyUpstreamLock(process.argv[2] ?? 'upstream/qilin.lock.json')
  console.log(`upstream lock ok: qilin ${lock.qilinVersion} @ ${lock.qilinCommit.slice(0, 12)}`)
}
