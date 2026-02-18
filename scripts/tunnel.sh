#!/bin/bash
# Auto-reconnecting cloudflare tunnel
PORT=${1:-3000}
TUNNEL_LOG="/tmp/tunnel.log"

while true; do
  echo "[tunnel] Starting cloudflared tunnel on port $PORT..."
  /tmp/cloudflared tunnel --url "http://localhost:$PORT" --protocol http2 2>&1 | tee "$TUNNEL_LOG" &
  PID=$!
  
  # Wait for URL to appear
  for i in $(seq 1 15); do
    URL=$(grep -o 'https://[^ ]*trycloudflare.com' "$TUNNEL_LOG" 2>/dev/null | tail -1)
    if [ -n "$URL" ]; then
      echo "[tunnel] ✅ URL: $URL"
      break
    fi
    sleep 1
  done
  
  # Monitor: restart if process dies
  wait $PID
  echo "[tunnel] ⚠️ Tunnel died, restarting in 3s..."
  sleep 3
done
