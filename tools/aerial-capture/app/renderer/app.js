const STANDARD_ANCHORS = [
  {
    id: 't_spawn',
    label: 'T Spawn',
    kind: 'spawn',
    required: true,
    hint: 'Wide, readable overview of the attacking spawn.'
  },
  {
    id: 'ct_spawn',
    label: 'CT Spawn',
    kind: 'spawn',
    required: true,
    hint: 'Wide, readable overview of the defending spawn.'
  },
  {
    id: 'mid',
    label: 'Mid',
    kind: 'mid',
    required: true,
    hint: 'The most useful central route overview.'
  },
  {
    id: 'a_main',
    label: 'A Main / Approach',
    kind: 'route',
    required: false,
    hint: 'Show the entry portal and the first fight space.'
  },
  {
    id: 'a_site',
    label: 'A Site',
    kind: 'site',
    required: true,
    hint: 'Wide site view with plant and contest visibility.'
  },
  {
    id: 'b_main',
    label: 'B Main / Approach',
    kind: 'route',
    required: false,
    hint: 'Show the entry portal and the first fight space.'
  },
  {
    id: 'b_site',
    label: 'B Site',
    kind: 'site',
    required: true,
    hint: 'Wide site view with plant and contest visibility.'
  },
  {
    id: 'long',
    label: 'Long',
    kind: 'route',
    required: false,
    hint: 'Long lane or its closest equivalent.'
  },
  {
    id: 'short',
    label: 'Short',
    kind: 'route',
    required: false,
    hint: 'Short lane or its closest equivalent.'
  },
  {
    id: 'a_postplant',
    label: 'A Post-plant',
    kind: 'postplant',
    required: false,
    hint: 'Show bomb and main retake lanes.'
  },
  {
    id: 'b_postplant',
    label: 'B Post-plant',
    kind: 'postplant',
    required: false,
    hint: 'Show bomb and main retake lanes.'
  },
  {
    id: 'wide_overview',
    label: 'Map Wide Overview',
    kind: 'custom',
    required: false,
    hint: 'High-level shot for round transitions.'
  }
]

const $ = (id) => document.getElementById(id)

if (!window.aerial || window.aerial.apiVersion !== 'gsi-state-fix-1') {
  document.body.innerHTML =
    '<main style="padding:32px;font:16px sans-serif;color:#fff;background:#080a10">This Aerial Capture build is stale or incomplete. Download the latest gsi-state-fix portable build.</main>'
  throw new Error('Aerial preload bridge is missing or stale')
}
let netconHost = ''
let netconPort = 0
let netconReady = false
const mapInput = $('map')

const list = $('anchor-list')
const selectedLabel = $('selected-label')
const selectedKind = $('selected-kind')
const selectedHint = $('selected-hint')
const positionOutput = $('position')
const anglesOutput = $('angles')
const notesInput = $('notes')
const captureButton = $('capture-button')
const teleportButton = $('teleport-button')
const removeCustomButton = $('remove-custom')
const resultOutput = $('capture-result')
const statusOutput = $('connection-status')
const progressOutput = $('progress')
const exportButton = $('export-button')
const detectMapButton = $('detect-map')
const debugLogOutput = $('debug-log')
const copyDebugButton = $('copy-debug')
const clearDebugButton = $('clear-debug')
const hlaeNameInput = $('hlae-name')
const hlaePresetInput = $('hlae-preset')
const hlaeSourceInput = $('hlae-source')
const hlaeSaveButton = $('hlae-save')
const hlaeRefreshButton = $('hlae-refresh')
const hlaeExportButton = $('hlae-export')
const hlaeImportButton = $('hlae-import')
const hlaeList = $('hlae-list')
const hlaeResult = $('hlae-result')
const connectionSummary = $('connection-summary')
let suggestedHlaeName = ''
let selectedId = null
let manifest = createManifest(mapInput.value)
let lastMapDetection = null

function debugLog(event, details = {}) {
  const line = `[${new Date().toISOString()}] ${event} ${JSON.stringify(details)}`
  const current =
    debugLogOutput.textContent === 'Starting diagnostics...' ? '' : debugLogOutput.textContent
  debugLogOutput.textContent = `${current}${current ? '\n' : ''}${line}`.slice(-24000)
  debugLogOutput.scrollTop = debugLogOutput.scrollHeight
  console.debug(`[Aerial] ${event}`, details)
}

