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
  model: {
    tree_info: Array<{ tree_structure: LightGbmNode }>
  }
}

const numericThreshold = (value: number | string | undefined): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid LightGBM threshold: ${String(value)}`)
  return parsed
}

export class LightGbmRanker {
  readonly featureNames: readonly string[]
  private readonly trees: readonly LightGbmNode[]

  constructor(document: LightGbmModelDocument) {
    if (document.schemaVersion !== 1 || document.kind !== 'lightgbm-lambdarank') {
      throw new Error('Unsupported Auto Director model schema')
    }
    if (!document.featureNames.length || !document.model?.tree_info?.length) {
      throw new Error('Auto Director model has no features or trees')
    }
    this.featureNames = document.featureNames
    this.trees = document.model.tree_info.map((tree) => tree.tree_structure)
  }

  predict(features: readonly number[]): number {
    if (features.length !== this.featureNames.length) {
      throw new Error(
        `Auto Director model expected ${this.featureNames.length} features, received ${features.length}`
      )
    }
    return this.trees.reduce((total, tree) => total + this.walk(tree, features), 0)
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

export const loadLightGbmRanker = (modelPath: string): LightGbmRanker => {
  const document = JSON.parse(fs.readFileSync(modelPath, 'utf8')) as LightGbmModelDocument
  return new LightGbmRanker(document)
}
