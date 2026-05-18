# Heixiazi Token Risk Agent

BNB Chain focused read-only token risk agent for Heixiazi.

## Public metadata

- Agent card: `public/heixiazi-agent-card.json`
- ERC-8004 registration metadata: `public/heixiazi-registration.json`

Current registered ERC-8004 identity:

```text
chain: BNB Smart Chain mainnet (56)
registry: 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
agentId: 93183 / 0x16bff
agent wallet: 0x11e82531407413f94fc9f6c8e99b5df0c76bb83f
```

## Local API

```bash
python3 server.py
curl http://127.0.0.1:8787/health
curl -X POST http://127.0.0.1:8787/job/token-risk \
  -H 'content-type: application/json' \
  -d '{"token_address":"0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"}'
```

## Endpoints

- `GET /health`
- `GET /agent-card`
- `POST /job/token-risk`
- `POST /job` alias for token risk

## Safety

- Read-only market risk snapshot.
- No private keys.
- No signing.
- No trading.
- No APEX/payment action by default.

## Deployment status

GitHub hosts source and static metadata. GitHub Pages/raw GitHub cannot run the dynamic `POST /job/token-risk` API by itself.

For a public executable endpoint, deploy this code to a real runtime such as Cloudflare Worker, VPS, Render, Fly, or Vercel serverless.
