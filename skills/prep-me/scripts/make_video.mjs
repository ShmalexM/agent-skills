#!/usr/bin/env node
// Make a narrated explainer from pictures and text: one still and one voice clip per scene, joined with ffmpeg.
// Usage: make_video.mjs <video.json> [--voice <name>] [--keep]
// Needs ffmpeg and ffprobe, a Chrome-family browser for SVG and HTML scenes, and a speech tool (macOS `say`, or `espeak-ng`).
// Exit codes: 0 made, 1 failed, 2 bad usage, 3 a required tool is missing.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const WIDTH = 1920;
export const HEIGHT = 1080;
const MIN_SECONDS = 45;
const MAX_SECONDS = 150;
const SCENE_PAD = 0.5;

export function validateVideo(video) {
  const errors = [];
  if (!video || typeof video !== 'object') return ['video.json must hold an object'];
  if (!Array.isArray(video.scenes) || !video.scenes.length) errors.push('scenes must be a non-empty list');
  (video.scenes || []).forEach((s, i) => {
    const has = Number(Boolean(s.image)) + Number(Boolean(s.html));
    if (has !== 1) errors.push(`scene ${i + 1}: use exactly one of image or html`);
    if (!String(s.narration || '').trim()) errors.push(`scene ${i + 1}: narration is empty`);
    if (s.image && !['.svg', '.png', '.jpg', '.jpeg'].includes(extname(s.image).toLowerCase())) errors.push(`scene ${i + 1}: image must be svg, png or jpeg`);
  });
  return errors;
}

// Time the caption lines across the clip by word count. The speech tool gives no word timings.
export function captionLines(narration, seconds, { maxWords = 12 } = {}) {
  const chunks = [];
  for (const sentence of narration.trim().split(/(?<=[.!?])\s+/)) {
    const words = sentence.split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i += maxWords) chunks.push(words.slice(i, i + maxWords).join(' '));
  }
  const total = chunks.reduce((sum, c) => sum + c.split(/\s+/).length, 0) || 1;
  let at = 0;
  return chunks.map((text) => {
    const span = seconds * (text.split(/\s+/).length / total);
    const line = { start: at, end: at + span, text };
    at += span;
    return line;
  });
}

export function srtTime(seconds) {
  const ms = Math.round(seconds * 1000);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

// Build the caption file from each scene's narration and measured clip length.
export function buildSrt(scenes) {
  const out = [];
  let at = 0;
  let n = 1;
  for (const scene of scenes) {
    for (const line of captionLines(scene.narration, scene.speech)) {
      out.push(`${n}\n${srtTime(at + line.start)} --> ${srtTime(at + line.end)}\n${line.text}\n`);
      n += 1;
    }
    at += scene.seconds;
  }
  return out.join('\n');
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Wrap a scene in one fixed-size page, so that each one renders the same way.
export function scenePage(scene, baseDir) {
  const style = `html,body{margin:0;width:${WIDTH}px;height:${HEIGHT}px;background:#f8fafc;overflow:hidden}
body{display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a;text-align:center}
img{max-width:${WIDTH - 80}px;max-height:${HEIGHT - 80}px;width:${WIDTH - 80}px;height:${HEIGHT - 80}px;object-fit:contain}
main{padding:80px 140px}h1{font-size:92px;line-height:1.1;margin:0 0 36px}h2{font-size:64px;margin:0 0 28px}p,li{font-size:50px;line-height:1.35;margin:0 0 20px;color:#334155}ul{text-align:left;display:inline-block;padding-left:56px}`;
  const body = scene.image
    ? `<img src="${escapeHtml(pathToFileURL(isAbsolute(scene.image) ? scene.image : join(baseDir, scene.image)).href)}" alt="">`
    : `<main>${scene.html}</main>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>${body}</body></html>`;
}

function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26, timeout: 180000, ...options });
  if (r.error || r.status !== 0) {
    const why = r.error?.message || (r.stderr || '').trim().split('\n').slice(-3).join(' ');
    throw new Error(`${cmd} failed: ${why}`);
  }
  return r.stdout;
}

const has = (cmd) => spawnSync('which', [cmd], { encoding: 'utf8' }).status === 0;

export function findBrowser(env = process.env, exists = existsSync, onPath = has) {
  if (env.PREP_ME_BROWSER && exists(env.PREP_ME_BROWSER)) return env.PREP_ME_BROWSER;
  const apps = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
  for (const a of apps) if (exists(a)) return a;
  for (const c of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge']) if (onPath(c)) return c;
  return null;
}

export function speechTool(onPath = has) {
  if (onPath('say')) return 'say';
  if (onPath('espeak-ng')) return 'espeak-ng';
  return null;
}

function speak(tool, text, out, voice) {
  if (tool === 'say') {
    const args = voice ? ['-v', voice] : [];
    run('say', [...args, '-o', out, text]);
  } else {
    run('espeak-ng', [...(voice ? ['-v', voice] : []), '-w', out, text]);
  }
}

function duration(path) {
  return Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path]).trim());
}

