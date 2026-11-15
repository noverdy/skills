#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { promises as dns } from 'node:dns';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync,
  symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const UA = 'using-surfshark-proxies/1.0';
const API_CLUSTERS = 'https://api.surfshark.com/v1/server/clusters';
const API_ME = 'https://api.surfshark.com/v1/server/user';
const API_CONFIGS = 'https://my.surfshark.com/vpn/api/v1/server/configurations';
const HOME = process.env.SURFSHARK_PROXY_HOME
  || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'surfshark-proxy');
const CACHE = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'surfshark-proxy');
const STATE = join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'surfshark-proxy');
const USER_FILE = join(HOME, 'openvpn_user');
const PASS_FILE = join(HOME, 'openvpn_password');
const CONFIG_FILE = join(HOME, 'config.json');
const DEFAULTS = { image: 'qmcgaw/gluetun:v3', ports: [8880, 8899] };
const LABEL = 'surfshark.session';
const PREFIX = 'surfshark-';
const CONFIG_MAX_AGE_MS = 7 * 86400e3;
const UP_TIMEOUT_MS = 60e3;
const PROBE_TIMEOUT_MS = 8e3;

const USAGE = `usage: surfshark-proxy <command> [args] [--json]

  setup [--from-file f] [--link | --link-as name]
                                   save the OpenVPN service credentials, pull the image and
                                   test a login (prompts on a TTY; --from-file reads two lines,
                                   username then password, "-" for stdin; --link puts
                                   the command in ~/.local/bin)
  setup --check                    test the saved credentials only
  list [COUNTRY]                   countries and cities with current load

  up COUNTRY [CITY] [--name n] [--port p] [--tcp]
                                   start a session on the least-loaded matching server and
                                   print its proxy URL and exit IP
  down NAME... | --all             stop sessions
  status [NAME]                    sessions with port, server, health and live exit IP
  exec NAME [--image img] -- CMD   run CMD in a container whose only network is the session
                                   (default image alpine:latest; cwd is mounted at /work)
  logs NAME [--follow]             the session's gluetun log

COUNTRY is a code (jp, us) or name ("united states"); CITY is a substring (boston).
Credentials and config: ${HOME} (SURFSHARK_PROXY_HOME). Needs Docker.`;

function fail(message, code = 1) {
  console.error(`surfshark-proxy: ${message}`);
  process.exit(code);
}

const argv = process.argv.slice(2);
const dashdash = argv.indexOf('--');
const head = dashdash < 0 ? argv : argv.slice(0, dashdash);
const tail = dashdash < 0 ? [] : argv.slice(dashdash + 1);
const BOOL = ['json', 'tcp', 'all', 'follow', 'check', 'link', 'help'];
const flags = {};
const pos = [];
for (let i = 0; i < head.length; i++) {
  const a = head[i];
  if (a === '-h') flags.help = true;
  else if (a.startsWith('--')) {
    const k = a.slice(2);
    if (BOOL.includes(k)) flags[k] = true;
    else if (i + 1 < head.length) flags[k] = head[++i];
    else fail(`--${k} needs a value`);
  } else pos.push(a);
}

const norm = (s) => (s || '').trim().toLowerCase();
const slug = (s) => norm(s).normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function saveFile(path, text, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, text, { mode });
  chmodSync(path, mode);
}

function config() {
  try { return { ...DEFAULTS, ...JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) }; } catch { return DEFAULTS; }
}

