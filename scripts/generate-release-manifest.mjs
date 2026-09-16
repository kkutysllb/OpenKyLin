// scripts/generate-release-manifest.mjs
/** Combine lock, sync report and checksums into releases/manifest.json. */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { basename, dirname } from 'node:path'

/**
 * @param {{ lock: object, sync: { match: boolean, webBundleSha256: string }, checksums: string }} options
 * @returns {object} Release manifest for releases/manifest.json.
 */
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

if (process.argv[1] !== undefined && import.meta.url.endsWith(basename(process.argv[1]))) {
  const [lockPath, syncPath, checksumsPath, outPath] = process.argv.slice(2)
  if (!lockPath || !syncPath || !checksumsPath) {
    throw new Error('usage: generate-release-manifest.mjs <lock.json> <sync-report.json> <checksums.txt> [manifestOut]')
  }
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
