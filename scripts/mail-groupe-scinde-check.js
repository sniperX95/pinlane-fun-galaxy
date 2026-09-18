// LE MAIL EXPLIQUE LE GROUPE SCINDE, ET N INVENTE AUCUNE CAPACITE.
//
// Movsar, 2026-09-18 : « ça meme sur les mails confirmations explicatif etc
// devra bien explique avec un francais ponctuel pro », apres avoir vu que
// l ecran des options n expliquait pas pourquoi 49 joueurs jouent en deux fois.
//
// Ce que le mail disait avant : « votre groupe est reparti sur 2 lancements
// afin de respecter les ${weaponCount || 30} armes disponibles ». Un `|| 30`
// qui ecrivait une capacite inventee a un client dont le centre en a vingt, le
// mot « armes » adresse a une famille, et « lancements » la ou le tunnel dit
// « sessions ».
//
// CE QUI EST TENU ICI, sur le mail REELLEMENT compose (buildMessage), pas sur
// une fonction interne recopiee :
//   1. le mail dit la CAUSE (les postes de l arene) avant la consequence ;
//   2. le nombre de postes est celui du CENTRE, different d un centre a l autre ;
//   3. sans capacite declaree, aucun nombre de postes n est ecrit ;
//   4. le vocabulaire du mail est celui du tunnel : « postes », « sessions »,
//      jamais « armes » ni « lancements » ;
//   5. un groupe qui tient en une fois ne lit pas cette explication.
//
// Lancement : node scripts/mail-groupe-scinde-check.js
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'lib/ops-communications.js');

let failures = 0;
function record(label, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` :: ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}
function section(titre) { console.log(`\n--- ${titre}`); }

function charger() {
  Object.keys(require.cache)
    .filter((cle) => cle.startsWith(ROOT) && !cle.includes(`${path.sep}node_modules${path.sep}`))
    .forEach((cle) => { delete require.cache[cle]; });
  return require(path.join(ROOT, 'lib/ops-communications.js'));
}

// Une reservation laser avec un plan qui porte le partage d arene, comme le
// moteur le pose. `weaponCount: 0` represente un centre qui n a rien declare.
function reservation({ centerId, pax, waveCount, weaponCount }) {
  return {
    id: 4242,
    centerId,
    type: 'laser',
    name: 'Groupe Test',
    email: 'groupe@example.org',
    date: '2026-10-10',
    startTime: '15:00',
    pax,
    duration: 1.5,
    opsPlan: {
      arrivalMinutes: 10,
      resourceBlocks: [{ resourceType: 'laser_arena', startTime: '15:00', players: pax, groupWaveCount: waveCount }],
      laserSharing: {
        splitGroup: waveCount > 1,
        waveCount,
        weaponCount,
        requestedPlayers: pax,
        playersTotal: pax,
        mayShare: false,
        sharedNow: false,
      },
    },
  };
}

function corpsDuMail(comms, res) {
  const message = comms.buildMessage({ reservation: res, templateId: 'confirmation', channel: 'email' });
  return String((message && message.body) || '').replace(/\s+/g, ' ').trim();
}

function main() {
  const comms = charger();

  section('Montage : le mail de confirmation se compose bien');
  const gembloux = corpsDuMail(comms, reservation({ centerId: 'gembloux', pax: 49, waveCount: 3, weaponCount: 20 }));
  record('un corps de mail est produit', gembloux.length > 40, `${gembloux.length} caracteres`);

  section('[1] La cause avant la consequence, avec les chiffres du CENTRE');
  record('Gembloux : le mail nomme les 20 postes', /20 postes/.test(gembloux), gembloux.slice(0, 200));
  record('Gembloux : et les 3 sessions', /3 sessions/.test(gembloux));
  record('Gembloux : et l effectif du groupe', /49/.test(gembloux));

  const libramont = corpsDuMail(comms, reservation({ centerId: 'libramont', pax: 49, waveCount: 2, weaponCount: 30 }));
  record('Libramont : le mail nomme les 30 postes', /30 postes/.test(libramont), libramont.slice(0, 200));
  record('Libramont : et les 2 sessions', /2 sessions/.test(libramont));
  record('C EST DONC LA DONNEE DU CENTRE QUI ECRIT LE MAIL',
    /20 postes/.test(gembloux) && /30 postes/.test(libramont) && gembloux !== libramont);

  section('[2] Sans capacite declaree, AUCUN nombre de postes n est ecrit');
  const muet = corpsDuMail(comms, reservation({ centerId: 'libramont', pax: 49, waveCount: 2, weaponCount: 0 }));
  record('aucun « postes » chiffre', !/\d+\s*postes/.test(muet), muet.slice(0, 200));
  record('mais les sessions sont bien annoncees', /2 sessions/.test(muet));
  record('et surtout aucun 30 invente', !/30/.test(muet.replace(/\b10 minutes\b/g, '')), muet.slice(0, 200));

  section('[3] Le vocabulaire du mail est celui du tunnel');
  [['armes', gembloux], ['lancements', gembloux], ['armes', libramont], ['lancements', libramont]].forEach(([mot, corps]) => {
    record(`le mail n ecrit jamais « ${mot} » au client`, !new RegExp(mot, 'i').test(corps));
  });

  section('[4] Un groupe qui tient en une fois ne lit pas cette explication');
  const petit = corpsDuMail(comms, reservation({ centerId: 'libramont', pax: 12, waveCount: 1, weaponCount: 30 }));
  record('aucune mention de sessions successives', !/sessions qui se suivent/.test(petit), petit.slice(0, 200));

  section('Contre-epreuve par mutation : ce gate sait-il rougir ?');
  const original = fs.readFileSync(SOURCE, 'utf8');
  const ancre = "const postes = Number(sharing.weaponCount) > 0 ? Math.trunc(Number(sharing.weaponCount)) : null;";
  try {
    if (original.split(ancre).length - 1 !== 1) throw new Error('ancre introuvable');
    fs.writeFileSync(SOURCE, original.split(ancre).join("const postes = Number(sharing.weaponCount) || 30;"));
    const mute = charger();
    const inventé = corpsDuMail(mute, reservation({ centerId: 'libramont', pax: 49, waveCount: 2, weaponCount: 0 }));
    record('avec le repli en dur, un centre sans capacite fait ecrire « 30 postes » : ce gate ROUGIRAIT',
      /30 postes/.test(inventé), inventé.slice(0, 200));
  } catch (error) {
    record('contre-epreuve montable', false, error.message);
  } finally {
    fs.writeFileSync(SOURCE, original);
  }
  record('ops-communications.js restaure a l identique', fs.readFileSync(SOURCE, 'utf8') === original);

  console.log(`\n${failures === 0 ? 'MAIL GROUPE SCINDE OK' : `MAIL GROUPE SCINDE : ${failures} echec(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
