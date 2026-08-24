/**
 * Evolvarium — the simulation, ported to the browser.
 *
 * This is a faithful port of the Python world in `web/`: the same grid rules,
 * the same 153-value observation, the same instinct-plus-evolved-residual brain,
 * and the same selection rules (earned reproduction, diet-dependent nutrition,
 * inheritance from the real parent, rescue and immigration).
 *
 * It has no DOM dependencies, so it runs in a browser, a worker, or Node.
 *
 * Why a port at all: the Python version is one shared world stepping in a
 * background thread. Static hosts have no background thread and no shared
 * memory between requests, so the world has to live where the viewer lives.
 * Running it here also means every visitor gets their own world instead of
 * fighting over one set of global controls.
 */

// ---------------------------------------------------------------- constants --
export const EMPTY = 0, FOOD = 1, POISON = 2, AGENT = 3, SUPERFOOD = 5;

export const START_HEALTH = 200, MAX_AGE = 50, METABOLISM = 10;

// How much health a creature can bank. A kill is worth far more than a plant,
// so with one capacity for everyone a predator threw most of a carcass away
// against the health ceiling and its real income was a fraction of what the
// food chain promised. Predators gorge and then fast; grazers top up constantly.
export const BASE_HEALTH = 200, GORGE_CAPACITY = 120;
export const capacity = diet => Math.round(BASE_HEALTH + GORGE_CAPACITY * diet);

// The food chain. A plant is nearly worthless to a specialist predator and a
// kill is nearly worthless to a grazer, so specialising pays and a diet stuck
// halfway is the worst of both — that is what splits the population in two.
export const PLANT_NUTRITION = 50, MEAT_NUTRITION = 170, POISON_DAMAGE = 40,
             DIET_PENALTY = 0.85;

// Reproduction is earned: it needs health and it costs health.
export const REPRO_MIN_AGE = 5, REPRO_MIN_HEALTH = 0.50, REPRO_COST = 50,
             NEWBORN_HEALTH = 110, REPRO_MAX_CHANCE = 0.30, MATE_CHANCE = 0.65;

// Plants regrow toward a density, so grazing really depletes a patch.
export const FOOD_DENSITY = 0.16, POISON_DENSITY = 0.035, REGROW_PER_TICK = 14;

// Random founders are a rescue, not a subsidy.
export const RESCUE_FRACTION = 0.06, RESCUE_MIN = 4, FOUNDERS_PER_FAMILY = 5;

// A lost way of life is eventually repopulated from elsewhere.
export const NICHE_ABSENT_TICKS = 150, NICHE_MIN = 2, IMMIGRANTS = 5;

// Brain shape and the bounds that keep mutation from destroying it.
export const N_IN = 26, N_H = 20, N_OUT = 8;
export const N_W = N_IN * N_H + N_H + N_H * N_OUT + N_OUT;   // 708
export const W_DECAY = 0.985, W_STEP = 0.5, W_CLIP = 2.5, RESIDUAL_GAIN = 2.5;
export const MRATE_MIN = 0.15, MRATE_MAX = 2.5;

const FOV = 7, C = 3;
const DIRV = [[-1, 0], [0, 1], [1, 0], [0, -1]];    // up, right, down, left
const NB_IDX = DIRV.map(([dy, dx]) => (C + dy) * FOV + (C + dx));

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const clip01 = x => clamp(x, 0, 1);

// -------------------------------------------------------------------- random --
/** Seeded PRNG (mulberry32) so a run can be reproduced exactly in tests. */
export function makeRng(seed = (Math.random() * 2 ** 32) >>> 0) {
  let a = seed >>> 0, spare = null;
  const next = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = n => Math.floor(next() * n);
  next.pick = arr => arr[Math.floor(next() * arr.length)];
  next.gauss = () => {                       // Box-Muller, one spare cached
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0, v = 0;
    while (u === 0) u = next();
    while (v === 0) v = next();
    const r = Math.sqrt(-2 * Math.log(u)), th = 2 * Math.PI * v;
    spare = r * Math.sin(th);
    return r * Math.cos(th);
  };
  return next;
}

