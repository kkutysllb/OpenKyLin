// scripts/lib/hash.mjs
/** Deterministic hashing helpers shared by verification scripts. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

export function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export async function sha256File(path) {
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = createReadStream(path)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', resolve)
    stream.on('error', reject)
  })
  return hash.digest('hex')
}

/**
 * Hash a whole directory: sorted relative paths, each with its content hash.
 * Files whose POSIX relative path matches any `exclude` pattern are omitted.
 * Patterns must not carry the global flag: `RegExp.test` advances `lastIndex`
 * on `/g`, which would make the digest order-dependent.
 * @param {string} root
 * @param {{ exclude?: readonly RegExp[] }} [options]
 */
export async function dirDigest(root, { exclude = [] } = {}) {
  const entries = []
  async function walk(dir) {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name)
      const info = await stat(path)
      if (info.isDirectory()) await walk(path)
      else {
        const rel = relative(root, path).split(sep).join('/')
        if (exclude.some(pattern => pattern.test(rel))) continue
        entries.push([rel, await sha256File(path)])
      }
    }
  }
  await walk(root)
  return sha256Text(entries.map(([p, h]) => `${p}\0${h}`).join('\n'))
}
