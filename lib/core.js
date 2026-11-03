'use strict';
/**
 * 会话日志 → token 统计。
 * 纯函数式：只读 ~/.dsh/sessions，不写任何东西。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const MAX_FRAME_EXTEND = 4;

function decompressSessionFile(file) {
  const buf = fs.readFileSync(file);

  if (!zlib.zstdDecompressSync || buf.indexOf(ZSTD_MAGIC) === -1) {
    return buf.toString('utf8');
  }

  const offsets = [];
  let cursor = 0;
  while ((cursor = buf.indexOf(ZSTD_MAGIC, cursor)) !== -1) {
    offsets.push(cursor);
    cursor += 4;
  }

  const chunks = [];
  let k = 0;
  while (k < offsets.length) {
    let done = false;
    for (let j = k + 1; j <= Math.min(offsets.length, k + 1 + MAX_FRAME_EXTEND); j++) {
      const end = j < offsets.length ? offsets[j] : buf.length;
      try {
        chunks.push(zlib.zstdDecompressSync(buf.subarray(offsets[k], end)).toString('utf8'));
        k = j;
        done = true;
        break;
      } catch { /* 尝试合并下一帧 */ }
    }
    if (!done) k++;
  }
  return chunks.join('');
}

function pad(n) { return String(n).padStart(2, '0'); }
function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function monthKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function yearKey(ms) { return String(new Date(ms).getFullYear()); }

function textOf(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((c) => c && (c.type === 'text' || typeof c.text === 'string'))
    .map((c) => c.text || '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 解析单个会话文件为「轮次」列表 */
function parseSession(file, fallbackId) {
  let raw;
  try { raw = decompressSessionFile(file); } catch { return null; }

  const events = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try { events.push(JSON.parse(line)); } catch { /* 跳过坏行 */ }
  }
  if (!events.length) return null;

  const meta = events.find((e) => e.type === 'session') || {};
  const titleEvent = [...events].reverse().find((e) => e.type === 'session/title');

  const turns = new Map();
  const ensure = (n) => {
    if (!turns.has(n)) {
      turns.set(n, {
        turn: n, total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
        calls: 0, steps: 0, tools: 0, startedAt: 0, endedAt: 0, status: '', prompt: ''
      });
    }
    return turns.get(n);
  };

  let currentTurn = 0;
  for (const e of events) {
    const d = e.data || {};
    switch (e.type) {
      case 'turn/start': {
        currentTurn = d.turn;
        const t = ensure(d.turn);
        t.startedAt = t.startedAt || e.time;
        break;
      }
      case 'turn/end': {
        const t = ensure(d.turn);
        t.endedAt = e.time;
        t.status = (d.reason && d.reason.kind) || '';
        break;
      }
      case 'step/start': {
        ensure(d.turn).steps++;
        break;
      }
      case 'tool/call': {
        ensure(d.turn).tools++;
        break;
      }
      case 'user/message': {
        // user/message 的事件体不带 turn，按「最近一个 turn/start」归属
        const t = ensure(currentTurn);
        if (!t.prompt) t.prompt = textOf(d.content);
        break;
      }
      case 'assistant/message': {
        const t = ensure(d.turn);
        const u = d.usage;
        if (!u) break;
        const total = u.totalTokens ?? ((u.inputTokens || 0) + (u.outputTokens || 0));
        t.total += total;
        t.input += u.inputTokens || 0;
        t.output += u.outputTokens || 0;
        t.cacheRead += u.cacheReadTokens || 0;
        t.cacheWrite += u.cacheWriteTokens || 0;
        t.calls++;
        break;
      }
      default:
        break;
    }
  }

  const list = [...turns.values()].filter((t) => t.total > 0 || t.startedAt);
  if (!list.length) return null;

  return {
    id: meta.id || fallbackId,
    cwd: meta.cwd || '',
    createdAt: meta.createdAt || 0,
    title: (titleEvent && titleEvent.data && titleEvent.data.title) || '',
    turns: list
  };
}

function listSessionFiles(root) {
  const out = [];
  let dirs;
  try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const sub = path.join(root, dir.name);
    let inner;
    try { inner = fs.readdirSync(sub, { withFileTypes: true }); } catch { continue; }
    for (const e of inner) {
      if (!e.isDirectory()) continue;
      const file = path.join(sub, e.name, 'session.v4.jsonl.zstd');
      if (fs.existsSync(file)) out.push(file);
    }
  }
  return out;
}

/**
 * 生成统计快照。
 * @param {object} opts
 * @param {string} opts.sessionsRoot  会话根目录
 * @param {number} [opts.budget]      当日预算 token
 * @param {number} [opts.now]         当前时间（测试用）
 */
function buildStats(opts) {
  const root = opts.sessionsRoot;
  const now = opts.now || Date.now();
  const budget = opts.budget || 0;

  const byDay = new Map();
  const byMonth = new Map();
  const byYear = new Map();
  const todayTurns = [];
  let usedAll = 0;
  let usedToday = 0;
  let sessionCount = 0;

  for (const file of listSessionFiles(root)) {
    const session = parseSession(file, path.basename(path.dirname(file)));
    if (!session) continue;
    sessionCount++;

    for (const t of session.turns) {
      if (!t.total) continue;
      const stamp = t.startedAt || session.createdAt || now;
      usedAll += t.total;

      byDay.set(dayKey(stamp), (byDay.get(dayKey(stamp)) || 0) + t.total);
      byMonth.set(monthKey(stamp), (byMonth.get(monthKey(stamp)) || 0) + t.total);
      byYear.set(yearKey(stamp), (byYear.get(yearKey(stamp)) || 0) + t.total);

      if (dayKey(stamp) === dayKey(now)) {
        usedToday += t.total;
        todayTurns.push({
          id: `${session.id}#${t.turn}`,
          sessionId: session.id,
          turn: t.turn,
          title: session.title || '',
          prompt: t.prompt || (session.title || '').slice(0, 60) || `第 ${t.turn} 轮`,
          tokens: t.total,
          input: t.input,
          output: t.output,
          cacheRead: t.cacheRead,
          calls: t.calls,
          steps: t.steps,
          tools: t.tools,
          durationMs: t.startedAt && t.endedAt ? Math.max(0, t.endedAt - t.startedAt) : 0,
          startedAt: t.startedAt,
          status: t.status || 'unknown'
        });
      }
    }
  }

  todayTurns.sort((a, b) => b.tokens - a.tokens);

  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-30)
    .map(([key, tokens]) => ({ key, tokens }));
  const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12)
    .map(([key, tokens]) => ({ key, tokens }));
  const years = [...byYear.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, tokens]) => ({ key, tokens }));

  return {
    generatedAt: now,
    day: dayKey(now),
    month: monthKey(now),
    year: yearKey(now),
    sessionCount,
    used: { today: usedToday, all: usedAll },
    budget: {
      daily: budget,
      remainingToday: budget > 0 ? Math.max(0, budget - usedToday) : null,
      ratio: budget > 0 ? Math.min(1, usedToday / budget) : null
    },
    buckets: { days, months, years },
    todayTop: todayTurns.slice(0, 5),
    todayTasks: todayTurns.length
  };
}

export { buildStats, parseSession, listSessionFiles, dayKey, monthKey, yearKey };
