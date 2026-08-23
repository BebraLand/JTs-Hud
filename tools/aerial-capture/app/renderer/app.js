const STANDARD_ANCHORS = [
  { id: 't_spawn', label: 'T Spawn', kind: 'spawn', required: true, hint: 'Wide, readable overview of the attacking spawn.' },
  { id: 'ct_spawn', label: 'CT Spawn', kind: 'spawn', required: true, hint: 'Wide, readable overview of the defending spawn.' },
  { id: 'mid', label: 'Mid', kind: 'mid', required: true, hint: 'The most useful central route overview.' },
  { id: 'a_main', label: 'A Main / Approach', kind: 'route', required: false, hint: 'Show the entry portal and the first fight space.' },
  { id: 'a_site', label: 'A Site', kind: 'site', required: true, hint: 'Wide site view with plant and contest visibility.' },
  { id: 'b_main', label: 'B Main / Approach', kind: 'route', required: false, hint: 'Show the entry portal and the first fight space.' },
  { id: 'b_site', label: 'B Site', kind: 'site', required: true, hint: 'Wide site view with plant and contest visibility.' },
  { id: 'long', label: 'Long', kind: 'route', required: false, hint: 'Long lane or its closest equivalent.' },
  { id: 'short', label: 'Short', kind: 'route', required: false, hint: 'Short lane or its closest equivalent.' },
  { id: 'a_postplant', label: 'A Post-plant', kind: 'postplant', required: false, hint: 'Show bomb and main retake lanes.' },
  { id: 'b_postplant', label: 'B Post-plant', kind: 'postplant', required: false, hint: 'Show bomb and main retake lanes.' },
  { id: 'wide_overview', label: 'Map Wide Overview', kind: 'custom', required: false, hint: 'High-level shot for round transitions.' }
]

const $ = (id) => document.getElementById(id)
const hostInput = $('host')
const portInput = $('port')
const mapInput = $('map')
const list = $('anchor-list')
const selectedLabel = $('selected-label')
const selectedKind = $('selected-kind')
const selectedHint = $('selected-hint')
const positionOutput = $('position')
const anglesOutput = $('angles')
const notesInput = $('notes')
const captureButton = $('capture-button')
const resultOutput = $('capture-result')
const statusOutput = $('connection-status')
const progressOutput = $('progress')
const exportButton = $('export-button')
let selectedId = null
let manifest = createManifest(mapInput.value)

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
}

function loadDraft(map) {
  try {
    const saved = localStorage.getItem(draftKey(map))
    if (!saved) return createManifest(map)
    const parsed = JSON.parse(saved)
    if (parsed.schemaVersion !== 1 || parsed.map !== map || !parsed.anchors) return createManifest(map)
    return mergeWithCatalog(parsed)
  } catch {
    return createManifest(map)
  }
}

function mergeWithCatalog(input) {
  const next = { ...input, anchors: { ...input.anchors } }
  for (const spec of STANDARD_ANCHORS) {
    next.anchors[spec.id] = { ...spec, ...(next.anchors[spec.id] || {}) }
  }
  return next
}

function isCaptured(anchor) {
  return Array.isArray(anchor.position) && anchor.position.length === 3 && Array.isArray(anchor.angles) && anchor.angles.length === 3
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
    selectedHint.textContent = 'Choose an anchor from the checklist. The tool will read the current observer camera through NetCon.'
    positionOutput.textContent = 'not captured'
    anglesOutput.textContent = 'not captured'
    notesInput.value = ''
    captureButton.disabled = true
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
    if (anchor.position.some((value) => !Number.isFinite(value)) || anchor.angles.some((value) => !Number.isFinite(value))) {
      errors.push(`Invalid numeric values: ${anchor.label}`)
    }
  }
  return errors
}

async function captureSelected() {
  if (!selectedId) return
  const anchor = manifest.anchors[selectedId]
  resultOutput.className = 'capture-result'
  resultOutput.textContent = 'Reading current camera position...'
  captureButton.disabled = true
  statusOutput.classList.remove('error')
  statusOutput.innerHTML = '<span class="status-dot"></span>Reading CS2 camera'

  try {
    const captured = await window.aerial.capturePose({ host: hostInput.value.trim(), port: Number(portInput.value) })
    anchor.position = captured.pose.position
    anchor.angles = captured.pose.angles
    anchor.raw = captured.raw
    anchor.capturedAt = new Date().toISOString()
    anchor.source = 'cs2-netcon-getpos'
    anchor.notes = notesInput.value.trim()
    saveDraft()
    statusOutput.innerHTML = '<span class="status-dot"></span>Connected, last capture succeeded'
    resultOutput.textContent = `Captured ${anchor.label}. Position and angles were saved to the local draft.`
  } catch (error) {
    statusOutput.classList.add('error')
    statusOutput.innerHTML = '<span class="status-dot"></span>Capture failed'
    resultOutput.className = 'capture-result error'
    resultOutput.textContent = error instanceof Error ? error.message : String(error)
  } finally {
    captureButton.disabled = false
    render()
  }
}

function addCustomAnchor() {
  const raw = $('custom-anchor').value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_')
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

async function exportManifest() {
  const errors = validateManifest()
  if (errors.length) {
    resultOutput.className = 'capture-result error'
    resultOutput.textContent = errors.join('\n')
    return
  }
  const response = await window.aerial.exportManifest({ map: manifest.map, manifest })
  if (!response.canceled) {
    resultOutput.className = 'capture-result'
    resultOutput.textContent = `Verified manifest exported:\n${response.filePath}`
  }
}

async function importManifest() {
  try {
    const response = await window.aerial.importManifest()
    if (response.canceled) return
    if (!response.manifest || response.manifest.schemaVersion !== 1 || !response.manifest.map || !response.manifest.anchors) {
      throw new Error('This file is not a compatible Aerial manifest.')
    }
    manifest = mergeWithCatalog(response.manifest)
    mapInput.value = manifest.map
    selectedId = Object.keys(manifest.anchors)[0] || null
    saveDraft()
    resultOutput.className = 'capture-result'
    resultOutput.textContent = `Imported ${response.filePath}`
    render()
  } catch (error) {
    resultOutput.className = 'capture-result error'
    resultOutput.textContent = error instanceof Error ? error.message : String(error)
  }
}

mapInput.addEventListener('change', () => {
  manifest = loadDraft(mapInput.value)
  selectedId = Object.keys(manifest.anchors)[0] || null
  resultOutput.textContent = ''
  render()
})
notesInput.addEventListener('input', () => {
  if (selectedId && manifest.anchors[selectedId]) {
    manifest.anchors[selectedId].notes = notesInput.value
    saveDraft()
  }
})
captureButton.addEventListener('click', captureSelected)
$('add-custom').addEventListener('click', addCustomAnchor)
$('custom-anchor').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') addCustomAnchor()
})
exportButton.addEventListener('click', exportManifest)
$('import-button').addEventListener('click', importManifest)

manifest = loadDraft(mapInput.value)
selectedId = 't_spawn'
render()
