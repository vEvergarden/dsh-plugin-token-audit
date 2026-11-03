/**
 * Token 审计 —— 主机端。
 *
 * 职责：扫描 ~/.dsh/sessions 下的会话日志，聚合出日/月/年用量与当日 Top5，
 *       在 127.0.0.1 上开一个只读的本地 HTTP 服务给浏览器端取数。
 *
 * 不写任何文件，不改任何 DSH 状态，只监听本机回环地址。
 */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { buildStats } from './core.js';

export const name = 'token-audit';
export const inject = [];

const DEFAULT_PORT = 48921;
const PORT_TRIES = 10;
const CACHE_MS = 8000;

/** 启动信标：确认插件真的被加载了（排查用，删掉不影响功能） */
function beacon(message) {
  try {
    fs.appendFileSync(
      path.join(os.tmpdir(), 'dsh-token-audit-boot.log'),
      `${new Date().toISOString()} ${message}\n`
    );
  } catch { /* ignore */ }
}

function resolveSessionsRoot(config) {
  if (config?.sessionsRoot) return config.sessionsRoot;
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(home, 'sessions');
}

export function apply(ctx, config = {}) {
  const sessionsRoot = resolveSessionsRoot(config);
  const budget = Number(config.budget || 0);
  const startPort = Number(config.port || DEFAULT_PORT);

  beacon(`apply start port=${startPort} sessions=${sessionsRoot}`);

  let cache = null;
  let cacheAt = 0;

  const snapshot = () => {
    const now = Date.now();
    if (cache && now - cacheAt < CACHE_MS) return cache;
    cache = buildStats({ sessionsRoot, budget, now });
    cacheAt = now;
    return cache;
  };

  /* ---------- 账户余额（可选：拿不到就返回 null，不影响其他数据） ---------- */
  let balanceCache = null;
  let balanceAt = 0;
  const BALANCE_MS = 60_000;

  // cordis 的服务要通过 inject 回调取；未声明依赖时直接读 ctx.deepseekAccount 拿不到
  let accountSvc = null;
  if (ctx && typeof ctx.inject === 'function') {
    try {
      ctx.inject(['deepseekAccount'], (sub) => {
        try { accountSvc = sub.deepseekAccount || null; } catch { accountSvc = null; }
      });
    } catch { /* 服务不存在时不影响插件加载 */ }
  }

  const accountService = () => {
    if (accountSvc) return accountSvc;
    try {
      if (ctx && ctx.deepseekAccount) return ctx.deepseekAccount;
      if (ctx && typeof ctx.get === 'function') return ctx.get('deepseekAccount') || null;
    } catch { /* 服务未就绪 */ }
    return null;
  };

  const pickWallets = (payload) => {
    // 不依赖字段名：任何带 currency + balance 的对象都算一个钱包，
    // 数组、单对象、嵌套多深都能找到（平台的投影形态改过好几次）。
    const found = [];
    const walk = (node, path, depth) => {
      if (!node || depth > 8) return;
      if (Array.isArray(node)) { node.forEach((n, i) => walk(n, `${path}[${i}]`, depth + 1)); return; }
      if (typeof node !== 'object') return;
      if (typeof node.currency === 'string' && node.balance !== undefined) {
        found.push({ currency: node.currency, balance: String(node.balance), path });
        return;
      }
      for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`, depth + 1);
    };
    walk(payload, '', 0);
    if (!found.length) return null;

    const seen = new Set();
    const wallets = found.filter((w) => {
      const k = `${w.currency}|${w.balance}|${w.path}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const isBonus = (w) => /bonus/i.test(w.path);
    const sum = (list) => list.reduce((acc, w) => acc + (Number(w.balance) || 0), 0);

    const currency = (wallets.find((w) => w.currency === 'CNY') || wallets[0]).currency;
    const same = wallets.filter((w) => w.currency === currency);
    const bonus = same.filter(isBonus);
    const normal = same.filter((w) => !isBonus(w));

    return {
      currency,
      wallets: same,
      total: Number(sum(same).toFixed(2)),
      bonus: Number(sum(bonus).toFixed(2)),
      normal: Number(sum(normal).toFixed(2))
    };
  };

  const readBalance = async () => {
    const now = Date.now();
    if (balanceAt && now - balanceAt < BALANCE_MS) return balanceCache;
    const svc = accountService();
    if (!svc || typeof svc.getBalance !== 'function') {
      balanceCache = { ok: false, reason: 'no-service' };
      balanceAt = now;
      return balanceCache;
    }
    try {
      const client = { version: '0.2.1', locale: 'zh-CN', timeZone: 'Asia/Shanghai' };
      const result = await Promise.race([
        Promise.resolve(svc.getBalance(client)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
      ]);
      const wallets = pickWallets(result);
      balanceCache = wallets
        ? { ok: true, ...wallets }
        : { ok: false, reason: 'no-wallet' };
    } catch (error) {
      balanceCache = { ok: false, reason: String((error && error.message) || error) };
    }
    balanceAt = now;
    return balanceCache;
  };

  const server = http.createServer((req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Cache-Control': 'no-store'
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    const url = (req.url || '/').split('?')[0];

    if (url === '/health') {
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'dsh-token-audit' }));
      return;
    }

    if (url === '/stats') {
      (async () => {
        try {
          const data = snapshot();
          let balance = null;
          try { balance = await readBalance(); } catch { /* 余额失败不影响主体 */ }
          res.writeHead(200, { ...cors, 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ...data, balance }));
        } catch (error) {
          res.writeHead(500, { ...cors, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(error && error.message || error) }));
        }
      })();
      return;
    }

    res.writeHead(404, cors);
    res.end('not found');
  });

  let attempt = 0;
  const listen = () => {
    const port = startPort + attempt;
    server.once('error', (error) => {
      if (error && error.code === 'EADDRINUSE' && attempt < PORT_TRIES) {
        attempt += 1;
        server.close();
        listen();
        return;
      }
      console.error('[token-audit] 监听失败:', error);
      beacon('listen error: ' + (error && error.message));
    });
    server.listen(port, '127.0.0.1', () => {
      console.log(`[token-audit] 已启动 http://127.0.0.1:${port}/stats`);
      beacon('listening on ' + port);
    });
  };
  listen();

  const dispose = () => { try { server.close(); } catch { /* ignore */ } };
  if (typeof ctx?.on === 'function') {
    try { ctx.on('dispose', dispose); } catch { /* ignore */ }
  }
  if (typeof ctx?.effect === 'function') {
    try { ctx.effect(() => dispose); } catch { /* ignore */ }
  }

  // 注意：apply 不能有返回值。cordis 会把返回值当成「要挂载的插件」，
  // 于是一个 dispose 函数会让整个 entry 判定为 failed。
}