function fetchBuf(url, timeout = 15e3) {
  return new Promise((done, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA }, timeout }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} from ${url}`)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => done(Buffer.concat(chunks)));
    });
    req.on('timeout', () => req.destroy(new Error(`timeout fetching ${url}`)));
    req.on('error', reject);
  });
}

function docker(args, { input, allowFail } = {}) {
  const r = spawnSync('docker', args, { encoding: 'utf8', input, maxBuffer: 64 << 20 });
  if (r.error) fail('docker not found: install Docker and make sure `docker` is on PATH');
  if (r.status !== 0 && !allowFail) fail(`docker ${args[0]} failed: ${(r.stderr || r.stdout).trim()}`);
  return r;
}

function requireDocker() {
  const r = docker(['version', '--format', '{{.Server.Version}}'], { allowFail: true });
  if (r.status !== 0) {
    fail(`cannot reach the Docker daemon: ${r.stderr.trim().split('\n').pop()}\n`
      + 'Start Docker, and on Linux add yourself to the docker group (then log in again).');
  }
}

function requireSetup() {
  if (!existsSync(USER_FILE) || !existsSync(PASS_FILE)) {
    fail('not set up: the user runs "surfshark-proxy setup" in their own terminal to save the Surfshark '
      + 'service credentials', 2);
  }
}

async function clusters() {
  const cache = join(CACHE, 'clusters.json');
  try {
    const data = JSON.parse(await fetchBuf(API_CLUSTERS));
    saveFile(cache, JSON.stringify(data));
    return data;
  } catch (e) {
    if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8'));
    fail(`cannot fetch the server list: ${e.message}`);
  }
}

function pick(servers, country, city) {
  const c = norm(country);
  let pool = servers.filter((s) => norm(s.countryCode) === c);
  if (!pool.length) pool = servers.filter((s) => norm(s.country).includes(c));
  if (!pool.length) fail(`no server in country "${country}" (see: surfshark-proxy list)`);
  if (city) {
    pool = pool.filter((s) => norm(s.location).includes(norm(city)));
    if (!pool.length) fail(`no server in city "${city}" (see: surfshark-proxy list ${country})`);
  }
  return pool.reduce((a, b) => ((b.load ?? 100) < (a.load ?? 100) ? b : a));
}

function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  const files = new Map();
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = buf.readUInt16LE(eocd + 10); n > 0; n--) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const skip = nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    files.set(name, { method, data: buf.subarray(start, start + size) });
    p += 46 + skip;
  }
  return (name) => {
    const f = files.get(name);
    if (!f) return null;
    return (f.method === 8 ? inflateRawSync(f.data) : f.data).toString('utf8');
  };
}

async function ovpnBundle(force = false) {
  const zip = join(CACHE, 'configs.zip');
  const fresh = existsSync(zip) && Date.now() - statSync(zip).mtimeMs < CONFIG_MAX_AGE_MS;
  if (!fresh || force) {
    try {
      saveFile(zip, await fetchBuf(API_CONFIGS, 60e3), 0o644);
    } catch (e) {
      if (!existsSync(zip)) fail(`cannot download server configs: ${e.message}`);
    }
  }
  return unzip(readFileSync(zip));
}

async function sessionConfig(server, proto) {
  const file = `${server.connectionName}_${proto}.ovpn`;
  let text = (await ovpnBundle())(file) ?? (await ovpnBundle(true))(file);
  if (!text) fail(`Surfshark publishes no config for ${server.connectionName} (${proto})`);
  const ips = await dns.resolve4(server.connectionName).catch(() => []);
  if (!ips.length) fail(`cannot resolve ${server.connectionName}`);
  text = text.split(/\r?\n/).flatMap((line) => {
    const m = line.match(/^remote\s+(\S+)\s+(\d+)/);
    return m ? ips.map((ip) => `remote ${ip} ${m[2]}`) : [line];
  }).join('\n');
  return `${text}\npull-filter ignore "block-outside-dns"\n`;
}

function sessions() {
  const ids = docker(['ps', '-aq', '--filter', `label=${LABEL}`]).stdout.split(/\s+/).filter(Boolean);
  if (!ids.length) return [];
  return JSON.parse(docker(['inspect', ...ids]).stdout).map((c) => {
    const l = c.Config.Labels;
    return {
      name: l[LABEL],
      container: c.Name.replace(/^\//, ''),
      port: Number(l['surfshark.port']),
      proxy: `http://127.0.0.1:${l['surfshark.port']}`,
      server: l['surfshark.server'],
      country: l['surfshark.country'],
      city: l['surfshark.city'],
      proto: l['surfshark.proto'],
      state: c.State.Status,
      health: c.State.Health?.Status || 'none',
      started: c.State.StartedAt,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function portFree(port) {
  return new Promise((done) => {
    const s = net.createServer().once('error', () => done(false))
      .once('listening', () => s.close(() => done(true)));
    s.listen(port, '127.0.0.1');
  });
}

