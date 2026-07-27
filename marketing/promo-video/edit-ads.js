// MONTAGE de la pub a partir des clips d'interaction REELLE.
//
// promo-record.js filme le produit en fonctionnement (curseur, clics,
// navigation). Ici on coupe, on accelere, on ajoute la couche graphique aux
// couleurs Pinlane et la bande-son.
//
// Le rythme est copie de la video de reference fournie par Movsar : des
// RAFALES de mouvement (plusieurs changements en moins d'une seconde) separees
// de plans un peu plus longs, jamais de plan mou.
//
// Usage : node marketing/promo-video/edit-ads.js

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const CLIPS = path.join(ROOT, 'artifacts/promo-clips');
const OUT = path.join(ROOT, 'artifacts/promo-video');
const W = 2560, H = 1440, FPS = 30;

const ff = (args, label) => {
  try {
    execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    console.error(`echec ${label}:`, String(e.stderr || e.message).slice(0, 400));
    throw e;
  }
};

// SEGMENTS : [clip, debut, duree, vitesse, libelle]
// La vitesse > 1 supprime les temps morts de la session enregistree sans
// couper l'action : on garde le geste, on enleve l'attente.
const SEGMENTS = [
  ['staff.webm',  0.9, 2.5, 1.20, 'planning'],
  ['client.webm', 0.8, 2.6, 1.15, 'reserver'],
  ['staff.webm',  4.4, 2.2, 1.20, 'reservations'],
  ['staff.webm',  6.5, 2.0, 1.20, 'clients'],
  ['staff.webm',  8.5, 2.0, 1.20, 'emails'],
  ['staff.webm', 10.5, 2.2, 1.15, 'marketing'],
  ['staff.webm', 12.7, 2.2, 1.10, 'ouvrir une resa'],
];

fs.mkdirSync(OUT, { recursive: true });
const tmp = path.join(OUT, 'edit-tmp');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

console.log('1. decoupe et acceleration des segments');
const parts = [];
SEGMENTS.forEach(([clip, start, dur, speed, label], i) => {
  const src = path.join(CLIPS, clip);
  if (!fs.existsSync(src)) { console.log(`   (manque ${clip})`); return; }
  const dst = path.join(tmp, `p${String(i).padStart(2, '0')}.mp4`);
  // zoompan donne un leger travelling avant sur chaque plan : c'est ce qui
  // empeche un enregistrement d'ecran de paraitre statique.
  ff([
    '-ss', String(start), '-t', String(dur), '-i', src,
    '-vf', [
      `setpts=${(1 / speed).toFixed(4)}*PTS`,
      `fps=${FPS}`,
      `scale=${Math.round(W * 1.08)}:-2`,
      `zoompan=z='min(zoom+0.0012,1.09)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS}`,
      'setsar=1',
    ].join(','),
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', dst,
  ], label);
  const d = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', dst]).toString().trim());
  console.log(`   ${label.padEnd(18)} ${d.toFixed(2)}s`);
  parts.push(dst);
});

if (!parts.length) { console.error('aucun segment produit'); process.exit(1); }

console.log('2. assemblage');
const listFile = path.join(tmp, 'list.txt');
fs.writeFileSync(listFile, parts.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
const joined = path.join(tmp, 'joined.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', joined], 'concat');

const total = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', joined]).toString().trim());
console.log(`   montage brut : ${total.toFixed(2)}s`);

console.log('3. couche graphique Pinlane + bande-son');
const overlay = path.join(OUT, 'overlay-ads.mov');   // rendu par overlay.html
const audio = path.join(OUT, 'mix-ads2.wav');
const master = path.join(OUT, 'pinlane-live-1080p.mp4');

const hasOverlay = fs.existsSync(overlay);
const inputs = ['-i', joined];
if (hasOverlay) inputs.push('-i', overlay);
if (fs.existsSync(audio)) inputs.push('-i', audio);

const vf = hasOverlay
  ? `[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v]`
  : `[0:v]format=yuv420p[v]`;
const maps = ['-map', '[v]'];
if (fs.existsSync(audio)) maps.push('-map', `${hasOverlay ? 2 : 1}:a:0`, '-c:a', 'aac', '-b:a', '192k', '-shortest');

ff([...inputs, '-filter_complex', vf, ...maps,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-movflags', '+faststart', master], 'master');

const size = (fs.statSync(master).size / 1048576).toFixed(1);
const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', master]).toString().trim());
console.log(`\nMASTER : ${path.relative(ROOT, master)}  ${dur.toFixed(2)}s  ${size} Mo  ${W}x${H}`);
console.log(`  overlay ${hasOverlay ? 'applique' : 'ABSENT (rendre overlay.html d abord)'}`);

// Version legere pour l'envoi.
const web = path.join(OUT, 'pinlane-live-web.mp4');
ff(['-i', master, '-c:v', 'libx264', '-preset', 'slow', '-crf', '26',
  '-maxrate', '1600k', '-bufsize', '3200k', '-vf', 'scale=1600:900:flags=lanczos',
  '-c:a', 'aac', '-b:a', '128k', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', web], 'web');
console.log(`WEB    : ${path.relative(ROOT, web)}  ${(fs.statSync(web).size / 1048576).toFixed(1)} Mo`);

fs.rmSync(tmp, { recursive: true, force: true });