// ------------------------------------------------------------------- genomes --
export function seedGenome(role, rng) {
  const carn = role === 'carn';
  return {
    diet: clip01((carn ? 0.85 : 0.15) + rng.gauss() * 0.05),
    aggr: clip01((carn ? 0.80 : 0.25) + rng.gauss() * 0.10),
    vision: 3,
    mrate: clamp(1.0 + rng.gauss() * 0.2, MRATE_MIN, MRATE_MAX),
    W: randomWeights(rng),
  };
}

function randomWeights(rng) {
  const W = new Float32Array(N_W);
  for (let i = 0; i < N_W; i++) W[i] = rng.gauss() * 0.05;
  return W;
}

/**
 * One generation of weight mutation. Undirected drift would grow without bound
 * and the evolved residual would swamp the instinct it is meant to refine, so
 * weights decay slightly toward zero (an Ornstein-Uhlenbeck pull) and are
 * clipped. Lineages that evolve for a long time stay competent.
 */
function drift(W, sigma, rng) {
  const out = new Float32Array(N_W);
  const s = sigma * W_STEP;
  for (let i = 0; i < N_W; i++) out[i] = clamp(W[i] * W_DECAY + rng.gauss() * s, -W_CLIP, W_CLIP);
  return out;
}

export function mutate(g, sigma, rng) {
  const m = g.mrate ?? 1.0, s = sigma * m;
  return {
    diet: clip01(g.diet + rng.gauss() * s),
    aggr: clip01(g.aggr + rng.gauss() * s),
    vision: clamp(Math.round(g.vision + rng.gauss() * s * 3), 1, 3),
    mrate: clamp(m * Math.exp(rng.gauss() * 0.12), MRATE_MIN, MRATE_MAX),
    W: drift(g.W || randomWeights(rng), s, rng),
  };
}

/** Sexual reproduction: uniform crossover of the weights, blended traits. */
export function breed(g1, g2, sigma, rng) {
  const t = rng();
  const mrate = clamp((g1.mrate ?? 1) * t + (g2.mrate ?? 1) * (1 - t), MRATE_MIN, MRATE_MAX);
  const W = new Float32Array(N_W), w1 = g1.W, w2 = g2.W;
  for (let i = 0; i < N_W; i++) W[i] = rng() < 0.5 ? w1[i] : w2[i];
  return {
    diet: clip01(g1.diet * t + g2.diet * (1 - t)),
    aggr: clip01(g1.aggr * t + g2.aggr * (1 - t)),
    vision: rng() < 0.5 ? g1.vision : g2.vision,
    mrate,
    W: drift(W, sigma * mrate, rng),
  };
}

export const isCarnivore = g => g.diet >= 0.5;

/** Herbivores cool, carnivores warm; plants are green, so the three are easy to
 *  tell apart while diet still reads as a gradient inside each role. */
export function colorFor(g) {
  const d = g.diet;
  if (d < 0.5) {
    const t = d / 0.5;
    return `rgb(${Math.round(52 + 38 * t)},${Math.round(226 - 76 * t)},255)`;
  }
  const t = (d - 0.5) / 0.5;
  return `rgb(255,${Math.round(184 - 124 * t)},${Math.round(80 - 32 * t)})`;
}

export function genomeToJSON(g) {
  return {
    diet: +g.diet.toFixed(5), aggr: +g.aggr.toFixed(5), vision: g.vision,
    mrate: +(g.mrate ?? 1).toFixed(4), W: Array.from(g.W, x => +x.toFixed(4)),
  };
}

/** Tolerates older saved brains: a stale weight vector is padded, not rejected. */
export function genomeFromJSON(d, rng) {
  const W = new Float32Array(N_W);
  const src = d.W || [];
  for (let i = 0; i < N_W; i++) {
    W[i] = i < src.length ? clamp(src[i], -W_CLIP, W_CLIP) : rng.gauss() * 0.05;
  }
  return {
    diet: clip01(d.diet ?? 0.2), aggr: clip01(d.aggr ?? 0.4),
    vision: clamp(Math.round(d.vision ?? 3), 1, 3),
    mrate: clamp(d.mrate ?? 1.0, MRATE_MIN, MRATE_MAX), W,
  };
}

