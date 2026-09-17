// LES EVENEMENTS DU FOURNISSEUR D ENVOI (2026-09-16, migration 0047).
//
// Resend signe et envoie, pour chacun de NOS messages : sent, delivered,
// delivery_delayed, opened, clicked, bounced, complained, failed. Jusqu ici le
// webhook les acquittait sans les lire : la page Emails disait « envoye » et
// plus rien. Ce module les ecrit dans `email_events` et reporte ce qui compte
// sur la ligne `communications` (remis, ouvert, clique, rebond, plainte).
//
// TROIS REGLES :
//   1. IDEMPOTENT PAR CLE D EVENEMENT. Svix rejoue une livraison des qu une
//      reponse tarde : la meme cle (svix-id) n insere qu une fois, et une
//      relivraison ne touche AUCUN compteur. Sans cela, une ouverture comptee
//      deux fois ferait dire « le client a ouvert deux fois ».
//   2. JAMAIS D ADRESSE IP. Le clic porte l adresse du client chez le
//      fournisseur ; on garde le lien, le navigateur et l heure, rien d autre.
//   3. UN EVENEMENT SANS MESSAGE CONNU EST GARDE QUAND MEME (communication
//      nulle, centre vide) : il prouve que le webhook parle, ce qui est la
//      premiere question qu on se pose quand rien ne remonte.
//
// Testable sans base : `query` est injecte.
'use strict';

const crypto = require('crypto');

const TYPES_ACCEPTES = new Set(['sent', 'delivered', 'delivery_delayed', 'opened', 'clicked', 'bounced', 'complained', 'failed']);

// La cle d idempotence : l identifiant de livraison du fournisseur (svix-id),
// sinon une empreinte du type, du mail et de l instant.
function cleDEvenement(entetes, type, data) {
  const e = entetes && typeof entetes === 'object' ? entetes : {};
  const id = String(e['svix-id'] || e['webhook-id'] || '').trim();
  if (id) return id;
  const d = data && typeof data === 'object' ? data : {};
  const empreinte = `${String(type || '').toLowerCase()}|${String(d.email_id || d.id || '')}|${String(d.created_at || '')}`;
  return crypto.createHash('sha256').update(empreinte).digest('hex');
}

function typeNormalise(type) {
  return String(type || '').trim().toLowerCase().replace(/^email\./, '');
}

function instant(valeur) {
  const t = Date.parse(String(valeur || ''));
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString();
}

