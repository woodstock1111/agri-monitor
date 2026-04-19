# Deployment Guide

## Server Entry Point

Run the Node.js backend:

```bash
node server.js
```

This backend serves both:

1. Static frontend files such as `index.html`, `app.js`, `style.css`, and `logo.jpg`.
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
style.css
logo.jpg
server-data/
ARCHITECTURE.md
DEPLOYMENT.md
CURRENT_STATUS.md
```

If `package.json` or `package-lock.json` are not present in a deployment package, verify whether this project currently has external npm dependencies. The current backend uses Node built-in modules, but PM2 and Nginx deployment still depend on the server environment.
