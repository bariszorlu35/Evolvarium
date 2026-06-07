"""Phase 3 — neuro-evolution brains for ReinLife (pure numpy, no torch).

Each creature carries a tiny neural network in its genome. The net produces a
*residual* on top of a built-in instinct (so founders are viable), and its
weights are inherited and mutated on reproduction. Creatures that survive
longer reproduce more, so the weights evolve by natural selection. A short
memory is provided by feeding the previous action back in as input.

Genome = {diet, aggr, vision, W}  (diet still drives the food-chain & colour).
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


def seed_genome(role):
    g = eco.seed_genome(role)
    g["W"] = (np.random.randn(N_W).astype(np.float32) * 0.05)
    return g

def mutate(g, sigma):
    ng = eco.mutate(g, sigma)
    W = g.get("W")
    if W is None:
        W = np.random.randn(N_W).astype(np.float32) * 0.05
    ng["W"] = (W + np.random.randn(N_W).astype(np.float32) * (sigma * 1.2)).astype(np.float32)
    return ng

def is_carnivore(g): return eco.is_carnivore(g)
def color_for(g): return eco.color_for(g)


def _nearest(grid, cond):
    ys, xs = np.where(cond(grid))
    best, bd = None, 99
    for y, x in zip(ys, xs):
        di, dj = int(y - C), int(x - C)
        if di == 0 and dj == 0:
            continue
        d = abs(di) + abs(dj)
        if d < bd:
            bd, best = d, (di, dj)
    return best

def features(state, diet, prev_action):
    state = np.asarray(state, dtype=float)
    food = state[0:49].reshape(7, 7)
    kin = state[98:147].reshape(7, 7)
    ftgt = _nearest(food, lambda g: g > 0)
    etgt = _nearest(kin, lambda g: g == -1)
    fy, fx = (ftgt[0] / 3.0, ftgt[1] / 3.0) if ftgt else (0.0, 0.0)
    ey, ex = (etgt[0] / 3.0, etgt[1] / 3.0) if etgt else (0.0, 0.0)
    adjF = [1.0 if food[NB[d]] > 0 else 0.0 for d in MOVES]
    adjE = [1.0 if kin[NB[d]] == -1 else 0.0 for d in MOVES]
    adjP = [1.0 if food[NB[d]] == -1 else 0.0 for d in MOVES]
    health = float(state[147]) if state.shape[0] > 147 else 1.0
    pa = [0.0] * 8
    if prev_action is not None and 0 <= prev_action < 8:
        pa[prev_action] = 1.0
    return np.array([fx, fy, ex, ey] + adjF + adjE + adjP + [health, diet] + pa, dtype=np.float32)

def instinct(f, diet):
    fx, fy, ex, ey = f[0], f[1], f[2], f[3]
    adjF, adjE, adjP = f[4:8], f[8:12], f[12:16]
    L = np.zeros(8, dtype=np.float32)
    for k, (dy, dx) in DIRV.items():
        L[k] = (1 - diet) * 2.0 * (dx * fx + dy * fy) + diet * 1.5 * (dx * ex + dy * ey)
        if adjF[k] > 0: L[k] += (1 - diet) * 2.0
        if adjP[k] > 0: L[k] -= 3.0
        if diet < 0.5: L[k] += (1 - diet) * 1.0 * (-(dx * ex + dy * ey))
    for k in range(4):
        if adjE[k] > 0: L[4 + k] = diet * 3.0
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
    x = x - x.max(); e = np.exp(x); return e / e.sum()

def decide(state, g, prev_action=None):
    f = features(state, g["diet"], prev_action)
    logits = instinct(f, g["diet"]) + _net(f, g["W"])
    return int(np.random.choice(8, p=_softmax(logits)))
