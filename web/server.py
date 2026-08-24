"""Evolvarium — live evolving-artificial-life server.

Pure standard library + numpy. One shared world steps in a background thread;
browsers watch it over Server-Sent Events (with polling as a fallback).

  GET /            viewer page
  GET /state       JSON snapshot (one cached, pre-compressed payload per tick)
  GET /stream      Server-Sent Events: the same snapshot, pushed on every tick
  GET /control     play/pause/step/reset/fps/food/mutation/brain
  GET /brains      download the current champion genomes as JSON
  GET /healthz     liveness probe for hosting platforms

Run:  python web/server.py   ->  http://localhost:8765
"""
import os
import sys
import json
import gzip
import time
import random
import argparse
import threading
import warnings
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# The torch-backed brains are deliberately unused here; numpy is the only
# dependency this deployment has, so silence the optional-import notice.
warnings.filterwarnings("ignore", message=".*torch-based brains unavailable.*")

import numpy as np                                                  # noqa: E402
from ReinLife.World.utils import EntityTypes as ET                  # noqa: E402
from ReinLife.Models.utils import BasicBrain                        # noqa: E402
from web import ecosystem as eco                                    # noqa: E402
from web import neuro                                               # noqa: E402
from web import evolution                                           # noqa: E402
from web.evolution import EvoEnvironment                            # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
# The viewer now lives in public/ and runs the world itself, so the same page is
# served by a plain static host and by this server. Assets are looked up there
# first and fall back to web/ for anything that only exists beside the engine.
PUBLIC = os.path.join(os.path.dirname(HERE), "public")
HISTORY = 400            # ticks of history kept in memory
HISTORY_SENT = 200       # ticks of history sent to viewers
HALL_SIZE = 12           # champion genomes kept per role
SAVE_EVERY = 900         # ticks between champion autosaves


def _env_flag(name, default=False):
    v = os.environ.get(name)
    return default if v is None else v.strip().lower() in ("1", "true", "yes", "on")


def _env_num(name, default, cast=float):
    try:
        return cast(os.environ[name])
    except (KeyError, ValueError, TypeError):
        return default


class _Placeholder(BasicBrain):
    """The environment wants a brain object per family, but every decision here
    comes from the individual's own evolved genome, not from a shared brain."""

    def __init__(self):
        super().__init__(153, 8, "DQN")

    def get_action(self, state, n_epi=0):
        return 0

    def learn(self, **kwargs):
        pass


