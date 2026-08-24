"""Self-contained checks for the Evolvarium simulation and server.

Run directly (no pytest needed):   python tests/test_evolvarium.py
Or under pytest:                   pytest tests/

Every test here pins down something that was actually broken at some point, so
a failure means a real regression rather than a style preference.
"""
import os
import sys
import json
import gzip
import time
import random
import socket
import threading
import warnings
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
warnings.filterwarnings("ignore", message=".*torch-based brains unavailable.*")

import numpy as np                                                   # noqa: E402
from ReinLife.World.environment import Environment                   # noqa: E402
from ReinLife.Models.utils import BasicBrain                         # noqa: E402
from web import ecosystem as eco, neuro, evolution                   # noqa: E402
from web.evolution import EvoEnvironment                             # noqa: E402
from web import server as srv                                        # noqa: E402


class _Placeholder(BasicBrain):
    def __init__(self):
        super().__init__(153, 8, "DQN")

    def get_action(self, state, n_epi=0):
        return 0

    def learn(self, **kwargs):
        pass


def make_world(seed=0, width=26, height=26, max_agents=90, **kw):
    random.seed(seed)
    np.random.seed(seed)
    families = kw.pop("families", 6)
    carn = kw.pop("carn_families", 2)
    role = {g: ("carn" if g >= families - carn else "herb") for g in range(families)}
    env = EvoEnvironment(
        width=width, height=height, grid_size=24, max_agents=max_agents,
        pastel_colors=False, brains=[_Placeholder() for _ in range(families)],
        training=False, static_families=True, limit_reproduction=False,
        mut_sigma=0.08, seed_fn=neuro.seed_genome, role_of=role, **kw)
    env.reset()
    return env


def run(env, ticks, policy=None):
    policy = policy or (lambda a: neuro.decide(a.state, a.genome, a.prev_action))
    dead = []
    for _ in range(ticks):
        dead.extend(env.evolve_step(policy))
    return dead


# --------------------------------------------------------------- perception --
def test_creatures_can_see_each_other():
    """Regression: `_get_genes` reported the gene of *dead* agents and hid every
    living one, so the kinship channel of every observation was always zero and
    no predator could ever find prey."""
    env = make_world(seed=1)
    run(env, 12)
    seen_kin = seen_other = False
    for a in env.agents:
        kin = np.asarray(a.state)[98:147]
        seen_kin |= bool((kin == 1).any())
        seen_other |= bool((kin == -1).any())
    assert seen_kin, "no creature can see a relative"
    assert seen_other, "no creature can see a non-relative"


def test_observations_match_the_reference_implementation():
    """The fast observation builder must be numerically identical to the core
    one it replaces."""
    env = make_world(seed=2, width=22, height=18, max_agents=60)
    for _ in range(25):
        env.evolve_step(lambda a: neuro.decide(a.state, a.genome, a.prev_action))
        fast = {id(a): a.state_prime.copy() for a in env.agents}
        Environment._get_observations(env)
        for a in env.agents:
            assert np.allclose(fast[id(a)], a.state_prime, atol=1e-12)


def test_observation_shape():
    env = make_world(seed=3)
    run(env, 5)
    for a in env.agents:
        assert np.asarray(a.state).shape == (153,)


# ------------------------------------------------------------------ genomes --
def test_every_agent_always_has_a_genome():
    env = make_world(seed=4)
    for _ in range(60):
        env.evolve_step(lambda a: neuro.decide(a.state, a.genome, a.prev_action))
        for a in env.agents:
            assert getattr(a, "genome", None) is not None
            assert a.genome["W"].shape == (neuro.N_W,)


def test_weights_stay_bounded_across_generations():
    """Regression: mutation was an unbounded random walk, so after enough
    generations the evolved residual dwarfed the instinct it refines and
    lineages became *worse* the longer they evolved."""
    g = neuro.seed_genome("herb")
    for _ in range(400):
        g = neuro.mutate(g, 0.3)          # the highest mutation the UI allows
    assert np.all(np.isfinite(g["W"]))
    assert float(np.abs(g["W"]).max()) <= neuro.W_CLIP + 1e-6
    assert float(np.mean(np.abs(g["W"]))) < 1.5


def test_breeding_mixes_both_parents():
    a = neuro.seed_genome("herb")
    b = neuro.seed_genome("carn")
    a["W"] = np.full(neuro.N_W, -1.0, dtype=np.float32)
    b["W"] = np.full(neuro.N_W, 1.0, dtype=np.float32)
    child = neuro.breed(a, b, 0.0)
    assert (child["W"] > 0).any() and (child["W"] < 0).any(), "child took only one parent"
    assert min(a["diet"], b["diet"]) - 1e-6 <= child["diet"] <= max(a["diet"], b["diet"]) + 1e-6


def test_genome_survives_a_json_round_trip():
    g = neuro.seed_genome("carn")
    back = neuro.from_json(json.loads(json.dumps(neuro.to_json(g))))
    for key in ("diet", "aggr", "mrate"):
        assert abs(back[key] - g[key]) < 1e-3
    assert back["vision"] == g["vision"]
    assert np.allclose(back["W"], g["W"], atol=1e-3)


