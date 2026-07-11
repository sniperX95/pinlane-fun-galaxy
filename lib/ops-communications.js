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

function buildMessage({ reservation, templateId, channel }) {
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

  if (email) {
    const templateId = validationMode === 'staff_review' ? 'request_received' : 'confirmation';
    if (wantsTemplate(templateId)) {
      const message = buildMessage({ reservation, templateId, channel: 'email' });
      created.push(createCommunication({
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

    const reminderDate = addDaysToDateStr(reservation.date, -2);
    const reminderAt = zonedTimeToUtc(reminderDate, '10:00').toISOString();
    if (wantsTemplate('reminder_48h') && isFuture(reminderAt, 5)) {
      const reminder = buildMessage({ reservation, templateId: 'reminder_48h', channel: 'email' });
      created.push(createCommunication({
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
      created.push(createCommunication({
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
    created.push(createCommunication({
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

// Envoi libre depuis le studio mails : MÊME pipeline que les messages client
// (communication en file + dispatch immédiat) — historique et retries unifiés.
async function sendDirectEmail({
  centerId = 'libramont',
  to,
  subject = '',
  body = '',
  fromEmail = '',
  fromLabel = '',
  category = 'direct',
  templateRef = '',
  staffMember = 'direction',
}) {
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

  const communication = await createCommunication({
    centerId,
    reservationId: null,
    channel: 'email',
    templateId: templateRef ? `studio_${templateRef}` : `studio_${category}`,
    recipient,
    subject: finalSubject,
    body: emailShell({ title: finalSubject, body: finalBody, preheader: finalSubject }),
    status: 'queued',
    scheduledAt: new Date().toISOString(),
    payload: {
      textBody: finalBody,
      directEmail: true,
      category,
      fromEmail,
      fromLabel,
      staffMember,
    },
  });

  const dispatched = communication.id
    ? await dispatchDueCommunications({ limit: 3, centerId }).catch(() => null)
    : null;

  return { communication, dispatched, resendConfigured: Boolean(process.env.RESEND_API_KEY) };
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
  __test: {
    isSimulationCommunication,
    buildClientMessageVars,
    CLIENT_MESSAGE_TEMPLATES,
  },
};
