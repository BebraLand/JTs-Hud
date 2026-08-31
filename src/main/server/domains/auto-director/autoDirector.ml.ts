import fs from 'node:fs'

interface LightGbmNode {
  split_feature?: number
  threshold?: number | string
  decision_type?: string
  default_left?: boolean
  left_child?: LightGbmNode
  right_child?: LightGbmNode
  leaf_value?: number
}

interface LightGbmModelDocument {
  schemaVersion: number
  kind: string
  featureNames: string[]
  model?: {
    tree_info: Array<{ tree_structure: LightGbmNode }>
  }
  models?: Array<{
    horizonMs: number
    model: { tree_info: Array<{ tree_structure: LightGbmNode }> }
  }>
}

export interface HorizonPrediction {
  horizonMs: number
  raw: number
  probability: number
}

const numericThreshold = (value: number | string | undefined): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid LightGBM threshold: ${String(value)}`)
  return parsed
}

export class LightGbmRanker {
  readonly featureNames: readonly string[]
  private readonly trees: readonly LightGbmNode[] | null
  private readonly horizonTrees: ReadonlyArray<{
    horizonMs: number
    trees: readonly LightGbmNode[]
  }>

  constructor(document: LightGbmModelDocument) {
    const legacy = document.schemaVersion === 1 && document.kind === 'lightgbm-lambdarank'
    const multiHorizon =
      document.schemaVersion === 2 && document.kind === 'lightgbm-multihorizon-binary'
    if (!legacy && !multiHorizon) {
      throw new Error('Unsupported Auto Director model schema')
    }
    if (!document.featureNames.length) {
      throw new Error('Auto Director model has no features or trees')
    }
    this.featureNames = document.featureNames
    this.trees = document.model?.tree_info?.length
      ? document.model.tree_info.map((tree) => tree.tree_structure)
      : null
    this.horizonTrees = (document.models ?? []).map((entry) => ({
      horizonMs: entry.horizonMs,
      trees: entry.model.tree_info.map((tree) => tree.tree_structure)
    }))
    if (!this.trees && !this.horizonTrees.length) {
      throw new Error('Auto Director model has no features or trees')
    }
  }

  predict(features: readonly number[]): number {
    this.validateFeatures(features)
    if (this.trees) return this.score(this.trees, features)
    const predictions = this.predictHorizons(features)
    return predictions.reduce((best, prediction) => Math.max(best, prediction.probability), 0)
  }

  predictHorizons(features: readonly number[]): readonly HorizonPrediction[] {
    this.validateFeatures(features)
    return this.horizonTrees.map(({ horizonMs, trees }) => {
      const raw = this.score(trees, features)
      return { horizonMs, raw, probability: 1 / (1 + Math.exp(-raw)) }
    })
  }

  private validateFeatures(features: readonly number[]): void {
    if (features.length !== this.featureNames.length)
      throw new Error(
        `Auto Director model expected ${this.featureNames.length} features, received ${features.length}`
      )
  }

  private score(trees: readonly LightGbmNode[], features: readonly number[]): number {
    return trees.reduce((total, tree) => total + this.walk(tree, features), 0)
  }

  private walk(node: LightGbmNode, features: readonly number[]): number {
    if (node.leaf_value !== undefined) return Number(node.leaf_value)
    if (node.split_feature === undefined || !node.left_child || !node.right_child) {
      throw new Error('Malformed LightGBM tree node')
    }
    const value = features[node.split_feature]
    const missing = !Number.isFinite(value)
    const goesLeft = missing
      ? node.default_left !== false
      : node.decision_type === '<='
        ? value <= numericThreshold(node.threshold)
        : value < numericThreshold(node.threshold)
    return this.walk(goesLeft ? node.left_child : node.right_child, features)
  }
}

export const autoDirectorMlAdvisory = (
  ranker: LightGbmRanker,
  features: readonly number[]
): { value: number; detail: string } => {
  const horizons = ranker.predictHorizons(features)
  if (!horizons.length) {
    const raw = ranker.predict(features)
    return { value: Math.tanh(raw) * 8, detail: `ML ${raw >= 0 ? '+' : ''}${raw.toFixed(2)}` }
  }
  const weight = (horizonMs: number): number =>
    horizonMs <= 500 ? 1 : horizonMs <= 1_000 ? 0.9 : horizonMs <= 2_000 ? 0.65 : 0.45
  const urgency = Math.max(...horizons.map((item) => item.probability * weight(item.horizonMs)))
  return {
    value: Math.max(-4, Math.min(18, (urgency - 0.08) * 24)),
    detail: horizons
      .map((item) => `${item.horizonMs / 1_000}s ${(item.probability * 100).toFixed(0)}%`)
      .join('; ')
  }
}

export const loadLightGbmRanker = (modelPath: string): LightGbmRanker => {
  const document = JSON.parse(fs.readFileSync(modelPath, 'utf8')) as LightGbmModelDocument
  return new LightGbmRanker(document)
}