async function syncTelnetSettings() {
  try {
    const settings = await window.aerial.getTelnetSettings()
    netconHost = settings.host
    netconPort = settings.port
    netconReady = true
    connectionSummary.textContent = `NetCon ${netconHost}:${netconPort} · map from JTs-Hud GSI`
    return true
  } catch (error) {
    netconReady = false
    connectionSummary.textContent = 'JTs-Hud connection settings unavailable'
    debugLog('telnet-settings-failed', {
      error: error instanceof Error ? error.message : String(error)
    })
    return false
  }
}

function getNetconOptions() {
  if (!netconReady) throw new Error('Start JTs-Hud first so Aerial can read the Telnet settings.')
  return { host: netconHost, port: netconPort }
}

function createManifest(map) {
  const anchors = {}
  for (const spec of STANDARD_ANCHORS) anchors[spec.id] = { ...spec }
  return {
    schemaVersion: 1,
    map,
    coordinateSystem: 'source2-hammer-units',
    source: 'cs2-netcon-getpos',
    anchors
  }
}

function draftKey(map) {
  return `jts-aerial-draft:${map}`
}

function saveDraft() {
  localStorage.setItem(draftKey(manifest.map), JSON.stringify(manifest))
  window.aerial.saveDraft(manifest).catch(() => {
    debugLog('draft-save-failed', { map: manifest.map, fallback: 'localStorage' })
    statusOutput.classList.add('error')
    statusOutput.innerHTML = '<span class="status-dot"></span>Local draft only; disk save failed'
  })
}

function loadLocalDraft(map) {
  try {
    const saved = localStorage.getItem(draftKey(map))
    if (!saved) return createManifest(map)
    const parsed = JSON.parse(saved)
    if (parsed.schemaVersion !== 1 || parsed.map !== map || !parsed.anchors)
      return createManifest(map)
    return mergeWithCatalog(parsed)
  } catch {
    return createManifest(map)
  }
}

async function loadDraft(map) {
  try {
    const response = await window.aerial.loadDraft(map)
    if (response?.manifest) return mergeWithCatalog(response.manifest)
  } catch {
    // Fall back to the browser profile draft below.
  }
  return loadLocalDraft(map)
}

function mergeWithCatalog(input) {
  const next = { ...input, anchors: { ...input.anchors } }
  for (const spec of STANDARD_ANCHORS) {
    next.anchors[spec.id] = { ...spec, ...(next.anchors[spec.id] || {}) }
  }
  return next
}

function isCaptured(anchor) {
  return (
    Array.isArray(anchor.position) &&
    anchor.position.length === 3 &&
    Array.isArray(anchor.angles) &&
    anchor.angles.length === 3
  )
}

