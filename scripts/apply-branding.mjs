// scripts/apply-branding.mjs
/** Apply branding overwrites and git patches to the ephemeral upstream checkout. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { sha256File } from './lib/hash.mjs'

const run = promisify(execFile)

/**
 * @param {{ productRoot: string, upstreamRoot: string, registry: { schemaVersion: number, overwrites?: Array<{ mode?: 'add', source: string, target: string, expectSha256?: string|null }>, patches?: Array<{ patch: string }> } }} options
 * @returns {Promise<{ overwrites: string[], patches: string[] }>}
 */
export async function applyBranding({ productRoot, upstreamRoot, registry }) {
  if (registry.schemaVersion !== 1) throw new Error(`branding registry: unsupported schemaVersion ${registry.schemaVersion}`)
  const overwrites = []
  for (const entry of registry.overwrites ?? []) {
    const target = join(upstreamRoot, entry.target)
    const source = join(productRoot, entry.source)
    await mkdir(dirname(target), { recursive: true })
    if (entry.mode === 'add') {
      // New downstream asset: the upstream tree must not already carry it.
      let exists = true
      try { await access(target) } catch { exists = false }
      if (exists) throw new Error(`branding add: ${entry.target} already exists upstream`)
      await copyFile(source, target)
      overwrites.push(entry.target)
      continue
    }
    const actual = await sha256File(target)
    // null/undefined skips the guard only for entries without a pinned pre-image
    if (entry.expectSha256 != null && actual !== entry.expectSha256) {
      throw new Error(`branding overwrite: sha mismatch for ${entry.target}: expected ${entry.expectSha256}, found ${actual}`)
    }
    await copyFile(source, target)
    overwrites.push(entry.target)
  }
  const patches = []
  for (const patch of registry.patches ?? []) {
    const patchPath = join(productRoot, patch.patch)
    await run('git', ['-C', upstreamRoot, 'apply', '--check', patchPath])
    await run('git', ['-C', upstreamRoot, 'apply', patchPath])
    patches.push(patch.patch)
  }
  await writeFile(join(upstreamRoot, '.openkylin-branding.json'),
    `${JSON.stringify({ overwrites, patches }, null, 2)}\n`)
  return { overwrites, patches }
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(basename(process.argv[1]))) {
  const [productRoot, upstreamRoot, registryPath] = process.argv.slice(2)
  if (!productRoot || !upstreamRoot || !registryPath) {
    throw new Error('usage: apply-branding.mjs <productRoot> <upstreamRoot> <registry.json>')
  }
  const registry = JSON.parse(await readFile(registryPath, 'utf8'))
  console.log(await applyBranding({ productRoot, upstreamRoot, registry }))
}