// -------------------------------------------------------------------- brains --
function nearestInFov(arr, off, test) {
  let best = 0, bd = 99, found = false;
  for (let k = 0; k < 49; k++) {
    if (k === C * FOV + C || !test(arr[off + k])) continue;
    const di = Math.abs((k / FOV | 0) - C), dj = Math.abs((k % FOV) - C);
    if (di + dj < bd) { bd = di + dj; best = k; found = true; }
  }
  if (!found) return [0, 0];
  return [((best / FOV | 0) - C) / 3, ((best % FOV) - C) / 3];
}

/** 26 inputs: bearing to the nearest plant and the nearest non-relative, what
 *  is directly adjacent, own health, diet, and a one-hot of the previous action
 *  (the creature's entire short-term memory). */
export function features(state, diet, prevAction, out) {
  const f = out || new Float32Array(N_IN);
  const [fy, fx] = nearestInFov(state, 0, v => v > 0);
  const [ey, ex] = nearestInFov(state, 98, v => v === -1);
  f[0] = fx; f[1] = fy; f[2] = ex; f[3] = ey;
  for (let k = 0; k < 4; k++) {
    const idx = NB_IDX[k];
    f[4 + k] = state[idx] > 0 ? 1 : 0;
    f[8 + k] = state[98 + idx] === -1 ? 1 : 0;
    f[12 + k] = state[idx] === -1 ? 1 : 0;
  }
  f[16] = state[147]; f[17] = diet;
  for (let k = 0; k < 8; k++) f[18 + k] = 0;
  if (prevAction != null && prevAction >= 0 && prevAction < 8) f[18 + prevAction] = 1;
  return f;
}

/**
 * The hard-wired survival drive the evolved network refines.
 *
 * The bearing to a target arrives scaled by distance (a target three cells away
 * gives a component of 1.0, one cell away gives 0.33). Feeding that straight
 * into the logits made the *pursuit* drive weakest exactly when the target was
 * closest, and at roughly half a logit it was indistinguishable from noise in
 * the softmax — predators wandered instead of chasing. Direction and urgency
 * are separate things, so the direction is normalised here and the weights
 * carry the urgency.
 */
export function instinct(f, diet, out) {
  const L = out || new Float32Array(8);
  L.fill(0);
  const fd = Math.hypot(f[0], f[1]) || 1, ed = Math.hypot(f[2], f[3]) || 1;
  const fx = f[0] / fd, fy = f[1] / fd, ex = f[2] / ed, ey = f[3] / ed;
  const seesFood = f[0] || f[1], seesFoe = f[2] || f[3];
  for (let k = 0; k < 4; k++) {
    const dy = DIRV[k][0], dx = DIRV[k][1];
    L[k] = (seesFood ? (1 - diet) * 2.5 * (dx * fx + dy * fy) : 0)
         + (seesFoe ? diet * 3.5 * (dx * ex + dy * ey) : 0);
    if (f[4 + k] > 0) L[k] += (1 - diet) * 2.0;
    if (f[12 + k] > 0) L[k] -= 3.0;
    if (diet < 0.5 && seesFoe) L[k] += (1 - diet) * 1.5 * (-(dx * ex + dy * ey));
    L[4 + k] = f[8 + k] > 0 ? diet * 4.5 : 0;
  }
  return L;
}

const _h = new Float32Array(N_H);
function net(f, W, out) {
  const o = out || new Float32Array(N_OUT);
  let p = 0;
  for (let j = 0; j < N_H; j++) {
    let s = 0;
    for (let i = 0; i < N_IN; i++) s += f[i] * W[i * N_H + j];
    _h[j] = Math.tanh(s + W[N_IN * N_H + j]);
  }
  p = N_IN * N_H + N_H;
  for (let k = 0; k < N_OUT; k++) {
    let s = W[p + N_H * N_OUT + k];
    for (let j = 0; j < N_H; j++) s += _h[j] * W[p + j * N_OUT + k];
    o[k] = s;
  }
  return o;
}

const _f = new Float32Array(N_IN), _L = new Float32Array(8), _n = new Float32Array(8);

