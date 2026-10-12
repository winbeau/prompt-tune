import { writeFile, mkdir } from 'node:fs/promises'

const providers = {}
for (const [preset, url, prefix] of [
  ['opencode', 'https://opencode.ai/docs/zen/', 'https://opencode.ai/zen/v1/'],
  ['opencode-go', 'https://opencode.ai/docs/go/', 'https://opencode.ai/zen/go/v1/']
]) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`Catalog documentation unavailable: ${response.status}`)
  const html = await response.text()
  const models = {}
  for (const row of html.matchAll(/<tr>[\s\S]*?<\/tr>/g)) {
    const cells = [...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) =>
      cell[1].replace(/<[^>]*>/g, '').trim()
    )
    if (!cells[2]?.startsWith(prefix) || !cells[1]) continue
    const path = cells[2].slice(prefix.length)
    const protocol =
      path === 'chat/completions'
        ? 'chat-completions'
        : path === 'responses'
          ? 'responses'
          : path === 'messages'
            ? 'messages'
            : 'unsupported'
    models[cells[1]] = { name: cells[0], protocol }
  }
  if (Object.keys(models).length < 5) throw new Error(`Unable to parse ${preset} documentation`)
  providers[preset] = { source: url, models }
}
await mkdir('src/main/catalog', { recursive: true })
await writeFile(
  'src/main/catalog/opencode.json',
  JSON.stringify({ fetchedAt: new Date().toISOString(), providers }, null, 2) + '\n'
)
console.log('Updated the OpenCode protocol catalog from official documentation.')
