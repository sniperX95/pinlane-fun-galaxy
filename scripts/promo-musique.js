// LA NAPPE SE COMPOSE SUR LA TABLE DE PLANS, ET ELLE SE REGENERE.
//
// Elle etait produite a la main, une fois, et son fichier faisait 60,0 s. Le
// film est passe a 71,9 s : `apad` aurait rempli les douze dernieres secondes de
// silence SANS RIEN SIGNALER, et les fenetres de mesure du mixage, toutes prises
// pendant la parole, ne seraient jamais tombees dans le trou. Exactement le
// piege 26b de mon propre carnet, que j'ai quand meme repris.
//
// Ce script lit `narration.json` : les sections du morceau derivent des vrais
// plans, et sa duree du vrai film. Reecrire le texte deplace la musique avec.
//
// Un morceau uniforme ne sait pas que le film raconte quelque chose (piege 92) :
// l'arc est donc decrit section par section, avec ses minutages, dans le prompt.
//
// Usage : node scripts/promo-musique.js

const fs = require('fs');
const https = require('https');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TABLE = path.join(ROOT, 'marketing/promo-video/shotcraft/src/aifl/narration.json');
const SORTIE = path.join(ROOT, 'artifacts/promo-video/voix-shotcraft/musique-arc.mp3');

// De la marge en fin de morceau : le mixage coupe a la duree du film, et une
// nappe qui s'arrete pile a la derniere image laisse la signature a sec.
const MARGE = 4;

const N = JSON.parse(fs.readFileSync(TABLE, 'utf8'));
const FILM = N.total / N.fps;

// Les six mouvements, exprimes en PLANS. Le minutage se calcule.
// LES MOUVEMENTS DECRIVENT UNE MATIERE, PAS SEULEMENT UNE INTENTION.
//
// « Le son ambiancant derriere doit etre mieux, il est pas fou celui-la. » Le
// brief precedent disait ce que la musique devait FAIRE RESSENTIR (« la tension
// monte ») sans jamais dire de QUOI elle est faite. Un modele generatif comble
// ce vide avec sa moyenne : des nappes generiques. On nomme donc les
// instruments, le traitement et ce qu'on ne veut pas.
const MOUVEMENTS = [
  { plans: ['morning'], intention: 'nappe de synthe analogique chaude et large, une seule note de piano electrique Rhodes toutes les deux mesures avec beaucoup de reverbe, une nappe de bruit tres douce en fond, aucune percussion, aucune basse : l espace est ouvert et on installe le decor' },
  { plans: ['cardA', 'cardB', 'cardC'], intention: 'sub-basse tenue sur une seule note, un pouls sourd de grosse caisse feutree toutes les deux temps, un shaker sec tres bas, la nappe se referme et devient plus sombre, une dissonance legere qui ne se resout pas : aucune melodie, c est le probleme' },
  { plans: ['card1'], intention: 'balayage ascendant de bruit blanc filtre sur deux secondes, un impact grave a l arrivee, puis la grosse caisse entre franchement avec un charleston regulier : la lumiere revient d un coup' },
  { plans: ['table', 'macro', 'card2', 'chart'], intention: 'house sobre et haut de gamme a tempo modere : kick rond regulier, basse pulsee sur la fondamentale, arpege court de synthe pluck tres en arriere, charleston serre, saturation a bande legere sur l ensemble. Ca avance sans rien reclamer, la voix passe par-dessus' },
  { plans: ['cardWbr', 'wbr'], intention: 'les accords s ouvrent sur une quarte large, des cordes de synthe entrent doucement en dessous, la basse descend d une octave, un accord tenu qui respire : sentiment de travail accompli' },
  { plans: ['card3', 'outro'], intention: 'trois impacts espaces qui appuient les trois derniers mots, puis la batterie s efface, et il ne reste qu un accord tenu clair et large avec une longue queue de reverbe : la voix de signature passe seule dessus' },
];

const bornes = (plans) => {
  const p = plans.map((n) => N.plans[n]).filter(Boolean);
  if (p.length !== plans.length) {
    console.error(`plan inconnu dans ${plans.join(', ')} : la table a change`);
    process.exit(1);
  }
  const de = Math.min(...p.map((x) => x.from)) / N.fps;
  const a = Math.max(...p.map((x) => x.from + x.duration)) / N.fps;
  return { de, a };
};

