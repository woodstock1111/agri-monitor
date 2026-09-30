# Deployment Guide

## Server Entry Point

Run the Node.js backend:

```bash
node server.js
```

This backend serves both:

1. Static frontend files such as `index.html`, `app.js`, `app.css`, `harvest.css`, and `logo.jpg`.
2. Backend APIs under `/api/v1`.

Do not use Python as the main runtime for the current project. `proxy-server.py` is not the production entry point.

## Requirements

Use Node.js 20 or newer.

Check the version:

```bash
node -v
npm -v
```

Install dependencies from the project directory:

```bash
cd /var/www/agri-monitor
npm install
```

## Environment Variables

Optional environment variables:

```bash
PORT=3000
ADMIN_PASSWORD=admin123456
CLOUD_POLL_INTERVAL_MS=300000
```

Default values:

```text
PORT: 3000
ADMIN_PASSWORD: admin123456
CLOUD_POLL_INTERVAL_MS: 300000
```

WeChat mini program sign-in (docs/auth-design.md) needs the mini program's credentials in `.env`. Without them the
mini program cannot sign in; the web site is unaffected. Keep the secret out of git.

```bash
WECHAT_MINI_APPID=wxf8a730c56844e54c
WECHAT_MINI_SECRET=<AppSecret from 小程序后台 → 开发管理 → 开发设置>
```

AI models (DashScope, one key for everything) are listed in `lib/ai-models.js`; web and mini program both use
`qwen3.7-plus` with thinking off. Web models can be changed in 照片设置; the mini program's 小薯 follows
`MINI_AGENT_MODEL` in `.env` if set. When DashScope retires a model, update `lib/ai-models.js`.

Accounts and sessions live in PostgreSQL. On the first start after upgrading, accounts in `server-data/app-state.json`
are imported once into the `users` table (only while it is empty); the file is kept as a backup and is no longer read
for sign-in.

## Run With PM2

Start:

```bash
cd /var/www/agri-monitor
PORT=3000 pm2 start server.js --name agri-monitor
pm2 save
```

Restart after code changes:

```bash
pm2 restart agri-monitor
```

Check status:

```bash
pm2 list
pm2 status
```

Read logs:

```bash
pm2 logs agri-monitor
pm2 logs agri-monitor --lines 50
```

Stop:

```bash
pm2 stop agri-monitor
```

Delete PM2 process:

```bash
pm2 delete agri-monitor
```

Enable startup after server reboot:

```bash
pm2 startup
pm2 save
```

## Verify Backend

After starting the server, test locally on the server:

```bash
curl http://127.0.0.1:3000/api/v1/health
```

Expected result:

```json
{"ok":true}
```

If this fails, Nginx will show `502 Bad Gateway`.

Useful checks:

```bash
pm2 status
ss -lntp | grep node
pm2 logs agri-monitor --lines 50
```

Expected listener:

```text
0.0.0.0:3000
```

## Nginx On Port 80

Recommended production setup:

```text
Nginx :80 -> Node server.js :3000
```

Example config:

```nginx
server {
    listen 80 default_server;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Typical setup:

```bash
sudo apt update
sudo apt install nginx -y
sudo nano /etc/nginx/sites-available/agri-monitor
sudo ln -s /etc/nginx/sites-available/agri-monitor /etc/nginx/sites-enabled/agri-monitor
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

After this, visit:

```text
http://SERVER_IP
```

## 502 Bad Gateway Checklist

`502 Bad Gateway` means Nginx is running but Node is not reachable.

Check:

```bash
curl http://127.0.0.1:3000/api/v1/health
pm2 status
ss -lntp | grep node
sudo tail -n 50 /var/log/nginx/error.log
```

Common causes:

1. `server.js` is not running.
2. Node is running on a different port.
3. Node crashed during startup.
4. Nginx `proxy_pass` points to the wrong port.
5. Node version is too old.

## Data Directory

Runtime data lives in:

```text
server-data/app-state.json
```

To move the current local data to a server, upload `server-data/`.

To start with clean server data, do not upload `server-data/app-state.json`. The backend will create a new file and default admin.

## Files To Upload

Minimum project files:

```text
server.js
package.json
package-lock.json
index.html
app.js
app.css
harvest.css
harvest.js
harvest-model.js
logo.jpg
assets/
server-data/
ARCHITECTURE.md
DEPLOYMENT.md
CURRENT_STATUS.md
```

If `package.json` or `package-lock.json` are not present in a deployment package, verify whether this project currently has external npm dependencies. The current backend uses Node built-in modules, but PM2 and Nginx deployment still depend on the server environment.
