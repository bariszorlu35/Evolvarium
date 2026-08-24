"""Ecosystem layer for Evolvarium — heritable traits, instinct policy, colours.

Behaviour is driven by a small heritable *genome* attached to each agent.
Because static families share one brain object, the genome lives on the agent
instead, which lets traits mutate per-lineage and evolve under selection.

  diet   : 0 = pure herbivore (eats plants, flees), 1 = pure carnivore (hunts)
  aggr   : probability of pressing the attack when prey is adjacent
  vision : how many cells out (Chebyshev) the creature perceives (1..3)
  mrate  : self-adaptive mutation rate — the mutability of a lineage is itself
           heritable, so the world can tune its own evolutionary speed
"""
import random
import numpy as np

FOV, C = 7, 3
UP, RIGHT, DOWN, LEFT, A_UP, A_RIGHT, A_DOWN, A_LEFT = range(8)
NB = {UP: (C - 1, C), DOWN: (C + 1, C), LEFT: (C, C - 1), RIGHT: (C, C + 1)}
ATK = {UP: A_UP, DOWN: A_DOWN, LEFT: A_LEFT, RIGHT: A_RIGHT}
MOVES = [UP, RIGHT, DOWN, LEFT]

MRATE_MIN, MRATE_MAX = 0.15, 2.5   # multiplier on the global mutation slider


def _clip01(x):
    return max(0.0, min(1.0, x))


def _clip(x, lo, hi):
    return max(lo, min(hi, x))


def seed_genome(role):
    """A fresh founder genome. Carnivores start meat-leaning and aggressive."""
    if role == "carn":
        g = {"diet": _clip01(random.gauss(0.85, 0.05)),
             "aggr": _clip01(random.gauss(0.80, 0.10)), "vision": 3}
    else:
        g = {"diet": _clip01(random.gauss(0.15, 0.05)),
             "aggr": _clip01(random.gauss(0.25, 0.10)), "vision": 3}
    g["mrate"] = _clip(random.gauss(1.0, 0.2), MRATE_MIN, MRATE_MAX)
    return g


def mutate(g, sigma):
    """Mutate the heritable traits. `sigma` is the world mutation rate; each
    lineage scales it by its own evolved `mrate`."""
    m = g.get("mrate", 1.0)
    s = sigma * m
    return {"diet": _clip01(g["diet"] + random.gauss(0, s)),
            "aggr": _clip01(g["aggr"] + random.gauss(0, s)),
            "vision": int(_clip(round(g["vision"] + random.gauss(0, s * 3)), 1, 3)),
            "mrate": _clip(m * float(np.exp(random.gauss(0, 0.12))), MRATE_MIN, MRATE_MAX)}


def crossover(g1, g2):
    """Blend two parents' traits (uniform/BLX mix). Weights are recombined by
    the neuro layer, which owns `W`."""
    t = random.random()
    return {"diet": _clip01(g1["diet"] * t + g2["diet"] * (1 - t)),
            "aggr": _clip01(g1["aggr"] * t + g2["aggr"] * (1 - t)),
            "vision": int(random.choice((g1["vision"], g2["vision"]))),
            "mrate": _clip(g1.get("mrate", 1.0) * t + g2.get("mrate", 1.0) * (1 - t),
                           MRATE_MIN, MRATE_MAX)}


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


def nearest(grid, mask, vis=3):
    """(di,dj) of the closest cell satisfying `mask` (a boolean array of the same
    shape), within Chebyshev distance `vis`. None when nothing is in range."""
    ys, xs = np.nonzero(mask)
    if not len(ys):
        return None
    di = ys.astype(np.int16) - C
    dj = xs.astype(np.int16) - C
    keep = (np.maximum(np.abs(di), np.abs(dj)) <= vis) & ((di != 0) | (dj != 0))
    if not keep.any():
        return None
    di, dj = di[keep], dj[keep]
    k = int(np.argmin(np.abs(di) + np.abs(dj)))
    return int(di[k]), int(dj[k])


def _move(di, dj, food, away=False):
    """Pick a cardinal move toward (or away from) a (di,dj) offset, avoiding poison."""
    if away:
        di, dj = -di, -dj
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
    """Hand-written instinct policy — the baseline the neural brains are
    compared against (and the residual they build on)."""
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
        tgt = nearest(kin, kin == -1, vis)      # nearest non-kin agent
        if tgt:
            return _move(tgt[0], tgt[1], food)
        if adj_food:                            # opportunistic graze if starving
            return max(adj_food)[1]
    else:
        if adj_food:
            return max(adj_food)[1]
        pred = nearest(kin, kin == -1, 2)       # flee a close non-kin (predator)
        if pred and random.random() < (1 - g["diet"]):
            return _move(pred[0], pred[1], food, away=True)
        tgt = nearest(food, food > 0, vis)
        if tgt:
            return _move(tgt[0], tgt[1], food)
    return random.choice(MOVES)
