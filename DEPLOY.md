# Deploying Evolvarium to your website

Two deployments live in this repo and they are independent:

- **The site** — `web-react/`, a Next.js app that runs the whole simulation in the
  visitor's browser. This is what is live at <https://bariszorlu.com/Evolvarium>.
  No server, nothing to keep running. See **[The live site](#the-live-site--bariszorlucomevolvarium)** below.
- **The Python service** — `web/server.py`, one shared world stepped server-side
  and pushed to viewers over SSE. Optional; only needed if you want every visitor
  watching the *same* world, or want champions evolving while nobody is looking.
  See **Options A–C** below.

---

## The live site — bariszorlu.com/Evolvarium

`bariszorlu.com` is a Next.js app on Vercel. Evolvarium is a **separate Vercel
project** and the parent site proxies the sub-path to it, the same way `/gallery`
and `/CoreShift` work. Three pieces have to agree:

**1. `web-react/next.config.js` — `basePath`.** The visitor's URL bar says
`/Evolvarium`, so the bundle must ask for `/Evolvarium/_next/...`. Without this the
client would request `/_next/...` and hit the parent site instead:

```js
const basePath = '/Evolvarium'
const nextConfig = { basePath, env: { NEXT_PUBLIC_BASE_PATH: basePath } }
```

`basePath` covers routes, `next/link`, `next/image` and static assets. It does
**not** cover plain `fetch()` URLs or metadata images, which is why
`NEXT_PUBLIC_BASE_PATH` is exported and used in `hooks/use-evolvarium.ts`
(`seed_brains.json`) and `app/layout.tsx` (the OG image).

**2. The Vercel project.** Import `bariszorlu35/Evolvarium`, set **Root Directory**
to `web-react` — the repo root is a Python project and Vercel would otherwise try
to build that. Framework preset: Next.js. Production branch: `main`.

**3. The rewrite in the `bariszorlu.com` repo** (`vercel.json`):

```json
{ "source": "/Evolvarium",         "destination": "https://evolvarium-chi.vercel.app/Evolvarium" },
{ "source": "/Evolvarium/:path*",  "destination": "https://evolvarium-chi.vercel.app/Evolvarium/:path*" }
```

Both entries are needed: the first for the page itself, the second for `_next/`
assets, `seed_brains.json` and everything else underneath.

After that, `git push` to `main` redeploys the Evolvarium project and the parent
site picks it up immediately — the rewrite points at the production alias, not at
a fixed deployment.

---

## The Python service

Evolvarium's optional server computes one shared simulation and serves the page.
To put *that* on your site you: (1) run it on a host, (2) expose it over HTTPS,
(3) embed it with an `<iframe>`. Pick **Option A** (managed host, easiest),
**Option B** (Docker), or **Option C** (your own VPS, full control).

Requirement on the host: **Python 3.9+** and **numpy** only.

---

## Configuration

Everything has a sensible default; set these only if you want to change it.

| Variable | Default | What it does |
|---|---|---|
| `PORT` / `HOST` | `8765` / `0.0.0.0` | where to listen (most platforms set `PORT` for you) |
| `EVO_READONLY` | `0` | `1` serves the world but rejects every control command — use it for a public embed |
| `EVO_IDLE_TIMEOUT` | `90` | pause the simulation after this many seconds with no viewers (`0` = always run) |
| `EVO_MAX_AGENTS` | `140` | population ceiling — the main CPU knob |
| `EVO_WIDTH` / `EVO_HEIGHT` | `34` | world size |
| `EVO_FAMILIES` / `EVO_CARN_FAMILIES` | `6` / `3` | how many families, and how many of them start out predatory |
| `EVO_FOOD_DENSITY` | `0.16` | share of cells that plants regrow toward |
| `EVO_MUTATION` | `0.08` | starting mutation rate (visitors can change it live) |
| `EVO_STATE` | `web/seed_brains.json` | where champion genomes are saved |

The same options exist as flags: `python web/server.py --help`.

---

## Option A — Managed host (no Linux administration)
1. Push this project to a Git repo (GitHub/GitLab).
2. On a Python-friendly platform (Render, Railway, Fly.io) create a new
   **Web Service** and connect the repo.
3. Settings:
   - **Build command:** `pip install -r requirements.txt`
   - **Start command:** `python web/server.py`
   - **Health check path:** `/healthz`
   - The platform provides a `PORT` env var — `server.py` already reads it and
     binds `0.0.0.0`, so no change is needed.
4. Deploy → you get an HTTPS URL like `https://evolvarium.onrender.com`.

On Render you can skip steps 2–3 entirely: the repo ships a `render.yaml`, so
pointing a **Blueprint** at it configures the service for you.

> Some free tiers put idle apps to sleep. That is fine here — the world pauses
> when nobody is watching anyway and resumes on the next visit.

---

## Option B — Docker
```bash
docker build -t evolvarium .
docker run -p 8765:8765 -v evolvarium-data:/app/web evolvarium
```
The volume keeps `seed_brains.json`, so the world keeps the brains it evolved
across restarts. Behind a reverse proxy, pass configuration through as usual:
```bash
docker run -p 8765:8765 -e EVO_READONLY=1 -e EVO_MAX_AGENTS=100 evolvarium
```

---

## Option C — Your own VPS (Ubuntu)
Assumes Ubuntu 22.04/24.04 and a (sub)domain such as `life.yourdomain.com`
with a DNS **A record** pointing to the server's IP. Replace `USER`/domain.

**1. Create the server & DNS** — a small VPS (1 vCPU / 1 GB) is plenty. Point
`life.yourdomain.com` at its IP.

**2. Copy the project up**
```bash
scp -r Evolvarium USER@SERVER_IP:~/evolvarium
# or on the server:  git clone <your-repo> ~/evolvarium
```

**3. Install Python + numpy**
```bash
sudo apt update && sudo apt install -y python3 python3-venv
cd ~/evolvarium
python3 -m venv venv && . venv/bin/activate
pip install -r requirements.txt
```

**4. Quick test**
```bash
PORT=8765 python web/server.py      # prints: Evolvarium -> http://0.0.0.0:8765
```
Open `http://SERVER_IP:8765` to confirm, then Ctrl+C.

**5. Keep it running 24/7 (systemd)** — create `/etc/systemd/system/evolvarium.service`:
```ini
[Unit]
Description=Evolvarium
After=network.target
[Service]
WorkingDirectory=/home/USER/evolvarium
Environment=PORT=8765
Environment=EVO_IDLE_TIMEOUT=90
ExecStart=/home/USER/evolvarium/venv/bin/python web/server.py
Restart=always
User=USER
[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now evolvarium
sudo systemctl status evolvarium      # should say active (running)
```

**6. HTTPS with nginx + Let's Encrypt**
```bash
sudo apt install -y nginx
```
Create `/etc/nginx/sites-available/evolvarium`:
```nginx
server {
    server_name life.yourdomain.com;
    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # The viewer is fed by Server-Sent Events. Without these three lines
        # nginx buffers the stream and the world appears frozen (the page will
        # fall back to polling, but it will be a beat behind).
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_read_timeout 1h;
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/evolvarium /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d life.yourdomain.com    # free TLS certificate
```
Now it's live at `https://life.yourdomain.com`.

Cloudflare users: turn **off** proxying (grey cloud) for this hostname, or the
SSE stream is buffered there instead.

---

## Embed on your website
Paste where you want it (replace the URL):
```html
<iframe src="https://life.yourdomain.com"
        style="width:100%;max-width:1100px;height:900px;border:0;border-radius:12px"
        loading="lazy" title="Evolvarium"></iframe>
```
For a public embed, run the service with `EVO_READONLY=1`. Visitors still get
the live world, the charts and the creature inspector; the buttons are disabled
and the server rejects control requests, so nobody can pause or reset the world
for everyone else.

## Production notes
- **One shared world.** Every visitor watches the same simulation. Controls are
  global, which is why `EVO_READONLY` exists. Control requests are also rate
  limited per client address.
- **CPU.** The world only steps while someone is watching (`EVO_IDLE_TIMEOUT`),
  and each tick is serialised once and reused for every viewer, so cost scales
  with world size rather than with audience size. `EVO_MAX_AGENTS` is the knob
  if a small instance struggles.
- **Concurrent viewers.** Up to 64 simultaneous event streams; beyond that the
  page automatically falls back to polling.
- **Persistence.** Champion genomes are written to `EVO_STATE` periodically and
  on shutdown. On a read-only filesystem saving is skipped silently and the
  world simply starts fresh each boot.
- **Dependencies:** numpy only.
