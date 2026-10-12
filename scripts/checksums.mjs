import { createHash } from 'node:crypto'
import { createReadStream, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const files = readdirSync('release')
  .filter((name) => /^PromptTune-.*\.(dmg|zip|exe)$/.test(name))
  .sort()
const lines = []
for (const name of files) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(join('release', name))) hash.update(chunk)
  lines.push(`${hash.digest('hex')}  ${name}`)
}
writeFileSync(`release/SHA256SUMS-${process.platform}.txt`, lines.join('\n') + '\n')
