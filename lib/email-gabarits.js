'use strict';
// LA GALERIE DES GABARITS DE MAIL (2026-11-12).
//
// Ansar : « l ensemble des mails designement parlant pas top, faut plein de
// versions qu on peut choisir sur Pinlane, certaines sur mesure, certaines
// vraiment dingues [...] et fait gaffe pour qu on soit le plus possible dans la
// boite principale ».
//
// Les cinq gabarits d avant (simple, classique, epure, carte, contraste) restent
// dans lib/ops-communications.js, a l octet pres. Ceux d ici ont leur propre
// montage, sur la meme mecanique : le corps de l auteur, le recapitulatif, le
// bouton, la note, puis la signature, qui ferme le mail, et le pied.
//
// TROIS FAMILLES, une regle de boite de reception chacune :
//   - principale : pour tous les mails. Zero image dans le gabarit, la seule
//     image du mail reste celle de la signature ; texte d abord.
//   - centre     : sur mesure, avec la vraie photo de l activite reservee, tiree
//     de la fiche du centre (branding.emailPhotosActivites). Une image, celle
//     de l en-tete : la signature passe alors en texte.
//   - campagne   : les grands formats, plusieurs vraies photos. Ils ne servent
//     qu aux campagnes (rangees en Promotions de toute facon) : un mail
//     automatique qui les rencontre prend leur repli de la boite principale.
//
// LA LANGUE VISUELLE VALIDEE PAR ANSAR, et rien d autre : ses vraies photos, la
// typo d affiche pour les noms, les dates et les heures, des aplats pleins aux
// couleurs du centre. Jamais de degrade, de halo, de neon, de trait fin entre
// deux lignes, de transparence, de pictogramme, de carte a filet.

// Le jury du 12/11 a fait retirer l « Aplat » (le nom du centre en capitales sur un
// bandeau violet plein : Ansar l avait juge « super moche » le 04/11 sur la console)
// et les bandeaux de titre violets des gabarits photo. La couleur du centre ne sert
// plus qu au billet, qui dit ou en est la reservation, et aux petits libelles.
const FAMILLES = [
  { id: 'principale', label: 'Boîte principale', aide: 'Pour tous les mails. Peu d’images et de liens, pour arriver dans la boîte principale de Gmail.' },
  { id: 'centre', label: 'Sur mesure', aide: 'La vraie photo de ce que le client a réservé, en tête du mail.' },
  { id: 'campagne', label: 'Campagnes', aide: 'Les grands formats, pour les campagnes seulement. Les mails automatiques gardent un gabarit de la boîte principale.' },
  { id: 'avant', label: 'Les gabarits d’avant', aide: 'Ceux d’avant la galerie, gardés pour les centres qui les ont choisis.' },
];

const GABARITS = [
  { id: 'billet', label: 'Billet', famille: 'principale', description: 'Le jour et l’heure en grand sur la couleur du centre, comme un billet d’entrée.' },
  // « Grand jour » et pas « Affiche » : la signature a deja une forme Affiche dans la meme page.
  { id: 'affiche', label: 'Grand jour', famille: 'principale', description: 'Le jour et l’heure en très grand, en lettres d’affiche, sans aucun cadre.' },
  { id: 'score', label: 'Tableau de score', famille: 'principale', description: 'Le jour et l’heure en grand dans un tableau sombre, comme l’écran des pistes.' },
  { id: 'lettre', label: 'Lettre', famille: 'principale', description: 'Comme un mail écrit à la main, le rendez-vous en une phrase sous le titre.' },
  { id: 'photo', label: 'Photo de l’activité', famille: 'centre', description: 'La vraie photo de l’activité réservée en tête, puis le billet.' },
  { id: 'grand-format', label: 'Grand format', famille: 'campagne', repli: 'photo', description: 'Une grande photo, le titre en affiche, une seconde photo de la même activité.' },
  { id: 'vitrine', label: 'Vitrine', famille: 'campagne', repli: 'billet', description: 'Le titre en affiche, puis deux vraies photos du centre avec leur nom.' },
];
const IDS = GABARITS.map((g) => g.id);

