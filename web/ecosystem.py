"""Phase 2 — ecosystem layer for ReinLife (no torch, no core-env edits).

Behaviour is driven by a small heritable *genome* attached to each agent
(diet, aggression, vision). Because static families share one brain object,
we attach the genome to the agent instead and compute actions with access to
that agent — this lets traits mutate per-lineage and evolve under selection.

  diet : 0 = pure herbivore (eats plants, flees), 1 = pure carnivore (hunts agents)
  aggr : probability of pressing the attack when prey is adjacent
  vision : how many cells out (Chebyshev) the creature perceives (1..3)
"""
import random
import numpy as np

FOV, C = 7, 3
UP, RIGHT, DOWN, LEFT, A_UP, A_RIGHT, A_DOWN, A_LEFT = range(8)
NB = {UP: (C - 1, C), DOWN: (C + 1, C), LEFT: (C, C - 1), RIGHT: (C, C + 1)}
ATK = {UP: A_UP, DOWN: A_DOWN, LEFT: A_LEFT, RIGHT: A_RIGHT}
MOVES = [UP, RIGHT, DOWN, LEFT]


def _clip01(x):
    return max(0.0, min(1.0, x))


def seed_genome(role):
    if role == "carn":
        return {"diet": _clip01(random.gauss(0.85, 0.05)),
                "aggr": _clip01(random.gauss(0.80, 0.10)), "vision": 3}
    return {"diet": _clip01(random.gauss(0.15, 0.05)),
            "aggr": _clip01(random.gauss(0.25, 0.10)), "vision": 3}


def mutate(g, sigma):
    return {"diet": _clip01(g["diet"] + random.gauss(0, sigma)),
            "aggr": _clip01(g["aggr"] + random.gauss(0, sigma)),
            "vision": int(min(3, max(1, round(g["vision"] + random.gauss(0, sigma * 3)))))}


def is_carnivore(g):
    return g["diet"] >= 0.5


def color_for(g):
    """Herbivores cool (cyan->indigo), carnivores warm (amber->red); plants are
    green, so prey/predator/food are easy to tell apart while diet still shows
    as an evolving gradient within each role."""
    d = g["diet"]
    if d < 0.5:
        t = d / 0.5
        r = int(52 + (90 - 52) * t); gr = int(226 - (226 - 150) * t); b = 255
    else:
        t = (d - 0.5) / 0.5
        r = 255; gr = int(184 - (184 - 60) * t); b = int(80 - (80 - 48) * t)
    return f"rgb({r},{gr},{b})"


def _nearest(grid, predicate_val, vis, sign=None):
    """Return (di,dj) to nearest cell matching value condition within vision."""
    if sign == "pos":
        ys, xs = np.where(grid > 0)
    elif sign == "neg":
        ys, xs = np.where(grid == predicate_val)
    else:
        ys, xs = np.where(grid == predicate_val)
    best = None; bestd = 99
    for y, x in zip(ys, xs):
        di, dj = int(y - C), int(x - C)
        if di == 0 and dj == 0:
            continue
        if max(abs(di), abs(dj)) > vis:
            continue
        d = abs(di) + abs(dj)
        if d < bestd:
            bestd = d; best = (di, dj)
    return best


def _move(di, dj, food, away=False):
    """Pick a cardinal move toward (or away from) a (di,dj) offset, avoiding poison."""
    if away:
        di, dj = -di, -dj
    order = []
    if abs(di) >= abs(dj):
        order = [DOWN if di > 0 else UP] + ([RIGHT if dj > 0 else LEFT] if dj else [])
    else:
        order = [RIGHT if dj > 0 else LEFT] + ([DOWN if di > 0 else UP] if di else [])
    for d in order:
        ni, nj = NB[d]
        if food[ni, nj] != -1:           # don't step into poison
            return d
    return order[0] if order else random.choice(MOVES)


def decide(state, g):
    state = np.asarray(state, dtype=float)
    food = state[0:49].reshape(FOV, FOV)
    kin = state[98:147].reshape(FOV, FOV)
    vis = int(g["vision"])

    adj_food = [(food[i, j], d) for d, (i, j) in NB.items() if food[i, j] > 0]
    adj_enemy = [d for d, (i, j) in NB.items() if kin[i, j] == -1]

    hunting = random.random() < g["diet"]      # carnivores hunt more often

    if hunting:
        if adj_enemy and random.random() < g["aggr"]:
            return ATK[random.choice(adj_enemy)]
        tgt = _nearest(kin, -1, vis)            # nearest non-kin agent
        if tgt:
            return _move(tgt[0], tgt[1], food)
        if adj_food:                            # opportunistic graze if starving
            return max(adj_food)[1]
    else:
        if adj_food:
            return max(adj_food)[1]
        pred = _nearest(kin, -1, 2)             # flee a close non-kin (predator)
        if pred and random.random() < (1 - g["diet"]):
            return _move(pred[0], pred[1], food, away=True)
        tgt = _nearest(food, None, vis, sign="pos")
        if tgt:
            return _move(tgt[0], tgt[1], food)
    return random.choice(MOVES)
