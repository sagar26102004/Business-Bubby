/// <reference types="node" />
/**
 * A page on this computer that walks through the outreach sheet one owner at a
 * time: it opens the chat in WhatsApp with the message already typed, YOU press
 * Enter in WhatsApp, and it records the send and shows the next owner.
 *
 *   npx tsx scripts/export-contacts.ts            # first: the sheet, with Send links
 *   npx tsx scripts/outreach-sender.ts [--city Indore] [--daily N] [--gap N] [--port 8790]
 *   → open http://localhost:8790
 *
 * It never sends anything by itself. Automating WhatsApp is against its terms
 * and is the fastest way to get a new number banned, so a person presses send
 * on every message; the page only removes the copy-paste. It also paces you:
 * --daily N caps the sends per day and --gap N is a minimum of seconds
 * between two chats; both are off unless given.
 *
 * Progress goes to E:\listing\outreach-sent.json (OUTREACH_LOG), not the
 * workbook, so the sheet can stay open in Excel meanwhile; the next
 * export-contacts run copies it into the Sent? column. Rows that already
 * have something typed in Sent? are skipped.
 */
import ExcelJS from 'exceljs';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FOOD_ROOT, OUTREACH_LOG, readOutreachLog, writeOutreachLog, type OutreachMark } from './listing-lib';

const SHEET = join(FOOD_ROOT, 'food-contacts.xlsx');
const SKIP_SHEETS = new Set(['Summary', 'No WhatsApp']);

interface Contact {
  ids: string[];
  name: string;
  digits: string;
  city: string;
  message: string;
}

const args = process.argv.slice(2);
const arg = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
/** 0 = no daily cap. */
const DAILY = arg('daily', 0);
const GAP_SECONDS = arg('gap', 0);
const PORT = arg('port', 8790);
/** --city Indore opens the page on that city's sheet (still changeable on the page). */
const START_CITY = args.includes('--city') ? args[args.indexOf('--city') + 1] : '';

const cellText = (v: ExcelJS.CellValue) => (v && typeof v === 'object' && 'text' in v ? String(v.text) : String(v ?? ''));

async function loadContacts(): Promise<Contact[]> {
  if (!existsSync(SHEET)) throw new Error(`${SHEET} not found — run scripts/export-contacts.ts first.`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SHEET);
  const out: Contact[] = [];
  wb.eachSheet((ws) => {
    if (SKIP_SHEETS.has(ws.name)) return;
    const header = (ws.getRow(1).values as unknown[]).map((v) => String(v ?? ''));
    const col = (h: string) => header.indexOf(h);
    if (col('WhatsApp') < 0) throw new Error('The sheet has no WhatsApp column — run export-contacts.ts with --link <url> first.');
    ws.eachRow((row, n) => {
      if (n === 1 || cellText(row.getCell(col('Sent?')).value).trim()) return;
      const link = row.getCell(col('WhatsApp')).value as ExcelJS.CellHyperlinkValue | null;
      if (!link?.hyperlink) return;
      out.push({
        ids: cellText(row.getCell(col('Id')).value).split(',').filter(Boolean),
        name: cellText(row.getCell(col('Business name')).value),
        digits: cellText(row.getCell(col('Contact number')).value).replace(/\D/g, ''),
        city: ws.name,
        message: new URL(link.hyperlink).searchParams.get('text') ?? '',
      });
    });
  });
  return out;
}

const today = () => new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD

