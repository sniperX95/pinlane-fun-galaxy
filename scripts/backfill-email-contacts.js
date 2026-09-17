// RATTRAPAGE : le vrai client des mails deja recus (2026-09-17).
//
// Meme regle qu au fil de l eau (lib/email-contact.js) : un mail recu par le
// formulaire du site etait attribue a l adresse technique du site. Pour chaque
// mail recu, on recalcule le client ; s il differe de l expediteur enregistre,
// le mail et sa conversation passent au client. L expediteur d origine reste
// dans payload.from (et payload.relais) : rien n est perdu.
//
// Usage : node --env-file=.env scripts/backfill-email-contacts.js          (simulation)
//         node --env-file=.env scripts/backfill-email-contacts.js --apply  (ecrit, en transaction)
// N imprime jamais une adresse en clair : initiale et domaine seulement.
'use strict';

const { Client } = require('pg');
const { adresseDuClient } = require('../lib/email-contact');
const { getCenter } = require('../lib/ops-knowledge');

const APPLIQUER = process.argv.includes('--apply');
const masque = (adresse) => String(adresse || '').replace(/^(.)[^@]*(@.*)$/, '$1***$2');

function adressePubliqueDuCentre(centerId) {
  try {
    return String((getCenter(centerId).publicInfo || {}).email || '');
  } catch (erreur) {
    return '';
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL manquant (lancer avec --env-file=.env).');
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const lignes = (await client.query(
      `select id, center_id, recipient, body, payload, thread_id from communications
       where channel = 'email' and direction = 'inbound' order by id asc;`,
    )).rows;
    const plan = [];
    for (const ligne of lignes) {
      const payload = ligne.payload && typeof ligne.payload === 'object' ? ligne.payload : {};
      const contact = adresseDuClient({
        from: payload.from || ligne.recipient,
        fromName: payload.fromName || '',
        replyTo: payload.replyTo || '',
        text: payload.textBody || ligne.body || '',
        to: payload.to || '',
        centerEmail: adressePubliqueDuCentre(ligne.center_id),
      });
      const actuel = String(ligne.recipient || '').trim().toLowerCase();
      if (contact.source === 'expediteur' || !contact.email || contact.email === actuel) continue;
      const analyse = payload.analysis && typeof payload.analysis === 'object' ? payload.analysis : {};
      plan.push({
        id: Number(ligne.id),
        centre: ligne.center_id,
        ancien: actuel,
        client: contact.email,
        nom: String(contact.name || analyse.clientName || '').trim().slice(0, 200),
        source: contact.source,
        relais: contact.relais,
        fil: ligne.thread_id ? Number(ligne.thread_id) : null,
      });
    }
    console.log(`mails recus : ${lignes.length} ; a rattacher a leur vrai client : ${plan.length}`);
    for (const p of plan) console.log(`  #${p.id} ${p.centre} ${masque(p.ancien)} -> ${masque(p.client)} (${p.source}${p.nom ? ', nom connu' : ''}) fil ${p.fil || 'aucun'}`);
    if (!APPLIQUER) {
      console.log('SIMULATION : rien n est ecrit (ajouter --apply)');
      return;
    }
    await client.query('BEGIN');
    let fils = 0;
    for (const p of plan) {
      await client.query(
        `update communications
         set recipient = $2,
             payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('clientEmail', $2::text, 'contactName', $3::text, 'contactSource', $4::text, 'relais', $5::text)
         where id = $1 and direction = 'inbound';`,
        [p.id, p.client, p.nom, p.source, p.relais],
      );
      if (p.fil) {
        const maj = await client.query(
          `update email_threads
           set contact_email = $2,
               contact_name = case when $3 <> '' then $3 else contact_name end,
               updated_at = now()
           where id = $1 and lower(contact_email) = $4;`,
          [p.fil, p.client, p.nom, p.ancien],
        );
        fils += Number(maj.rowCount || 0);
      }
    }
    await client.query('COMMIT');
    console.log(`APPLIQUE : ${plan.length} mail(s) et ${fils} conversation(s) rattaches a leur vrai client`);
  } catch (erreur) {
    try { await client.query('ROLLBACK'); } catch (e) { /* rien a annuler */ }
    throw erreur;
  } finally {
    await client.end();
  }
}

main().catch((erreur) => { console.error('ECHEC', erreur.message); process.exit(1); });
