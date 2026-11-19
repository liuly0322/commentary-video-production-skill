#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

const PROFILE_NAME = '_CommentSkillAutoRecord';
const SCENE_NAME = 'AutoRecordScene';
const BROWSER_NAME = 'AutoRecordBrowser';
const WIDTH = 1920;
const HEIGHT = 1080;
const READY_TIMEOUT_MS = 30_000;
const START_ACK_TIMEOUT_MS = 5_000;
const MAX_RECORD_MS = 60 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.ass': 'text/plain; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8'
};

const BRIDGE_JS = `(function(){
const cbs=[];let started=false,done=false;
const post=p=>{try{fetch('/__recorder_event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p),keepalive:true}).catch(()=>{})}catch{}};
const reportErr=e=>post({event:'error',message:e&&e.message?e.message:String(e),stack:e&&e.stack?e.stack:''});
window.addEventListener('obsStartCapture',()=>{
  if(started)return;started=true;
  if(cbs.length===0){reportErr('No window.__RECORDER__.onStart() handler registered before capture start');return}
  post({event:'started',at:performance.now()});
  for(const fn of cbs.splice(0)){try{fn()}catch(e){reportErr(e)}}
});
window.addEventListener('error',e=>post({event:'error',message:e.message||'Script error',stack:(e.error&&e.error.stack)||((e.filename||'')+':'+e.lineno+':'+e.colno)}));
window.addEventListener('unhandledrejection',e=>reportErr(e.reason));
window.__RECORDER__={
  ready(meta){post({event:'ready',meta:meta??null})},
  onStart(fn){if(typeof fn!=='function')return;if(started){try{fn()}catch(e){reportErr(e)}}else{cbs.push(fn)}},
  done(meta){if(done)return;done=true;post({event:'done',at:performance.now(),meta:meta??null})},
  error(err){reportErr(err)}
};
})();`;

const log = (...args) => console.error('[record-obs]', ...args);
const pause = ms => new Promise(r => setTimeout(r, ms));

function usage(exitCode = 0) {
  console.error(`Usage: node record-obs.mjs <index.html> [-o <out.mkv>] [--fps <25>] [--query "<k=v&...>"]

Options:
  -o, --out <path>     Output MKV path (default: <entry dir>/capture.mkv)
  --fps <number>       Recording frame rate (default: 25)
  --query <string>     Extra query string passed to the page (e.g. "from=60&to=90")
  -h, --help           Show this help

Environment overrides (auto-detected by default):
  OBS_EXE              Path to obs64.exe (WSL path)
  OBS_APPDATA          Path to OBS AppData directory (WSL path)
  OBS_ENCODER          Force encoder id (e.g. obs_nvenc_h264_tex or obs_x264)`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  let entry = null;
  let out = null;
  let fps = 25;
  let query = '';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      usage(0);
    } else if (arg === '-o' || arg === '--out') {
      out = argv[++i];
      if (!out) throw new Error('Missing value for -o/--out');
    } else if (arg === '--fps') {
      fps = Number(argv[++i]);
      if (!Number.isFinite(fps) || fps <= 0) throw new Error('Invalid --fps value');
    } else if (arg === '--query') {
      query = (argv[++i] ?? '').replace(/^\?/, '');
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!entry) {
      entry = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!entry) usage(1);
  const entryAbs = path.resolve(entry);
  if (!fs.existsSync(entryAbs) || fs.statSync(entryAbs).isDirectory()) {
    throw new Error(`Entry HTML not found: ${entryAbs}`);
  }
  const outAbs = path.resolve(out || path.join(path.dirname(entryAbs), 'capture.mkv'));
  return { entryAbs, outAbs, fps, query };
}

function wslToWin(p) {
  return execFileSync('wslpath', ['-w', p], { encoding: 'utf8' }).trim();
}

function winToWsl(p) {
  return execFileSync('wslpath', ['-u', p], { encoding: 'utf8' }).trim();
}

