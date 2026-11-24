import { readFileSync, writeFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const output = new URL('./dist/index.html', import.meta.url)
const html = read('./dist/index.html')
const notices = [
  ['KerbTac license', read('../LICENSE')],
  ['KerbTac third-party notices', read('../NOTICE.md')],
  ['Three.js license', read('./node_modules/three/LICENSE')],
  ['fflate license', read('./node_modules/fflate/LICENSE')],
].map(([title, text]) => `${title}\n${text.trim()}`).join('\n\n')
if (!/^<!doctype html>/i.test(html)) throw new Error('Missing HTML doctype')
// Preserve standards mode and make the full terms travel with the standalone file.
writeFileSync(output, html.replace(/^<!doctype html>/i, (doctype) =>
  `${doctype}\n<!--\n${notices.replaceAll('--', '—')}\n-->\n`))