function render() {
  $('map-title').textContent = mapInput.options[mapInput.selectedIndex].text
  const required = Object.values(manifest.anchors).filter((anchor) => anchor.required)
  const requiredCaptured = required.filter(isCaptured).length
  progressOutput.textContent = `${requiredCaptured} / ${required.length} required`
  exportButton.disabled = validateManifest().length > 0

  list.replaceChildren()
  for (const anchor of Object.values(manifest.anchors)) {
    const button = document.createElement('button')
    button.className = `anchor-card${anchor.id === selectedId ? ' selected' : ''}${isCaptured(anchor) ? ' captured' : ''}`
    button.type = 'button'
    button.addEventListener('click', () => selectAnchor(anchor.id))

    const marker = document.createElement('span')
    marker.className = 'marker'
    const copy = document.createElement('span')
    const label = document.createElement('span')
    label.className = 'anchor-label'
    label.textContent = anchor.label
    const hint = document.createElement('span')
    hint.className = 'anchor-hint'
    hint.textContent = anchor.hint
    copy.append(label, hint)
    const state = document.createElement('span')
    state.className = 'anchor-state'
    state.textContent = isCaptured(anchor) ? 'captured' : anchor.required ? 'required' : 'optional'
    button.append(marker, copy, state)
    list.append(button)
  }

  if (!selectedId || !manifest.anchors[selectedId]) {
    selectedLabel.textContent = 'Select a point'
    selectedKind.textContent = 'Waiting'
    selectedKind.className = 'badge'
    selectedHint.textContent =
      'Choose an anchor from the checklist. The map is received through JTs-Hud GSI; the camera pose is read through CS2 Telnet.'
    positionOutput.textContent = 'not captured'
    anglesOutput.textContent = 'not captured'
    notesInput.value = ''
    captureButton.disabled = true
    teleportButton.disabled = true
    removeCustomButton.disabled = true
    removeCustomButton.textContent = 'Clear saved coordinates'
    return
  }

  const anchor = manifest.anchors[selectedId]
  selectedLabel.textContent = anchor.label
  selectedKind.textContent = `${anchor.kind}${anchor.required ? ' · required' : ''}`
  selectedKind.className = `badge${isCaptured(anchor) ? ' captured' : ''}`
  selectedHint.textContent = anchor.hint
  positionOutput.textContent = isCaptured(anchor) ? anchor.position.join('  ') : 'not captured'
  anglesOutput.textContent = isCaptured(anchor) ? anchor.angles.join('  ') : 'not captured'
  notesInput.value = anchor.notes || ''
  captureButton.disabled = false
  teleportButton.disabled = !isCaptured(anchor)
  removeCustomButton.disabled = anchor.kind !== 'custom' && !isCaptured(anchor)
  removeCustomButton.textContent =
    anchor.kind === 'custom' ? 'Delete custom anchor' : 'Clear saved coordinates'
}

function selectAnchor(id) {
  selectedId = id
  resultOutput.textContent = ''
  resultOutput.className = 'capture-result'
  render()
}

function validateManifest() {
  const errors = []
  for (const anchor of Object.values(manifest.anchors)) {
    if (!isCaptured(anchor)) {
      if (anchor.required) errors.push(`Missing required anchor: ${anchor.label}`)
      continue
    }
    if (
      anchor.position.some((value) => !Number.isFinite(value)) ||
      anchor.angles.some((value) => !Number.isFinite(value))
    ) {
      errors.push(`Invalid numeric values: ${anchor.label}`)
    }
  }
  return errors
}

async function captureSelected() {
  if (!selectedId) return
  debugLog('capture-start', {
    map: manifest.map,
    anchor: selectedId,
    telnet: `${netconHost}:${netconPort}`
  })
  resultOutput.className = 'capture-result'
  resultOutput.textContent = 'Reading current camera position...'
  captureButton.disabled = true
  teleportButton.disabled = true
  statusOutput.classList.remove('error')
  statusOutput.innerHTML =
    '<span class="status-dot"></span>Reading current camera position through CS2 Telnet'

  try {
    const anchor = manifest.anchors[selectedId]
    if (!anchor) throw new Error('The selected anchor is not available on the selected map.')
    const captured = await window.aerial.capturePose(getNetconOptions())
    anchor.position = captured.pose.position
    anchor.angles = captured.pose.angles
    anchor.raw = captured.raw
    anchor.capturedAt = new Date().toISOString()
    anchor.source = 'cs2-netcon-getpos'
    anchor.notes = notesInput.value.trim()
    saveDraft()
    statusOutput.innerHTML =
      '<span class="status-dot"></span>CS2 Telnet connected, capture succeeded'
    resultOutput.textContent = `Captured ${anchor.label}. Position and angles were saved locally.`
    debugLog('capture-success', {
      map: manifest.map,
      anchor: anchor.id,
      diagnostic: captured.diagnostic
    })
  } catch (error) {
    debugLog('capture-failed', {
      map: manifest.map,
      anchor: selectedId,
      error: error instanceof Error ? error.message : String(error),
      diagnostic: error?.diagnostic || null
    })
    statusOutput.classList.add('error')
    statusOutput.innerHTML = '<span class="status-dot"></span>Capture failed'
    resultOutput.className = 'capture-result error'
    resultOutput.textContent = error instanceof Error ? error.message : String(error)
  } finally {
    render()
  }
}

