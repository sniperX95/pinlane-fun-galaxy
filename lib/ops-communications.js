const {
  createCommunication,
  listDueCommunications,
  updateCommunicationStatus,
} = require('./database');
const { getCenter, getFormula } = require('./ops-knowledge');

const BRUSSELS_TZ = 'Europe/Brussels';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToHtml(text = '') {
  return escapeHtml(text)
    .split('\n')
    .map((line) => (line ? `<p>${line}</p>` : '<br>'))
    .join('');
}

function detailRows(details = []) {
  if (!Array.isArray(details) || !details.length) return '';
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:18px 0 2px;border-collapse:collapse;border-top:1px solid #e8e3da;">
      ${details.map((detail, index) => `
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #eee9e1;font-size:13px;color:#756d61;width:38%;">${escapeHtml(detail.label)}</td>
          <td style="padding:8px 0;border-bottom:1px solid #eee9e1;font-size:14px;color:#222;text-align:right;">${escapeHtml(detail.value)}</td>
        </tr>
      `).join('')}
    </table>`;
}

function emailShell({
  title,
  body,
  footer = 'Fun Galaxy',
  preheader = '',
  details = [],
  action = null,
  note = '',
}) {
  const actionHtml = action?.href && action?.label
    ? `<p style="margin-top:18px;"><a href="${escapeHtml(action.href)}" style="color:#111;text-decoration:underline;">${escapeHtml(action.label)}</a></p>`
    : '';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    ${preheader ? `<title>${escapeHtml(preheader)}</title>` : ''}
  </head>
  <body style="margin:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#222;">
    ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>` : ''}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fff;">
            <tr>
              <td style="padding:28px 24px;font-size:15px;line-height:1.66;color:#222;">
                <h1 style="font-size:18px;line-height:1.3;margin:0 0 20px;color:#111;font-weight:700;">${escapeHtml(title)}</h1>
                ${textToHtml(body)}
                ${detailRows(details)}
                ${actionHtml}
                ${note ? `<p style="margin-top:18px;color:#5f5a52;font-size:13px;line-height:1.55;">${escapeHtml(note)}</p>` : ''}
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 28px;color:#5f5a52;font-size:13px;line-height:1.5;">
                ${escapeHtml(footer)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function getZonedParts(date, timeZone = BRUSSELS_TZ) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const read = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
}

function zonedTimeToUtc(dateStr, timeStr, timeZone = BRUSSELS_TZ) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  let utc = new Date(Date.UTC(year, month - 1, day, hour, minute || 0, 0));

  for (let index = 0; index < 4; index += 1) {
    const actual = getZonedParts(utc, timeZone);
    const desired = Date.UTC(year, month - 1, day, hour, minute || 0, 0);
    const current = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    utc = new Date(utc.getTime() + (desired - current));
  }

  return utc;
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function addDaysToDateStr(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return date.toISOString().slice(0, 10);
}

function isFuture(dateLike, marginMinutes = 0) {
  return new Date(dateLike).getTime() > Date.now() + marginMinutes * 60 * 1000;
}

function normalizePhoneForSms(phone = '') {
  const cleaned = String(phone).replace(/[^\d+]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.startsWith('00')) return `+${cleaned.slice(2)}`;
  if (cleaned.startsWith('0')) return `+32${cleaned.slice(1)}`;
  return `+32${cleaned}`;
}

function isSimulationCommunication(communication = {}) {
  const payload = communication.payload && typeof communication.payload === 'object'
    ? communication.payload
    : {};
  return payload.simulation === true
    || String(payload.simulation || '').toLowerCase() === 'true'
    || Boolean(payload.simulationRunId)
    || String(communication.idempotencyKey || '').startsWith('simulation:')
    || String(communication.templateId || '').startsWith('simulation_');
}

function shouldRequestHumanValidation(reservation) {
  return reservation.validationStatus === 'staff_review'
    || reservation.riskLevel === 'critical'
    || Boolean(reservation.opsPlan?.requiresHumanReview);
}

function buildOpsPlanSentence(reservation) {
  // Formules « Ancres + Liberté » : plus d'ordre imposé — les rendez-vous
  // (ancres), la table et le pass liberté sont décrits séparément.
  if (reservation.type === 'formule') return '';
  const steps = Array.isArray(reservation.opsPlan?.timeline)
    ? reservation.opsPlan.timeline.filter((step) => step.type === 'activity').slice(0, 4)
    : [];
  if (!steps.length) return '';
  const order = steps.map((step) => step.label).join(' puis ');
  return `Pour que ce soit fluide, on vous prévoit dans cet ordre : ${order}.`;
}

// Décrit une formule selon le modèle « Ancres + Liberté » : les rendez-vous
// fixes (bowling/laser), la table qui attend le groupe dès l'arrivée, et le
// pass liberté SANS aucune heure (minigolf, arcades, playground, boissons).
function buildFormulaEngagementLines(reservation) {
  if (reservation.type !== 'formule') return [];
  const plan = reservation.opsPlan || {};
  const blocks = Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : [];
  const lines = [];

  const appointments = [];
  const bowlingBlock = blocks.find((block) => block.resourceType === 'bowling_lane');
  const laserBlock = blocks.find((block) => block.resourceType === 'laser_arena');
  if (bowlingBlock?.startTime) appointments.push(`Bowling ${bowlingBlock.startTime}`);
  if (laserBlock?.startTime) appointments.push(`Laser Game ${laserBlock.startTime}`);
  if (appointments.length) lines.push(`Vos rendez-vous : ${appointments.join(' · ')}.`);

  const tableBlock = blocks.find((block) => block.resourceType === 'party_table');
  if (tableBlock?.startTime) {
    lines.push(`Votre table vous attend dès votre arrivée (${tableBlock.startTime}).`);
  }

  const freeLabels = (Array.isArray(plan.timeline) ? plan.timeline : [])
    .filter((step) => step.type === 'activity'
      && step.activityId
      && step.activityId !== 'service_drinks'
      && !['bowling_lane', 'laser_arena', 'party_table'].includes(step.resourceType || ''))
    .map((step) => step.label)
    .filter((label, index, list) => label && list.indexOf(label) === index);
  if (freeLabels.length) {
    lines.push(`À votre rythme sur place, quand vous voulez : ${freeLabels.join(', ')}.`);
  }

  const remainingLaser = Number(plan.laserPassPlan?.remainingGames || 0);
  if (remainingLaser > 0) {
    lines.push(`${remainingLaser} partie${remainingLaser > 1 ? 's' : ''} Laser Game à placer sur place avec l'équipe, selon l'affluence.`);
  }

  return lines;
}

function buildLaserSessionSentence(reservation) {
  const hasLaser = reservation.type === 'laser'
    || (reservation.opsPlan?.resourceBlocks || []).some((block) => block.resourceType === 'laser_arena');
  if (!hasLaser) return '';
  const sharing = reservation.opsPlan?.laserSharing || null;
  if (sharing?.splitGroup) {
    return `Pour le Laser Game, votre groupe est reparti sur ${sharing.waveCount} lancements afin de respecter les ${sharing.weaponCount || 30} armes disponibles.`;
  }
  if (sharing?.sharedNow) {
    return 'Votre session Laser Game est prévue sur un départ qui peut être partagé avec un autre groupe.';
  }
  return 'Pour le Laser Game, la session peut être complétée avec d’autres joueurs selon l’affluence.';
}

// Substitution des variables {{...}} des textes personnalisés (accents
// tolérés). Les tokens inconnus sont REJETÉS à la sauvegarde — jamais laissés
// bruts dans un email client.
const AUTOMATION_TOKEN_PATTERNS = {
  prenom: 'pr[eé]nom',
  nom: 'nom',
  date: 'date',
  heure: 'heure',
  formule: 'formule',
  pax: 'pax',
  centre: 'centre',
  prix: 'prix',
  date_fete: 'date_f[eê]te',
};

function applyAutomationVars(text, values = {}) {
  let output = String(text || '');
  for (const [key, pattern] of Object.entries(AUTOMATION_TOKEN_PATTERNS)) {
    if (values[key] === undefined) continue;
    output = output.replace(new RegExp(`\\{\\{\\s*${pattern}\\s*\\}\\}`, 'gi'), String(values[key]));
  }
  return output;
}

function findUnknownAutomationTokens(text, allowedKeys = []) {
  const tokens = String(text || '').match(/\{\{[^}]*\}\}/g) || [];
  if (!allowedKeys.length) return [...new Set(tokens)];
  const patterns = allowedKeys.map((key) => AUTOMATION_TOKEN_PATTERNS[key] || key);
  const allowedRx = new RegExp(`^\\{\\{\\s*(${patterns.join('|')})\\s*\\}\\}$`, 'i');
  return [...new Set(tokens.filter((token) => !allowedRx.test(token)))];
}

// Applique un override (sujet/corps personnalisés par le gérant) sur un
// message par défaut. Corps custom → message "plein texte" (pas de tableau de
// détails : le texte du gérant EST le message — même choix que l'override des
// notifications retard).
function applyMessageOverrides(base, overrides, vars) {
  const customSubject = String(overrides?.subject || '').trim();
  const customBody = String(overrides?.body || '').trim();
  if (!customSubject && !customBody) return base;
  const subject = customSubject ? applyAutomationVars(customSubject, vars) : base.subject;
  if (customBody) {
    return { subject, body: applyAutomationVars(customBody, vars), preheader: subject };
  }
  return { ...base, subject, preheader: base.preheader || subject };
}

function buildMessage({ reservation, templateId, channel, overrides = null }) {
  const base = buildDefaultMessage({ reservation, templateId, channel });
  if (channel !== 'email' || !overrides) return base;
  if (!['confirmation', 'reminder_48h'].includes(templateId)) return base;
  const vars = buildClientMessageVars(reservation);
  return applyMessageOverrides(base, overrides, {
    prenom: vars.firstName,
    nom: vars.clientName,
    date: vars.date,
    heure: vars.startTime,
    formule: vars.offer,
    pax: vars.pax,
    centre: vars.centerName,
    prix: vars.price,
  });
}

