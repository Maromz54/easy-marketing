# VPS Worker — Setup Guide

Facebook Group Publisher that runs 24/7 on a Linux VPS using Playwright browser automation.

## Requirements

- Ubuntu 20.04+ VPS, **1 GB RAM minimum** (2 GB recommended)
- Node.js 20+
- pm2 (process manager)

---

## 1. Install Node.js & pm2

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install -g pm2
```

---

## 2. Install xvfb (Virtual Display)

The worker runs with `HEADLESS=false` for anti-detection. On a server without a monitor, xvfb provides a virtual display.

```bash
sudo apt-get install -y xvfb

# Start xvfb on display :99 (do this now for the current session)
Xvfb :99 -screen 0 1280x900x24 &
export DISPLAY=:99

# To auto-start xvfb on reboot, create a systemd unit:
sudo tee /etc/systemd/system/xvfb.service > /dev/null <<EOF
[Unit]
Description=Xvfb virtual display
After=network.target

[Service]
ExecStart=/usr/bin/Xvfb :99 -screen 0 1280x900x24
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable xvfb
sudo systemctl start xvfb
```

---

## 3. Upload and Install

```bash
# From your laptop — upload the vps-worker folder
scp -r vps-worker/ ubuntu@YOUR_VPS_IP:/home/ubuntu/

# On the VPS
cd /home/ubuntu/vps-worker
npm install
npx playwright install chromium
npx playwright install-deps chromium
```

---

## 4. Configure Environment

```bash
cp .env.example .env
nano .env
```

Fill in:
- `SUPABASE_URL` — your Supabase project URL (e.g. `https://xxxx.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY` — the service role key from Supabase → Settings → API

---

## 5. Run SQL Migration

Open **Supabase Dashboard → SQL Editor** and paste the contents of `migration.sql`, then click **Run**.

This adds the `retry_count` column and the `claim_next_group_post()` function.

---

## 6. ONE-TIME: Log in to Facebook

This opens a visible browser window (via xvfb) where you log into Facebook. The session (cookies) is saved to `/home/ubuntu/fb-session` and reused on every restart.

```bash
DISPLAY=:99 node src/index.js --setup
```

A Chromium window will open. Log into Facebook with your account. When done, press **Ctrl+C** in the terminal.

> **Alternative (SSH X11 forwarding from your laptop):**
> ```bash
> ssh -X ubuntu@YOUR_VPS_IP
> cd /home/ubuntu/vps-worker
> DISPLAY=:0 node src/index.js --setup
> ```

---

## 7. Start the Worker

```bash
# IMPORTANT: DISPLAY must be set externally — NOT inside Playwright launch args
DISPLAY=:99 pm2 start ecosystem.config.cjs

pm2 save                  # persist pm2 config across reboots
pm2 startup               # follow the printed command to enable auto-start
```

---

## Monitoring

```bash
pm2 logs fb-group-publisher --lines 100    # live logs
pm2 status                                  # worker health
ls /home/ubuntu/fb-errors/                 # screenshots from failed posts
```

---

## Re-logging In (Session Expired)

If the worker stops with `FATAL SESSION_EXPIRED`:

```bash
pm2 stop fb-group-publisher
DISPLAY=:99 node src/index.js --setup
# Log in to Facebook again, then Ctrl+C
pm2 start fb-group-publisher
```

---

## Notes

| Setting | Value |
|---------|-------|
| Session folder | `/home/ubuntu/fb-session` (absolute, survives updates) |
| Error screenshots | `/home/ubuntu/fb-errors/post-{id}-{timestamp}.png` |
| Browser restart | Every 12 posts (prevents memory leak) |
| Post timeout | 60 seconds (prevents infinite hangs) |
| Delay between posts | 2–5 minutes (random, anti-ban) |
| Min gap per group | 10 minutes (prevents spam detection) |
| Max retries | 2 (exponential backoff: 90s → 180s) |
| Worker instances | **1** (single browser session, never run multiple) |

---

## What This Worker Handles

- Group posts (`facebook_token_id IS NULL` + `target_id IS NOT NULL`)

## What the Vercel Cron Still Handles

- Page posts (`facebook_token_id IS NOT NULL`)

## What the Chrome Extension Still Handles

- Group sync (scraping group list)
- BUMP feature
