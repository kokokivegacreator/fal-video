#!/bin/bash
# ================================================================
#  Deploy script สำหรับ Hostinger VPS
#  รันครั้งแรกครั้งเดียว: bash deploy.sh
# ================================================================

set -e
APP_DIR="/var/www/fal-video"
APP_PORT=3100

echo "=== 1. Update system ==="
apt-get update -y

echo "=== 2. Install Node.js 20 ==="
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v && npm -v

echo "=== 3. Install PM2 & Nginx ==="
npm install -g pm2 2>/dev/null || true
apt-get install -y nginx

echo "=== 4. Clone / update app ==="
if [ -d "$APP_DIR/.git" ]; then
  cd $APP_DIR && git pull
else
  git clone https://github.com/YOUR_USERNAME/fal-video.git $APP_DIR
  cd $APP_DIR
fi

echo "=== 5. Install dependencies ==="
cd $APP_DIR && npm install --production

echo "=== 6. Setup .env (กรอกทีหลัง) ==="
if [ ! -f "$APP_DIR/.env" ]; then
  cp $APP_DIR/.env.example $APP_DIR/.env
  echo ">>> แก้ไข $APP_DIR/.env แล้วรัน: pm2 restart fal-video"
fi

echo "=== 7. Start with PM2 ==="
cd $APP_DIR
pm2 delete fal-video 2>/dev/null || true
pm2 start server.js --name fal-video
pm2 save
pm2 startup | tail -1 | bash || true

echo "=== 8. Configure Nginx ==="
cat > /etc/nginx/sites-available/fal-video << NGINX
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_IP;

    client_max_body_size 25M;

    location / {
        proxy_pass http://localhost:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 300s;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/fal-video /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

echo ""
echo "✅ Deploy สำเร็จ!"
echo "   App รันที่  : http://YOUR_DOMAIN_OR_IP"
echo "   แก้ไข .env : nano $APP_DIR/.env"
echo "   Restart    : pm2 restart fal-video"
echo "   Logs       : pm2 logs fal-video"
