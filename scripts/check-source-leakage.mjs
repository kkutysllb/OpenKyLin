// scripts/check-source-leakage.mjs
/** Reject shipped paths that carry upstream source or git metadata. */
import { readdir, stat } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'

const LEAK_PATTERNS = [
  /(^|\/)\.git(\/|$)/,
  /(^|\/)[^/]*\.ts$/,
  /(^|\/)[^/]*\.tsbuildinfo$/,
  /(^|\/)node_modules\/\.cache(\/|$)/,
  /(^|\/)\.desktop-build(\/|$)/,
]

export function findLeaks(paths) {
  return paths.filter(path => LEAK_PATTERNS.some(pattern => pattern.test(path)))
}

/** Recursively collect relative paths under root (POSIX separators). */
export async function walkCollect(root) {
  const files = []
  async function walk(dir) {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name)
      if ((await stat(path)).isDirectory()) await walk(path)
      else files.push(relative(root, path).split(sep).join('/'))
    }
  }
  await walk(root)
  return files
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(basename(process.argv[1]))) {
  const root = process.argv[2]
  if (!root) throw new Error('usage: check-source-leakage.mjs <root>')
  const leaks = findLeaks(await walkCollect(root))
  if (leaks.length > 0) {
    console.error(`source leakage detected:\n${leaks.join('\n')}`)
    process.exitCode = 1
  } else console.log('no source leakage')
}
