"""Neuro-evolution brains for Evolvarium (pure numpy, no torch).

Each creature carries a tiny neural network in its genome. The net produces a
*residual* on top of a built-in instinct (so founders are viable), and its
weights are inherited, recombined and mutated on reproduction. Creatures that
feed well reproduce more, so the weights evolve by natural selection. A short
memory is provided by feeding the previous action back in as input.

Genome = {diet, aggr, vision, mrate, W}  (diet drives the food-chain & colour).
"""
import numpy as np
import random
from web import ecosystem as eco

C = eco.C
NB = eco.NB
MOVES = eco.MOVES
ATK = eco.ATK
DIRV = {0: (-1, 0), 1: (0, 1), 2: (1, 0), 3: (0, -1)}   # (dy,dx) UP,RIGHT,DOWN,LEFT

N_IN, N_H, N_OUT = 26, 20, 8
N_W = N_IN * N_H + N_H + N_H * N_OUT + N_OUT

# Mutation is an undirected random walk. Left unchecked the weight vector drifts
# outward every generation until the learned residual dwarfs the instinct it is
# supposed to refine, and lineages get *worse* at staying alive the longer they
# evolve. Three bounds keep the walk honest: weights decay slightly toward zero
# each generation (an Ornstein-Uhlenbeck pull, so drift has a stationary spread
# instead of growing without limit), they are hard-clipped, and the residual is
# squashed so it can bend the instinct but never overwhelm it.
W_DECAY = 0.985
W_STEP = 0.5                      # weight mutation relative to the trait sigma
W_CLIP = 2.5
RESIDUAL_GAIN = 2.5               # max logit the evolved net may add per action

# Pre-computed neighbour index arrays (flat 7x7) for the four cardinal cells.
_NB_IDX = np.array([NB[d][0] * 7 + NB[d][1] for d in MOVES], dtype=np.intp)

