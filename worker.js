const DEX_URL = 'https://api.dexscreener.com/latest/dex/tokens/';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'HeixiaziAgent/0.1' } });
  if (!r.ok) throw new Error(`fetch_failed_${r.status}`);
  return await r.json();
}

function liqUsd(pair) {
  const v = pair && pair.liquidity && pair.liquidity.usd;
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
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
      'honeypot/tax/ownership require extra sources not enabled in v0.1',
      'liquidity can move quickly',
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

const AGENT = {
  schema_version: '0.1',
  name: 'Heixiazi',
  display_name: 'Heixiazi On-chain Trading Intelligence',
  description: 'A BNB Chain focused on-chain intelligence agent for meme-token risk checks, agent-commerce monitoring, and market signal analysis.',
  category: 'trading-intelligence',
  chains: ['bsc'],
  agent_wallet: '0x11e82531407413f94fc9f6c8e99b5df0c76bb83f',
  source_repository: 'https://github.com/miluan1995/heixiazi-token-risk-agent',
  service_endpoints: {
    health: '/health',
    agent_card: '/agent-card',
    token_risk_job: 'POST /job/token-risk',
  },
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return json({ ok: true });
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'heixiazi-token-risk-agent', runtime: 'cloudflare-worker', ts: Math.floor(Date.now() / 1000) });
    }
    if (request.method === 'GET' && url.pathname === '/agent-card') return json({ ok: true, agent: AGENT });
    if (request.method === 'POST' && (url.pathname === '/job' || url.pathname === '/job/token-risk')) {
      let payload = {};
      try { payload = await request.json(); } catch (_) { return json({ ok: false, error: 'invalid_json' }, 400); }
      const token = payload.token_address || payload.contract;
      if (typeof token !== 'string' || !token.startsWith('0x') || token.length !== 42) return json({ ok: false, error: 'token_address_required_0x42' }, 400);
      const jobId = 'job_' + crypto.randomUUID().replaceAll('-', '').slice(0, 12);
      try {
        const result = await tokenRiskReport(token);
        return json({ ok: true, job_id: jobId, status_url: null, result });
      } catch (e) {
        return json({ ok: false, job_id: jobId, result: { token_address: token, risk_score: 100, risk_level: 'unknown_error', signals: ['source fetch failed'], error: String(e).slice(0, 300) } }, 502);
      }
    }
    return json({ ok: false, error: 'not_found', paths: ['/health', '/agent-card', 'POST /job/token-risk'] }, 404);
  },
};
