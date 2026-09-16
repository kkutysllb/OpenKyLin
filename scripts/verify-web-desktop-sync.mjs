// scripts/verify-web-desktop-sync.mjs
/** Fail the build when Web and Desktop carry different Web Client bundles. */
import { writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { dirDigest } from './lib/hash.mjs'

/**
 * @param {{ webDist: string, desktopDist: string }} options - Absolute paths to the two dist trees.
 * @returns {Promise<{ match: boolean, webBundleSha256: string, desktopBundleSha256: string }>}
 */
export async function compareWebDesktop({ webDist, desktopDist }) {
  const [web, desktop] = [await dirDigest(webDist), await dirDigest(desktopDist)]
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