async function main() {
  const contacts = await loadContacts();
  const log = readOutreachLog();
  const undo: string[][] = [];

  const done = (c: Contact) => c.ids.some((id) => log[id]);
  const marks = () => Object.values(log);
  /** Several listings can share a row; count each send once, by number. */
  const sentToday = () => new Set(marks().filter((m) => m.status === 'sent' && m.at.startsWith(today())).map((m) => m.number)).size;
  const lastSentAt = () => Math.max(0, ...marks().filter((m) => m.status === 'sent').map((m) => Date.parse(m.at)));

  const state = (city: string) => {
    const pool = contacts.filter((c) => !city || c.city === city);
    const next = pool.find((c) => !done(c));
    return {
      next: next ?? null,
      left: pool.filter((c) => !done(c)).length,
      total: pool.length,
      sentToday: sentToday(),
      daily: DAILY,
      waitSeconds: Math.max(0, Math.ceil((lastSentAt() + GAP_SECONDS * 1000 - Date.now()) / 1000)),
      cities: [...new Set(contacts.map((c) => c.city))],
      canUndo: undo.length > 0,
    };
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const json = (body: unknown, code = 200) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(PAGE.replace('__START_CITY__', JSON.stringify(START_CITY)));
      }
      const city = url.searchParams.get('city') ?? '';
      if (req.method === 'GET' && url.pathname === '/api/state') return json(state(city));
      if (req.method === 'POST' && url.pathname === '/api/mark') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const { digits, status } = JSON.parse(body) as { digits: string; status: OutreachMark['status'] };
        const c = contacts.find((x) => x.digits === digits);
        if (!c || (status !== 'sent' && status !== 'skipped')) return json({ error: 'unknown contact' }, 400);
        if (status === 'sent' && DAILY && sentToday() >= DAILY) return json({ error: `Today's limit of ${DAILY} is reached.` }, 409);
        const mark: OutreachMark = { status, at: new Date().toISOString(), number: c.digits };
        for (const id of c.ids) log[id] = mark;
        writeOutreachLog(log);
        undo.push(c.ids);
        return json(state(city));
      }
      if (req.method === 'POST' && url.pathname === '/api/undo') {
        for (const id of undo.pop() ?? []) delete log[id];
        writeOutreachLog(log);
        return json(state(city));
      }
      json({ error: 'not found' }, 404);
    } catch (e) {
      json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });
  // Bound to this computer only: the page can write the log.
  server.listen(PORT, '127.0.0.1', () => {
    const left = contacts.filter((c) => !done(c)).length;
    console.log(`${contacts.length} contacts with a Send link, ${left} still to message (log: ${OUTREACH_LOG})`);
    console.log(`${DAILY ? `pacing: ${DAILY} a day` : 'no daily limit'}${GAP_SECONDS ? `, ${GAP_SECONDS}s apart` : ''}${START_CITY ? `, starting on ${START_CITY}` : ''} — open http://localhost:${PORT}  (Ctrl+C to stop)`);
  });
}