/** Instinct plus a bounded evolved residual, sampled as a soft policy. */
export function decide(state, g, prevAction, rng) {
  features(state, g.diet, prevAction, _f);
  instinct(_f, g.diet, _L);
  if (g.W) {
    net(_f, g.W, _n);
    for (let k = 0; k < 8; k++) _L[k] += RESIDUAL_GAIN * Math.tanh(_n[k]);
  }
  let max = -Infinity;
  for (let k = 0; k < 8; k++) if (_L[k] > max) max = _L[k];
  let sum = 0;
  for (let k = 0; k < 8; k++) { _n[k] = Math.exp(Math.max(_L[k] - max, -60)); sum += _n[k]; }
  if (!(sum > 0) || !Number.isFinite(sum)) return rng.int(8);
  let r = rng() * sum;
  for (let k = 0; k < 8; k++) { r -= _n[k]; if (r <= 0) return k; }
  return 7;
}

/** The instinct-only policy, for the viewer's "Neural net vs Instinct" toggle. */
export function decideInstinct(state, g, rng) {
  const vis = g.vision;
  const adjFood = [], adjEnemy = [];
  for (let k = 0; k < 4; k++) {
    const idx = NB_IDX[k];
    if (state[idx] > 0) adjFood.push([state[idx], k]);
    if (state[98 + idx] === -1) adjEnemy.push(k);
  }
  const bestFood = () => adjFood.reduce((a, b) => (b[0] > a[0] ? b : a))[1];
  const nearest = (off, test, range) => {
    let best = null, bd = 99;
    for (let k = 0; k < 49; k++) {
      if (k === C * FOV + C || !test(state[off + k])) continue;
      const di = (k / FOV | 0) - C, dj = (k % FOV) - C;
      if (Math.max(Math.abs(di), Math.abs(dj)) > range) continue;
      const d = Math.abs(di) + Math.abs(dj);
      if (d < bd) { bd = d; best = [di, dj]; }
    }
    return best;
  };
  const move = (di, dj, away) => {
    if (away) { di = -di; dj = -dj; }
    const order = Math.abs(di) >= Math.abs(dj)
      ? [di > 0 ? 2 : 0].concat(dj ? [dj > 0 ? 1 : 3] : [])
      : [dj > 0 ? 1 : 3].concat(di ? [di > 0 ? 2 : 0] : []);
    for (const d of order) if (state[NB_IDX[d]] !== -1) return d;
    return order.length ? order[0] : rng.int(4);
  };
  if (rng() < g.diet) {                                  // hunting
    if (adjEnemy.length && rng() < g.aggr) return 4 + rng.pick(adjEnemy);
    const t = nearest(98, v => v === -1, vis);
    if (t) return move(t[0], t[1], false);
    if (adjFood.length) return bestFood();
  } else {
    if (adjFood.length) return bestFood();
    const pred = nearest(98, v => v === -1, 2);
    if (pred && rng() < 1 - g.diet) return move(pred[0], pred[1], true);
    const t = nearest(0, v => v > 0, vis);
    if (t) return move(t[0], t[1], false);
  }
  return rng.int(4);
}

// ------------------------------------------------------------------- fitness --
/**
 * Lifetime reproductive success and the behaviours that produce it. This is
 * deliberately not a reinforcement-learning reward: what matters for evolution
 * is what an individual actually achieved before it died.
 */
export function fitness(a) {
  return 10 * a.offspring + a.age + 2 * a.eaten + 4 * a.kills + 5 * a.superEaten - 3 * a.poisoned;
}

// --------------------------------------------------------------------- world --
export class World {
  constructor(opts = {}) {
    this.width = opts.width ?? 34;
    this.height = opts.height ?? 34;
    this.maxAgents = opts.maxAgents ?? 140;
    this.nFamilies = opts.families ?? 6;
    this.carnFamilies = opts.carnFamilies ?? 3;
    this.mutSigma = opts.mutation ?? 0.08;
    this.foodDensity = opts.foodDensity ?? FOOD_DENSITY;
    this.poisonDensity = opts.poisonDensity ?? POISON_DENSITY;
    this.foundersPerFamily = opts.foundersPerFamily ?? FOUNDERS_PER_FAMILY;
    this.brainmode = opts.brainmode ?? 'neuro';
    this.rng = opts.rng ?? makeRng();
    this.champions = opts.champions ?? { herb: [], carn: [] };

    this.role = [];
    for (let g = 0; g < this.nFamilies; g++) {
      this.role[g] = g >= this.nFamilies - this.carnFamilies ? 'carn' : 'herb';
    }
    const n = this.width * this.height;
    this.cell = new Int8Array(n);
    this.occupant = new Array(n).fill(null);
    this.foodGrid = new Float32Array(n);
    this.healthGrid = new Float32Array(n);
    this.geneGrid = new Float32Array(n);
    this.reset();
  }

