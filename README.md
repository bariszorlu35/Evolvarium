# Evolvarium — Evolving Artificial Life

An open-ended artificial-life simulation: synthetic creatures live in an
ecosystem and their **neural-network brains evolve in real time**. Watch it
live in your browser.

![Evolvarium — herbivores (cyan) hunt-and-flee carnivores (orange), with neural-net brains evolving live](web/evolvarium.gif)

## Run locally
```bash
pip install numpy
python web/server.py        # then open http://localhost:8765
```
Only **numpy** is required. (`torch`, `pygame`, `matplotlib` are optional and not needed.)

## What you see
- **Herbivores** (cyan→blue) eat plants and flee predators; **carnivores**
  (orange→red) hunt other creatures. Colour = diet, and it shifts as a creature evolves.
- Each creature carries a tiny **neural network** (pure numpy) in its genome.
  On reproduction the weights **mutate**; longer-lived creatures reproduce more,
  so good brains spread by **natural selection**. The previous action is fed back
  as a short memory. Starting brains are **pre-evolved**.
- Controls: play/pause, single step, add plants, reset, speed, mutation, and a
  **Neural net ↔ Instinct** toggle. Click any creature for its details. Live
  species-population and average-fitness charts.

## No training, no end
Evolution happens **live** — there is no separate training step. The simulation
is **open-ended**: the population goes through boom/bust cycles and reseeds
itself if it dies out. Use **Reset** to start over.

## Files
- `web/server.py` — HTTP server + background simulation loop + control API
- `web/ecosystem.py` — genome, mutation, predator/prey logic, colours
- `web/neuro.py` — numpy neural-net brains (neuro-evolution)
- `web/evolve.py` — headless pre-evolution → `web/seed_brains.json`
- `web/index.html` — the live viewer (canvas + charts + info panel)
- `ReinLife/` — the underlying grid environment

## Put it on your website
See **DEPLOY.md** for step-by-step instructions (managed host or your own VPS) and the iframe embed snippet.

Built on the ReinLife environment (MIT).