async function teleportSelected() {
  if (!selectedId) return
  const selectedAnchor = manifest.anchors[selectedId]
  if (!isCaptured(selectedAnchor)) return

  resultOutput.className = 'capture-result'
  resultOutput.textContent = `Teleporting to ${selectedAnchor.label}...`
  teleportButton.disabled = true
  captureButton.disabled = true
  statusOutput.classList.remove('error')
  statusOutput.innerHTML = '<span class="status-dot"></span>Sending anchor through CS2 Telnet'
  debugLog('teleport-start', {
    map: manifest.map,
    anchor: selectedId,
    telnet: `${netconHost}:${netconPort}`
  })

  try {
    const anchor = manifest.anchors[selectedId]
    if (!isCaptured(anchor)) throw new Error('This anchor is not captured on the selected map.')
    const result = await window.aerial.teleportPose({
      options: getNetconOptions(),
      pose: { position: anchor.position, angles: anchor.angles }
    })
    if (!result?.acknowledged)
      throw new Error('CS2 Telnet did not acknowledge the teleport command.')
    statusOutput.innerHTML =
      '<span class="status-dot"></span>CS2 Telnet connected, teleport succeeded'
    resultOutput.textContent = `Teleported to ${anchor.label}. The selected map is ${manifest.map}.`
    debugLog('teleport-success', {
      map: manifest.map,
      anchor: anchor.id,
      diagnostic: result
    })
  } catch (error) {
    debugLog('teleport-failed', {
      map: manifest.map,
      anchor: selectedId,
      error: error instanceof Error ? error.message : String(error)
    })
    statusOutput.classList.add('error')
    statusOutput.innerHTML = '<span class="status-dot"></span>Teleport failed'
    resultOutput.className = 'capture-result error'
    resultOutput.textContent = error instanceof Error ? error.message : String(error)
  } finally {
    render()
  }
}

async function detectAndSelectCurrentMap({
  quiet = false,
  preserveAnchorId = selectedId,
  adopt = true
} = {}) {
  const response = await window.aerial.detectMap()
  lastMapDetection = response
  debugLog('map-detection', { response })
  const detectedMap = response?.map
  if (!detectedMap) {
    if (!quiet) {
      throw new Error(
        `Could not read the current CS2 map from JTs-Hud GSI. ${response?.errors?.join(' | ') || 'No GSI response yet.'}`
      )
    }
    return null
  }

  const option = [...mapInput.options].find((item) => item.value === detectedMap)
  if (!option) throw new Error(`Detected unsupported map: ${detectedMap}`)

  if (adopt && mapInput.value !== detectedMap) {
    mapInput.value = detectedMap
    manifest = await loadDraft(detectedMap)
    selectedId = manifest.anchors[preserveAnchorId]
      ? preserveAnchorId
      : Object.keys(manifest.anchors)[0] || null
    render()
    await refreshHlaeCampaths()
    await suggestHlaeName()
  }
  return detectedMap
}

function addCustomAnchor() {
  const raw = $('custom-anchor')
    .value.trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
  if (!raw || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(raw)) {
    resultOutput.className = 'capture-result error'
    resultOutput.textContent = 'Use a custom name starting with a-z or 0-9.'
    return
  }
  if (manifest.anchors[raw]) {
    selectAnchor(raw)
    return
  }
  manifest.anchors[raw] = {
    id: raw,
    label: raw.replace(/[_-]+/g, ' '),
    kind: 'custom',
    required: false,
    hint: 'Custom map-specific camera anchor.'
  }
  $('custom-anchor').value = ''
  selectedId = raw
  saveDraft()
  render()
}

function removeSelectedAnchorData() {
  const anchor = selectedId ? manifest.anchors[selectedId] : null
  if (!anchor) return

  if (anchor.kind !== 'custom') {
    if (!isCaptured(anchor) && !anchor.notes?.trim()) return
    if (!window.confirm(`Clear saved coordinates for "${anchor.label}"?`)) return

    const { name, label, kind, required, hint } = anchor
    manifest.anchors[selectedId] = { name, label, kind, required, hint }
    saveDraft()
    resultOutput.className = 'capture-result'
    resultOutput.textContent = `Cleared saved coordinates for ${label}.`
    render()
    return
  }

  if (!window.confirm(`Delete custom anchor "${anchor.label}"?`)) return

  const removedLabel = anchor.label
  delete manifest.anchors[selectedId]
  selectedId = manifest.anchors.t_spawn ? 't_spawn' : Object.keys(manifest.anchors)[0] || null
  saveDraft()
  resultOutput.className = 'capture-result'
  resultOutput.textContent = `Deleted custom anchor ${removedLabel}.`
  render()
}

