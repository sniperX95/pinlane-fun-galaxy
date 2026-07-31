// L'AMBIANCE DU CENTRE DE LOISIRS, GENEREE ET NORMALISEE.
//
// « Le son ambiancant derriere doit etre mieux, il est pas fou celui-la. »
// Deux defauts distincts sur la version precedente :
//
//   1. LE BRIEF DECRIVAIT UNE LISTE D'EVENEMENTS (« brouhaha, une quille »)
//      sans dire dans quel ESPACE on est. Une ambiance, c'est d'abord une piece :
//      son volume, ses materiaux, sa distance. Sans ca le modele rend des
//      bruitages colles bout a bout au lieu d'un lieu.
//
//   2. LE FICHIER SORTAIT A -47 dB et il fallait le jouer a x4. `volume` est un
//      coefficient, pas un niveau cible : multiplier par 4 multiplie AUSSI le
//      souffle et les artefacts d'encodage. On normalise donc le fichier a un
//      niveau utilisable, une bonne fois, et la table de bruitages redevient
//      lisible (un `volume` proche de 1 veut dire « tel quel »).
//
// Usage : node scripts/promo-ambiance.js

const fs = require('fs');
const https = require('https');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SORTIE = path.join(ROOT, 'marketing/promo-video/shotcraft/public/audio/ambiance-centre.mp3');
const BRUT = path.join(ROOT, 'artifacts/promo-video/voix-shotcraft/ambiance-brute.mp3');

// Le niveau auquel on veut que le fichier SORTE, pour qu'il se joue autour de 1.
const CIBLE = -26;
const DUREE = 12;

// 450 caracteres maximum a l'API : le brief doit tenir, donc chaque mot compte.
// On garde l'ESPACE (c'est lui qui manquait), un seul evenement, et les
// exclusions — le reste est du confort de redaction.
const PROMPT = 'Ambiance continue d un grand bowling, enregistree derriere le comptoir.'
  + ' Grande salle au plafond haut, longue reverberation naturelle. Brouhaha de'
  + ' conversations lointaines et etouffees, aucune voix comprehensible.'
  + ' Ronronnement grave et continu des machines au fond. Une seule chute de quilles'
  + ' tres au loin. Pas de musique, pas d arcade, aucune voix au premier plan, aucun'
  + ' effet electronique. Fond de scene discret sous une narration parlee.';

const cle = (() => {
  const c = require('C:/Users/movsa/.claude.json');
  return c.projects['C:/Users/movsa/brainOS'].mcpServers.elevenlabs.env.ELEVENLABS_API_KEY;
})();

const generer = () => new Promise((resolve, reject) => {
  const corps = JSON.stringify({
    text: PROMPT,
    duration_seconds: DUREE,
    // Une ambiance doit BOUCLER : le mixage en pose trois passes bout a bout, et
    // une queue qui s'eteint fabriquerait un trou toutes les cinq secondes.
    loop: true,
    prompt_influence: 0.45,
  });
  const req = https.request({
    hostname: 'api.elevenlabs.io',
    path: '/v1/sound-generation?output_format=mp3_44100_128',
    method: 'POST',
    headers: { 'xi-api-key': cle, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corps) },
  }, (res) => {
    const m = [];
    res.on('data', (c) => m.push(c));
    res.on('end', () => {
      const b = Buffer.concat(m);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} : ${b.toString().slice(0, 250)}`));
      resolve(b);
    });
  });
  req.on('error', reject);
  req.write(corps);
  req.end();
});

const mesure = (f) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', f, '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const t = String(r.stderr || '').replace(/\r/g, '');
  return {
    moy: Number((t.match(/mean_volume:\s*(-?[\d.]+)/) || [])[1]),
    max: Number((t.match(/max_volume:\s*(-?[\d.]+)/) || [])[1]),
  };
};

(async () => {
  fs.mkdirSync(path.dirname(BRUT), { recursive: true });
  fs.writeFileSync(BRUT, await generer());
  const avant = mesure(BRUT);
  console.log(`ambiance brute : ${avant.moy} dB (crete ${avant.max})`);

  // Gain CONSTANT calcule depuis la mesure — jamais `loudnorm`, qui applique un
  // gain variable dans le temps et creuserait l'ambiance par endroits.
  const gain = CIBLE - avant.moy;
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', BRUT,
    '-af', `volume=${gain.toFixed(2)}dB,afade=t=in:st=0:d=0.25,afade=t=out:st=${DUREE - 0.25}:d=0.25`,
    '-c:a', 'libmp3lame', '-b:a', '160k', SORTIE]);

  const apres = mesure(SORTIE);
  const d = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', SORTIE], { encoding: 'utf8' }).trim());
  console.log(`ambiance normalisee : ${apres.moy} dB (crete ${apres.max}) · ${d.toFixed(1)}s`);

  if (apres.max > -1) {
    console.error('crete trop haute apres normalisation — le fichier saturera au mixage');
    process.exit(1);
  }
  if (Math.abs(apres.moy - CIBLE) > 1.5) {
    console.error(`la normalisation n'a pas atteint sa cible (${apres.moy} au lieu de ${CIBLE})`);
    process.exit(1);
  }
  console.log(`\nOK : ${path.relative(ROOT, SORTIE)} — se joue desormais autour de volume 1`);
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