async function freePort(taken) {
  const [lo, hi] = config().ports;
  for (let p = lo; p <= hi; p++) if (!taken.has(p) && await portFree(p)) return p;
  fail(`no free port in ${lo}-${hi}: stop a session or widen "ports" in ${CONFIG_FILE}`);
}

function probe(port, timeout = PROBE_TIMEOUT_MS) {
  return new Promise((done) => {
    const host = 'api.surfshark.com';
    const timer = setTimeout(() => { req.destroy(); done(null); }, timeout);
    const finish = (v) => { clearTimeout(timer); done(v); };
    const req = http.request({ host: '127.0.0.1', port, method: 'CONNECT', path: `${host}:443` });
    req.on('error', () => finish(null));
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); return finish(null); }
      const get = https.get({
        host, path: new URL(API_ME).pathname, headers: { 'User-Agent': UA },
        createConnection: () => tls.connect({ socket, servername: host }),
      }, (r) => {
        let body = '';
        r.on('data', (c) => { body += c; });
        r.on('end', () => { try { finish(JSON.parse(body)); } catch { finish(null); } });
      });
      get.on('error', () => finish(null));
    });
    req.end();
  });
}

function logTail(container, lines = 15) {
  const r = docker(['logs', '--tail', String(lines), container], { allowFail: true });
  return (r.stdout + r.stderr).trim();
}

async function runContainer({ container, name, server, proto, port, ovpnPath }) {
  const img = config().image;
  const r = docker(['run', '-d', '--name', container,
    '--label', `${LABEL}=${name}`, '--label', `surfshark.port=${port}`,
    '--label', `surfshark.server=${server.connectionName}`, '--label', `surfshark.country=${server.country}`,
    '--label', `surfshark.city=${server.location}`, '--label', `surfshark.proto=${proto}`,
    '--cap-add', 'NET_ADMIN', '--device', '/dev/net/tun',
    '-p', `127.0.0.1:${port}:8888`,
    '-e', 'VPN_SERVICE_PROVIDER=custom', '-e', 'VPN_TYPE=openvpn',
    '-e', 'OPENVPN_CUSTOM_CONFIG=/gluetun/custom.ovpn', '-e', 'HTTPPROXY=on',
    '-e', 'PUBLICIP_ENABLED=off', '-e', 'VERSION_INFORMATION=off',
    '-v', `${ovpnPath}:/gluetun/custom.ovpn:ro`,
    '-v', `${USER_FILE}:/run/secrets/openvpn_user:ro`,
    '-v', `${PASS_FILE}:/run/secrets/openvpn_password:ro`,
    img], { allowFail: true });
  if (r.status !== 0) return { status: 'docker', error: r.stderr.trim() };
  const deadline = Date.now() + UP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(1000);
    const [c] = JSON.parse(docker(['inspect', container]).stdout);
    if (c.State.Health?.Status === 'healthy') return { status: 'healthy' };
    if (/AUTH_FAILED/.test(logTail(container, 200))) return { status: 'auth' };
    if (c.State.Status !== 'running') return { status: 'exited' };
  }
  return { status: 'timeout' };
}

function removeSession(name) {
  docker(['rm', '-f', PREFIX + name], { allowFail: true });
  rmSync(join(STATE, 'sessions', `${name}.ovpn`), { force: true });
}

