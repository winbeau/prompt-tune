import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
let output =
  '# Third-party notices\n\nPromptTune is MIT licensed. Dependencies retain their respective licenses.\n\n'
output +=
  'Electron and its bundled Chromium/Node.js dependencies include licenses/ELECTRON-LICENSE and licenses/LICENSES.chromium.html in the application Resources directory. SQLite is included by Node.js.\n\n'
output +=
  'Pi and Ueli informed the architecture; no application source from these projects is included. OpenCode endpoint mappings are factual catalog data generated from its official Zen/Go documentation; see src/main/catalog/opencode.json.\n\n'
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path || entry.dev || !existsSync(path)) continue
  const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))
  const files = readdirSync(path).filter((name) => /^(licen[cs]e|copying|notice)(\..*)?$/i.test(name))
  if (!files.length) throw new Error(`Missing license: ${pkg.name}`)
  output += `## ${pkg.name} ${pkg.version}\n\nLicense: ${entry.license ?? pkg.license}\n\n`
  for (const name of files) {
    const license = readFileSync(join(path, name), 'utf8')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      .trim()
    output += `### ${name}\n\n\`\`\`text\n${license}\n\`\`\`\n\n`
  }
}
writeFileSync('THIRD_PARTY_NOTICES.md', output.trimEnd() + '\n')
