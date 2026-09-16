/** Validate branding/brand-manifest.json: schema, hex colors, WCAG contrast. */
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

const HEX = /^#[0-9a-fA-F]{6}$/
const COLOR_FIELDS = ['paper', 'ink', 'cinnabar', 'jade', 'gold']

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16)
  const channel = shift => {
    const c = ((n >> shift) & 0xff) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
}

export function contrastRatio(foreground, background) {
  if (!HEX.test(foreground) || !HEX.test(background)) throw new Error(`contrast: bad hex ${foreground}/${background}`)
  const [hi, lo] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  const ratio = (hi + 0.05) / (lo + 0.05)
  if (ratio <= 1) throw new Error(`contrast: degenerate ratio for ${foreground}/${background}`)
  return ratio
}

export function parseBrandManifest(value) {
  if (typeof value !== 'object' || value === null) throw new Error('brand manifest: not an object')
  if (value.schemaVersion !== 1) throw new Error('brand manifest: unsupported schemaVersion')
  for (const field of ['productName', 'displayName', 'subtitle', 'trademarkNotice']) {
    if (typeof value[field] !== 'string' || value[field] === '') throw new Error(`brand manifest: ${field} required`)
  }
  if (value.defaultLocale !== 'zh-CN') throw new Error('brand manifest: defaultLocale must be zh-CN')
  if (value.logo?.usage !== 'authorized' || typeof value.logo?.source !== 'string') {
    throw new Error('brand manifest: logo must record authorized usage and source path')
  }
  for (const scheme of ['light', 'dark']) {
    const theme = value.theme?.[scheme]
    if (typeof theme !== 'object' || theme === null) throw new Error(`brand manifest: theme.${scheme} required`)
    for (const field of COLOR_FIELDS) {
      if (typeof theme[field] !== 'string' || !HEX.test(theme[field])) {
        throw new Error(`brand manifest: theme.${scheme}.${field} must be a hex color`)
      }
    }
    if (contrastRatio(theme.ink, theme.paper) < 4.5) {
      throw new Error(`brand manifest: theme.${scheme} paper/ink contrast below 4.5`)
    }
  }
  return value
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(basename(process.argv[1]))) {
  parseBrandManifest(JSON.parse(await readFile(process.argv[2] ?? 'branding/brand-manifest.json', 'utf8')))
  console.log('brand manifest ok')
}
