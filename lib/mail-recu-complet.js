'use strict';
// LE MAIL RECU EN ENTIER (2026-11-12, Ansar : « on doit pouvoir tout voir, les
// images, les liens, tout beau tout propre »).
//
// POURQUOI. A la reception, Pinlane ne gardait que la version texte du mail :
// les images, les liens et la mise en forme d un formulaire de site
// disparaissaient, et une demande lue dans la console devenait un bloc de mots
// colles. Resend garde le mail recu, sa version HTML et ses pieces jointes : on
// va les lire quand la conversation s ouvre.
//
// CE QUE CA RENVOIE, pour UN mail recu du centre de la session :
//   - la version HTML : celle gardee a la reception (payload.htmlBody), sinon
//     lue chez Resend puis gardee dans la ligne, pour ne la demander qu une fois ;
//   - les pieces jointes, images collees dans le mail comprises : leur liste se
//     garde, leurs liens de telechargement se relisent a chaque ouverture, car
//     Resend ne les signe que pour une heure.
// Rien ne part chez personne : une lecture chez Resend, une ecriture dans la
// ligne du mail lui-meme.
//
// TESTABLE SANS BASE NI RESEAU : `query` et `fetchImpl` en parametres.

const MAX_HTML = 512 * 1024;

// La meme cle que la reception (api/inbound-email.js) : celle d envoi reste
// restreinte a l envoi.
function cleDeLecture() {
  return process.env.RESEND_INBOUND_API_KEY || process.env.RESEND_API_KEY || '';
}

async function lireChezResend(chemin, fetchImpl) {
  const cle = cleDeLecture();
  if (!cle) {
    const error = new Error('aucune cle de lecture');
    error.code = 'sans-cle';
    throw error;
  }
  const reponse = await fetchImpl(`https://api.resend.com/emails/receiving/${chemin}`, {
    headers: { Authorization: `Bearer ${cle}` },
  });
  if (!reponse || !reponse.ok) {
    const error = new Error(`Resend repond ${reponse ? reponse.status : 'rien'}`);
    error.code = reponse && reponse.status === 404 ? 'introuvable' : 'refus';
    throw error;
  }
  return reponse.json();
}

function pieceJointe(brut = {}) {
  return {
    id: String(brut.id || '').slice(0, 120),
    nom: String(brut.filename || '').slice(0, 200),
    taille: Number(brut.size || 0) || 0,
    type: String(brut.content_type || '').toLowerCase().slice(0, 120),
    enLigne: String(brut.content_disposition || '').toLowerCase() === 'inline',
    contentId: String(brut.content_id || '').replace(/^<|>$/g, '').slice(0, 200),
  };
}

// Une adresse de telechargement ne sort que si elle est signee sur le domaine de
// Resend : une reponse alteree ne peut pas faire ouvrir n importe quel lien.
function lienDeResend(url) {
  const texte = String(url || '');
  return /^https:\/\/([a-z0-9-]+\.)*resend\.(com|dev)\//i.test(texte) ? texte : '';
}

async function lireMailRecuComplet(query, { centerId, communicationId, fetchImpl = fetch } = {}) {
  const centre = String(centerId || '').trim();
  const id = Number(communicationId);
  if (!centre || !Number.isInteger(id) || id <= 0) return null;
  const result = await query(
    `select id, payload from communications
     where id = $1 and center_id = $2 and direction = 'inbound' limit 1;`,
    [id, centre],
  );
  const row = result.rows && result.rows[0];
  if (!row) return null;
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const emailId = payload.provider === 'resend' ? String(payload.providerEmailId || '').trim() : '';
  const maj = {};
  let raison = '';

  let html = String(payload.htmlBody || '');
  if (!html && emailId && !payload.htmlAbsent) {
    try {
      const lu = await lireChezResend(encodeURIComponent(emailId), fetchImpl);
      html = String((lu && lu.html) || '');
      if (!html) maj.htmlAbsent = true;
      else if (html.length <= MAX_HTML) maj.htmlBody = html;
    } catch (error) {
      raison = error.code || 'refus';
    }
  }

  let pieces = Array.isArray(payload.piecesJointes) ? payload.piecesJointes.map(pieceJointe) : null;
  let liens = [];
  if (emailId && (pieces === null || pieces.length)) {
    try {
      const lu = await lireChezResend(`${encodeURIComponent(emailId)}/attachments`, fetchImpl);
      const liste = Array.isArray(lu && lu.data) ? lu.data : (Array.isArray(lu) ? lu : []);
      pieces = liste.map(pieceJointe);
      if (!Array.isArray(payload.piecesJointes)) maj.piecesJointes = pieces;
      liens = liste.map((brut) => ({ id: String(brut.id || ''), url: lienDeResend(brut.download_url), expiresAt: brut.expires_at || null }));
    } catch (error) {
      raison = raison || error.code || 'refus';
    }
  }

  if (Object.keys(maj).length) {
    await query(
      `update communications set payload = coalesce(payload, '{}'::jsonb) || $3::jsonb
       where id = $1 and center_id = $2 and direction = 'inbound';`,
      [id, centre, JSON.stringify(maj)],
    );
  }

  const lienDe = new Map(liens.map((lien) => [lien.id, lien]));
  return {
    html,
    piecesJointes: (pieces || []).map((piece) => {
      const lien = lienDe.get(piece.id) || {};
      return { ...piece, url: lien.url || '', expiresAt: lien.expiresAt || null };
    }),
    raison,
  };
}

module.exports = { lireMailRecuComplet, MAX_HTML, pieceJointe, __test: { lienDeResend } };