  idx(i, j) { return i * this.width + j; }
  wrapI(i) { return ((i % this.height) + this.height) % this.height; }
  wrapJ(j) { return ((j % this.width) + this.width) % this.width; }

  reset() {
    this.cell.fill(EMPTY);
    this.occupant.fill(null);
    this.agents = [];
    this.tick = 0;
    this.uid = 0;
    this.births = this.deaths = this.rescues = this.immigrations = 0;
    this.maxGeneration = 0;
    this.roleAbsent = { herb: 0, carn: 0 };
    this.best = null;

    // A real founding population: a lone pair is too fragile to give a way of
    // life a fair trial, which is how the predator niche used to be decided by
    // luck in the first thirty ticks.
    for (let g = 0; g < this.nFamilies; g++) {
      for (let k = 0; k < this.foundersPerFamily; k++) this.found(g);
    }
    this.scatter(FOOD, Math.round(this.width * this.height * this.foodDensity));
    this.scatter(POISON, Math.round(this.width * this.height * this.poisonDensity));
    this.scatter(SUPERFOOD, 1);
    this.observe();
    for (const a of this.agents) a.state = a.statePrime;
  }

  randomEmpty() {
    const n = this.cell.length;
    for (let tries = 0; tries < 60; tries++) {
      const k = this.rng.int(n);
      if (this.cell[k] === EMPTY) return k;
    }
    const free = [];
    for (let k = 0; k < n; k++) if (this.cell[k] === EMPTY) free.push(k);
    return free.length ? this.rng.pick(free) : -1;
  }

  scatter(type, count) {
    for (let k = 0; k < count; k++) {
      const c = this.randomEmpty();
      if (c < 0) return;
      this.cell[c] = type;
    }
  }

  /** A founder genome: a saved champion when we have one, otherwise fresh. */
  seedGenomeFor(role) {
    const pool = this.champions[role];
    if (pool && pool.length) {
      const half = Math.max(1, pool.length >> 1);
      return mutate(pool[this.rng.int(half)], 0.03, this.rng);
    }
    return seedGenome(role, this.rng);
  }

  attach(a, genome, generation, lineage, parentUid) {
    a.genome = genome;
    a.maxHealth = capacity(genome.diet);
    a.health = Math.min(a.health, a.maxHealth);
    a.prevAction = null;
    a.generation = generation | 0;
    a.lineage = lineage ?? a.uid;
    a.parentUid = parentUid ?? null;
    a.eaten = a.poisoned = a.superEaten = a.kills = a.offspring = 0;
    a.bornTick = this.tick;
    if (a.generation > this.maxGeneration) this.maxGeneration = a.generation;
    return a;
  }

  spawn(gene, cellIndex) {
    if (cellIndex < 0) return null;
    const a = {
      uid: ++this.uid, gene,
      i: (cellIndex / this.width) | 0, j: cellIndex % this.width,
      health: START_HEALTH, maxHealth: BASE_HEALTH, age: 0, maxAge: MAX_AGE,
      action: -1, killed: 0, dead: false, ateSuperFood: -1, reproduced: false,
      iTarget: 0, jTarget: 0, state: null, statePrime: null,
      genome: null, prevAction: null, generation: 0, lineage: 0, parentUid: null,
      eaten: 0, poisoned: 0, superEaten: 0, kills: 0, offspring: 0, bornTick: 0,
    };
    this.cell[cellIndex] = AGENT;
    this.occupant[cellIndex] = a;
    this.agents.push(a);
    return a;
  }

  found(gene) {
    const a = this.spawn(gene, this.randomEmpty());
    if (a) this.attach(a, this.seedGenomeFor(this.role[gene]), 0, a.uid, null);
    return a;
  }

