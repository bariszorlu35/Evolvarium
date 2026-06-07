"""Evolvarium — live evolving-artificial-life server (ecosystem + neuro-evolution).
Pure stdlib + numpy (no torch).

  GET /        -> viewer page
  GET /state   -> JSON snapshot
  GET /control -> play/pause/step/reset/fps/food/mutation/brain
Run:  python web/server.py  ->  http://localhost:8765
"""
import os, sys, json, time, random, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np
from ReinLife.World.environment import Environment
from ReinLife.World.utils import EntityTypes as ET
from ReinLife.Models.utils import BasicBrain
from web import ecosystem as eco
from web import neuro

HERE = os.path.dirname(os.path.abspath(__file__))


class _Placeholder(BasicBrain):
    def __init__(self): super().__init__(153, 8, "DQN")
    def get_action(self, state, n_epi=0): return 0
    def learn(self, **kwargs): pass


class SimEngine:
    def __init__(self, width=40, height=40, n_families=6, carn_families=2,
                 max_agents=200, mut_sigma=0.08, brainmode="neuro"):
        self.width, self.height, self.max_agents = width, height, max_agents
        self.n_families, self.carn_families = n_families, carn_families
        self.mut_sigma, self.brainmode = mut_sigma, brainmode
        self.seed_pool = {"herb": [], "carn": []}
        try:
            raw = json.load(open(os.path.join(HERE, "seed_brains.json")))
            self.seed_pool = {k: raw.get(k, []) for k in ("herb", "carn")}
        except Exception:
            pass
        self.pre_evolved = bool(self.seed_pool.get("herb") or self.seed_pool.get("carn"))
        self.lock = threading.RLock()
        self.running = True
        self.fps = 12.0
        self.tick = 0
        self.history = []        # [herb, carn] per step
        self.fit_history = []    # avg fitness per step
        self._uid = 0
        self._build()

    def _build(self):
        self.role = {g: ("carn" if g >= self.n_families - self.carn_families else "herb")
                     for g in range(self.n_families)}
        self.env = Environment(width=self.width, height=self.height, grid_size=24,
                               max_agents=self.max_agents, pastel_colors=False,
                               brains=[_Placeholder() for _ in range(self.n_families)],
                               training=False, static_families=True, limit_reproduction=False)
        self.env.reset()
        self.tick = 0; self.history = []; self.fit_history = []
        self._ensure(self.env.agents)

    def reset(self):
        with self.lock: self._build()

    def _seed(self, role):
        pool = self.seed_pool.get(role)
        if pool:
            src = random.choice(pool)
            g = {"diet": src["diet"], "aggr": src["aggr"], "vision": src["vision"],
                 "W": np.array(src["W"], dtype=np.float32)}
            return neuro.mutate(g, 0.04)
        return neuro.seed_genome(role)

    def _ensure(self, agents):
        for a in agents:
            if not hasattr(a, "uid"):
                self._uid += 1; a.uid = self._uid
            if not hasattr(a, "genome"):
                parents = [o for o in agents if o is not a and getattr(o, "genome", None)
                           is not None and o.gene == a.gene]
                if parents:
                    p = min(parents, key=lambda o: abs(o.i - a.i) + abs(o.j - a.j))
                    a.genome = neuro.mutate(p.genome, self.mut_sigma)
                else:
                    a.genome = self._seed(self.role.get(a.gene, "herb"))
                a.prev_action = None

    def step(self):
        env = self.env
        self._ensure(env.agents)
        for a in env.agents:
            if self.brainmode == "neuro":
                a.action = neuro.decide(a.state, a.genome, getattr(a, "prev_action", None))
                a.prev_action = a.action
            else:
                a.action = eco.decide(a.state, a.genome)
        env.step(); env.update_env()
        self._ensure(env.agents)
        self.tick += 1
        herb = sum(1 for a in env.agents if not neuro.is_carnivore(a.genome))
        self.history.append([herb, len(env.agents) - herb])
        self.fit_history.append(round(float(np.mean([a.fitness for a in env.agents])), 2) if env.agents else 0.0)
        if len(self.history) > 400:
            self.history = self.history[-400:]; self.fit_history = self.fit_history[-400:]

    def snapshot(self):
        with self.lock:
            env = self.env
            grid = env.grid.get_numpy()
            def coords(v):
                ys, xs = np.where(grid == int(v))
                return [[int(y), int(x)] for y, x in zip(ys, xs)]
            agents, diets, wmags = [], [], []
            for a in env.agents:
                g = a.genome; diets.append(g["diet"])
                wm = float(np.mean(np.abs(g["W"]))) if "W" in g else 0.0
                wmags.append(wm)
                agents.append({
                    "uid": a.uid, "i": int(a.i), "j": int(a.j), "gene": int(a.gene),
                    "color": neuro.color_for(g), "carn": bool(neuro.is_carnivore(g)),
                    "diet": round(g["diet"], 2), "aggr": round(g["aggr"], 2), "vision": int(g["vision"]),
                    "wmag": round(wm, 3),
                    "health": int(a.health), "maxHealth": int(a.max_health),
                    "age": int(a.age), "maxAge": int(a.max_age),
                    "fitness": round(float(a.fitness), 2),
                    "killed": int(a.killed), "reproduced": bool(a.reproduced),
                })
            herb = sum(1 for a in agents if not a["carn"])
            return {
                "width": self.width, "height": self.height,
                "tick": self.tick, "running": self.running, "fps": self.fps,
                "mutation": self.mut_sigma, "brainmode": self.brainmode, "maxAgents": self.max_agents,
                "preEvolved": self.pre_evolved,
                "population": len(agents), "herbivores": herb, "carnivores": len(agents) - herb,
                "avgDiet": round(float(np.mean(diets)), 2) if diets else 0,
                "avgFitness": round(float(np.mean([a["fitness"] for a in agents])), 2) if agents else 0,
                "avgAge": round(float(np.mean([a["age"] for a in agents])), 1) if agents else 0,
                "brainSize": round(float(np.mean(wmags)), 3) if wmags else 0,
                "agents": agents,
                "food": coords(ET.food), "poison": coords(ET.poison), "superfood": coords(ET.super_food),
                "history": self.history[-200:], "fitHistory": self.fit_history[-200:],
            }

    def control(self, cmd, v=None):
        with self.lock:
            if cmd == "play": self.running = True
            elif cmd == "pause": self.running = False
            elif cmd == "toggle": self.running = not self.running
            elif cmd == "reset": self._build()
            elif cmd == "fps" and v is not None: self.fps = max(1.0, min(60.0, float(v)))
            elif cmd == "mutation" and v is not None: self.mut_sigma = max(0.0, min(0.3, float(v)))
            elif cmd == "brain" and v in ("neuro", "instinct"): self.brainmode = v
            elif cmd == "food":
                from ReinLife.World.entities import Food
                for _ in range(int(v or 50)): self.env.grid.set_random(Food, p=1)
            elif cmd == "step" and not self.running: self.step()
        return {"ok": True, "running": self.running, "fps": self.fps,
                "mutation": self.mut_sigma, "brainmode": self.brainmode}

    def run_forever(self):
        while True:
            if self.running:
                with self.lock: self.step()
                time.sleep(1.0 / self.fps)
            else:
                time.sleep(0.05)


