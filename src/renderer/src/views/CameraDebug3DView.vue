<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import type { CameraDebugGeometry, CameraDebugStatus } from '../features/auto-director/types'
import { getRadarMapConfig } from '../features/auto-director/radar'

const props = defineProps<{
  debug: CameraDebugStatus
  geometry: CameraDebugGeometry | null
  selectedAnchorId: string | null
}>()

type Vec3 = [number, number, number]
type Bounds = { min: Vec3; max: Vec3 }

const canvas = ref<HTMLCanvasElement | null>(null)
const flightMode = ref(false)
let gl: WebGLRenderingContext | null = null
let program: WebGLProgram | null = null
let buffer: WebGLBuffer | null = null
let overlayBuffer: WebGLBuffer | null = null
let meshVertexCount = 0
let resizeObserver: ResizeObserver | null = null
let bounds: Bounds = { min: [-1000, -1000, -100], max: [1000, 1000, 300] }
let target: Vec3 = [0, 0, 0]
let yaw = -0.8
let pitch = 0.72
let distance = 2600
let dragging = false
let lastPointer = { x: 0, y: 0 }
let flightPosition: Vec3 = [0, 0, 0]
let flightFrameId: number | null = null
let lastFlightTime = 0
const pressedKeys = new Set<string>()

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const renderTriangles = () => {
  const triangles = props.geometry?.triangles ?? []
  const config = getRadarMapConfig(props.debug.mapName)
  if (!config) return triangles
  const margin = Math.max(220, config.scale * 50)
  const minX = config.posX - margin
  const maxX = config.posX + config.size * config.scale + margin
  const minY = config.posY - config.size * config.scale - margin
  const maxY = config.posY + margin
  const filtered: number[] = []
  for (let offset = 0; offset + 8 < triangles.length; offset += 9) {
    const centerX = (triangles[offset] + triangles[offset + 3] + triangles[offset + 6]) / 3
    const centerY = (triangles[offset + 1] + triangles[offset + 4] + triangles[offset + 7]) / 3
    if (centerX < minX || centerX > maxX || centerY < minY || centerY > maxY) continue
    const projectedArea = Math.abs(
      (triangles[offset + 3] - triangles[offset]) * (triangles[offset + 7] - triangles[offset + 1]) -
        (triangles[offset + 4] - triangles[offset + 1]) * (triangles[offset + 6] - triangles[offset])
    ) * 0.5
    const zRange = Math.max(triangles[offset + 2], triangles[offset + 5], triangles[offset + 8]) -
      Math.min(triangles[offset + 2], triangles[offset + 5], triangles[offset + 8])
    // Render-only cleanup: giant horizontal sheets are sky/ceiling proxies in
    // some extracted maps. They are not useful for visual inspection and can
    // hide the playable layout from a free-flight camera.
    if (projectedArea > 120000 && zRange < 8) continue
    filtered.push(...triangles.slice(offset, offset + 9))
  }
  return filtered
}
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const normalize = (value: Vec3): Vec3 => {
  const length = Math.hypot(...value) || 1
  return [value[0] / length, value[1] / length, value[2] / length]
}
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const multiply = (a: Float32Array, b: Float32Array): Float32Array => {
  const result = new Float32Array(16)
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      result[column * 4 + row] = a[row] * b[column * 4] + a[4 + row] * b[column * 4 + 1] + a[8 + row] * b[column * 4 + 2] + a[12 + row] * b[column * 4 + 3]
    }
  }
  return result
}

const perspective = (fov: number, aspect: number, near: number, far: number): Float32Array => {
  const factor = 1 / Math.tan(fov / 2)
  const result = new Float32Array(16)
  result[0] = factor / aspect
  result[5] = factor
  result[10] = (far + near) / (near - far)
  result[11] = -1
  result[14] = (2 * far * near) / (near - far)
  return result
}

const lookAt = (eye: Vec3, center: Vec3): Float32Array => {
  const forward = normalize(subtract(eye, center))
  const right = normalize(cross([0, 0, 1], forward))
  const up = cross(forward, right)
  return new Float32Array([
    right[0], up[0], forward[0], 0,
    right[1], up[1], forward[1], 0,
    right[2], up[2], forward[2], 0,
    -dot(right, eye), -dot(up, eye), -dot(forward, eye), 1
  ])
}

