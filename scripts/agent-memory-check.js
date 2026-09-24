// LA MEMOIRE DE L AGENT : TOUT EST GARDE, PAR CENTRE, ET RIEN NE SE PERD.
//
// Pourquoi ce gate existe (Movsar, 2026-09-24) : « faut vraiment un gros
// systeme ou il apprend, ou tout est stocke, pour l ameliorer jusqu a ce qu il
// connaisse tout absolument ». Et, plus tot : « chaque centre a son propre
// agent : il ne doit pas sortir des chiffres ou des infos d un autre centre ».
//
// Ce qui etait faux avant, mesure dans le code du 2026-09-24 :
//   - les faits vivaient dans le JSON des reglages, plafonnes a 80 : au 81e,
//     le plus ancien sortait sans rien dire ;
//   - enregistrer « Ce que l agent ecrit » reecrivait ce JSON SANS eux ;
//   - les corrections du staff (l autre facon d apprendre) etaient purgees
//     au-dela de 200.
//
// LES PROPRIETES, mesurees sur lib/email-agent.js avec une base simulee qui
// n applique un filtre QUE si la requete l ecrit (une requete qui oublie
// `center_id = $1` rend les lignes de tous les centres, comme la vraie base) :
//
//   [A] SANS PLAFOND : 150 faits appris, 150 faits relus.
//   [B] UN CENTRE, SA MEMOIRE : un fait appris a Libramont n existe ni pour
//       Gembloux, ni dans le prompt de Gembloux.
//   [C] REAPPRENDRE REMPLACE ET GARDE L ANCIEN : la meme question (casse et
//       espaces pres) change la reponse, l ancienne part dans son historique.
//   [D] OUBLIER RETIRE SANS EFFACER, et reapprendre fait revenir.
//   [E] L ANCIEN JSON EST IMPORTE UNE FOIS : un fait oublie ne revient pas par
//       l import ; et si la table est inaccessible, l agent lit l ancien JSON.
//   [F] LES LIMITES SONT CELLES DE L ECRAN : 300 pour la question, 2000 pour
//       la reponse, au caractere pres.
//   [G] LE PROMPT RESTE BORNE : sous le budget, tous les faits ; au-dela, les
//       plus proches du mail traite, jamais un fait coupe.
//   [H] LES QUESTIONS PROCHES : celles qu un fait peut resoudre, deux racines
//       communes au moins, trois au plus, les plus proches d abord.
//
// Usage : node scripts/agent-memory-check.js
'use strict';

let failures = 0;
function ok(cond, label, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures += 1;
  return cond;
}

