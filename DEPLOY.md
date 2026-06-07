# Deploying Evolvarium to your website

Evolvarium runs a small **Python server** that computes the simulation and serves
the page. To put it on your site you: (1) run that server on a host, (2) expose it
over HTTPS, (3) embed it with an `<iframe>`. Pick **Option A** (managed host,
easiest) or **Option B** (your own VPS, full control).

Requirement on the host: **Python 3.9+** and **numpy** only.

---

## Option A — Managed host (no Linux administration)
1. Push this project to a Git repo (GitHub/GitLab).
2. On a Python-friendly platform (e.g. Render, Railway, Fly.io) create a new
   **Web Service** and connect the repo.
3. Settings:
   - **Build command:** `pip install numpy`
   - **Start command:** `python web/server.py`
   - The platform provides a `PORT` env var — `server.py` already reads it and
     binds `0.0.0.0`, so no change needed.
4. Deploy → you get an HTTPS URL like `https://evolvarium.onrender.com`.
5. Embed it (see **Embed** below).

> Check the platform's current free/paid tiers and "always-on" setting — some
> put idle apps to sleep, which would pause the world between visitors.

---

## Option B — Your own VPS (Ubuntu)
Assumes Ubuntu 22.04/24.04 and a (sub)domain such as `life.yourdomain.com`
with a DNS **A record** pointing to the server's IP. Replace `USER`/domain.

**1. Create the server & DNS** — spin up a small VPS (1 vCPU / 1 GB is plenty),
note its public IP, and point `life.yourdomain.com` → that IP.

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
pip install numpy
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

---

## Embed on your website
Paste where you want it (replace the URL):
```html
<iframe src="https://life.yourdomain.com"
        style="width:100%;max-width:1100px;height:820px;border:0;border-radius:12px"
        loading="lazy" title="Evolvarium"></iframe>
```

## Production notes
- **One shared world:** by default every visitor watches the *same* simulation and
  the controls are global (anyone can pause/reset for everyone). For a public embed
  you may prefer it view-only, or a separate world per visitor — this can be added.
- **Always-on CPU:** the simulation keeps stepping in the background even with no
  viewers (light; fine on 1 vCPU). It can be made to pause when idle.
- **Dependencies:** numpy only.
