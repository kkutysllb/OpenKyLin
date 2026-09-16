// scripts/verify-artifact.mjs
/** Validate the unpacked desktop payload against the upstream lock and emit checksums. */
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { sha256File } from './lib/hash.mjs'

const VERSION_PAIRS = [
  ['version', 'qilinVersion'],
  ['nodeVersion', 'nodeVersion'],
  ['pnpmVersion', 'pnpmVersion'],
]

export function parseArtifactReport({ runtime, lock }) {
  for (const [runtimeField, lockField] of VERSION_PAIRS) {
    if (runtime[runtimeField] !== lock[lockField]) {
      throw new Error(`artifact verify: version mismatch on ${runtimeField}: runtime=${String(runtime[runtimeField])} lock=${String(lock[lockField])}`)
    }
  }
  return { ok: true }
}

export async function checksums(artifactDir) {
  const names = (await readdir(artifactDir)).filter(name => /\.(dmg|zip|yml|json|blockmap)$/.test(name)).sort()
  if (names.length === 0) throw new Error(`artifact verify: no release files found in ${artifactDir}`)
  const lines = []
  for (const name of names) lines.push(`${await sha256File(join(artifactDir, name))}  ${name}`)
  return lines.join('\n')
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(basename(process.argv[1]))) {
  const [runtimeJsonPath, lockPath, artifactDir, outPath] = process.argv.slice(2)
  if (!runtimeJsonPath || !lockPath || !artifactDir) {
    throw new Error('usage: verify-artifact.mjs <desktop-runtime.json> <qilin.lock.json> <artifactDir> [checksumsOut]')
  }
  const runtime = JSON.parse(await readFile(runtimeJsonPath, 'utf8'))
  const lock = JSON.parse(await readFile(lockPath, 'utf8'))
  parseArtifactReport({ runtime, lock })
  const text = await checksums(artifactDir)
  await writeFile(outPath ?? join(artifactDir, 'checksums-sha256.txt'), `${text}\n`)
  console.log(`artifact verify ok: ${text.split('\n').length} file(s)`)
}
