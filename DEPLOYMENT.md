# Heixiazi Token Risk Agent deployment note

Status: local service is ready, public executable endpoint is blocked by missing safe deployment surface on this machine.

## Local service

```bash
cd /Users/mac/.openclaw/workspace/experiments/bnb-agent-commerce/heixiazi-agent
python3 server.py
curl http://127.0.0.1:8787/health
curl -X POST http://127.0.0.1:8787/job/token-risk \
  -H 'content-type: application/json' \
  -d '{"token_address":"0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"}'
```

## Public deployment blocker

Checked locally:
- `cloudflared`: not installed
- `ngrok`: not installed / no configured token found
- `vercel`: not installed / no local auth config found
- `wrangler`: not installed
- `flyctl`: not installed
- `pm2`: not installed

Gist can host static `agent-card` and `registration` JSON, but cannot run the dynamic `POST /job/token-risk` endpoint.

## Safe next deployment options

1. Existing VPS / domain: run `server.py` behind nginx/Caddy and HTTPS.
2. Cloudflare Worker: port the risk logic to JS, no server secret needed, good for public endpoint.
3. ngrok/cloudflared tunnel: fastest, but requires installation/auth and stable domain decision.
4. Vercel/Render/Fly: possible after auth/project setup.

No paid cloud, no secrets, no wallet, no APEX/payment actions were used.
