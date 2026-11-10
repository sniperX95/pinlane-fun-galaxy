// LES TRANCHES D UNE LISTE DE CONTRE-PREUVES (2026-11-10).
//
// Une part de la suite ne finit jamais avant sa plus longue unite. Le
// 2026-11-10, six jeux de contre-preuves duraient 10 a 13 minutes sur GitHub
// (formules-arrivee, comptoir, planning-barre, temps-reel,
// formules-arrivee-form et l assistant) : la suite entiere ne pouvait pas
// descendre sous 14 minutes, quel que soit le nombre de machines. Coupee en
// tranches, une liste de contre-preuves se joue sur plusieurs machines a la fois.
//
// `--tranche=K/N` (ou `--tiers=K/N`, le nom d origine dans assistant-check) :
// le gate ne joue que les contre-preuves de rang K, K+N, K+2N... Le script npm
// enchaine les N tranches : lance a la main, il joue tout, comme avant.
// scripts/gates-parties-check.js refuse un package.json ou une tranche manque.
'use strict';

const DRAPEAU = /^--(?:tranche|tiers)=(\d+)\/(\d+)$/;
const EST_DRAPEAU = /^--(?:tranche|tiers)=/;

function tranche(argv = process.argv) {
  const brut = argv.find((a) => EST_DRAPEAU.test(a));
  if (!brut) return null;
  const m = DRAPEAU.exec(brut);
  if (!m || Number(m[1]) < 1 || Number(m[1]) > Number(m[2])) throw new Error(`--tranche=K/N attendu, 1 <= K <= N, recu « ${brut} »`);
  return { k: Number(m[1]), n: Number(m[2]) };
}

// La tranche demandee d une liste, ou la liste entiere sans drapeau. Une
// tranche vide est une erreur : N depasse la liste, elle ne prouverait rien.
function trancher(liste, argv = process.argv) {
  const t = tranche(argv);
  if (!t) return liste;
  const part = liste.filter((_, i) => i % t.n === t.k - 1);
  if (!part.length) throw new Error(`tranche ${t.k}/${t.n} vide : la liste n a que ${liste.length} element(s)`);
  return part;
}

// Les scripts npm dont les tranches ne couvrent pas 1..N, chacune une fois.
function incompletes(scripts) {
  const defauts = [];
  for (const [nom, chaine] of Object.entries(scripts)) {
    const groupes = new Map();
    for (const commande of String(chaine).split('&&').map((c) => c.trim())) {
      const mots = commande.split(/\s+/);
      const brut = mots.find((a) => EST_DRAPEAU.test(a));
      if (!brut) continue;
      const m = DRAPEAU.exec(brut);
      const base = mots.filter((a) => a !== brut).join(' ');
      if (!groupes.has(base)) groupes.set(base, []);
      groupes.get(base).push(m ? { k: Number(m[1]), n: Number(m[2]) } : { k: 0, n: 0 });
    }
    for (const [base, vues] of groupes) {
      const n = vues[0].n;
      const attendues = Array.from({ length: n }, (_, i) => i + 1).join(',');
      const jouees = vues.map((v) => v.k).sort((a, b) => a - b).join(',');
      if (!n || vues.some((v) => v.n !== n) || jouees !== attendues) defauts.push(`${nom} : « ${base} » joue ${vues.map((v) => `${v.k}/${v.n}`).join(', ')}`);
    }
  }
  return defauts;
}

module.exports = { tranche, trancher, incompletes };
