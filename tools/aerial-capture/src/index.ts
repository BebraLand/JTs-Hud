import fs from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import {
  createManifest,
  manifestToJson,
  normalizeAnchorName,
  parseGetposOutput,
  upsertAnchor,
  type AerialManifest
} from './protocol'
import { STANDARD_ANCHORS } from './catalog'
import { captureGetpos } from './telnet'

interface CliOptions {
  host: string
  port: number
  map: string
  output: string
  name?: string
  notes?: string
}

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 2020

const usage = (): string => `Aerial Camera Capture

Capture current CS2 observer camera coordinates through NetCon/Telnet and save map anchors.

Interactive mode:
  npm run aerial:capture -- --map de_ancient

One-shot mode:
  npm run aerial:capture -- --map de_ancient --name a_site --notes "wide plant overview"

Options:
  --map <name>       Map name, for example de_ancient (required)
  --name <anchor>    Capture one anchor and exit
  --notes <text>     Optional notes for one-shot capture
  --output <path>    Manifest path (default: aerial-cameras/<map>.json)
  --host <host>      NetCon host (default: 127.0.0.1)
  --port <port>      NetCon port (default: 2020)
  --help             Show this help

Interactive commands:
  record <name> [notes]  Capture the current camera pose and save it
  list                   List captured anchors
  remove <name>          Remove an anchor
  save                   Save the manifest again
  help                   Show commands
  quit                   Exit
`

const readOption = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

const parseOptions = (args: string[]): CliOptions => {
  if (args.includes('--help')) {
    console.log(usage())
    process.exit(0)
  }

  const map = readOption(args, '--map')?.trim()
  if (!map) throw new Error('--map is required')
  if (!/^de_[a-z0-9_]+$/.test(map)) {
    throw new Error('Map must use the canonical form de_<name>, for example de_ancient')
  }

  const host = readOption(args, '--host') ?? DEFAULT_HOST
  const port = Number(readOption(args, '--port') ?? DEFAULT_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid --port value: ${port}`)
  }

  const outputPath =
    readOption(args, '--output') ?? path.join('aerial-cameras', `${map}.json`)

  return {
    host,
    port,
    map,
    output: outputPath,
    name: readOption(args, '--name'),
    notes: readOption(args, '--notes')
  }
}

const loadManifest = async (filePath: string, map: string): Promise<AerialManifest> => {
  if (!fs.existsSync(filePath)) return createManifest(map, STANDARD_ANCHORS)

  const parsed = JSON.parse(await readFile(filePath, 'utf8')) as AerialManifest
  if (parsed.schemaVersion !== 1 || parsed.map !== map || !parsed.anchors) {
    throw new Error(`Manifest ${filePath} is not a compatible ${map} Aerial manifest`)
  }
  return parsed
}

const saveManifest = async (filePath: string, manifest: AerialManifest): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, manifestToJson(manifest), 'utf8')
}

const captureAnchor = async (
  options: CliOptions,
  manifest: AerialManifest,
  name: string,
  notes?: string
): Promise<AerialManifest> => {
  const anchorName = normalizeAnchorName(name)
  process.stdout.write(`Reading current camera pose for ${anchorName}... `)
  const result = await captureGetpos({ host: options.host, port: options.port })
  const pose = parseGetposOutput(result.response)

  if (!pose) {
    process.stdout.write('failed\n')
    throw new Error(
      `Could not parse getpos output. Raw response tail:\n${result.response.slice(-2000)}`
    )
  }

  const next = upsertAnchor(manifest, anchorName, pose, result.response.trim(), notes?.trim())
  await saveManifest(options.output, next)
  process.stdout.write(
    `saved at ${options.output}\n  position: ${pose.position.join(' ')}\n  angles:   ${pose.angles.join(' ')}\n`
  )
  return next
}

const listAnchors = (manifest: AerialManifest): void => {
  const anchors = Object.values(manifest.anchors)
  if (!anchors.length) {
    console.log('No anchors captured yet.')
    return
  }

  for (const anchor of anchors) {
    const status = anchor.position && anchor.angles ? 'captured' : 'pending'
    console.log(
      `${anchor.name.padEnd(24)} ${status.padEnd(8)} ${anchor.position ? `pos=${anchor.position.join(', ')}` : anchor.hint}`
    )
  }
}

const runInteractive = async (options: CliOptions, manifest: AerialManifest): Promise<void> => {
  console.log(`Aerial Capture, ${options.map}`)
  console.log(`Manifest: ${options.output}`)
  console.log(`Telnet: ${options.host}:${options.port}`)
  console.log('Place the observer camera in CS2, then type: record <name> [notes]')
  console.log('Type help for commands, quit to exit.\n')

  const rl = createInterface({ input, output, prompt: 'aerial> ' })
  rl.prompt()
  try {
    for await (const line of rl) {
      const [command, ...parts] = line.trim().split(/\s+/).filter(Boolean)
      try {
        if (!command) {
          rl.prompt()
          continue
        }
        if (command === 'quit' || command === 'exit') break
        if (command === 'help') console.log(usage())
        else if (command === 'list') listAnchors(manifest)
        else if (command === 'save') {
          await saveManifest(options.output, manifest)
          console.log(`Saved ${options.output}`)
        } else if (command === 'remove') {
          const name = normalizeAnchorName(parts[0] ?? '')
          if (!manifest.anchors[name]) console.log(`Anchor not found: ${name}`)
          else {
            delete manifest.anchors[name]
            await saveManifest(options.output, manifest)
            console.log(`Removed ${name}`)
          }
        } else if (command === 'record') {
          const name = parts.shift()
          if (!name) throw new Error('Usage: record <name> [notes]')
          await captureAnchor(options, manifest, name, parts.join(' '))
          Object.assign(manifest, await loadManifest(options.output, options.map))
        } else console.log(`Unknown command: ${command}. Type help.`)
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      }
      rl.prompt()
    }
  } finally {
    rl.close()
  }
}

const main = async (): Promise<void> => {
  const options = parseOptions(process.argv.slice(2))
  let manifest = await loadManifest(options.output, options.map)

  if (options.name) {
    manifest = await captureAnchor(options, manifest, options.name, options.notes)
    console.log(`Captured ${Object.keys(manifest.anchors).length} anchor(s).`)
    return
  }

  await runInteractive(options, manifest)
}

main().catch((error) => {
  console.error(`Aerial Capture failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
