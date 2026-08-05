// COMPARER DES VOIX SUR LA MEME PHRASE, DANS LES MEMES CONDITIONS.
//
// Movsar : « la voix est vraiment pas folle, bowling laser game et tout, les
// intonations c'est mal fait ». Trois iterations de respelling phonetique n'ont
// rien donne : parce que le probleme n'est peut-etre pas l'orthographe mais LA
// VOIX. Son compte n'en contient que deux ; la bibliotheque ElevenLabs en a des
// dizaines de francaises, dont plusieurs taguees « spots commerciaux ».
//
// Ce script genere la MEME phrase avec chaque voix candidate, sans aucune
// correction de prononciation : on veut savoir laquelle dit « bowling » et
// « laser game » correctement TOUTE SEULE. Une voix qui les dit juste sans
// bequille est une meilleure solution qu'une table de respelling.
//
// Contrairement a ce que disait ma note de skill, les voix de la bibliotheque
// partagee s'utilisent DIRECTEMENT par leur identifiant (verifie : HTTP 200).
//
// Usage : node scripts/promo-essai-voix.js

const fs = require('fs');
const https = require('https');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SORTIE = path.join(ROOT, 'artifacts/promo-video/voix-shotcraft/essai-voix');

// La phrase d'essai porte les deux difficultes a la fois : les mots anglais, et
// une intention (le comptoir sous pression) pour juger l'intonation.
const PHRASE = 'Tu gères un bowling, un laser game, un centre de loisirs ?'
  + ' Sauf qu’en vrai, t’es au comptoir. Trois groupes qui attendent,'
  + ' une commande à encaisser, et le téléphone qui sonne.';

const VOIX = [
  { n: 1, id: 'aQROLel5sQbj1vuIVi6B', nom: 'Nicolas Petit (celle du film)' },
  { n: 2, id: 'c365oriviHmAhyLhpuN6', nom: 'Adrien Clairon : spots commerciaux' },
  { n: 3, id: 'DGTOOUoGpoP6UZ9uSWfA', nom: 'Célian : contenu promotionnel' },
  { n: 4, id: 'yG4Uc56cLYQyZFnWaYv2', nom: 'Kael : contenu de marque premium' },
  { n: 5, id: 'jhQTaVBI6hnd0ESpmfIu', nom: 'Jayce : publicité, voix grave' },
];

// `style` a 0,25 et non 0,4 : un style eleve exagere l'interpretation, ce qui
// donne des accents toniques au mauvais endroit : un candidat serieux pour
// « les intonations c'est mal fait ».
const REGLAGES = { stability: 0.5, similarity_boost: 0.85, style: 0.25, use_speaker_boost: true };

const cle = (() => {
  const c = require('C:/Users/movsa/.claude.json');
  return c.projects['C:/Users/movsa/brainOS'].mcpServers.elevenlabs.env.ELEVENLABS_API_KEY;
})();

const parler = (voixId, texte) => new Promise((resolve, reject) => {
  const corps = JSON.stringify({
    text: texte, model_id: 'eleven_v3', language_code: 'fr', voice_settings: REGLAGES,
  });
  const req = https.request({
    hostname: 'api.elevenlabs.io',
    path: `/v1/text-to-speech/${voixId}?output_format=mp3_44100_128`,
    method: 'POST',
    headers: { 'xi-api-key': cle, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corps) },
  }, (res) => {
    const morceaux = [];
    res.on('data', (c) => morceaux.push(c));
    res.on('end', () => {
      const buf = Buffer.concat(morceaux);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} : ${buf.toString().slice(0, 200)}`));
      resolve(buf);
    });
  });
  req.on('error', reject);
  req.write(corps);
  req.end();
});

(async () => {
  fs.mkdirSync(SORTIE, { recursive: true });
  const morceaux = [];
  for (const v of VOIX) {
    // Un index parle avant chaque essai : sinon impossible de dire laquelle on
    // vient d'entendre dans un fichier unique.
    const audio = await parler(v.id, `Voix numéro ${v.n}. ${PHRASE}`);
    const f = path.join(SORTIE, `voix-${v.n}.mp3`);
    fs.writeFileSync(f, audio);
    const d = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim());
    console.log(`  ${v.n}. ${v.nom.padEnd(38)} ${d.toFixed(1)}s`);
    morceaux.push(f);
  }

  // Un seul fichier a ecouter, avec une seconde de blanc entre les essais.
  const liste = path.join(SORTIE, 'liste.txt');
  const blanc = path.join(SORTIE, 'blanc.mp3');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
    '-t', '1.1', '-c:a', 'libmp3lame', blanc]);
  fs.writeFileSync(liste, morceaux.map((f) => `file '${f.replace(/\\/g, '/')}'\nfile '${blanc.replace(/\\/g, '/')}'`).join('\n'));
  const final = path.join(ROOT, 'artifacts/promo-video/voix-shotcraft/essai-voix.mp3');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', liste,
    '-c:a', 'libmp3lame', '-b:a', '160k', final]);
  const D = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', final], { encoding: 'utf8' }).trim());
  console.log(`\ncomparatif : ${path.relative(ROOT, final)} (${D.toFixed(1)}s)`);
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