class HallOfFame:
    """The best genomes the world has ever produced, per role.

    Champions are what a restarted server reseeds from, so a deployment keeps
    the progress it made instead of starting from scratch every time it wakes
    up. Persisted atomically; a read-only filesystem simply disables saving.
    """

    def __init__(self, path, size=HALL_SIZE):
        self.path = path
        self.size = size
        self.best = {"herb": [], "carn": []}     # [(score, genome)], best first
        self.loaded = 0
        self.writable = True

    def load(self):
        try:
            with open(self.path) as f:
                raw = json.load(f)
        except (OSError, ValueError):
            return 0
        for role in ("herb", "carn"):
            entries = raw.get(role) or []
            out = []
            for e in entries:
                try:
                    out.append((float(e.get("score", 0.0)), neuro.from_json(e)))
                except (TypeError, ValueError, KeyError):
                    continue
            self.best[role] = sorted(out, key=lambda x: -x[0])[:self.size]
        self.loaded = sum(len(v) for v in self.best.values())
        return self.loaded

    def offer(self, genome, score):
        role = "carn" if neuro.is_carnivore(genome) else "herb"
        pool = self.best[role]
        if len(pool) >= self.size and score <= pool[-1][0]:
            return False
        pool.append((float(score), genome))
        pool.sort(key=lambda x: -x[0])
        del pool[self.size:]
        return True

    def sample(self, role):
        """A champion to reseed from, lightly mutated so it is not a clone."""
        pool = self.best.get(role) or []
        if not pool:
            return None
        # Favour the better half without ever locking onto a single lineage.
        k = min(len(pool), max(1, len(pool) // 2))
        return neuro.mutate(random.choice(pool[:k])[1], 0.03)

    def to_json(self):
        return {role: [dict(neuro.to_json(g), score=round(s, 1)) for s, g in pool]
                for role, pool in self.best.items()}

    def save(self):
        if not self.writable:
            return False
        tmp = f"{self.path}.tmp"
        try:
            with open(tmp, "w") as f:
                json.dump(self.to_json(), f)
            os.replace(tmp, self.path)
            return True
        except OSError:
            self.writable = False        # read-only host: carry on in memory
            try:
                os.unlink(tmp)
            except OSError:
                pass
            return False


class SimEngine:
    """Owns the world, the stepping thread and the snapshot cache."""

    def __init__(self, width=34, height=34, n_families=6, carn_families=3,
                 max_agents=140, mut_sigma=0.08, brainmode="neuro",
                 food_density=evolution.FOOD_DENSITY, state_path=None,
                 idle_timeout=90.0, readonly=False):
        self.width, self.height, self.max_agents = width, height, max_agents
        self.n_families, self.carn_families = n_families, carn_families
        self.mut_sigma, self.brainmode = mut_sigma, brainmode
        self.food_density = food_density
        self.idle_timeout = idle_timeout
        self.readonly = readonly

        self.hall = HallOfFame(state_path or os.path.join(HERE, "seed_brains.json"))
        self.pre_evolved = self.hall.load() > 0

        self.lock = threading.RLock()
        self.wake = threading.Condition(threading.Lock())
        self.version = 0
        self.running = True
        self.fps = 10.0
        self.stop_event = threading.Event()

        self.history = []          # [herbivores, carnivores] per tick
        self.fit_history = []      # mean lifetime fitness per tick
        self.snap_json = b"{}"
        self.snap_gzip = b""

        self.last_seen = time.time()
        self.viewers = 0
        self.steps_since_save = 0
        self.longest_lived = None  # the single best creature ever recorded

        self._build()

    # -- world ----------------------------------------------------------------
    def _seed(self, role):
        """Founder genome: a champion when we have one, otherwise fresh."""
        return self.hall.sample(role) or neuro.seed_genome(role)

    def _build(self):
        self.role = {g: ("carn" if g >= self.n_families - self.carn_families else "herb")
                     for g in range(self.n_families)}
        self.env = EvoEnvironment(
            width=self.width, height=self.height, grid_size=24,
            max_agents=self.max_agents, pastel_colors=False,
            brains=[_Placeholder() for _ in range(self.n_families)],
            training=False, static_families=True, limit_reproduction=False,
            mut_sigma=self.mut_sigma, seed_fn=self._seed, role_of=self.role,
            food_density=self.food_density)
        self.env.reset()
        self.history = []
        self.fit_history = []
        self._refresh()

    def reset(self):
        with self.lock:
            self._build()

    # -- simulation -----------------------------------------------------------
    def _policy(self, a):
        if self.brainmode == "neuro":
            return neuro.decide(a.state, a.genome, a.prev_action)
        return eco.decide(a.state, a.genome)

    def step(self):
        env = self.env
        env.mut_sigma = self.mut_sigma
        for a in env.evolve_step(self._policy):
            score = evolution.fitness(a)
            self.hall.offer(a.genome, score)
            best = self.longest_lived
            if best is None or score > best["score"]:
                self.longest_lived = {
                    "score": round(score, 1), "age": int(a.age),
                    "generation": int(getattr(a, "generation", 0)),
                    "offspring": int(getattr(a, "offspring", 0)),
                    "eaten": int(getattr(a, "eaten", 0)),
                    "kills": int(getattr(a, "kills", 0)),
                    "diet": round(float(a.genome["diet"]), 2),
                    "carn": bool(neuro.is_carnivore(a.genome)),
                    "color": neuro.color_for(a.genome),
                    "tick": int(env.tick)}

        herb = sum(1 for a in env.agents if not neuro.is_carnivore(a.genome))
        self.history.append([herb, len(env.agents) - herb])
        self.fit_history.append(
            round(float(np.mean([evolution.fitness(a) for a in env.agents])), 1)
            if env.agents else 0.0)
        if len(self.history) > HISTORY:
            del self.history[:-HISTORY]
            del self.fit_history[:-HISTORY]

        self.steps_since_save += 1
        if self.steps_since_save >= SAVE_EVERY:
            self.steps_since_save = 0
            self.hall.save()
        self._refresh()

    def idle(self):
        return self.idle_timeout > 0 and (time.time() - self.last_seen) > self.idle_timeout

    def touch(self):
        self.last_seen = time.time()

    def run_forever(self):
        """Step on a deadline so the requested rate is honoured regardless of
        how long a tick takes, and stand down entirely when nobody is watching."""
        next_at = time.perf_counter()
        while not self.stop_event.is_set():
            if not self.running or self.idle():
                next_at = time.perf_counter()
                self.stop_event.wait(0.15)
                continue
            with self.lock:
                self.step()
            next_at += 1.0 / max(1.0, self.fps)
            delay = next_at - time.perf_counter()
            if delay < -1.0:                 # fell far behind: give up the debt
                next_at = time.perf_counter()
            elif delay > 0:
                self.stop_event.wait(delay)

    # -- snapshot -------------------------------------------------------------
    def snapshot(self):
        with self.lock:
            env = self.env
            grid = env.grid.get_numpy()

            def coords(v):
                ys, xs = np.where(grid == int(v))
                return [[int(y), int(x)] for y, x in zip(ys, xs)]

            agents, diets, wmags, lineages = [], [], [], {}
            for a in env.agents:
                g = a.genome
                diets.append(g["diet"])
                wm = float(np.mean(np.abs(g["W"]))) if "W" in g else 0.0
                wmags.append(wm)
                lin = int(getattr(a, "lineage", 0))
                lineages[lin] = lineages.get(lin, 0) + 1
                agents.append({
                    "uid": a.uid, "i": int(a.i), "j": int(a.j), "gene": int(a.gene),
                    "color": neuro.color_for(g), "carn": bool(neuro.is_carnivore(g)),
                    "diet": round(g["diet"], 2), "aggr": round(g["aggr"], 2),
                    "vision": int(g["vision"]), "mrate": round(float(g.get("mrate", 1.0)), 2),
                    "wmag": round(wm, 3),
                    "health": int(a.health), "maxHealth": int(a.max_health),
                    "age": int(a.age), "maxAge": int(a.max_age),
                    "fitness": round(evolution.fitness(a), 1),
                    "generation": int(getattr(a, "generation", 0)),
                    "lineage": lin,
                    "offspring": int(getattr(a, "offspring", 0)),
                    "eaten": int(getattr(a, "eaten", 0)),
                    "kills": int(getattr(a, "kills", 0)),
                    "killed": int(a.killed), "reproduced": bool(a.reproduced),
                })

            herb = sum(1 for a in agents if not a["carn"])
            hist, _ = np.histogram(diets, bins=10, range=(0.0, 1.0)) if diets \
                else (np.zeros(10, dtype=int), None)

            return {
                "width": self.width, "height": self.height,
                "tick": env.tick, "running": self.running and not self.idle(),
                "paused": not self.running, "idle": self.idle(),
                "fps": self.fps, "mutation": round(self.mut_sigma, 3),
                "brainmode": self.brainmode, "maxAgents": self.max_agents,
                "readonly": self.readonly, "preEvolved": self.pre_evolved,
                "viewers": self.viewers,
                "population": len(agents), "herbivores": herb,
                "carnivores": len(agents) - herb,
                "avgDiet": round(float(np.mean(diets)), 2) if diets else 0,
                "avgFitness": round(float(np.mean([a["fitness"] for a in agents])), 1) if agents else 0,
                "avgAge": round(float(np.mean([a["age"] for a in agents])), 1) if agents else 0,
                "brainSize": round(float(np.mean(wmags)), 3) if wmags else 0,
                "generation": int(env.max_generation),
                "births": int(env.births), "deaths": int(env.deaths),
                "rescues": int(env.rescues),
                "lineages": len(lineages),
                "dietHistogram": [int(x) for x in hist],
                "champion": self.longest_lived,
                "champions": {k: len(v) for k, v in self.hall.best.items()},
                "agents": agents,
                "food": coords(ET.food), "poison": coords(ET.poison),
                "superfood": coords(ET.super_food),
                "history": self.history[-HISTORY_SENT:],
                "fitHistory": self.fit_history[-HISTORY_SENT:],
            }

    def _refresh(self):
        """Serialize once per tick so every viewer just gets cached bytes."""
        try:
            body = json.dumps(self.snapshot()).encode()
        except (TypeError, ValueError):
            return
        self.snap_json = body
        self.snap_gzip = gzip.compress(body, 6)
        with self.wake:
            self.version += 1
            self.wake.notify_all()

    def wait_for_tick(self, seen, timeout):
        """Block until the snapshot moves past `seen`. Returns the new version,
        or the same one on timeout so the caller can send a keep-alive."""
        with self.wake:
            if self.version == seen:
                self.wake.wait(timeout)
            return self.version

    # -- control --------------------------------------------------------------
    MUTATING = {"play", "pause", "toggle", "reset", "step", "food", "fps",
                "mutation", "brain"}

    def control(self, cmd, v=None):
        if cmd not in self.MUTATING:
            return {"ok": False, "error": "unknown command"}, 400
        if self.readonly:
            return {"ok": False, "error": "this world is view-only"}, 403

        self.touch()
        with self.lock:
            if cmd == "play":
                self.running = True
            elif cmd == "pause":
                self.running = False
            elif cmd == "toggle":
                self.running = not self.running
            elif cmd == "reset":
                self._build()
            elif cmd == "step":
                if not self.running:
                    self.step()
            elif cmd == "food":
                self.env.add_food(max(1, min(400, int(float(v or 60)))))
            elif cmd == "fps":
                self.fps = max(1.0, min(30.0, float(v)))
            elif cmd == "mutation":
                self.mut_sigma = max(0.0, min(0.30, float(v)))
            elif cmd == "brain":
                if v not in ("neuro", "instinct"):
                    return {"ok": False, "error": "brain must be neuro or instinct"}, 400
                self.brainmode = v
        self._refresh()
        return {"ok": True, "running": self.running, "fps": self.fps,
                "mutation": round(self.mut_sigma, 3), "brainmode": self.brainmode}, 200

    def shutdown(self):
        self.stop_event.set()
        with self.wake:
            self.wake.notify_all()
        self.hall.save()


ENGINE = None            # set by main(); module import alone starts no threads


class RateLimiter:
    """Token bucket per client address, so one visitor cannot spam the world's
    controls (they are global — everyone shares one simulation)."""

    def __init__(self, rate=4.0, burst=12.0):
        self.rate, self.burst = rate, burst
        self.buckets = {}
        self.lock = threading.Lock()

    def allow(self, key):
        now = time.monotonic()
        with self.lock:
            tokens, last = self.buckets.get(key, (self.burst, now))
            tokens = min(self.burst, tokens + (now - last) * self.rate)
            if tokens < 1.0:
                self.buckets[key] = (tokens, now)
                return False
            self.buckets[key] = (tokens - 1.0, now)
            if len(self.buckets) > 4096:      # bound the table
                for k in [k for k, (_, t) in self.buckets.items() if now - t > 300]:
                    self.buckets.pop(k, None)
            return True


LIMITER = RateLimiter()
MAX_STREAMS = 64
_streams = threading.Semaphore(MAX_STREAMS)

FAVICON = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
    '<rect width="32" height="32" rx="7" fill="#0e1116"/>'
    '<circle cx="11" cy="12" r="4.5" fill="#39c6ff"/>'
    '<circle cx="21" cy="20" r="4.5" fill="#ff6a4d"/>'
    '<circle cx="21" cy="10" r="2.4" fill="#39d17a"/></svg>'
).encode()

STATIC = {
    "/sim.js": ("sim.js", "text/javascript; charset=utf-8"),
    "/seed_brains.json": ("seed_brains.json", "application/json"),
    "/preview.png": ("preview.png", "image/png"),
    "/evolvarium.gif": ("evolvarium.gif", "image/gif"),
}


class QuietServer(ThreadingHTTPServer):
    """A viewer closing its tab resets the connection mid-read. That is normal
    traffic, not a server fault, and it should not print a traceback."""

    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (BrokenPipeError, ConnectionResetError, TimeoutError)):
            return
        super().handle_error(request, client_address)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "Evolvarium"
    sys_version = ""

    def log_message(self, *args):
        pass

    # -- plumbing -------------------------------------------------------------
    def _client(self):
        fwd = self.headers.get("X-Forwarded-For", "")
        return fwd.split(",")[0].strip() or self.client_address[0]

    def _accepts_gzip(self):
        return "gzip" in (self.headers.get("Accept-Encoding") or "").lower()

    def _send(self, code, body, ctype="application/json", cache=None, gz=None,
              head_only=False):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()

        encoding = None
        if gz is not None and self._accepts_gzip() and len(gz) < len(body):
            body, encoding = gz, "gzip"
        elif encoding is None and len(body) > 1400 and self._accepts_gzip():
            body, encoding = gzip.compress(body, 6), "gzip"

        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if encoding:
            self.send_header("Content-Encoding", encoding)
            self.send_header("Vary", "Accept-Encoding")
        self.send_header("Cache-Control", cache or "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def _file(self, name, ctype, head_only=False, cache="public, max-age=3600"):
        for root in (PUBLIC, HERE):
            try:
                with open(os.path.join(root, name), "rb") as f:
                    data = f.read()
            except OSError:
                continue
            return self._send(200, data, ctype, cache=cache, head_only=head_only)
        return self._send(404, {"error": "not found"}, head_only=head_only)

    # -- routes ---------------------------------------------------------------
    def do_HEAD(self):
        self._route(head_only=True)

    def do_GET(self):
        self._route(head_only=False)

    def _route(self, head_only):
        try:
            u = urlparse(self.path)
            path = u.path

            if path in ("/", "/index.html"):
                ENGINE.touch()
                # The viewer is the app shell: it must never be served from a
                # stale cache after a deploy. Images below may be cached hard.
                return self._file("index.html", "text/html; charset=utf-8", head_only,
                                  cache="no-cache")

            if path == "/healthz":
                return self._send(200, {"ok": True, "tick": ENGINE.env.tick,
                                        "population": len(ENGINE.env.agents)},
                                  head_only=head_only)

            if path == "/favicon.svg" or path == "/favicon.ico":
                return self._send(200, FAVICON, "image/svg+xml",
                                  cache="public, max-age=86400", head_only=head_only)

            if path in STATIC:
                return self._file(*STATIC[path], head_only=head_only)

            if path == "/state":
                ENGINE.touch()
                return self._send(200, ENGINE.snap_json, gz=ENGINE.snap_gzip,
                                  head_only=head_only)

            if path == "/brains":
                return self._send(
                    200, ENGINE.hall.to_json(),
                    cache="no-store", head_only=head_only)

            if path == "/stream":
                if head_only:
                    return self._send(200, b"", "text/event-stream", head_only=True)
                return self._stream()

            if path == "/control":
                q = parse_qs(u.query)
                cmd = (q.get("cmd") or [""])[0]
                val = (q.get("v") or [None])[0]
                if not LIMITER.allow(self._client()):
                    return self._send(429, {"ok": False, "error": "slow down"},
                                      head_only=head_only)
                try:
                    body, code = ENGINE.control(cmd, val)
                except (TypeError, ValueError):
                    body, code = {"ok": False, "error": "bad value"}, 400
                return self._send(code, body, head_only=head_only)

            return self._send(404, {"error": "not found"}, head_only=head_only)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:                          # never leak a traceback
            try:
                self._send(500, {"error": exc.__class__.__name__}, head_only=head_only)
            except OSError:
                pass

    def _stream(self):
        """Push the snapshot to one viewer as Server-Sent Events.

        Viewers used to poll `/state` on a timer, which meant every browser paid
        a full request round trip per tick and saw the world a beat late. Here
        the tick itself wakes the connection.
        """
        if not _streams.acquire(blocking=False):
            return self._send(503, {"error": "too many streams"})

        ENGINE.viewers += 1
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")    # don't let nginx buffer
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            seen = -1
            while not ENGINE.stop_event.is_set():
                ENGINE.touch()
                version = ENGINE.wait_for_tick(seen, 15.0)
                if version == seen:
                    self.wfile.write(b": keep-alive\n\n")   # hold idle proxies open
                else:
                    seen = version
                    self.wfile.write(b"data: " + ENGINE.snap_json + b"\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            ENGINE.viewers = max(0, ENGINE.viewers - 1)
            _streams.release()


def build_engine(args):
    return SimEngine(
        width=args.width, height=args.height, n_families=args.families,
        carn_families=args.carnivore_families, max_agents=args.max_agents,
        mut_sigma=args.mutation, food_density=args.food_density,
        state_path=args.state, idle_timeout=args.idle_timeout,
        readonly=args.readonly)


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Evolvarium live server")
    p.add_argument("port", nargs="?", type=int,
                   default=_env_num("PORT", 8765, int), help="port to listen on")
    p.add_argument("--host", default=os.environ.get("HOST", "0.0.0.0"))
    p.add_argument("--width", type=int, default=_env_num("EVO_WIDTH", 34, int))
    p.add_argument("--height", type=int, default=_env_num("EVO_HEIGHT", 34, int))
    p.add_argument("--families", type=int, default=_env_num("EVO_FAMILIES", 6, int))
    p.add_argument("--carnivore-families", type=int,
                   default=_env_num("EVO_CARN_FAMILIES", 3, int))
    p.add_argument("--max-agents", type=int, default=_env_num("EVO_MAX_AGENTS", 140, int))
    p.add_argument("--mutation", type=float, default=_env_num("EVO_MUTATION", 0.08))
    p.add_argument("--food-density", type=float,
                   default=_env_num("EVO_FOOD_DENSITY", evolution.FOOD_DENSITY))
    p.add_argument("--state", default=os.environ.get("EVO_STATE"),
                   help="where champion genomes are stored")
    p.add_argument("--idle-timeout", type=float,
                   default=_env_num("EVO_IDLE_TIMEOUT", 90.0),
                   help="pause the world after N seconds with no viewers (0 = never)")
    p.add_argument("--readonly", action="store_true",
                   default=_env_flag("EVO_READONLY"),
                   help="serve the world but reject every control command")
    return p.parse_args(argv)


def main(argv=None):
    global ENGINE
    args = parse_args(argv)
    ENGINE = build_engine(args)

    threading.Thread(target=ENGINE.run_forever, daemon=True, name="sim").start()
    srv = QuietServer((args.host, args.port), Handler)

    mode = " (view-only)" if args.readonly else ""
    seeded = f"{ENGINE.hall.loaded} champion genomes" if ENGINE.pre_evolved else "fresh genomes"
    print(f"Evolvarium -> http://{args.host}:{args.port}{mode}  [{seeded}]  (Ctrl+C to stop)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nsaving champions...")
    finally:
        ENGINE.shutdown()
        srv.shutdown()
        srv.server_close()


if __name__ == "__main__":
    main()
