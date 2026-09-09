// Gate du CLOISONNEMENT de l'agent marketing : un centre, un cerveau.
//
// CE QUE CE GATE DEFEND, et pourquoi il existe
// Un agent qui partagerait sa matiere entre centres sortirait le chiffre
// d'affaires de Libramont dans un conseil destine a Gembloux. Ce serait un
// mensonge servi a un gerant sur sa propre console, et invisible : le texte
// serait plausible, seul le nombre serait faux. La mesure du 2026-09-09 montre
// que 9 des 10 tables du cerveau portent deja center_id ; ce gate empeche la
// dixieme situation d'apparaitre du cote du code.
//
// Trois barrieres, testees separement parce qu'elles peuvent tomber une par une :
//   1. LA REQUETE filtre par centre (parametree, jamais concatenee) ;
//   2. LES FICHES de deux centres sont disjointes ;
//   3. LA GARDE de provenance refuse un nombre venu d'un autre centre.
// La barriere 3 est celle qui rattrape les deux autres : meme si une fiche
// etait polluee, un nombre absent de la fiche du centre vise est rejete.
//
// Sans reseau : le pool est injecte. node scripts/center-isolation-check.js
const { ficheDuRegistre, chargerFicheDuRegistre } = require('../lib/center-facts');
const { verifierProvenance } = require('../lib/center-guards');
const { portefeuille, faitsUtiles } = require('../lib/center-advisor');

