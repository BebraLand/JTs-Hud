const MAP_PATTERN = /^de_[a-z0-9_]+$/
const BUNDLE_SCHEMA_VERSION = 2

const isValidManifest = (manifest, map = null) =>
  Boolean(
    manifest &&
    manifest.schemaVersion === 1 &&
    typeof manifest.map === 'string' &&
    MAP_PATTERN.test(manifest.map) &&
    (!map || manifest.map === map) &&
    manifest.anchors &&
    typeof manifest.anchors === 'object' &&
    !Array.isArray(manifest.anchors)
  )

const createAerialBundle = (manifests) => {
  const maps = {}
  for (const manifest of Object.values(manifests || {})) {
    if (!isValidManifest(manifest))
      throw new Error(`Invalid Aerial manifest: ${manifest?.map || 'unknown map'}`)
    maps[manifest.map] = manifest
  }
  return {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    coordinateSystem: 'source2-hammer-units',
    source: 'cs2-netcon-getpos',
    maps: Object.fromEntries(
      Object.entries(maps).sort(([left], [right]) => left.localeCompare(right))
    )
  }
}

const isAerialBundle = (value) =>
  Boolean(
    value &&
    value.schemaVersion === BUNDLE_SCHEMA_VERSION &&
    value.coordinateSystem === 'source2-hammer-units' &&
    value.maps &&
    typeof value.maps === 'object' &&
    !Array.isArray(value.maps) &&
    Object.entries(value.maps).length > 0 &&
    Object.entries(value.maps).every(([map, manifest]) => isValidManifest(manifest, map))
  )

const getBundleManifests = (bundle) => {
  if (!isAerialBundle(bundle)) throw new Error('Invalid Aerial bundle')
  return bundle.maps
}

module.exports = {
  BUNDLE_SCHEMA_VERSION,
  MAP_PATTERN,
  createAerialBundle,
  getBundleManifests,
  isAerialBundle,
  isValidManifest
}