def test_json_round_trip_repairs_a_stale_weight_vector():
    """Older saved brains must not crash a newer architecture."""
    g = neuro.from_json({"diet": .2, "aggr": .3, "vision": 3, "W": [0.1] * 12})
    assert g["W"].shape == (neuro.N_W,)


def test_decide_survives_hostile_input():
    g = neuro.seed_genome("herb")
    g["W"] = np.full(neuro.N_W, neuro.W_CLIP, dtype=np.float32)
    for state in (np.zeros(153), np.full(153, 1e6), np.full(153, -1e6)):
        assert 0 <= neuro.decide(state, g, 7) < 8
    assert 0 <= eco.decide(np.zeros(153), g) < 8


# ------------------------------------------------------------------ ecology --
def test_diet_decides_what_food_is_worth():
    """A plant should barely feed a specialist predator and a kill should barely
    feed a grazer — otherwise hunting is strictly worse than grazing and the
    predator niche collapses."""
    assert evolution.plant_value(0.0) > 4 * evolution.plant_value(1.0)
    assert evolution.meat_value(1.0) > 4 * evolution.meat_value(0.0)
    assert evolution.meat_value(1.0) > evolution.plant_value(0.0)


def test_reproduction_is_earned_and_costly():
    env = make_world(seed=5)
    run(env, 30)
    parents = [a for a in env.agents if getattr(a, "offspring", 0) > 0]
    assert parents, "nothing reproduced in 30 ticks"
    assert env.births > 0
    # A creature below the health threshold must never breed.
    for a in env.agents:
        a.health = 10
        assert env._repro_chance(a) == 0.0
    for a in env.agents:
        a.health = a.max_health
        assert env._repro_chance(a) > 0.0


def test_offspring_inherit_from_their_actual_parent():
    env = make_world(seed=6)
    run(env, 40)
    children = [a for a in env.agents if getattr(a, "parent_uid", None)]
    assert children, "no parented offspring appeared"
    for c in children:
        assert c.generation >= 1
        assert c.lineage != 0


def test_population_survives_without_being_propped_up():
    """Regression: the world used to be sustained by random spawning rather than
    by reproduction, which meant selection barely mattered."""
    env = make_world(seed=7, width=34, height=34, max_agents=140)
    run(env, 400)
    assert len(env.agents) > 20, f"population collapsed to {len(env.agents)}"
    assert env.max_generation >= 5, "no generational turnover"
    assert env.rescues <= 4, f"world needed {env.rescues} rescues to stay alive"


def test_an_empty_niche_is_eventually_refilled():
    env = make_world(seed=8, width=34, height=34, max_agents=140)
    run(env, 60)
    for a in env.agents:                       # wipe out every predator
        a.genome["diet"] = 0.1
    run(env, evolution.NICHE_ABSENT_TICKS + 80)
    assert env.immigrations > 0, "the predator niche was never refilled"


def test_food_regrows_toward_its_target_density():
    env = make_world(seed=9, width=30, height=30, max_agents=80, food_density=0.16)
    run(env, 40)
    grid = env.grid.get_numpy()
    share = float((grid == env.entities.food).sum()) / (env.width * env.height)
    assert 0.05 < share < 0.30, f"food density drifted to {share:.2f}"


# ------------------------------------------------------------- hall of fame --
def test_hall_of_fame_round_trips(tmp_path=None):
    path = os.path.join(os.environ.get("TMPDIR", "/tmp"), "evo_hall_test.json")
    hall = srv.HallOfFame(path, size=4)
    for i in range(10):
        hall.offer(neuro.seed_genome("herb" if i % 2 else "carn"), float(i))
    assert len(hall.best["herb"]) <= 4
    assert hall.best["herb"] == sorted(hall.best["herb"], key=lambda x: -x[0])
    assert hall.save()

    again = srv.HallOfFame(path, size=4)
    assert again.load() == sum(len(v) for v in hall.best.values())
    assert again.sample("herb") is not None
    assert srv.HallOfFame(path + ".missing").load() == 0
    os.unlink(path)


def test_hall_of_fame_survives_a_read_only_location():
    hall = srv.HallOfFame("/proc/definitely/not/writable/brains.json")
    hall.offer(neuro.seed_genome("herb"), 1.0)
    assert hall.save() is False and hall.writable is False


# -------------------------------------------------------------------- engine --
def make_engine(**kw):
    kw.setdefault("width", 24)
    kw.setdefault("height", 24)
    kw.setdefault("max_agents", 60)
    kw.setdefault("state_path", os.path.join(os.environ.get("TMPDIR", "/tmp"),
                                             "evo_engine_test.json"))
    kw.setdefault("idle_timeout", 0)
    return srv.SimEngine(**kw)


def test_snapshot_is_serializable_and_complete():
    engine = make_engine()
    for _ in range(15):
        engine.step()
    snap = json.loads(engine.snap_json)
    for key in ("width", "tick", "population", "agents", "food", "history",
                "generation", "births", "deaths", "dietHistogram", "champion"):
        assert key in snap, f"snapshot is missing {key}"
    assert len(snap["dietHistogram"]) == 10
    assert json.loads(gzip.decompress(engine.snap_gzip)) == snap
    for a in snap["agents"]:
        assert {"uid", "i", "j", "color", "generation", "offspring"} <= set(a)


