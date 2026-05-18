const VERSION = '0.2.0';
const BASE_URL = 'https://heixiazi-token-risk-agent.miluan1995.workers.dev';
const DEX_URL = 'https://api.dexscreener.com/latest/dex/tokens/';
const CAKE = '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
      'cache-control': status === 200 ? 'public, max-age=30' : 'no-store',
    },
  });
}

function problem(error, message, status = 400, extra = {}) {
  return json({ ok: false, error, message, ...extra, docs: BASE_URL + '/.well-known/agent.json' }, status);
}

async function fetchJson(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort('timeout'), 12000);
  try {
    const r = await fetch(url, { headers: { 'user-agent': `HeixiaziAgent/${VERSION}` }, signal: controller.signal });
    if (!r.ok) throw new Error(`fetch_failed_${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

function liqUsd(pair) {
  const v = pair && pair.liquidity && pair.liquidity.usd;
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function validBscAddress(v) {
  return typeof v === 'string' && /^0x[a-fA-F0-9]{40}$/.test(v);
}

async function tokenRiskReport(token) {
  const report = {
    token_address: token,
    chain: 'bsc',
    summary: 'DexScreener-based public-market risk snapshot; not financial advice.',
    risk_score: 50,
    risk_level: 'medium',
    signals: [],
    sources: [],
    market: null,
    limitations: [
      'does not replace contract-source audit',
      'honeypot/tax/ownership require extra sources not enabled in v0.2',
      'liquidity can move quickly',
      'read-only analysis; never executes trades or approvals',
    ],
  };
  const data = await fetchJson(DEX_URL + encodeURIComponent(token));
  const pairs = (data.pairs || []).filter((p) => ['bsc', 'bnb'].includes(String(p.chainId || '').toLowerCase()));
  report.sources.push({ name: 'dexscreener', ok: true, pairs: pairs.length });
  if (!pairs.length) {
    report.risk_score = 92;
    report.risk_level = 'critical';
    report.signals = ['no BSC DexScreener pairs found; liquidity/market may be missing'];
    return report;
  }
  const best = pairs.reduce((a, b) => (liqUsd(b) > liqUsd(a) ? b : a), pairs[0]);
  const liquidity = liqUsd(best);
  const fdvNum = Number(best.fdv || 0);
  const fdv = Number.isFinite(fdvNum) ? fdvNum : 0;
  const volNum = Number((best.volume || {}).h24 || 0);
  const vol24 = Number.isFinite(volNum) ? volNum : 0;
  const txns = best.txns || {};
  const h24 = txns.h24 || {};
  const tx24 = Number(h24.buys || 0) + Number(h24.sells || 0);
  let score = 20;
  const signals = [];
  if (liquidity < 5000) { score += 45; signals.push('liquidity under $5k'); }
  else if (liquidity < 25000) { score += 28; signals.push('liquidity under $25k'); }
  else if (liquidity < 100000) { score += 12; signals.push('liquidity under $100k'); }
  else signals.push('liquidity >= $100k');
  if (vol24 < 1000) { score += 15; signals.push('24h volume under $1k'); }
  if (tx24 < 30) { score += 12; signals.push('24h transactions under 30'); }
  if (fdv && liquidity && fdv / liquidity > 200) { score += 12; signals.push('FDV/liquidity ratio above 200'); }
  if (pairs.length === 1) { score += 5; signals.push('only one BSC pair found'); }
  score = Math.max(0, Math.min(100, score));
  const level = score < 35 ? 'low' : score < 60 ? 'medium' : score < 85 ? 'high' : 'critical';
  report.risk_score = score;
  report.risk_level = level;
  report.signals = signals;
  report.market = {
    pair_address: best.pairAddress,
    dex: best.dexId,
    url: best.url,
    base: best.baseToken,
    quote: best.quoteToken,
    price_usd: best.priceUsd,
    liquidity_usd: liquidity,
    fdv,
    volume_24h: vol24,
    txns_24h: tx24,
  };
  return report;
}

const TOKEN_RISK_INPUT_SCHEMA = {
  type: 'object',
  required: ['token_address'],
  properties: {
    token_address: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$', description: 'BSC token contract address' },
    contract: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$', description: 'Alias for token_address' },
  },
  additionalProperties: true,
};

const TOKEN_RISK_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['ok', 'job_id', 'result'],
  properties: {
    ok: { type: 'boolean' },
    job_id: { type: 'string' },
    result: {
      type: 'object',
      required: ['token_address', 'chain', 'risk_score', 'risk_level', 'signals', 'sources'],
      properties: {
        token_address: { type: 'string' },
        chain: { const: 'bsc' },
        risk_score: { type: 'number', minimum: 0, maximum: 100 },
        risk_level: { enum: ['low', 'medium', 'high', 'critical', 'unknown_error'] },
        signals: { type: 'array', items: { type: 'string' } },
        market: { type: ['object', 'null'] },
      },
    },
  },
};

const AGENT_MANIFEST = {
  schema_version: '0.2',
  name: 'Heixiazi',
  display_name: 'Heixiazi On-chain Trading Intelligence',
  description: 'A BNB Chain focused on-chain intelligence agent for meme-token risk checks, agent-commerce monitoring, and market signal analysis.',
  category: 'trading-intelligence',
  version: VERSION,
  base_url: BASE_URL,
  chains: ['bsc'],
  erc8004: {
    chain_id: 56,
    registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    agent_id: 93183,
    token_uri: 'https://miluan1995.github.io/heixiazi-token-risk-agent/public/heixiazi-registration.json',
  },
  agent_wallet: '0x11e82531407413f94fc9f6c8e99b5df0c76bb83f',
  source_repository: 'https://github.com/miluan1995/heixiazi-token-risk-agent',
  metadata: {
    agent_card: 'https://miluan1995.github.io/heixiazi-token-risk-agent/public/heixiazi-agent-card.json',
    registration: 'https://miluan1995.github.io/heixiazi-token-risk-agent/public/heixiazi-registration.json',
  },
  capabilities: [
    {
      id: 'bsc-token-risk.v0',
      name: 'BSC Token Risk Snapshot',
      description: 'Read-only DexScreener-based market/liquidity risk snapshot for a BSC token contract.',
      method: 'POST',
      endpoint: BASE_URL + '/job/token-risk',
      input_schema: TOKEN_RISK_INPUT_SCHEMA,
      output_schema: TOKEN_RISK_OUTPUT_SCHEMA,
      example_request: { token_address: CAKE },
      example_curl: `curl -fsSL -X POST ${BASE_URL}/job/token-risk -H 'content-type: application/json' -d '{"token_address":"${CAKE}"}'`,
    },
  ],
  endpoints: {
    root: BASE_URL + '/',
    agent_manifest: BASE_URL + '/.well-known/agent.json',
    agent_card: BASE_URL + '/agent-card',
    health: BASE_URL + '/health',
    token_risk_job: BASE_URL + '/job/token-risk',
  },
  safety: {
    read_only: true,
    no_trading: true,
    no_approvals: true,
    no_private_keys: true,
    not_financial_advice: true,
  },
};

function rootDocument() {
  return {
    ok: true,
    service: 'heixiazi-token-risk-agent',
    version: VERSION,
    description: AGENT_MANIFEST.description,
    discover: '/.well-known/agent.json',
    health: '/health',
    capabilities: AGENT_MANIFEST.capabilities.map((c) => ({ id: c.id, endpoint: c.endpoint, method: c.method })),
    examples: [{ name: 'CAKE token risk', request: AGENT_MANIFEST.capabilities[0].example_request, curl: AGENT_MANIFEST.capabilities[0].example_curl }],
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return json({ ok: true, allow: ['GET /', 'GET /.well-known/agent.json', 'GET /health', 'GET /agent-card', 'POST /job/token-risk'] });
    if (request.method === 'GET' && url.pathname === '/') return json(rootDocument());
    if (request.method === 'GET' && url.pathname === '/.well-known/agent.json') return json(AGENT_MANIFEST);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'heixiazi-token-risk-agent', runtime: 'cloudflare-worker', version: VERSION, ts: Math.floor(Date.now() / 1000) });
    }
    if (request.method === 'GET' && url.pathname === '/agent-card') return json({ ok: true, agent: AGENT_MANIFEST });
    if (request.method === 'POST' && (url.pathname === '/job' || url.pathname === '/job/token-risk')) {
      let payload = {};
      try { payload = await request.json(); } catch (_) { return problem('invalid_json', 'Request body must be JSON.', 400); }
      const token = payload.token_address || payload.contract;
      if (!validBscAddress(token)) return problem('token_address_required_0x40_hex', 'Provide token_address as a 42-character 0x-prefixed EVM address.', 400, { input_schema: TOKEN_RISK_INPUT_SCHEMA, example: { token_address: CAKE } });
      const jobId = 'job_' + crypto.randomUUID().replaceAll('-', '').slice(0, 12);
      try {
        const result = await tokenRiskReport(token);
        return json({ ok: true, job_id: jobId, status_url: null, result });
      } catch (e) {
        return problem('source_fetch_failed', 'Upstream token data source failed; retry later or verify the token address.', 502, { job_id: jobId, result: { token_address: token, risk_score: 100, risk_level: 'unknown_error', signals: ['source fetch failed'], error: String(e).slice(0, 300) } });
      }
    }
    return problem('not_found', 'Unknown path or method.', 404, { paths: ['GET /', 'GET /.well-known/agent.json', 'GET /health', 'GET /agent-card', 'POST /job/token-risk'] });
  },
};
