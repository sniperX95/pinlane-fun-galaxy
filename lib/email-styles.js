'use strict';
// LES STYLES DE MAIL DES MEILLEURS (2026-11-13).
//
// Ansar, sur la galerie du 12/11 : « les signatures, le copywriting, la police,
// les couleurs sont vraiment nuls [...] pour marketing, pour normal, il faut
// vraiment les meilleurs dans chaque niche ». Ce qu il voyait : du Montserrat que
// ni Gmail ni Outlook ne chargent (le mail tombait en Arial) et une typo
// d affiche, Anton, que personne n a non plus (elle tombait en Impact, la police
// des memes), sur des aplats violets pleins.
//
// Un style ici, c est UNE IDENTITE COMPLETE pour les trois sortes de mail :
//   - la reservation (accuse, confirmation, rappel) : le rendez-vous domine ;
//   - le mail ecrit par une personne (reponse, message, relance) : une lettre ;
//   - la campagne : une photo, un titre, un bouton.
// avec sa police, son echelle de tailles, ses couleurs et sa signature
// (renderSignatureHtml, dispositions du meme nom).
//
// LES POLICES SONT CELLES DU TELEPHONE. Gmail n affiche aucune police web : un
// mail se compose dans les polices du systeme, celles qu Apple, Airbnb et Stripe
// declarent en premier (San Francisco sur iPhone et Mac, Segoe UI sous Windows,
// Roboto sous Android), et Georgia pour une serif. Rien a charger, rien qui
// tombe en Impact.
//
// Les couleurs viennent du centre (accent du catalogue) ; ce fichier ne porte que
// des neutres. Aucun degrade, aucun filet entre deux lignes, aucune transparence.

const SYSTEME = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',Times,serif";

// `rayon` : les coins des blocs ; `aligne` : la composition ; `titre` : la police
// et la graisse du titre ; les couleurs sont des neutres pleins.
const STYLES = {
  natif: {
    titre: SYSTEME, graisse: 700, espacement: '-0.6px', texte: SYSTEME,
    encre: '#1b1523', doux: '#6b6475', page: '#f3f2f5', carte: '#ffffff', plaque: '#f6f4f8',
    rayon: 18, rayonBouton: 999, aligne: 'left', signature: 'sobre',
  },
  maison: {
    titre: SERIF, graisse: 400, espacement: '-0.3px', texte: SYSTEME,
    encre: '#2a2220', doux: '#6f6661', page: '#f4efe6', carte: '#fcf9f3', plaque: '#efe9de',
    rayon: 6, rayonBouton: 4, aligne: 'left', signature: 'maison',
  },
  arcade: {
    titre: SYSTEME, graisse: 800, espacement: '-0.8px', texte: SYSTEME,
    encre: '#15111d', doux: '#5f5870', page: '#ffffff', carte: '#ffffff', plaque: '#f4f2f7',
    rayon: 22, rayonBouton: 999, aligne: 'left', signature: 'arcade',
  },
};

function style(id) {
  return STYLES[String(id || '')] || null;
}