const PAGE = /* html */ `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Outreach sender</title>
<style>
  :root { --paper:#f6f3ec; --ink:#1f2a24; --muted:#6b756f; --brand:#3f5e4a; --line:#dcd6c8; --card:#fff; --warn:#a4462b; }
  * { box-sizing:border-box } body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.45 system-ui,Segoe UI,Arial,sans-serif }
  main { max-width:620px; margin:0 auto; padding:24px 16px 48px }
  header { display:flex; flex-wrap:wrap; gap:8px 16px; align-items:center; justify-content:space-between; margin-bottom:16px }
  h1 { font-size:20px; margin:0 } .stats { color:var(--muted); font-size:14px }
  .bar { height:6px; background:var(--line); border-radius:3px; overflow:hidden; margin:4px 0 20px } .bar i { display:block; height:100%; background:var(--brand) }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:20px }
  .name { font-size:22px; font-weight:700; margin:0 } .meta { color:var(--muted); margin:2px 0 14px }
  pre { white-space:pre-wrap; font:inherit; font-size:14px; background:var(--paper); border-radius:10px; padding:12px; margin:0 0 16px; max-height:220px; overflow:auto }
  .row { display:flex; flex-wrap:wrap; gap:8px }
  button { font:inherit; border-radius:10px; border:1px solid var(--line); background:var(--card); color:var(--ink); padding:10px 16px; cursor:pointer }
  button.primary { background:var(--brand); border-color:var(--brand); color:#fff; font-weight:600; flex:1 }
  button:disabled { opacity:.5; cursor:default }
  .controls { display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin:18px 0 0; color:var(--muted); font-size:14px }
  select { font:inherit; padding:4px 6px; border-radius:8px; border:1px solid var(--line); background:var(--card) }
  .note { color:var(--warn); font-size:14px; min-height:20px; margin:10px 0 0 } .hint { color:var(--muted); font-size:13px; margin-top:22px }
</style></head><body><main>
<header><h1>Outreach sender</h1><div class="stats" id="stats"></div></header>
<div class="bar"><i id="progress" style="width:0"></i></div>
<div class="card" id="card"></div>
<p class="note" id="note"></p>
<div class="controls">
  <label>Open in <select id="mode"><option value="app">WhatsApp app</option><option value="web">WhatsApp Web</option></select></label>
  <label>City <select id="city"><option value="">All</option></select></label>
  <button id="undo" disabled>Undo last</button>
</div>
<p class="hint">Enter = open the chat, then Enter again once you've pressed send in WhatsApp. Nothing is sent from this page: you send every message yourself.</p>
</main><script>
const $ = (id) => document.getElementById(id);
let st = null, opened = false, timer = null;
const pref = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} };
$('mode').value = pref('mode') || 'app';
$('mode').onchange = () => pref('mode', $('mode').value);
const START_CITY = __START_CITY__;
if (START_CITY) { $('city').add(new Option(START_CITY, START_CITY)); $('city').value = START_CITY; }
const city = () => $('city').value;
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[c]));

async function call(path, body) {
  const r = await fetch(path + '?city=' + encodeURIComponent(city()), body ? { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) } : {});
  const j = await r.json();
  if (j.error) { $('note').textContent = j.error; return; }
  $('note').textContent = '';
  st = j; opened = false; render();
}
function render() {
  const listed = [...$('city').options].map((o) => o.value);
  for (const c of st.cities) if (!listed.includes(c)) $('city').add(new Option(c, c));
  const sent = st.total - st.left;
  $('stats').textContent = 'Today ' + st.sentToday + (st.daily ? ' / ' + st.daily : ' sent') + '  ·  ' + sent + ' of ' + st.total + ' done';
  $('progress').style.width = (st.total ? 100 * sent / st.total : 0) + '%';
  $('undo').disabled = !st.canUndo;
  const c = st.next;
  if (!c) { $('card').innerHTML = '<p class="name">All done 🎉</p><p class="meta">Everyone' + (city() ? ' in ' + esc(city()) : '') + ' has been messaged or skipped.</p>'; return; }
  if (st.daily && st.sentToday >= st.daily) { $('card').innerHTML = '<p class="name">That\\'s today\\'s ' + st.daily + '</p><p class="meta">Come back tomorrow. Sending slowly is what keeps the number from being banned.</p>'; return; }
  const num = c.digits.slice(0,5) + ' ' + c.digits.slice(5);
  $('card').innerHTML =
    '<p class="name">' + esc(c.name) + '</p><p class="meta">+91 ' + num + ' · ' + esc(c.city) + '</p>' +
    '<pre>' + esc(c.message) + '</pre>' +
    (opened
      ? '<div class="row"><button class="primary" id="sent">✓ I sent it, next</button><button id="back">Didn\\'t send</button><button id="skip">Not on WhatsApp</button></div>'
      : '<div class="row"><button class="primary" id="open">Open chat</button><button id="skip">Skip</button></div>');
  if (opened) { $('sent').onclick = () => call('/api/mark', { digits:c.digits, status:'sent' }); $('back').onclick = () => { opened = false; render(); }; }
  else { $('open').onclick = open; tick(); }
  $('skip').onclick = () => call('/api/mark', { digits:c.digits, status:'skipped' });
}
function tick() {
  clearInterval(timer);
  const b = $('open'); if (!b) return;
  let wait = st.waitSeconds;
  const show = () => { b.disabled = wait > 0; b.textContent = wait > 0 ? 'Next chat in ' + wait + 's' : 'Open chat'; };
  show();
  if (wait > 0) timer = setInterval(() => { wait--; st.waitSeconds = wait; show(); if (wait <= 0) clearInterval(timer); }, 1000);
}
function open() {
  const c = st.next, text = encodeURIComponent(c.message);
  const url = $('mode').value === 'web'
    ? 'https://web.whatsapp.com/send?phone=91' + c.digits + '&text=' + text
    : 'whatsapp://send?phone=91' + c.digits + '&text=' + text;
  if ($('mode').value === 'web') window.open(url, 'whatsapp'); else location.href = url;
  opened = true; render();
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.target.tagName === 'SELECT') return;
  const b = $('sent') || $('open'); if (b && !b.disabled) { e.preventDefault(); b.click(); }
});
$('city').onchange = () => call('/api/state');
$('undo').onclick = () => call('/api/undo', {});
call('/api/state');
</script></body></html>`;

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
