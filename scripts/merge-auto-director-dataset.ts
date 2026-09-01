import fs from 'node:fs'
import path from 'node:path'
import { createGzip, gunzipSync } from 'node:zlib'

const main = async (): Promise<void> => {
  const [outputPath, ...partPaths] = process.argv.slice(2)
  if (!outputPath || partPaths.length < 1) {
    throw new Error('Usage: merge-auto-director-dataset <output.csv.gz> <part0.csv.gz> ...')
  }
  const output = createGzip({ level: 9 })
  const target = fs.createWriteStream(outputPath)
  output.pipe(target)
  for (const [index, partPath] of partPaths.entries()) {
    const bytes = gunzipSync(fs.readFileSync(partPath))
    const newline = bytes.indexOf(10)
    if (index === 0 && newline < 0) throw new Error(`Dataset part has no header: ${partPath}`)
    const content = bytes
    output.write(content)
  }
  output.end()
  await new Promise<void>((resolve, reject) => {
    target.once('close', resolve)
    target.once('error', reject)
  })
  console.log(
    JSON.stringify({ output: path.resolve(outputPath), parts: partPaths.length, bytes: fs.statSync(outputPath).size })
  )
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
