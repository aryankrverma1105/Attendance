# Production HTTPS Reverse Proxy Deployment

The FieldPulse mobile app strictly disallows cleartext traffic (`android.usesCleartextTraffic: false`). Therefore, the backend API domain specified in `eas.json` (`EXPO_PUBLIC_API_BASE_URL`) **MUST** be an HTTPS URL with a valid SSL/TLS certificate (e.g., `https://api.yourdomain.com`). Raw HTTP IP addresses or unencrypted HTTP connections will be rejected by Android networking.

---

## 1. Domain Configuration

1. Point your domain's DNS A/AAAA records to your production server's external IP address.
   - Example: `api.yourdomain.com` -> `34.180.17.0`
2. Update `eas.json` for both `preview` and `production` profiles:
   ```json
   "env": {
     "EXPO_PUBLIC_API_BASE_URL": "https://api.yourdomain.com"
   }
   ```

---

## 2. Reverse Proxy Setup

Your Node/Express application runs locally on port `3000` (or `PORT` specified in `.env`). The reverse proxy listens on public port `443` (HTTPS) and port `80` (HTTP-to-HTTPS redirect) and proxies incoming requests to `http://127.0.0.1:3000`.

### Option A: Caddy (Recommended - Automatic TLS)

Caddy automatically provisions and renews Let's Encrypt / ZeroSSL TLS certificates with zero configuration.

Install Caddy:
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

Create or edit `/etc/caddy/Caddyfile`:
```caddy
api.yourdomain.com {
    # Reverse proxy to the FieldPulse Express/tRPC server on port 3000
    reverse_proxy 127.0.0.1:3000

    # Optional security headers
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
    }
}
```

Reload Caddy:
```bash
sudo systemctl reload caddy
```

---

### Option B: NGINX + Certbot

Install NGINX and Certbot:
```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

Configure `/etc/nginx/sites-available/fieldpulse`:
```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    # Redirect all HTTP requests to HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    # SSL certificates managed by Certbot
    ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Upload size limit for attendance selfies and evidence
        client_max_body_size 15M;
    }
}
```

Enable site and obtain SSL certificate:
```bash
sudo ln -s /etc/nginx/sites-available/fieldpulse /etc/nginx/sites-enabled/
sudo certbot --nginx -d api.yourdomain.com
sudo nginx -t
sudo systemctl reload nginx
```

---

## 3. Server Trust Proxy Verification

The backend server in `server/_core/index.ts` has `app.set("trust proxy", 1);` enabled. This ensures `req.ip` and `req.protocol` correctly reflect the client's original IP and `https` protocol through the reverse proxy.