function buildDefaultMessage({ reservation, templateId, channel }) {
  const center = getCenter(reservation.centerId || 'libramont');
  let formula = null;
  if (reservation.formuleId) {
    try {
      formula = getFormula(reservation.formuleId);
    } catch (error) {
      formula = null;
    }
  }
  const clientName = reservation.name || 'Bonjour';
  const arrivalTime = reservation.startTime || '';
  // startTime = début exact de la première activité ; l'accueil se fait AVANT,
  // sur la fenêtre fixe du plan Ops (10 min par défaut).
  const arrivalLead = Number(reservation.opsPlan?.arrivalMinutes) || 10;
  const offer = reservation.label || formula?.name || (reservation.type === 'formule' ? 'votre formule' : reservation.type === 'laser' ? 'Laser Game' : 'bowling');
  const opsPlanSentence = buildOpsPlanSentence(reservation);
  const laserSentence = buildLaserSessionSentence(reservation);
  const delayUpdate = reservation.delayUpdate || reservation.opsDelay || null;

  if (channel === 'sms') {
    const lead = `${arrivalLead} min`;
    return {
      subject: '',
      body: `Fun Galaxy: petit rappel pour ${reservation.name}. Réservation ${reservation.date} à ${reservation.startTime}. Merci d'arriver ${lead} avant. Si vous avez du retard, prévenez le centre.`,
    };
  }

  if (templateId === 'staff_review_request') {
    return {
      subject: `À vérifier - ${reservation.label || reservation.formuleId || 'Réservation'}`,
      body: [
        `Demande à regarder pour ${reservation.name}.`,
        '',
        'Le moteur n’a pas trouvé un scénario automatique assez sûr. Il faut une décision humaine avant de confirmer au client.',
        '',
        reservation.opsPlan?.staffSummary || 'Vérifier les pistes, le laser, les tables et les marges avant réponse.',
      ].join('\n'),
      preheader: 'Une demande demande une validation direction/staff.',
      details: [
        { label: 'Client', value: reservation.name },
        { label: 'Date', value: `${reservation.date} à ${reservation.startTime}` },
        { label: 'Participants', value: `${reservation.pax}` },
        { label: 'Offre', value: offer },
        { label: 'Risque', value: `${reservation.riskLevel || 'à évaluer'}${reservation.riskScore !== null && reservation.riskScore !== undefined ? ` (${reservation.riskScore}/100)` : ''}` },
      ],
      action: { href: 'https://www.mngfunglxy.com/direction.html', label: 'Ouvrir le cockpit direction' },
    };
  }

  if (templateId === 'delay_update') {
    const previousStartTime = delayUpdate?.previousStartTime || delayUpdate?.oldStartTime || reservation.previousStartTime || '';
    const proposedStartTime = delayUpdate?.proposedStartTime || delayUpdate?.newStartTime || reservation.startTime || '';
    const delayMinutes = Number(delayUpdate?.delayMinutes || 0);
    const reasonLabel = delayUpdate?.reason || 'retard signale';
    return {
      subject: 'Ajustement de votre reservation Fun Galaxy',
      body: [
        `Bonjour ${clientName},`,
        '',
        `Petit ajustement cote planning: votre reservation ${offer} reste confirmee, mais elle est decalee de ${delayMinutes || 'quelques'} minute(s).`,
        previousStartTime && proposedStartTime
          ? `Ancien horaire: ${previousStartTime}. Nouvel horaire: ${proposedStartTime}.`
          : proposedStartTime ? `Nouvel horaire retenu: ${proposedStartTime}.` : '',
        `Raison: ${reasonLabel}.`,
        '',
        'On garde votre reservation active et notre equipe ajuste le planning sur place.',
        'Si ce nouvel horaire pose probleme, repondez simplement a ce message ou contactez le centre.',
        '',
        center.name,
      ].filter(Boolean).join('\n'),
      preheader: proposedStartTime
        ? `Votre reservation reste confirmee a ${proposedStartTime}.`
        : 'Votre reservation reste confirmee.',
      details: [
        { label: 'Centre', value: center.name },
        { label: 'Date', value: reservation.date },
        { label: 'Ancien horaire', value: previousStartTime || 'Non precise' },
        { label: 'Nouvel horaire', value: proposedStartTime || reservation.startTime || 'A confirmer' },
        { label: 'Participants', value: `${reservation.pax}` },
        { label: 'Offre', value: offer },
      ],
      note: 'Ce message est envoye apres confirmation staff du decalage. Aucun paiement en ligne nest demande.',
    };
  }

  if (templateId === 'reminder_48h') {
    return {
      subject: 'Petit rappel pour votre réservation Fun Galaxy',
      body: [
        `Bonjour ${clientName},`,
        '',
        `Je vous confirme qu’on vous attend le ${reservation.date} à ${reservation.startTime} chez ${center.name}.`,
        reservation.type === 'formule'
          ? "Si possible, venez avec tout le groupe 15 minutes avant l'heure prévue. Ça nous aide surtout quand il y a du Laser Game dans la formule."
          : "Si possible, venez 10 minutes avant l'heure prévue.",
        laserSentence,
        '',
        'À très vite,',
        center.name,
      ].join('\n'),
      preheader: `Rappel pour votre venue du ${reservation.date}.`,
      details: [
        { label: 'Date', value: reservation.date },
        { label: 'Heure', value: reservation.startTime },
        { label: 'Participants', value: `${reservation.pax}` },
        { label: 'Offre', value: offer },
      ],
      note: reservation.type === 'formule'
        ? "En cas de retard, appelez le centre dès que possible. On ajustera l'ordre des activités pour éviter de bloquer le planning."
        : 'En cas de retard, appelez le centre dès que possible.',
    };
  }

  if (templateId === 'request_received') {
    return {
      subject: 'Votre demande Fun Galaxy est bien reçue',
      body: [
        `Bonjour ${clientName},`,
        '',
        `On a bien reçu votre demande pour ${offer}.`,
        'Je vérifie encore le meilleur enchaînement avant de vous confirmer définitivement, parce que ce créneau demande un peu de coordination.',
        arrivalTime ? `Prévoyez déjà une arrivée environ ${arrivalLead} minutes avant ${arrivalTime}.` : `Prévoyez déjà une arrivée environ ${arrivalLead} minutes avant l'heure confirmée.`,
        '',
        'On revient vers vous si quelque chose doit être ajusté.',
        center.name,
      ].join('\n'),
      preheader: 'Votre demande est bien arrivée chez Fun Galaxy.',
      details: [
        { label: 'Centre', value: center.name },
        { label: 'Date', value: reservation.date },
        { label: 'Heure souhaitée', value: reservation.startTime },
        { label: 'Participants', value: `${reservation.pax}` },
        { label: 'Offre', value: offer },
      ],
      note: 'Ce message confirme la réception de la demande. La confirmation finale arrive après vérification du scénario.',
    };
  }

  return {
    subject: 'Votre réservation Fun Galaxy est confirmée',
    body: [
      `Bonjour ${clientName},`,
      '',
      `C’est confirmé pour ${offer}.`,
      arrivalTime ? `On vous attend le ${reservation.date} à ${arrivalTime}.` : `On vous attend le ${reservation.date}.`,
      `Merci d’arriver ${arrivalLead} minutes avant, surtout si le groupe doit être lancé ensemble.`,
      opsPlanSentence,
      ...buildFormulaEngagementLines(reservation),
      laserSentence,
      '',
      'Le paiement se fera sur place.',
      'À très vite,',
      center.name,
    ].filter(Boolean).join('\n'),
    preheader: `Réservation confirmée pour le ${reservation.date}.`,
    details: [
      { label: 'Centre', value: center.name },
      { label: 'Date', value: reservation.date },
      { label: 'Heure', value: reservation.startTime },
      { label: 'Participants', value: `${reservation.pax}` },
      { label: 'Offre', value: offer },
      { label: 'Montant estimé', value: reservation.price !== undefined ? `${reservation.price} EUR` : 'Sur place' },
    ],
    note: reservation.type === 'formule'
      ? 'Vos rendez-vous sont garantis ; le reste de la formule se vit à votre rythme sur place, sans horaire imposé.'
      : '',
  };
}

async function enqueueReservationCommunications(reservation, options = {}) {
  // `created` collecte des PROMESSES (clés d'idempotence toutes distinctes) :
  // les insertions partent en parallèle, résolues d'un bloc à la fin.
  // Chemin chaud des mutations réservation staff/public.
  const created = [];
  // options.templatesOnly : régénérer seulement certains messages (ex. le
  // rappel J-2 après un plan de retard) sans re-mettre en file la confirmation.
  const wantsTemplate = (templateId) => !Array.isArray(options.templatesOnly)
    || options.templatesOnly.includes(templateId);
  const centerId = reservation.centerId || 'libramont';
  const reservationId = reservation.id ? Number(reservation.id) : null;
  const reservationKey = reservationId || reservation.idempotencyKey || reservation.requestId || [
    centerId,
    reservation.email || reservation.phone || reservation.name || 'manual',
    reservation.date || 'date',
    reservation.startTime || 'time',
    reservation.type || 'reservation',
    reservation.formuleId || '',
  ].join(':');
  const email = String(reservation.email || '').trim();
  const phone = normalizePhoneForSms(reservation.phone || '');
  const smsEnabled = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
  const staffEmail = process.env.STAFF_REVIEW_EMAIL || process.env.RESERVATION_STAFF_EMAIL || '';
  const validationMode = options.validationMode || reservation.validationStatus || (shouldRequestHumanValidation(reservation) ? 'staff_review' : 'confirmed');
  const reservationInstant = zonedTimeToUtc(reservation.date, reservation.startTime || '10:00');
  const confirmationDelayMinutes = Math.max(0, Number(process.env.CONFIRMATION_DELAY_MINUTES || 0));
  const receivedDelayMinutes = Math.max(0, Number(process.env.REQUEST_RECEIVED_DELAY_MINUTES || 0));
  // Textes/timings personnalisés par le gérant (page Emails). Sans override,
  // comportement historique à l'octet près. `enqueue` injectable pour le gate.
  const enqueue = options.enqueue || createCommunication;
  const automation = await getAutomationSettings(centerId, options.deps || defaultDeps());

  if (email) {
    const templateId = validationMode === 'staff_review' ? 'request_received' : 'confirmation';
    if (wantsTemplate(templateId)) {
      const message = buildMessage({
        reservation,
        templateId,
        channel: 'email',
        overrides: templateId === 'confirmation' ? automation.confirmation : null,
      });
      created.push(enqueue({
        centerId,
        reservationId,
        channel: 'email',
        templateId,
        recipient: email,
        subject: message.subject,
        body: emailShell({
          title: message.subject,
          body: message.body,
          preheader: message.preheader,
          details: message.details,
          action: message.action,
          note: message.note,
        }),
        status: 'queued',
        scheduledAt: addMinutes(new Date(), templateId === 'confirmation' ? confirmationDelayMinutes : receivedDelayMinutes).toISOString(),
        idempotencyKey: `reservation:${reservationKey}:${templateId}:email`,
        payload: { textBody: message.body, validationMode },
      }));
    }

    const reminderOffsetDays = Number.isInteger(automation.reminder_48h?.offsetDays)
      ? automation.reminder_48h.offsetDays
      : 2;
    const reminderDate = addDaysToDateStr(reservation.date, -reminderOffsetDays);
    const reminderAt = zonedTimeToUtc(reminderDate, '10:00').toISOString();
    if (wantsTemplate('reminder_48h') && isFuture(reminderAt, 5)) {
      const reminder = buildMessage({
        reservation,
        templateId: 'reminder_48h',
        channel: 'email',
        overrides: automation.reminder_48h,
      });
      created.push(enqueue({
        centerId,
        reservationId,
        channel: 'email',
        templateId: 'reminder_48h',
        recipient: email,
        subject: reminder.subject,
        body: emailShell({
          title: reminder.subject,
          body: reminder.body,
          preheader: reminder.preheader,
          details: reminder.details,
          action: reminder.action,
          note: reminder.note,
        }),
        status: 'queued',
        scheduledAt: reminderAt,
        idempotencyKey: `reservation:${reservationKey}:reminder_48h:email`,
        payload: { textBody: reminder.body },
      }));
    }
  }

  if (phone && smsEnabled && wantsTemplate('reminder_day_sms')) {
    const smsAt = addHours(reservationInstant, -6).toISOString();
    if (isFuture(smsAt, 5)) {
      const message = buildMessage({ reservation, templateId: 'reminder_day_sms', channel: 'sms' });
      created.push(enqueue({
        centerId,
        reservationId,
        channel: 'sms',
        templateId: 'reminder_day_sms',
        recipient: phone,
        subject: '',
        body: message.body,
        status: 'queued',
        scheduledAt: smsAt,
        idempotencyKey: `reservation:${reservationKey}:reminder_day:sms`,
      }));
    }
  }

  if (staffEmail && validationMode === 'staff_review' && wantsTemplate('staff_review_request')) {
    const message = buildMessage({ reservation, templateId: 'staff_review_request', channel: 'email' });
    created.push(enqueue({
      centerId,
      reservationId,
      channel: 'email',
      templateId: 'staff_review_request',
      recipient: staffEmail,
      subject: message.subject,
      body: emailShell({
        title: message.subject,
        body: message.body,
        preheader: message.preheader,
        details: message.details,
        action: message.action,
        note: message.note,
      }),
      status: 'queued',
      idempotencyKey: `reservation:${reservationKey}:staff_review:email`,
      payload: { textBody: message.body },
    }));
  }

  return Promise.all(created);
}

// === Notifications retard : canal abstrait, envoi UNIQUEMENT sur demande ====
// Le staff choisit client par client qui prévenir après application d'un plan
// de retard. Email actif aujourd'hui ; le SMS réutilisera la même abstraction
// (dispatchCommunication route déjà par canal) sans refactor.
const DELAY_NOTIFICATION_CHANNELS = [
  {
    id: 'email',
    label: 'Email',
    isAvailable: () => true,
    recipientFor: (reservation) => String(reservation.email || '').trim(),
  },
  {
    id: 'sms',
    label: 'SMS',
    isAvailable: () => Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM),
    recipientFor: (reservation) => normalizePhoneForSms(reservation.phone || ''),
  },
];

function listDelayNotificationChannels() {
  return DELAY_NOTIFICATION_CHANNELS.map((channel) => ({
    id: channel.id,
    label: channel.label,
    available: channel.isAvailable(),
  }));
}