const shader = (type: number, source: string): WebGLShader => {
  if (!gl) throw new Error('WebGL is not available')
  const result = gl.createShader(type)
  if (!result) throw new Error('Could not create WebGL shader')
  gl.shaderSource(result, source)
  gl.compileShader(result)
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result) ?? 'WebGL shader failed')
  return result
}

const createProgram = () => {
  if (!gl) return
  const vertex = shader(gl.VERTEX_SHADER, `
    attribute vec3 aPosition;
    attribute vec3 aColor;
    uniform mat4 uMatrix;
    uniform float uPointSize;
    varying vec3 vColor;
    void main() {
      gl_Position = uMatrix * vec4(aPosition, 1.0);
      gl_PointSize = uPointSize;
      vColor = aColor;
    }
  `)
  const fragment = shader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    varying vec3 vColor;
    void main() { gl_FragColor = vec4(vColor, 1.0); }
  `)
  program = gl.createProgram()
  if (!program) throw new Error('Could not create WebGL program')
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'WebGL program failed')
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  buffer = gl.createBuffer()
  overlayBuffer = gl.createBuffer()
}

const collectBounds = (): Bounds => {
  const positions: Vec3[] = []
  const triangles = renderTriangles()
  for (let offset = 0; offset + 2 < triangles.length; offset += 3) positions.push([triangles[offset], triangles[offset + 1], triangles[offset + 2]])
  for (const player of props.debug.players) if (player.position) positions.push(player.position)
  for (const anchor of props.debug.anchors) positions.push(anchor.position)
  if (!positions.length) return { min: [-1000, -1000, -100], max: [1000, 1000, 300] }
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const position of positions) for (let axis = 0; axis < 3; axis += 1) {
    min[axis] = Math.min(min[axis], position[axis])
    max[axis] = Math.max(max[axis], position[axis])
  }
  return { min, max }
}

const resetView = () => {
  bounds = collectBounds()
  const span = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], 1200)
  target = [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, bounds.min[2] + Math.min(160, Math.max(64, (bounds.max[2] - bounds.min[2]) * 0.12))]
  distance = clamp(span * 1.45, 900, 12000)
  yaw = -0.8
  pitch = 0.72
  flightPosition = orbitEye()
}

const orbitEye = (): Vec3 => {
  const horizontal = Math.cos(pitch) * distance
  return [target[0] + Math.cos(yaw) * horizontal, target[1] + Math.sin(yaw) * horizontal, target[2] + Math.sin(pitch) * distance]
}

const cameraMatrix = (width: number, height: number) => {
  const eye = flightMode.value ? flightPosition : orbitEye()
  const direction: Vec3 = [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), -Math.sin(pitch)]
  const center: Vec3 = flightMode.value ? [eye[0] + direction[0] * 1000, eye[1] + direction[1] * 1000, eye[2] + direction[2] * 1000] : target
  return multiply(perspective(Math.PI / 3, width / Math.max(1, height), 8, 30000), lookAt(eye, center))
}

const uploadMesh = () => {
  if (!gl || !buffer) return
  const triangles = renderTriangles()
  const data = new Float32Array((triangles.length / 3) * 6)
  const zSpan = Math.max(1, bounds.max[2] - bounds.min[2])
  for (let source = 0, targetIndex = 0; source < triangles.length; source += 3, targetIndex += 6) {
    const z = triangles[source + 2]
    const next = source + 3
    const last = source + 6
    const edgeA: Vec3 = [triangles[next] - triangles[source], triangles[next + 1] - triangles[source + 1], triangles[next + 2] - z]
    const edgeB: Vec3 = [triangles[last] - triangles[source], triangles[last + 1] - triangles[source + 1], triangles[last + 2] - z]
    const normal = normalize(cross(edgeA, edgeB))
    const directionalLight = Math.abs(dot(normal, normalize([0.45, -0.55, 0.75])))
    const heightLight = clamp((z - bounds.min[2]) / zSpan, 0, 1) * 0.08
    const light = 0.1 + directionalLight * 0.28 + heightLight
    data[targetIndex] = triangles[source]
    data[targetIndex + 1] = triangles[source + 1]
    data[targetIndex + 2] = z
    data[targetIndex + 3] = light * 0.62
    data[targetIndex + 4] = light * 0.76
    data[targetIndex + 5] = light
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
  meshVertexCount = triangles.length / 3
}

const appendVertex = (data: number[], position: readonly [number, number, number], color: readonly [number, number, number]) => data.push(position[0], position[1], position[2], color[0], color[1], color[2])

const draw = () => {
  if (!gl || !program || !buffer || !overlayBuffer || !canvas.value) return
  const width = canvas.value.clientWidth
  const height = canvas.value.clientHeight
  if (!width || !height) return
  const ratio = window.devicePixelRatio || 1
  gl.viewport(0, 0, Math.floor(width * ratio), Math.floor(height * ratio))
  gl.clearColor(0.025, 0.035, 0.055, 1)
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
  gl.enable(gl.DEPTH_TEST)
  gl.disable(gl.CULL_FACE)
  gl.useProgram(program)
  const matrixLocation = gl.getUniformLocation(program, 'uMatrix')
  const pointSizeLocation = gl.getUniformLocation(program, 'uPointSize')
  gl.uniformMatrix4fv(matrixLocation, false, cameraMatrix(width, height))
  gl.uniform1f(pointSizeLocation, 1)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  const positionLocation = gl.getAttribLocation(program, 'aPosition')
  const colorLocation = gl.getAttribLocation(program, 'aColor')
  gl.enableVertexAttribArray(positionLocation)
  gl.enableVertexAttribArray(colorLocation)
  gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 24, 0)
  gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, 24, 12)
  gl.drawArrays(gl.TRIANGLES, 0, meshVertexCount)

  const lineData: number[] = []
  const pointData: number[] = []
  const playerById = new Map(props.debug.players.map((player) => [player.steamId, player]))
  const selected = props.debug.anchors.find((anchor) => anchor.id === props.selectedAnchorId)
  if (selected) for (const steamId of [...selected.visibleSteamIds, ...selected.occludedSteamIds]) {
    const player = playerById.get(steamId)
    if (!player?.position) continue
    const color: [number, number, number] = selected.visibleSteamIds.includes(steamId) ? [0.65, 0.48, 0.95] : [1, 0.52, 0.16]
    appendVertex(lineData, selected.position, color)
    appendVertex(lineData, player.position, color)
  }
  for (const anchor of props.debug.anchors) appendVertex(pointData, anchor.position, anchor.id === props.selectedAnchorId ? [0.8, 0.7, 1] : [0.55, 0.35, 0.95])
  for (const player of props.debug.players) if (player.position) appendVertex(pointData, player.position, player.steamId === props.debug.currentPlayerSteamId ? [0.4, 0.95, 1] : player.team === 'CT' ? [0.2, 0.65, 1] : [1, 0.65, 0.15])
  const overlay = new Float32Array([...lineData, ...pointData])
  if (!overlay.length) return
  gl.bindBuffer(gl.ARRAY_BUFFER, overlayBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, overlay, gl.DYNAMIC_DRAW)
  gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 24, 0)
  gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, 24, 12)
  gl.uniform1f(pointSizeLocation, 2)
  gl.drawArrays(gl.LINES, 0, lineData.length / 6)
  gl.uniform1f(pointSizeLocation, 9)
  gl.drawArrays(gl.POINTS, lineData.length / 6, pointData.length / 6)
}

const resize = () => {
  if (!canvas.value || !gl) return
  const ratio = window.devicePixelRatio || 1
  canvas.value.width = Math.max(1, Math.floor(canvas.value.clientWidth * ratio))
  canvas.value.height = Math.max(1, Math.floor(canvas.value.clientHeight * ratio))
  draw()
}
const onPointerDown = (event: PointerEvent) => { dragging = true; lastPointer = { x: event.clientX, y: event.clientY }; canvas.value?.setPointerCapture(event.pointerId) }
const onPointerMove = (event: PointerEvent) => {
  if (!dragging) return
  yaw += (flightMode.value ? -1 : 1) * (event.clientX - lastPointer.x) * 0.008
  pitch = clamp(pitch + (event.clientY - lastPointer.y) * 0.006, -1.53, 1.53)
  lastPointer = { x: event.clientX, y: event.clientY }
  draw()
}
const onPointerUp = (event: PointerEvent) => { dragging = false; canvas.value?.releasePointerCapture(event.pointerId) }
const onWheel = (event: WheelEvent) => { event.preventDefault(); distance = clamp(distance * Math.exp(event.deltaY * 0.001), 250, 18000); draw() }

const moveFlight = (deltaSeconds: number) => {
  const forward: Vec3 = [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), -Math.sin(pitch)]
  const right: Vec3 = [Math.sin(yaw), -Math.cos(yaw), 0]
  const up: Vec3 = [0, 0, 1]
  const direction: Vec3 = [0, 0, 0]
  const add = (vector: Vec3, amount: number) => {
    direction[0] += vector[0] * amount
    direction[1] += vector[1] * amount
    direction[2] += vector[2] * amount
  }
  if (pressedKeys.has('KeyW')) add(forward, 1)
  if (pressedKeys.has('KeyS')) add(forward, -1)
  if (pressedKeys.has('KeyD')) add(right, 1)
  if (pressedKeys.has('KeyA')) add(right, -1)
  if (pressedKeys.has('KeyE')) add(up, 1)
  if (pressedKeys.has('KeyQ')) add(up, -1)
  const length = Math.hypot(...direction)
  if (!length) return
  const speed = pressedKeys.has('ShiftLeft') || pressedKeys.has('ShiftRight') ? 2200 : 700
  flightPosition = [
    flightPosition[0] + (direction[0] / length) * speed * deltaSeconds,
    flightPosition[1] + (direction[1] / length) * speed * deltaSeconds,
    flightPosition[2] + (direction[2] / length) * speed * deltaSeconds
  ]
}

const startFlightLoop = () => {
  if (flightFrameId !== null) return
  const frame = (now: number) => {
    flightFrameId = null
    if (!flightMode.value || !pressedKeys.size) return
    const deltaSeconds = Math.min(0.05, lastFlightTime ? (now - lastFlightTime) / 1000 : 0)
    lastFlightTime = now
    moveFlight(deltaSeconds)
    draw()
    flightFrameId = requestAnimationFrame(frame)
  }
  lastFlightTime = 0
  flightFrameId = requestAnimationFrame(frame)
}

const onKeyDown = (event: KeyboardEvent) => {
  if (!flightMode.value) return
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
    event.preventDefault()
    pressedKeys.add(event.code)
    startFlightLoop()
  }
}

const onKeyUp = (event: KeyboardEvent) => pressedKeys.delete(event.code)

const toggleFlightMode = () => {
  flightMode.value = !flightMode.value
  pressedKeys.clear()
  if (flightMode.value) {
    flightPosition = orbitEye()
    const direction = normalize(subtract(target, flightPosition))
    yaw = Math.atan2(direction[1], direction[0])
    pitch = -Math.asin(direction[2])
  } else {
    if (flightFrameId !== null) cancelAnimationFrame(flightFrameId)
    flightFrameId = null
    resetView()
  }
  draw()
}

onMounted(() => {
  gl = canvas.value?.getContext('webgl', { antialias: true, alpha: false }) ?? null
  if (!gl) return
  createProgram()
  resizeObserver = new ResizeObserver(resize)
  if (canvas.value) resizeObserver.observe(canvas.value)
  resetView()
  uploadMesh()
  resize()
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
})
onUnmounted(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  if (flightFrameId !== null) cancelAnimationFrame(flightFrameId)
})
watch(() => props.geometry, () => { resetView(); uploadMesh(); draw() })
watch(() => props.debug.updatedAt, draw)
watch(() => props.selectedAnchorId, draw)
</script>

<template>
  <div class="camera-debug-3d-surface relative min-h-0 flex-1 overflow-hidden rounded-xl border border-zinc-800 bg-[#070a10]">
    <canvas ref="canvas" class="block h-full w-full touch-none" aria-label="3D camera debug view" @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp" @wheel="onWheel" />
    <div class="pointer-events-none absolute left-3 top-3 rounded-lg border border-zinc-700/80 bg-[#090b12]/85 px-3 py-2 text-[10px] text-zinc-400"><span class="text-violet-300">FULL GEOMETRY</span> · {{ flightMode ? 'WASD · Q/E · Shift · drag look' : 'drag orbit · wheel zoom' }}</div>
    <div class="absolute right-3 top-3 flex gap-2">
      <button class="rounded-lg border border-zinc-700 bg-[#111522]/90 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-zinc-300 hover:border-violet-400/60 hover:text-white" @click="resetView">Reset view</button>
      <button :class="flightMode ? 'border-cyan-300/70 bg-cyan-300/15 text-cyan-100' : 'border-zinc-700 bg-[#111522]/90 text-zinc-300'" class="rounded-lg border px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:border-cyan-300/70 hover:text-white" @click="toggleFlightMode">{{ flightMode ? 'Exit flight' : 'Free flight' }}</button>
    </div>
  </div>
</template>