function court(valeur, max) {
  return String(valeur || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Ce qu on garde de l evenement, par type. Le clic est ECRIT champ par champ :
// c est ce qui garantit que l adresse IP ne passe jamais, meme si le
// fournisseur ajoute un champ demain.
function donneesDeLEvenement(type, data) {
  const d = data && typeof data === 'object' ? data : {};
  if (type === 'clicked') {
    const clic = d.click && typeof d.click === 'object' ? d.click : {};
    return {
      link: court(clic.link, 500),
      userAgent: court(clic.userAgent, 200),
      timestamp: court(clic.timestamp, 40),
    };
  }
  if (type === 'bounced') {
    const rebond = d.bounce && typeof d.bounce === 'object' ? d.bounce : {};
    return { type: court(rebond.type || rebond.subType, 40), message: court(rebond.message, 300) };
  }
  if (type === 'failed') {
    const echec = d.failed && typeof d.failed === 'object' ? d.failed : {};
    return { reason: court(echec.reason || d.reason || d.error, 300) };
  }
  if (type === 'delivery_delayed') return { reason: court(d.reason, 300) };
  return {};
}

async function enregistrerEvenementFournisseur(query, { type, createdAt = null, data = null, eventKey = '' } = {}) {
  const t = typeNormalise(type);
  if (!TYPES_ACCEPTES.has(t)) return { ok: true, ignored: t || 'inconnu' };
  const d = data && typeof data === 'object' ? data : {};
  const emailId = String(d.email_id || d.id || '').trim();
  const occurred = instant(createdAt || d.created_at);
  const cle = String(eventKey || '').trim() || cleDEvenement({}, t, d);

  // Le message concerne : NOS envois seulement. Un identifiant de fournisseur
  // n est pas borne par centre (il est unique chez lui), le centre se lit sur
  // la ligne trouvee.
  let message = null;
  if (emailId) {
    const trouve = await query(
      `select id, center_id, status, recipient from communications
       where provider_message_id = $1 and direction = 'outbound'
       order by created_at desc limit 1;`,
      [emailId],
    );
    message = trouve.rows && trouve.rows[0] ? trouve.rows[0] : null;
  }
  const details = donneesDeLEvenement(t, d);
  const insertion = await query(
    `insert into email_events (center_id, communication_id, provider, provider_email_id, event_key, event_type, occurred_at, data)
     values ($1, $2, 'resend', $3, $4, $5, $6, $7::jsonb)
     on conflict (event_key) do nothing
     returning id;`,
    [message ? String(message.center_id || '') : '', message ? Number(message.id) : null, emailId, cle, t, occurred, JSON.stringify(details)],
  );
  const inseree = Number(insertion.rowCount !== undefined ? insertion.rowCount : (insertion.rows || []).length) > 0;
  const communicationId = message ? Number(message.id) : null;
  if (!inseree) return { ok: true, deduped: true, communicationId, type: t };
  if (!message) return { ok: true, deduped: false, communicationId: null, type: t };

  const id = Number(message.id);
  if (t === 'sent') {
    const messageId = String(d.message_id || '').trim();
    if (messageId) {
      await query("update communications set message_id = $2 where id = $1 and coalesce(message_id, '') = '';", [id, messageId]);
    }
  } else if (t === 'delivered') {
    await query(
      `update communications
       set delivered_at = coalesce(delivered_at, $2::timestamptz),
           status = case when status = 'sent' then 'delivered' else status end
       where id = $1;`,
      [id, occurred],
    );
  } else if (t === 'opened') {
    await query(
      'update communications set opened_at = coalesce(opened_at, $2::timestamptz), open_count = open_count + 1 where id = $1;',
      [id, occurred],
    );
  } else if (t === 'clicked') {
    await query(
      'update communications set clicked_at = coalesce(clicked_at, $2::timestamptz), click_count = click_count + 1 where id = $1;',
      [id, occurred],
    );
  } else if (t === 'bounced') {
    const detail = [details.type, details.message].filter(Boolean).join(' : ');
    await query(
      `update communications
       set bounced_at = coalesce(bounced_at, $2::timestamptz),
           status = case when status in ('sent', 'delivered') then 'failed' else status end,
           last_error = $3
       where id = $1;`,
      [id, occurred, court(`Adresse en erreur (bounce)${detail ? ` : ${detail}` : ''}`, 300)],
    );
  } else if (t === 'complained') {
    await query('update communications set complained_at = coalesce(complained_at, $2::timestamptz) where id = $1;', [id, occurred]);
    // Une plainte est un retrait de la liste marketing, decide par le client
    // lui-meme. Fail-soft : la plainte est deja enregistree, une liste
    // illisible ne doit pas faire rejouer le webhook.
    const adresse = String(message.recipient || '').trim().toLowerCase();
    const centre = String(message.center_id || '').trim();
    if (adresse && centre) {
      try {
        await query(
          `insert into marketing_suppressions (center_id, email, source, reason)
           values ($1, $2, 'complaint', $3)
           on conflict (center_id, lower(email)) do nothing;`,
          [centre, adresse, 'Plainte (spam) remontee par le fournisseur'],
        );
      } catch (error) {
        console.warn(`email-events: suppression apres plainte non ecrite (${String((error && error.message) || error).slice(0, 120)})`);
      }
    }
  } else if (t === 'failed') {
    await query(
      `update communications
       set status = case when status in ('sent', 'delivered', 'queued', 'processing') then 'failed' else status end,
           last_error = $2
       where id = $1;`,
      [id, court(`Echec signale par le fournisseur${details.reason ? ` : ${details.reason}` : ''}`, 300)],
    );
  }
  return { ok: true, deduped: false, communicationId: id, type: t };
}

module.exports = {
  TYPES_ACCEPTES,
  cleDEvenement,
  enregistrerEvenementFournisseur,
  __test: { donneesDeLEvenement, typeNormalise },
};
