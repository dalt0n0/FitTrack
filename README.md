# FitTrack

A self-hosted personal fitness tracker with persistent server-side storage. Track workouts, body stats, nutrition, and progress over time — all in a clean dark UI.

## Features

- **Dashboard** — weight trend, today's macros, recent workouts, workout streak
- **Workouts** — log exercises with sets/reps/weight, full history with expandable details
- **Body Stats** — track weight and body fat % over time with charts
- **Nutrition** — log daily calories and macros, 14-day calorie history, 7-day macro breakdown
- **Progress** — long-term charts for weight, body fat, calorie adherence, and strength per exercise
- **Settings** — set daily calorie/macro goals and target weight
- **Export / Import** — download or restore a full JSON backup

## Stack

- **Backend:** Node.js + Express
- **Storage:** JSON file (`data/db.json`) — no database required
- **Frontend:** Vanilla JS + Chart.js

## Getting Started

```bash
git clone https://github.com/dalt0n0/FitTrack.git
cd FitTrack
npm install
npm start
```

Open `http://localhost:3000`.

For auto-restart during development:

```bash
npm run dev
```

## Deploying on Linux

### 1. Install Node.js
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. Run with PM2
```bash
sudo npm install -g pm2
pm2 start server.js --name fittrack
pm2 save && pm2 startup
```

### 3. Nginx reverse proxy
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 4. HTTPS (optional, requires a domain)
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

## Data

All data is stored in `data/db.json`. This file is excluded from git — back it up regularly. To move it outside the project directory, update `DB_PATH` in `server.js`.

## License

MIT