def test_control_rejects_bad_input_instead_of_crashing():
    engine = make_engine()
    assert engine.control("nonsense")[1] == 400
    assert engine.control("brain", "telepathy")[1] == 400
    for bad in ("abc", None, ""):
        try:
            _, code = engine.control("fps", bad)
            assert code in (200, 400)
        except (TypeError, ValueError):
            pass          # the handler converts these into a 400 response


def test_control_clamps_values():
    engine = make_engine()
    engine.control("fps", "9999")
    assert engine.fps <= 30
    engine.control("mutation", "-5")
    assert engine.mut_sigma >= 0
    engine.control("food", "100000")
    assert len(engine.env.agents) >= 0


def test_readonly_engine_refuses_every_control():
    engine = make_engine(readonly=True)
    before = engine.env.tick
    for cmd in ("pause", "reset", "step", "food", "fps", "brain"):
        body, code = engine.control(cmd, "1")
        assert code == 403 and body["ok"] is False
    assert engine.env.tick == before


def test_idle_worlds_stop_stepping():
    engine = make_engine(idle_timeout=0.2)
    assert not engine.idle()
    engine.last_seen = time.time() - 5
    assert engine.idle()
    engine.touch()
    assert not engine.idle()


def test_rate_limiter_lets_bursts_through_then_throttles():
    limiter = srv.RateLimiter(rate=0.0, burst=3)
    assert [limiter.allow("x") for _ in range(3)] == [True, True, True]
    assert limiter.allow("x") is False
    assert limiter.allow("someone-else") is True


# ---------------------------------------------------------------------- HTTP --
def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _get(url, headers=None, timeout=10):
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                body = gzip.decompress(body)
            return r.status, r.headers, body
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()


def test_http_server_end_to_end():
    port = _free_port()
    engine = make_engine(idle_timeout=0)
    srv.ENGINE = engine
    srv.LIMITER = srv.RateLimiter(rate=1000, burst=1000)
    threading.Thread(target=engine.run_forever, daemon=True).start()
    httpd = srv.QuietServer(("127.0.0.1", port), srv.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    try:
        code, _, body = _get(base + "/healthz")
        assert code == 200 and json.loads(body)["ok"] is True

        code, headers, body = _get(base + "/", timeout=10)
        assert code == 200 and b"<canvas id=\"world\"" in body
        assert b"cdnjs" not in body and b"<script src=\"http" not in body, \
            "the viewer must not depend on an external CDN"

        code, headers, body = _get(base + "/state", {"Accept-Encoding": "gzip"})
        assert code == 200 and headers.get("Content-Encoding") == "gzip"
        snap = json.loads(body)
        assert snap["width"] == engine.width

        code, _, body = _get(base + "/state")           # no gzip offered
        assert code == 200 and json.loads(body)["width"] == engine.width

        code, _, body = _get(base + "/control?cmd=pause")
        assert code == 200 and json.loads(body)["running"] is False
        code, _, body = _get(base + "/control?cmd=fps&v=notanumber")
        assert code == 400
        code, _, _ = _get(base + "/control?cmd=teleport")
        assert code == 400
        code, _, _ = _get(base + "/nope")
        assert code == 404

        code, _, body = _get(base + "/brains")
        assert code == 200 and set(json.loads(body)) == {"herb", "carn"}

        code, _, body = _get(base + "/favicon.svg")
        assert code == 200 and body.startswith(b"<svg")

        # the stream must deliver a full snapshot
        _get(base + "/control?cmd=play")
        with urllib.request.urlopen(base + "/stream", timeout=15) as r:
            assert r.headers["Content-Type"].startswith("text/event-stream")
            payload, deadline = b"", time.time() + 15
            while time.time() < deadline:
                line = r.readline()
                if line.startswith(b"data: "):
                    payload = line[6:]
                    break
            assert payload, "stream produced no snapshot"
            assert json.loads(payload)["width"] == engine.width
    finally:
        httpd.shutdown()
        httpd.server_close()
        engine.shutdown()


def test_argument_parsing():
    args = srv.parse_args(["9001", "--readonly", "--max-agents", "42"])
    assert args.port == 9001 and args.readonly and args.max_agents == 42
    assert srv.parse_args([]).port > 0


# ------------------------------------------------------------------- runner --
def main():
    tests = [(n, f) for n, f in sorted(globals().items())
             if n.startswith("test_") and callable(f)]
    failed = []
    for name, fn in tests:
        t0 = time.time()
        try:
            fn()
            print("  ok    %-52s %5.1fs" % (name, time.time() - t0))
        except Exception as exc:
            failed.append(name)
            print("  FAIL  %-52s %5.1fs  %s: %s"
                  % (name, time.time() - t0, exc.__class__.__name__, exc))
    print("\n%d passed, %d failed, %d total" % (len(tests) - len(failed), len(failed), len(tests)))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