async function up() {
  requireSetup();
  requireDocker();
  const [, country, city] = pos;
  if (!country) fail(`missing COUNTRY\n\n${USAGE}`);
  const name = flags.name || [norm(country), city && slug(city)].filter(Boolean).join('-');
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(name)) fail(`bad session name "${name}": use a-z, 0-9 and dashes`);
  const existing = sessions();
  if (existing.some((s) => s.name === name)) {
    fail(`session "${name}" already exists (surfshark-proxy status ${name}); pass --name for another one`);
  }
  const taken = new Set(existing.map((s) => s.port));
  if (flags.port) {
    const p = Number(flags.port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) fail(`bad port "${flags.port}"`);
    if (taken.has(p) || !(await portFree(p))) fail(`port ${p} is in use; pick another or leave out --port`);
  }
  const proto = flags.tcp ? 'tcp' : 'udp';
  const server = pick(await clusters(), country, city);
  const ovpnPath = join(STATE, 'sessions', `${name}.ovpn`);
  saveFile(ovpnPath, await sessionConfig(server, proto));
  let port = flags.port ? Number(flags.port) : await freePort(taken);
  if (!flags.json) {
    console.error(`starting "${name}": ${server.location}, ${server.country} (${server.connectionName}, `
      + `${proto}, load ${server.load ?? '?'}%) on 127.0.0.1:${port}...`);
  }
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await runContainer({ container: PREFIX + name, name, server, proto, port, ovpnPath });
    if (res.status !== 'docker' || !/port is already allocated|address already in use/.test(res.error)
      || flags.port) break;
    docker(['rm', '-f', PREFIX + name], { allowFail: true });
    taken.add(port);
    port = await freePort(taken);
  }
  if (res.status !== 'healthy') {
    const log = res.status === 'docker' ? res.error : logTail(PREFIX + name);
    removeSession(name);
    if (res.status === 'auth') {
      fail('Surfshark rejected the login: the user regenerates the service credentials at '
        + 'my.surfshark.com (VPN > Manual setup) and runs "surfshark-proxy setup" again');
    }
    if (/Conflict/.test(log)) fail(`session "${name}" was just created by someone else; pass --name`);
    fail(`tunnel did not come up (${res.status}); try --tcp or another city.\n${log}`);
  }
  let me = null;
  for (let i = 0; i < 5 && !me?.secured; i++) { me = await probe(port); if (!me?.secured) await sleep(2000); }
  const out = {
    name, proxy: `http://127.0.0.1:${port}`, port, server: server.connectionName, proto,
    country: server.country, city: server.location,
    exit_ip: me?.ip ?? null, exit_city: me?.city ?? null, exit_country: me?.country ?? null, secured: !!me?.secured,
  };
  if (flags.json) return console.log(JSON.stringify(out, null, 2));
  console.log(`${out.proxy}  ${name}  exit ${out.exit_ip ?? 'unknown'} (${out.exit_city ?? '?'}, ${out.exit_country ?? '?'})`
    + (out.secured ? '' : '  WARNING: exit not confirmed as Surfshark yet, check "surfshark-proxy status"'));
}

function down() {
  requireDocker();
  const all = sessions();
  const names = flags.all ? all.map((s) => s.name) : pos.slice(1);
  if (!names.length) fail(flags.all ? 'no sessions running' : `missing NAME or --all\n\n${USAGE}`);
  let missing = 0;
  for (const n of names) {
    if (!all.some((s) => s.name === n)) { console.error(`surfshark-proxy: no session "${n}"`); missing++; continue; }
    removeSession(n);
    console.log(`stopped ${n}`);
  }
  if (missing) process.exit(3);
}

