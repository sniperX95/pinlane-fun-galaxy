// LE CANAL DE GARDE (2026-11-05).
//
// Ansar veut etre prevenu tout de suite, et le mail n est pas un canal de panne
// (workers/sonde-prod/sonde.mjs, journal 182). Le meme bot Telegram que la sonde,
// cette fois depuis l application : elle seule sait qu un client vient de rater sa
// reservation. La sonde, elle, reste dehors et voit l application tomber.
//
// Trois regles :
//   - aucune donnee personnelle ne part : ni nom, ni telephone, ni e-mail. Le detail
//     se lit dans la Tour de controle ;
//   - ne jamais lever et ne jamais attendre longtemps : ce message accompagne une
//     demande de client qui a deja ses propres soucis ;
//   - sans canal, rien ne part et la Tour de controle le dit.
'use strict';

const DELAI_MS = 4000;
const FENETRE_MS = 10 * 60_000;

const canalBranche = (env = process.env) => Boolean(String(env.TELEGRAM_JETON || '').trim() && String(env.TELEGRAM_CHAT || '').trim());

async function envoyerTelegram(texte, { env = process.env, fetcher = fetch } = {}) {
  if (!canalBranche(env)) return { ok: false, raison: 'canal absent' };
  const api = env.TELEGRAM_API || 'https://api.telegram.org';
  try {
    const reponse = await fetcher(`${api}/bot${String(env.TELEGRAM_JETON).trim()}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: String(env.TELEGRAM_CHAT).trim(), text: String(texte).slice(0, 3500), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(DELAI_MS),
    });
    if (reponse.body && reponse.body.cancel) await reponse.body.cancel().catch(() => {});
    return reponse.ok ? { ok: true } : { ok: false, raison: `Telegram ${reponse.status}` };
  } catch (error) {
    return { ok: false, raison: error && error.name === 'TimeoutError' ? 'délai dépassé' : 'injoignable' };
  }
}

// Une tempete de pannes ne fait pas une tempete de messages : une alerte par sujet
// et par fenetre, sur chaque instance. La memoire suffit : si la base tombe, c est
// justement elle qu on ne peut plus lire.
const dits = new Map();
function dejaDit(cle, fenetreMs, maintenant) {
  for (const [c, fin] of dits) if (fin <= maintenant) dits.delete(c);
  if (dits.has(cle)) return true;
  dits.set(cle, maintenant + fenetreMs);
  return false;
}

async function alerter(cle, texte, { fenetreMs = FENETRE_MS, maintenant = Date.now(), env = process.env, fetcher = fetch } = {}) {
  if (dejaDit(cle, fenetreMs, maintenant)) return { ok: true, deja: true };
  const r = await envoyerTelegram(texte, { env, fetcher });
  if (!r.ok) {
    // Un message perdu se redit au prochain incident, et la cause se lit dans les journaux.
    dits.delete(cle);
    console.error('[garde] alerte non partie', r.raison);
  }
  return r;
}

const oublierLesAlertes = () => dits.clear();

module.exports = { alerter, canalBranche, envoyerTelegram, oublierLesAlertes };
