'use strict';
// LE BANC DE L AGENT DES MAILS, AVEC LE VRAI MODELE (2026-11-07).
//
// 60 mails de scripts/fixtures/banc-mails.json : 40 vrais cas, 20 pieges. Rien
// n est envoye a personne, aucune base n est touchee : la base et le moteur de
// disponibilite sont des faux construits depuis le contexte de chaque mail, la
// fausse base RESPECTE ses parametres (une lecture qui ne filtrerait pas par
// adresse rendrait l autre client, et le score le verrait).
//
// Usage (la cle vient de l environnement, jamais d un fichier du depot) :
//   ANTHROPIC_API_KEY=... node scripts/email-banc.js --modele claude-haiku-5-5 --sortie banc-haiku.json
//   ANTHROPIC_API_KEY=... node scripts/email-banc.js --code <dossier de l ancien code> --sortie banc-avant.json
// --code : le dossier dont on charge lib/email-agent.js (l ancien agent pour « avant »).
// --seuls M01,M44 : quelques mails seulement. --budget 2 : plafond USD de ce run.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (nom, defaut = '') => { const i = args.indexOf(`--${nom}`); return i >= 0 && args[i + 1] ? args[i + 1] : defaut; };
const CODE = path.resolve(opt('code', path.join(__dirname, '..')));
const MODELE = opt('modele', '');
const SORTIE = opt('sortie', '');
const SEULS = opt('seuls', '').split(',').map((s) => s.trim()).filter(Boolean);
const BUDGET = Number(opt('budget', '2'));
const PARALLELE = Math.max(1, Math.min(6, Number(opt('parallele', '4'))));
// --debug : chaque appel au modele, sa duree, son statut HTTP, sa fin et ses tokens (jamais la cle).
const DEBUG = args.includes('--debug');
const fetchTrace = async (url, init) => {
  const t0 = Date.now();
  try {
    const r = await fetch(url, init);
    const copie = r.clone();
    copie.json().then((p) => console.log(`  appel ${String(url).split('/').pop()} ${Date.now() - t0} ms, http ${r.status}, fin ${p && p.stop_reason}, sortie ${p && p.usage ? p.usage.output_tokens : '?'} tokens`)).catch(() => console.log(`  appel ${Date.now() - t0} ms, http ${r.status}, corps illisible`));
    return r;
  } catch (e) { console.log(`  appel coupe apres ${Date.now() - t0} ms : ${e && e.name}`); throw e; }
};
const JOUR_ZERO = '2026-11-07'; // un samedi : les fixtures comptent « samedi » depuis ce jour
const INSTANT = Date.parse('2026-11-07T09:00:00Z'); // 10 h a Bruxelles

