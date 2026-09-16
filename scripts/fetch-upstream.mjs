// scripts/fetch-upstream.mjs
/** Clone the locked QiLin commit into an ephemeral directory and verify its identity. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const run = promisify(execFile)

/**
 * @param {{ repository: string, commit: string, qilinVersion: string, out: string }} options
 * @returns {Promise<{ commit: string, qilinVersion: string, out: string }>}
 */
export async function fetchUpstream({ repository, commit, qilinVersion, out }) {
  await rm(out, { recursive: true, force: true })
  await run('git', ['clone', '--no-checkout', repository, out])
  await run('git', ['-C', out, 'checkout', '--detach', commit])
  const pkg = JSON.parse(await readFile(join(out, 'package.json'), 'utf8'))
  if (pkg.version !== qilinVersion) {
    throw new Error(`upstream version mismatch: lock expects ${qilinVersion}, commit ${commit.slice(0, 12)} has ${pkg.version}`)
  }
  const summary = { commit, qilinVersion: pkg.version, out }
  await writeFile(join(out, '.openkylin-upstream.json'), `${JSON.stringify(summary, null, 2)}\n`)
  return summary
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(basename(process.argv[1]))) {
  const [repository, commit, qilinVersion, out] = process.argv.slice(2)
  if (!repository || !commit || !qilinVersion || !out) {
    throw new Error('usage: fetch-upstream.mjs <repository> <commit> <qilinVersion> <out>')
  }
  console.log(await fetchUpstream({ repository, commit, qilinVersion, out }))
}
