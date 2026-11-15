#!/usr/bin/env node
import crypto from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const API = 'https://api.yeswehack.com';
const WEB = 'https://yeswehack.com';
const UA = 'using-yeswehack/1.0';
const PACE_MS = 1000;
const HOME = process.env.YWH_HOME
  || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'yeswehack');
const CREDS = join(HOME, 'credentials.json');
const TOKEN = join(HOME, 'token');

const USAGE = `usage: node ywh.mjs <command> [args] [--json]

  setup [--env-file f]          cache email, password and TOTP secret, then log in
                                (reads YWH_EMAIL / YWH_PASSWORD / YWH_TOTP_SECRET from
                                the env file or the environment, else prompts on a TTY)
  logout                        delete the cached credentials and session token
  whoami                        account, credit balance, invitations, unread notifications
  token                         print a valid session JWT (logs in again when it expires)

  programs [--private] [--bounty] [--search q]   programs visible to the account
  program <slug>                brief summary: UA token, VPN, cost, pools, scopes, rewards
  scope <slug> [--out f]        the full brief as Markdown, verbatim (SCOPE.md)
  pools <slug>                  the program's credential pools
  credentials [--program slug]  test accounts assigned to you, with passwords
  aliases                       your @yeswehack.ninja email aliases
  vpn [--out f] [--with-auth]   download the OpenVPN config (default ./yeswehack.ovpn)

  reports [--program slug] [--open]   your reports and their status
  report <id|#YWH-...> [--description]  one report with its whole conversation
  todo                          open reports where it is your turn to act
  watch [--state dir]           diff every program against the last run's snapshot

  get <api-path>                any authenticated GET, printed as JSON

State lives in ${HOME} (override with YWH_HOME).`;

const FINAL = new Set(['resolved', 'informative', 'duplicate', 'not_applicable', 'out_of_scope',
  'wont_fix', 'closed', 'auto_close', 'rejected']);

function fail(message) {
  console.error(`ywh: ${message}`);
  process.exit(1);
}

// ------------------------------------------------------------------ args

const argv = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    if (['json', 'private', 'bounty', 'open', 'with-auth', 'description', 'help'].includes(k)) flags[k] = true;
    else if (i + 1 < argv.length) flags[k] = argv[++i];
    else fail(`--${k} needs a value`);
  } else pos.push(a);
}

// ------------------------------------------------------------------ credentials

function saveFile(path, text) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, text, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    out[line.slice(0, i).trim().replace(/^export\s+/, '')] = line.slice(i + 1).replace(/\s+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

function fromEnv(env) {
  if (!env.YWH_EMAIL || !env.YWH_PASSWORD) return null;
  return { email: env.YWH_EMAIL, password: env.YWH_PASSWORD, totp_secret: env.YWH_TOTP_SECRET || '' };
}

function loadCreds() {
  const env = fromEnv(process.env);
  if (env) return env;
  if (!existsSync(CREDS)) fail(`no cached credentials: run "node ywh.mjs setup" first (looked in ${CREDS})`);
  return JSON.parse(readFileSync(CREDS, 'utf8'));
}

function totpSecret(s) {
  const m = /[?&]secret=([^&]+)/i.exec(s || '');
  return (m ? decodeURIComponent(m[1]) : s || '').replace(/[\s=-]/g, '').toUpperCase();
}

function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of totpSecret(secret)) {
    const v = alphabet.indexOf(c);
    if (v < 0) fail('TOTP secret is not base32 (it is the secret behind the QR code, not a 6-digit code)');
    bits += v.toString(2).padStart(5, '0');
  }
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = crypto.createHmac('sha1', key).update(counter).digest();
  const off = mac[mac.length - 1] & 0x0f;
  return String((mac.readUInt32BE(off) & 0x7fffffff) % 1e6).padStart(6, '0');
}

function jwtExp(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp || 0;
  } catch {
    return 0;
  }
}

async function login(creds) {
  let res = await call('POST', '/login', { body: { email: creds.email, password: creds.password }, auth: false });
  if (res.totp_token) {
    if (!creds.totp_secret) fail('the account has 2FA on: run setup again with the TOTP secret');
    res = await call('POST', '/account/totp', { body: { token: res.totp_token, code: totp(creds.totp_secret) }, auth: false });
  }
  if (!res.token) fail(`login failed: ${JSON.stringify(res).slice(0, 300)}`);
  saveFile(TOKEN, res.token);
  return res.token;
}