let failures = 0;
function ok(label, condition, detail = '') {
  if (condition) {
    console.log(`ok    ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL  ${label}${detail ? `  ${detail}` : ''}`);
}

function resa(over = {}) {
  return {
    date: '2026-07-04', start_time: '14:00', status: 'paid', channel: 'public',
    pax: 8, price: 200, base_price: 200, formule_id: 'f1',
    email: 'client@example.test', name: 'Client',
    created_at: '2026-06-20T17:30:00.000Z', payment_method: 'Comptoir',
    occasion: 'amis', ...over,
  };
}
function serie(nb, prefixe, prix, depart) {
  return Array.from({ length: nb }, (unused, i) => {
    const d = new Date(depart.getTime() + i * 7 * 86400000);
    return resa({
      date: d.toISOString().slice(0, 10),
      email: `${prefixe}${i}@example.test`,
      price: prix,
      created_at: new Date(d.getTime() - 9 * 86400000 + (i % 5) * 3600000).toISOString(),
    });
  });
}

(async () => {
  // ── 1. LA REQUETE FILTRE PAR CENTRE ───────────────────────────────────────
  // Assertion COMPORTEMENTALE : on capture le SQL reellement emis et ses
  // parametres. Chercher la chaine "center_id" dans le fichier ne prouverait
  // rien : elle pourrait figurer dans un commentaire, ou le parametre pourrait
  // ne jamais etre passe.
  console.log('[1] LA REQUETE : le centre voyage en parametre, jamais concatene');
  const emises = [];
  const poolEspion = {
    query: async (sql, params) => {
      emises.push({ sql: String(sql), params: params || [] });
      return { rows: [], rowCount: 0 };
    },
  };
  await chargerFicheDuRegistre({ centerId: 'gembloux', aujourdhui: '2026-09-09', pool: poolEspion });
  const requeteResa = emises.find((r) => /from\s+reservations/i.test(r.sql));
  ok('MONTAGE : la requete sur reservations a bien ete capturee', Boolean(requeteResa),
    JSON.stringify(emises.map((e) => e.sql.slice(0, 40))));
  ok('elle porte une clause center_id', /center_id\s*=\s*\$1/.test(requeteResa.sql),
    requeteResa.sql.replace(/\s+/g, ' ').slice(0, 120));
  ok('le centre est passe en PARAMETRE, pas colle dans le SQL',
    requeteResa.params[0] === 'gembloux' && !requeteResa.sql.includes('gembloux'),
    JSON.stringify(requeteResa.params));
  ok('la requete exclut aussi les lignes fabriquees',
    /not\s*\(/.test(requeteResa.sql) && requeteResa.params.some((p) => String(p).includes('demo.')),
    JSON.stringify(requeteResa.params));

  // Un centre different produit une requete differente : le parametre n'est
  // pas fige quelque part.
  emises.length = 0;
  await chargerFicheDuRegistre({ centerId: 'libramont', aujourdhui: '2026-09-09', pool: poolEspion });
  const autre = emises.find((r) => /from\s+reservations/i.test(r.sql));
  ok('CONTRE-PREUVE : un autre centre change bien le parametre',
    autre.params[0] === 'libramont', JSON.stringify(autre.params));

  // ── 2. DEUX FICHES, DEUX MONDES ───────────────────────────────────────────
  console.log('\n[2] LES FICHES : aucun fait ne traverse d un centre a l autre');
  const A = ficheDuRegistre({
    reservations: serie(60, 'a', 200, new Date('2026-01-05T00:00:00Z')),
    formules: [{ id: 'f1', name: 'Bowling Classique', active: true }],
    aujourdhui: '2027-06-01',
  });
  const B = ficheDuRegistre({
    reservations: serie(60, 'b', 37, new Date('2026-01-05T00:00:00Z')),
    formules: [{ id: 'f1', name: 'Bowling Classique', active: true }],
    aujourdhui: '2027-06-01',
  });
  ok('MONTAGE : les deux fiches sont nourries', Object.keys(A).length > 10 && Object.keys(B).length > 10);
  ok('MONTAGE : leurs chiffres d affaires different vraiment',
    A.ca_total.valeur !== B.ca_total.valeur, `${A.ca_total.valeur} contre ${B.ca_total.valeur}`);
  const caA = String(A.ca_total.valeur).match(/[0-9]+/)[0];
  const caB = String(B.ca_total.valeur).match(/[0-9]+/)[0];

  // ── 3. LA GARDE REFUSE UN NOMBRE ETRANGER ─────────────────────────────────
  console.log('\n[3] LA GARDE : un chiffre venu d un autre centre est un intrus');
  const texteA = `Ton chiffre d affaires est de ${caA} EUR.`;
  ok('le chiffre du centre A passe SUR le centre A (sinon le refus ne prouverait rien)',
    verifierProvenance(texteA, A).propre, JSON.stringify(verifierProvenance(texteA, A).intrus));
  const fuite = verifierProvenance(texteA, B);
  ok('le MEME texte est refuse sur le centre B',
    fuite.propre === false && fuite.intrus.includes(caA), JSON.stringify(fuite.intrus));
  const texteB = `Ton chiffre d affaires est de ${caB} EUR.`;
  ok('et la symetrie tient : le chiffre de B est refuse sur A',
    verifierProvenance(texteB, A).propre === false,
    JSON.stringify(verifierProvenance(texteB, A).intrus));

  // ── 4. LE PROMPT NE PORTE QU UN SEUL CENTRE ───────────────────────────────
  // C'est ce que le modele VOIT. Si un fait etranger entrait ici, la garde le
  // rattraperait a la sortie, mais le modele aurait deja raisonne dessus.
  console.log('\n[4] LE PROMPT : le modele ne voit qu un seul centre');
  const vuA = portefeuille(A);
  const idsA = new Set(vuA.map((f) => f.id));
  const valeursA = vuA.map((f) => String(f.valeur)).join(' ');
  ok('MONTAGE : le portefeuille de A n est pas vide', vuA.length > 5, String(vuA.length));
  ok('aucune valeur du centre B n apparait dans ce que voit le modele pour A',
    !valeursA.includes(caB), `${caB} trouve dans : ${valeursA.slice(0, 80)}`);
  const vuB = portefeuille(B);
  ok('et reciproquement pour B',
    !vuB.map((f) => String(f.valeur)).join(' ').includes(caA), caA);
  ok('les deux portefeuilles portent les MEMES identifiants de faits (meme moteur, donnees disjointes)',
    vuB.every((f) => idsA.has(f.id)) || vuA.every((f) => new Set(vuB.map((x) => x.id)).has(f.id)),
    `${vuA.length} contre ${vuB.length}`);

  // ── 5. UNE FICHE MELANGEE SE VOIT ─────────────────────────────────────────
  // Contre-preuve de l ensemble : si on fusionnait les deux fiches, le chiffre
  // etranger deviendrait accepte. C est la preuve que ce sont bien les fiches
  // separees qui protegent, et pas un hasard de valeurs.
  console.log('\n[5] CONTRE-PREUVE : fusionner les fiches ouvre la fuite');
  const melangee = { ...B, ...Object.fromEntries(Object.entries(A).map(([k, v]) => [`a_${k}`, v])) };
  ok('sur une fiche fusionnee, le chiffre de A passe sur B : la separation etait bien la protection',
    verifierProvenance(texteA, melangee).propre === true,
    JSON.stringify(verifierProvenance(texteA, melangee).intrus));
  ok('et le portefeuille fusionne porte plus de faits que chacun seul',
    faitsUtiles(melangee).length > faitsUtiles(B).length,
    `${faitsUtiles(melangee).length} contre ${faitsUtiles(B).length}`);

  console.log(`\n${failures ? `center-isolation-check: ${failures} ECHEC(S)` : 'center-isolation-check: ALL OK'}`);
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error('FAIL  gate interrompu :', (error && error.stack) || error);
  process.exit(1);
});