// ── LA BASE SIMULEE ────────────────────────────────────────────────────────
// Une table `agent_facts` en memoire et les reglages JSON. Chaque requete est
// reconnue a son etiquette (/* agent_facts:... */), et ses filtres ne
// s appliquent que s ils sont ECRITS dans le texte de la requete.
function baseSimulee({ reglages = {}, tablePanne = false } = {}) {
  const lignes = [];
  let prochainId = 1;
  let horloge = Date.parse('2026-09-24T10:00:00Z');
  const maintenant = () => new Date((horloge += 1000));
  const journal = [];
  const deps = {
    journal,
    lignes,
    query: async (text, params = []) => {
      const sql = String(text);
      journal.push({ sql, params });
      const tag = (sql.match(/\/\* agent_facts:(\w+) \*\//) || [])[1];
      if (tag && tablePanne) { const e = new Error('relation "agent_facts" does not exist'); e.code = '42P01'; throw e; }
      const duCentre = (l) => !/center_id = \$1/.test(sql) || l.center_id === params[0];
      if (!tag && /from center_automation_settings/.test(sql)) {
        const r = reglages[params[0]];
        return { rows: r ? [{ settings: r }] : [] };
      }
      if (!tag && /from email_agent_memory/.test(sql)) return { rows: [] };
      if (tag === 'schema') return { rows: [] };
      if (tag === 'existe') return { rows: lignes.filter(duCentre).slice(0, 1).map(() => ({ '?column?': 1 })) };
      if (tag === 'importer') {
        const [center, cle, question, reponse, par, le] = params;
        if (lignes.some((l) => l.center_id === center && l.cle === cle)) return { rows: [], rowCount: 0 };
        const t = le ? new Date(le) : maintenant();
        lignes.push({ id: prochainId++, center_id: center, cle, question, reponse, par, source_communication_id: null, resolues: 0, versions: [], oublie_le: null, oublie_par: '', created_at: t, updated_at: t });
        return { rows: [], rowCount: 1 };
      }
      const rendu = (l) => ({ ...l, versions: l.versions.length });
      if (tag === 'actifs') {
        const actifs = lignes.filter(duCentre).filter((l) => !/oublie_le is null/.test(sql) || l.oublie_le === null);
        actifs.sort((a, b) => b.updated_at - a.updated_at || b.id - a.id);
        return { rows: actifs.map(rendu) };
      }
      if (tag === 'apprendre') {
        const [center, cle, question, reponse, par, source] = params;
        let l = lignes.find((x) => x.center_id === center && x.cle === cle);
        const t = maintenant();
        if (!l) {
          l = { id: prochainId++, center_id: center, cle, question, reponse, par, source_communication_id: source, resolues: 0, versions: [], oublie_le: null, oublie_par: '', created_at: t, updated_at: t };
          lignes.push(l);
        } else {
          if (l.reponse !== reponse) l.versions = l.versions.concat([{ reponse: l.reponse, par: l.par, le: l.updated_at }]);
          Object.assign(l, { question, reponse, par, source_communication_id: source || l.source_communication_id, oublie_le: null, oublie_par: '', updated_at: t });
        }
        return { rows: [rendu(l)] };
      }
      if (tag === 'modifier') {
        const [, id, reponse, par] = params;
        const l = lignes.filter(duCentre).find((x) => x.id === id && x.oublie_le === null);
        if (!l) return { rows: [] };
        if (l.reponse !== reponse) l.versions = l.versions.concat([{ reponse: l.reponse, par: l.par, le: l.updated_at }]);
        Object.assign(l, { reponse, par, updated_at: maintenant() });
        return { rows: [rendu(l)] };
      }
      if (tag === 'oublier') {
        const [, cible, par] = params;
        const parId = /and id = \$2/.test(sql);
        const touchees = lignes.filter(duCentre).filter((l) => l.oublie_le === null && (parId ? l.id === cible : l.cle === cible));
        touchees.forEach((l) => { l.oublie_le = maintenant(); l.oublie_par = par; });
        return { rows: [], rowCount: touchees.length };
      }
      if (tag === 'resolues') {
        const [, id, n] = params;
        lignes.filter(duCentre).filter((l) => l.id === id).forEach((l) => { l.resolues += n; });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    },
  };
  return deps;
}

(async () => {
  const agent = require('../lib/email-agent');
  const { getFaitsAppris, apprendreUnFait, modifierUnFait, oublierUnFait, compterResolutions, questionsProches, buildEmailBrain, APPRIS_LIMITS } = agent;
  const { choisirFaits, FAITS_BUDGET } = agent.__test;

  // =====================================================================
  console.log('[A] sans plafond');
  // =====================================================================
  const a = baseSimulee();
  for (let i = 1; i <= 150; i += 1) {
    await apprendreUnFait('libramont', { question: `Question numero ${i} ?`, reponse: `Reponse ${i}.`, par: 'Seb' }, a);
  }
  const cent50 = await getFaitsAppris('libramont', a);
  ok(cent50.length === 150, '[A] 150 faits appris, 150 faits relus (l ancien stockage en gardait 80)', String(cent50.length));
  ok((cent50[0] || {}).question === 'Question numero 150 ?' && (cent50[149] || {}).question === 'Question numero 1 ?', '[A] le plus recent d abord, le premier appris toujours la');
  ok(cent50.every((f) => Number.isInteger(f.id) && f.id > 0 && f.par === 'Seb' && f.le), '[A] chaque fait a son identifiant, son auteur, sa date');

  // =====================================================================
  console.log('\n[B] un centre, sa memoire');
  // =====================================================================
  const b = baseSimulee();
  await apprendreUnFait('libramont', { question: 'Le parking est-il gratuit ?', reponse: 'Oui, le parking de Libramont est gratuit.', par: 'Seb' }, b);
  ok((await getFaitsAppris('gembloux', b)).length === 0, '[B] le fait de Libramont n existe pas pour Gembloux');
  const cerveauGembloux = await buildEmailBrain('gembloux', b, Date.parse('2026-09-24T10:00:00Z'), { texte: 'Le parking est-il gratuit ?' });
  ok(!/parking de Libramont/.test(cerveauGembloux.stable + cerveauGembloux.context), '[B] ni dans le prompt de Gembloux');
  const cerveauLibramont = await buildEmailBrain('libramont', b, Date.parse('2026-09-24T10:00:00Z'), { texte: 'Le parking est-il gratuit ?' });
  ok(/parking de Libramont est gratuit/.test(cerveauLibramont.stable), '[B] CONTRE-PREUVE : il est bien dans celui de Libramont');
  await oublierUnFait('gembloux', { question: 'Le parking est-il gratuit ?', par: 'X' }, b);
  ok((await getFaitsAppris('libramont', b)).length === 1, '[B] oublier « la meme question » a Gembloux ne touche pas Libramont');
  const faitLib = (await getFaitsAppris('libramont', b))[0];
  ok(await modifierUnFait('gembloux', { id: faitLib.id, reponse: 'Pirate', par: 'X' }, b) === null && (await getFaitsAppris('libramont', b))[0].reponse !== 'Pirate',
    '[B] corriger le fait de Libramont depuis Gembloux, par son identifiant, ne fait rien');
  await compterResolutions('gembloux', faitLib.id, 5, b);
  ok((await getFaitsAppris('libramont', b))[0].resolues === 0, '[B] ses resolutions non plus');
  ok(b.journal.filter((q) => /agent_facts:(?!schema)/.test(q.sql)).every((q) => q.params[0] === 'libramont' || q.params[0] === 'gembloux'),
    '[B] chaque requete sur la memoire porte le centre en premier parametre');

  // =====================================================================
  console.log('\n[C] reapprendre remplace et garde l ancien');
  // =====================================================================
  const c = baseSimulee();
  const premier = await apprendreUnFait('libramont', { question: 'Les chiens sont-ils admis ?', reponse: 'Non.', par: 'Seb' }, c);
  const second = await apprendreUnFait('libramont', { question: '  les CHIENS   sont-ils admis ?  ', reponse: 'Non, sauf chiens d assistance.', par: 'Lea' }, c);
  const apresC = await getFaitsAppris('libramont', c);
  ok(apresC.length === 1 && second.id === premier.id && apresC[0].reponse === 'Non, sauf chiens d assistance.' && apresC[0].par === 'Lea',
    '[C] la meme question (casse et espaces pres) remplace la reponse, sur la meme ligne', JSON.stringify(apresC));
  ok(apresC[0].versions === 1 && c.lignes[0].versions[0].reponse === 'Non.', '[C] l ancienne reponse reste dans son historique');
  const corrige = await modifierUnFait('libramont', { id: premier.id, reponse: 'Non, sauf chiens d assistance, tenus en laisse.', par: 'Seb' }, c);
  ok(corrige && corrige.versions === 2 && corrige.reponse.endsWith('tenus en laisse.'), '[C] corriger par l identifiant ajoute aussi une version', JSON.stringify(corrige));
  await apprendreUnFait('libramont', { question: 'Les chiens sont-ils admis ?', reponse: 'Non, sauf chiens d assistance, tenus en laisse.', par: 'Seb' }, c);
  ok((await getFaitsAppris('libramont', c))[0].versions === 2, '[C] reapprendre la reponse identique n invente pas de version');

  // =====================================================================
  console.log('\n[D] oublier retire sans effacer, et reapprendre fait revenir');
  // =====================================================================
  const d = baseSimulee();
  const f1 = await apprendreUnFait('libramont', { question: 'Q1 ?', reponse: 'R1.', par: 'Seb' }, d);
  const f2 = await apprendreUnFait('libramont', { question: 'Q2 ?', reponse: 'R2.', par: 'Seb' }, d);
  const n = await oublierUnFait('libramont', { id: f1.id, par: 'Lea' }, d);
  const apresD = await getFaitsAppris('libramont', d);
  ok(n === 1 && apresD.length === 1 && apresD[0].id === f2.id, '[D] oublier par l identifiant retire CE fait de la memoire active');
  const ligne = d.lignes.find((l) => l.id === f1.id);
  ok(ligne && ligne.oublie_le && ligne.oublie_par === 'Lea' && ligne.reponse === 'R1.', '[D] la ligne reste, avec qui l a oubliee et quand');
  await apprendreUnFait('libramont', { question: 'Q1 ?', reponse: 'R1 bis.', par: 'Seb' }, d);
  ok((await getFaitsAppris('libramont', d)).some((f) => f.id === f1.id && f.reponse === 'R1 bis.'), '[D] reapprendre la question la fait revenir');
  ok(await oublierUnFait('libramont', { question: 'q2 ?', par: 'Lea' }, d) === 1, '[D] l oubli par la question (les appels d avant la table) marche encore');

  // =====================================================================
  console.log('\n[E] l ancien JSON est importe une fois');
  // =====================================================================
  const reglages = { libramont: { email_brain: { signature: 'L equipe', appris: [
    { question: 'Peut-on apporter un gateau ?', reponse: 'Oui, le gateau d anniversaire.', par: 'Seb', le: '2026-09-01T10:00:00.000Z' },
    { question: 'Wifi ?', reponse: 'Oui, gratuit.', par: 'Lea', le: '2026-09-02T10:00:00.000Z' },
    { question: '', reponse: 'sans question' },
  ] } } };
  const e = baseSimulee({ reglages });
  const importes = await getFaitsAppris('libramont', e);
  ok(importes.length === 2 && importes.some((f) => f.question === 'Wifi ?' && f.le === '2026-09-02T10:00:00.000Z'),
    '[E] les faits du JSON entrent dans la table a leur date, les vides non', JSON.stringify(importes.map((f) => [f.question, f.le])));
  await oublierUnFait('libramont', { id: importes.find((f) => f.question === 'Wifi ?').id, par: 'Seb' }, e);
  const relus = await getFaitsAppris('libramont', e);
  ok(relus.length === 1 && relus[0].question === 'Peut-on apporter un gateau ?', '[E] un fait importe puis oublie ne revient pas par l import');
  const panne = baseSimulee({ reglages, tablePanne: true });
  const secours = await getFaitsAppris('libramont', panne);
  ok(secours.length === 2 && secours[0].question === 'Peut-on apporter un gateau ?', '[E] table inaccessible : l agent lit l ancien JSON plutot que rien (sans ses lignes vides)', JSON.stringify(secours.map((x) => x.question)));

  // =====================================================================
  console.log('\n[F] les limites sont celles de l ecran');
  // =====================================================================
  const f = baseSimulee();
  const refus = async (champs) => { try { await apprendreUnFait('libramont', champs, f); return ''; } catch (err) { return err.expose ? err.message : `NON EXPOSEE ${err.message}`; } };
  ok(APPRIS_LIMITS.question === 300 && APPRIS_LIMITS.reponse === 2000, '[F] 300 pour la question, 2000 pour la reponse', JSON.stringify(APPRIS_LIMITS));
  ok(await refus({ question: 'Q ?', reponse: 'x'.repeat(APPRIS_LIMITS.reponse) }) === '', '[F] une reponse de 2000 caracteres s apprend');
  ok(/trop longue/.test(await refus({ question: 'Q2 ?', reponse: 'x'.repeat(APPRIS_LIMITS.reponse + 1) })), '[F] 2001 est refuse, avec un message lisible');
  ok(/trop longue/.test(await refus({ question: 'q'.repeat(APPRIS_LIMITS.question + 1), reponse: 'R.' })), '[F] une question de 301 aussi');
  ok(/vide/.test(await refus({ question: 'Q3 ?', reponse: '   ' })), '[F] une reponse vide ne s apprend pas');
  const ecran = require('fs').readFileSync(require('path').join(__dirname, '..', 'assets', 'staff-pages-v2.js'), 'utf8');
  ok(Number((ecran.match(/const PV2_SAVOIR_MAX = (\d+);/) || [])[1]) === APPRIS_LIMITS.reponse, '[F] l ecran compte jusqu a la meme limite que le serveur');

  // =====================================================================
  console.log('\n[G] le prompt reste borne');
  // =====================================================================
  const petits = Array.from({ length: 20 }, (_, i) => ({ question: `Petite question ${i} ?`, reponse: 'Oui.' }));
  ok(choisirFaits(petits, 'peu importe').length === 20, '[G] sous le budget, tous les faits');
  const gros = Array.from({ length: 40 }, (_, i) => ({ question: `Question sur le sujet ${i} ?`, reponse: `${'Texte long. '.repeat(90)}Fin ${i}.` }));
  gros.splice(33, 0, { question: 'Tarif des arcades ?', reponse: 'Les arcades coutent 15 euros la carte de 30 minutes.' });
  const choisis = choisirFaits(gros, 'Bonjour, quel est le tarif des arcades pour huit enfants ?');
  const taille = choisis.reduce((s, x) => s + x.question.length + x.reponse.length + 12, 0);
  ok(taille <= FAITS_BUDGET && choisis.length < gros.length, '[G] au-dela du budget, le prompt reste dessous', `${taille} / ${FAITS_BUDGET}, ${choisis.length} faits sur ${gros.length}`);
  ok(choisis.some((x) => x.question === 'Tarif des arcades ?'), '[G] et le fait qui parle du mail y est, meme loin dans la memoire');
  ok(choisis.every((x) => gros.includes(x)), '[G] chaque fait entre entier ou pas du tout');
  const ordre = choisis.map((x) => gros.indexOf(x));
  ok(ordre.every((v, i) => i === 0 || v > ordre[i - 1]), '[G] dans l ordre de la memoire');

  // =====================================================================
  console.log('\n[H] les questions proches');
  // =====================================================================
  const fait = { question: 'Tarif des arcades', reponse: 'Une carte arcades par personne : 15 euros les 30 minutes.' };
  const ouvertes = [
    { communicationId: 1, question: 'Quel est le tarif des arcades ?' },
    { communicationId: 2, question: 'Peut-on apporter un gateau ?' },
    { communicationId: 3, question: 'Les arcades sont-elles payantes a la carte ?' },
    { communicationId: 4, question: 'Combien coute une carte pour les arcades ?' },
    { communicationId: 5, question: 'Les arcades ?' },
    { communicationId: 6, question: 'Quels sont les tarifs arcades pour 30 minutes par personne ?' },
  ];
  const proches = questionsProches(fait, ouvertes, 3);
  ok(proches.length === 3 && proches[0].communicationId === 6, '[H] trois au plus, la plus proche d abord', JSON.stringify(proches.map((q) => q.communicationId)));
  const toutes = questionsProches(fait, ouvertes, 10).map((q) => q.communicationId);
  ok(toutes.join() === '6,1,3,4', '[H] sans limite de nombre : ni la question sans rapport, ni celle qui ne partage qu un mot', JSON.stringify(toutes));
  ok(questionsProches(fait, ouvertes, 0).length === 0 && questionsProches(null, ouvertes).length === 0, '[H] rien a relire quand il n y a rien a chercher');
  const { motsCles } = agent.__test;
  const pareil = (x, y) => [...motsCles(x)].join() === [...motsCles(y)].join();
  ok(pareil('cartes', 'carte') && pareil('arcades', 'arcade') && pareil('tarifs', 'tarif') && pareil('gateaux', 'gateau') && pareil('Réservation', 'reservations'),
    '[H] le pluriel, la casse et les accents ne separent pas deux mots', JSON.stringify(['cartes', 'carte', 'Réservation'].map((m) => [...motsCles(m)])));

  console.log(failures ? `\n${failures} controle(s) en echec.` : '\nagent-memory-check: ALL OK');
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error('FAIL  gate interrompu :', error && error.stack || error);
  process.exit(1);
});
