#!/usr/bin/env node
import crypto from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = process.env.TOTP_HOME || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'totp');
const STORE = join(HOME, 'secrets.json');
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const USAGE = `usage: totp <command> [args] [--json]

  add NAME [--force]      save a secret under NAME: base32 or an otpauth:// URI, read from
                          a hidden prompt on a TTY, else from stdin
  code NAME               print the current code and the seconds it has left
  code -                  same, for a one-off secret read from stdin (nothing is saved)
  list                    saved names with issuer, digits and period (never the secret)
  rm NAME                 delete a saved secret

code waits for the next period when fewer than --min-left seconds remain (default 5,
0 to never wait). Secrets live in ${STORE} (mode 600; TOTP_HOME moves it).`;

function fail(message, code = 1) {
  console.error(`totp: ${message}`);
  process.exit(code);
}

const flags = {};
const pos = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '-h' || a === '--help') flags.help = true;
  else if (a === '--json' || a === '--force') flags[a.slice(2)] = true;
  else if (a === '--min-left') flags['min-left'] = argv[++i];
  else if (a.startsWith('--')) fail(`unknown flag ${a}`);
  else pos.push(a);
}

function load() {
  return existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : {};
}

function save(store) {
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  writeFileSync(STORE, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 });
  chmodSync(STORE, 0o600);
}

function checkName(name) {
  if (!name) fail('missing NAME');
  if (!/^[\w.@-]+$/.test(name)) fail(`bad name "${name}": use letters, digits and . _ @ -`);
  return name.toLowerCase();
}

function entry(store, name) {
  const e = store[checkName(name)];
  if (!e) fail(`no secret named "${name}"; saved: ${Object.keys(store).join(', ') || 'none'}`, 3);
  return e;
}

function parse(input) {
  const text = (input || '').trim();
  let e = { secret: text, digits: 6, period: 30, algorithm: 'SHA1', issuer: '' };
  if (/^otpauth:/i.test(text)) {
    const url = new URL(text);
    if (url.host.toLowerCase() !== 'totp') fail(`only otpauth://totp URIs are supported, got ${url.host}`);
    const q = url.searchParams;
    const label = decodeURIComponent(url.pathname.slice(1));
    e = {
      secret: q.get('secret') || '',
      digits: Number(q.get('digits') || 6),
      period: Number(q.get('period') || 30),
      algorithm: (q.get('algorithm') || 'SHA1').toUpperCase(),
      issuer: q.get('issuer') || (label.includes(':') ? label.split(':')[0] : ''),
    };
  }
  e.secret = e.secret.replace(/[\s=-]/g, '').toUpperCase();
  if (!e.secret) fail('empty secret');
  if (![...e.secret].every((c) => ALPHABET.includes(c))) {
    fail('secret is not base32 (it is the text behind the QR code, not a 6-digit code)');
  }
  if (!['SHA1', 'SHA256', 'SHA512'].includes(e.algorithm)) fail(`unsupported algorithm ${e.algorithm}`);
  if (!(e.digits >= 6 && e.digits <= 8)) fail(`unsupported digits ${e.digits}`);
  if (!(e.period > 0)) fail(`bad period ${e.period}`);
  return e;
}

function base32(s) {
  const bits = [...s].map((c) => ALPHABET.indexOf(c).toString(2).padStart(5, '0')).join('');
  return Buffer.from((bits.match(/.{8}/g) || []).map((b) => parseInt(b, 2)));
}

function totp(e, seconds) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(seconds / e.period)));
  const mac = crypto.createHmac(e.algorithm.toLowerCase(), base32(e.secret)).update(counter).digest();
  const off = mac[mac.length - 1] & 0x0f;
  return String((mac.readUInt32BE(off) & 0x7fffffff) % 10 ** e.digits).padStart(e.digits, '0');
}

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

function askHidden(question) {
  return new Promise((done) => {
    process.stderr.write(question);
    const stdin = process.stdin;
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', function onData(chunk) {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stderr.write('\n');
          return done(value);
        }
        if (ch === '\u0003') { stdin.setRawMode(false); process.exit(130); }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    });
  });
}

async function add(name) {
  const key = checkName(name);
  const store = load();
  if (store[key] && !flags.force) fail(`"${key}" already exists; add --force to replace it`);
  const input = process.stdin.isTTY ? await askHidden(`secret for ${key} (base32 or otpauth:// URI, hidden): `) : readStdin();
  const e = parse(input);
  totp(e, Date.now() / 1000);
  store[key] = e;
  save(store);
  console.log(`saved "${key}"${e.issuer ? ` (${e.issuer})` : ''} in ${STORE}`);
}

async function code(name) {
  if (!name) fail('missing NAME (or "-" to read a secret from stdin)');
  const e = name === '-' ? parse(readStdin()) : entry(load(), name);
  const minLeft = Number(flags['min-left'] ?? 5);
  let now = Date.now() / 1000;
  let left = e.period - (now % e.period);
  if (left < Math.min(minLeft, e.period)) {
    await new Promise((r) => setTimeout(r, left * 1000 + 50));
    now = Date.now() / 1000;
    left = e.period - (now % e.period);
  }
  const otp = totp(e, now);
  const secs = Math.floor(left);
  console.log(flags.json ? JSON.stringify({ code: otp, expires_in: secs }) : `${otp}  (${secs}s left)`);
}

function list() {
  const store = load();
  const rows = Object.entries(store).map(([name, e]) => ({ name, issuer: e.issuer, digits: e.digits, period: e.period, algorithm: e.algorithm }));
  if (flags.json) return console.log(JSON.stringify(rows));
  if (!rows.length) return console.log('no saved secrets');
  const w = Math.max(...rows.map((r) => r.name.length));
  for (const r of rows) console.log(`${r.name.padEnd(w)}  ${r.digits} digits / ${r.period}s / ${r.algorithm}${r.issuer ? `  ${r.issuer}` : ''}`);
}

function rm(name) {
  const store = load();
  entry(store, name);
  delete store[checkName(name)];
  save(store);
  console.log(`removed "${checkName(name)}"`);
}

const [cmd, arg] = pos;
if (flags.help || !cmd) console.log(USAGE);
else if (cmd === 'add') await add(arg);
else if (cmd === 'code') await code(arg);
else if (cmd === 'list') list();
else if (cmd === 'rm') rm(arg);
else fail(`unknown command "${cmd}"\n${USAGE}`);
