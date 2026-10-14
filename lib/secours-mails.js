// LES MAILS DE SECOURS (2026-10-05).
//
// Movsar : « si Pinlane crash il faut qu on ait acces par mail ou par fichier
// rempli complete parfaitement », « toutes les demandes sur mesure doivent etre
// expliquees et envoyees par mail aussi pour rien oublier ». Ces mails ne sont
// PAS des demandes d action : ce sont des COPIES, completes, lisibles sans
// Pinlane, qui partent vers une boite de secours (pas vers l accueil, pour ne
// deranger personne). Chaque mail se suffit : si la base disparait, la boite de
// secours garde la reservation entiere, champ par champ.
//
// Ce module FABRIQUE les mails (objet, HTML, texte). Il n envoie rien : l envoi
// passe par la file des communications (lib/ops-communications), comme tous
// les autres mails, ou directement par Resend quand la base est tombee.
'use strict';

const STATUTS = {
  pending: 'En attente', confirmed: 'Confirmée', arrived: 'Arrivé', paid: 'Payé',
  cancelled: 'Annulée', done: 'Terminée', completed: 'Terminée', no_show: 'Absent',
};
const VALIDATIONS = { staff_review: 'À valider par l’équipe', confirmed: 'Confirmée automatiquement' };
const CANAUX = { public: 'En ligne (formulaire)', staff: 'Comptoir / téléphone', quick: 'Réservation rapide' };
const EVENEMENTS = {
  nouvelle: { mot: 'Nouvelle réservation', ton: '#0f7b3c' },
  modifiee: { mot: 'Réservation modifiée', ton: '#0761d1' },
  annulee: { mot: 'Réservation annulée', ton: '#cb2a2f' },
  archivee: { mot: 'Réservation supprimée (archivée)', ton: '#cb2a2f' },
  restauree: { mot: 'Réservation restaurée', ton: '#0f7b3c' },
};
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// Une adresse RESERVEE (RFC 2606) n a pas de boite derriere : rien n y part.
const NON_ROUTABLE = /@[^@]*\.(test|invalid|example|localhost)$/i;
const ADRESSE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ligne = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

