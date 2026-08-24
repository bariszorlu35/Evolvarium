"""Pre-evolve a population and save the champions, so a fresh deployment starts
with creatures that already know how to stay alive.

    python web/evolve.py                 # ~2500 ticks, writes web/seed_brains.json
    python web/evolve.py --steps 6000 --out /tmp/brains.json

The live server keeps doing this on its own — every creature that dies is
offered to the same hall of fame and the file is rewritten periodically. This
script just gives the very first visitor something better than random noise.
"""
import os
import sys
import time
import json
import random
import argparse
import warnings

os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
warnings.filterwarnings("ignore", message=".*torch-based brains unavailable.*")

import numpy as np                                                  # noqa: E402
from ReinLife.Models.utils import BasicBrain                        # noqa: E402
from web import neuro, evolution                                    # noqa: E402
from web.evolution import EvoEnvironment                            # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(HERE, "seed_brains.json")


class _Placeholder(BasicBrain):
    def __init__(self):
        super().__init__(153, 8, "DQN")

    def get_action(self, state, n_epi=0):
        return 0

    def learn(self, **kwargs):
        pass


def evolve(steps=2500, width=42, height=42, n_families=6, carn_families=3,
           max_agents=220, sigma=0.08, keep=12, seed=0, progress=True):
    random.seed(seed)
    np.random.seed(seed)
    role = {g: ("carn" if g >= n_families - carn_families else "herb")
            for g in range(n_families)}
    env = EvoEnvironment(
        width=width, height=height, grid_size=24, max_agents=max_agents,
        pastel_colors=False, brains=[_Placeholder() for _ in range(n_families)],
        training=False, static_families=True, limit_reproduction=False,
        mut_sigma=sigma, seed_fn=neuro.seed_genome, role_of=role)
    env.reset()

    hall = {"herb": [], "carn": []}

    def retire(agent):
        """Score a creature that just died and keep it if it is among the best.

        Scoring only the dead is the point: fitness here is what a creature
        *finished* with — how many offspring it left, how long it lasted, how
        well it fed — not a snapshot of a life still in progress.
        """
        score = evolution.fitness(agent)
        role_key = "carn" if neuro.is_carnivore(agent.genome) else "herb"
        pool = hall[role_key]
        pool.append((score, agent.genome))
        pool.sort(key=lambda x: -x[0])
        del pool[keep:]

    policy = lambda a: neuro.decide(a.state, a.genome, a.prev_action)   # noqa: E731
    t0 = time.time()
    for t in range(steps):
        for dead in env.evolve_step(policy):
            retire(dead)
        if progress and (t + 1) % max(1, steps // 10) == 0:
            pop = len(env.agents)
            carn = sum(1 for a in env.agents if neuro.is_carnivore(a.genome))
            print("  %5d/%d  pop %3d (%d carnivores)  generation %3d  best herb %.0f / carn %.0f"
                  % (t + 1, steps, pop, carn, env.max_generation,
                     hall["herb"][0][0] if hall["herb"] else 0,
                     hall["carn"][0][0] if hall["carn"] else 0))
    return hall, env, time.time() - t0


def main(argv=None):
    p = argparse.ArgumentParser(description="Pre-evolve Evolvarium champion brains")
    p.add_argument("--steps", type=int, default=2500)
    p.add_argument("--width", type=int, default=42)
    p.add_argument("--height", type=int, default=42)
    p.add_argument("--max-agents", type=int, default=220)
    p.add_argument("--mutation", type=float, default=0.08)
    p.add_argument("--keep", type=int, default=12, help="champions kept per role")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--out", default=DEFAULT_OUT)
    args = p.parse_args(argv)

    print(f"evolving {args.steps} ticks on a {args.width}x{args.height} world...")
    hall, env, elapsed = evolve(steps=args.steps, width=args.width, height=args.height,
                                max_agents=args.max_agents, sigma=args.mutation,
                                keep=args.keep, seed=args.seed)

    out = {role: [dict(neuro.to_json(g), score=round(float(s), 1)) for s, g in pool]
           for role, pool in hall.items()}
    tmp = args.out + ".tmp"
    with open(tmp, "w") as f:
        json.dump(out, f)
    os.replace(tmp, args.out)

    print("done in %.1fs | herbivore champions %d (best %.0f) | carnivore champions %d (best %.0f)"
          % (elapsed, len(hall["herb"]), hall["herb"][0][0] if hall["herb"] else 0,
             len(hall["carn"]), hall["carn"][0][0] if hall["carn"] else 0))
    print("reached generation %d, %d births, %d rescues" %
          (env.max_generation, env.births, env.rescues))
    print("wrote %s (%d KB)" % (args.out, os.path.getsize(args.out) // 1024))
    if not hall["carn"]:
        print("WARNING: no carnivore ever died with a score — the predator niche "
              "may be collapsing; check food density and meat nutrition.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