function hasExportableData(candidate) {
  return Object.values(candidate.anchors || {}).some(
    (anchor) => isCaptured(anchor) || Boolean(anchor.notes?.trim())
  )
}

async function collectExportManifests() {
  const manifests = {}
  for (const option of mapInput.options) {
    const candidate = option.value === manifest.map ? manifest : await loadDraft(option.value)
    if (candidate.map === manifest.map || hasExportableData(candidate))
      manifests[candidate.map] = candidate
  }
  return manifests
}

async function exportManifest() {
  const errors = validateManifest()
  if (errors.length) {
    resultOutput.className = 'capture-result error'
    resultOutput.textContent = errors.join('\n')
    return
  }
  try {
    const manifests = await collectExportManifests()
    const bundle = await window.aerial.createBundle(manifests)
    const response = await window.aerial.exportManifest({
      map: manifest.map,
      manifest,
      manifests,
      bundle
    })
    if (!response.canceled) {
      resultOutput.className = 'capture-result'
      resultOutput.textContent = `Verified Aerial bundle exported (${Object.keys(manifests).length} maps):\n${response.filePath}`
    }
  } catch (error) {
    resultOutput.className = 'capture-result error'
    resultOutput.textContent = error instanceof Error ? error.message : String(error)
  }
}

async function refreshHlaeCampaths() {
  try {
    const files = await window.aerial.listHlaeCampaths(mapInput.value)
    hlaeList.replaceChildren()
    if (!files.length) {
      hlaeList.innerHTML = '<span class="muted">No campaths saved yet.</span>'
      return
    }
    for (const file of files) {
      const item = document.createElement('div')
      item.className = 'hlae-file'
      const name = document.createElement('strong')
      name.textContent = `${file.label || file.name}.xml`
      const details = document.createElement('span')
      details.textContent = `${file.name}.xml · ${Math.ceil(file.size / 1024)} KB`
      const actions = document.createElement('span')
      actions.className = 'hlae-file-actions'
      const loadButton = document.createElement('button')
      loadButton.className = 'button secondary'
      loadButton.textContent = 'Load into HLAE'
      loadButton.addEventListener('click', () => loadHlaeCampath(file.name))
      const deleteButton = document.createElement('button')
      deleteButton.className = 'button danger'
      deleteButton.textContent = 'Delete'
      deleteButton.addEventListener('click', () => deleteHlaeCampath(file.name))
      actions.append(loadButton, deleteButton)
      item.append(name, details, actions)
      hlaeList.append(item)
    }
  } catch (error) {
    hlaeResult.className = 'capture-result error'
    hlaeResult.textContent = error instanceof Error ? error.message : String(error)
  }
}

async function suggestHlaeName() {
  if (hlaePresetInput.value === 'custom') {
    if (hlaeNameInput.value === suggestedHlaeName) hlaeNameInput.value = ''
    suggestedHlaeName = ''
    return
  }
  const mapName = mapInput.value.replace(/^de_/, '')
  const prefix = `${mapName}_${hlaePresetInput.value}`
  const files = await window.aerial.listHlaeCampaths(mapInput.value)
  const used = new Set(files.map((file) => file.name))
  const previousSuggestion = suggestedHlaeName
  let variant = 1
  while (used.has(`${prefix}_${String(variant).padStart(2, '0')}`)) variant += 1
  suggestedHlaeName = `${prefix}_${String(variant).padStart(2, '0')}`
  if (!hlaeNameInput.value || hlaeNameInput.value === previousSuggestion) {
    hlaeNameInput.value = suggestedHlaeName
  }
}