  // -- one tick ---------------------------------------------------------------
  step() {
    const rng = this.rng;
    const neuroMode = this.brainmode === 'neuro';
    for (const a of this.agents) {
      a.action = neuroMode ? decide(a.state, a.genome, a.prevAction, rng)
                           : decideInstinct(a.state, a.genome, rng);
      a.prevAction = a.action;
      a.health = Math.min(a.maxHealth, a.health - METABOLISM);
      a.age = Math.min(a.maxAge, a.age + 1);
      a.killed = 0;
    }
    this.attack();
    this.move();
    for (const a of this.agents) if (a.health <= 0 || a.age >= a.maxAge) a.dead = true;
    const dead = this.agents.filter(a => a.dead);
    this.regrow();
    this.reproduce();
    this.produce();
    this.removeDead();
    this.immigrate();
    this.observe();
    for (const a of this.agents) a.state = a.statePrime;
    this.tick++;
    for (const a of dead) this.retire(a);
    return dead;
  }

  retire(a) {
    const score = fitness(a);
    const role = isCarnivore(a.genome) ? 'carn' : 'herb';
    const pool = this.champions[role] || (this.champions[role] = []);
    // Keep the pool sorted by the score each genome finished its life with.
    if (pool.length < 12 || score > (pool.scores?.[pool.length - 1] ?? -Infinity)) {
      pool.push(a.genome);
      pool.scores = pool.scores || [];
      pool.scores.push(score);
      const order = pool.scores.map((s, i) => [s, i]).sort((x, y) => y[0] - x[0]).slice(0, 12);
      const g2 = order.map(([, i]) => pool[i]), s2 = order.map(([s]) => s);
      pool.length = 0; pool.push(...g2); pool.scores = s2;
    }
    if (!this.best || score > this.best.score) {
      this.best = {
        score: Math.round(score * 10) / 10, age: a.age, generation: a.generation,
        offspring: a.offspring, eaten: a.eaten, kills: a.kills,
        diet: +a.genome.diet.toFixed(2), carn: isCarnivore(a.genome),
        color: colorFor(a.genome), tick: this.tick,
      };
    }
  }

  attack() {
    const before = new Map();
    for (const a of this.agents) before.set(a, a.health);
    for (const a of this.agents) {
      if (a.dead || a.action < 4) continue;
      const [dy, dx] = DIRV[a.action - 4];
      const t = this.occupant[this.idx(this.wrapI(a.i + dy), this.wrapJ(a.j + dx))];
      if (!t || t.dead) continue;
      t.health = 0;                                  // the target is killed
      a.killed = 1;
      a.kills++;
    }
    // Re-price the meat by diet, skipping any attacker killed in the same
    // exchange — its health is zero and must stay there.
    for (const a of this.agents) {
      if (!a.killed || a.health <= 0) continue;
      a.health = Math.min(a.maxHealth, before.get(a) + MEAT_NUTRITION * (0.15 + 0.85 * a.genome.diet));
    }
  }

  move() {
    for (const a of this.agents) {
      if (a.action <= 3 && a.action >= 0 && !a.dead) {
        const [dy, dx] = DIRV[a.action];
        a.iTarget = this.wrapI(a.i + dy); a.jTarget = this.wrapJ(a.j + dx);
      } else { a.iTarget = a.i; a.jTarget = a.j; }
    }
    // Only one entity may occupy a cell: if several want the same one, nobody
    // gets it, which can cascade, so repeat until the choice is stable.
    for (;;) {
      const counts = new Map();
      for (const a of this.agents) {
        const k = this.idx(a.iTarget, a.jTarget);
        counts.set(k, (counts.get(k) || 0) + 1);
      }
      let changed = false;
      for (const a of this.agents) {
        if (counts.get(this.idx(a.iTarget, a.jTarget)) > 1 &&
            (a.iTarget !== a.i || a.jTarget !== a.j)) {
          a.iTarget = a.i; a.jTarget = a.j; changed = true;
        }
      }
      if (!changed) break;
    }
    for (const a of this.agents) {
      if (a.action > 3 || a.action < 0) continue;
      this.eat(a);
      const from = this.idx(a.i, a.j), to = this.idx(a.iTarget, a.jTarget);
      if (from !== to) {
        this.cell[from] = EMPTY; this.occupant[from] = null;
        this.cell[to] = AGENT; this.occupant[to] = a;
        a.i = a.iTarget; a.j = a.jTarget;
      }
    }
  }

