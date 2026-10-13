// L OFFRE D ATTENTE : ce que le centre propose au sous-groupe qui patiente.
//
// Movsar, 2026-09-17, apres l entretien avec Seb : « entre 2 attente un gros
// groupe qui doivent scinder leur groupe [...] il faut proposer une activite le
// temps d attente pour le groupe B qui attendent que le groupe A termine [...]
// arcade 10 euro par personne pour 30m (donc une belle reduction) ou minigolf a
// 8 euro par personne qui est une reduction aussi, ptite pop up apparait avec
// loffre avant confirmation sur pinlane ».
//
// LA SITUATION EXISTE VRAIMENT, et ce gate la monte avant d asserter : a
// Libramont l arene compte 30 armes, donc un groupe de 40 joue en DEUX vagues
// (mesure : « Laser Game - groupe 1/2 » 11:00-11:25, « groupe 2/2 » 11:30-11:55).
// Vingt personnes attendent trente minutes.
//
// CE QUI EST TENU ICI :
//   1. sans groupe scinde, AUCUNE offre (un groupe de 8 n attend pas) ;
//   2. avec groupe scinde, une carte par activite declaree par le centre, au
//      tarif declare, pour les SEULES personnes qui attendent ;
//   3. le tarif d attente n existe QUE si le centre le declare : aucun prix
//      n est invente, aucune remise n est annoncee sans prix de reference ;
//   4. un navigateur qui reclame le tarif d attente sans groupe scinde paie le
//      tarif du catalogue, a la disponibilite COMME a la reservation.
//
// Lancement : node scripts/wait-offer-check.js
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const CENTERS = path.join(ROOT, 'ops-knowledge/centers.json');
const CENTER_ID = 'libramont';

function nextSaturday() {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
  const c = new Date(Date.UTC(y, m - 1, d));
  do { c.setUTCDate(c.getUTCDate() + 1); } while (c.getUTCDay() !== 6);
  return c.toISOString().slice(0, 10);
}
const DATE = nextSaturday();