// Message client pour UNE réservation touchée par un plan de retard :
// décalage d'horaire, changement de piste, ou les deux. Ton Fun Galaxy.
function buildDelayChangeMessage({ reservation, change, channel = 'email' }) {
  const center = getCenter(reservation.centerId || 'libramont');
  const clientName = reservation.name || 'Bonjour';
  const offer = reservation.label || (reservation.type === 'formule' ? 'votre formule' : reservation.type === 'laser' ? 'Laser Game' : 'bowling');
  const laneChangeSentence = change.laneChanged && change.newLanes?.length
    ? `Petite adaptation côté pistes : vous jouerez sur la piste ${change.newLanes.join(', ')} (au lieu de la piste ${(change.previousLanes || []).join(', ') || 'prévue'}).`
    : '';
  const shiftSentence = Number(change.shiftMinutes || 0) > 0
    ? `Votre horaire est décalé de ${change.shiftMinutes} minute(s) : ${change.previousStartTime} devient ${change.newStartTime}.`
    : (change.moves || []).length
      ? `Ajustement du programme : ${change.moves.map((move) => `${move.label} ${move.previousStartTime} devient ${move.newStartTime}`).join(' · ')}.`
      : '';

  if (channel === 'sms') {
    return {
      subject: '',
      body: `Fun Galaxy: petit ajustement pour ${reservation.name}. ${shiftSentence || laneChangeSentence} Votre réservation reste confirmée. En cas de souci, contactez le centre.`,
    };
  }

  return {
    subject: 'Ajustement de votre réservation Fun Galaxy',
    body: [
      `Bonjour ${clientName},`,
      '',
      `Un petit ajustement de planning côté ${center.name} : votre réservation ${offer} du ${reservation.date} reste bien confirmée.`,
      shiftSentence,
      laneChangeSentence,
      '',
      'Tout le reste ne change pas, et notre équipe vous accueille comme prévu.',
      'Si ce changement pose problème, répondez simplement à ce message ou contactez le centre.',
      '',
      'À très vite,',
      center.name,
    ].filter(Boolean).join('\n'),
    preheader: change.newStartTime
      ? `Votre réservation reste confirmée${Number(change.shiftMinutes || 0) > 0 ? ` à ${change.newStartTime}` : ''}.`
      : 'Votre réservation reste confirmée.',
    details: [
      { label: 'Centre', value: center.name },
      { label: 'Date', value: reservation.date },
      ...(Number(change.shiftMinutes || 0) > 0
        ? [
          { label: 'Ancien horaire', value: change.previousStartTime || '' },
          { label: 'Nouvel horaire', value: change.newStartTime || '' },
        ]
        : [{ label: 'Horaire', value: reservation.startTime || change.newStartTime || '' }]),
      ...(change.laneChanged && change.newLanes?.length
        ? [{ label: 'Piste', value: change.newLanes.join(', ') }]
        : []),
      { label: 'Participants', value: `${reservation.pax}` },
      { label: 'Offre', value: offer },
    ],
    note: 'Ce message est envoyé après validation du staff. Aucun paiement en ligne n\'est demandé.',
  };
}

// Met en file la notification retard d'UN client, pour les canaux demandés.
// N'est JAMAIS appelée automatiquement : uniquement depuis l'action staff
// explicite « Envoyer les emails » de l'étape notification.
async function enqueueDelayChangeCommunications({ reservation, change, incidentId, channels = ['email'], override = null }) {
  const created = [];
  const centerId = reservation.centerId || 'libramont';
  const reservationId = reservation.id ? Number(reservation.id) : null;
  // `override` = texte relu/modifié par le staff à l'étape notification. Quand
  // il est fourni, il fait AUTORITÉ sur le corps (le staff a validé ce texte) ;
  // sinon on retombe sur le template généré. Le serveur reste la source de
  // vérité de l'envoi et de la trace — le front ne fait que composer.
  const overrideBody = override && typeof override.body === 'string' && override.body.trim()
    ? override.body
    : '';
  const overrideSubject = override && typeof override.subject === 'string' && override.subject.trim()
    ? override.subject
    : '';

  for (const channelId of channels) {
    const channel = DELAY_NOTIFICATION_CHANNELS.find((item) => item.id === channelId);
    if (!channel || !channel.isAvailable()) continue;
    const recipient = channel.recipientFor(reservation);
    if (!recipient) continue;
    const message = buildDelayChangeMessage({ reservation, change, channel: channel.id });
    const finalSubject = overrideSubject || message.subject;
    const finalBody = overrideBody || message.body;
    created.push(await createCommunication({
      centerId,
      reservationId,
      channel: channel.id,
      templateId: 'delay_change',
      recipient,
      subject: finalSubject,
      body: channel.id === 'email'
        ? emailShell(overrideBody
          ? { title: finalSubject, body: finalBody, preheader: message.preheader }
          : {
            title: message.subject,
            body: message.body,
            preheader: message.preheader,
            details: message.details,
            note: message.note,
          })
        : finalBody,
      status: 'queued',
      scheduledAt: new Date().toISOString(),
      idempotencyKey: `delaychange:${incidentId || 'manual'}:${reservationId}:${channel.id}`,
      payload: {
        textBody: finalBody,
        edited: Boolean(overrideBody),
        delayChange: {
          kind: change.kind,
          previousStartTime: change.previousStartTime,
          newStartTime: change.newStartTime,
          shiftMinutes: change.shiftMinutes,
          previousLanes: change.previousLanes,
          newLanes: change.newLanes,
        },
      },
    }));
  }

  return created;
}

async function sendEmail(communication) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { skipped: true, reason: 'RESEND_API_KEY manquant.' };

  // Identité d'expéditeur par communication (studio mails). L'adresse doit
  // être vérifiée côté Resend ; tant qu'aucune identité n'est configurée,
  // fallback sur l'expéditeur plateforme.
  const payloadFrom = String(communication.payload?.fromEmail || '').trim();
  const payloadLabel = String(communication.payload?.fromLabel || '').trim();
  const configuredFrom = payloadFrom || process.env.RESEND_FROM || 'onboarding@resend.dev';
  const from = configuredFrom.includes('<')
    ? configuredFrom
    : `${payloadLabel || 'Fun Galaxy'} <${configuredFrom}>`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(communication.idempotencyKey ? { 'Idempotency-Key': communication.idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from,
      to: communication.recipient,
      subject: communication.subject,
      html: communication.body,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `Resend ${response.status}`);
  }
  return { providerMessageId: payload.id || '' };
}

async function sendSms(communication) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) return { skipped: true, reason: 'Configuration Twilio manquante.' };

  const body = new URLSearchParams({
    From: from,
    To: communication.recipient,
    Body: communication.body,
  });
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || `Twilio ${response.status}`);
  }
  return { providerMessageId: payload.sid || '' };
}

async function dispatchCommunication(communication) {
  if (isSimulationCommunication(communication)) {
    if (!communication.id) {
      return {
        ...communication,
        status: 'draft',
        skipped: true,
        skipReason: 'Communication simulation isolee du dispatcher reel.',
      };
    }
    const updated = await updateCommunicationStatus(communication.id, {
      status: 'draft',
      lastError: 'Communication simulation isolee du dispatcher reel.',
      nextRetryAt: null,
    });
    return {
      ...updated,
      skipped: true,
      skipReason: 'Communication simulation isolee du dispatcher reel.',
    };
  }

  if (!communication.recipient) {
    return updateCommunicationStatus(communication.id, {
      status: 'failed',
      incrementAttempts: 1,
      lastError: 'Destinataire manquant.',
    });
  }

  const sendResult = communication.channel === 'sms'
    ? await sendSms(communication)
    : await sendEmail(communication);

  if (sendResult.skipped) {
    const queued = await updateCommunicationStatus(communication.id, {
      status: 'queued',
      incrementAttempts: 0,
      lastError: sendResult.reason || 'Canal non configure.',
      nextRetryAt: retryDateForAttempt(Number(communication.attempts || 0) + 1),
    });
    return {
      ...queued,
      skipped: true,
      skipReason: sendResult.reason,
    };
  }

  return updateCommunicationStatus(communication.id, {
    status: 'sent',
    incrementAttempts: 1,
    providerMessageId: sendResult.providerMessageId,
    lastError: '',
    nextRetryAt: null,
  });
}

function retryDateForAttempt(attempt) {
  const minutes = Math.min(120, Math.max(2, Number(attempt || 1) * 5));
  return addMinutes(new Date(), minutes).toISOString();
}

async function dispatchDueCommunications({ limit = 25, centerId = '', reservationId = null } = {}) {
  const due = await listDueCommunications({ limit, centerId, reservationId });
  const results = [];

  for (const communication of due) {
    try {
      const sent = await dispatchCommunication(communication);
      results.push({ id: communication.id, status: sent.status, skipped: Boolean(sent.skipped), reason: sent.skipReason || '' });
    } catch (error) {
      const nextAttempts = Number(communication.attempts || 0) + 1;
      const failed = nextAttempts >= Number(communication.maxAttempts || 3);
      const updated = await updateCommunicationStatus(communication.id, {
        status: failed ? 'failed' : 'queued',
        incrementAttempts: 1,
        lastError: error.message || 'Erreur envoi.',
        nextRetryAt: failed ? null : retryDateForAttempt(nextAttempts),
      });
      results.push({ id: communication.id, status: updated.status, error: updated.lastError });
    }
  }

  return {
    ok: true,
    checked: due.length,
    results,
  };
}

function buildEmailSamples() {
  const baseReservation = {
    id: 9001,
    centerId: 'libramont',
    name: 'Marie Dupont',
    phone: '+32470123456',
    email: 'client@example.com',
    date: '2026-06-20',
    startTime: '15:00',
    pax: 12,
    price: 468,
    type: 'formule',
    formuleId: 'f4',
    label: 'FORMULE 4',
    riskLevel: 'high',
    riskScore: 78,
    validationStatus: 'staff_review',
  };

  return ['request_received', 'confirmation', 'reminder_48h', 'staff_review_request', 'delay_update'].map((templateId) => {
    const channel = 'email';
    const message = buildMessage({
      reservation: {
        ...baseReservation,
        startTime: templateId === 'delay_update' ? '15:10' : baseReservation.startTime,
        delayUpdate: {
          previousStartTime: '15:00',
          proposedStartTime: '15:10',
          delayMinutes: 10,
          reason: 'retard signale',
        },
      },
      templateId,
      channel,
    });
    return {
      templateId,
      subject: message.subject,
      preheader: message.preheader || '',
      html: emailShell({
        title: message.subject,
        body: message.body,
        preheader: message.preheader,
        details: message.details,
        action: message.action,
        note: message.note,
      }),
      textBody: message.body,
    };
  });
}

// === Centre de communication client (mail + SMS) ============================
// Le staff envoie un message direct à un client depuis une fiche résa. Le canal
// est abstrait (sendClientMessage) : Email actif tout de suite, SMS prêt côté
// chaîne (templates courts + envoi Twilio) mais désactivé tant qu'aucun compte
// n'est configuré. Chaque envoi est tracé dans `communications` pour l'historique
// par client et éviter le spam.

const CLIENT_MESSAGE_CHANNELS = [
  {
    id: 'email',
    label: 'Email',
    isAvailable: () => true,
    unavailableReason: '',
    recipientFor: (reservation) => String(reservation.email || '').trim(),
    maxLength: 0,
  },
  {
    id: 'sms',
    label: 'SMS',
    isAvailable: () => Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM),
    unavailableReason: 'Nécessite un compte SMS/Twilio (variables TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM).',
    recipientFor: (reservation) => normalizePhoneForSms(reservation.phone || ''),
    maxLength: 480,
  },
];