  eat(a) {
    const k = this.idx(a.iTarget, a.jTarget), type = this.cell[k];
    if (type === FOOD) {
      a.health = Math.min(a.maxHealth, a.health + PLANT_NUTRITION * (1 - DIET_PENALTY * a.genome.diet));
      a.eaten++;
    } else if (type === POISON) {
      a.health = Math.min(a.maxHealth, a.health - POISON_DAMAGE);
      a.poisoned++;
    } else if (type === SUPERFOOD) {
      a.health = Math.min(a.maxHealth, a.health + PLANT_NUTRITION * (1 - DIET_PENALTY * a.genome.diet) + 20);
      a.maxAge = Math.round(a.maxAge * 1.2);
      a.ateSuperFood = 1;
      a.eaten++; a.superEaten++;
    }
  }

  regrow() {
    const cells = this.cell.length;
    let food = 0, poison = 0, sup = 0;
    for (let k = 0; k < cells; k++) {
      const c = this.cell[k];
      if (c === FOOD) food++; else if (c === POISON) poison++; else if (c === SUPERFOOD) sup++;
    }
    this.scatter(FOOD, Math.min(REGROW_PER_TICK, Math.max(0, Math.round(cells * this.foodDensity) - food)));
    this.scatter(POISON, Math.min(3, Math.max(0, Math.round(cells * this.poisonDensity) - poison)));
    if (!sup) this.scatter(SUPERFOOD, 1);
  }

  /** Empty cells within an agent's field of view — where its offspring go. */
  emptyNear(a) {
    const out = [];
    for (let di = -C; di <= C; di++) {
      for (let dj = -C; dj <= C; dj++) {
        const k = this.idx(this.wrapI(a.i + di), this.wrapJ(a.j + dj));
        if (this.cell[k] === EMPTY) out.push(k);
      }
    }
    return out;
  }

  reproChance(a) {
    const hf = a.health / a.maxHealth;
    if (hf < REPRO_MIN_HEALTH) return 0;
    return REPRO_MAX_CHANCE * (hf - REPRO_MIN_HEALTH) / (1 - REPRO_MIN_HEALTH);
  }

  findMate(a) {
    let best = null, bd = 99;
    for (const o of this.agents) {
      if (o === a || o.dead || o.gene !== a.gene || o.age <= REPRO_MIN_AGE) continue;
      const d = Math.abs(o.i - a.i) + Math.abs(o.j - a.j);
      if (d < bd) { bd = d; best = o; }
    }
    return bd <= 4 ? best : null;
  }

  reproduce() {
    const rng = this.rng;
    for (const a of [...this.agents]) {
      if (a.dead || a.age <= REPRO_MIN_AGE) continue;
      if (this.agents.length > this.maxAgents) break;
      if (rng() >= this.reproChance(a)) continue;

      const mate = rng() < MATE_CHANCE ? this.findMate(a) : null;
      const genome = mate ? breed(a.genome, mate.genome, this.mutSigma, rng)
                          : mutate(a.genome, this.mutSigma, rng);
      // Herbivores herd, predators disperse. Offspring born beside their
      // parent make families cluster — good for a grazer, but a problem for a
      // predator whose neighbours are then all kin it will not attack. So
      // dispersal is diet-dependent: a pure carnivore's young always strike out
      // on their own, a pure herbivore's young stay in the herd.
      const near = rng() >= a.genome.diet ? this.emptyNear(a) : [];
      const child = this.spawn(a.gene, near.length ? rng.pick(near) : this.randomEmpty());
      if (!child) continue;
      this.attach(child, genome, a.generation + 1, a.lineage, a.uid);
      child.health = Math.min(child.maxHealth, NEWBORN_HEALTH);
      a.health = Math.max(1, a.health - REPRO_COST);
      a.offspring++;
      this.births++;
    }
  }

  produce() {
    const floor = Math.max(RESCUE_MIN, Math.round(this.maxAgents * RESCUE_FRACTION));
    const alive = this.agents.filter(a => !a.dead).length;
    if (alive >= floor) return;
    const present = new Set(this.agents.filter(a => !a.dead).map(a => a.gene));
    let missing = [];
    for (let g = 0; g < this.nFamilies; g++) if (!present.has(g)) missing.push(g);
    for (let k = 0; k < Math.min(2, floor - alive); k++) {
      const gene = missing.length ? this.rng.pick(missing) : this.rng.int(this.nFamilies);
      if (this.found(gene)) {
        this.rescues++;
        missing = missing.filter(g => g !== gene);
      }
    }
  }