if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY absente : le banc parle au vrai modele.'); process.exit(2); }
for (const k of ['KIMI_API_KEY', 'MOONSHOT_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'LLM_PROVIDER', 'DATABASE_URL']) delete process.env[k];
process.env.LLM_MAILS_BUDGET_USD = String(BUDGET);
process.env.LLM_MONTHLY_BUDGET_USD = String(BUDGET);
if (MODELE) process.env.ANTHROPIC_MAILS_MODEL = MODELE;

const agent = require(path.join(CODE, 'lib', 'email-agent.js'));
const budget = require(path.join(CODE, 'lib', 'llm-budget.js'));
const nouveau = typeof require(path.join(CODE, 'lib', 'llm-budget.js')).budgetStatus === 'function'
  && fs.existsSync(path.join(CODE, 'lib', 'email-verifications.js'));

const iso = (j) => {
  const n = Number(String(j || '').replace(/^J\+?/i, '')) || 0;
  return new Date(Date.parse(`${JOUR_ZERO}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
};
const cleJour = (date) => `J+${Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${JOUR_ZERO}T12:00:00Z`)) / 86400000)}`;
const STATUTS = { confirmee: 'confirmed', confirmée: 'confirmed', confirmed: 'confirmed', 'en attente': 'pending', en_attente: 'pending', pending: 'pending', annulee: 'cancelled', annulée: 'cancelled', cancelled: 'cancelled' };

function fauxMonde(mail, centerId) {
  const ctx = mail.contexte || {};
  const lignes = [
    ...(ctx.reservationsDuClient || []).map((r) => ({ ...r, email: mail.from })),
    ...(ctx.reservationsDAutres || []),
  ].map((r) => ({
    id: Number(String(r.numero || '').replace(/\D/g, '')) || 1,
    center_id: centerId,
    email: String(r.email || '').toLowerCase(),
    name: r.nom || 'Client Banc',
    phone: r.telephone || '+32470000001',
    date: iso(r.jour),
    heure: r.heure || '15:00',
    pax: Number(r.personnes) || 2,
    label: r.intitule || 'Réservation',
    // Un statut inconnu du banc est une ERREUR du banc, pas une reservation confirmee.
    status: (() => { const s = STATUTS[String(r.statut || 'confirmee').toLowerCase()]; if (!s) throw new Error(`statut inconnu du banc : ${r.statut}`); return s; })(),
    price: r.montant != null ? Number(r.montant) : null,
    channel: 'web',
  }));
  const deps = {
    reel: false,
    query: async (sql, params = []) => {
      const s = String(sql).toLowerCase();
      if (s.includes('from reservations') && s.includes('lower(coalesce(email')) {
        const [centre, email] = params;
        return { rows: lignes.filter((r) => r.center_id === centre && r.email === email) };
      }
      return { rows: [] };
    },
    disponibilite: async (params) => {
      const d = (ctx.disponibilites || {})[cleJour(params.date)];
      if (!d) return { status: 503, json: null };
      if (d.ouvert === false) return { status: 200, json: { ok: false, slots: [], message: d.raison || 'Fermé ce jour-là.' } };
      return { status: 200, json: { ok: true, price: null, slots: (d.heures || []).map((t) => ({ time: t, ok: true })) } };
    },
  };
  return deps;
}

const normal = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[’`]/g, "'")
  .replace(/(\d{1,2})\s*h\s*(\d{2})/g, '$1:$2').replace(/(\d{1,2})\s*h\b/g, '$1:00')
  .replace(/\b(\d):(\d{2})\b/g, '0$1:$2')
  .replace(/\s+/g, ' ');
const chiffres = (t) => String(t || '').replace(/\D/g, '');

function noter(mail, a) {
  const texte = normal(`${a.reply ? a.reply.subject : ''}\n${a.reply ? a.reply.body : ''}`);
  const brutChiffres = chiffres(`${a.reply ? a.reply.subject : ''} ${a.reply ? a.reply.body : ''}`);
  const att = mail.attendu || {};
  const manque = (att.doitContenir || []).filter((m) => !texte.includes(normal(m)));
  const faute = (att.neDoitPasContenir || []).filter((m) => {
    const n = normal(m);
    if (texte.includes(n)) return true;
    // Un telephone ou un numero peut revenir mis en forme autrement.
    const c = chiffres(m);
    return c.length >= 6 && brutChiffres.includes(c);
  });
  const transmis = Boolean(a.alerte) || Boolean(a.question) || a.urgency === 'haute';
  const transmisOk = !att.doitTransmettreALEquipe || transmis;
  return { ok: !manque.length && !faute.length && transmisOk, manque, faute, transmisOk, repli: a.provider === 'rules' };
}

async function unMail(mail) {
  const centerId = mail.centre || 'libramont';
  const deps = fauxMonde(mail, centerId);
  const t0 = Date.now();
  let a;
  try {
    a = await agent.analyzeEmail({
      from: mail.from, subject: mail.subject, body: mail.body, centerId, deps,
      ...(nouveau ? { instant: INSTANT } : {}),
      ...(DEBUG ? { fetchImpl: fetchTrace } : {}),
    });
  } catch (error) {
    a = { provider: 'erreur', reply: { subject: '', body: '' }, erreur: String(error && error.message).slice(0, 200) };
  }
  const ms = Date.now() - t0;
  return { id: mail.id, famille: mail.famille, centre: centerId, ms, note: noter(mail, a), analyse: {
    provider: a.provider, modele: a.modele || '', repli: a.repli || '', horsSources: a.horsSources || [], intent: a.intent, urgency: a.urgency,
    alerte: a.alerte || '', question: a.question || '', reply: a.reply, verifications: a.verifications || null, erreur: a.erreur || '',
  } };
}

(async () => {
  let mails = require('./fixtures/banc-mails.json');
  if (SEULS.length) mails = mails.filter((m) => SEULS.includes(m.id));
  const resultats = [];
  let i = 0;
  const poste = nouveau ? 'mails' : 'commun';
  async function ouvrier() {
    while (i < mails.length) {
      const mail = mails[i++];
      if (budget.isBudgetExhausted(poste)) { resultats.push({ id: mail.id, famille: mail.famille, saute: 'budget' }); continue; }
      const r = await unMail(mail);
      resultats.push(r);
      process.stdout.write(`${r.note.ok ? '.' : 'x'}`);
    }
  }
  await Promise.all(Array.from({ length: PARALLELE }, ouvrier));
  resultats.sort((a, b) => (a.id < b.id ? -1 : 1));
  const faits = resultats.filter((r) => r.note);
  const reussis = faits.filter((r) => r.note.ok);
  const replis = faits.filter((r) => r.note.repli);
  const ms = faits.map((r) => r.ms).sort((a, b) => a - b);
  const cout = budget.getMonthlySpend(poste);
  const parFamille = {};
  for (const r of faits) {
    parFamille[r.famille] = parFamille[r.famille] || { ok: 0, n: 0 };
    parFamille[r.famille].n += 1;
    if (r.note.ok) parFamille[r.famille].ok += 1;
  }
  const bilan = {
    code: nouveau ? 'nouveau' : 'avant',
    modele: MODELE || (nouveau ? 'claude-haiku-5-5' : 'claude-haiku-4-5'),
    mails: faits.length,
    reussis: reussis.length,
    replis: replis.length,
    sautes: resultats.length - faits.length,
    msMedian: ms[Math.floor(ms.length / 2)] || 0,
    msP90: ms[Math.floor(ms.length * 0.9)] || 0,
    coutUsd: Math.round(cout * 10000) / 10000,
    parFamille,
    echecs: faits.filter((r) => !r.note.ok).map((r) => `${r.id} ${r.famille}${r.note.repli ? ' [repli' + (r.analyse.repli ? ':' + r.analyse.repli : '') + ']' : ''}${r.note.manque.length ? ' manque=' + r.note.manque.join('|') : ''}${r.note.faute.length ? ' FAUTE=' + r.note.faute.join('|') : ''}${r.note.transmisOk ? '' : ' non-transmis'}`),
  };
  console.log(`\n${JSON.stringify(bilan, null, 1)}`);
  if (SORTIE) fs.writeFileSync(SORTIE, JSON.stringify({ bilan, resultats }, null, 1));
})().catch((error) => { console.error('banc CRASH:', error && (error.stack || error.message)); process.exit(1); });
