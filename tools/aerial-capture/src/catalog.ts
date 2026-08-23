import { createAnchorSpec, type AerialAnchor } from './protocol'

export const STANDARD_ANCHORS: Array<
  Omit<AerialAnchor, 'position' | 'angles' | 'capturedAt' | 'source'>
> = [
  createAnchorSpec('t_spawn', 'T Spawn', 'spawn', true, 'Wide, readable overview of the attacking spawn.'),
  createAnchorSpec('ct_spawn', 'CT Spawn', 'spawn', true, 'Wide, readable overview of the defending spawn.'),
  createAnchorSpec('mid', 'Mid', 'mid', true, 'The most useful central route overview.'),
  createAnchorSpec('a_main', 'A Main / Approach', 'route', false, 'Main approach toward A, preferably showing the entry portal.'),
  createAnchorSpec('a_site', 'A Site', 'site', true, 'Wide A-site overview with clear plant and contest visibility.'),
  createAnchorSpec('b_main', 'B Main / Approach', 'route', false, 'Main approach toward B, preferably showing the entry portal.'),
  createAnchorSpec('b_site', 'B Site', 'site', true, 'Wide B-site overview with clear plant and contest visibility.'),
  createAnchorSpec('long', 'Long', 'route', false, 'Long lane or its closest equivalent on this map.'),
  createAnchorSpec('short', 'Short', 'route', false, 'Short lane or its closest equivalent on this map.'),
  createAnchorSpec('a_postplant', 'A Post-plant', 'postplant', false, 'A post-plant angle showing the bomb and the main retake lanes.'),
  createAnchorSpec('b_postplant', 'B Post-plant', 'postplant', false, 'A post-plant angle showing the bomb and the main retake lanes.'),
  createAnchorSpec('wide_overview', 'Map Wide Overview', 'custom', false, 'A safe high-level shot for round transitions or tactical context.')
]

export const standardAnchorByName = new Map(STANDARD_ANCHORS.map((anchor) => [anchor.name, anchor]))