async function status() {
  requireDocker();
  let list = sessions();
  if (pos[1]) {
    list = list.filter((s) => s.name === pos[1]);
    if (!list.length) fail(`no session "${pos[1]}"`, 3);
  }
  await Promise.all(list.map(async (s) => {
    const me = s.state === 'running' ? await probe(s.port) : null;
    Object.assign(s, { exit_ip: me?.ip ?? null, exit_city: me?.city ?? null, secured: !!me?.secured });
  }));
  if (flags.json) return console.log(JSON.stringify(list, null, 2));
  if (!list.length) {
    console.log(existsSync(USER_FILE) ? 'no sessions (start one: surfshark-proxy up COUNTRY [CITY])'
      : 'not set up: the user runs "surfshark-proxy setup" in their own terminal');
    return;
  }
  const rows = list.map((s) => [s.name, s.proxy, `${s.city}, ${s.country}`, s.server, s.proto,
    s.state === 'running' ? s.health : s.state,
    s.exit_ip ? `${s.exit_ip} (${s.exit_city})${s.secured ? '' : ' UNSECURED'}` : 'no answer']);
  rows.unshift(['NAME', 'PROXY', 'LOCATION', 'SERVER', 'PROTO', 'HEALTH', 'EXIT']);
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  for (const r of rows) console.log(r.map((c, i) => c.padEnd(w[i])).join('  ').trimEnd());
}

function exec() {
  requireDocker();
  const name = pos[1];
  if (!name || !tail.length) fail(`usage: surfshark-proxy exec NAME [--image img] -- CMD [ARGS...]`);
  if (!sessions().some((s) => s.name === name && s.state === 'running')) fail(`no running session "${name}"`);
  const args = ['run', '--rm', '-i', ...(process.stdout.isTTY && process.stdin.isTTY ? ['-t'] : []),
    '--network', `container:${PREFIX}${name}`, '-v', `${process.cwd()}:/work`, '-w', '/work',
    flags.image || 'alpine:latest', ...tail];
  const child = spawn('docker', args, { stdio: 'inherit' });
  child.on('exit', (code, sig) => process.exit(sig ? 128 : code ?? 1));
}

function logs() {
  requireDocker();
  if (!pos[1]) fail('usage: surfshark-proxy logs NAME [--follow]');
  const child = spawn('docker', ['logs', '--tail', '100', ...(flags.follow ? ['--follow'] : []), PREFIX + pos[1]],
    { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 1));
}

