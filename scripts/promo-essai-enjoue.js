// Le meme extrait, memes reglages, avec les deux voix retenues par Movsar : il
// entend l'ENERGIE nouvelle sur les deux timbres et tranche en un mot.
const fs = require('fs');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = 'C:/Users/movsa/Documents/Codex/2026-04-24/doctype-html-html-lang-fr-head';
const D = ROOT + '/artifacts/promo-video/voix-shotcraft';
const cle = require('C:/Users/movsa/.claude.json')
  .projects['C:/Users/movsa/brainOS'].mcpServers.elevenlabs.env.ELEVENLABS_API_KEY;

const REGL = { stability: 0.4, similarity_boost: 0.85, style: 0.45, use_speaker_boost: true, speed: 1.04 };
const VOIX = [
  { n: 'A', id: 'yG4Uc56cLYQyZFnWaYv2', nom: 'Kael' },
  { n: 'B', id: 'jhQTaVBI6hnd0ESpmfIu', nom: 'Jayce' },
];

const T = (nom) => `Version ${nom}.`
  + ` [énergique, souriant, tu interpelles quelqu’un] Tu gères un bowling, un laser game, un centre de loisirs ?`
  + ` [longue pause] [enjoué, tu montres quelque chose dont tu es fier] Ça, c’est une journée complète.`
  + ` Huit pistes, quarante-huit réservations.`
  + ` [longue pause] [ça s’ouvre, enjoué, la solution arrive] Pinlane, c’est le logiciel qui gère tout ça à ta place.`
  + ` [longue pause] [fier, punché, avec le sourire] Zéro saisie. Zéro double réservation. Zéro appel manqué.`;

const parler = (id, texte) => new Promise((res, rej) => {
  const corps = JSON.stringify({ text: texte, model_id: 'eleven_v3', language_code: 'fr', voice_settings: REGL });
  const r = https.request({
    hostname: 'api.elevenlabs.io',
    path: `/v1/text-to-speech/${id}?output_format=mp3_44100_128`,
    method: 'POST',
    headers: { 'xi-api-key': cle, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corps) },
  }, (rp) => {
    const m = [];
    rp.on('data', (c) => m.push(c));
    rp.on('end', () => {
      const b = Buffer.concat(m);
      if (rp.statusCode !== 200) return rej(new Error(`HTTP ${rp.statusCode} ${b.toString().slice(0, 150)}`));
      res(b);
    });
  });
  r.on('error', rej);
  r.write(corps);
  r.end();
});

(async () => {
  const fichiers = [];
  for (const v of VOIX) {
    const f = `${D}/enjoue-${v.n}.mp3`;
    fs.writeFileSync(f, await parler(v.id, T(v.n)));
    const d = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim());
    console.log(`  ${v.n} = ${v.nom.padEnd(7)} ${d.toFixed(1)}s`);
    fichiers.push(f);
  }
  const blanc = `${D}/blanc2.mp3`;
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
    '-t', '1.2', '-c:a', 'libmp3lame', blanc]);
  const liste = `${D}/liste2.txt`;
  fs.writeFileSync(liste, fichiers.map((f) => `file '${f}'\nfile '${blanc}'`).join('\n'));
  const out = `${D}/essai-enjoue.mp3`;
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', liste,
    '-c:a', 'libmp3lame', '-b:a', '160k', out]);
  console.log('\ncomparatif : artifacts/promo-video/voix-shotcraft/essai-enjoue.mp3');
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