async function saveHlaeCampath() {
  const name = hlaeNameInput.value.trim()
  if (!name) {
    hlaeResult.className = 'capture-result error'
    hlaeResult.textContent = 'Enter a campath name first.'
    return
  }
  hlaeSaveButton.disabled = true
  hlaeResult.className = 'capture-result'
  hlaeResult.textContent = `Saving ${name}.xml through HLAE...`
  try {
    const saved = await window.aerial.saveHlaeCampath({
      map: mapInput.value,
      name,
      preset: hlaePresetInput.value,
      label: hlaePresetInput.options[hlaePresetInput.selectedIndex].text,
      sourceDirectory: hlaeSourceInput.value.trim(),
      ...getNetconOptions()
    })
    hlaeResult.textContent = `Saved ${saved.name}.xml for ${saved.map}.`
    hlaeNameInput.value = ''
    await refreshHlaeCampaths()
  } catch (error) {
    hlaeResult.className = 'capture-result error'
    hlaeResult.textContent = error instanceof Error ? error.message : String(error)
  } finally {
    hlaeSaveButton.disabled = false
  }
}

async function loadHlaeCampath(name) {
  hlaeResult.className = 'capture-result'
  hlaeResult.textContent = `Loading ${name}.xml into HLAE...`
  try {
    await window.aerial.loadHlaeCampath({
      map: mapInput.value,
      name,
      sourceDirectory: hlaeSourceInput.value.trim(),
      ...getNetconOptions()
    })
    hlaeResult.textContent = `Loaded ${name}.xml into HLAE.`
  } catch (error) {
    hlaeResult.className = 'capture-result error'
    hlaeResult.textContent = error instanceof Error ? error.message : String(error)
  }
}

async function deleteHlaeCampath(name) {
  if (!window.confirm(`Delete ${name}.xml from the HLAE library?`)) return
  try {
    await window.aerial.deleteHlaeCampath({ map: mapInput.value, name })
    hlaeResult.className = 'capture-result'
    hlaeResult.textContent = `Deleted ${name}.xml from the library.`
    await refreshHlaeCampaths()
  } catch (error) {
    hlaeResult.className = 'capture-result error'
    hlaeResult.textContent = error instanceof Error ? error.message : String(error)
  }
}

async function importHlaeCampath() {
  try {
    const imported = await window.aerial.importHlaeCampath({
      map: mapInput.value,
      name: hlaeNameInput.value.trim(),
      preset: hlaePresetInput.value,
      label: hlaePresetInput.options[hlaePresetInput.selectedIndex].text
    })
    if (imported.canceled) return
    hlaeResult.className = 'capture-result'
    hlaeResult.textContent = `Imported ${imported.name}.xml for ${imported.map}.`
    await refreshHlaeCampaths()
    await suggestHlaeName()
  } catch (error) {
    hlaeResult.className = 'capture-result error'
    hlaeResult.textContent = error instanceof Error ? error.message : String(error)
  }
}

async function exportHlaeCampaths() {
  try {
    const response = await window.aerial.exportHlaeCampaths()
    if (!response.canceled) {
      hlaeResult.className = 'capture-result'
      hlaeResult.textContent = `Exported ${response.count} XML file(s) to ${response.filePath}`
    }
  } catch (error) {
    hlaeResult.className = 'capture-result error'
    hlaeResult.textContent = error instanceof Error ? error.message : String(error)
  }
}

async function importManifest() {
  try {
    const response = await window.aerial.importManifest()
    if (response.canceled) return
    const imported = response.manifest
    let importedManifests
    if (await window.aerial.isBundle(imported)) {
      importedManifests = await window.aerial.getBundleManifests(imported)
    } else if (imported?.schemaVersion === 1 && imported.map && imported.anchors) {
      importedManifests = { [imported.map]: imported }
    } else {
      throw new Error('This file is not a compatible Aerial manifest or multi-map bundle.')
    }

    const supportedMaps = new Set([...mapInput.options].map((option) => option.value))
    const unsupportedMap = Object.keys(importedManifests).find((map) => !supportedMaps.has(map))
    if (unsupportedMap) throw new Error(`This bundle targets an unsupported map: ${unsupportedMap}`)

    for (const importedManifest of Object.values(importedManifests)) {
      await window.aerial.saveDraft(mergeWithCatalog(importedManifest))
    }
    const targetMap = importedManifests[mapInput.value]
      ? mapInput.value
      : Object.keys(importedManifests)[0]
    mapInput.value = targetMap
    manifest = await loadDraft(targetMap)
    selectedId = Object.keys(manifest.anchors)[0] || null
    resultOutput.className = 'capture-result'
    resultOutput.textContent = `Imported ${Object.keys(importedManifests).length} map(s) from ${response.filePath}`
    render()
  } catch (error) {
    resultOutput.className = 'capture-result error'
    resultOutput.textContent = error instanceof Error ? error.message : String(error)
  }
}