async function list() {
  const want = norm(pos[1]);
  const by = new Map();
  const servers = await clusters();
  const exact = servers.some((s) => norm(s.countryCode) === want);
  for (const s of servers) {
    if (want && (exact ? norm(s.countryCode) !== want : !norm(s.country).includes(want))) continue;
    const k = `${s.countryCode.toLowerCase()}\t${s.country}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push({ city: s.location, load: s.load, server: s.connectionName });
  }
  if (!by.size) fail(`no country matches "${pos[1]}"`);
  const keys = [...by.keys()].sort((a, b) => a.split('\t')[1].localeCompare(b.split('\t')[1]));
  if (flags.json) {
    return console.log(JSON.stringify(keys.map((k) => {
      const [code, country] = k.split('\t');
      return { code, country, cities: by.get(k) };
    }), null, 2));
  }
  for (const k of keys) {
    const [code, country] = k.split('\t');
    const cities = by.get(k).sort((a, b) => a.city.localeCompare(b.city)).map((c) => `${c.city} (${c.load ?? '?'}%)`);
    console.log(`${code.padEnd(3)} ${country}: ${cities.join(', ')}`);
  }
}

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

async function testLogin() {
  const servers = await clusters();
  let me = null;
  try { me = JSON.parse(await fetchBuf(API_ME, 8e3)); } catch {}
  const local = servers.filter((s) => norm(s.countryCode) === norm(me?.countryCode));
  const server = (local.length ? local : servers).reduce((a, b) => ((b.load ?? 100) < (a.load ?? 100) ? b : a));
  const name = 'setup-check';
  removeSession(name);
  const ovpnPath = join(STATE, 'sessions', `${name}.ovpn`);
  saveFile(ovpnPath, await sessionConfig(server, 'udp'));
  const port = await freePort(new Set(sessions().map((s) => s.port)));
  console.log(`testing the login on ${server.location}, ${server.country}...`);
  const res = await runContainer({ container: PREFIX + name, name, server, proto: 'udp', port, ovpnPath });
  const log = res.status === 'docker' ? res.error : logTail(PREFIX + name);
  const exit = res.status === 'healthy' ? await probe(port) : null;
  removeSession(name);
  return { ...res, log, exit };
}

function link() {
  const name = flags['link-as'] || 'surfshark-proxy';
  const bin = join(homedir(), '.local', 'bin');
  const target = join(bin, name);
  const self = realpathSync(fileURLToPath(import.meta.url));
  const other = (process.env.PATH || '').split(delimiter).map((d) => join(d, name))
    .find((p) => p !== target && existsSync(p) && realpathSync(p) !== self);
  if (other) {
    console.error(`surfshark-proxy: not linking: ${other} already exists and ${target} would hide it; `
      + 'rerun setup with --link-as NAME (e.g. --link-as ssproxy)');
    return;
  }
  mkdirSync(bin, { recursive: true });
  try { if (lstatSync(target)) unlinkSync(target); } catch {}
  symlinkSync(self, target);
  chmodSync(self, 0o755);
  const onPath = (process.env.PATH || '').split(delimiter).map((p) => resolve(p)).includes(bin);
  console.log(`linked ${target} -> ${self}` + (onPath ? '' : `\n${bin} is not on PATH; add it to use "surfshark-proxy" directly`));
}

async function setup() {
  requireDocker();
  if (flags.check) {
    requireSetup();
  } else {
    let user;
    let pass;
    if (flags['from-file']) {
      const src = flags['from-file'] === '-' ? readFileSync(0, 'utf8') : readFileSync(flags['from-file'], 'utf8');
      [user, pass] = src.split(/\r?\n/).map((s) => s.trim());
      if (!user || !pass) fail(`${flags['from-file']} needs two lines: username, then password`);
    } else {
      if (!process.stdin.isTTY) fail('no TTY to prompt on: pass --from-file FILE (two lines: username, password)');
      console.log('Surfshark OpenVPN service credentials, from my.surfshark.com > VPN > Manual setup >\n'
        + 'Router or other device > Credentials. These are not your Surfshark account login.');
      user = await ask('Service username: ', true);
      pass = await ask('Service password: ', true);
      if (!user || !pass) fail('both values are required');
    }
    saveFile(USER_FILE, `${user}\n`);
    saveFile(PASS_FILE, `${pass}\n`);
    if (!existsSync(CONFIG_FILE)) saveFile(CONFIG_FILE, `${JSON.stringify(DEFAULTS, null, 2)}\n`, 0o644);
    const img = config().image;
    console.log(`pulling ${img}...`);
    docker(['pull', '-q', img]);
  }
  const res = await testLogin();
  if (res.status === 'auth') {
    if (!flags.check) { rmSync(USER_FILE, { force: true }); rmSync(PASS_FILE, { force: true }); }
    fail('Surfshark rejected these credentials' + (flags.check ? '' : ' (not saved)')
      + '. Copy them again from my.surfshark.com > VPN > Manual setup.');
  }
  if (res.status !== 'healthy') fail(`the test tunnel did not come up (${res.status}):\n${res.log}`);
  console.log(`login ok: exit ${res.exit?.ip ?? 'unknown'} (${res.exit?.city ?? '?'}, ${res.exit?.country ?? '?'})`
    + (flags.check ? '' : `; credentials saved in ${HOME} (mode 600)`));
  if (flags.link || flags['link-as']) link();
  else if (!flags.check && process.stdin.isTTY && !flags['from-file']) {
    const a = await ask(`Link "${flags['link-as'] || 'surfshark-proxy'}" into ~/.local/bin? [Y/n] `);
    if (!/^n/i.test(a)) link();
  }
}

const commands = { setup, list, up, down, status, exec, logs };
if (!pos.length || flags.help || !commands[pos[0]]) {
  console.log(USAGE);
  process.exit(pos.length && !flags.help ? 1 : 0);
}
await commands[pos[0]]();