let session = null;
async function token({ fresh = false } = {}) {
  if (!fresh && session) return session;
  if (!fresh && existsSync(TOKEN)) {
    const t = readFileSync(TOKEN, 'utf8').trim();
    if (jwtExp(t) - Date.now() / 1000 > 120) return (session = t);
  }
  return (session = await login(loadCreds()));
}

// ------------------------------------------------------------------ http

let last = 0;
async function call(method, path, { body, auth = true, raw = false, retried = false } = {}) {
  const headers = { 'User-Agent': UA, Accept: raw ? '*/*' : 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (auth) headers.Authorization = `Bearer ${await token()}`;
  for (let attempt = 1; ; attempt++) {
    const wait = last + PACE_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    let res;
    try {
      res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      if (attempt >= 3) fail(`${method} ${path}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 5000 * attempt));
      continue;
    }
    if ([429, 502, 503, 504].includes(res.status) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 10000 * attempt));
      continue;
    }
    if (res.status === 401 && auth && !retried) {
      rmSync(TOKEN, { force: true });
      session = null;
      return call(method, path, { body, auth, raw, retried: true });
    }
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 300);
      try { msg = JSON.parse(text).message || msg; } catch {}
      if (!auth) return { _status: res.status, message: msg };
      fail(`${method} ${path} → HTTP ${res.status}: ${msg}`);
    }
    if (raw) return text;
    return text ? JSON.parse(text) : {};
  }
}

const get = (path, opts) => call('GET', path, opts);

async function pages(path, per = 100) {
  const items = [];
  for (let page = 1; ; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const r = await get(`${path}${sep}page=${page}&resultsPerPage=${per}`);
    items.push(...(r.items || []));
    if (page >= (r.pagination?.nb_pages || 1)) return items;
  }
}

// ------------------------------------------------------------------ output helpers

function out(data, text) {
  if (flags.json) console.log(JSON.stringify(data, null, 2));
  else console.log(typeof text === 'function' ? text() : text);
}

function table(rows, cols) {
  if (!rows.length) return '(none)';
  const w = cols.map((c, i) => Math.min(c.max || 60, Math.max(c.h.length, ...rows.map((r) => String(r[i] ?? '').length))));
  const cell = (v, i) => {
    const s = String(v ?? '');
    return (s.length > w[i] ? s.slice(0, w[i] - 1) + '…' : s).padEnd(w[i]);
  };
  return [cols.map((c, i) => cell(c.h, i)).join('  '), ...rows.map((r) => r.map(cell).join('  ').trimEnd())].join('\n');
}

const day = (s) => (s || '').slice(0, 10);
const when = (s) => (s || '').replace('T', ' ').slice(0, 16);
const cents = (v, cur) => (v ? `${(v / 100).toFixed(2).replace(/\.00$/, '')} ${cur || ''}`.trim() : ''); // report rewards come in cents
const money = (min, max, cur) => (max ? `${min ?? 0}-${max} ${cur || ''}`.trim() : '');

// ------------------------------------------------------------------ setup

function ask(question, hidden) {
  return new Promise((done) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    let value = '';
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          return done(value.trim());
        }
        if (ch === '\u0003') process.exit(130);
        if (ch === '\u007f' || ch === '\b') {
          if (value) { value = value.slice(0, -1); if (!hidden) process.stdout.write('\b \b'); }
          continue;
        }
        value += ch;
        if (!hidden) process.stdout.write(ch);
      }
    };
    stdin.on('data', onData);
  });
}

async function setup() {
  let creds = flags['env-file'] ? fromEnv(parseEnv(readFileSync(flags['env-file'], 'utf8'))) : fromEnv(process.env);
  if (flags['env-file'] && !creds) fail(`${flags['env-file']} has no YWH_EMAIL and YWH_PASSWORD`);
  if (!creds) {
    if (!process.stdin.isTTY) fail('no TTY to prompt on: pass --env-file, or set YWH_EMAIL, YWH_PASSWORD and YWH_TOTP_SECRET');
    creds = {
      email: await ask('YesWeHack email: '),
      password: await ask('Password (hidden): ', true),
      totp_secret: await ask('TOTP secret, base32 or otpauth:// URI (hidden, empty if no 2FA): ', true),
    };
  }
  creds.totp_secret = totpSecret(creds.totp_secret);
  if (creds.totp_secret) totp(creds.totp_secret); // validates base32 before the login attempt
  session = await login(creds);
  saveFile(CREDS, JSON.stringify(creds, null, 2) + '\n');
  const u = await get('/user');
  console.log(`logged in as ${u.username}; credentials cached in ${CREDS} (mode 600)`);
}

// ------------------------------------------------------------------ account

async function whoami() {
  const u = await get('/user');
  const un = await get('/user/notifications/unread?context=hunter');
  out({ ...u, has_unread_notifications: un.has_unread }, () => [
    `${u.username} (${u.email})  ${WEB}/hunters/${u.slug || u.username}`,
    `2FA: ${u.totp_enabled ? 'on' : 'off'}   KYC: ${u.kyc_status}   VPN password: ${u.has_vpn_password ? 'set' : 'not set'}`,
    `credits: ${u.credit_balance_amount}`,
    `invitations: ${u.pending_invitation_number} pending, ${u.accepted_invitation_number} accepted   report claims pending: ${u.pending_report_claim_number}`,
    `unread notifications: ${un.has_unread ? 'yes' : 'no'}`,
  ].join('\n'));
}

async function aliases() {
  const r = await get('/user/email-aliases');
  out(r.items, () => table((r.items || []).map((a) => [a.alias, a.disabled ? 'disabled' : 'active', day(a.created_at)]),
    [{ h: 'alias', max: 80 }, { h: 'state' }, { h: 'created' }]));
}

async function credentials() {
  let items = await pages('/user/credentials', 50);
  if (flags.program) items = items.filter((c) => c.credential_pool?.program?.slug === flags.program);
  out(items, () => table(items.map((c) => [c.credential_pool?.program?.slug, c.credential_pool?.title, c.login,
    c.password, c.email || '', c.disabled ? 'disabled' : c.status]),
  [{ h: 'program', max: 40 }, { h: 'pool', max: 40 }, { h: 'login', max: 50 }, { h: 'password', max: 50 }, { h: 'email', max: 50 }, { h: 'status' }]));
}

async function pools(slug) {
  const r = await get(`/programs/${slug}/credential-pools`);
  const items = r.items || [];
  out(items, () => table(items.map((p) => [p.slug, p.title, p.status, p.credentials_number, p.revoked_at ? 'revoked' : '']),
    [{ h: 'pool', max: 60 }, { h: 'title', max: 60 }, { h: 'status' }, { h: 'credentials' }, { h: '' }]));
}

async function vpn() {
  const file = resolve(flags.out || 'yeswehack.ovpn');
  let conf = await get('/user/vpn/configuration', { raw: true });
  if (!conf.includes('remote ')) fail('the response is not an OpenVPN config');
  if (flags['with-auth']) {
    const creds = loadCreds();
    const authFile = file.replace(/\.ovpn$/, '') + '.auth';
    saveFile(authFile, `${creds.email}\n${creds.password}\n`);
    conf = conf.replace(/^auth-user-pass.*$/m, `auth-user-pass ${authFile}`);
    console.log(`auth file: ${authFile} (mode 600)`);
  }
  saveFile(file, conf);
  const remote = /^remote (.+)$/m.exec(conf)?.[1];
  console.log(`wrote ${file} (mode 600), server ${remote}\nconnect: sudo openvpn --config ${file}`);
}

// ------------------------------------------------------------------ programs

async function programs() {
  let items = await pages('/programs');
  if (flags.private) items = items.filter((p) => !p.public);
  if (flags.bounty) items = items.filter((p) => p.bounty);
  if (flags.search) {
    const q = flags.search.toLowerCase();
    items = items.filter((p) => `${p.title} ${p.slug} ${p.business_unit?.name || ''}`.toLowerCase().includes(q));
  }
  items.sort((a, b) => (a.public - b.public) || a.title.localeCompare(b.title));
  out(items, () => table(items.map((p) => [p.public ? 'public' : 'PRIVATE', p.slug, p.type,
    p.bounty ? money(p.bounty_reward_min, p.bounty_reward_max, p.business_unit?.currency) : (p.vdp ? 'VDP' : ''),
    p.scopes_count, p.reports_count, p.report_submission_cost, day(p.last_update_at)]),
  [{ h: 'access' }, { h: 'slug', max: 120 }, { h: 'type' }, { h: 'rewards' }, { h: 'scopes' }, { h: 'reports' }, { h: 'cost' }, { h: 'updated' }])
    + `\n${items.length} program(s)`);
}

const VALUES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'VERY_LOW'];
const GRIDS = [['critical', 'CRITICAL'], ['high', 'HIGH'], ['medium', 'MEDIUM'], ['low', 'LOW'], ['very_low', 'VERY_LOW'], ['default', 'default']];

async function program(slug) {
  const d = await get(`/programs/${slug}`);
  out(d, () => {
    const L = [
      `${d.title}  ${WEB}/programs/${d.slug}`,
      `${d.public ? 'public' : 'PRIVATE'} ${d.type}, ${d.bounty ? `bounty ${money(d.bounty_reward_min, d.bounty_reward_max, d.business_unit?.currency)}` : 'no bounty'}${d.vdp ? ', VDP' : ''}   business unit: ${d.business_unit?.name}`,
      `mandatory User-Agent token: ${d.user_agent || '(none)'}`,
      `VPN required: ${d.vpn_active ? 'YES (node ywh.mjs vpn)' : 'no'}   restricted IPs: ${JSON.stringify(d.restricted_ips ?? null)}`,
      `submission cost: ${d.report_submission_cost} credit(s), your balance ${d.credit_balance}   credential pools: up to ${d.max_credential_pool_number ?? 0}`,
      `reports: ${d.reports_count} (24 h: ${d.stats?.total_reports_last24_hours}, 7 d: ${d.stats?.total_reports_last7_days})   last brief update: ${day(d.last_update_at)}`,
      `out of scope: ${d.out_of_scope?.length ?? 0} lines, qualifying: ${d.qualifying_vulnerability?.length ?? 0}, non-qualifying: ${d.non_qualifying_vulnerability?.length ?? 0} (read them with "scope ${slug}")`,
      '',
      'rewards     low     medium  high    critical',
      ...GRIDS.filter(([k]) => { const g = d[`reward_grid_${k}`]; return g && [g.bounty_low, g.bounty_medium, g.bounty_high, g.bounty_critical].some((v) => v != null); }).map(([k, label]) => {
        const g = d[`reward_grid_${k}`];
        return [label, g.bounty_low, g.bounty_medium, g.bounty_high, g.bounty_critical].map((v) => String(v ?? '').padEnd(8)).join('').replace(/^(\S+)\s*/, (m, a) => a.padEnd(12));
      }),
      '',
      `scopes (${d.scopes?.length ?? 0}):`,
    ];
    for (const v of VALUES) for (const s of d.scopes || []) if (s.asset_value === v) L.push(`  ${v.padEnd(9)} ${s.scope}  [${s.scope_type_name || s.scope_type}]`);
    for (const s of d.scopes || []) if (!VALUES.includes(s.asset_value)) L.push(`  ${String(s.asset_value).padEnd(9)} ${s.scope}  [${s.scope_type_name || s.scope_type}]`);
    return L.join('\n');
  });
}

function scopeMarkdown(d) {
  const L = [];
  const w = (s = '') => L.push(s);
  const quote = (text) => (text || '').split(/\r?\n/).forEach((l) => w(l.trim() ? `> ${l}` : '>'));
  const st = d.stats || {};
  w(`# ${d.title} — scope, verbatim from the program JSON`);
  w();
  w(`Generated by \`ywh.mjs scope ${d.slug}\` from \`GET /programs/${d.slug}\`. Everything below is reproduced verbatim from the brief; do not hand-edit.`);
  w();
  w('| | |');
  w('|---|---|');
  w(`| program | [${d.title}](${WEB}/programs/${d.slug}) |`);
  w(`| business unit | ${d.business_unit?.name} (\`${d.business_unit?.slug}\`) |`);
  w(`| visibility | ${d.public ? '**public**' : '**private**'} |`);
  w(`| type | ${d.type} · bounty=${d.bounty} · vdp=${d.vdp} |`);
  w(`| report submission cost | **${d.report_submission_cost} credit(s)** |`);
  w(`| reports already filed | **${d.reports_count}** (last 24 h: ${st.total_reports_last24_hours}, last 7 d: ${st.total_reports_last7_days}, this month: ${st.total_reports_current_month}) |`);
  w(`| average / max reward | ${st.average_reward} / ${st.max_reward} |`);
  w(`| average first response | ${st.average_first_time_response} |`);
  w(`| scopes | **${d.scopes_count}** |`);
  w(`| **mandatory User-Agent** | \`user_agent\` = **\`${d.user_agent}\`** |`);
  w(`| YWH triager User-Agent | \`${d.ywh_triager_user_agent}\` |`);
  w(`| VPN required | \`vpn_active\` = **${d.vpn_active}** (\`vpn_ips\`=${JSON.stringify(d.vpn_ips ?? null)}, \`vpn_outbound_ips\`=${JSON.stringify(d.vpn_outbound_ips ?? null)}) |`);
  w(`| restricted IPs | \`restricted_ips\` = ${JSON.stringify(d.restricted_ips ?? null)} |`);
  w(`| credential pool | \`max_credential_pool_number\` = ${d.max_credential_pool_number} |`);
  w(`| leakage rule | \`leakage_rule_enabled\` = ${d.leakage_rule_enabled} |`);
  w(`| systemic issue rule | \`systemic_issue_rule_enabled\` = ${d.systemic_issue_rule_enabled}, grid ${JSON.stringify(d.systemic_issue_rule_grid ?? null)} |`);
  w(`| per-scope report counts published | \`report_count_per_scope\` = ${d.report_count_per_scope} |`);
  w(`| collaboration | \`report_collaboration_active\` = ${d.report_collaboration_active} |`);
  w(`| hall of fame | ${d.hall_of_fame} |`);
  w(`| SLA | \`sla_enabled\` = ${d.sla_enabled}, grid ${JSON.stringify(d.sla_grid ?? null)} |`);
  w(`| last brief update | ${d.last_update_at} |`);
  w(`| languages | ${(d.supported_languages || []).join(', ')} |`);
  w(`| our rights | ${(d.rights || []).join(', ')} |`);
  w(`| our credit balance | ${d.credit_balance} (projected ${d.credit_balance_projected}) |`);
  w();
  w(`## Reward grids (${d.business_unit?.currency || 'program currency'})`);
  w();
  w('| asset value | low | medium | high | critical |');
  w('|---|---|---|---|---|');
  for (const [k, label] of GRIDS) {
    const g = d[`reward_grid_${k}`];
    if (g) w(`| ${label} | ${g.bounty_low} | ${g.bounty_medium} | ${g.bounty_high} | ${g.bounty_critical} |`);
  }
  w();
  w(`Program-wide: \`bounty_reward_min\` = ${d.bounty_reward_min}, \`bounty_reward_max\` = ${d.bounty_reward_max}.`);
  w();
  const scopes = d.scopes || [];
  const hasRc = scopes.some((s) => 'report_count' in s);
  w(`## The ${scopes.length} scope(s), verbatim`);
  w();
  w(`| # | scope | type | asset value |${hasRc ? ' reports filed |' : ''}`);
  w(`|---|---|---|---|${hasRc ? '---|' : ''}`);
  const ordered = [...VALUES.flatMap((v) => scopes.filter((s) => s.asset_value === v)), ...scopes.filter((s) => !VALUES.includes(s.asset_value))];
  ordered.forEach((s, i) => w(`| ${i + 1} | \`${s.scope}\` | ${s.scope_type_name || s.scope_type} | **${s.asset_value}** |${hasRc ? ` ${s.report_count} |` : ''}`));
  w();
  w(`Counts by asset value: ${VALUES.map((v) => `${v}=${scopes.filter((s) => s.asset_value === v).length}`).join(', ')}  (total ${scopes.length})`);
  w();
  w('## Out of scope, verbatim');
  w();
  for (const o of d.out_of_scope || []) w(`> ${o}`);
  w();
  w('## Account access, verbatim');
  w();
  quote(d.account_access);
  w();
  w('## Program rules, verbatim');
  w();
  quote(d.rules);
  w();
  w(`## Qualifying vulnerabilities, verbatim (${d.qualifying_vulnerability?.length ?? 0})`);
  w();
  for (const q of d.qualifying_vulnerability || []) w(`- ${q}`);
  w();
  w(`## Non-qualifying vulnerabilities, verbatim (${d.non_qualifying_vulnerability?.length ?? 0})`);
  w();
  for (const q of d.non_qualifying_vulnerability || []) w(`- ${q}`);
  w();
  if (d.attachments?.length) {
    w('## Attachments listed on the brief');
    w();
    for (const a of d.attachments) w(`- \`${a.name}\` — ${a.original_name}`);
    w();
  }
  w(`_Generated ${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}._`);
  return L.join('\n') + '\n';
}

async function scope(slug) {
  const d = await get(`/programs/${slug}`);
  const md = scopeMarkdown(d);
  if (flags.out) {
    mkdirSync(dirname(resolve(flags.out)), { recursive: true });
    writeFileSync(flags.out, md);
    console.log(`wrote ${resolve(flags.out)} (${md.split('\n').length} lines)`);
  } else process.stdout.write(md);
}

// ------------------------------------------------------------------ reports

async function myReports() {
  let items = await pages('/user/reports', 50);
  if (flags.program) items = items.filter((r) => r.program?.slug === flags.program);
  if (flags.open) items = items.filter((r) => !FINAL.has(r.status?.workflow_state));
  return items;
}

async function reports() {
  const items = await myReports();
  out(items, () => table(items.map((r) => [r.local_id, r.id, r.status?.workflow_state, cents(r.reward, r.currency),
    r.program?.slug, day(r.changed_at), r.title]),
  [{ h: 'report' }, { h: 'id' }, { h: 'state' }, { h: 'reward' }, { h: 'program', max: 40 }, { h: 'changed' }, { h: 'title', max: 70 }]));
}

async function resolveReport(ref) {
  if (/^\d+$/.test(ref)) return Number(ref);
  const want = ref.replace(/^#?/, '#').toUpperCase();
  const hit = (await pages('/user/reports', 50)).find((r) => r.local_id.toUpperCase() === want);
  if (!hit) fail(`no report of yours has local id ${want}`);
  return hit.id;
}

function thread(logs) {
  return (logs.items || [])
    .filter((it) => it.message || it.type === 'comment' || it.type === 'status-update' || it.type === 'close')
    .map((it) => ({
      at: it.created_at,
      who: it.author_indicator || 'unknown',
      name: it.author?.username || it.company?.name || '',
      type: it.type,
      status: it.status?.workflow_state || '',
      private: !!it.private,
      message: (it.message || '').replace(/\r\n/g, '\n').trim(),
    }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

// Whose move it is, by the same rules the user's monitor uses.
function turn(report, msgs) {
  const state = report.status?.workflow_state;
  const lastHuman = [...msgs].reverse().find((m) => m.who !== 'bot' && (m.message || m.type === 'comment'));
  if (state === 'more_info') return ['you', 'program asked for more info'];
  if (String(report.ask_for_fix_verification_status).toLowerCase() === 'pending') return ['you', 'fix verification requested'];
  if (FINAL.has(state)) return ['closed', state];
  if (lastHuman && lastHuman.who !== 'hunter' && lastHuman.type === 'comment') return ['you', `${lastHuman.who} commented`];
  return ['them', lastHuman?.who === 'hunter' ? 'you wrote last' : 'waiting on program'];
}

async function report(ref) {
  const id = await resolveReport(ref);
  const d = await get(`/reports/${id}`);
  const msgs = thread(await get(`/reports/${id}/logs`));
  const [ball, why] = turn(d, msgs);
  out({ report: d, thread: msgs, turn: { ball, why } }, () => {
    const L = [
      `${d.local_id}  ${d.title}`,
      `${WEB}/reports/${d.id}   program: ${d.program?.slug}`,
      `state: ${d.status?.workflow_state}   triage: ${d.triage_status || '-'}   turn: ${ball} (${why})`,
      `bug type: ${d.bug_type?.name || '-'}   CVSS: ${d.cvss?.score ?? '-'} ${d.cvss?.vector || ''}   asset value: ${d.asset_value || '-'}`,
      `scope: ${d.scope || '-'}   endpoint: ${d.end_point || '-'}   vulnerable part: ${d.vulnerable_part || '-'} ${d.part_name || ''}`,
      `reward: ${cents(d.reward, d.currency) || '-'}   filed ${when(d.created_at)}   attachments: ${d.attachments?.length ?? 0}`,
    ];
    if (flags.description) L.push('', '--- description', d.description || '(empty)');
    L.push('', `--- conversation (${msgs.length})`);
    for (const m of msgs) {
      const head = `${when(m.at)}  ${m.who}${m.name ? ` (${m.name})` : ''}  ${m.type}${m.status ? ` → ${m.status}` : ''}${m.private ? '  [private]' : ''}`;
      L.push('', head);
      if (m.message) L.push(m.message.split('\n').map((l) => `    ${l}`).join('\n'));
    }
    return L.join('\n');
  });
}

async function todo() {
  flags.open = true;
  const items = await myReports();
  const rows = [];
  for (const r of items) {
    const msgs = thread(await get(`/reports/${r.id}/logs`));
    const [ball, why] = turn(r, msgs);
    const lastMsg = [...msgs].reverse().find((m) => m.message && m.who !== 'bot');
    rows.push({ local_id: r.local_id, id: r.id, program: r.program?.slug, state: r.status?.workflow_state, ball, why,
      since: lastMsg?.at || r.changed_at, last: lastMsg ? `${lastMsg.who}: ${lastMsg.message.replace(/\s+/g, ' ').slice(0, 140)}` : '', title: r.title });
  }
  rows.sort((a, b) => (a.ball !== 'you') - (b.ball !== 'you') || b.since.localeCompare(a.since));
  out(rows, () => {
    const mine = rows.filter((r) => r.ball === 'you');
    const L = [`${mine.length} of ${rows.length} open report(s) need you`];
    for (const r of rows) L.push('', `${r.ball === 'you' ? '▶ YOU' : '  them'}  ${r.local_id}  ${r.state}  ${r.why}  since ${when(r.since)}`, `       ${r.title}`, ...(r.last ? [`       ${r.last}`] : []));
    return L.join('\n');
  });
}

// ------------------------------------------------------------------ watch

const SCALAR = ['title', 'status', 'type', 'public', 'bounty', 'vdp', 'disabled', 'archived', 'report_submission_cost',
  'bounty_reward_min', 'bounty_reward_max', 'scopes_count', 'user_agent', 'vpn_active', 'systemic_issue_rule_enabled',
  'max_credential_pool_number'];
const STRUCT = ['reward_grid_default', 'reward_grid_very_low', 'reward_grid_low', 'reward_grid_medium', 'reward_grid_high',
  'reward_grid_critical', 'systemic_issue_rule_grid', 'qualifying_vulnerability', 'non_qualifying_vulnerability', 'out_of_scope'];
const TEXT = ['rules', 'account_access', 'disable_message'];

// Key order differs between snapshots, so compare canonical JSON.
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

function diffBrief(a, b) {
  const o = [];
  const j = (v) => canon(v ?? null);
  for (const f of SCALAR) if (j(a[f]) !== j(b[f])) o.push(`${f}: ${j(a[f])} -> ${j(b[f])}`);
  for (const f of STRUCT) {
    if (j(a[f]) === j(b[f])) continue;
    if (Array.isArray(a[f]) && Array.isArray(b[f])) {
      const as = new Set(a[f].map(j)), bs = new Set(b[f].map(j));
      for (const x of bs) if (!as.has(x)) o.push(`${f} + ${x.slice(0, 300)}`);
      for (const x of as) if (!bs.has(x)) o.push(`${f} - ${x.slice(0, 300)}`);
    } else o.push(`${f}: ${j(a[f])} -> ${j(b[f])}`);
  }
  for (const f of TEXT) if ((a[f] || '') !== (b[f] || '')) o.push(`${f} text changed (${(a[f] || '').length} -> ${(b[f] || '').length} chars)`);
  const key = (s) => `${s.scope} [${s.scope_type}]`;
  const sa = new Map((a.scopes || []).map((s) => [key(s), s])), sb = new Map((b.scopes || []).map((s) => [key(s), s]));
  for (const [k, s] of sb) if (!sa.has(k)) o.push(`SCOPE ADDED: ${k} value=${s.asset_value}`);
  for (const k of sa.keys()) if (!sb.has(k)) o.push(`SCOPE REMOVED: ${k}`);
  for (const [k, s] of sb) if (sa.has(k) && sa.get(k).asset_value !== s.asset_value) o.push(`scope value ${k}: ${sa.get(k).asset_value} -> ${s.asset_value}`);
  return o;
}

async function watch() {
  const dir = resolve(flags.state || join(HOME, 'watch'));
  const snapDir = join(dir, 'programs');
  mkdirSync(snapDir, { recursive: true, mode: 0o700 });
  const indexFile = join(dir, 'index.json');
  const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : {};
  const first = !Object.keys(index).length;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const list = await pages('/programs');
  const events = [];
  for (const p of list) {
    const old = index[p.slug];
    const snap = join(snapDir, `${p.slug}.json`);
    const prev = existsSync(snap) ? JSON.parse(readFileSync(snap, 'utf8')) : null;
    let detail = null;
    if (!old || old.last_update_at !== p.last_update_at || !p.public || !prev) {
      detail = await get(`/programs/${p.slug}`).catch(() => null);
    }
    if (!old && !first) events.push({ kind: 'NEW_PROGRAM', slug: p.slug, private: !p.public,
      detail: [`${p.title} | ${p.public ? 'public' : 'PRIVATE'} | ${p.type} | ${money(p.bounty_reward_min, p.bounty_reward_max, p.business_unit?.currency)} | scopes=${p.scopes_count}`] });
    else if (detail && prev) {
      const changes = diffBrief(prev, detail);
      if (changes.length) events.push({ kind: 'UPDATED', slug: p.slug, private: !p.public, detail: changes });
    }
    if (detail) saveFile(snap, JSON.stringify(detail, null, 1));
    index[p.slug] = { title: p.title, public: p.public, last_update_at: p.last_update_at, first_seen: old?.first_seen || now, last_seen: now };
  }
  const live = new Set(list.map((p) => p.slug));
  for (const [slug, v] of Object.entries(index)) {
    if (live.has(slug) || v.gone) continue;
    events.push({ kind: 'REMOVED', slug, private: !v.public, detail: ['no longer listed (closed, archived, or access revoked)'] });
    v.gone = now;
  }
  saveFile(indexFile, JSON.stringify(index, null, 1));
  if (events.length) {
    const log = events.map((e) => [`${e.private ? '★ ' : ''}${e.kind} ${e.slug}  ${WEB}/programs/${e.slug}`, ...e.detail.map((d) => `   ${d}`)].join('\n')).join('\n');
    writeFileSync(join(dir, 'changes.log'), `\n=== ${now} ===\n${log}\n`, { flag: 'a', mode: 0o600 });
  }
  events.sort((a, b) => (b.private - a.private) || a.kind.localeCompare(b.kind));
  out({ at: now, baseline: first, programs: list.length, events }, () => {
    if (first) return `baseline recorded: ${list.length} programs in ${dir}`;
    if (!events.length) return `no changes across ${list.length} programs`;
    return [`${events.length} change(s) across ${list.length} programs (★ = private)`,
      ...events.map((e) => [`${e.private ? '★ ' : ''}${e.kind} ${e.slug}  ${WEB}/programs/${e.slug}`, ...e.detail.map((d) => `   ${d}`)].join('\n'))].join('\n');
  });
}

// ------------------------------------------------------------------ main

const need = (n, what) => { if (pos.length <= n) fail(`missing ${what}\n\n${USAGE}`); return pos[n]; };
const commands = {
  setup,
  logout: async () => { rmSync(CREDS, { force: true }); rmSync(TOKEN, { force: true }); console.log(`removed ${CREDS} and ${TOKEN}`); },
  whoami,
  token: async () => console.log(await token()),
  programs,
  program: () => program(need(1, '<slug>')),
  scope: () => scope(need(1, '<slug>')),
  pools: () => pools(need(1, '<slug>')),
  credentials,
  aliases,
  vpn,
  reports,
  report: () => report(need(1, '<id|#YWH-...>')),
  todo,
  watch,
  get: async () => {
    const p = need(1, '<api-path>');
    console.log(JSON.stringify(await get(p.startsWith('/') ? p : `/${p}`), null, 2));
  },
};

if (!pos.length || flags.help || !commands[pos[0]]) {
  console.log(USAGE);
  process.exit(pos.length && !flags.help ? 1 : 0);
}
await commands[pos[0]]();