mapInput.addEventListener('change', async () => {
  manifest = await loadDraft(mapInput.value)
  selectedId = Object.keys(manifest.anchors)[0] || null
  resultOutput.textContent = ''
  render()
  await refreshHlaeCampaths()
  await suggestHlaeName()
})
notesInput.addEventListener('input', () => {
  if (selectedId && manifest.anchors[selectedId]) {
    manifest.anchors[selectedId].notes = notesInput.value
    saveDraft()
  }
})
captureButton.addEventListener('click', captureSelected)
teleportButton.addEventListener('click', teleportSelected)
$('add-custom').addEventListener('click', addCustomAnchor)
$('remove-custom').addEventListener('click', removeSelectedAnchorData)
$('custom-anchor').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') addCustomAnchor()
})
exportButton.addEventListener('click', exportManifest)
$('import-button').addEventListener('click', importManifest)
hlaeSaveButton.addEventListener('click', saveHlaeCampath)
hlaeRefreshButton.addEventListener('click', refreshHlaeCampaths)
hlaeExportButton.addEventListener('click', exportHlaeCampaths)
hlaeImportButton.addEventListener('click', importHlaeCampath)
hlaePresetInput.addEventListener('change', () => void suggestHlaeName())
detectMapButton.addEventListener('click', async () => {
  detectMapButton.disabled = true
  statusOutput.classList.remove('error')
  statusOutput.innerHTML = '<span class="status-dot"></span>Reading current map from JTs-Hud GSI'
  try {
    const detectedMap = await detectAndSelectCurrentMap()
    statusOutput.innerHTML = `<span class="status-dot"></span>JTs-Hud GSI detected: ${detectedMap}`
  } catch (error) {
    debugLog('manual-map-detection-failed', {
      error: error instanceof Error ? error.message : String(error),
      response: lastMapDetection
    })
    statusOutput.classList.add('error')
    statusOutput.innerHTML = '<span class="status-dot"></span>Map detection failed'
    resultOutput.className = 'capture-result error'
    resultOutput.textContent = error instanceof Error ? error.message : String(error)
  } finally {
    detectMapButton.disabled = false
  }
})

async function initialize() {
  await syncTelnetSettings()
  manifest = await loadDraft(mapInput.value)
  selectedId = 't_spawn'
  render()
  debugLog('startup', {
    selectedMap: mapInput.value,
    telnet: `${netconHost}:${netconPort}`,
    gsi: 'JTs-Hud listener at http://127.0.0.1:23415/cs2/state'
  })
  try {
    const detectedMap = await detectAndSelectCurrentMap({ quiet: true })
    if (detectedMap) {
      statusOutput.innerHTML = `<span class="status-dot"></span>JTs-Hud GSI detected: ${detectedMap}`
    } else {
      statusOutput.innerHTML = '<span class="status-dot"></span>Waiting for JTs-Hud GSI state'
    }
  } catch (error) {
    debugLog('startup-map-detection-failed', {
      error: error instanceof Error ? error.message : String(error),
      response: lastMapDetection
    })
  }
  await refreshHlaeCampaths()
  await suggestHlaeName()
}

clearDebugButton.addEventListener('click', () => {
  debugLogOutput.textContent = 'Diagnostics cleared.'
})
copyDebugButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(debugLogOutput.textContent)
    debugLog('debug-copied')
  } catch (error) {
    debugLog('debug-copy-failed', { error: error instanceof Error ? error.message : String(error) })
  }
})

void initialize()