function renderPage(browser, pagePath, pngPath, profile) {
  run(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--allow-file-access-from-files',
    `--user-data-dir=${profile}`, `--window-size=${WIDTH},${HEIGHT}`, `--screenshot=${pngPath}`, pathToFileURL(pagePath).href], { timeout: 90000 });
  if (!existsSync(pngPath)) throw new Error(`the browser did not write ${pngPath}`);
}

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--keep') o.keep = true;
    else if (argv[i].startsWith('--')) { o[argv[i].slice(2)] = argv[i + 1]; i += 1; } else o._.push(argv[i]);
  }
  return o;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o._[0]) { console.error('usage: make_video.mjs <video.json> [--voice <name>] [--keep]'); process.exit(2); }
  const specPath = resolve(o._[0]);
  const baseDir = dirname(specPath);
  const video = JSON.parse(readFileSync(specPath, 'utf8'));
  const errors = validateVideo(video);
  for (const s of video.scenes || []) {
    if (s.image && !existsSync(isAbsolute(s.image) ? s.image : join(baseDir, s.image))) errors.push(`image not found: ${s.image}`);
  }
  if (errors.length) { errors.forEach((e) => console.error(`error ${e}`)); process.exit(2); }

  const browser = findBrowser();
  const tool = speechTool();
  const missing = [!has('ffmpeg') && 'ffmpeg', !has('ffprobe') && 'ffprobe', !browser && 'a Chrome-family browser', !tool && 'a speech tool (say or espeak-ng)'].filter(Boolean);
  if (missing.length) { console.error(`missing: ${missing.join(', ')}`); process.exit(3); }

  const work = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'prep-video-'));
  const output = join(baseDir, video.output || 'explainer.mp4');
  mkdirSync(dirname(output), { recursive: true });
  const voice = o.voice || video.voice || '';
  try {
    const scenes = [];
    video.scenes.forEach((scene, i) => {
      const id = String(i + 1).padStart(2, '0');
      const page = join(work, `s${id}.html`);
      const png = join(work, `s${id}.png`);
      writeFileSync(page, scenePage(scene, baseDir));
      renderPage(browser, page, png, join(work, 'profile'));
      const audio = join(work, `s${id}${tool === 'say' ? '.aiff' : '.wav'}`);
      speak(tool, scene.narration, audio, voice);
      const speech = duration(audio);
      const seconds = speech + SCENE_PAD;
      const clip = join(work, `s${id}.mp4`);
      const fadeOut = Math.max(seconds - 0.25, 0);
      run('ffmpeg', ['-y', '-v', 'error', '-loop', '1', '-framerate', '30', '-i', png, '-i', audio,
        '-t', seconds.toFixed(3), '-vf', `scale=${WIDTH}:${HEIGHT},fade=t=in:st=0:d=0.25,fade=t=out:st=${fadeOut.toFixed(3)}:d=0.25,format=yuv420p`,
        '-af', `apad=whole_dur=${seconds.toFixed(3)}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-tune', 'stillimage',
        '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '160k', clip]);
      scenes.push({ narration: scene.narration, speech, seconds, clip, png });
      console.log(`scene ${i + 1}: ${seconds.toFixed(1)} s`);
    });

    const list = join(work, 'list.txt');
    writeFileSync(list, scenes.map((s) => `file '${s.clip}'`).join('\n'));
    const joined = join(work, 'joined.mp4');
    run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);

    const srtPath = output.replace(/\.[^.]+$/, '.srt');
    writeFileSync(srtPath, buildSrt(scenes));
    const metadata = video.title ? ['-metadata', `title=${video.title}`] : [];
    run('ffmpeg', ['-y', '-v', 'error', '-i', joined, '-i', srtPath, '-map', '0', '-map', '1', '-c', 'copy', '-c:s', 'mov_text',
      '-metadata:s:s:0', 'language=eng', ...metadata, '-movflags', '+faststart', output]);

    const contact = output.replace(/\.[^.]+$/, '-contact.png');
    const rows = Math.ceil(scenes.length / 3);
    const inputs = scenes.flatMap((s) => ['-i', s.png]);
    const scaled = scenes.map((_, i) => `[${i}:v]scale=640:360,setsar=1[v${i}]`).join(';');
    const padded = [...scenes.map((_, i) => `[v${i}]`)];
    const blanks = rows * 3 - scenes.length;
    let graph = scaled;
    for (let b = 0; b < blanks; b += 1) { graph += `;color=white:s=640x360:d=1[b${b}]`; padded.push(`[b${b}]`); }
    const layout = Array.from({ length: rows * 3 }, (_, i) => `${(i % 3) * 640}_${Math.floor(i / 3) * 360}`).join('|');
    graph += `;${padded.join('')}xstack=inputs=${rows * 3}:layout=${layout}[out]`;
    if (rows * 3 > 1) run('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', graph, '-map', '[out]', '-frames:v', '1', contact]);

    const total = duration(output);
    const words = scenes.reduce((sum, s) => sum + s.narration.split(/\s+/).length, 0);
    const streams = run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', output]).trim().split('\n').map((s) => s.replace(/,+$/, ''));
    for (const need of ['video', 'audio']) {
      if (!streams.includes(need)) throw new Error(`the output has no ${need} stream`);
    }
    if (total < MIN_SECONDS || total > MAX_SECONDS) console.log(`warn ${total.toFixed(0)} s is outside the ${MIN_SECONDS} to ${MAX_SECONDS} s range; edit the narration`);
    console.log(JSON.stringify({ output, captions: srtPath, contact, seconds: Number(total.toFixed(1)), scenes: scenes.length, words, voice: voice || 'system default' }));
  } catch (e) {
    console.error(`error ${e.message}`);
    process.exitCode = 1;
  } finally {
    if (o.keep) console.log(`kept work folder: ${work}`);
    else rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