function trouver(id) {
  return GABARITS.find((g) => g.id === String(id || '')) || null;
}

// Un mail automatique ne prend jamais un grand format : son repli de la boite principale.
function pourLEnvoi(id, { transactionnel = false } = {}) {
  const g = trouver(id);
  if (!g) return null;
  if (transactionnel && g.famille === 'campagne') return trouver(g.repli) || trouver('billet');
  return g;
}

// ── Couleurs ────────────────────────────────────────────────────────────────
const HEX = /^#[0-9a-f]{6}$/i;
function rgb(hex) { const n = parseInt(String(hex).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function versHex([r, g, b]) { return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`; }
// Un melange PLEIN (jamais une transparence) : t = part de la seconde couleur.
function melange(a, b, t) { const [x, y] = [rgb(a), rgb(b)]; return versHex(x.map((v, i) => v + (y[i] - v) * t)); }
function luminance(hex) { const c = rgb(hex).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
function contraste(a, b) { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); }
const INSECABLE = String.fromCharCode(0xa0);

// ── Le recapitulatif lu par role ────────────────────────────────────────────
// Les libelles viennent de buildDefaultMessage (Date, Heure, Participants, Offre,
// Montant estime, Reservation, Centre). Un mail sans date ni heure garde ses
// lignes, posees sans trait.
function roles(details) {
  const lignes = (Array.isArray(details) ? details : []).filter((d) => d && d.label && String(d.value || '').trim());
  const prendre = (rx) => {
    const i = lignes.findIndex((d) => rx.test(String(d.label)));
    return i < 0 ? null : lignes.splice(i, 1)[0];
  };
  const r = {
    date: prendre(/^date$/i),
    heure: prendre(/^heure|^arriv/i),
    joueurs: prendre(/participants|joueurs|personnes/i),
    offre: prendre(/^offre|^formule|^activit/i),
    montant: prendre(/montant|prix|total/i),
    numero: prendre(/^r[ée]servation|num[ée]ro/i),
    centre: prendre(/^centre$/i),
  };
  r.autres = lignes;
  return r;
}

function construire(o) {
  const { escapeHtml, espaces, THEME, AFFICHE } = o.outils;
  const e = (t) => espaces(escapeHtml(t));
  const police = THEME.font;
  const accent = HEX.test(o.couleur) && o.couleur.toLowerCase() !== THEME.ink.toLowerCase() ? o.couleur : '#2d2a3e';
  const surAccent = o.outils.texteSurAplat(accent);
  const fonce = melange(accent, '#000000', 0.32);
  // La couleur du centre ecrite sur la page blanche : elle-meme si elle se lit,
  // sinon sa version foncee, sinon l encre (un jaune clair ne s ecrit pas).
  const accentTexte = contraste(accent, '#ffffff') >= 4.5 ? accent : (contraste(fonce, '#ffffff') >= 4.5 ? fonce : THEME.ink);
  const nuit = '#17151f';
  const r = roles(o.details);
  const valeur = (d) => (d ? String(d.value).trim() : '');
  const joueurs = r.joueurs ? `${e(valeur(r.joueurs))} ${/^\d+$/.test(valeur(r.joueurs)) ? (Number(valeur(r.joueurs)) > 1 ? 'participants' : 'participant') : ''}`.trim() : '';
  const autresHtml = (couleurLabel, couleurValeur) => r.autres.map((d) => `
              <tr>
                <td style="padding:6px 0;font-family:${police};font-size:13px;line-height:1.4;color:${couleurLabel};" width="42%" valign="top">${e(d.label)}</td>
                <td style="padding:6px 0;font-family:${police};font-size:14px;line-height:1.4;font-weight:700;color:${couleurValeur};text-align:right;" valign="top">${e(d.value)}</td>
              </tr>`).join('');
  const tableau = (contenu, style = '') => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;${style}">${contenu}</table>`;
  const enAffiche = (texte, taille, couleurTexte, extra = '', classe = 'fgx-affiche') => `<p class="${classe}" style="margin:0;font-family:${AFFICHE};font-size:${taille}px;line-height:1.12;font-weight:400;letter-spacing:0.4px;text-transform:uppercase;color:${couleurTexte};${extra}">${e(texte)}</p>`;
  const petit = (texte, couleurTexte, extra = '') => `<p style="margin:0;font-family:${police};font-size:11px;line-height:1.4;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${couleurTexte};${extra}">${e(texte)}</p>`;

  // LE BILLET : le jour puis l heure en affiche sur la couleur du centre, les plus
  // grandes lignes du mail (jury du 12/11 : la formule de la signature ne passe plus
  // devant le rendez-vous). Le talon plus fonce porte le groupe et le numero a gauche,
  // le montant en affiche a droite. Aucun point entre deux morceaux : rien ne pend en
  // bout de ligne au telephone.
  // `marge` : sous le corps par defaut, ou EN_TETE quand le recapitulatif ouvre le mail.
  const surFonce = melange('#ffffff', fonce, 0.28);
  const billet = (marge = 'margin:24px 0 6px;') => {
    if (!r.date && !r.heure) return lignesSimples(marge);
    const gauche = [joueurs, r.numero ? `${e(r.numero.label)} ${e(valeur(r.numero))}` : ''].filter(Boolean);
    const talon = gauche.length || r.montant ? `<tr>
              <td bgcolor="${fonce}" style="background:${fonce};border-radius:0 0 16px 16px;padding:14px 24px 16px;">
                ${tableau(`<tr>
                  <td valign="bottom" style="font-family:${police};font-size:14px;line-height:1.55;font-weight:600;color:#ffffff;">${gauche.map((g, i) => `<p style="margin:0;${i ? `font-weight:500;color:${surFonce};` : ''}">${g}</p>`).join('')}</td>
                  ${r.montant ? `<td align="right" valign="bottom" style="padding:0 0 0 12px;white-space:nowrap;">
                    ${petit(r.montant.label, surFonce, 'margin-bottom:3px;text-align:right;')}
                    ${enAffiche(valeur(r.montant), 26, '#ffffff', 'text-align:right;', 'fgx-montant')}
                  </td>` : ''}
                </tr>`, 'border-collapse:collapse;')}
              </td>
            </tr>` : '';
    return tableau(`
            <tr>
              <td bgcolor="${accent}" style="background:${accent};border-radius:${talon ? '16px 16px 0 0' : '16px'};padding:22px 24px 22px;">
                ${r.offre ? petit(valeur(r.offre), surAccent, 'margin-bottom:10px;') : ''}
                ${r.date ? enAffiche(valeur(r.date), 38, surAccent, 'line-height:1.04;', 'fgx-grand') : ''}
                ${r.heure ? enAffiche(valeur(r.heure), 38, surAccent, 'line-height:1.04;', 'fgx-grand') : ''}
              </td>
            </tr>
            ${talon}
            ${r.autres.length ? `<tr><td style="padding:12px 4px 0;">${tableau(autresHtml(THEME.inkSoft, THEME.ink))}</td></tr>` : ''}`, marge);
  };
  // LE TABLEAU DE SCORE : l ecran sombre des pistes. Le jour et l heure en grand sur
  // la premiere rangee, puis les joueurs, l offre et le montant, plus petits ; le
  // numero en dessous. Les valeurs en blanc, les libelles en gris.
  const score = (marge = 'margin:24px 0 6px;') => {
    if (!r.date && !r.heure) return lignesSimples(marge);
    const cellule = (libelle, val, taille, classe, largeur) => `<td width="${largeur}" valign="top" style="padding:10px 12px 12px;">
                  ${petit(libelle, '#bdb7c9', 'margin-bottom:6px;')}
                  ${enAffiche(val, taille, '#ffffff', 'line-height:1.06;', classe)}
                </td>`;
    const deux = Boolean(r.date && r.heure);
    const haut = `${r.date ? cellule('Jour', valeur(r.date), 34, 'fgx-score-grand', deux ? '64%' : '100%') : ''}${r.heure ? cellule('Heure', valeur(r.heure), 34, 'fgx-score-grand', deux ? '36%' : '100%') : ''}`;
    const bas = [[r.joueurs, 'Joueurs'], [r.offre, 'Offre'], [r.montant, r.montant ? r.montant.label : '']].filter(([d]) => d);
    const largeurBas = `${Math.floor(100 / Math.max(1, bas.length))}%`;
    return tableau(`
            <tr>
              <td bgcolor="${nuit}" style="background:${nuit};border-radius:16px;padding:12px 10px 10px;">
                ${tableau(`<tr>${haut}</tr>`, 'border-collapse:collapse;')}
                ${bas.length ? tableau(`<tr>${bas.map(([d, l]) => cellule(l, valeur(d), 20, 'fgx-moyen', largeurBas)).join('')}</tr>`, 'border-collapse:collapse;') : ''}
                ${r.numero ? `<p style="margin:2px 12px 8px;font-family:${police};font-size:13px;line-height:1.6;color:#bdb7c9;">${e(r.numero.label)} ${e(valeur(r.numero))}</p>` : ''}
                ${r.autres.length ? `<div style="padding:0 12px 4px;">${tableau(autresHtml('#bdb7c9', '#ffffff'))}</div>` : ''}
              </td>
            </tr>`, marge);
  };
  // L AFFICHE : le jour et l heure en tres grandes lettres d affiche, l un a l encre,
  // l autre a la couleur du centre, sur la page blanche ; le reste en lignes courtes.
  const affiche = (marge = 'margin:4px 0 26px;') => {
    if (!r.date && !r.heure) return lignesSimples(marge);
    const lignes = [joueurs, r.montant ? `${e(r.montant.label)} ${e(valeur(r.montant))}` : '', r.numero ? `${e(r.numero.label)} ${e(valeur(r.numero))}` : ''].filter(Boolean);
    return `<div style="${marge}">
              ${r.offre ? petit(valeur(r.offre), accentTexte, 'margin-bottom:10px;') : ''}
              ${r.date ? enAffiche(valeur(r.date), 48, THEME.ink, 'line-height:1;', 'fgx-geant') : ''}
              ${r.heure ? enAffiche(valeur(r.heure), 48, accentTexte, 'line-height:1;margin-top:2px;', 'fgx-geant') : ''}
              ${lignes.length ? `<p style="margin:14px 0 0;font-family:${police};font-size:15px;line-height:1.6;font-weight:600;color:${THEME.ink};">${lignes.join('<br>')}</p>` : ''}
              ${r.autres.length ? tableau(autresHtml(THEME.inkSoft, THEME.ink), 'margin:8px 0 0;') : ''}
            </div>`;
  };
  // LA LETTRE : le rendez-vous en une phrase, en gras sous le titre, sans cadre.
  const phrase = (marge = 'margin:0 0 18px;') => {
    const debut = [valeur(r.date), r.heure ? `à ${valeur(r.heure)}` : ''].filter(Boolean).join(' ');
    const morceaux = [debut ? debut.charAt(0).toUpperCase() + debut.slice(1) : '', joueurs, r.offre ? valeur(r.offre).toLowerCase().replace(/^./, (c) => c.toUpperCase()) : ''].filter(Boolean);
    const fin = [r.montant ? `${r.montant.label} ${valeur(r.montant)}` : '', r.numero ? `réservation ${valeur(r.numero)}` : ''].filter(Boolean);
    if (!morceaux.length && !fin.length && !r.autres.length) return '';
    const texte = `${morceaux.map((m) => e(m)).join(', ')}${morceaux.length ? '.' : ''}${fin.length ? ` ${e(fin.join(', ').replace(/^./, (c) => c.toUpperCase()))}.` : ''}`;
    return `${texte ? `<p class="fgx-lead" style="${marge}font-family:${police};font-size:18px;line-height:1.5;font-weight:700;color:${THEME.ink};">${texte}</p>` : ''}${r.autres.length ? tableau(autresHtml(THEME.inkSoft, THEME.ink), 'margin:0 0 18px;') : ''}`;
  };
  // Sans date ni heure : les lignes du mail, sans trait, sur un aplat gris neutre.
  function lignesSimples(marge = 'margin:22px 0 6px;') {
    const toutes = (Array.isArray(o.details) ? o.details : []).filter((d) => d && d.label);
    if (!toutes.length) return '';
    return tableau(`
            <tr>
              <td bgcolor="${THEME.paper}" style="background:${THEME.paper};border-radius:12px;padding:10px 18px;">${tableau(toutes.map((d) => `
                <tr>
                  <td style="padding:7px 0;font-family:${police};font-size:13.5px;line-height:1.4;color:${THEME.inkSoft};" width="42%" valign="top">${e(d.label)}</td>
                  <td style="padding:7px 0;font-family:${police};font-size:14.5px;line-height:1.4;font-weight:700;color:${THEME.ink};text-align:right;" valign="top">${e(d.value)}</td>
                </tr>`).join(''), 'border-collapse:collapse;')}</td>
            </tr>`, marge);
  }
  const bouton = (couleurBouton) => {
    if (!o.action) return '';
    const texteBouton = o.outils.texteSurAplat(couleurBouton);
    return `
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;margin:24px 0 4px;">
              <tr>
                <td align="center" bgcolor="${couleurBouton}" style="background:${couleurBouton};border-radius:10px;padding:14px 26px;">
                  <a href="${o.action.href}" style="font-family:${police};font-size:15px;line-height:1.2;font-weight:700;color:${texteBouton};text-decoration:none;">${escapeHtml(o.action.label)}</a>
                </td>
              </tr>
            </table>`;
  };
  const note = (couleurNote = THEME.inkSoft) => (o.note ? `<p style="margin:22px 0 0;font-family:${police};font-size:13.5px;line-height:1.6;color:${couleurNote};">${e(o.note)}</p>` : '');
  const nomCentre = String((o.center && o.center.name) || '').trim();
  const avecNom = o.enTete !== 'aucun' && nomCentre;
  const titreClassique = (taille = 22, texte = o.title) => `<h1 class="fgx-titre" style="margin:0 0 16px;font-family:${police};font-size:${taille}px;line-height:1.3;font-weight:800;letter-spacing:-0.2px;color:${THEME.ink};">${e(texte)}</h1>`;
  // Un titre d affiche ne laisse jamais un mot seul sur sa derniere ligne (« AMIS ? ») :
  // ses deux derniers mots restent ensemble.
  const sansVeuve = (html) => { const i = html.lastIndexOf(' '); return i > 0 && html.indexOf(' ') < i ? `${html.slice(0, i)}${INSECABLE}${html.slice(i + 1)}` : html; };
  const titreAffiche = (couleurTitre = THEME.ink, taille = 30) => `<h1 class="fgx-affiche-titre" style="margin:0 0 16px;font-family:${AFFICHE};font-size:${taille}px;line-height:1.1;font-weight:400;letter-spacing:0.3px;text-transform:uppercase;color:${couleurTitre};">${sansVeuve(e(o.title))}</h1>`;
  // Le recapitulatif pose sous le titre : un titre qui redit sa date (« Rendez-vous
  // samedi 20 juin » au-dessus du billet du samedi 20 juin) cede sa place au sourcil.
  const plat = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const aUnRendezVous = Boolean(r.date || r.heure);
  const titreRedit = Boolean(r.date && String(o.eyebrow || '').trim() && plat(o.title).includes(plat(valeur(r.date))));
  const titreEnTete = titreRedit ? String(o.eyebrow).trim() : o.title;
  const sourcil = (couleurSourcil) => (o.eyebrow ? petit(o.eyebrow, couleurSourcil, 'margin:0 0 8px;') : '');
  const image = (url, alt, largeur, style = '') => `<img src="${escapeHtml(url)}" width="${largeur}" alt="${escapeHtml(alt || '')}" style="display:block;width:100%;max-width:${largeur}px;height:auto;border:0;outline:none;text-decoration:none;${style}">`;

  return { accent, accentTexte, surAccent, fonce, nuit, r, billet, score, affiche, phrase, lignesSimples, bouton, note, nomCentre, avecNom, titreClassique, titreAffiche, titreRedit, titreEnTete, aUnRendezVous, sourcil, petit, enAffiche, image, tableau, e };
}

// La photo de l activite, tiree de la fiche du centre : jamais une photo d un autre centre.
// `activite` donne les morceaux du dossier du plus parlant au moins parlant, separes
// par « | » (activiteDe, lib/ops-communications.js) : le premier qui nomme une photo la choisit.
function photoDeLActivite(center, activite, origine) {
  const liste = center && center.branding && Array.isArray(center.branding.emailPhotosActivites) ? center.branding.emailPhotosActivites : [];
  const nomme = (morceau) => liste.find((p) => Array.isArray(p.activites)
    && p.activites.some((a) => String(a).trim() && morceau.includes(String(a).trim().toLowerCase())));
  let trouvee = null;
  for (const morceau of String(activite || '').toLowerCase().split('|').map((m) => m.trim()).filter(Boolean)) {
    trouvee = nomme(morceau);
    if (trouvee) break;
  }
  trouvee = trouvee || liste.find((p) => p.parDefaut) || liste[0];
  if (!trouvee || !/^\/assets\/mail\/[a-z0-9/_.-]+\.jpg$/i.test(String(trouvee.url || ''))) return null;
  return { url: `${origine}${trouvee.url}`, alt: String(trouvee.alt || '') };
}
// Les photos d un grand format : celles que la fiche met en vitrine d abord, sans doublon.
function photosDuCentre(center, origine, combien) {
  const liste = center && center.branding && Array.isArray(center.branding.emailPhotosActivites) ? center.branding.emailPhotosActivites : [];
  const valides = liste.filter((p) => /^\/assets\/mail\/[a-z0-9/_.-]+\.jpg$/i.test(String(p.url || '')));
  const rangees = [...valides.filter((p) => p.enVitrine), ...valides.filter((p) => !p.enVitrine)];
  return rangees.filter((p, i) => rangees.findIndex((x) => x.url === p.url) === i).slice(0, combien).map((p) => ({ url: `${origine}${p.url}`, alt: String(p.alt || ''), nom: String(p.nom || '') }));
}
// La seconde photo d un grand format : une autre photo de la MEME activite (le mot du
// titre dans ses activites ou sa description), jamais le laser sous un titre bowling.
// Aucune ne correspond : pas de seconde photo.
function photosAssorties(center, origine, cle, sauf) {
  const liste = center && center.branding && Array.isArray(center.branding.emailPhotosActivites) ? center.branding.emailPhotosActivites : [];
  const texte = String(cle || '').toLowerCase();
  const mots = [...new Set(liste.flatMap((p) => (Array.isArray(p.activites) ? p.activites : [])).map((a) => String(a).trim().toLowerCase()).filter((a) => a && texte.includes(a)))];
  const parle = (p) => mots.some((m) => String(p.alt || '').toLowerCase().includes(m) || (Array.isArray(p.activites) && p.activites.some((a) => String(a).trim().toLowerCase() === m)));
  return liste.filter((p) => /^\/assets\/mail\/[a-z0-9/_.-]+\.jpg$/i.test(String(p.url || '')) && `${origine}${p.url}` !== sauf && parle(p))
    .map((p) => ({ url: `${origine}${p.url}`, alt: String(p.alt || ''), nom: String(p.nom || '') }));
}

// Le montage complet d un gabarit de la galerie. `o` : { gabarit, title, eyebrow,
// corpsHtml, details, action, note, couleur, center, enTete, marqueSignature, pied,
// preheaderHtml, activite, origine, outils }. Rend le document HTML entier.
function montage(o) {
  const g = o.gabarit;
  const p = construire(o);
  const { THEME } = o.outils;
  const police = THEME.font;
  let fond = THEME.paper;
  let carte = true;
  let haut = '';
  let corps = '';
  const nomEnTete = (couleurNom) => (p.avecNom ? `<p style="margin:0 0 18px;font-family:${police};font-size:13px;line-height:1.3;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:${couleurNom};">${p.e(p.nomCentre)}</p>` : '');

  // Billet, affiche, score et photo ouvrent sur le recapitulatif : le rendez-vous se
  // lit avant le texte. Au-dessus d un recapitulatif, le titre reste en lettres
  // normales : l affiche, c est le rendez-vous.
  const EN_TETE = 'margin:2px 0 24px;';
  const titreSurRecap = (taille = 24) => (p.aUnRendezVous ? p.titreClassique(taille, p.titreEnTete) : p.titreAffiche(THEME.ink, 30));
  const sourcilSiUtile = (couleur) => (p.titreRedit ? '' : p.sourcil(couleur));
  const photoEnTete = (photo) => (photo ? `<tr><td style="padding:0;font-size:0;line-height:0;">${p.image(photo.url, photo.alt, 600, 'border-radius:16px 16px 0 0;')}</td></tr>` : '');
  if (g.id === 'billet') {
    corps = `${nomEnTete(p.accentTexte)}${sourcilSiUtile(THEME.inkSoft)}${titreSurRecap()}${p.billet(EN_TETE)}${o.corpsHtml}${p.bouton(p.accent)}${p.note()}`;
  } else if (g.id === 'affiche') {
    fond = THEME.card;
    carte = false;
    corps = `${nomEnTete(p.accentTexte)}${sourcilSiUtile(THEME.inkSoft)}${titreSurRecap(22)}${p.affiche()}${o.corpsHtml}${p.bouton(p.accent)}${p.note()}`;
  } else if (g.id === 'score') {
    corps = `${nomEnTete(THEME.ink)}${sourcilSiUtile(p.accentTexte)}${p.titreClassique(23, p.titreEnTete)}${p.score(EN_TETE)}${o.corpsHtml}${p.bouton(p.nuit)}${p.note()}`;
  } else if (g.id === 'lettre') {
    fond = THEME.card;
    carte = false;
    corps = `${p.avecNom ? `<p style="margin:0 0 22px;font-family:${police};font-size:14px;line-height:1.4;font-weight:700;color:${p.accentTexte};">${p.e(p.nomCentre)}</p>` : ''}${p.titreClassique(20, p.titreEnTete)}${p.phrase()}${o.corpsHtml}${p.bouton(p.accent)}${p.note()}`;
  } else if (g.id === 'photo') {
    // La photo de l activite en tete, puis le mail du billet. Plus de bandeau violet
    // en capitales sous la photo (jury du 12/11) : la couleur du centre reste au billet.
    haut = photoEnTete(photoDeLActivite(o.center, o.activite, o.origine));
    corps = `${nomEnTete(p.accentTexte)}${sourcilSiUtile(THEME.inkSoft)}${titreSurRecap()}${p.billet(EN_TETE)}${o.corpsHtml}${p.bouton(p.accent)}${p.note()}`;
  } else if (g.id === 'grand-format') {
    // Une campagne n a pas de dossier : son titre dit l activite (« Une soiree bowling »).
    const cle = o.activite || o.title || '';
    const premiere = photoDeLActivite(o.center, cle, o.origine);
    const seconde = premiere ? photosAssorties(o.center, o.origine, cle, premiere.url)[0] : null;
    haut = photoEnTete(premiere);
    corps = `${nomEnTete(p.accentTexte)}${p.sourcil(THEME.inkSoft)}${p.titreAffiche(THEME.ink, 34)}${o.corpsHtml}${p.billet()}${seconde ? `<div style="margin:24px 0 0;">${p.image(seconde.url, seconde.alt, 544, 'border-radius:14px;')}</div>` : ''}${p.bouton(p.accent)}${p.note()}`;
  } else {
    // vitrine : le titre d abord, puis deux vraies photos avec leur nom, empilees au telephone.
    const deux = photosDuCentre(o.center, o.origine, 2);
    const caseVitrine = (photo, cote) => `<td class="fgx-vitrine-case" width="50%" valign="top" style="padding:${cote === 'g' ? '0 7px 0 0' : '0 0 0 7px'};">
                  ${p.image(photo.url, photo.alt, 265, 'border-radius:12px;')}
                  ${photo.nom ? p.enAffiche(photo.nom, 18, THEME.ink, 'margin-top:8px;', 'fgx-vitrine-nom') : ''}
                </td>`;
    const vitrine = deux.length === 2 ? p.tableau(`<tr>${caseVitrine(deux[0], 'g')}${caseVitrine(deux[1], 'd')}</tr>`, 'border-collapse:collapse;margin:4px 0 24px;') : '';
    corps = `${nomEnTete(p.accentTexte)}${p.sourcil(THEME.inkSoft)}${p.titreAffiche(THEME.ink, 32)}${vitrine}${o.corpsHtml}${p.billet()}${p.bouton(p.accent)}${p.note()}`;
  }

  const styleCarte = carte ? `background:${THEME.card};border-radius:16px;overflow:hidden;` : '';
  const marges = carte ? '28px 28px 30px' : '30px 30px 32px';
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${o.outils.escapeHtml(o.preheaderTitre || o.title || 'Message de votre centre')}</title>
    <style>
      @media only screen and (max-width:480px) {
        .fgx-affiche-titre { font-size:24px !important; }
        .fgx-titre { font-size:19px !important; }
        .fgx-affiche { font-size:22px !important; }
        .fgx-grand { font-size:30px !important; }
        .fgx-score-grand { font-size:24px !important; }
        .fgx-geant { font-size:38px !important; }
        .fgx-moyen { font-size:17px !important; }
        .fgx-montant { font-size:22px !important; }
        .fgx-lead { font-size:17px !important; }
        .fgx-corps { padding:22px 18px 24px !important; }
        .fgx-pied { padding:0 6px !important; }
        .fgx-vitrine-case { display:block !important; width:100% !important; padding:0 0 16px !important; }
        .fgx-vitrine-case img { max-width:100% !important; }
      }
    </style>
    <!--[if mso]>
    <style>body,table,td,p,h1,a{font-family:'Montserrat','Segoe UI',Arial,sans-serif !important;}</style>
    <![endif]-->
  </head>
  <body style="margin:0;padding:0;width:100%;background:${fond};font-family:${police};color:${THEME.ink};-webkit-font-smoothing:antialiased;">
    ${o.preheaderHtml}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${fond}" style="border-collapse:collapse;background:${fond};">
      <tr>
        <td align="center" style="padding:${carte ? '28px 12px 36px' : '0 0 32px'};">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;max-width:600px;">
            <tr>
              <td ${carte ? `bgcolor="${THEME.card}" ` : ''}style="${styleCarte}padding:0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                  ${haut}
                  <tr>
                    <td class="fgx-corps" style="padding:${marges};">
                ${corps}
                ${o.marqueSignature}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="fgx-pied" style="padding:0 ${carte ? 16 : 18}px;">${o.pied}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// La largeur utile du corps, que la signature reprend pour sa photo.
function largeurDuCorps(id) {
  const g = trouver(id);
  if (!g) return null;
  return g.id === 'affiche' || g.id === 'lettre' ? 540 : 544;
}

module.exports = { FAMILLES, GABARITS, IDS, trouver, pourLEnvoi, montage, largeurDuCorps, photoDeLActivite, melange };
