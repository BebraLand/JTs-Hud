import assert from 'node:assert/strict'
import path from 'node:path'
import {
  getHlaeCameraPose,
  HlaeCameraRegistry
} from '../src/main/server/domains/auto-director/hlae/hlaeCameraRegistry'

const registry = new HlaeCameraRegistry(path.resolve(process.cwd(), 'resources/auto-director/hlae'))
const map = registry.load('de_ancient')

assert.ok(map)
assert.equal(map.paths.length, 8)
assert.ok(map.paths.every((entry) => entry.durationSeconds > 0))
const spawnPath = map.paths.find((entry) => entry.kind === 'spawn')
assert.ok(spawnPath)
assert.equal(spawnPath.points.length, 4)
const runningToB = map.paths.find((entry) => entry.id === 'ancient_t_running_to_b')
assert.equal(runningToB?.kind, 'route')
const tSpawn = map.paths.find((entry) => entry.id === 'ancient_t_spawn_02')
assert.ok(tSpawn)
assert.ok(Math.abs(tSpawn.points[0]?.angles[1]! - -164.432724) < 0.001)
assert.ok(Math.abs(tSpawn.points[0]?.fov! - 69.633331) < 0.001)
const midpoint = getHlaeCameraPose(tSpawn, tSpawn.durationSeconds / 2)
assert.equal(midpoint.progress, 0.5)
assert.ok(midpoint.position.every(Number.isFinite))
const dust2 = registry.load('de_dust2')
assert.ok(dust2)
assert.equal(dust2.paths.length, 7)
assert.ok(dust2.paths.every((entry) => entry.durationSeconds > 0))
assert.equal(registry.load('../escape'), null)
assert.equal(registry.getStatus().state, 'error')

console.log('HLAE campath registry fixture passed')