const sections = MOUVEMENTS.map((m) => {
  const { de, a } = bornes(m.plans);
  return `${de.toFixed(0)}s a ${a.toFixed(0)}s : ${m.intention}`;
});

const SAUT = String.fromCharCode(10);

const PROMPT = [
  'Musique instrumentale pour une publicite de logiciel professionnelle,'
    + ' 100 BPM, tonalite mineure, production haut de gamme et moderne.',
  'MATIERE : synthes analogiques chauds, sub-basse ronde, percussions electroniques'
    + ' seches, saturation a bande legere, reverbe large et propre. Melange soigne,'
    + ' rien de criard.',
  'A EVITER ABSOLUMENT : toute voix meme sans paroles, tout solo, toute melodie qui'
    + ' chante au premier plan, les sons de jeu video ou de carillon, les cordes'
    + ' orchestrales cinematographiques, les cuivres, le piano acoustique au premier'
    + ' plan. Le registre median doit rester DEGAGE : une narration parlee passe'
    + ' par-dessus du debut a la fin et la musique ne doit jamais lui disputer la place.',
  'STRUCTURE, minutee a la seconde :',
  ...sections.map((s) => `- ${s}`),
  `Duree totale ${Math.round(FILM + MARGE)} secondes. Les transitions entre sections`
    + ' sont franches et se sentent, elles ne sont pas des fondus mous.',
].join(SAUT);

const cle = (() => {
  const c = require('C:/Users/movsa/.claude.json');
  return c.projects['C:/Users/movsa/brainOS'].mcpServers.elevenlabs.env.ELEVENLABS_API_KEY;
})();

const composer = () => new Promise((resolve, reject) => {
  // Le `composition_plan` de l'API rend une erreur 500 : l'arc passe par le
  // `prompt`, avec les minutages de chaque section.
  const corps = JSON.stringify({
    prompt: PROMPT,
    music_length_ms: Math.round((FILM + MARGE) * 1000),
  });
  const req = https.request({
    hostname: 'api.elevenlabs.io',
    path: '/v1/music?output_format=mp3_44100_128',
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

const niveau = (f, de, t) => {
  const r = require('child_process').spawnSync('ffmpeg', ['-hide_banner', '-i', f,
    '-ss', String(de), '-t', String(t), '-af', 'volumedetect', '-f', 'null', '-'],
  { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const m = String(r.stderr || '').replace(/\r/g, '').match(/mean_volume:\s*(-?[\d.]+) dB/);
  return m ? Number(m[1]) : null;
};

(async () => {
  console.log(`film ${FILM.toFixed(2)}s -> morceau de ${(FILM + MARGE).toFixed(0)}s`);
  sections.forEach((s) => console.log(`  ${s.slice(0, 96)}`));
  fs.mkdirSync(path.dirname(SORTIE), { recursive: true });
  fs.writeFileSync(SORTIE, await composer());

  const d = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', SORTIE], { encoding: 'utf8' }).trim());

  // GARDE 1 : le morceau doit couvrir le film. `apad` remplit sinon la fin de
  // silence et rien ne le signale.
  if (d < FILM) {
    console.error(`morceau de ${d.toFixed(2)}s pour un film de ${FILM.toFixed(2)}s : trop court`);
    process.exit(1);
  }

  // GARDE 2 : l'arc doit etre DANS LE FICHIER, pas seulement dans le prompt. On
  // mesure chaque mouvement ; des niveaux plats veulent dire que le prompt n'a
  // pas ete suivi et qu'on a une nappe uniforme de plus.
  const mesures = MOUVEMENTS.map((m, i) => {
    const { de, a } = bornes(m.plans);
    return { i, de, moy: niveau(SORTIE, de, Math.max(1, a - de)) };
  });
  mesures.forEach((x) => console.log(`  mouvement ${x.i + 1} (${x.de.toFixed(0)}s) : ${x.moy} dB`));
  const vals = mesures.map((x) => x.moy).filter((x) => x !== null);
  const amplitude = Math.max(...vals) - Math.min(...vals);
  console.log(`amplitude de l'arc : ${amplitude.toFixed(1)} dB`);
  if (amplitude < 3) {
    console.error('moins de 3 dB entre le mouvement le plus fort et le plus faible :'
      + ' le morceau est uniforme, le prompt n\'a pas ete suivi');
    process.exit(1);
  }

  console.log(`\nmusique : ${path.relative(ROOT, SORTIE)} (${d.toFixed(2)}s)`);
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