function dateLongue(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return `${JOURS[d.getUTCDay()]} ${Number(m[3])} ${MOIS[Number(m[2]) - 1]} ${m[1]}`;
}
function dateCourte(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return `${JOURS[d.getUTCDay()].slice(0, 3)}. ${m[3]}/${m[2]}`;
}
function montant(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return `${n.toLocaleString('fr-BE', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })} €`;
}
function horodatage(instant) {
  const d = instant ? new Date(instant) : new Date();
  if (Number.isNaN(d.getTime())) return String(instant || '');
  return d.toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// LES DESTINATAIRES : la boite de secours du centre (Etablissement), sinon la
// variable PINLANE_SECOURS_EMAILS (liste separee par des virgules). Jamais une
// adresse inventee, jamais une adresse non routable, jamais un doublon.
function destinatairesSecours(center, env = process.env) {
  const depuisCentre = center && center.secours && Array.isArray(center.secours.emails) ? center.secours.emails : [];
  const depuisEnv = String(env.PINLANE_SECOURS_EMAILS || '').split(/[,;\s]+/);
  const vus = new Set();
  const out = [];
  for (const brut of [...depuisCentre, ...depuisEnv]) {
    const a = String(brut || '').trim().toLowerCase();
    if (!a || !ADRESSE.test(a) || NON_ROUTABLE.test(a) || vus.has(a)) continue;
    vus.add(a);
    out.push(a);
  }
  return out;
}

// LE PROGRAMME, heure par heure, depuis le plan du moteur (ce qui est reellement
// bloque), sinon depuis le programme achete. Une etape libre (flexible) n a
// pas d heure : sa fenetre est celle de toute la visite, elle se dit « à leur
// rythme » (2026-10-14). Les parties de laser que l equipe placera se disent.
function programmeLignes(r, nomActivite) {
  const blocs = (r && r.opsPlan && Array.isArray(r.opsPlan.timeline) ? r.opsPlan.timeline : [])
    .filter((b) => b && b.type === 'activity');
  if (blocs.length) {
    const lignes = blocs.map((b) => {
      const quoi = b.label || nomActivite(b.activityId);
      if (b.flexible === true) return { heure: '', quoi: `${quoi} · à leur rythme` };
      const ou = Array.isArray(b.lanes) && b.lanes.length
        ? ` · piste${b.lanes.length > 1 ? 's' : ''} ${b.lanes.join(', ')}`
        : (b.requiredLanes ? ` · ${b.requiredLanes} piste${b.requiredLanes > 1 ? 's' : ''}` : '');
      const qui = b.players ? ` · ${b.players} joueur${b.players > 1 ? 's' : ''}` : '';
      const vague = b.groupWaveCount > 1 ? ` · vague ${b.groupWaveIndex}/${b.groupWaveCount}` : '';
      return { heure: `${b.startTime || '?'}${b.endTime ? ` → ${b.endTime}` : ''}`, quoi: `${quoi}${ou}${qui}${vague}` };
    });
    const passe = (r.opsPlan && r.opsPlan.laserPassPlan) || {};
    const reste = (Array.isArray(passe.pendingPasses) ? passe.pendingPasses : []).map((x) => Number(x && x.countIndex)).filter((k) => k > 0);
    const total = Math.trunc(Number(passe.totalGames) || 0);
    if (reste.length) lignes.push({ heure: '', quoi: `${nomActivite('laser_game')} · partie${reste.length > 1 ? 's' : ''} ${reste.join(' et ')}${total ? ` sur ${total}` : ''} · à placer sur place` });
    return lignes;
  }
  const items = r && r.program && Array.isArray(r.program.items) ? r.program.items : [];
  return items.map((it) => {
    const details = [
      it.duration ? `${it.duration} h` : '', it.minutes && !it.duration ? `${it.minutes} min` : '',
      it.games ? `${it.games} partie${it.games > 1 ? 's' : ''}` : '', it.laneCount ? `${it.laneCount} piste${it.laneCount > 1 ? 's' : ''}` : '',
      it.participants ? `${it.participants} joueurs` : '',
    ].filter(Boolean).join(' · ');
    return { heure: '', quoi: `${it.name || nomActivite(it.activityId)}${details ? ` · ${details}` : ''}` };
  });
}

function nomActiviteParDefaut(id) {
  try { const a = require('./ops-knowledge').getActivity(id); return (a && (a.name || a.label)) || id; } catch (e) { return id || ''; }
}
function nomFormuleParDefaut(id, centerId) {
  try { const f = require('./ops-knowledge').getFormula(id, centerId); return (f && f.name) || id; } catch (e) { return id || ''; }
}

// Le gabarit commun : une table simple, sans image ni lien externe, lisible
// dans Gmail, Outlook et sur telephone. Les lignes vides ne s ecrivent pas.
// « anniversaire » -> « Anniversaire », « FORMULE 4 » -> « Formule 4 » : un nom
// ecrit en capitales dans le catalogue ne crie pas dans un mail.
function majuscule(t) { const v = String(t || '').trim(); return v ? v.charAt(0).toUpperCase() + v.slice(1) : ''; }
function lisible(t) { const v = String(t || '').trim(); return /^[^a-zà-ÿ]+$/.test(v) && /[A-Z]{3}/.test(v) ? v.charAt(0) + v.slice(1).toLowerCase() : v; }

function gabarit({ titre, ton, sousTitre, sections, pied }) {
  const corps = sections.filter(Boolean).map((s) => {
    const lignesHtml = (s.lignes || []).filter((l) => l && ligne(l[1]) !== '').map(([k, v]) => `<tr><td style="width:170px;padding:6px 12px 6px 0;color:#555;font-size:13px;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;color:#111;font-size:14px;vertical-align:top">${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('');
    const texteHtml = s.texte ? `<p style="margin:6px 0 0;color:#111;font-size:14px;line-height:1.5;white-space:pre-wrap">${esc(s.texte)}</p>` : '';
    if (!lignesHtml && !texteHtml) return '';
    return `<h2 style="margin:22px 0 6px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#555">${esc(s.titre)}</h2>${lignesHtml ? `<table role="presentation" style="border-collapse:collapse;width:100%;table-layout:fixed">${lignesHtml}</table>` : ''}${texteHtml}`;
  }).join('');
  return `<!doctype html><html lang="fr"><body style="margin:0;padding:0;background:#f3f3f4"><div style="max-width:640px;margin:0 auto;padding:24px 16px;font-family:-apple-system,Segoe UI,Arial,sans-serif">
<div style="background:#fff;border:1px solid #ddd;border-radius:10px;padding:22px 22px 18px">
<div style="display:inline-block;padding:3px 9px;border-radius:6px;background:${ton};color:#fff;font-size:12px;font-weight:700;letter-spacing:.02em">COPIE DE SECOURS</div>
<h1 style="margin:12px 0 2px;font-size:20px;color:#111">${esc(titre)}</h1>
${sousTitre ? `<p style="margin:0;color:#444;font-size:14px">${esc(sousTitre)}</p>` : ''}
${corps}
</div>
<p style="margin:14px 4px 0;color:#666;font-size:12px;line-height:1.5">${esc(pied)}</p>
</div></body></html>`;
}
function texteBrut({ titre, sousTitre, sections, pied }) {
  const parts = ['COPIE DE SECOURS PINLANE', titre, sousTitre || ''];
  for (const s of sections.filter(Boolean)) {
    const l = (s.lignes || []).filter((x) => x && ligne(x[1]) !== '').map(([k, v]) => `${k} : ${String(v)}`);
    if (!l.length && !s.texte) continue;
    parts.push('', s.titre.toUpperCase(), ...l, ...(s.texte ? [s.texte] : []));
  }
  parts.push('', pied);
  return parts.filter((x, i) => x !== '' || i > 2).join('\n');
}

// UNE RESERVATION, ENTIERE. evenement : nouvelle | modifiee | annulee | archivee | restauree.
function mailCopieReservation(r, { evenement = 'nouvelle', centre = null, avant = null, par = '', nomActivite = nomActiviteParDefaut, nomFormule = nomFormuleParDefaut, instant = null } = {}) {
  const ev = EVENEMENTS[evenement] || EVENEMENTS.nouvelle;
  const centreNom = (centre && centre.name) || r.centerId || '';
  const formule = r.formuleId ? nomFormule(r.formuleId, r.centerId) : '';
  const offre = lisible(formule || ligne(r.label) || (r.type === 'visite' ? 'Visite à la carte' : r.type || ''));
  const arrivee = r.opsPlan && r.opsPlan.arrivalTime ? r.opsPlan.arrivalTime : '';
  const prog = programmeLignes(r, nomActivite);
  const prix = Number(r.price);
  const ref = Number(r.basePrice);
  const extras = Array.isArray(r.extras) ? r.extras.filter((x) => x && (x.name || x.label)) : [];
  // Ce qui a change, quand on le sait : l oeil du lecteur va droit a la difference.
  const changements = [];
  if (avant && typeof avant === 'object') {
    const champs = [['date', 'Date'], ['startTime', 'Heure'], ['pax', 'Personnes'], ['name', 'Nom'], ['phone', 'Téléphone'], ['email', 'E-mail'], ['price', 'Prix'], ['status', 'Statut'], ['paymentMethod', 'Paiement'], ['notes', 'Notes'], ['formuleId', 'Formule']];
    for (const [k, mot] of champs) {
      const a = avant[k]; const b = r[k];
      if (String(a == null ? '' : a) !== String(b == null ? '' : b)) changements.push([mot, `${a == null || a === '' ? '(vide)' : a} → ${b == null || b === '' ? '(vide)' : b}`]);
    }
  }
  const sections = [
    changements.length ? { titre: 'Ce qui a changé', lignes: changements } : null,
    { titre: 'Client', lignes: [['Nom', r.name], ['Téléphone', r.phone], ['E-mail', r.email], ['Occasion', majuscule(r.occasion)], ['Accompagnants', r.companions ? `${r.companions}` : '']] },
    { titre: 'Visite', lignes: [['Date', dateLongue(r.date)], ['Heure', r.startTime], ['Arrivée conseillée', arrivee && arrivee !== r.startTime ? arrivee : ''], ['Personnes', r.pax], ['Offre', offre], ['Pistes', Array.isArray(r.lanes) && r.lanes.length ? r.lanes.join(', ') : '']] },
    prog.length ? { titre: 'Programme', lignes: prog.map((p) => [p.heure || '•', p.quoi]) } : null,
    { titre: 'Prix et paiement', lignes: [
      ['Prix', Number.isFinite(prix) ? `${montant(prix)}${Number.isFinite(ref) && ref > 0 && Math.round(ref * 100) !== Math.round(prix * 100) ? ` (tarif de référence ${montant(ref)})` : ''}` : ''],
      ['Extras', extras.map((x) => `${x.name || x.label}${x.price != null ? ` ${montant(x.price)}` : ''}`).join(', ')],
      ['Statut', STATUTS[r.status] || r.status], ['Validation', VALIDATIONS[r.validationStatus] || ''], ['Paiement', r.paymentMethod],
    ] },
    r.notes ? { titre: 'Notes', texte: String(r.notes).split('\n').filter((l) => !l.startsWith('[equipe] ')).join('\n') } : null,
    { titre: 'Dossier', lignes: [['Référence', r.id ? `#${r.id}` : ''], ['Centre', centreNom], ['Canal', CANAUX[r.channel] || r.channel], ['Par', par], ['Enregistré le', horodatage(instant || r.updatedAt || r.createdAt)]] },
  ];
  const titre = `${ev.mot} · ${r.name || 'Sans nom'}`;
  const sousTitre = `${dateLongue(r.date)} à ${r.startTime || '?'} · ${r.pax || '?'} pers. · ${offre}${centreNom ? ` · ${centreNom}` : ''}`;
  const pied = 'Copie automatique envoyée par Pinlane à la boîte de secours du centre. Elle contient toute la réservation, de quoi accueillir le groupe même si Pinlane ne répond plus. Inutile d’y répondre.';
  const subject = `[Secours] ${ev.mot} · ${dateCourte(r.date)} ${r.startTime || ''} · ${r.name || 'Sans nom'} · ${r.pax || '?'} pers.`;
  return { subject, html: gabarit({ titre, ton: ev.ton, sousTitre, sections, pied }), text: texteBrut({ titre, sousTitre, sections, pied }) };
}

// UNE DEMANDE SUR MESURE, EXPLIQUEE : tout ce que le client a choisi et ecrit.
function mailCopieDemandeSurMesure(lead, { centre = null, evenement = 'nouvelle', instant = null } = {}) {
  const d = (lead && lead.payload && lead.payload.demande) || (lead && lead.demande) || null;
  const ages = d && Array.isArray(d.ages) ? d.ages : [];
  let AGES = {};
  try { AGES = require('./custom-request').AGES || {}; } catch (e) { AGES = {}; }
  const sections = [
    { titre: 'Contact', lignes: [['Nom', lead.contactName], ['Organisation', lead.company || (d && d.organisation)], ['Rôle', d && d.contactRole], ['Téléphone', lead.phone], ['E-mail', lead.email]] },
    { titre: 'Le groupe', lignes: [['Type', d ? d.groupTypeLabel : lead.occasion], ['Participants', lead.pax || (d && d.participants)], ['Accompagnants', d && d.companions ? d.companions : ''], ['Âges', ages.map((a) => (AGES[a] && AGES[a].label) || a).join(', ')]] },
    { titre: 'Quand', lignes: [['Date souhaitée', lead.requestedDate], ['Moment', d && d.momentLabel], ['Autre date possible', d && d.alternativeDate ? dateLongue(d.alternativeDate) : ''], ['Dates flexibles', d && d.flexible ? `Oui (${d.period || 'à fixer'})` : '']] },
    { titre: 'Ce qu’ils veulent faire', lignes: [
      ...((d && d.formulas) || []).map((f) => ['Formule', f.name || f.id]),
      ...((d && d.activities) || []).map((a) => ['Activité', `${a.name || a.id}${a.participants ? ` · ${a.participants} joueurs` : ''}${a.duration ? ` · ${a.duration} h` : ''}${a.games ? ` · ${a.games} partie${a.games > 1 ? 's' : ''}` : ''}${a.minutes ? ` · ${a.minutes} min` : ''}`]),
      ['Conseil demandé', d && d.advice ? 'Oui : le client veut l’avis de l’équipe' : ''],
      ['Budget par personne', d && d.budgetPerPerson ? montant(d.budgetPerPerson) : ''],
    ] },
    (d && (d.invoice || d.vatNumber)) ? { titre: 'Facturation', lignes: [['Facture', d.invoice ? 'Oui' : ''], ['TVA', d.vatNumber]] } : null,
    lead.message ? { titre: 'Message du client', texte: lead.message } : null,
    { titre: 'Dossier', lignes: [['Référence', lead.id ? `Demande #${lead.id}` : ''], ['Centre', (centre && centre.name) || lead.centerId], ['Reçue le', horodatage(instant || lead.createdAt)]] },
  ];
  const titre = `${evenement === 'nouvelle' ? 'Nouvelle demande sur mesure' : 'Demande sur mesure mise à jour'} · ${lead.contactName || lead.company || 'Sans nom'}`;
  const sousTitre = `${lead.pax || (d && d.participants) || '?'} personnes · ${lead.requestedDate || 'date à fixer'}${(centre && centre.name) ? ` · ${centre.name}` : ''}`;
  const pied = 'Copie automatique de la demande telle que le client l’a remplie. L’équipe y répond depuis Pinlane, dans Demandes sur mesure. Inutile de répondre à ce mail.';
  const subject = `[Secours] Demande sur mesure · ${lead.pax || (d && d.participants) || '?'} pers. · ${lead.requestedDate || 'date à fixer'} · ${lead.contactName || lead.company || 'Sans nom'}`;
  return { subject, html: gabarit({ titre, ton: '#7a4a00', sousTitre, sections, pied }), text: texteBrut({ titre, sousTitre, sections, pied }) };
}

// LA FEUILLE DU JOUR : le mail porte les pieces jointes (PDF a imprimer, Excel).
function mailFeuilleDuJour({ date, centre = null, reservations = [], moment = '', aJour = '' } = {}) {
  const actives = reservations.filter((r) => r && r.status !== 'cancelled');
  const personnes = actives.reduce((s, r) => s + (Number(r.pax) || 0), 0);
  const aValider = actives.filter((r) => r.validationStatus === 'staff_review').length;
  const sections = [
    { titre: 'La journée', lignes: [['Date', dateLongue(date)], ['Réservations', `${actives.length}`], ['Personnes', `${personnes}`], ['À valider', aValider ? `${aValider}` : ''], ['État au', aJour || horodatage()]] },
    { titre: 'Liste', lignes: actives.slice().sort((a, b) => String(a.startTime).localeCompare(String(b.startTime))).map((r) => [r.startTime || '?', `${r.name} · ${r.pax} pers. · ${r.phone || 'sans téléphone'}`]) },
  ];
  const titre = `Feuille du ${dateLongue(date)}${moment ? ` · ${moment}` : ''}`;
  const sousTitre = `${actives.length} réservation${actives.length > 1 ? 's' : ''} · ${personnes} personne${personnes > 1 ? 's' : ''}${(centre && centre.name) ? ` · ${centre.name}` : ''}`;
  const pied = 'La feuille papier pré-remplie (PDF à imprimer telle quelle) et le fichier Excel complet sont joints. Le dernier mail reçu est toujours le plus à jour.';
  const subject = `[Secours] Feuille du ${dateCourte(date)} · ${actives.length} réservation${actives.length > 1 ? 's' : ''} · ${personnes} pers.${moment ? ` · ${moment}` : ''}`;
  return { subject, html: gabarit({ titre, ton: '#111111', sousTitre, sections, pied }), text: texteBrut({ titre, sousTitre, sections, pied }) };
}

// UNE RESERVATION RECUE PENDANT UNE PANNE DE LA BASE : rien n est enregistre
// dans Pinlane, ce mail EST la demande. Le plan n a pas pu etre verifie.
function mailReservationPendantPanne(demande, { centre = null, erreur = '', instant = null, nomActivite = nomActiviteParDefaut, nomFormule = nomFormuleParDefaut } = {}) {
  const r = demande || {};
  const offre = lisible(r.formuleId ? nomFormule(r.formuleId, r.centerId) : (ligne(r.label) || 'Visite à la carte'));
  const prog = (Array.isArray(r.program) ? r.program : (r.program && r.program.items) || []).map((it) => [
    '•', `${nomActivite(it.activityId)}${it.duration ? ` · ${it.duration} h` : ''}${it.games ? ` · ${it.games} partie${it.games > 1 ? 's' : ''}` : ''}${it.participants ? ` · ${it.participants} joueurs` : ''}`,
  ]);
  const sections = [
    { titre: 'À faire', texte: 'Pinlane n’a pas pu enregistrer cette réservation (base de données indisponible). Le client a été prévenu que l’équipe lui confirme. Vérifiez la place, saisissez la réservation dans Pinlane dès qu’il revient, puis confirmez au client.' },
    { titre: 'Client', lignes: [['Nom', r.name], ['Téléphone', r.phone], ['E-mail', r.email], ['Occasion', majuscule(r.occasion)]] },
    { titre: 'Demande', lignes: [['Date', dateLongue(r.date)], ['Heure', r.startTime], ['Personnes', r.pax], ['Offre', offre], ['Montant affiché au client', r.quotedPrice != null ? montant(r.quotedPrice) : (r.price != null ? montant(r.price) : '')]] },
    prog.length ? { titre: 'Activités choisies', lignes: prog } : null,
    r.notes ? { titre: 'Notes du client', texte: r.notes } : null,
    { titre: 'Incident', lignes: [['Reçue le', horodatage(instant)], ['Centre', (centre && centre.name) || r.centerId], ['Erreur', ligne(erreur).slice(0, 200)]] },
  ];
  const titre = `À SAISIR · réservation reçue pendant une panne · ${r.name || 'Sans nom'}`;
  const sousTitre = `${dateLongue(r.date)} à ${r.startTime || '?'} · ${r.pax || '?'} pers. · ${offre}`;
  const pied = 'Ce mail est la seule trace de cette demande : gardez-le jusqu’à ce qu’elle soit saisie dans Pinlane.';
  const subject = `[Secours] À SAISIR · panne · ${dateCourte(r.date)} ${r.startTime || ''} · ${r.name || 'Sans nom'} · ${r.pax || '?'} pers.`;
  return { subject, html: gabarit({ titre, ton: '#cb2a2f', sousTitre, sections, pied }), text: texteBrut({ titre, sousTitre, sections, pied }) };
}

module.exports = {
  destinatairesSecours,
  mailCopieReservation,
  mailCopieDemandeSurMesure,
  mailFeuilleDuJour,
  mailReservationPendantPanne,
  // pour les gates
  _internes: { dateLongue, dateCourte, programmeLignes, NON_ROUTABLE },
};