let failures = 0;
function record(label, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` :: ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}
function section(title) { console.log(`\n--- ${title}`); }

// Chargement NEUF de tout le repo, base neutralisee : la contre-epreuve mute
// le chargement des modules en mémoire, il faut les relire.
function charger() {
  Object.keys(require.cache)
    .filter((cle) => cle.startsWith(ROOT) && !cle.includes(`${path.sep}node_modules${path.sep}`))
    .forEach((cle) => { delete require.cache[cle]; });
  const database = require(path.join(ROOT, 'lib/database.js'));
  database.readAvailabilitySnapshot = async () => ({ reservations: [], laneStatuses: {}, blocks: [], date: DATE, centerId: CENTER_ID });
  return {
    availability: require(path.join(ROOT, 'api/public-availability.js')),
    visitProgram: require(path.join(ROOT, 'lib/visit-program.js')),
    opsEngine: require(path.join(ROOT, 'lib/ops-engine.js')),
    reservationRequest: require(path.join(ROOT, 'lib/reservation-request.js')),
    opsKnowledge: require(path.join(ROOT, 'lib/ops-knowledge.js')),
  };
}

function appel(api, params) {
  return new Promise((resolve, reject) => {
    const req = { method: 'GET', url: `/api/public-availability?${params.toString()}`, headers: { host: '127.0.0.1' }, on() {}, setEncoding() {} };
    const res = {
      statusCode: 0,
      setHeader() {},
      writeHead(code) { this.statusCode = code; },
      end(body) {
        try { resolve(JSON.parse(String(body || '{}'))); } catch (error) { reject(new Error(`reponse illisible : ${String(body).slice(0, 200)}`)); }
      },
    };
    api(req, res).catch(reject);
  });
}

const PROGRAMME = [{ activityId: 'laser_game', games: 1 }, { activityId: 'bowling', duration: 1 }];
function requete(pax, programme = PROGRAMME) {
  return new URLSearchParams({
    centerId: CENTER_ID, date: DATE, type: 'visite', pax: String(pax), program: JSON.stringify(programme),
  });
}

// `attendu` : le nombre d occurrences que la mutation doit couper. La cle des
// offres apparait une fois par centre qui en declare : les couper toutes est le
// seul moyen de prouver que la carte vient bien de la donnee.
async function withSourceMutation(file, from, to, run, attendu = 1) {
  const original = fs.readFileSync(file, 'utf8');
  const count = original.split(from).length - 1;
  if (count !== attendu) throw new Error(`ancre trouvee ${count} fois dans ${path.basename(file)} (attendu ${attendu})`);
  // Compiler la contre-preuve en mémoire : les autres gates et le produit
  // continuent à lire les fichiers intacts sur disque.
  const extension = path.extname(file);
  const loader = require.extensions[extension];
  const mutated = original.split(from).join(to);
  require.extensions[extension] = (module, filename) => {
    if (filename !== file) return loader(module, filename);
    if (extension === '.json') module.exports = JSON.parse(mutated);
    else module._compile(mutated, filename);
  };
  try {
    return await run();
  } finally {
    require.extensions[extension] = loader;
    if (fs.readFileSync(file, 'utf8') !== original) throw new Error(`${path.basename(file)} modifie pendant le gate`);
  }
}

async function main() {
  const { availability, visitProgram, reservationRequest, opsKnowledge, opsEngine } = charger();

  section('Montage : la situation de Movsar existe pour de vrai');
  const centre = opsKnowledge.getCenter(CENTER_ID);
  const armes = Number(centre?.resources?.laser?.weaponCount) || 0;
  record('le centre declare une arene a capacite bornee', armes > 0, `${armes} armes`);
  const offres = Array.isArray(centre.waitOffers) ? centre.waitOffers : [];
  record('le centre declare ses offres d attente', offres.length >= 2, JSON.stringify(offres));
  record('chaque offre porte une activite et un prix par personne', offres.every((offre) => offre && offre.activityId && Number(offre.pricePerPax) > 0));

  const petit = armes - 2;
  const grand = armes + 10;
  record('la regle du groupe scinde dit NON sous la capacite', visitProgram.groupIsSplit({ centerId: CENTER_ID, pax: petit, items: PROGRAMME }) === false, `${petit} personnes`);
  record('et OUI au-dessus', visitProgram.groupIsSplit({ centerId: CENTER_ID, pax: grand, items: PROGRAMME }) === true, `${grand} personnes`);
  record('sans laser ni activite qui tourne au programme, jamais de groupe scinde', visitProgram.groupIsSplit({ centerId: CENTER_ID, pax: grand, items: [{ activityId: 'bowling', duration: 1 }] }) === false);

  section('[1] Un groupe qui tient dans l arene ne recoit aucune offre');
  const petitGroupe = await appel(availability, requete(petit));
  const cartesPetit = (petitGroupe.complements || []).filter((carte) => carte.kind === 'attente');
  record('le creneau est propose', (petitGroupe.slots || []).length >= 1);
  record('aucune carte d attente', cartesPetit.length === 0, JSON.stringify(cartesPetit.map((c) => c.name)));

  section('[2] Un groupe scinde recoit l offre, pour ceux qui attendent');
  const grandGroupe = await appel(availability, requete(grand));
  const creneau = (grandGroupe.slots || [])[0] || null;
  const vagues = ((creneau && creneau.opsPlan && creneau.opsPlan.resourceBlocks) || [])
    .filter((bloc) => bloc && bloc.resourceType === 'laser_arena');
  record('montage : le moteur joue bien l arene en plusieurs vagues', vagues.length >= 2, JSON.stringify(vagues.map((bloc) => ({ debut: bloc.startTime, joueurs: bloc.players || bloc.pax }))));
  const derniereVague = vagues[vagues.length - 1] || null;
  const attendent = Number(derniereVague && (derniereVague.players || derniereVague.pax)) || 0;
  const cartes = (grandGroupe.complements || []).filter((carte) => carte.kind === 'attente');
  record('des cartes d attente sont proposees', cartes.length >= 1, JSON.stringify(cartes.map((c) => c.name)));
  record('une carte par offre declaree que le programme ne contient pas deja', cartes.length === offres.length, `${cartes.length} carte(s) pour ${offres.length} offre(s)`);

  for (const carte of cartes) {
    const activityId = carte.patch && carte.patch.activityId;
    const offre = offres.find((item) => item.activityId === activityId) || null;
    record(`la carte ${activityId} vient d une offre declaree`, Boolean(offre), JSON.stringify(carte.patch));
    if (!offre) continue;
    record(`${activityId} : elle ne facture QUE les personnes qui attendent`, carte.pax === attendent, `${carte.pax} facturees pour ${attendent} en attente`);
    record(`${activityId} : au tarif declare par le centre`, Math.round(carte.deltaTotal * 100) === Math.round(offre.pricePerPax * attendent * 100), `${carte.deltaTotal} EUR pour ${attendent} x ${offre.pricePerPax}`);
    record(`${activityId} : la carte dit le prix par personne`, new RegExp(`${String(offre.pricePerPax).replace('.', '[.,]')}\\s*€`).test(carte.totalLabel || ''), carte.totalLabel || '');
    record(`${activityId} : elle dit pourquoi (le temps mort)`, /attente/i.test(carte.noteLabel || ''), carte.noteLabel || '');
    record(`${activityId} : elle demande le tarif d attente dans son panier`, Boolean(carte.patch.options && carte.patch.options.waitOffer === true && Number(carte.patch.options.participants) === attendent), JSON.stringify(carte.patch.options));
  }

  section('[3] Le tarif d attente ne s applique QUE si le groupe est scinde');
  const ligneAttente = { activityId: cartes[0] && cartes[0].patch.activityId, waitOffer: true, participants: attendent };
  const programmeScinde = visitProgram.normalizeProgram([...PROGRAMME, ligneAttente], { centerId: CENTER_ID, pax: grand, dateStr: DATE, waitOffers: true });
  const programmeNormal = visitProgram.normalizeProgram([...PROGRAMME, ligneAttente], { centerId: CENTER_ID, pax: grand, dateStr: DATE, waitOffers: false });
  const ligneA = programmeScinde.items.find((item) => item.activityId === ligneAttente.activityId) || null;
  const ligneB = programmeNormal.items.find((item) => item.activityId === ligneAttente.activityId) || null;
  record('avec le feu vert : la ligne porte le tarif d attente', Boolean(ligneA && ligneA.waitOffer === true), JSON.stringify(ligneA && { prix: ligneA.price, attente: ligneA.waitOffer }));
  record('sans le feu vert : aucune remise, la ligne reste au catalogue', Boolean(ligneB) && ligneB.waitOffer !== true, JSON.stringify(ligneB && { prix: ligneB.price, attente: ligneB.waitOffer || false }));

  section('[4] La reservation applique la MEME regle que la disponibilite');
  {
    const demande = (pax) => reservationRequest.normalizeReservationRequest({
      centerId: CENTER_ID,
      date: DATE,
      startTime: (creneau && creneau.time) || '10:00',
      pax,
      name: 'Groupe Test',
      phone: '+32470000000',
      email: 'groupe@example.org',
      channel: 'public',
      type: 'visite',
      program: [...PROGRAMME, { ...ligneAttente, participants: Math.min(attendent, pax) }],
    });
    let scinde = null;
    let entier = null;
    try { scinde = demande(grand); } catch (error) { scinde = { erreur: error.message }; }
    try { entier = demande(petit); } catch (error) { entier = { erreur: error.message }; }
    const ligneDe = (req) => ((req && req.program && req.program.items) || []).find((item) => item.activityId === ligneAttente.activityId) || null;
    const ligneScindee = ligneDe(scinde);
    const ligneEntiere = ligneDe(entier);
    record('groupe scinde : la reservation facture le tarif d attente', Boolean(ligneScindee && ligneScindee.waitOffer === true), JSON.stringify(ligneScindee && { prix: ligneScindee.price, attente: ligneScindee.waitOffer }));
    record('groupe entier : la reservation refuse le tarif d attente', Boolean(ligneEntiere) && ligneEntiere.waitOffer !== true, JSON.stringify(ligneEntiere && { prix: ligneEntiere.price, attente: ligneEntiere.waitOffer || false }));
  }

  section('[5] Ce qui se joue PENDANT l attente ne repousse pas la fin');
  {
    // La fin annoncee au client (`visitEndTime`) porte le temps des activites
    // libres. Mais celle-ci se joue dans le temps mort que le plan contient
    // deja : seul son debordement compte. Mesure du 2026-09-18 avant
    // correction : la fin reculait de 45 min au lieu de 15.
    const attenteDuCreneau = (reponse, heure) => {
      const slot = (reponse.slots || []).find((item) => item && item.time === heure) || null;
      const creux = opsEngine.attenteDuSousGroupe(slot && slot.opsPlan ? slot.opsPlan.resourceBlocks : null);
      return creux ? creux.minutes : 0;
    };
    const enMinutes = (t) => (t ? Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5)) : null);
    const sans = await appel(availability, requete(grand));
    const heure = ((sans.slots || [])[0] || {}).time || null;
    record('montage : un creneau est propose et annonce sa fin',
      Boolean(heure && (sans.slots || [])[0].visitEndTime), `${heure} -> ${((sans.slots || [])[0] || {}).visitEndTime}`);
    const attente = attenteDuCreneau(sans, heure);
    record('montage : le plan contient bien un temps mort', attente > 0, `${attente} min`);

    for (const offre of offres) {
      const avec = await appel(availability, requete(grand, [...PROGRAMME, { activityId: offre.activityId, waitOffer: true, participants: attendent }]));
      const creneauAvec = (avec.slots || []).find((item) => item && item.time === heure) || null;
      const programme = visitProgram.normalizeProgram([...PROGRAMME, { activityId: offre.activityId, waitOffer: true, participants: attendent }],
        { centerId: CENTER_ID, pax: grand, dateStr: DATE, waitOffers: true });
      const ligne = programme.items.find((item) => item.activityId === offre.activityId) || null;
      const duree = ligne ? Math.max(0, Math.round(Number(ligne.minutes) || 0)) : 0;
      const attendu = Math.max(0, duree - attente);
      const recul = creneauAvec ? enMinutes(creneauAvec.visitEndTime) - enMinutes((sans.slots || [])[0].visitEndTime) : null;
      record(`${offre.activityId} : la fin ne recule que du debordement`, recul === attendu,
        `${duree} min d activite sur ${attente} min d attente -> recul ${recul} min, attendu ${attendu}`);
    }
  }

  section('[6] Sans centre nomme, le groupe n est jamais declare scinde');
  {
    // Un repli sur un centre ferait juger le groupe sur une AUTRE arene, et le
    // tarif d attente est sous le catalogue : la reponse sans centre est NON.
    record('centerId vide : non', visitProgram.groupIsSplit({ centerId: '', pax: grand, items: PROGRAMME }) === false);
    record('centerId absent : non', visitProgram.groupIsSplit({ pax: grand, items: PROGRAMME }) === false);
    record('centerId inconnu : non', visitProgram.groupIsSplit({ centerId: 'centre-qui-n-existe-pas', pax: grand, items: PROGRAMME }) === false);
    record('le centre nomme, lui, repond oui', visitProgram.groupIsSplit({ centerId: CENTER_ID, pax: grand, items: PROGRAMME }) === true);
  }
  section('Contre-epreuves par mutation du code de production');
  try {
    const sansOffres = await withSourceMutation(
      CENTERS,
      '"waitOffers"',
      '"waitOffersRetirees"',
      async () => {
        const neuf = charger();
        const reponse = await appel(neuf.availability, requete(grand));
        return (reponse.complements || []).filter((carte) => carte.kind === 'attente');
      },
      2,
    );
    record('sans offre declaree par le centre, aucune carte : ce gate ROUGIRAIT', sansOffres.length === 0, JSON.stringify(sansOffres.map((c) => c.name)));
  } catch (error) {
    record('contre-epreuve de la donnee montable', false, error.message);
  }

  try {
    const sansRegle = await withSourceMutation(
      path.join(ROOT, 'api/public-availability.js'),
      'attente: attenteDuPlan(retainedSlot),',
      'attente: null,',
      async () => {
        const neuf = charger();
        const reponse = await appel(neuf.availability, requete(grand));
        return (reponse.complements || []).filter((carte) => carte.kind === 'attente');
      },
    );
    record('sans la detection du sous-groupe, aucune carte : ce gate ROUGIRAIT', sansRegle.length === 0, JSON.stringify(sansRegle.map((c) => c.name)));
  } catch (error) {
    record('contre-epreuve de la detection montable', false, error.message);
  }

  try {
    // La fin AFFICHEE n est pas le verdict du moteur : mesurerLaVisite
    // (lib/ops-engine.js, depuis le 2026-10-13) ajoute la reserve a la fin du
    // plan. La mutation coupe donc la deduction LA, au seul endroit qui decide
    // ce que le client lit. Sans elle, la fin recule de toute la duree de
    // l activite au lieu de son seul debordement.
    // La duree REELLE de chaque offre est celle du programme normalise, pas le
    // champ `minutes` du centre : le minigolf n en declare aucun et tient sa
    // duree du catalogue. Trier sur le champ aurait choisi la plus courte.
    const dureeDe = (activityId) => {
      const programme = visitProgram.normalizeProgram([...PROGRAMME, { activityId, waitOffer: true, participants: attendent }],
        { centerId: CENTER_ID, pax: grand, dateStr: DATE, waitOffers: true });
      const ligne = programme.items.find((item) => item.activityId === activityId) || null;
      return ligne ? Math.max(0, Math.round(Number(ligne.minutes) || 0)) : 0;
    };
    const plusLongue = offres.slice().sort((a, b) => dureeDe(b.activityId) - dureeDe(a.activityId))[0];
    const programmeLong = [...PROGRAMME, { activityId: plusLongue.activityId, waitOffer: true, participants: attendent }];
    const dureeLongue = dureeDe(plusLongue.activityId);
    const sansDeduction = await withSourceMutation(
      path.join(ROOT, 'lib/ops-engine.js'),
      'return { apresLePlan: Math.max(finPlan, depart), libreApres: Math.max(0, Math.max(0, Math.round(Number(libre) || 0)) - couvert - trous) };',
      'return { apresLePlan: Math.max(finPlan, depart), libreApres: Math.max(0, Math.round(Number(libre) || 0)) };',
      async () => {
        const neuf = charger();
        const enMinutes = (t) => (t ? Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5)) : null);
        const sans = await appel(neuf.availability, requete(grand));
        const avec = await appel(neuf.availability, requete(grand, programmeLong));
        const heure = ((sans.slots || [])[0] || {}).time || null;
        const creneauAvec = (avec.slots || []).find((item) => item && item.time === heure) || null;
        return creneauAvec ? enMinutes(creneauAvec.visitEndTime) - enMinutes((sans.slots || [])[0].visitEndTime) : null;
      },
    );
    record('sans la deduction du temps mort, la fin recule de TOUTE la duree : ce gate ROUGIRAIT',
      sansDeduction === dureeLongue, `recul ${sansDeduction} min pour ${dureeLongue} min d activite`);
  } catch (error) {
    record('contre-epreuve de la deduction montable', false, error.message);
  }
  charger();
  record('centers.json restaure a l identique', fs.readFileSync(CENTERS, 'utf8').includes('"waitOffers"'));
  record('public-availability.js restaure a l identique', fs.readFileSync(path.join(ROOT, 'api/public-availability.js'), 'utf8').includes('attente: attenteDuPlan(retainedSlot),'));

  console.log(`\n${failures === 0 ? 'WAIT OFFER OK' : `WAIT OFFER : ${failures} echec(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => { console.error('ECHEC', error); process.exit(1); });
