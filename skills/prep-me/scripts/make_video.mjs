#!/usr/bin/env node
// Usage: make_video.mjs <video.json> [--voice <name>] [--keep]
// Needs ffmpeg and ffprobe, a Chrome-family browser, and a speech tool (piper with a voice model, macOS `say`, or `espeak-ng`).
// Exit codes: 0 made, 1 failed, 2 bad usage, 3 a required tool is missing.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const WIDTH = 1920;
export const HEIGHT = 1080;
const MIN_SECONDS = 30;
const MAX_SECONDS = 150;
const STEP_PAD = 0.35;
const CROSSFADE = 0.4;

export function validateVideo(video) {
  const errors = [];
  if (!video || typeof video !== 'object') return ['video.json must hold an object'];
  if (!Array.isArray(video.scenes) || !video.scenes.length) errors.push('scenes must be a non-empty list');
  (video.scenes || []).forEach((s, i) => {
    const has = Number(Boolean(s.image)) + Number(Boolean(s.html));
    if (has !== 1) errors.push(`scene ${i + 1}: use exactly one of image or html`);
    if (s.steps && (!Array.isArray(s.steps) || !s.steps.length)) errors.push(`scene ${i + 1}: steps must be a non-empty list`);
    if (s.steps) {
      if (s.narration) errors.push(`scene ${i + 1}: use narration or steps, not both`);
      s.steps.forEach((step, k) => {
        if (!String(step.narration || '').trim()) errors.push(`scene ${i + 1} step ${k + 1}: narration is empty`);
      });
    } else if (!String(s.narration || '').trim()) errors.push(`scene ${i + 1}: narration is empty`);
    if (s.image && !['.svg', '.png', '.jpg', '.jpeg'].includes(extname(s.image).toLowerCase())) errors.push(`scene ${i + 1}: image must be svg, png or jpeg`);
  });
  return errors;
}

export function expandScenes(video) {
  return (video.scenes || []).flatMap((scene) => (scene.steps
    ? scene.steps.map((s, k) => ({ scene, step: k + 1, narration: s.narration }))
    : [{ scene, step: null, narration: scene.narration }]));
}