  /** A way of life can be lost to bad luck, and the diet valley makes it very
   *  hard to evolve back. If a niche stands empty long enough, founders arrive. */
  immigrate() {
    const live = this.agents.filter(a => !a.dead);
    if (live.length < Math.max(RESCUE_MIN, Math.round(this.maxAgents * RESCUE_FRACTION))) return;
    const present = { herb: 0, carn: 0 };
    for (const a of live) present[isCarnivore(a.genome) ? 'carn' : 'herb']++;
    for (const role of ['herb', 'carn']) {
      if (present[role] >= NICHE_MIN) { this.roleAbsent[role] = 0; continue; }
      if (++this.roleAbsent[role] < NICHE_ABSENT_TICKS) continue;
      const genes = [];
      for (let g = 0; g < this.nFamilies; g++) if (this.role[g] === role) genes.push(g);
      for (let k = 0; k < IMMIGRANTS; k++) this.found(genes.length ? this.rng.pick(genes) : 0);
      this.roleAbsent[role] = 0;
      this.immigrations++;
    }
  }

  removeDead() {
    const kept = [];
    for (const a of this.agents) {
      if (a.dead) {
        const k = this.idx(a.i, a.j);
        this.cell[k] = FOOD;                 // a corpse feeds the world
        this.occupant[k] = null;
        this.deaths++;
      } else kept.push(a);
    }
    this.agents = kept;
  }

  // -- perception -------------------------------------------------------------
  /** Build every creature's 153-value observation: three 7x7 wrap-around views
   *  (plants, health, kinship) plus six scalars. */
  observe() {
    const n = this.agents.length;
    if (!n) return;
    const cells = this.cell.length, W = this.width;
    const food = this.foodGrid, health = this.healthGrid, gene = this.geneGrid;
    for (let k = 0; k < cells; k++) {
      const c = this.cell[k];
      food[k] = c === FOOD ? 0.5 : c === SUPERFOOD ? 1 : c === POISON ? -1 : 0;
      health[k] = -1; gene[k] = -2;
      if (c === AGENT) {
        const a = this.occupant[k];
        if (a) {
          health[k] = a.health / a.maxHealth;
          if (a.health < 0) food[k] = 1;
          if (!a.dead) gene[k] = a.gene;
        }
      }
    }
    const counts = new Map();
    for (const a of this.agents) counts.set(a.gene, (counts.get(a.gene) || 0) + 1);
    const percentAlive = n / this.maxAgents;

    for (const a of this.agents) {
      const s = a.statePrime && a.statePrime.length === 153 ? a.statePrime : new Float32Array(153);
      let p = 0;
      for (let di = -C; di <= C; di++) {
        const row = this.wrapI(a.i + di) * W;
        for (let dj = -C; dj <= C; dj++) {
          const k = row + this.wrapJ(a.j + dj);
          s[p] = food[k];
          s[49 + p] = health[k];
          const g = gene[k];
          s[98 + p] = g === a.gene ? 1 : g > -1 ? -1 : 0;
          p++;
        }
      }
      s[147] = a.health / a.maxHealth;
      s[148] = a.reproduced ? 1 : 0;
      s[149] = counts.get(a.gene) / n;
      s[150] = percentAlive;
      s[151] = a.killed;
      s[152] = a.ateSuperFood;
      a.statePrime = s;
      if (a.state === null) a.state = s;
    }
  }

  // -- reporting --------------------------------------------------------------
  counts() {
    let herb = 0;
    for (const a of this.agents) if (!isCarnivore(a.genome)) herb++;
    return { herbivores: herb, carnivores: this.agents.length - herb };
  }

  dietHistogram(bins = 10) {
    const h = new Array(bins).fill(0);
    for (const a of this.agents) h[Math.min(bins - 1, Math.floor(a.genome.diet * bins))]++;
    return h;
  }

  entityCoords(type) {
    const out = [], W = this.width;
    for (let k = 0; k < this.cell.length; k++) {
      if (this.cell[k] === type) out.push([(k / W) | 0, k % W]);
    }
    return out;
  }
}
