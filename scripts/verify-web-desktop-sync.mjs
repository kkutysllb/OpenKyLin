// scripts/verify-web-desktop-sync.mjs
/** Fail the build when Web and Desktop carry different Web Client bundles. */
import { writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { dirDigest } from './lib/hash.mjs'

/**
 * Entries the packed @qilin/web-frontend tarball drops (its `files` filter
 * excludes every `dist` source map, `dist/preview.html` and the `dist/preview`
 * directory) while raw `apps/web/dist` Vite output carries them. Both sides of
 * the comparison are digested under this same exclusion, so the gate compares
 * the bundle that actually ships to Desktop.
 */
export const DEFAULT_BUNDLE_EXCLUDE = [/\.map$/, /(^|\/)preview(\.html|\/)/]

/**
 * @param {{ webDist: string, desktopDist: string, exclude?: readonly RegExp[] }} options
 *   Absolute paths to the two dist trees; `exclude` overrides DEFAULT_BUNDLE_EXCLUDE
 *   (pass `[]` for full-tree equality).
 * @returns {Promise<{ match: boolean, webBundleSha256: string, desktopBundleSha256: string }>}
 */
export async function compareWebDesktop({ webDist, desktopDist, exclude }) {
  const patterns = exclude ?? DEFAULT_BUNDLE_EXCLUDE
  const [web, desktop] = [
    await dirDigest(webDist, { exclude: patterns }),
    await dirDigest(desktopDist, { exclude: patterns }),
  ]
  return { match: web === desktop, webBundleSha256: web, desktopBundleSha256: desktop }
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(basename(process.argv[1]))) {
  const [webDist, desktopDist, reportPath] = process.argv.slice(2)
  if (!webDist || !desktopDist) {
    throw new Error('usage: verify-web-desktop-sync.mjs <webDist> <desktopDist> [report.json]')
  }
  const report = await compareWebDesktop({ webDist, desktopDist })
  if (reportPath) await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  if (!report.match) {
    console.error(`web/desktop sync failed:\n  web=${report.webBundleSha256}\n  desktop=${report.desktopBundleSha256}`)
    process.exitCode = 1
  } else {
    console.log(`web/desktop sync ok: ${report.webBundleSha256.slice(0, 12)}`)
  }
}
