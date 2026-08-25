export interface RadarMapConfig {
  mapName: string
  asset: string
  posX: number
  posY: number
  scale: number
  size: number
}

// Values come from the CS2 resource/overviews/*.txt files. The image assets are
// the same radar layers shipped with the JTs-Hud default HUD.
const RADAR_MAPS: Record<string, RadarMapConfig> = {
  de_ancient: { mapName: 'de_ancient', asset: 'radar-257c12c3.png', posX: -2953, posY: 2164, scale: 5, size: 1024 },
  de_anubis: { mapName: 'de_anubis', asset: 'radar-d6f7b7b1.png', posX: -2796, posY: 3328, scale: 5.22, size: 1024 },
  de_cache: { mapName: 'de_cache', asset: 'radar-9ed7aced.png', posX: -2000, posY: 3250, scale: 5.5, size: 1024 },
  de_dust2: { mapName: 'de_dust2', asset: 'radar-d2e673ab.png', posX: -2476, posY: 3239, scale: 4.4, size: 1024 },
  de_inferno: { mapName: 'de_inferno', asset: 'radar-230b60d6.png', posX: -2087, posY: 3870, scale: 4.9, size: 1024 },
  de_mirage: { mapName: 'de_mirage', asset: 'radar-0f6c4bb0.png', posX: -3230, posY: 1713, scale: 5, size: 1024 },
  de_nuke: { mapName: 'de_nuke', asset: 'radar-e7a6de7b.png', posX: -3453, posY: 2887, scale: 7, size: 1024 },
  de_overpass: { mapName: 'de_overpass', asset: 'radar-5ec70095.png', posX: -4831, posY: 1781, scale: 5.2, size: 1024 },
  de_train: { mapName: 'de_train', asset: 'radar-63202ed1.png', posX: -2308, posY: 2078, scale: 4.082077, size: 1024 },
  de_vertigo: { mapName: 'de_vertigo', asset: 'radar-f15cebdb.png', posX: -3168, posY: 1762, scale: 4, size: 1024 }
}

export const getRadarMapConfig = (mapName: string | null): RadarMapConfig | null => {
  if (!mapName) return null
  const normalized = mapName.trim().toLowerCase().split('/').pop()?.replace(/\.bsp$/, '') ?? ''
  return RADAR_MAPS[normalized] ?? null
}

export const worldToRadar = (
  position: readonly [number, number, number],
  config: RadarMapConfig
): [number, number] => [
  (position[0] - config.posX) / config.scale,
  (config.posY - position[1]) / config.scale
]
