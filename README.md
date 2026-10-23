# Darkmoon Hub

A members' community for the unexplained: Google sign-in, chat rooms, direct messages, a notification inbox, member profiles with achievements, a forum, a marketplace, a shared map and an admin panel. Dark neon design, built for phones and desktops.

One Node.js server (`server.js`, Node 18+) serves the site and runs everything. Data is kept in a free Postgres database (Neon) when `DATABASE_URL` is set, or in one file, `data/db.json`, when it isn't. The only package is `pg`, for the database.

---

## Free hosting from a phone: Render + Neon ($0)

Render runs the site for free but wipes its files on every restart, so the data goes in a free Neon database instead.

1. **GitHub:** create a repository named `darkmoonhub` and upload this folder's contents (not the folder itself) to it.
2. **Neon** (<https://neon.com>): sign up, create a project, and copy the **connection string** (starts with `postgresql://`).
3. **Render** (<https://render.com>): sign up with GitHub. Choose **New → Blueprint**, pick the `darkmoonhub` repository, and Render reads `render.yaml` and sets up a free web service. It asks for three values:
   - `DATABASE_URL`: the Neon connection string
   - `ADMIN_EMAILS`: your Gmail address
   - `GOOGLE_CLIENT_ID`: see step 1 below. You can leave it blank for the first deploy, then add it under **Environment** and redeploy.
4. Open the `….onrender.com` address Render gives you. Add that address to Google as described below.

**Free-plan behaviour:** after 15 minutes without visitors the site sleeps, and the next visitor waits about a minute for it to wake. Nothing is lost. To keep it awake, add a free monitor at <https://uptimerobot.com> that checks `https://YOUR-SITE.onrender.com/api/health` every 5 minutes. One always-on site fits inside Render's 750 free hours a month.

## 1. Set up Google sign-in (about 10 minutes, once)

1. Go to <https://console.cloud.google.com/> and create a project (or pick one).
2. **APIs & Services → OAuth consent screen**: choose *External*, fill in the app name (e.g. Darkmoon Hub) and your email, and save. Under *Audience*, click **Publish app** so anyone can sign in.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - **Authorised JavaScript origins**: your site's address, e.g. `https://darkmoonhub.example.com`. For local testing also add `http://localhost:3000`.
   - No redirect URI is needed.
4. Copy the **Client ID** (it ends in `.apps.googleusercontent.com`). That's your `GOOGLE_CLIENT_ID`. No client secret is needed.

## 2. Configure

Set these environment variables on your host:

| Variable | Example | Purpose |
|---|---|---|
| `GOOGLE_CLIENT_ID` | `1234…apps.googleusercontent.com` | Enables Google sign-in. Required. |
| `ADMIN_EMAILS` | `you@gmail.com,friend@gmail.com` | These accounts become admins when they sign in. |
| `DATABASE_URL` | `postgresql://…neon.tech/neondb?sslmode=require` | Keep all data in Postgres (recommended on free hosts). |
| `DATA_DIR` | `/var/data` | Where `db.json` is stored when `DATABASE_URL` isn't set. Must survive restarts. |
| `PORT` | `3000` | Usually set by the host automatically. |
| `ALLOW_DEV_LOGIN` | `1` | **Testing only.** Adds a name+email sign-in without Google. Never enable it on the live site: anyone could sign in as anyone. |

Also open `public/assets/app.js` and set your Discord invite link at the top:

```js
DISCORD_URL:'https://discord.gg/YOUR-INVITE',
```

## 3. Run and deploy

```bash
npm install
GOOGLE_CLIENT_ID=… ADMIN_EMAILS=you@gmail.com node server.js
# → http://localhost:3000
```

The host needs to run Node, keep data (in Postgres or on a disk), and serve over **HTTPS** (Google sign-in and "Pin my location" on the map require it).

- **Render (free)**: see the Render + Neon steps at the top.
- **Railway / Fly.io**: same start command; attach a volume and point `DATA_DIR` at it.
- **VPS** (Hetzner, DigitalOcean, etc.): run under `pm2` or systemd behind Caddy or Nginx for HTTPS. If you use Nginx, turn proxy buffering off for `/api/stream` so live updates arrive instantly.

Static-only hosts (Netlify, GitHub Pages) can't run the server, so they can't host this site.

**Backups:** with Neon, use its built-in restore (history) or run `psql "$DATABASE_URL" -Atc "select v from darkmoon_store" > backup.json`. With file storage, copy `data/db.json`. To restore a file backup, stop the server, replace the file, and start it again.

---

## What's included

| Page | What it does |
|---|---|
| `index.html` | Community hub: buttons to every area and live previews of the forum, chat rooms, market and map. No landing page. |
| `chat.html` | Live chat rooms (signed-in members only). `@Name` mentions notify that member. |
| `dms.html` | Private one-to-one conversations, started from search or any profile |
| `inbox.html` | Notifications: new DMs, comments on your threads, mentions, achievements, moderation notices. The bell in the header shows the unread count live. |
| `profile.html#id` | Bio, activity counts, 10 community achievements (chat, forum, map, market, membership), threads, listings and pins |
| `forum.html` / `thread.html` | Threads with comments and search; author names link to profiles |
| `market.html` | Listings with title, description (where sellers put payment details), price and sold status; search; "Message seller" |
| `map.html` | Shared map: search places, pin your location or tap the map, add a title and description. Pins are locked when created; unlock to drag, then lock again. Owners and admins can edit or delete. |
| `admin.html` | Create, rename, reorder and delete chat rooms; search members; mute (1 hour to 30 days), unmute, ban, unban, and grant or remove admin |
| `contact.html` | The cryptic message with your Discord link |

**Moderation:** admins can delete any chat message, thread, comment, listing or pin from where it appears. In chat, admins also get quick "Mute 1h" and "Ban" buttons on each message. Muted members can read but can't post anywhere. Banned members are signed out at once and can't sign back in.

**Live updates** (chat, DMs, inbox badge, new rooms, map pins) use Server-Sent Events, which work through most hosts and proxies.

## Limits worth knowing

- **Scale:** the single-document database (one Postgres row or one file) suits a community of hundreds of active members. Chat keeps the latest 3,000 messages per room, DMs the latest 2,000 per conversation. For thousands of daily users, move to a real database.
- **Payments** happen between members, outside the site. The market shows a reminder to check a seller's profile before paying.
- **Map tiles and place search** use OpenStreetMap's free public services, which are fine for a community site. Heavy traffic would need a commercial tile provider; the URL is set in `pages/map.html`.

## Editing

Page bodies live in `pages/`; run `python3 build.py` to regenerate `public/*.html` with the shared header and footer. Styles are in `public/assets/style.css`, shared client code in `public/assets/app.js`.
