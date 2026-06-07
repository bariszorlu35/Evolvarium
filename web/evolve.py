"""Pre-evolve a population of neural brains (pure numpy) and save champions so
the live viewer starts with already-adapted creatures. Run: python web/evolve.py"""
import os, sys, json, time, copy; os.environ['SDL_VIDEODRIVER']='dummy'
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import random, numpy as np
from ReinLife.World.environment import Environment
from ReinLife.Models.utils import BasicBrain
from web import neuro

class _P(BasicBrain):
    def __init__(s): super().__init__(153,8,"DQN")
    def get_action(s,st,n=0): return 0
    def learn(s,**k): pass

def evolve(steps=1200, width=42, height=42, n_families=6, carn_families=2, max_agents=220, sigma=0.08, seed=0):
    random.seed(seed); np.random.seed(seed)
    role={g:("carn" if g>=n_families-carn_families else "herb") for g in range(n_families)}
    env=Environment(width=width,height=height,grid_size=24,max_agents=max_agents,pastel_colors=False,
                    brains=[_P() for _ in range(n_families)],training=False,static_families=True,limit_reproduction=False)
    env.reset()
    hall={"herb":[], "carn":[]}   # (fitness, genome) champions
    def ensure(agents):
        for a in agents:
            if not hasattr(a,'genome'):
                par=[o for o in agents if o is not a and getattr(o,'genome',None) is not None and o.gene==a.gene]
                a.genome=neuro.mutate(min(par,key=lambda o:abs(o.i-a.i)+abs(o.j-a.j)).genome,sigma) if par else neuro.seed_genome(role[a.gene])
                a.prev_action=None
    ensure(env.agents)
    for t in range(steps):
        ensure(env.agents)
        for a in env.agents:
            a.action=neuro.decide(a.state,a.genome,getattr(a,'prev_action',None)); a.prev_action=a.action
        env.step(); env.update_env(); ensure(env.agents)
        if t%20==0:                                   # sample champions
            for a in env.agents:
                k="carn" if neuro.is_carnivore(a.genome) else "herb"
                hall[k].append((float(a.fitness), a.genome))
            for k in hall:
                hall[k]=sorted(hall[k], key=lambda x:-x[0])[:8]
    out={k:[{"diet":float(g["diet"]),"aggr":float(g["aggr"]),"vision":int(g["vision"]),
             "W":[round(float(x),4) for x in g["W"]]} for _,g in v] for k,v in hall.items()}
    json.dump(out, open("web/seed_brains.json","w"))
    return hall

t0=time.time()
h=evolve()
print("evolved in %.1fs | herb champions=%d carn champions=%d | best herbFit=%.1f bestCarnFit=%.1f"%(
    time.time()-t0, len(h["herb"]), len(h["carn"]),
    h["herb"][0][0] if h["herb"] else -1, h["carn"][0][0] if h["carn"] else -1))
import os; print("seed_brains.json size: %d KB"%(os.path.getsize("web/seed_brains.json")//1024))
