#!/usr/bin/env python3
from __future__ import annotations
import json, time, uuid, urllib.request, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
META = json.loads((ROOT / "agent-metadata.json").read_text())
JOBS = {}
DEX_URL = "https://api.dexscreener.com/latest/dex/tokens/{}"


def _fetch_json(url: str, timeout: int = 15) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "HeixiaziAgent/0.1"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def token_risk_report(token: str) -> dict:
    token_l = token.lower()
    report = {
        "token_address": token,
        "chain": "bsc",
        "summary": "DexScreener-based public-market risk snapshot; not financial advice.",
        "risk_score": 50,
        "risk_level": "medium",
        "signals": [],
        "sources": [],
        "market": None,
        "limitations": [
            "does not replace contract-source audit",
            "honeypot/tax/ownership require extra sources not enabled in v0.1",
            "liquidity can move quickly"
        ]
    }
    data = _fetch_json(DEX_URL.format(urllib.parse.quote(token)))
    pairs = [p for p in data.get("pairs") or [] if str(p.get("chainId", "")).lower() in {"bsc", "bnb"}]
    report["sources"].append({"name": "dexscreener", "ok": True, "pairs": len(pairs)})
    if not pairs:
        report.update({
            "risk_score": 92,
            "risk_level": "critical",
            "signals": ["no BSC DexScreener pairs found; liquidity/market may be missing"],
        })
        return report
    def liq_usd(p):
        try: return float((p.get("liquidity") or {}).get("usd") or 0)
        except Exception: return 0.0
    best = max(pairs, key=liq_usd)
    liquidity = liq_usd(best)
    fdv = float(best.get("fdv") or 0) if str(best.get("fdv") or "").replace('.', '', 1).isdigit() else 0.0
    vol24 = float((best.get("volume") or {}).get("h24") or 0)
    tx24 = int((best.get("txns") or {}).get("h24", {}).get("buys") or 0) + int((best.get("txns") or {}).get("h24", {}).get("sells") or 0)
    score = 20
    signals = []
    if liquidity < 5_000:
        score += 45; signals.append("liquidity under $5k")
    elif liquidity < 25_000:
        score += 28; signals.append("liquidity under $25k")
    elif liquidity < 100_000:
        score += 12; signals.append("liquidity under $100k")
    else:
        signals.append("liquidity >= $100k")
    if vol24 < 1_000:
        score += 15; signals.append("24h volume under $1k")
    if tx24 < 30:
        score += 12; signals.append("24h transactions under 30")
    if fdv and liquidity and fdv / liquidity > 200:
        score += 12; signals.append("FDV/liquidity ratio above 200")
    if len(pairs) == 1:
        score += 5; signals.append("only one BSC pair found")
    score = max(0, min(100, score))
    level = "low" if score < 35 else "medium" if score < 60 else "high" if score < 85 else "critical"
    report.update({
        "risk_score": score,
        "risk_level": level,
        "signals": signals,
        "market": {
            "pair_address": best.get("pairAddress"),
            "dex": best.get("dexId"),
            "url": best.get("url"),
            "base": best.get("baseToken"),
            "quote": best.get("quoteToken"),
            "price_usd": best.get("priceUsd"),
            "liquidity_usd": liquidity,
            "fdv": fdv,
            "volume_24h": vol24,
            "txns_24h": tx24
        }
    })
    return report


class Handler(BaseHTTPRequestHandler):
    server_version = "HeixiaziAgent/0.1"
    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False, indent=2).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        if self.path == "/health":
            return self._json({"ok": True, "service": "heixiazi-token-risk-agent", "ts": int(time.time())})
        if self.path == "/agent-card":
            card = dict(META)
            card["service_endpoints"] = {"health": "/health", "agent_card": "/agent-card", "token_risk_job": "POST /job/token-risk", "job_status": "/job/{id}/status"}
            return self._json({"ok": True, "agent": card})
        if self.path.startswith("/job/") and self.path.endswith("/status"):
            job_id = self.path.split("/")[2]
            job = JOBS.get(job_id)
            if not job:
                return self._json({"ok": False, "error": "job_not_found", "job_id": job_id}, 404)
            return self._json({"ok": True, "job": job})
        return self._json({"ok": False, "error": "not_found", "paths": ["/health", "/agent-card", "POST /job/token-risk", "/job/{id}/status"]}, 404)
    def do_POST(self):
        if self.path not in {"/job", "/job/token-risk"}:
            return self._json({"ok": False, "error": "not_found"}, 404)
        length = int(self.headers.get("content-length", "0") or "0")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode() or "{}")
        except json.JSONDecodeError:
            return self._json({"ok": False, "error": "invalid_json"}, 400)
        token = payload.get("token_address") or payload.get("contract")
        if not isinstance(token, str) or not token.startswith("0x") or len(token) != 42:
            return self._json({"ok": False, "error": "token_address_required_0x42"}, 400)
        job_id = "job_" + uuid.uuid4().hex[:12]
        try:
            result = token_risk_report(token)
            status = "completed"
        except Exception as e:
            result = {"token_address": token, "risk_score": 100, "risk_level": "unknown_error", "signals": ["source fetch failed"], "error": str(e)[:300]}
            status = "failed_source_fetch"
        JOBS[job_id] = {"id": job_id, "status": status, "input": payload, "result": result, "created_at": int(time.time())}
        code = 200 if status == "completed" else 502
        return self._json({"ok": status == "completed", "job_id": job_id, "status_url": f"/job/{job_id}/status", "result": result}, code)
    def log_message(self, fmt, *args):
        return

if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8787), Handler).serve_forever()