function detectObsExe() {
  if (process.env.OBS_EXE && fs.existsSync(process.env.OBS_EXE)) return process.env.OBS_EXE;
  const candidates = [
    '/mnt/c/Program Files/obs-studio/bin/64bit/obs64.exe',
    '/mnt/d/Program Files/obs-studio/bin/64bit/obs64.exe',
    '/mnt/c/Program Files (x86)/obs-studio/bin/64bit/obs64.exe'
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('Could not find obs64.exe. Set OBS_EXE to its WSL path.');
}

function detectObsAppData() {
  if (process.env.OBS_APPDATA && fs.existsSync(process.env.OBS_APPDATA)) return process.env.OBS_APPDATA;
  try {
    const winAppData = execFileSync('cmd.exe', ['/c', 'echo', '%APPDATA%'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim().replace(/\r/g, '');
    if (winAppData && !winAppData.includes('%APPDATA%')) {
      const dir = path.join(winToWsl(winAppData), 'obs-studio');
      if (fs.existsSync(dir)) return dir;
    }
  } catch {}
  try {
    for (const user of fs.readdirSync('/mnt/c/Users')) {
      const dir = path.join('/mnt/c/Users', user, 'AppData/Roaming/obs-studio');
      if (fs.existsSync(dir)) return dir;
    }
  } catch {}
  throw new Error('Could not locate OBS AppData directory. Set OBS_APPDATA to its WSL path.');
}

function detectWindowsHosts() {
  const hosts = ['127.0.0.1'];
  try {
    const out = execFileSync('ip', ['route', 'show', 'default'], { encoding: 'utf8' });
    const m = out.match(/default via ([0-9.]+)/);
    if (m && !hosts.includes(m[1])) hosts.push(m[1]);
  } catch {}
  try {
    const resolv = fs.readFileSync('/etc/resolv.conf', 'utf8');
    const m = resolv.match(/^nameserver\s+([0-9.]+)/m);
    if (m && !hosts.includes(m[1])) hosts.push(m[1]);
  } catch {}
  return hosts;
}

function detectEncoder() {
  if (process.env.OBS_ENCODER) {
    const id = process.env.OBS_ENCODER;
    return {
      id,
      settings: id.includes('nvenc')
        ? { rate_control: 'CQP', cqp: 16, preset: 'p5', tune: 'hq', multipass: 'qres', profile: 'high', lookahead: false, psycho_aq: true, bf: 2, keyint_sec: 1, gpu: 0 }
        : { rate_control: 'CRF', crf: 16, preset: 'veryfast', profile: 'high', keyint_sec: 1 }
    };
  }
  const smiCandidates = ['nvidia-smi', '/usr/lib/wsl/lib/nvidia-smi'];
  for (const bin of smiCandidates) {
    try {
      execFileSync(bin, ['-L'], { stdio: 'ignore' });
      return {
        id: 'obs_nvenc_h264_tex',
        settings: {
          rate_control: 'CQP',
          cqp: 16,
          preset: 'p5',
          tune: 'hq',
          multipass: 'qres',
          profile: 'high',
          lookahead: false,
          psycho_aq: true,
          bf: 2,
          keyint_sec: 1,
          gpu: 0
        }
      };
    } catch {}
  }
  return {
    id: 'obs_x264',
    settings: { rate_control: 'CRF', crf: 16, preset: 'veryfast', profile: 'high', keyint_sec: 1 }
  };
}

function getTempRecordDir(outAbs) {
  if (/^\/mnt\/[a-z]\//i.test(outAbs)) {
    return path.dirname(outAbs);
  }
  try {
    const winTemp = execFileSync('cmd.exe', ['/c', 'echo', '%TEMP%'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim().replace(/\r/g, '');
    if (winTemp && !winTemp.includes('%TEMP%')) {
      return path.join(winToWsl(winTemp), 'obs-autorecord');
    }
  } catch {}
  return path.dirname(outAbs);
}

function injectBridge(html) {
  const tag = `<script>${BRIDGE_JS}</script>`;
  if (/<head(\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, m => `${m}\n${tag}`);
  }
  if (/<html(\s[^>]*)?>/i.test(html)) {
    return html.replace(/<html(\s[^>]*)?>/i, m => `${m}\n${tag}`);
  }
  return `${tag}\n${html}`;
}

function buildFpsIni(fps) {
  if (Number.isInteger(fps)) {
    return `FPSType=1\nFPSCommon=${fps}\nFPSInt=${fps}\nFPSNum=${fps}\nFPSDen=1`;
  }
  const den = 1000;
  const num = Math.round(fps * den);
  return `FPSType=2\nFPSCommon=${Math.round(fps)}\nFPSInt=${Math.round(fps)}\nFPSNum=${num}\nFPSDen=${den}`;
}

async function prepareObsConfig(obsAppData, winRecDir, fps, encoder) {
  const wsConfigPath = path.join(obsAppData, 'plugin_config/obs-websocket/config.json');
  let wsBackup = null;
  let wsConfig = {};

  if (fs.existsSync(wsConfigPath)) {
    const raw = await fsp.readFile(wsConfigPath, 'utf8');
    wsConfig = JSON.parse(raw);
    if (!wsConfig.server_enabled) {
      wsBackup = { path: wsConfigPath, content: raw };
      wsConfig.server_enabled = true;
      wsConfig.server_port = wsConfig.server_port || 4455;
      wsConfig.auth_required = wsConfig.auth_required ?? true;
      wsConfig.server_password = wsConfig.server_password || crypto.randomBytes(16).toString('hex');
      await fsp.writeFile(wsConfigPath, JSON.stringify(wsConfig, null, 2));
    }
  } else {
    await fsp.mkdir(path.dirname(wsConfigPath), { recursive: true });
    wsBackup = { path: wsConfigPath, content: null };
    wsConfig = {
      alerts_enabled: false,
      auth_required: true,
      first_load: false,
      server_enabled: true,
      server_password: crypto.randomBytes(16).toString('hex'),
      server_port: 4455
    };
    await fsp.writeFile(wsConfigPath, JSON.stringify(wsConfig, null, 2));
  }

  const profileDir = path.join(obsAppData, 'basic/profiles', PROFILE_NAME);
  await fsp.mkdir(profileDir, { recursive: true });

  const basicIni = `[General]
Name=${PROFILE_NAME}

[Output]
Mode=Advanced
FilenameFormatting=autorecord-%CCYY-%MM-%DD-%hh-%mm-%ss

[Video]
BaseCX=${WIDTH}
BaseCY=${HEIGHT}
OutputCX=${WIDTH}
OutputCY=${HEIGHT}
${buildFpsIni(fps)}
ScaleType=bicubic
ColorFormat=NV12
ColorSpace=709
ColorRange=Partial

[AdvOut]
ApplyServiceSettings=true
UseRescale=false
TrackIndex=1
RecType=Standard
RecFilePath=${winRecDir.replaceAll('\\', '\\\\')}
RecFormat2=mkv
RecUseRescale=false
RecTracks=1
RecEncoder=${encoder.id}
RecAudioEncoder=ffmpeg_aac
RecRB=false

[Audio]
SampleRate=48000
ChannelSetup=Stereo
`;
  await fsp.writeFile(path.join(profileDir, 'basic.ini'), basicIni);
  await fsp.writeFile(path.join(profileDir, 'recordEncoder.json'), JSON.stringify(encoder.settings, null, 2));

  const sceneUuid = crypto.randomUUID();
  const browserUuid = crypto.randomUUID();
  const sceneCollection = {
    current_scene: SCENE_NAME,
    current_program_scene: SCENE_NAME,
    scene_order: [{ name: SCENE_NAME }],
    name: PROFILE_NAME,
    sources: [
      {
        name: SCENE_NAME,
        uuid: sceneUuid,
        id: 'scene',
        versioned_id: 'scene',
        settings: {
          id_counter: 1,
          items: [
            {
              name: BROWSER_NAME,
              source_uuid: browserUuid,
              visible: true,
              locked: false,
              rot: 0.0,
              align: 5,
              bounds_type: 0,
              bounds_align: 0,
              bounds_crop: false,
              crop_left: 0,
              crop_top: 0,
              crop_right: 0,
              crop_bottom: 0,
              id: 1,
              group_item_backup: false,
              pos: { x: 0.0, y: 0.0 },
              scale: { x: 1.0, y: 1.0 },
              bounds: { x: 0.0, y: 0.0 },
              scale_filter: 'disable',
              blend_method: 'default',
              blend_type: 'normal',
              show_transition: { duration: 0 },
              hide_transition: { duration: 0 },
              private_settings: {}
            }
          ],
          custom_size: false
        },
        mixers: 0,
        sync: 0,
        flags: 0,
        volume: 1.0,
        balance: 0.5,
        enabled: true,
        muted: false,
        deinterlace_mode: 0,
        deinterlace_field_order: 0,
        monitoring_type: 0,
        private_settings: {}
      },
      {
        name: BROWSER_NAME,
        uuid: browserUuid,
        id: 'browser_source',
        versioned_id: 'browser_source',
        settings: {
          url: 'about:blank',
          width: WIDTH,
          height: HEIGHT,
          fps: Math.round(fps),
          fps_custom: true,
          shutdown: false,
          restart_when_active: false,
          webpage_control_level: 1,
          css: 'html,body { margin:0; overflow:hidden; }',
          reroute_audio: false
        },
        mixers: 255,
        sync: 0,
        flags: 0,
        volume: 1.0,
        balance: 0.5,
        enabled: true,
        muted: true,
        deinterlace_mode: 0,
        deinterlace_field_order: 0,
        monitoring_type: 0,
        private_settings: {}
      }
    ],
    groups: [],
    quick_transitions: [],
    transitions: [],
    saved_projectors: [],
    resolution: { x: WIDTH, y: HEIGHT },
    version: 1
  };
  await fsp.mkdir(path.join(obsAppData, 'basic/scenes'), { recursive: true });
  await fsp.writeFile(
    path.join(obsAppData, 'basic/scenes', `${PROFILE_NAME}.json`),
    JSON.stringify(sceneCollection, null, 2)
  );

  return {
    wsPort: wsConfig.server_port || 4455,
    wsPassword: wsConfig.auth_required === false ? '' : (wsConfig.server_password || ''),
    wsBackup
  };
}

async function tryConnectOne(host, port, password) {
  const socket = new WebSocket(`ws://${host}:${port}`);
  const pending = new Map();
  let reqCounter = 0;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { socket.close(); } catch {}
      reject(new Error('timeout'));
    }, 2000);
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('ws error'));
    }, { once: true });
    socket.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      const d = msg.d;
      if (msg.op === 0) {
        const identify = { rpcVersion: 1, eventSubscriptions: 0 };
        if (d.authentication) {
          const secret = crypto.createHash('sha256').update(password + d.authentication.salt).digest('base64');
          identify.authentication = crypto.createHash('sha256').update(secret + d.authentication.challenge).digest('base64');
        }
        socket.send(JSON.stringify({ op: 1, d: identify }));
      } else if (msg.op === 2) {
        clearTimeout(timer);
        resolve();
      } else if (msg.op === 7) {
        const c = pending.get(d.requestId);
        if (!c) return;
        pending.delete(d.requestId);
        clearTimeout(c.timer);
        if (d.requestStatus.result) c.resolve(d.responseData ?? {});
        else c.reject(new Error(`${d.requestType}: ${JSON.stringify(d.requestStatus)}`));
      }
    });
  });

  return {
    host,
    close: () => { try { socket.close(); } catch {} },
    call(type, data = {}) {
      return new Promise((resolve, reject) => {
        const id = String(++reqCounter);
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${type} timeout`));
        }, 15_000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ op: 6, d: { requestType: type, requestId: id, requestData: data } }));
      });
    }
  };
}

async function connectOBS(hosts, port, password, maxAttempts) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    for (const host of hosts) {
      try {
        return await tryConnectOne(host, port, password);
      } catch {}
    }
    if (attempt < maxAttempts) await pause(600);
  }
  throw new Error(`Could not connect to OBS WebSocket on port ${port} (tried: ${hosts.join(', ')})`);
}

async function moveFile(src, dest) {
  if (path.resolve(src) === path.resolve(dest)) return;
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fsp.rename(src, dest);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fsp.copyFile(src, dest);
    await fsp.unlink(src).catch(() => {});
  }
}

async function main() {
  const { entryAbs, outAbs, fps, query } = parseArgs(process.argv.slice(2));
  const rootDir = path.dirname(entryAbs);
  const entryFile = path.basename(entryAbs);
  const obsExe = detectObsExe();
  const obsAppData = detectObsAppData();
  const hosts = detectWindowsHosts();
  const encoder = detectEncoder();

  const recDir = getTempRecordDir(outAbs);
  await fsp.mkdir(recDir, { recursive: true });
  await fsp.mkdir(path.dirname(outAbs), { recursive: true });
  const winRecDir = wslToWin(recDir);

  let pageState = 'init';
  let pageError = null;
  let startedAtMs = 0;
  let doneAtMs = 0;
  let startedAtPerf = null;
  let doneAtPerf = null;

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === '/__recorder_event' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          if (data.event === 'ready') {
            if (pageState === 'init') pageState = 'ready';
            log('page ready');
          } else if (data.event === 'started') {
            if (pageState !== 'done') pageState = 'started';
            startedAtMs = Date.now();
            if (typeof data.at === 'number') startedAtPerf = data.at;
            log('page started');
          } else if (data.event === 'done') {
            pageState = 'done';
            doneAtMs = Date.now();
            if (typeof data.at === 'number') doneAtPerf = data.at;
            log('page done');
          } else if (data.event === 'error') {
            pageError = new Error(`Page error: ${data.message}${data.stack ? `\n${data.stack}` : ''}`);
            log(pageError.message);
          }
        } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
      return;
    }

    const reqPath = decodeURIComponent(u.pathname === '/' ? `/${entryFile}` : u.pathname);
    const filePath = path.resolve(rootDir, `.${reqPath}`);
    if (filePath !== rootDir && !filePath.startsWith(rootDir + path.sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    if (filePath === entryAbs) {
      const html = injectBridge(await fsp.readFile(filePath, 'utf8'));
      const buf = Buffer.from(html, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': buf.length,
        'Cache-Control': 'no-store'
      });
      res.end(buf);
      return;
    }

    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    const range = req.headers.range;

    if (range) {
      const m = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!m) {
        res.writeHead(416);
        res.end();
        return;
      }
      const start = parseInt(m[1], 10);
      const end = m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': contentType
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Accept-Ranges': 'bytes',
        'Content-Type': contentType
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const httpPort = server.address().port;
  log(`HTTP server on http://127.0.0.1:${httpPort} (root=${rootDir}, encoder=${encoder.id}, fps=${fps})`);

  const { wsPort, wsPassword, wsBackup } = await prepareObsConfig(obsAppData, winRecDir, fps, encoder);

  let obs = null;
  let obsProc = null;
  let prevProfile = null;
  let prevCollection = null;
  let recordingActive = false;

  try {
    try {
      obs = await connectOBS(hosts, wsPort, wsPassword, 1);
      log(`Connected to existing OBS on ${obs.host}:${wsPort}`);
      const prof = await obs.call('GetProfileList');
      const coll = await obs.call('GetSceneCollectionList');
      prevProfile = prof.currentProfileName;
      prevCollection = coll.currentSceneCollectionName;
      if (prevProfile !== PROFILE_NAME) {
        await obs.call('SetCurrentProfile', { profileName: PROFILE_NAME });
        await pause(600);
      }
      if (prevCollection !== PROFILE_NAME) {
        await obs.call('SetCurrentSceneCollection', { sceneCollectionName: PROFILE_NAME });
        await pause(800);
      }
    } catch {
      log('Launching obs64.exe...');
      obsProc = spawn(obsExe, [
        '--collection', PROFILE_NAME,
        '--profile', PROFILE_NAME,
        '--scene', SCENE_NAME,
        '--minimize-to-tray',
        '--disable-updater',
        '--disable-missing-files-check',
        '--disable-shutdown-check'
      ], {
        cwd: path.dirname(obsExe),
        stdio: 'ignore'
      });
      obs = await connectOBS(hosts, wsPort, wsPassword, 25);
      log(`Connected to launched OBS on ${obs.host}:${wsPort}`);
    }

    const qs = [query, `_t=${Date.now()}`].filter(Boolean).join('&');
    const pageUrl = `http://127.0.0.1:${httpPort}/${encodeURIComponent(entryFile)}?${qs}`;

    await obs.call('SetInputSettings', {
      inputName: BROWSER_NAME,
      inputSettings: {
        url: pageUrl,
        width: WIDTH,
        height: HEIGHT,
        fps: Math.round(fps),
        fps_custom: true
      },
      overlay: true
    });

    const readyDeadline = Date.now() + READY_TIMEOUT_MS;
    while (pageState === 'init') {
      if (pageError) throw pageError;
      if (Date.now() > readyDeadline) {
        throw new Error(`Timed out after ${READY_TIMEOUT_MS / 1000}s waiting for window.__RECORDER__.ready()`);
      }
      await pause(100);
    }

    await pause(300);
    const statsBefore = await obs.call('GetStats');
    await obs.call('StartRecord');
    recordingActive = true;

    let status;
    do {
      await pause(50);
      status = await obs.call('GetRecordStatus');
    } while (!status.outputActive);

    await pause(300);
    const preStart = await obs.call('GetRecordStatus');
    const startOffsetSec = (preStart.outputDuration || 300) / 1000;

    await obs.call('CallVendorRequest', {
      vendorName: 'obs-browser',
      requestType: 'emit_event',
      requestData: { event_name: 'obsStartCapture', event_data: {} }
    });
    log(`Recording started, triggered playback at offset=${startOffsetSec.toFixed(3)}s`);

    const startAckDeadline = Date.now() + START_ACK_TIMEOUT_MS;
    while (pageState === 'ready') {
      if (pageError) throw pageError;
      if (Date.now() > startAckDeadline) {
        throw new Error('Page did not acknowledge start. Make sure window.__RECORDER__.onStart(...) is registered.');
      }
      await pause(50);
    }

    let nextLog = Date.now() + 15_000;
    const doneDeadline = Date.now() + MAX_RECORD_MS;
    while (pageState !== 'done') {
      if (pageError) throw pageError;
      if (Date.now() > doneDeadline) {
        throw new Error(`Recording exceeded safety limit (${MAX_RECORD_MS / 1000}s) without window.__RECORDER__.done()`);
      }
      await pause(200);
      if (Date.now() >= nextLog) {
        const st = await obs.call('GetRecordStatus');
        const perf = await obs.call('GetStats');
        log(`rec=${(st.outputDuration / 1000).toFixed(1)}s size=${(st.outputBytes / 1048576).toFixed(1)}MB fps=${perf.activeFps.toFixed(2)} renderSkip=${perf.renderSkippedFrames - statsBefore.renderSkippedFrames} outSkip=${perf.outputSkippedFrames - statsBefore.outputSkippedFrames}`);
        nextLog = Date.now() + 15_000;
      }
    }

    await pause(300);
    const stopRes = await obs.call('StopRecord');
    recordingActive = false;
    const statsAfter = await obs.call('GetStats');

    // Wait briefly for OBS to flush MKV trailer before moving
    await pause(800);
    const rawWslPath = winToWsl(stopRes.outputPath);
    await moveFile(rawWslPath, outAbs);

    const durationMs = (startedAtPerf !== null && doneAtPerf !== null)
      ? Math.max(0, doneAtPerf - startedAtPerf)
      : Math.max(0, doneAtMs - (startedAtMs || doneAtMs));

    const result = {
      video: outAbs,
      startOffsetSec: Number(startOffsetSec.toFixed(3)),
      durationSec: Number((durationMs / 1000).toFixed(3)),
      fps,
      renderSkippedFrames: Math.max(0, (statsAfter.renderSkippedFrames || 0) - (statsBefore.renderSkippedFrames || 0)),
      outputSkippedFrames: Math.max(0, (statsAfter.outputSkippedFrames || 0) - (statsBefore.outputSkippedFrames || 0))
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    if (obs && recordingActive) {
      await obs.call('StopRecord').catch(() => {});
    }
    if (obs && !obsProc) {
      if (prevCollection && prevCollection !== PROFILE_NAME) {
        await obs.call('SetCurrentSceneCollection', { sceneCollectionName: prevCollection }).catch(() => {});
        await pause(400);
      }
      if (prevProfile && prevProfile !== PROFILE_NAME) {
        await obs.call('SetCurrentProfile', { profileName: prevProfile }).catch(() => {});
      }
    }
    if (obs) obs.close();
    if (obsProc) {
      try { execFileSync('taskkill.exe', ['/IM', 'obs64.exe'], { stdio: 'ignore', timeout: 5000 }); } catch {}
      await pause(1200);
      try { execFileSync('taskkill.exe', ['/F', '/IM', 'obs64.exe'], { stdio: 'ignore', timeout: 5000 }); } catch {}
      try { obsProc.kill(); } catch {}
    }
    if (wsBackup) {
      if (wsBackup.content === null) {
        await fsp.unlink(wsBackup.path).catch(() => {});
      } else {
        await fsp.writeFile(wsBackup.path, wsBackup.content).catch(() => {});
      }
    }
    server.close();
  }
}

main().catch(err => {
  console.error(`[record-obs] ERROR: ${err.message}`);
  process.exit(1);
});