const HEX = /^#[0-9a-f]{6}$/i;
function rgb(hex) { const n = parseInt(String(hex).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function luminance(hex) { const c = rgb(hex).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
function contraste(a, b) { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); }
function melange(a, b, t) { const [x, y] = [rgb(a), rgb(b)]; return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`; }

// Le montage complet d un mail en style `o.gabarit.style`. Meme contrat que
// email-gabarits.montage, plus `r` (le recapitulatif lu par role), `photo` (la
// photo de l activite, ou de la campagne) et `logo` (le logo du centre, absolu).
function montageStyle(o) {
  const t = style(o.gabarit.style);
  const { escapeHtml, espaces } = o.outils;
  const e = (texte) => espaces(escapeHtml(texte));
  const r = o.r;
  const centre = o.aligne === 'left' ? 'left' : t.aligne;
  const accent = HEX.test(o.couleur) ? o.couleur : t.encre;
  // L accent ecrit sur le blanc : lui-meme s il se lit, sinon l encre.
  const accentTexte = contraste(accent, '#ffffff') >= 4.5 ? accent : t.encre;
  const surAccent = contraste(accent, '#ffffff') >= contraste(accent, t.encre) ? '#ffffff' : t.encre;
  const valeur = (d) => (d ? String(d.value).trim() : '');
  const nomCentre = String((o.center && o.center.name) || '').trim();
  const p = (html, css) => `<p style="margin:0;font-family:${t.texte};${css}">${html}</p>`;
  const tableau = (contenu, css = '') => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;${css}">${contenu}</table>`;
  const titre = (texte, taille, css = '') => `<h1 class="sty-titre" style="margin:0;font-family:${t.titre};font-size:${taille}px;line-height:1.12;font-weight:${t.graisse};letter-spacing:${t.espacement};color:${t.encre};text-align:${centre};${css}">${texte}</h1>`;
  const sourcil = (texte, couleur = t.doux) => (texte ? p(e(texte), `font-size:13px;line-height:1.4;font-weight:600;letter-spacing:0.2px;color:${couleur};text-align:${centre};margin:0 0 10px;`) : '');
  const image = (url, alt, largeur, css = '') => `<img src="${escapeHtml(url)}" width="${largeur}" alt="${escapeHtml(alt || '')}" style="display:block;width:100%;max-width:${largeur}px;height:auto;border:0;outline:none;text-decoration:none;${css}">`;

  // L EN-TETE : le vrai logo du centre quand il en a un et que le mail peut porter
  // une image, sinon son nom, sobre, dans l encre.
  // Une campagne pose son logo AU-DESSUS de la carte, sur le fond, puis la photo
  // ouvre la carte (Airbnb, Topgolf) : un logo glisse sous la photo se perdait.
  const logoAuDessus = Boolean(o.photo && o.logo);
  // Le logo descend dans la signature quand le mail en porte une (jury du 13/11 :
  // « une seule signature, logo et toutes les infos, la meme dans les trois
  // mails »). Le haut ne retape alors pas le nom du centre : il s ouvre sur le
  // statut et le rendez-vous.
  const logoEnSignature = Boolean(o.marqueSignature) && !o.logo && !o.photo;
  const enTete = () => {
    if (o.enTete === 'aucun' || logoAuDessus || logoEnSignature) return '';
    if (o.logo) {
      const largeurLogo = t.aligne === 'center' ? 120 : 104;
      return `<div style="margin:0 0 ${t.aligne === 'center' ? 30 : 26}px;${t.aligne === 'center' ? 'text-align:center;' : ''}"><img src="${escapeHtml(o.logo)}" width="${largeurLogo}" alt="${escapeHtml(nomCentre)}" style="display:${t.aligne === 'center' ? 'inline-block' : 'block'};width:${largeurLogo}px;max-width:${largeurLogo}px;height:auto;border:0;outline:none;text-decoration:none;"></div>`;
    }
    return nomCentre ? p(e(nomCentre), `font-size:15px;line-height:1.3;font-weight:700;color:${t.encre};text-align:${centre};margin:0 0 24px;`) : '';
  };

  // LE RENDEZ-VOUS, l element qui domine un mail de reservation (Delta : l heure).
  const joueurs = r.joueurs ? `${valeur(r.joueurs)}${/^\d+$/.test(valeur(r.joueurs)) ? (Number(valeur(r.joueurs)) > 1 ? ' participants' : ' participant') : ''}` : '';
  const offre = r.offre ? valeur(r.offre) : '';
  const quoi = [offre && offre.charAt(0) + offre.slice(1).toLowerCase(), joueurs].filter(Boolean).join(' · ');
  const jour = r.date ? valeur(r.date) : '';
  const jourMaj = jour ? jour.charAt(0).toUpperCase() + jour.slice(1) : '';
  const heure = r.heure ? valeur(r.heure) : '';
  const lignesPlaque = [
    r.numero ? [r.numero.label, valeur(r.numero)] : null,
    r.montant ? [r.montant.label, valeur(r.montant)] : null,
    ...r.autres.map((d) => [d.label, valeur(d)]),
  ].filter(Boolean);
  const plaqueLignes = (couleurFond = t.plaque) => (lignesPlaque.length ? tableau(`<tr><td bgcolor="${couleurFond}" style="background:${couleurFond};border-radius:${Math.min(t.rayon, 14)}px;padding:16px 20px;">${tableau(lignesPlaque.map(([l, v]) => `<tr>
          <td style="padding:5px 0;font-family:${t.texte};font-size:14px;line-height:1.45;color:${t.doux};" valign="top">${e(l)}</td>
          <td style="padding:5px 0 5px 16px;font-family:${t.texte};font-size:15px;line-height:1.45;font-weight:600;color:${t.encre};text-align:right;" valign="top">${e(v)}</td>
        </tr>`).join(''))}</td></tr>`, 'margin:22px 0 26px;') : '');

  const bouton = () => {
    if (!o.action) return '';
    return tableau(`<tr><td align="${centre}" style="padding:0;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;${centre === 'center' ? 'margin:0 auto;' : ''}"><tr>
          <td align="center" bgcolor="${accent}" style="background:${accent};border-radius:${t.rayonBouton}px;padding:15px 30px;">
            <a href="${o.action.href}" style="font-family:${t.texte};font-size:16px;line-height:1.2;font-weight:700;color:${surAccent};text-decoration:none;display:inline-block;">${escapeHtml(o.action.label)}</a>
          </td>
        </tr></table>
      </td></tr>`, 'margin:28px 0 6px;');
  };
  const note = () => (o.note ? p(e(o.note), `font-size:14px;line-height:1.6;color:${t.doux};text-align:${centre};margin:24px 0 0;`) : '');
  const corps = () => (o.corpsHtml ? `<div class="sty-corps" style="text-align:${centre};">${o.corpsHtml}</div>` : '');

  let haut = '';
  let contenu = '';
  const aUnRendezVous = Boolean(r.date || r.heure);
  if (o.personnel) {
    // Une lettre : le texte, puis la signature, qui porte le logo et dit qui ecrit
    // (Kulfi, Notion). Sans signature, le nom du centre ouvre la lettre.
    contenu = `${enTete()}${corps()}${bouton()}${note()}`;
  } else if (aUnRendezVous) {
    const statut = o.titreRedit || !o.eyebrow ? (o.eyebrow || '') : o.eyebrow;
    if (t.signature === 'arcade' && o.photo) {
      haut = `<tr><td style="padding:0;font-size:0;line-height:0;">${image(o.photo.url, o.photo.alt, 600, `border-radius:${t.rayon}px ${t.rayon}px 0 0;`)}</td></tr>`;
    }
    const grand = t.signature === 'maison'
      ? `${titre(e(jourMaj), 38)}${heure ? titre(e(heure), 38, 'margin-top:2px;') : ''}`
      : titre(`${e(jourMaj)}${heure ? `<br><span style="color:${t.signature === 'arcade' ? accentTexte : t.encre};">${e(heure)}</span>` : ''}`, t.signature === 'arcade' ? 46 : 40);
    contenu = `${enTete()}${sourcil(statut, t.signature === 'arcade' ? accentTexte : t.doux)}${grand}${quoi ? p(e(quoi), `font-size:16px;line-height:1.5;color:${t.doux};text-align:${centre};margin:12px 0 0;`) : ''}${plaqueLignes()}${corps()}${bouton()}${note()}`;
  } else {
    // Une campagne ou un mail sans rendez-vous : la photo, le titre, le texte, le bouton.
    if (o.photo) haut = `<tr><td style="padding:0;font-size:0;line-height:0;">${image(o.photo.url, o.photo.alt, 600, `border-radius:${t.rayon}px ${t.rayon}px 0 0;`)}</td></tr>`;
    contenu = `${enTete()}${sourcil(o.eyebrow)}${titre(e(o.title), t.signature === 'arcade' ? 38 : 32, 'margin-bottom:18px;')}${corps()}${bouton()}${note()}`;
  }

  // Une lettre ne s encadre pas (jury du 13/11) : le fond prend la couleur de la
  // carte, qui disparait.
  const fond = o.personnel ? t.carte : t.page;
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${escapeHtml(o.preheaderTitre || o.title || 'Message de votre centre')}</title>
    <style>
      @media only screen and (max-width:480px) {
        .sty-titre { font-size:30px !important; }
        .sty-corps-cadre { padding:26px 20px 28px !important; }
        .sty-pied { padding:0 8px !important; }
        .sty-logo-haut { padding:0 20px 14px !important; }
        .sty-sig-logo { display:block !important; width:auto !important; padding:0 0 12px !important; }
        .sty-sig-logo img { width:72px !important; }
        .sty-sig-texte { display:block !important; }
      }
    </style>
    <!-- Outlook sous Windows ne suit pas une pile de polices : sans ce bloc, il prend
         la premiere qu il ne connait pas pour du Times New Roman. -->
    <!--[if mso]>
    <style>body,table,td,p,a,span{font-family:'Segoe UI',Arial,sans-serif !important;} .sty-titre{font-family:${t.titre === SERIF ? "Georgia,'Times New Roman',serif" : "'Segoe UI',Arial,sans-serif"} !important;}</style>
    <![endif]-->
  </head>
  <body style="margin:0;padding:0;width:100%;background:${fond};font-family:${t.texte};color:${t.encre};-webkit-font-smoothing:antialiased;">
    ${o.preheaderHtml}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${fond}" style="border-collapse:collapse;background:${fond};">
      <tr>
        <td align="center" style="padding:32px 12px 40px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;max-width:600px;">
            ${logoAuDessus ? `<tr>
              <td class="sty-logo-haut" style="padding:0 36px 18px;"><img src="${escapeHtml(o.logo)}" width="104" alt="${escapeHtml(nomCentre)}" style="display:block;width:104px;max-width:104px;height:auto;border:0;outline:none;text-decoration:none;"></td>
            </tr>` : ''}
            <tr>
              <td bgcolor="${t.carte}" style="background:${t.carte};border-radius:${t.rayon}px;overflow:hidden;padding:0;">
                ${tableau(`${haut}
                  <tr>
                    <td class="sty-corps-cadre" style="padding:${t.aligne === 'center' ? '40px 40px 42px' : '36px 36px 38px'};">
                ${contenu}
                ${o.marqueSignature}
                    </td>
                  </tr>`)}
              </td>
            </tr>
            <tr>
              <td class="sty-pied" style="padding:0 ${t.aligne === 'center' ? 24 : 20}px;${t.aligne === 'center' ? 'text-align:center;' : ''}">${o.pied}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

module.exports = { SYSTEME, SERIF, STYLES, style, montageStyle, melange, contraste };