ENGINE = SimEngine()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body, ctype="application/json"):
        if isinstance(body, (dict, list)): body = json.dumps(body).encode()
        elif isinstance(body, str): body = body.encode()
        self.send_response(code); self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*"); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        u = urlparse(self.path)
        if u.path in ("/", "/index.html"):
            with open(os.path.join(HERE, "index.html"), "rb") as f:
                self._send(200, f.read(), "text/html; charset=utf-8")
        elif u.path == "/state": self._send(200, ENGINE.snapshot())
        elif u.path == "/control":
            q = parse_qs(u.query)
            self._send(200, ENGINE.control(q.get("cmd", [""])[0], q.get("v", [None])[0]))
        else: self._send(404, {"error": "not found"})


def main():
    port = int(os.environ.get("PORT") or (sys.argv[1] if len(sys.argv) > 1 else 8765))
    host = os.environ.get("HOST", "0.0.0.0")   # 0.0.0.0 so it is reachable when deployed
    threading.Thread(target=ENGINE.run_forever, daemon=True).start()
    srv = ThreadingHTTPServer((host, port), Handler)
    print(f"Evolvarium -> http://{host}:{port}  (Ctrl+C to stop)")
    try: srv.serve_forever()
    except KeyboardInterrupt: print("\nbye")


if __name__ == "__main__":
    main()
