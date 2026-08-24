/** Type surface for the hand-written simulation engine in `lib/sim.js`. */

export const EMPTY: 0
export const FOOD: 1
export const POISON: 2
export const AGENT: 3
export const SUPERFOOD: 5

export interface Genome {
  diet: number
  mrate: number
  W: Float32Array
}

export interface Agent {
  uid: number
  i: number
  j: number
  age: number
  health: number
  maxHealth: number
  genome: Genome
  generation: number
  lineage: number
  parentUid: number | null
  eaten: number
  poisoned: number
  superEaten: number
  kills: number
  offspring: number
  bornTick: number
  killed?: boolean
  dead?: boolean
}

export interface Rng {
  (): number
  int(n: number): number
  pick<T>(arr: T[]): T
  norm(): number
}

export interface WorldOptions {
  width?: number
  height?: number
  maxAgents?: number
  families?: number
  carnFamilies?: number
  mutation?: number
  foodDensity?: number
  poisonDensity?: number
  foundersPerFamily?: number
  brainmode?: 'neuro' | 'instinct'
  rng?: Rng
  champions?: { herb: Genome[]; carn: Genome[] }
}

export class World {
  constructor(opts?: WorldOptions)
  width: number
  height: number
  maxAgents: number
  mutSigma: number
  brainmode: 'neuro' | 'instinct'
  champions: { herb: Genome[]; carn: Genome[] }
  cell: Int8Array
  agents: Agent[]
  tick: number
  births: number
  deaths: number
  rescues: number
  immigrations: number
  maxGeneration: number
  best: {
    score: number
    age: number
    generation: number
    offspring: number
    eaten: number
    kills: number
    diet: number
    carn: boolean
    color: string
    tick: number
  } | null
  step(): Agent[]
  reset(): void
  counts(): { herbivores: number; carnivores: number }
  dietHistogram(bins: number): number[]
  scatter(type: number, count: number): void
}

export function makeRng(seed?: number): Rng
export function genomeFromJSON(d: unknown, rng: Rng): Genome
export function colorFor(g: Genome): string
export function isCarnivore(g: Genome): boolean
export function fitness(a: Agent): number
export function capacity(diet: number): number