function formatDateFr(dateStr = '') {
  const parts = String(dateStr).split('-');
  if (parts.length !== 3) return String(dateStr || '');
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

// Variables prêtes à injecter dans les modèles, dérivées de la réservation et
// du centre. Toujours défensif : un champ manquant tombe sur un libellé neutre.
function buildClientMessageVars(reservation = {}) {
  const center = getCenter(reservation.centerId || 'libramont');
  let formula = null;
  if (reservation.formuleId) {
    try {
      formula = getFormula(reservation.formuleId);
    } catch (error) {
      formula = null;
    }
  }
  const offer = reservation.label
    || formula?.name
    || (reservation.type === 'formule' ? 'votre formule' : reservation.type === 'laser' ? 'Laser Game' : 'bowling');
  const priceValue = reservation.price !== undefined && reservation.price !== null ? Number(reservation.price) : null;
  return {
    clientName: (reservation.name || '').trim() || 'Bonjour',
    firstName: ((reservation.name || '').trim().split(/\s+/)[0]) || 'Bonjour',
    date: formatDateFr(reservation.date),
    rawDate: reservation.date || '',
    startTime: reservation.startTime || '',
    offer,
    pax: reservation.pax !== undefined ? String(reservation.pax) : '',
    price: priceValue !== null ? `${priceValue} EUR` : 'à régler sur place',
    centerName: center.name,
  };
}

// Bibliothèque de modèles prêts à l'emploi, bien rédigés, ton Fun Galaxy.
// Chaque modèle expose un rendu email (sujet + corps texte) et, quand c'est
// pertinent, un rendu SMS court. Le corps texte est celui que le staff relit
// et modifie dans le textarea avant envoi.
const CLIENT_MESSAGE_TEMPLATES = [
  {
    id: 'confirmation',
    label: 'Confirmation de réservation',
    category: 'Avant venue',
    description: 'Confirme la réservation et rappelle l’essentiel.',
    email: (v) => ({
      subject: 'Votre réservation Fun Galaxy est confirmée',
      body: [
        `Bonjour ${v.clientName},`,
        '',
        `C’est confirmé pour ${v.offer} le ${v.date} à ${v.startTime}${v.pax ? ` pour ${v.pax} personne(s)` : ''}.`,
        'Merci d’arriver une dizaine de minutes avant l’heure prévue pour un lancement fluide.',
        'Le paiement se fait sur place.',
        '',
        'À très vite,',
        v.centerName,
      ].join('\n'),
    }),
    sms: (v) => `Fun Galaxy: reservation confirmee pour ${v.firstName} le ${v.date} a ${v.startTime}. Merci d'arriver 10 min avant. A bientot !`,
  },
  {
    id: 'reminder',
    label: 'Rappel de venue',
    category: 'Avant venue',
    description: 'Rappelle un rendez-vous proche.',
    email: (v) => ({
      subject: 'Petit rappel pour votre venue chez Fun Galaxy',
      body: [
        `Bonjour ${v.clientName},`,
        '',
        `On vous attend le ${v.date} à ${v.startTime} pour ${v.offer}.`,
        'Si possible, venez une dizaine de minutes avant l’heure prévue.',
        'En cas de retard, appelez-nous : on ajuste le planning avec vous.',
        '',
        'À très vite,',
        v.centerName,
      ].join('\n'),
    }),
    sms: (v) => `Fun Galaxy: rappel, on vous attend le ${v.date} a ${v.startTime}. Merci d'arriver 10 min avant. En cas de retard, appelez le centre.`,
  },
  {
    id: 'delay',
    label: 'Retard / attente',
    category: 'Le jour J',
    description: 'Prévenir d’un léger retard côté centre.',
    email: (v) => ({
      subject: 'Petit ajustement de votre réservation Fun Galaxy',
      body: [
        `Bonjour ${v.clientName},`,
        '',
        `Petit ajustement côté planning : votre réservation ${v.offer} du ${v.date} reste bien confirmée, avec un léger décalage sur l’horaire.`,
        'Notre équipe vous accueille dès votre arrivée et vous tient au courant sur place.',
        'Si ce changement pose problème, répondez simplement à ce message ou contactez le centre.',
        '',
        'Merci de votre compréhension,',
        v.centerName,
      ].join('\n'),
    }),
    sms: (v) => `Fun Galaxy: petit decalage sur votre reservation du ${v.date}. Elle reste confirmee, l'equipe vous accueille des l'arrivee. Merci de votre comprehension.`,
  },
  {
    id: 'reschedule',
    label: 'Modification d’horaire',
    category: 'Le jour J',
    description: 'Proposer un nouvel horaire à valider.',
    email: (v) => ({
      subject: 'Modification d’horaire pour votre réservation Fun Galaxy',
      body: [
        `Bonjour ${v.clientName},`,
        '',
        `Nous devons ajuster l’horaire de votre réservation ${v.offer} du ${v.date} (initialement ${v.startTime}).`,
        'Pourriez-vous nous confirmer si le nouvel horaire proposé vous convient ? Nous restons flexibles pour trouver le meilleur créneau.',
        'Répondez simplement à ce message ou appelez-nous.',
        '',
        'Merci beaucoup,',
        v.centerName,
      ].join('\n'),
    }),
    sms: (v) => `Fun Galaxy: nous devons ajuster l'horaire de votre reservation du ${v.date} (${v.startTime}). Merci de nous rappeler pour valider un nouveau creneau.`,
  },
  {
    id: 'cancellation',
    label: 'Annulation',
    category: 'Le jour J',
    description: 'Informer d’une annulation avec tact.',
    email: (v) => ({
      subject: 'Au sujet de votre réservation Fun Galaxy',
      body: [
        `Bonjour ${v.clientName},`,
        '',
        `Nous sommes au regret de devoir annuler votre réservation ${v.offer} du ${v.date} à ${v.startTime}.`,
        'Nous en sommes sincèrement désolés et serions ravis de vous retrouver sur un prochain créneau — contactez-nous, on vous trouve la meilleure date.',
        '',
        'Avec toutes nos excuses,',
        v.centerName,
      ].join('\n'),
    }),
    sms: (v) => `Fun Galaxy: nous devons annuler votre reservation du ${v.date} a ${v.startTime}. Toutes nos excuses. Contactez-nous pour reprogrammer.`,
  },
  {
    id: 'thanks',
    label: 'Remerciement post-visite',
    category: 'Après venue',
    description: 'Remercier après la visite et inviter au retour.',
    email: (v) => ({
      subject: 'Merci pour votre visite chez Fun Galaxy !',
      body: [
        `Bonjour ${v.clientName},`,
        '',
        'Merci d’être passés nous voir — on espère que vous avez passé un super moment !',
        'Un avis en ligne nous aide énormément, et on serait ravis de vous accueillir à nouveau très vite.',
        '',
        'À bientôt,',
        v.centerName,
      ].join('\n'),
    }),
    sms: (v) => `Fun Galaxy: merci pour votre visite ${v.firstName} ! On espere que vous vous etes bien amuses. A tres vite !`,
  },
  {
    id: 'practical_info',
    label: 'Informations pratiques',
    category: 'Avant venue',
    description: 'Adresse, accès et infos utiles.',
    email: (v) => ({
      subject: 'Infos pratiques pour votre venue chez Fun Galaxy',
      body: [
        `Bonjour ${v.clientName},`,
        '',
        `Voici quelques infos pour votre venue le ${v.date} à ${v.startTime} chez ${v.centerName}.`,
        'Un parking est disponible sur place. Merci d’arriver une dizaine de minutes avant l’heure prévue.',
        'Toutes les infos (accès, horaires) sont sur mngfunglxy.com — et à la moindre question, contactez-nous.',
        '',
        'À très vite,',
        v.centerName,
      ].join('\n'),
    }),
    sms: (v) => `Fun Galaxy: rendez-vous le ${v.date} a ${v.startTime}. Parking sur place, merci d'arriver 10 min avant. Infos sur mngfunglxy.com`,
  },
  {
    id: 'promo',
    label: 'Offre / promo',
    category: 'Fidélisation',
    description: 'Partager une offre commerciale.',
    email: (v) => ({
      subject: 'Une offre rien que pour vous chez Fun Galaxy',
      body: [
        `Bonjour ${v.clientName},`,
        '',
        'On a une petite attention pour vous : profitez de notre offre du moment lors de votre prochaine visite.',
        'Réservez dès maintenant sur mngfunglxy.com ou répondez à ce message, on s’occupe de tout.',
        '',
        'À très vite,',
        v.centerName,
      ].join('\n'),
    }),
    sms: (v) => `Fun Galaxy: une offre rien que pour vous sur votre prochaine visite ! Reservez sur mngfunglxy.com. A tres vite !`,
  },
  {
    id: 'custom',
    label: 'Message vierge',
    category: 'Personnalisé',
    description: 'Rédiger un message libre.',
    email: (v) => ({
      subject: 'Un message de Fun Galaxy',
      body: [
        `Bonjour ${v.clientName},`,
        '',
        '',
        '',
        v.centerName,
      ].join('\n'),
    }),
    sms: (v) => `Fun Galaxy: `,
  },
];

function getClientMessageTemplate(templateId) {
  return CLIENT_MESSAGE_TEMPLATES.find((template) => template.id === templateId) || null;
}

// Métadonnées des modèles pour l'UI (sans les fonctions de rendu).
function listClientMessageTemplates() {
  return CLIENT_MESSAGE_TEMPLATES.map((template) => ({
    id: template.id,
    label: template.label,
    category: template.category,
    description: template.description,
    channels: ['email', typeof template.sms === 'function' ? 'sms' : null].filter(Boolean),
  }));
}

// État des canaux pour une réservation donnée : disponibilité (config) +
// présence d'un destinataire. L'UI grise proprement le SMS non configuré.
function listClientMessageChannels(reservation = {}) {
  return CLIENT_MESSAGE_CHANNELS.map((channel) => ({
    id: channel.id,
    label: channel.label,
    available: channel.isAvailable(),
    unavailableReason: channel.isAvailable() ? '' : channel.unavailableReason,
    hasRecipient: Boolean(channel.recipientFor(reservation)),
    maxLength: channel.maxLength || 0,
  }));
}

// Rend un modèle pour une réservation et un canal. Renvoie { subject, body }.
function buildClientMessage({ reservation, templateId, channel = 'email' }) {
  const vars = buildClientMessageVars(reservation);
  const template = getClientMessageTemplate(templateId) || getClientMessageTemplate('custom');
  if (channel === 'sms') {
    const body = typeof template.sms === 'function' ? template.sms(vars) : '';
    return { subject: '', body };
  }
  return template.email(vars);
}

// Envoi réel d'un message client (source de vérité serveur). Valide le canal et
// le destinataire, trace la communication, puis déclenche l'envoi immédiat.
// Le SMS sans config Twilio est refusé proprement (message exposable au staff).
async function sendClientMessage({
  centerId,
  reservation,
  templateId = 'custom',
  channel = 'email',
  subject = '',
  body = '',
  staffMember = 'staff',
}) {
  const channelConfig = CLIENT_MESSAGE_CHANNELS.find((item) => item.id === channel);
  if (!channelConfig) {
    const error = new Error('Canal de communication inconnu.');
    error.expose = true;
    throw error;
  }
  if (!channelConfig.isAvailable()) {
    const error = new Error(channelConfig.unavailableReason || 'Canal indisponible.');
    error.expose = true;
    throw error;
  }
  const recipient = channelConfig.recipientFor(reservation);
  if (!recipient) {
    const error = new Error(channel === 'sms'
      ? 'Aucun numéro de téléphone pour ce client.'
      : 'Aucun email pour ce client.');
    error.expose = true;
    throw error;
  }

  const generated = buildClientMessage({ reservation, templateId, channel });
  const finalSubject = String(subject || '').trim() || generated.subject;
  const finalBody = String(body || '').trim() || generated.body;
  if (!finalBody) {
    const error = new Error('Le message est vide.');
    error.expose = true;
    throw error;
  }

  const resolvedCenterId = centerId || reservation.centerId || 'libramont';
  const reservationId = reservation.id ? Number(reservation.id) : null;
  const communication = await createCommunication({
    centerId: resolvedCenterId,
    reservationId,
    channel,
    templateId: `client_${templateId || 'custom'}`,
    recipient,
    subject: channel === 'email' ? finalSubject : '',
    body: channel === 'email'
      ? emailShell({ title: finalSubject, body: finalBody, preheader: finalSubject })
      : finalBody,
    status: 'queued',
    scheduledAt: new Date().toISOString(),
    payload: {
      textBody: finalBody,
      clientMessage: true,
      templateId,
      staffMember,
    },
  });

  const dispatched = communication.id
    ? await dispatchDueCommunications({ limit: 5, centerId: resolvedCenterId, reservationId }).catch(() => null)
    : null;

  return { communication, dispatched };
}

// Envoi libre (studio mails ET composer de la page Emails) : MÊME pipeline que
// les messages client (communication en file + dispatch immédiat) — historique
// et retries unifiés. AUCUNE réservation requise.
// `replyToCommunicationId` : cet envoi répond à un email REÇU → l'inbound est
// marqué répondu, et si le staff a modifié la réponse proposée par l'agent, la
// version corrigée devient une leçon (mémoire de l'agent).
async function sendDirectEmail({
  centerId = 'libramont',
  to,
  name = '',
  subject = '',
  body = '',
  fromEmail = '',
  fromLabel = '',
  category = 'direct',
  templateRef = '',
  staffMember = 'direction',
  identityId = null,
  replyToCommunicationId = null,
  scheduledAt = null,
}, deps = {}) {
  const enqueue = deps.enqueue || createCommunication;
  const recipient = String(to || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    const error = new Error('Adresse email du destinataire invalide.');
    error.expose = true;
    throw error;
  }
  const finalSubject = String(subject || '').trim();
  const finalBody = String(body || '').trim();
  if (!finalSubject) { const e = new Error("L'objet est requis."); e.expose = true; throw e; }
  if (!finalBody) { const e = new Error('Le message est vide.'); e.expose = true; throw e; }
  if (finalBody.length > 20000) { const e = new Error('Message trop long (20 000 caractères max).'); e.expose = true; throw e; }
  const replyToId = Number(replyToCommunicationId) || null;
  // Envoi programmé : date future (tolérance horloge 2 min) plafonnée à 1 an.
  let sendAt = new Date();
  let deferred = false;
  if (scheduledAt) {
    const requested = new Date(scheduledAt);
    if (Number.isNaN(requested.getTime())) { const e = new Error("Date d'envoi programmé invalide."); e.expose = true; throw e; }
    if (requested.getTime() > Date.now() + 365 * 86400000) { const e = new Error("L'envoi ne peut pas être programmé à plus d'un an."); e.expose = true; throw e; }
    if (requested.getTime() > Date.now() + 2 * 60000) { sendAt = requested; deferred = true; }
  }

  const communication = await enqueue({
    centerId,
    reservationId: null,
    channel: 'email',
    templateId: templateRef ? `studio_${templateRef}` : `studio_${category}`,
    recipient,
    subject: finalSubject,
    body: emailShell({ title: finalSubject, body: finalBody, preheader: finalSubject }),
    status: 'queued',
    scheduledAt: sendAt.toISOString(),
    payload: {
      textBody: finalBody,
      directEmail: true,
      direct: true,
      category,
      fromEmail,
      fromLabel,
      staffMember,
      identityId: identityId ? Number(identityId) : null,
      clientKey: normalizeClientKey({ email: recipient }),
      clientName: String(name || ''),
      ...(deferred ? { scheduled: true } : {}),
      ...(replyToId ? { replyToCommunicationId: replyToId } : {}),
    },
  });

  // Programmé pour plus tard : le cron/dispatch du moment venu s'en charge.
  const dispatched = communication.id && !deferred
    ? await dispatchDueCommunications({ limit: 3, centerId }).catch(() => null)
    : null;

  if (replyToId) {
    await linkReplyToInbound({
      centerId,
      replyToCommunicationId: replyToId,
      replyCommunicationId: communication.id || null,
      sentSubject: finalSubject,
      sentBody: finalBody,
      deps,
    }).catch(() => null);
  }

  return { communication, dispatched, resendConfigured: Boolean(process.env.RESEND_API_KEY) };
}

// Boucle fermée inbox : marque l'email reçu comme répondu + apprentissage
// implicite (réponse envoyée ≠ réponse proposée → leçon). Best-effort : ne
// bloque jamais l'envoi.
async function linkReplyToInbound({
  centerId,
  replyToCommunicationId,
  replyCommunicationId,
  sentSubject,
  sentBody,
  deps = {},
}) {
  const query = deps.query || defaultDeps().query;
  const found = await query(
    `select payload from communications where id = $1 and direction = 'inbound' limit 1;`,
    [Number(replyToCommunicationId)],
  );
  if (!found.rows.length) return;
  const payload = found.rows[0].payload && typeof found.rows[0].payload === 'object'
    ? found.rows[0].payload
    : {};
  await query(
    `update communications set payload = payload || $2::jsonb where id = $1;`,
    [Number(replyToCommunicationId), JSON.stringify({
      repliedAt: new Date().toISOString(),
      replyCommunicationId: replyCommunicationId || null,
    })],
  );
  const analysis = payload.analysis || null;
  if (analysis && analysis.reply && analysis.reply.body) {
    const { recordAgentLesson } = require('./email-agent');
    await recordAgentLesson({
      centerId,
      intent: analysis.intent || 'autre',
      questionExcerpt: String(payload.textBody || '').slice(0, 300),
      original: analysis.reply,
      sent: { subject: sentSubject, body: sentBody },
      deps: deps.query ? deps : undefined,
    });
  }
}

const CUSTOM_REQUEST_OCCASION_LABELS = {
  anniversaire: 'Anniversaire',
  amis: 'Entre amis / groupe',
  entreprise: 'Entreprise / team-building',
  ecole: 'École / association',
  autre: 'Autre',
};

// Accusé de réception d'une demande SUR MESURE (lead). Best-effort : renvoie
// { skipped } si Resend n'est pas configuré, ne lève jamais pour ne pas bloquer
// l'enregistrement du lead. Ne crée PAS de communication liée à une réservation
// (le lead n'a pas de reservationId).
async function sendCustomRequestAck(request = {}) {
  const recipient = String(request.email || '').trim();
  if (!recipient) return { skipped: true, reason: 'Email destinataire manquant.' };

  const details = [
    request.occasion ? ['Type d\'occasion', CUSTOM_REQUEST_OCCASION_LABELS[request.occasion] || request.occasion] : null,
    request.requestedDate ? ['Date souhaitée', request.requestedDate] : null,
    Number(request.pax) > 0 ? ['Personnes (approx.)', String(request.pax)] : null,
    request.company ? ['Société', request.company] : null,
  ].filter(Boolean);

  const firstName = String(request.contactName || '').trim().split(/\s+/)[0] || 'bonjour';
  const subject = 'Votre demande sur mesure — Fun Galaxy';
  const body = [
    `Bonjour ${firstName},`,
    '',
    'Nous avons bien reçu votre demande sur mesure. Un membre de notre équipe vous recontacte rapidement pour construire votre événement (privatisation, formule, devis entreprise…).',
    request.message ? `\nVotre message : « ${String(request.message).slice(0, 500)} »` : '',
    '',
    'À très vite,',
  ].filter((line) => line !== null).join('\n');

  const html = emailShell({
    title: 'Demande bien reçue',
    body,
    preheader: 'Nous revenons vers vous rapidement.',
    details,
    footer: 'Fun Galaxy — On vous recontacte très vite.',
    note: 'Cet email confirme la réception de votre demande. Il ne s\'agit pas encore d\'une réservation confirmée.',
  });

  try {
    const result = await sendEmail({
      recipient,
      subject,
      body: html,
      idempotencyKey: request.idempotencyKey || (request.id ? `custom-request-ack-${request.id}` : ''),
    });
    return { ok: !result.skipped, ...result };
  } catch (error) {
    return { skipped: true, reason: error.message || 'Envoi impossible.' };
  }
}

// Campagnes : un envoi PAR destinataire via la pipeline standard (queue,
// retries, historique). Idempotence par campagne+email : relancer la même
// campagne ne double jamais un envoi. Dispatch immédiat seulement si non
// programmée — sinon le worker s'en charge à l'heure dite.
async function enqueueCampaign({
  centerId,
  campaignId,
  recipients,
  subject,
  body,
  scheduledAt = null,
  fromEmail = '',
  fromLabel = '',
  personalize = (text) => text,
}) {
  let queued = 0;
  for (const recipient of recipients) {
    const personalSubject = personalize(subject, recipient);
    const personalBody = personalize(body, recipient);
    await createCommunication({
      centerId,
      reservationId: null,
      channel: 'email',
      templateId: `campaign_${campaignId}`,
      recipient: recipient.email,
      subject: personalSubject,
      body: emailShell({ title: personalSubject, body: personalBody, preheader: personalSubject }),
      status: 'queued',
      scheduledAt: scheduledAt || new Date().toISOString(),
      payload: { textBody: personalBody, campaignId, fromEmail, fromLabel },
      idempotencyKey: `campaign-${campaignId}-${recipient.email}`,
    });
    queued += 1;
  }
  if (!scheduledAt) {
    // Dispatch immédiat borné (retour visible tout de suite) ; le worker Railway
    // vide le reste de la file en continu (~60 s). Limite basse = pas de timeout
    // serverless sur un gros segment.
    await dispatchDueCommunications({ limit: Math.min(recipients.length, 12), centerId }).catch(() => null);
  }
  return { queued };
}

/* ============================================================================
   SÉQUENCES AUTOMATIQUES — config ON/OFF par centre, relance client 1-clic
   tracée, sweeps cron (anniversaire J-30, réactivation dormants) et stats.

   Principes : réutiliser la queue `communications` existante (jamais d'envoi
   direct), idempotence par clientKey via le journal des communications,
   AUCUNE promesse chiffrée dans les templates (l'offre = décision du gérant).
   Toutes les fonctions à effets acceptent `deps` injectables → testables sans
   base (cf. scripts/emails-automation-check.js).
   ========================================================================== */

// Défauts versionnés avec le code ; la table center_automation_settings ne
// stocke que les écarts. reactivation OFF par défaut : le gérant l'active.
const AUTOMATION_DEFAULTS = {
  confirmation: { enabled: true },
  reminder_48h: { enabled: true },
  post_visit: { enabled: true },
  birthday_j30: { enabled: true },
  reactivation: { enabled: false },
};

// Contenus/timings par défaut de chaque séquence — l'UI les affiche comme
// placeholders et « Réinitialiser » y revient. Les textes MIROIRENT ce que les
// builders produisent réellement (aucune promesse chiffrée).
const AUTOMATION_CONTENT_DEFAULTS = {
  confirmation: {
    subject: 'Votre réservation Fun Galaxy est confirmée',
    body: [
      'Bonjour {{nom}},',
      '',
      'C’est confirmé pour {{formule}}.',
      'On vous attend le {{date}} à {{heure}}.',
      'Merci d’arriver 10 minutes avant, surtout si le groupe doit être lancé ensemble.',
      '',
      'Le paiement se fera sur place.',
      'À très vite,',
      '{{centre}}',
    ].join('\n'),
    variables: ['prenom', 'nom', 'date', 'heure', 'formule', 'pax', 'centre', 'prix'],
  },
  reminder_48h: {
    subject: 'Petit rappel pour votre réservation Fun Galaxy',
    body: [
      'Bonjour {{nom}},',
      '',
      'Je vous confirme qu’on vous attend le {{date}} à {{heure}} chez {{centre}}.',
      'Si possible, venez 10 minutes avant l’heure prévue.',
      '',
      'À très vite,',
      '{{centre}}',
    ].join('\n'),
    offsetDays: 2,
    offsetRange: [1, 4],
    offsetLabel: 'jours avant la venue',
    variables: ['prenom', 'nom', 'date', 'heure', 'formule', 'pax', 'centre'],
  },
  post_visit: {
    subject: 'Merci pour votre visite chez Fun Galaxy',
    body: [
      'Bonjour {{nom}},',
      '',
      'Merci d’être venu chez Fun Galaxy.',
      'Si tout s’est bien passé, on sera ravi de vous revoir pour une prochaine session.',
      'Si quelque chose peut être amélioré, répondez simplement à ce message : votre retour arrive directement à l’équipe.',
      '',
      '{{centre}}',
    ].join('\n'),
    offsetDays: 1,
    offsetRange: [0, 3],
    offsetLabel: 'jours après la visite',
    variables: ['prenom', 'nom', 'centre'],
  },
  birthday_j30: {
    subject: 'Un anniversaire approche 🎂',
    body: [
      'Bonjour {{prenom}},',
      '',
      'L’année dernière (le {{date_fete}}), vous avez fêté un anniversaire chez nous — et on espère que c’était une belle journée.',
      'La date approche à nouveau : si vous voulez remettre ça, réservez tôt — on vous garde la table et on prépare tout.',
      '',
      'Répondez à ce message ou réservez en ligne, c’est le plus simple.',
      '',
      'À très vite,',
      'L’équipe Fun Galaxy',
    ].join('\n'),
    offsetDays: 30,
    offsetRange: [15, 60],
    offsetLabel: 'jours avant la date d’anniversaire',
    variables: ['prenom', 'date_fete', 'centre'],
  },
  reactivation: {
    subject: 'Ça fait un moment — on vous a gardé une place',
    body: [
      'Bonjour {{prenom}},',
      '',
      'Ça fait quelques mois qu’on ne vous a pas vus au centre. Le bowling, le laser game et les nouveautés vous attendent — en famille ou entre amis.',
      'Réservez en ligne quand vous voulez : c’est le plus rapide.',
      '',
      'Au plaisir de vous revoir,',
      'L’équipe Fun Galaxy',
    ].join('\n'),
    cap: 20,
    capRange: [5, 50],
    variables: ['prenom', 'centre'],
  },
};

// Défauts complets pour l'UI (contrat C1) : {enabled, subject, body,
// offsetDays?, cap?, variables, bornes}.
function getAutomationDefaults() {
  const defaults = {};
  for (const [key, def] of Object.entries(AUTOMATION_DEFAULTS)) {
    defaults[key] = { enabled: def.enabled, ...(AUTOMATION_CONTENT_DEFAULTS[key] || {}) };
  }
  return defaults;
}

function clampInteger(value, [min, max]) {
  return Math.max(min, Math.min(max, Number(value)));
}

// stored (jsonb brut) → settings résolus {enabled, subject?, body?,
// offsetDays?, cap?} — seuls les écarts valides sont exposés.
function resolveAutomationSettings(stored = {}) {
  const settings = {};
  for (const [key, def] of Object.entries(AUTOMATION_DEFAULTS)) {
    const raw = stored[key] && typeof stored[key] === 'object' ? stored[key] : {};
    const content = AUTOMATION_CONTENT_DEFAULTS[key] || {};
    const entry = { enabled: typeof raw.enabled === 'boolean' ? raw.enabled : def.enabled };
    if (typeof raw.subject === 'string' && raw.subject.trim()) entry.subject = raw.subject;
    if (typeof raw.body === 'string' && raw.body.trim()) entry.body = raw.body;
    if (content.offsetRange && Number.isInteger(Number(raw.offsetDays))) {
      entry.offsetDays = clampInteger(raw.offsetDays, content.offsetRange);
    }
    if (content.capRange && Number.isInteger(Number(raw.cap))) {
      entry.cap = clampInteger(raw.cap, content.capRange);
    }
    settings[key] = entry;
  }
  return settings;
}

// Séquence → template_id réellement écrits dans `communications` (pour stats).
const AUTOMATION_TEMPLATE_IDS = {
  confirmation: ['confirmation'],
  reminder_48h: ['reminder_48h'],
  post_visit: ['post_visit_followup'],
  birthday_j30: ['birthday_j30'],
  reactivation: ['reactivation'],
};

// Même clé client que le CRM front : téléphone (chiffres) sinon email minuscule.
function normalizeClientKey({ phone = '', email = '' } = {}) {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  if (digits.length >= 8) return digits;
  const mail = String(email || '').trim().toLowerCase();
  return mail || '';
}

function firstNameOf(name = '') {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  return first || 'vous';
}

function defaultDeps() {
  const { getPool } = require('./database');
  return { query: (text, params) => getPool().query(text, params) };
}

async function readStoredAutomationSettings(centerId, deps) {
  try {
    const result = await deps.query(
      'select settings from center_automation_settings where center_id = $1 limit 1;',
      [centerId],
    );
    const stored = result.rows[0]?.settings;
    return stored && typeof stored === 'object' ? stored : {};
  } catch (error) {
    return {};
  }
}

async function getAutomationSettings(centerId = 'libramont', deps = defaultDeps()) {
  const stored = await readStoredAutomationSettings(centerId, deps);
  return resolveAutomationSettings(stored);
}

// Mise à jour d'UNE séquence. `patch` : boolean (compat historique = enabled)
// ou { enabled?, subject?, body?, offsetDays?, cap?, reset? }. Validation
// serveur stricte (contrat C2) : messages FR exposables, variables inconnues
// rejetées, timings bornés. `reset` ne touche QUE le contenu (subject/body/
// timing/cap) — l'état ON/OFF choisi par le gérant est conservé.
async function setAutomationSetting(centerId = 'libramont', key, patch, deps = defaultDeps()) {
  if (!Object.prototype.hasOwnProperty.call(AUTOMATION_DEFAULTS, key)) {
    const error = new Error('Séquence inconnue.');
    error.expose = true;
    error.statusCode = 400;
    throw error;
  }
  const expose = (message) => {
    const error = new Error(message);
    error.expose = true;
    error.statusCode = 400;
    throw error;
  };
  const normalized = typeof patch === 'boolean'
    ? { enabled: patch }
    : (patch && typeof patch === 'object' ? patch : {});
  const content = AUTOMATION_CONTENT_DEFAULTS[key] || {};

  const stored = await readStoredAutomationSettings(centerId, deps);
  const entry = { ...(stored[key] && typeof stored[key] === 'object' ? stored[key] : {}) };

  if (normalized.reset === true) {
    delete entry.subject;
    delete entry.body;
    delete entry.offsetDays;
    delete entry.cap;
  }
  if (typeof normalized.enabled === 'boolean') entry.enabled = normalized.enabled;

  if (typeof normalized.subject === 'string') {
    const subject = normalized.subject.trim();
    if (!subject || subject === content.subject) {
      delete entry.subject;
    } else {
      if (subject.length > 140) expose('Objet trop long (140 caractères maximum).');
      const unknown = findUnknownAutomationTokens(subject, content.variables || []);
      if (unknown.length) expose(`Variable(s) inconnue(s) : ${unknown.join(', ')}. Disponibles : ${(content.variables || []).map((v) => `{{${v}}}`).join(' ')}.`);
      entry.subject = subject;
    }
  }
  if (typeof normalized.body === 'string') {
    const body = normalized.body.trim();
    if (!body || body === content.body) {
      delete entry.body;
    } else {
      if (body.length > 4000) expose('Message trop long (4 000 caractères maximum).');
      const unknown = findUnknownAutomationTokens(body, content.variables || []);
      if (unknown.length) expose(`Variable(s) inconnue(s) : ${unknown.join(', ')}. Disponibles : ${(content.variables || []).map((v) => `{{${v}}}`).join(' ')}.`);
      entry.body = body;
    }
  }
  if (normalized.offsetDays !== undefined && normalized.offsetDays !== null && normalized.offsetDays !== '') {
    if (!content.offsetRange) expose('Cette séquence n’a pas de délai réglable.');
    const offset = Number(normalized.offsetDays);
    const [min, max] = content.offsetRange;
    if (!Number.isInteger(offset) || offset < min || offset > max) {
      expose(`Délai invalide : entre ${min} et ${max} ${content.offsetLabel || 'jours'}.`);
    }
    if (offset === content.offsetDays) delete entry.offsetDays;
    else entry.offsetDays = offset;
  }
  if (normalized.cap !== undefined && normalized.cap !== null && normalized.cap !== '') {
    if (!content.capRange) expose('Cette séquence n’a pas de plafond réglable.');
    const cap = Number(normalized.cap);
    const [min, max] = content.capRange;
    if (!Number.isInteger(cap) || cap < min || cap > max) {
      expose(`Plafond invalide : entre ${min} et ${max} envois par semaine.`);
    }
    if (cap === content.cap) delete entry.cap;
    else entry.cap = cap;
  }

  const nextStored = { ...stored };
  if (Object.keys(entry).length) nextStored[key] = entry;
  else delete nextStored[key];

  await deps.query(
    `insert into center_automation_settings (center_id, settings, updated_at)
     values ($1, $2, now())
     on conflict (center_id) do update set settings = $2, updated_at = now();`,
    [centerId, JSON.stringify(nextStored)],
  );
  return resolveAutomationSettings(nextStored);
}

// Stats 30 j par séquence, depuis le journal communications (source de vérité).
async function getAutomationStats(centerId = 'libramont', deps = defaultDeps()) {
  const stats = {};
  for (const key of Object.keys(AUTOMATION_DEFAULTS)) stats[key] = { sent30d: 0, failed30d: 0 };
  try {
    const result = await deps.query(
      `select template_id, status, count(*)::int as n
       from communications
       where center_id = $1 and created_at > now() - interval '30 days'
       group by template_id, status;`,
      [centerId],
    );
    for (const row of result.rows) {
      const sequence = Object.entries(AUTOMATION_TEMPLATE_IDS)
        .find(([, ids]) => ids.includes(row.template_id))?.[0];
      if (!sequence) continue;
      if (['sent', 'delivered'].includes(row.status)) stats[sequence].sent30d += row.n;
      if (row.status === 'failed') stats[sequence].failed30d += row.n;
    }
  } catch (error) { /* stats best-effort : jamais bloquant */ }
  return stats;
}

// ── Relance client 1-clic (depuis la page Clients) ──────────────────────────
// Pattern sendDirectEmail : pas de reservationId, queue + dispatch immédiat.
// payload.relance = la trace qui alimente relanceStats (ROI du CRM).
const RELANCE_REASONS = new Set(['birthday', 'dormant', 'custom']);

async function sendClientRelance({
  centerId = 'libramont',
  email,
  name = '',
  phone = '',
  reason = 'custom',
  subject = '',
  body = '',
  staffMember = 'staff',
}, deps = {}) {
  const enqueue = deps.enqueue || createCommunication;
  const recipient = String(email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    const error = new Error('Adresse email du client invalide.');
    error.expose = true;
    throw error;
  }
  const safeReason = RELANCE_REASONS.has(reason) ? reason : 'custom';
  const finalSubject = String(subject || '').trim();
  const finalBody = String(body || '').trim();
  if (!finalSubject) { const e = new Error("L'objet est requis."); e.expose = true; throw e; }
  if (!finalBody) { const e = new Error('Le message est vide.'); e.expose = true; throw e; }
  const clientKey = normalizeClientKey({ phone, email: recipient });

  const communication = await enqueue({
    centerId,
    reservationId: null,
    channel: 'email',
    templateId: `relance_${safeReason}`,
    recipient,
    subject: finalSubject,
    // emailShell applique déjà textToHtml : passer le texte BRUT (une double
    // passe faisait apparaître les balises <p> en clair chez le client).
    body: emailShell({ title: finalSubject, body: finalBody, preheader: finalSubject }),
    status: 'queued',
    scheduledAt: new Date().toISOString(),
    payload: {
      textBody: finalBody,
      relance: true,
      reason: safeReason,
      clientKey,
      clientName: name,
      staffMember,
    },
  });

  const dispatched = communication.id
    ? await dispatchDueCommunications({ limit: 3, centerId }).catch(() => null)
    : null;

  return { communication, dispatched };
}

// ROI des relances : une relance est « convertie » si le MÊME client (email
// destinataire ou clé téléphone) a créé une réservation non annulée APRÈS
// l'envoi et dans les 60 jours. revenue = Σ prix de ces réservations.
async function getRelanceStats(centerId = 'libramont', { days = 90 } = {}, deps = defaultDeps()) {
  const window = Math.max(7, Math.min(365, Number(days) || 90));
  try {
    const result = await deps.query(
      `with relances as (
         select id, recipient, created_at, payload->>'clientKey' as client_key
         from communications
         where center_id = $1
           and payload->>'relance' = 'true'
           and created_at > now() - ($2 || ' days')::interval
       ),
       conversions as (
         select r.id as relance_id, res.id as reservation_id, res.price
         from relances r
         join reservations res
           on res.center_id = $1
          and res.status != 'cancelled'
          and res.created_at > r.created_at
          and res.created_at <= r.created_at + interval '60 days'
          and (
            lower(coalesce(res.email, '')) = lower(r.recipient)
            or (r.client_key != '' and regexp_replace(coalesce(res.phone, ''), '[^0-9+]', '', 'g') = r.client_key)
          )
       )
       select
         (select count(*)::int from relances) as sent,
         (select count(distinct relance_id)::int from conversions) as converted,
         coalesce((select sum(price) from (select distinct reservation_id, price from conversions) d), 0)::numeric as revenue;`,
      [centerId, String(window)],
    );
    const row = result.rows[0] || {};
    return {
      sent: Number(row.sent) || 0,
      converted: Number(row.converted) || 0,
      revenue: Math.round(Number(row.revenue) || 0),
      days: window,
    };
  } catch (error) {
    return { sent: 0, converted: 0, revenue: 0, days: window };
  }
}

// ── Notes client (mémoire terrain) ──────────────────────────────────────────
async function getClientNote(centerId = 'libramont', clientKey = '', deps = defaultDeps()) {
  if (!clientKey) return null;
  const result = await deps.query(
    'select body, updated_at from client_notes where center_id = $1 and client_key = $2 limit 1;',
    [centerId, clientKey],
  );
  const row = result.rows[0];
  return row ? { body: row.body, updatedAt: row.updated_at } : null;
}

async function saveClientNote(centerId = 'libramont', clientKey = '', body = '', deps = defaultDeps()) {
  if (!clientKey) { const e = new Error('Client inconnu.'); e.expose = true; throw e; }
  await deps.query(
    `insert into client_notes (center_id, client_key, body, updated_at)
     values ($1, $2, $3, now())
     on conflict (center_id, client_key) do update set body = $3, updated_at = now();`,
    [centerId, clientKey, String(body || '').slice(0, 4000)],
  );
  return { ok: true };
}

// ── Messages des séquences (sobres, FR belge, zéro promesse chiffrée) ───────
// Chaque builder accepte un override {subject?, body?} (texte du gérant, avec
// variables {{...}} substituées). Sans override : texte historique inchangé.
function buildBirthdayJ30Message({ name = '', partyDateFr = '', centerName = '' } = {}, overrides = null) {
  const prenom = firstNameOf(name);
  const subject = 'Un anniversaire approche 🎂';
  const body = [
    `Bonjour ${prenom},`,
    '',
    `L'année dernière${partyDateFr ? ` (le ${partyDateFr})` : ''}, vous avez fêté un anniversaire chez nous — et on espère que c'était une belle journée.`,
    'La date approche à nouveau : si vous voulez remettre ça, réservez tôt — on vous garde la table et on prépare tout.',
    '',
    'Répondez à ce message ou réservez en ligne, c\'est le plus simple.',
    '',
    'À très vite,',
    'L\'équipe Fun Galaxy',
  ].join('\n');
  return applyMessageOverrides({ subject, body }, overrides, {
    prenom: prenom || 'vous',
    date_fete: partyDateFr,
    centre: centerName || 'Fun Galaxy',
  });
}

function buildReactivationMessage({ name = '', centerName = '' } = {}, overrides = null) {
  const prenom = firstNameOf(name);
  const subject = 'Ça fait un moment — on vous a gardé une place';
  const body = [
    `Bonjour ${prenom},`,
    '',
    'Ça fait quelques mois qu\'on ne vous a pas vus au centre. Le bowling, le laser game et les nouveautés vous attendent — en famille ou entre amis.',
    'Réservez en ligne quand vous voulez : c\'est le plus rapide.',
    '',
    'Au plaisir de vous revoir,',
    'L\'équipe Fun Galaxy',
  ].join('\n');
  return applyMessageOverrides({ subject, body }, overrides, {
    prenom: prenom || 'vous',
    centre: centerName || 'Fun Galaxy',
  });
}

// Merci post-visite (déclenché par ops-jobs après la venue). Textes par défaut
// IDENTIQUES à l'historique (lib/ops-jobs.js) pour la non-régression.
function buildPostVisitMessage({ name = '' } = {}, overrides = null) {
  const subject = 'Merci pour votre visite chez Fun Galaxy';
  const body = [
    `Bonjour ${name || ''},`.trim(),
    '',
    'Merci d etre venu chez Fun Galaxy.',
    'Si tout sest bien passe, on sera ravi de vous revoir pour une prochaine session.',
    'Si quelque chose peut etre ameliore, repondez simplement a ce message: votre retour arrive directement a l equipe.',
    '',
    'Fun Galaxy',
  ].join('\n');
  return applyMessageOverrides({ subject, body }, overrides, {
    prenom: firstNameOf(name) || 'vous',
    nom: name || 'vous',
    centre: 'Fun Galaxy',
  });
}

// ── Sweeps cron ──────────────────────────────────────────────────────────────
// birthday_j30 : fêtes d'anniversaire d'il y a 330-345 j → email à J-30 de la
// date anniversaire (scheduled_at futur : la queue livre au bon moment).
// Idempotent : 1 envoi max par clientKey par ~an (journal communications).
async function runBirthdayJ30Sweep(centerId = 'libramont', deps = defaultDeps(), { today = null } = {}) {
  const enqueue = deps.enqueue || createCommunication;
  const settings = await getAutomationSettings(centerId, deps);
  if (!settings.birthday_j30.enabled) return { ok: true, skipped: 'disabled', enqueued: 0 };
  const todayStr = today || new Date().toISOString().slice(0, 10);
  // Délai réglable (défaut J-30). La fenêtre de scan suit le délai : on cible
  // les fêtes dont l'envoi (date anniversaire − offset) tombe entre J-5 et
  // J+10 — avec offset 30, c'est la fenêtre historique 330-345 j.
  const offsetDays = Number.isInteger(settings.birthday_j30.offsetDays)
    ? settings.birthday_j30.offsetDays
    : 30;
  const windowStartDays = 365 - offsetDays + 10;
  const windowEndDays = 365 - offsetDays - 5;
  const centerName = (() => {
    try { return getCenter(centerId).name; } catch (error) { return 'Fun Galaxy'; }
  })();

  const candidates = await deps.query(
    `select id, name, phone, email, date::text as date
     from reservations
     where center_id = $1
       and status != 'cancelled'
       and occasion = 'anniversaire'
       and coalesce(email, '') != ''
       and date between ($2::date - ($3 || ' days')::interval) and ($2::date - ($4 || ' days')::interval)
     order by date asc;`,
    [centerId, todayStr, String(windowStartDays), String(windowEndDays)],
  );

  let enqueued = 0;
  const skipped = [];
  for (const row of candidates.rows) {
    const clientKey = normalizeClientKey({ phone: row.phone, email: row.email });
    if (!clientKey) continue;
    // Idempotence : déjà prévenu pour ce cycle d'anniversaire ?
    const already = await deps.query(
      `select 1 from communications
       where center_id = $1 and template_id = 'birthday_j30'
         and payload->>'clientKey' = $2
         and created_at > now() - interval '300 days'
       limit 1;`,
      [centerId, clientKey],
    );
    if (already.rows.length) { skipped.push(clientKey); continue; }

    // Anniversaire de la fête = date + 1 an ; envoi à J-offset (ou maintenant
    // si la fenêtre d'envoi est déjà entamée de ≤15 j).
    const party = new Date(`${row.date}T12:00:00Z`);
    const nextParty = new Date(party); nextParty.setUTCFullYear(party.getUTCFullYear() + 1);
    const sendAt = new Date(nextParty); sendAt.setUTCDate(sendAt.getUTCDate() - offsetDays);
    const now = new Date(`${todayStr}T08:00:00Z`);
    const lateDays = (now - sendAt) / 86400000;
    if (lateDays > 15) { skipped.push(clientKey); continue; } // trop tard, cycle raté
    const scheduledAt = lateDays >= 0 ? now : sendAt;

    const partyDateFr = party.toLocaleDateString('fr-BE', { day: 'numeric', month: 'long' });
    const message = buildBirthdayJ30Message({ name: row.name, partyDateFr, centerName }, settings.birthday_j30);
    await enqueue({
      centerId,
      reservationId: null,
      channel: 'email',
      templateId: 'birthday_j30',
      recipient: String(row.email).trim(),
      subject: message.subject,
      // Texte BRUT : emailShell fait la conversion HTML (double passe = balises visibles).
      body: emailShell({ title: message.subject, body: message.body, preheader: message.subject }),
      status: 'queued',
      scheduledAt: scheduledAt.toISOString(),
      payload: {
        textBody: message.body,
        sequence: 'birthday_j30',
        clientKey,
        clientName: row.name,
        partyDate: row.date,
      },
    });
    enqueued += 1;
  }
  return { ok: true, enqueued, skipped: skipped.length, scanned: candidates.rows.length };
}

// reactivation : clients ≥2 visites, dormants 60-90 j, sans résa future.
// Cap 20/run, idempotent 90 j. OFF par défaut (le gérant l'active).
async function runReactivationSweep(centerId = 'libramont', deps = defaultDeps(), { today = null, cap = null } = {}) {
  const enqueue = deps.enqueue || createCommunication;
  const settings = await getAutomationSettings(centerId, deps);
  if (!settings.reactivation.enabled) return { ok: true, skipped: 'disabled', enqueued: 0 };
  const todayStr = today || new Date().toISOString().slice(0, 10);
  // Cap réglable par le gérant (5..50, défaut 20) ; un cap explicite passé en
  // option (tests, cron piloté) garde la priorité.
  const effectiveCap = Number.isInteger(Number(cap)) && Number(cap) > 0
    ? Number(cap)
    : (Number.isInteger(settings.reactivation.cap) ? settings.reactivation.cap : 20);
  const centerName = (() => {
    try { return getCenter(centerId).name; } catch (error) { return 'Fun Galaxy'; }
  })();

  const candidates = await deps.query(
    `with clients as (
       select
         case when length(regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g')) >= 8
              then regexp_replace(phone, '[^0-9+]', '', 'g')
              else lower(coalesce(email, '')) end as client_key,
         max(coalesce(email, '')) filter (where coalesce(email, '') != '') as email,
         max(name) as name,
         count(*) filter (where status != 'cancelled') as visits,
         max(date) filter (where status != 'cancelled') as last_visit,
         count(*) filter (where status != 'cancelled' and date >= $2::date) as future
       from reservations
       where center_id = $1
       group by 1
     )
     select client_key, email, name, last_visit::text as last_visit
     from clients
     where client_key != '' and coalesce(email, '') != ''
       and visits >= 2 and future = 0
       and last_visit between ($2::date - interval '90 days') and ($2::date - interval '60 days')
     order by last_visit desc
     limit $3;`,
    [centerId, todayStr, Math.max(effectiveCap * 2, effectiveCap)],
  );

  let enqueued = 0;
  for (const row of candidates.rows) {
    if (enqueued >= effectiveCap) break;
    const already = await deps.query(
      `select 1 from communications
       where center_id = $1 and template_id = 'reactivation'
         and payload->>'clientKey' = $2
         and created_at > now() - interval '90 days'
       limit 1;`,
      [centerId, row.client_key],
    );
    if (already.rows.length) continue;
    const message = buildReactivationMessage({ name: row.name, centerName }, settings.reactivation);
    await enqueue({
      centerId,
      reservationId: null,
      channel: 'email',
      templateId: 'reactivation',
      recipient: String(row.email).trim(),
      subject: message.subject,
      // Texte BRUT : emailShell fait la conversion HTML (double passe = balises visibles).
      body: emailShell({ title: message.subject, body: message.body, preheader: message.subject }),
      status: 'queued',
      scheduledAt: new Date().toISOString(),
      payload: {
        textBody: message.body,
        sequence: 'reactivation',
        clientKey: row.client_key,
        clientName: row.name,
        lastVisit: row.last_visit,
      },
    });
    enqueued += 1;
  }
  return { ok: true, enqueued, scanned: candidates.rows.length };
}

/* ── SÉQUENCES PERSONNALISÉES — le gérant crée SES automatisations ──────────
   Stockées dans center_automation_settings.settings.custom_sequences (jsonb,
   pas de migration). Déclencheurs fermés mais paramétrables ; exécution par
   le sweep cron quotidien, idempotente, plafonnée. KISS : max 10 séquences.
   Shape : { id, name, enabled, trigger: {type, days?, weekday?}, segment?,
             subject, body, cap, createdAt }. ── */

const CUSTOM_TRIGGERS = {
  after_visit: {
    label: 'X jours après une visite',
    days: [1, 90],
    variables: ['prenom', 'centre'],
  },
  before_visit: {
    label: 'X jours avant une venue prévue',
    days: [1, 60],
    variables: ['prenom', 'centre', 'date', 'heure', 'formule', 'pax'],
  },
  inactive: {
    label: 'Clients plus vus depuis X jours',
    days: [30, 365],
    variables: ['prenom', 'centre'],
  },
  weekly: {
    label: 'Chaque semaine, un jour fixe',
    variables: ['prenom', 'centre'],
  },
};
const CUSTOM_SEGMENTS = {
  all: 'Tous les clients avec email',
  dormant: 'Dormants (+90 jours)',
  loyal: 'Fidèles (4 visites ou 500 €)',
  birthdays: 'Clients anniversaire',
};
const CUSTOM_SEQUENCE_LIMITS = {
  maxSequences: 10, name: 60, subject: 140, body: 4000, cap: [1, 100],
  triggers: Object.fromEntries(Object.entries(CUSTOM_TRIGGERS).map(([key, t]) => [key, { label: t.label, days: t.days || null, variables: t.variables }])),
  segments: CUSTOM_SEGMENTS,
};

async function listCustomSequences(centerId = 'libramont', deps = defaultDeps()) {
  try {
    const result = await deps.query(
      'select settings from center_automation_settings where center_id = $1 limit 1;',
      [centerId],
    );
    const list = result.rows?.[0]?.settings?.custom_sequences;
    return Array.isArray(list) ? list : [];
  } catch (error) {
    return [];
  }
}

async function writeCustomSequences(centerId, sequences, deps) {
  await deps.query(
    `insert into center_automation_settings (center_id, settings, updated_at)
     values ($1, jsonb_build_object('custom_sequences', $2::jsonb), now())
     on conflict (center_id)
     do update set settings = center_automation_settings.settings || jsonb_build_object('custom_sequences', $2::jsonb), updated_at = now();`,
    [centerId, JSON.stringify(sequences)],
  );
}

function fail(message) { const error = new Error(message); error.expose = true; throw error; }

function validateCustomSequence(input = {}) {
  const name = String(input.name || '').trim();
  if (!name) fail('Donnez un nom à la séquence (ex. « Relance après visite »).');
  if (name.length > CUSTOM_SEQUENCE_LIMITS.name) fail(`Nom trop long (${CUSTOM_SEQUENCE_LIMITS.name} caractères max).`);
  const trigger = input.trigger || {};
  const meta = CUSTOM_TRIGGERS[trigger.type];
  if (!meta) fail('Choisissez un déclencheur valide.');
  const out = { type: trigger.type };
  if (meta.days) {
    const days = Number(trigger.days);
    if (!Number.isInteger(days) || days < meta.days[0] || days > meta.days[1]) {
      fail(`Le délai doit être entre ${meta.days[0]} et ${meta.days[1]} jours.`);
    }
    out.days = days;
  }
  if (trigger.type === 'weekly') {
    const weekday = Number(trigger.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) fail('Choisissez le jour de la semaine.');
    out.weekday = weekday;
  }
  let segment = null;
  if (trigger.type === 'weekly') {
    segment = String(input.segment || 'all');
    if (!CUSTOM_SEGMENTS[segment]) fail('Choisissez une cible valide.');
  }
  const subject = String(input.subject || '').trim();
  const body = String(input.body || '').trim();
  if (!subject) fail("L'objet du message est requis.");
  if (subject.length > CUSTOM_SEQUENCE_LIMITS.subject) fail(`Objet trop long (${CUSTOM_SEQUENCE_LIMITS.subject} caractères max).`);
  if (!body) fail('Le message est vide.');
  if (body.length > CUSTOM_SEQUENCE_LIMITS.body) fail(`Message trop long (${CUSTOM_SEQUENCE_LIMITS.body} caractères max).`);
  const unknown = findUnknownAutomationTokens(`${subject}\n${body}`, meta.variables);
  if (unknown.length) fail(`Variable(s) non disponible(s) pour ce déclencheur : ${unknown.join(', ')}. Disponibles : ${meta.variables.map((v) => `{{${v}}}`).join(', ')}.`);
  const cap = Number(input.cap || 20);
  if (!Number.isInteger(cap) || cap < CUSTOM_SEQUENCE_LIMITS.cap[0] || cap > CUSTOM_SEQUENCE_LIMITS.cap[1]) {
    fail(`Le plafond d'envois doit être entre ${CUSTOM_SEQUENCE_LIMITS.cap[0]} et ${CUSTOM_SEQUENCE_LIMITS.cap[1]}.`);
  }
  return {
    name, trigger: out, segment, subject, body, cap,
    enabled: input.enabled !== false,
  };
}

async function saveCustomSequence(centerId = 'libramont', input = {}, deps = defaultDeps()) {
  const sequences = await listCustomSequences(centerId, deps);
  const validated = validateCustomSequence(input);
  const existingIndex = input.id ? sequences.findIndex((item) => item.id === input.id) : -1;
  if (existingIndex >= 0) {
    sequences[existingIndex] = { ...sequences[existingIndex], ...validated };
  } else {
    if (sequences.length >= CUSTOM_SEQUENCE_LIMITS.maxSequences) {
      fail(`Maximum ${CUSTOM_SEQUENCE_LIMITS.maxSequences} séquences personnalisées — supprimez-en une d'abord.`);
    }
    sequences.push({
      id: `cs_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
      createdAt: new Date().toISOString(),
      ...validated,
    });
  }
  await writeCustomSequences(centerId, sequences, deps);
  return sequences;
}

async function toggleCustomSequence(centerId, id, enabled, deps = defaultDeps()) {
  const sequences = await listCustomSequences(centerId, deps);
  const sequence = sequences.find((item) => item.id === id);
  if (!sequence) fail('Séquence introuvable.');
  sequence.enabled = Boolean(enabled);
  await writeCustomSequences(centerId, sequences, deps);
  return sequences;
}

async function deleteCustomSequence(centerId, id, deps = defaultDeps()) {
  const sequences = await listCustomSequences(centerId, deps);
  const next = sequences.filter((item) => item.id !== id);
  if (next.length === sequences.length) fail('Séquence introuvable.');
  await writeCustomSequences(centerId, next, deps);
  return next;
}

// Fenêtre d'idempotence par type : une date précise (after/before), 90 j
// glissants (inactive), la semaine ISO courante (weekly).
function customPeriodKey(sequence, todayStr) {
  if (sequence.trigger.type === 'weekly') {
    const date = new Date(`${todayStr}T00:00:00Z`);
    const jan1 = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((date - jan1) / 86400000 + jan1.getUTCDay() + 1) / 7);
    return `${date.getUTCFullYear()}w${week}`;
  }
  return todayStr;
}

// Candidats d'une séquence : SQL calquées sur les sweeps éprouvés (identité
// client téléphone > email, email requis, résa annulée exclue).
async function findCustomSequenceCandidates(sequence, centerId, todayStr, deps) {
  const { type, days } = sequence.trigger;
  const clientsCte = `with clients as (
       select
         case when length(regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g')) >= 8
              then regexp_replace(phone, '[^0-9+]', '', 'g')
              else lower(coalesce(email, '')) end as client_key,
         max(coalesce(email, '')) filter (where coalesce(email, '') != '') as email,
         max(name) as name,
         count(*) filter (where status != 'cancelled') as visits,
         sum(coalesce(price, 0)) filter (where status != 'cancelled') as revenue,
         max(date) filter (where status != 'cancelled') as last_visit,
         count(*) filter (where status != 'cancelled' and date >= $2::date) as future,
         count(*) filter (where status != 'cancelled' and lower(coalesce(occasion, '')) = 'anniversaire') as birthdays
       from reservations
       where center_id = $1
       group by 1
     )`;
  if (type === 'after_visit') {
    return deps.query(
      `${clientsCte}
       select client_key, email, name from clients
       where client_key != '' and email != '' and future = 0
         and last_visit = ($2::date - ($3 || ' days')::interval)::date
       limit $4;`,
      [centerId, todayStr, String(days), sequence.cap * 2],
    );
  }
  if (type === 'inactive') {
    return deps.query(
      `${clientsCte}
       select client_key, email, name from clients
       where client_key != '' and email != '' and future = 0 and visits >= 1
         and last_visit <= ($2::date - ($3 || ' days')::interval)::date
       order by last_visit desc
       limit $4;`,
      [centerId, todayStr, String(days), sequence.cap * 2],
    );
  }
  if (type === 'before_visit') {
    return deps.query(
      `select id, name, email, phone, date::text as date, start_time as "startTime",
              formule_id as "formuleId", pax
       from reservations
       where center_id = $1 and status != 'cancelled' and coalesce(email, '') != ''
         and date = ($2::date + ($3 || ' days')::interval)::date
       limit $4;`,
      [centerId, todayStr, String(days), sequence.cap * 2],
    );
  }
  // weekly : audience du segment choisi. $2 (date du jour) est toujours
  // référencé par la CTE (colonne `future`), le jeu de paramètres est fixe.
  const filters = {
    all: 'true',
    dormant: `last_visit <= ($2::date - interval '90 days') and future = 0`,
    loyal: '(visits >= 4 or revenue >= 500)',
    birthdays: 'birthdays > 0',
  };
  return deps.query(
    `${clientsCte}
     select client_key, email, name from clients
     where client_key != '' and email != '' and ${filters[sequence.segment] || 'true'}
     order by last_visit desc
     limit $3;`,
    [centerId, todayStr, sequence.cap * 2],
  );
}

async function runCustomSequencesSweep(centerId = 'libramont', deps = defaultDeps(), { today = null } = {}) {
  const enqueue = deps.enqueue || createCommunication;
  const sequences = await listCustomSequences(centerId, deps);
  const active = sequences.filter((sequence) => sequence.enabled);
  if (!active.length) return { ok: true, enqueued: 0, sequences: 0 };
  const todayStr = today || new Date().toISOString().slice(0, 10);
  const weekdayToday = new Date(`${todayStr}T12:00:00Z`).getUTCDay();
  const centerName = (() => {
    try { return getCenter(centerId).name; } catch (error) { return 'Fun Galaxy'; }
  })();

  let totalEnqueued = 0;
  const details = [];
  for (const sequence of active) {
    if (sequence.trigger.type === 'weekly' && sequence.trigger.weekday !== weekdayToday) continue;
    let candidates;
    try {
      candidates = await findCustomSequenceCandidates(sequence, centerId, todayStr, deps);
    } catch (error) {
      details.push({ id: sequence.id, error: true });
      continue;
    }
    const periodKey = customPeriodKey(sequence, todayStr);
    let enqueued = 0;
    for (const row of candidates.rows || []) {
      if (enqueued >= sequence.cap) break;
      const clientKey = row.client_key || normalizeClientKey({ phone: row.phone, email: row.email });
      const dedupeKey = `${sequence.id}:${clientKey}:${periodKey}`;
      const already = await deps.query(
        `select 1 from communications
         where center_id = $1 and template_id = $2
           and payload->>'dedupeKey' = $3
         limit 1;`,
        [centerId, `custom_${sequence.id}`, dedupeKey],
      );
      if (already.rows.length) continue;
      const vars = {
        prenom: firstNameOf(row.name) || 'vous',
        centre: centerName,
        ...(sequence.trigger.type === 'before_visit' ? {
          date: row.date || '',
          heure: String(row.startTime || '').slice(0, 5),
          formule: row.formuleId || 'votre réservation',
          pax: String(row.pax || ''),
        } : {}),
      };
      const subject = applyAutomationVars(sequence.subject, vars);
      const bodyText = applyAutomationVars(sequence.body, vars);
      await enqueue({
        centerId,
        reservationId: sequence.trigger.type === 'before_visit' ? Number(row.id) || null : null,
        channel: 'email',
        templateId: `custom_${sequence.id}`,
        recipient: String(row.email).trim(),
        subject,
        body: emailShell({ title: subject, body: bodyText, preheader: subject }),
        status: 'queued',
        scheduledAt: new Date().toISOString(),
        payload: {
          textBody: bodyText,
          sequence: 'custom',
          sequenceId: sequence.id,
          sequenceName: sequence.name,
          clientKey,
          clientName: row.name || '',
          dedupeKey,
        },
      });
      enqueued += 1;
    }
    totalEnqueued += enqueued;
    details.push({ id: sequence.id, name: sequence.name, enqueued });
  }
  return { ok: true, enqueued: totalEnqueued, sequences: active.length, details };
}

module.exports = {
  buildClientMessage,
  sendCustomRequestAck,
  buildDelayChangeMessage,
  buildMessage,
  buildEmailSamples,
  emailShell,
  dispatchDueCommunications,
  enqueueDelayChangeCommunications,
  enqueueReservationCommunications,
  listClientMessageChannels,
  listClientMessageTemplates,
  listDelayNotificationChannels,
  normalizePhoneForSms,
  sendClientMessage,
  sendDirectEmail,
  enqueueCampaign,
  // Séquences automatiques + relances
  AUTOMATION_DEFAULTS,
  normalizeClientKey,
  getAutomationSettings,
  getAutomationDefaults,
  setAutomationSetting,
  getAutomationStats,
  sendClientRelance,
  getRelanceStats,
  getClientNote,
  saveClientNote,
  buildBirthdayJ30Message,
  buildReactivationMessage,
  buildPostVisitMessage,
  runBirthdayJ30Sweep,
  runReactivationSweep,
  // Séquences personnalisées (créées par le gérant)
  CUSTOM_SEQUENCE_LIMITS,
  listCustomSequences,
  saveCustomSequence,
  toggleCustomSequence,
  deleteCustomSequence,
  runCustomSequencesSweep,
  __test: {
    isSimulationCommunication,
    buildClientMessageVars,
    CLIENT_MESSAGE_TEMPLATES,
    applyAutomationVars,
    findUnknownAutomationTokens,
  },
};