# Offsets of every cell in the 7x7 field of view, used by the vectorised
# nearest-target search.
_DI = (np.arange(49) // 7 - C).astype(np.float32)
_DJ = (np.arange(49) % 7 - C).astype(np.float32)
_MANH = np.abs(_DI) + np.abs(_DJ)
_SELF = np.arange(49) == (C * 7 + C)


def seed_genome(role):
    g = eco.seed_genome(role)
    g["W"] = (np.random.randn(N_W) * 0.05).astype(np.float32)
    return g


def mutate(g, sigma):
    """Inherit + mutate. The per-lineage `mrate` scales the world's sigma."""
    ng = eco.mutate(g, sigma)
    W = g.get("W")
    if W is None:
        W = (np.random.randn(N_W) * 0.05).astype(np.float32)
    ng["W"] = _drift(W, sigma * g.get("mrate", 1.0))
    return ng


def breed(g1, g2, sigma):
    """Sexual reproduction: uniform crossover of the weight vectors plus a
    blend of the scalar traits, then mutation."""
    ng = eco.crossover(g1, g2)
    w1, w2 = g1.get("W"), g2.get("W")
    if w1 is None or w2 is None:
        W = w1 if w1 is not None else w2
        if W is None:
            W = (np.random.randn(N_W) * 0.05).astype(np.float32)
    else:
        m = np.random.rand(N_W) < 0.5
        W = np.where(m, w1, w2)
    ng["W"] = _drift(W, sigma * ng.get("mrate", 1.0))
    return ng


def _drift(W, sigma):
    """One generation of weight mutation: decay toward zero, add noise, clip."""
    W = W * W_DECAY + np.random.randn(N_W).astype(np.float32) * (sigma * W_STEP)
    return np.clip(W, -W_CLIP, W_CLIP).astype(np.float32)


def is_carnivore(g):
    return eco.is_carnivore(g)


def color_for(g):
    return eco.color_for(g)


def to_json(g):
    """Genome -> plain JSON-safe dict (weights rounded to keep files small)."""
    return {"diet": round(float(g["diet"]), 5), "aggr": round(float(g["aggr"]), 5),
            "vision": int(g["vision"]), "mrate": round(float(g.get("mrate", 1.0)), 4),
            "W": [round(float(x), 4) for x in g["W"]]}


def from_json(d):
    """Plain dict -> genome. Tolerates older files without `mrate` and repairs
    weight vectors whose length no longer matches the current architecture."""
    W = np.asarray(d.get("W", []), dtype=np.float32)
    if W.size != N_W:
        fixed = (np.random.randn(N_W) * 0.05).astype(np.float32)
        fixed[:min(W.size, N_W)] = W[:min(W.size, N_W)]
        W = fixed
    return {"diet": eco._clip01(float(d.get("diet", 0.2))),
            "aggr": eco._clip01(float(d.get("aggr", 0.4))),
            "vision": int(eco._clip(int(d.get("vision", 3)), 1, 3)),
            "mrate": eco._clip(float(d.get("mrate", 1.0)), eco.MRATE_MIN, eco.MRATE_MAX),
            "W": np.clip(W, -W_CLIP, W_CLIP).astype(np.float32)}


def _nearest_flat(flat, mask):
    """Closest (di,dj) among the True cells of `mask` over a flattened 7x7."""
    m = mask & ~_SELF
    if not m.any():
        return 0.0, 0.0
    idx = np.flatnonzero(m)
    k = idx[np.argmin(_MANH[idx])]
    return float(_DI[k]) / 3.0, float(_DJ[k]) / 3.0


def features(state, diet, prev_action):
    """26 inputs: nearest food/enemy bearing, adjacency of food/enemy/poison,
    own health, diet, and a one-hot of the previous action (short memory)."""
    state = np.asarray(state, dtype=np.float32)
    food = state[0:49]
    kin = state[98:147]
    fy, fx = _nearest_flat(food, food > 0)
    ey, ex = _nearest_flat(kin, kin == -1)
    adjF = (food[_NB_IDX] > 0).astype(np.float32)
    adjE = (kin[_NB_IDX] == -1).astype(np.float32)
    adjP = (food[_NB_IDX] == -1).astype(np.float32)
    health = float(state[147]) if state.shape[0] > 147 else 1.0
    pa = np.zeros(8, dtype=np.float32)
    if prev_action is not None and 0 <= prev_action < 8:
        pa[prev_action] = 1.0
    return np.concatenate((
        np.array([fx, fy, ex, ey], dtype=np.float32),
        adjF, adjE, adjP,
        np.array([health, diet], dtype=np.float32), pa)).astype(np.float32)


def instinct(f, diet):
    """Hard-wired survival drive. Herbivores are pulled toward food and pushed
    away from non-kin; carnivores are pulled toward non-kin and attack when
    adjacent. Poison is repellent for everyone."""
    fx, fy, ex, ey = f[0], f[1], f[2], f[3]
    adjF, adjE, adjP = f[4:8], f[8:12], f[12:16]
    L = np.zeros(8, dtype=np.float32)
    for k, (dy, dx) in DIRV.items():
        L[k] = (1 - diet) * 2.0 * (dx * fx + dy * fy) + diet * 1.5 * (dx * ex + dy * ey)
        if adjF[k] > 0:
            L[k] += (1 - diet) * 2.0
        if adjP[k] > 0:
            L[k] -= 3.0
        if diet < 0.5:
            L[k] += (1 - diet) * 1.0 * (-(dx * ex + dy * ey))
    for k in range(4):
        if adjE[k] > 0:
            L[4 + k] = diet * 3.0
    return L


def _net(f, W):
    i = 0
    W1 = W[i:i + N_IN * N_H].reshape(N_IN, N_H); i += N_IN * N_H
    b1 = W[i:i + N_H]; i += N_H
    W2 = W[i:i + N_H * N_OUT].reshape(N_H, N_OUT); i += N_H * N_OUT
    b2 = W[i:i + N_OUT]
    h = np.tanh(f @ W1 + b1)
    return h @ W2 + b2


def _softmax(x):
    x = np.clip(x - x.max(), -60.0, 0.0)
    e = np.exp(x)
    s = e.sum()
    return e / s if s > 0 else np.full(8, 0.125, dtype=np.float64)


def decide(state, g, prev_action=None):
    f = features(state, g["diet"], prev_action)
    W = g.get("W")
    logits = instinct(f, g["diet"])
    if W is not None:
        logits = logits + RESIDUAL_GAIN * np.tanh(_net(f, W))
    if not np.all(np.isfinite(logits)):
        logits = np.nan_to_num(logits, nan=0.0, posinf=10.0, neginf=-10.0)
    return int(np.random.choice(8, p=_softmax(logits.astype(np.float64))))