export function spoken(text, pronounce = {}) {
  let out = text;
  for (const [word, say] of Object.entries(pronounce)) {
    const safe = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(^|[^\\w])${safe}(?![\\w])`, 'g'), `$1${say}`);
  }
  return out;
}

// Time the caption lines across the clip by word count. The speech tools give no word timings.
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

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function stepCss(step) {
  if (!step) return '';
  const shown = Array.from({ length: step }, (_, i) => `[data-step="${i + 1}"]`).join(',');
  return `[data-step]{opacity:0}${shown}{opacity:1}`;
}

export function scenePage(scene, baseDir, step = null, read = readFileSync) {
  const style = `html,body{margin:0;width:${WIDTH}px;height:${HEIGHT}px;background:#f8fafc;overflow:hidden}
body{display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a;text-align:center}
img{width:${WIDTH - 80}px;height:${HEIGHT - 80}px;object-fit:contain}
svg{width:${WIDTH}px;height:${HEIGHT}px;display:block}
main{padding:80px 140px}h1{font-size:92px;line-height:1.1;margin:0 0 36px}h2{font-size:64px;margin:0 0 28px}p,li{font-size:50px;line-height:1.35;margin:0 0 20px;color:#334155}ul{text-align:left;display:inline-block;padding-left:56px}${stepCss(step)}`;
  let body;
  if (scene.image) {
    const path = isAbsolute(scene.image) ? scene.image : join(baseDir, scene.image);
    body = extname(path).toLowerCase() === '.svg'
      ? String(read(path, 'utf8')).replace(/<\?xml[^>]*\?>/, '').replace(/<svg\b([^>]*?)\swidth="[^"]*"/, '<svg$1')
      : `<img src="${escapeHtml(pathToFileURL(path).href)}" alt="">`;
  } else body = `<main>${scene.html}</main>`;
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

export function findPiperModel(voice = '', env = process.env, list = readdirSync) {
  if (voice.endsWith('.onnx')) return voice;
  if (voice) return null;
  if (env.PREP_ME_PIPER_MODEL) return env.PREP_ME_PIPER_MODEL;
  const dir = join(env.HOME || homedir(), '.local', 'share', 'piper-voices');
  try {
    const model = list(dir).filter((f) => f.endsWith('.onnx')).sort()[0];
    return model ? join(dir, model) : null;
  } catch {
    return null;
  }
}

export function speechTool(onPath = has, model = null) {
  if (model && onPath('piper')) return 'piper';
  if (onPath('say')) return 'say';
  if (onPath('espeak-ng')) return 'espeak-ng';
  return null;
}

function speak(tool, text, out, voice, model) {
  if (tool === 'piper') run('piper', ['--model', model, '--output_file', out], { input: text });
  else if (tool === 'say') run('say', [...(voice ? ['-v', voice] : []), '-o', out, text]);
  else run('espeak-ng', [...(voice ? ['-v', voice] : []), '-w', out, text]);
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

  const voice = o.voice || video.voice || '';
  const model = findPiperModel(voice);
  const browser = findBrowser();
  const tool = speechTool(has, model);
  const missing = [!has('ffmpeg') && 'ffmpeg', !has('ffprobe') && 'ffprobe', !browser && 'a Chrome-family browser', !tool && 'a speech tool (piper, say or espeak-ng)'].filter(Boolean);
  if (missing.length) { console.error(`missing: ${missing.join(', ')}`); process.exit(3); }
  if (tool !== 'piper') console.log('warn no neural voice found, so this uses a system voice. See references/visuals.md.');

  const work = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'prep-video-'));
  const output = join(baseDir, video.output || 'explainer.mp4');
  mkdirSync(dirname(output), { recursive: true });
  try {
    const clips = [];
    let prev = null;
    expandScenes(video).forEach((entry, i) => {
      const id = String(i + 1).padStart(2, '0');
      const page = join(work, `s${id}.html`);
      const png = join(work, `s${id}.png`);
      writeFileSync(page, scenePage(entry.scene, baseDir, entry.step));
      renderPage(browser, page, png, join(work, 'profile'));
      const audio = join(work, `s${id}.${tool === 'say' ? 'aiff' : 'wav'}`);
      speak(tool, spoken(entry.narration, video.pronounce), audio, voice, model);
      const speech = duration(audio);
      const seconds = speech + STEP_PAD;
      const clip = join(work, `s${id}.mp4`);
      const d = seconds.toFixed(3);
      const fit = `scale=${WIDTH}:${HEIGHT},setsar=1,fps=30`;
      run('ffmpeg', ['-y', '-v', 'error', '-loop', '1', '-framerate', '30', '-t', d, '-i', prev || png, '-loop', '1', '-framerate', '30', '-t', d, '-i', png, '-i', audio,
        '-filter_complex', `[0:v]${fit}[a];[1:v]${fit}[b];[a][b]xfade=transition=fade:duration=${CROSSFADE}:offset=0,format=yuv420p[v]`,
        '-map', '[v]', '-map', '2:a', '-af', `apad=whole_dur=${d}`, '-t', d,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-tune', 'stillimage',
        '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '160k', clip]);
      clips.push({ narration: entry.narration, speech, seconds, clip, png });
      prev = png;
      console.log(`clip ${i + 1}: ${seconds.toFixed(1)} s`);
    });

    const list = join(work, 'list.txt');
    writeFileSync(list, clips.map((s) => `file '${s.clip}'`).join('\n'));
    const joined = join(work, 'joined.mp4');
    run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);

    const srtPath = output.replace(/\.[^.]+$/, '.srt');
    writeFileSync(srtPath, buildSrt(clips));
    const metadata = video.title ? ['-metadata', `title=${video.title}`] : [];
    run('ffmpeg', ['-y', '-v', 'error', '-i', joined, '-i', srtPath, '-map', '0', '-map', '1', '-c', 'copy', '-c:s', 'mov_text',
      '-metadata:s:s:0', 'language=eng', ...metadata, '-movflags', '+faststart', output]);

    const contact = output.replace(/\.[^.]+$/, '-contact.png');
    const rows = Math.ceil(clips.length / 3);
    const inputs = clips.flatMap((s) => ['-i', s.png]);
    const scaled = clips.map((_, i) => `[${i}:v]scale=640:360,setsar=1[v${i}]`).join(';');
    const padded = [...clips.map((_, i) => `[v${i}]`)];
    const blanks = rows * 3 - clips.length;
    let graph = scaled;
    for (let b = 0; b < blanks; b += 1) { graph += `;color=white:s=640x360:d=1[b${b}]`; padded.push(`[b${b}]`); }
    const layout = Array.from({ length: rows * 3 }, (_, i) => `${(i % 3) * 640}_${Math.floor(i / 3) * 360}`).join('|');
    graph += `;${padded.join('')}xstack=inputs=${rows * 3}:layout=${layout}[out]`;
    run('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', graph, '-map', '[out]', '-frames:v', '1', contact]);

    const total = duration(output);
    const words = clips.reduce((sum, s) => sum + s.narration.split(/\s+/).length, 0);
    const streams = run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', output]).trim().split('\n').map((s) => s.replace(/,+$/, ''));
    for (const need of ['video', 'audio']) {
      if (!streams.includes(need)) throw new Error(`the output has no ${need} stream`);
    }
    if (total < MIN_SECONDS || total > MAX_SECONDS) console.log(`warn ${total.toFixed(0)} s is outside the ${MIN_SECONDS} to ${MAX_SECONDS} s range; edit the narration`);
    console.log(JSON.stringify({ output, captions: srtPath, contact, seconds: Number(total.toFixed(1)), clips: clips.length, words, voice: tool === 'piper' ? model : voice || `${tool} default` }));
  } catch (e) {
    console.error(`error ${e.message}`);
    process.exitCode = 1;
  } finally {
    if (o.keep) console.log(`kept work folder: ${work}`);
    else rmSync(work, { recursive: true, force: true });
  }
}

// Compare real paths: the skill is usually installed through a symlink, and argv[1] keeps the link's path.
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) main();
