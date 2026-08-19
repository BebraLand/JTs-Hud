import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const root = process.cwd()
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const nativeRelativePath = join('node_modules', 'sqlite3', 'build', 'Release', 'node_sqlite3.node')
const nativePath = join(root, nativeRelativePath)
const artifactName = `${packageJson.name}-${packageJson.version}-auto-director-experimental-portable.exe`
const packagedNativePath = join(
  root,
  'dist',
  'win-unpacked',
  'resources',
  'app.asar.unpacked',
  nativeRelativePath
)
const artifactPath = join(root, 'dist', artifactName)
const checksumPath = `${artifactPath}.sha256.txt`

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    ...options
  })

const isWindowsPe = (path) => {
  const header = readFileSync(path).subarray(0, 2)
  return header[0] === 0x4d && header[1] === 0x5a
}

run(npm, ['run', 'build'])

const originalNative = readFileSync(nativePath)
const originalMode = statSync(nativePath).mode

try {
  if (process.platform !== 'win32') {
    run(npm, ['rebuild', 'sqlite3'], {
      env: {
        ...process.env,
        npm_config_platform: 'win32',
        npm_config_arch: 'x64',
        npm_config_build_from_source: 'false'
      }
    })
  }

  if (!isWindowsPe(nativePath)) {
    throw new Error(`sqlite3 cross-build did not produce a Windows PE binary: ${nativePath}`)
  }

  run(npx, ['electron-builder', '--win', 'portable', '--x64', '--publish', 'never'])

  if (!existsSync(artifactPath))
    throw new Error(`Portable artifact was not created: ${artifactPath}`)
  if (!existsSync(packagedNativePath) || !isWindowsPe(packagedNativePath)) {
    throw new Error(
      `Packaged sqlite3 binary is missing or is not Windows PE x64: ${packagedNativePath}`
    )
  }

  const asarPath = join(root, 'dist', 'win-unpacked', 'resources', 'app.asar')
  const listing = execFileSync(npx, ['asar', 'list', asarPath], {
    cwd: root,
    encoding: 'utf8'
  })
  const requiredEntries = [
    '/resources/auto-director/models/auto-director-lightgbm.json',
    '/resources/auto-director/geometry/de_mirage.jgeo.json.gz',
    '/resources/auto-director/geometry/de_inferno.jgeo.json.gz',
    '/resources/auto-director/geometry/de_cache.jgeo.json.gz'
  ]
  for (const entry of requiredEntries) {
    if (!listing.split('\n').some((line) => line === entry)) {
      throw new Error(`Auto Director asset missing from app.asar: ${entry}`)
    }
  }
  const forbiddenEntries = [
    '/docs',
    '/e2e',
    '/fixtures',
    '/scripts',
    '/test-results',
    '/out/tests',
    '/node_modules/@tailwindcss/oxide-linux-x64-gnu'
  ]
  const leakedEntry = forbiddenEntries.find((entry) =>
    listing.split('\n').some((line) => line === entry || line.startsWith(`${entry}/`))
  )
  if (leakedEntry) throw new Error(`Development-only content leaked into app.asar: ${leakedEntry}`)

  const digest = createHash('sha256').update(readFileSync(artifactPath)).digest('hex')
  writeFileSync(checksumPath, `${digest}  ${artifactName}\n`, 'utf8')
  console.log(`Portable artifact: ${artifactPath}`)
  console.log(`Checksum file: ${checksumPath}`)
  console.log(`SHA-256: ${digest}`)
} finally {
  writeFileSync(nativePath, originalNative, { mode: originalMode })
}
