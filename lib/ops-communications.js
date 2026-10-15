const {
  createCommunication,
  listDueCommunications,
  updateCommunicationStatus,
} = require('./database');
const { getCenter, getFormula } = require('./ops-knowledge');
// Ciblage des messages = point de consommation analytique le plus sensible :
// une persona de simulation ne doit JAMAIS declencher un email ou un SMS reel.
const { simulationSqlExclusion } = require('./simulation-filter');
const { adresseDePlateforme, adresseDeReceptionDUnAutreCentre, adresseDUnAutreClient, chargerDeclarations, domaineDe, domaineReception } = require('./sender-domains');
// PURGE DE MARQUE (2026-08-15) : ce module ne lit plus lib/fungalaxy-brand.
// Le nom qui signe un mail est TOUJOURS celui du centre expediteur
// (center.name), jamais un repli sur l'identite du premier client : un mail
// sans centre connu s'affiche sans bandeau de nom plutot que sous une marque
// qui n'est pas la sienne.
// Retrait de la liste marketing. Ce module ne s'active QUE pour les mails
// marketing (campagne, anniversaire J-30, reactivation, sequences custom) :
// jamais importe par un chemin transactionnel. Cf. lib/marketing-suppression.js.
const {
  buildUnsubscribe,
  listSuppressedSet,
  unsubscribeUrl,
} = require('./marketing-suppression');
// Le design des mails d un centre (gabarit, accent, en-tete, pied, signature) :
// defauts et validation dans lib/email-design.js, rendu ici.
const emailDesign = require('./email-design');
const { sujetSansPrefixe } = require('./email-threads');
const { DELAI_REPONSE } = require('./client-writing');

const BRUSSELS_TZ = 'Europe/Brussels';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// L'URL de l'application pour les liens des mails (cockpit staff, redirection
// avis, desinscription). PUBLIC_APP_URL prime ; le repli est le domaine de la
// PLATEFORME, plus jamais celui du premier client.
function publicAppUrl() {
  return String(process.env.PUBLIC_APP_URL || 'https://app.pinlane.be').replace(/\/$/, '');
}

// Signature des sequences : le nom du centre expediteur, jamais une marque en
// dur. Sans nom connu (cas limite d'un centre disparu), une cloture neutre.
function signatureLine(centerName) {
  const name = String(centerName || '').trim();
  return name ? `L'équipe ${name}` : "L'équipe du centre";
}

// ── Gabarit email « sobre premium » ─────────────────────────────────────────
//
// Direction REVISEE (Movsar, 2026-08-06 : « design enfantin, un truc bcp plus
// pro ») : elle REMPLACE la charte bandeaux noirs du 2026-07-19. Le mail est
// desormais un RECU SOBRE : carte blanche a filet fin sur fond gris neutre,
// nom du centre en tete de carte (petit, pas un bandeau), titre en bas de
// casse, bouton rectangulaire encre, pied discret. PURGE DE MARQUE (2026-08-15,
// review adverse P0) : le magenta releve sur fungalaxy.be survivait dans les
// liens ; ce gabarit sert TOUS les centres, la couleur d'un client n'y a pas sa
// place. Liens, bouton et eyebrow reposent sur l'ENCRE NEUTRE ; une couleur
// d'accent PAR CENTRE (donnee, comme --tenant-accent cote tunnel) est une
// amelioration future. Zero image : rendu identique images bloquees ou non.
//
// POURQUOI PAS LE NOIR INTEGRAL du site : le noir integral casse en mode sombre
// chez plusieurs clients (double inversion) et fatigue a la lecture d'une
// information dense (dates, heures, prix). Les deux bandeaux noirs donnent la
// reconnaissance de marque immediate, le corps clair garde la lisibilite et la
// delivrabilite. Le gabarit doit vieillir lentement : aucun degrade CSS (ils
// sautent dans Outlook), aucun emoji decoratif.
//
// TITRES : majuscules, graisse 700, interligne serre (1,15). C'est le geste du
// site, qui compose ses h1 en capitales a 64px. En mail on descend a 26px : les
// majuscules occupent environ 15 % de largeur en plus que le bas de casse, et
// un titre long doit tenir sur un ecran de 390px sans deborder.
//
// PALETTE : lib/fungalaxy-brand.js ne definit AUCUNE couleur (c'est un ADN de
// ton, pas une charte graphique). La palette ci-dessous est NEUTRE : le gabarit
// est commun a tous les centres, aucune couleur de marque d'un client n'y est
// ecrite. Le magenta de fungalaxy.be a ete retire (meme sa valeur hexa : le
// gate du deuxieme client scanne les octets de ce fichier) : c'etait la
// couleur du premier client, servie a tous les tenants.
//   - teal  #00ACAD : accent secondaire historique, conserve pour les filets,
//     jamais en aplat de texte.
//   - noir  #000000 : le site est en noir integral, texte blanc. Le mail ne
//     l'est PAS (decision Movsar) : bandeau noir en tete et en pied pour la
//     reconnaissance immediate, corps clair pour lire des dates et des prix.
//   - paper #F1EFF2 : gris tres clair a bascule violette. Le site n'a aucun
//     creme : un fond chaud aurait rechauffe une charte qui est neutre.
//   - card  #FFFFFF : la carte se detache du fond sans ombre portee (les ombres
//     CSS sautent dans Outlook, la difference fond/blanc, elle, tient partout).
//
// TYPOGRAPHIE : le site compose ses titres en Korolev, police sous licence donc
// inutilisable en mail. Le repli est Montserrat en MAJUSCULES, qui reproduit le
// meme geste (titres capitales, graisse 700, interligne serre). Montserrat est
// aussi la police de corps du site. Aucun @import : la plupart des clients le
// bloquent et une requete de police pese sur la delivrabilite. Montserrat ne
// s'affiche donc que chez les clients qui l'ont deja ; la pile de repli
// (Helvetica Neue, Arial) doit rester bonne, c'est elle que verront la plupart.
//
// MODE SOMBRE : beaucoup de clients (Outlook Windows/mobile, Gmail Android)
// inversent brutalement les couleurs. Le piege classique est le texte fonce
// pose sur un fond fonce apres inversion. Ici chaque paire est choisie pour
// survivre a l'inversion : encre foncee sur creme clair devient encre claire
// sur fond fonce ; blanc sur violet profond devient fonce sur violet clair.
// On ne pose JAMAIS de texte de couleur moyenne sur un fond de couleur moyenne.
// `color-scheme` + `supported-color-schemes` demandent aux clients qui savent
// le faire (Apple Mail, Outlook recent) de ne pas inverser du tout.
const EMAIL_THEME = {
  ink: '#17151F',
  inkSoft: '#5A5560',
  teal: '#00ACAD',
  black: '#000000',
  onBlack: '#FFFFFF',
  onBlackSoft: '#C9C3CE',
  paper: '#F5F5F7',
  card: '#FFFFFF',
  panel: '#FAFAFC',
  border: '#E6E6EB',
  borderSoft: '#EFEFF3',
  onBrand: '#FFFFFF',
  // ACCENT STAFF : un « ALERTE TERRAIN » et un « RESERVATION CONFIRMEE » ne
  // peuvent pas avoir la meme temperature. L'ambre brule (#8A4B08) est un ocre
  // profond, pas un orange de notification : il tient a cote de l'encre neutre
  // sans casser la palette, donne du blanc lisible en bouton (contraste
  // ~6,5:1) et reste fonce, donc il survit a l'inversion comme l'encre.
  // Il reste volontairement HORS charte site : c'est un signal d'exploitation
  // interne, il ne doit pas se confondre avec une communication client.
  alert: '#8A4B08',
  font: "'Montserrat','Helvetica Neue',Arial,sans-serif",
};

// AUCUN LOGO IMAGE dans les mails : l'en-tete de carte porte le NOM du centre
// en texte (brandHeader), identique images bloquees ou non. Les constantes du
// logo Fun Galaxy (URL mngfunglxy.com et hauteurs derivees), declarees mais
// jamais consommees par le gabarit sobre, ont ete retirees a la purge de
// marque : un octet d'identite client n'a rien a faire dans le module commun.

// Les enums techniques (riskLevel, severity) sont ecrites en anglais dans le
// moteur. Aucune ne doit fuir telle quelle dans un mail, meme staff : le
// gerant lit « eleve », pas « high ».
const RISK_LEVEL_FR = {
  low: 'faible',
  medium: 'moyen',
  high: 'élevé',
  critical: 'critique',
};

function riskLabelFr(level) {
  const key = String(level || '').trim().toLowerCase();
  if (!key) return 'à évaluer';
  return RISK_LEVEL_FR[key] || key;
}

// Format monetaire francais : symbole euro precede d'une espace INSECABLE
// (« 546 € » ne doit jamais se couper en fin de ligne). Le code ISO « EUR »
// est un format de systeme comptable, pas un format de lecture client.
function formatEuro(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  const rounded = Math.round(amount * 100) / 100;
  const NBSP = '\u00A0';
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace('.', ',');
  return `${text}${NBSP}€`;
}

// Seuls http(s) et mailto sont acceptes dans un href. Un `javascript:` ou un
// `data:` glisse dans une URL d'action (studio mails, sequences custom) est
// neutralise ici plutot que d'etre simplement echappe : l'echappement empeche
// la casse HTML, pas l'execution au clic.
function safeUrl(value = '') {
  const raw = String(value).trim();
  if (!/^(https?:|mailto:|\/)/i.test(raw)) return '';
  return escapeHtml(raw);
}

// RYTHME VERTICAL : une ligne vide du texte source ne produit AUCUN paragraphe.
// L'espacement vient de la marge des paragraphes (une seule valeur, partout),
// jamais d'un paragraphe fantome : un `<p>&nbsp;</p>` ou un `<p>` a 8px empile
// sa hauteur sur la marge du paragraphe precedent et creuse un trou d'environ
// 45px la ou le rythme est de 25px. Les mails ecrits avec des lignes vides
// (staff, studio, campagne) avaient donc un rythme different des mails ecrits
// sans (confirmation, rappel) : meme gabarit, deux respirations.
// FONT : la police est declaree sur CHAQUE element porteur de texte. Le moteur
// de rendu de Word (Outlook Windows) n'herite pas font-family depuis <body> ni
// depuis une <table> parente : un <p> nu retombe en Times New Roman.
// MISE EN FORME LEGERE (composeur staff, 2026-08-05). Quatre marqueurs texte,
// convertis ici en HTML que les clients mail reels tolerent (styles en ligne,
// listes simples, zero div) :
//   **gras**   _italique_   [texte](https://lien)   lignes « - » en liste
//   [[bouton: Libelle | https://lien]] seul sur sa ligne : le bouton CTA.
// L'ORDRE EST LA SECURITE : escapeHtml passe D'ABORD, les transformations ne
// travaillent que sur du texte deja echappe et n'introduisent que des balises
// ecrites ici. Un lien n'est pose que s'il est http(s), via safeUrl.
function unescapeBasicHtml(escaped = '') {
  return String(escaped)
    .replace(/&#39;/g, '\'')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function inlineEmailMarkup(escaped) {
  let s = String(escaped);
  s = s.replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]{1,500})\)/g, (match, label, url) => {
    const href = safeUrl(unescapeBasicHtml(url));
    if (!href) return label;
    // ENCRE NEUTRE, comme le bouton et l'eyebrow : le soulignement natif du
    // <a> et la graisse suffisent a signaler le lien. Peindre chaque lien au
    // magenta du premier client colorait les mails de TOUS les centres.
    return `<a href="${escapeHtml(href)}" style="color:${EMAIL_THEME.ink};font-weight:600;">${label}</a>`;
  });
  s = s.replace(/\*\*([^*\n]{1,300}?)\*\*/g, '<strong>$1</strong>');
  // L'italique exige un non-mot de chaque cote : un identifiant snake_case ne
  // doit jamais se transformer.
  s = s.replace(/(^|[^\w&])_([^_\n]{1,300}?)_(?=$|[^\w])/g, '$1<em>$2</em>');
  return s;
}

// `simple` (gabarit Mail simple, 2026-09-17) : le texte d un mail ecrit a la
// main. Arial 14 px, interligne normal, AUCUNE couleur imposee : la messagerie
// garde la sienne, en clair comme en sombre.
function textToHtml(text = '', { size = 16, color = EMAIL_THEME.ink, simple = false } = {}) {
  const style = simple
    ? 'margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;'
    : `margin:0 0 14px;font-family:${EMAIL_THEME.font};font-size:${size}px;line-height:1.65;color:${color};`;
  const liStyle = simple
    ? 'margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;'
    : `margin:0 0 8px;font-family:${EMAIL_THEME.font};font-size:${size}px;line-height:1.5;color:${color};`;
  const lines = escapeHtml(text).split('\n');
  const blocks = [];
  let bullets = [];
  const flushBullets = () => {
    if (!bullets.length) return;
    blocks.push(`<ul style="margin:0 0 14px;padding:0 0 0 22px;">${bullets.map((item) => `<li style="${liStyle}">${item}</li>`).join('')}</ul>`);
    bullets = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushBullets(); continue; }
    const btn = line.match(/^\[\[bouton\s*:\s*([^|\]]{1,80})\|\s*(https?:\/\/[^\]\s]{1,500})\s*\]\]$/i);
    if (btn) {
      flushBullets();
      // actionButton re-echappe le libelle et re-valide l'URL : on lui rend le
      // texte BRUT, sinon « &amp; » sortirait double-echappe dans le mail.
      blocks.push(actionButton({ label: unescapeBasicHtml(btn[1].trim()), href: unescapeBasicHtml(btn[2]) }));
      continue;
    }
    if (/^- /.test(line)) { bullets.push(inlineEmailMarkup(line.slice(2))); continue; }
    flushBullets();
    blocks.push(`<p style="${style}">${inlineEmailMarkup(line)}</p>`);
  }
  flushBullets();
  return blocks.join('');
}

// Les details (date, activite, personnes, prix) sont poses dans une CARTE et
// non dans un tableau a filets gris : c'est ce bloc que le client relit sur
// place, il doit se lire d'un coup d'oeil, pas se dechiffrer.
function detailRows(details = [], { sansFond = false } = {}) {
  const rows = (Array.isArray(details) ? details : []).filter((detail) => detail && detail.label);
  if (!rows.length) return '';
  const cells = rows.map((detail, index) => {
    const last = index === rows.length - 1;
    const line = last ? '' : `border-bottom:1px solid ${EMAIL_THEME.borderSoft};`;
    return `
        <tr>
          <td style="padding:12px 0;${line}font-family:${EMAIL_THEME.font};font-size:14px;line-height:1.4;color:${EMAIL_THEME.inkSoft};" width="42%" valign="top">${escapeHtml(detail.label)}</td>
          <td style="padding:12px 0;${line}font-family:${EMAIL_THEME.font};font-size:15px;line-height:1.4;color:${EMAIL_THEME.ink};font-weight:700;text-align:right;" valign="top">${escapeHtml(detail.value)}</td>
        </tr>`;
  }).join('');

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;margin:26px 0 4px;${sansFond ? '' : `background:${EMAIL_THEME.panel};`}border:1px solid ${EMAIL_THEME.border};border-radius:12px;">
      <tr>
        <td style="padding:6px 20px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">${cells}
          </table>
        </td>
      </tr>
    </table>`;
}

// « Bulletproof button » : la CELLULE porte a la fois la couleur de fond et le
// padding. C'est le seul montage que le moteur Word respecte : il ignore
// `display:block` sur un <a> (element inline) et laisse donc tomber tout
// padding vertical pose sur le lien, ce qui ecrase le bouton a la hauteur du
// texte. Padding sur le <td> = hauteur reelle garantie partout, y compris
// Outlook Windows. Le <a> ne garde qu'un padding horizontal (surface cliquable
// elargie sur les clients qui l'honorent) et reste un lien texte lisible si
// tout le style tombe : c'est le but du pattern.
// FORME : PILULE, comme les boutons du site (border-radius 50px, texte en
// majuscules, graisse 700, letter-spacing leger, blanc sur magenta). Le rayon
// est pose sur le <td> ET sur le <a> : le <td> donne la pilule aux clients qui
// rendent le fond de cellule, le <a> la donne a ceux qui peignent le lien. Un
// rayon sur le seul <a> laisserait un rectangle magenta a angles vifs sur
// Outlook, ou le <td> est ce qui se voit.
// Le site borde ses boutons de 2px de noir : cette bordure est invisible sur le
// site (fond noir), elle ne sert qu'a l'espacement. La reproduire sur un corps
// clair dessinerait un cerne noir autour de la pilule : on garde la geometrie
// (via le padding) et on laisse tomber la bordure.
// Le site compose a 14px / padding 5px 35px. En mail on garde la casse et la
// graisse mais on monte le padding vertical a 15px : une cible tactile doit
// faire au moins 44px de haut, un bouton de site n'a pas cette contrainte.
function actionButton(action, accent = EMAIL_THEME.ink) {
  const href = safeUrl(action?.href || '');
  const label = String(action?.label || '').trim();
  if (!href || !label) return '';
  // Bouton PRO (2026-08-06) : rectangle encre, bas de casse, rayon discret. La
  // pilule magenta en capitales lisait « animation commerciale » ; un recu
  // serieux appuie sur un bouton sobre. L'accent ne colore le bouton que
  // lorsqu'un appelant STAFF le passe explicitement (alerte ambre) : le defaut
  // est l'encre neutre, plus aucune sentinelle de couleur de marque.
  const bg = accent;
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;margin:26px 0 4px;">
      <tr>
        <td align="center" bgcolor="${bg}" style="background:${bg};border-radius:8px;padding:12px 26px;">
          <a href="${href}" style="font-family:${EMAIL_THEME.font};font-size:14px;line-height:1.2;font-weight:600;letter-spacing:0.1px;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>`;
}

// EN-TETE DE CARTE (2026-08-06) : le nom du centre, petit et net, ferme par un
// filet fin. Plus de bandeau noir, plus de logo image : le rendu est le meme
// que les images soient bloquees ou non, chez tous les clients.
function brandHeader(center = null) {
  const bandName = String(center?.name || '').trim();
  if (!bandName) return '';
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
      <tr>
        <td style="padding:18px 28px;border-bottom:1px solid ${EMAIL_THEME.borderSoft};">
          <p style="margin:0;font-family:${EMAIL_THEME.font};font-size:13.5px;line-height:1.3;font-weight:700;letter-spacing:0.2px;color:${EMAIL_THEME.ink};">${escapeHtml(bandName)}</p>
        </td>
      </tr>
    </table>`;
}

// Pied de page COMPLET : qui ecrit, d'ou, comment repondre. Les coordonnees
// viennent du centre reel (ops-knowledge/centers.json) quand l'appelant le
// fournit. Rien n'est invente : sans centre, on n'affiche ni telephone ni
// adresse plutot qu'un numero plausible mais faux.
function footerBlock({ footer, center, replyLine, unsubscribeLine = '', mentions = null }) {
  const info = center?.publicInfo || {};
  const lines = [];
  const centerName = String(center?.name || '').trim();
  // `mentions` (design du centre, 2026-09-16) : le gerant peut retirer
  // l adresse, le telephone ou l email du pied, et y poser une mention libre.
  // Sans design, tout ce que le catalogue connait s affiche, comme avant.
  const montrer = (cle) => !mentions || mentions[cle] !== false;
  // Le nom du centre et la tagline montent dans le BANDEAU NOIR de pied (voir
  // plus bas) : ils ferment le mail comme le bandeau de tete l'ouvre. Ne restent
  // en fin de page claire que les mentions pratiques (adresse, telephone,
  // reponse, retrait de liste), qui doivent se lire, pas se contempler.
  // L'adresse de centres.json contient deja le code postal ET la ville
  // (« L'Alienau, 100, 6800 Libramont »). Recoller `city` derriere produisait
  // « ... 6800 Libramont, Libramont » : on ne l'ajoute que si elle manque.
  const address = String(info.address || '').trim();
  const city = String(info.city || '').trim();
  const place = address && city && !address.toLowerCase().includes(city.toLowerCase())
    ? `${address}, ${city}`
    : (address || city);
  if (place && montrer('adresse')) lines.push(escapeHtml(place));
  const contact = [info.phone && montrer('telephone') ? `Tel. ${info.phone}` : '', montrer('email') ? (info.email || '') : ''].filter(Boolean).join('  ·  ');
  if (contact) lines.push(escapeHtml(contact));
  const custom = String(footer || '').trim();
  if (custom) lines.push(escapeHtml(custom));
  const mention = String((mentions && mentions.mention) || '').trim();
  if (mention && mention !== custom) lines.push(escapeHtml(mention));
  // Sans centre fourni, ce bloc clair peut etre vide, et c'est correct : on
  // n'invente ni adresse ni telephone, et on ne signe jamais du nom d'un
  // autre client (regle inchangee, repli de marque supprime).

  // `replyLine` vaut '' pour les mails STAFF : on n'invite pas l'equipe a
  // repondre a sa propre alerte. Seul `undefined` declenche le defaut client.
  const reply = String(replyLine === undefined || replyLine === null
    ? 'Une question ? Répondez simplement à ce message, il arrive directement chez nous.'
    : replyLine).trim();

  // Retrait de la liste : UNIQUEMENT sur les mails MARKETING (l'appelant le
  // demande explicitement en passant unsubscribeLine). Sur un transactionnel,
  // proposer de se desabonner d'une confirmation de reservation n'a aucun sens
  // et pousse le mail vers l'onglet Promotions : les chemins transactionnels ne
  // passent donc jamais ce parametre.
  //
  // Deux formes acceptees :
  //   - chaine : rendue en texte echappe (compat historique) ;
  //   - { text, url, label } : phrase + LIEN CLIQUABLE (un clic suffit). Le href
  //     passe par safeUrl (http(s) seulement) puis est deja echappe.
  let unsubHtml = '';
  if (unsubscribeLine && typeof unsubscribeLine === 'object' && unsubscribeLine.url) {
    const href = safeUrl(unsubscribeLine.url);
    if (href) {
      const text = escapeHtml(String(unsubscribeLine.text || '').trim());
      const label = escapeHtml(String(unsubscribeLine.label || 'Se desabonner').trim());
      unsubHtml = `${text ? `${text} ` : ''}<a href="${href}" style="color:${EMAIL_THEME.inkSoft};text-decoration:underline;">${label}</a>`;
    }
  } else {
    const unsubText = String(unsubscribeLine || '').trim();
    if (unsubText) unsubHtml = escapeHtml(unsubText);
  }
  const unsub = unsubHtml;

  // PIED SOBRE (2026-08-06, remplace le bandeau noir) : le nom du centre en
  // petit, puis les mentions pratiques en gris. Rien a contempler, tout a lire.
  // Sans centre connu : pas de nom du tout, jamais celui d'un autre client.
  const bandName = centerName;

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin-top:20px;">
      ${bandName ? `<tr>
        <td style="padding:0 12px;font-family:${EMAIL_THEME.font};font-size:12.5px;line-height:1.4;font-weight:600;color:${EMAIL_THEME.inkSoft};">${escapeHtml(bandName)}</td>
      </tr>` : ''}
      ${lines.length ? `<tr>
        <td style="padding:8px 12px 0;font-family:${EMAIL_THEME.font};font-size:12px;line-height:1.7;color:${EMAIL_THEME.inkSoft};">
          ${lines.join('<br>')}
        </td>
      </tr>` : ''}
      ${reply ? `<tr>
        <td style="padding:10px 12px 0;font-family:${EMAIL_THEME.font};font-size:12px;line-height:1.6;color:${EMAIL_THEME.inkSoft};">${escapeHtml(reply)}</td>
      </tr>` : ''}
      ${unsub ? `<tr>
        <td style="padding:8px 12px 0;font-family:${EMAIL_THEME.font};font-size:11.5px;line-height:1.6;color:${EMAIL_THEME.inkSoft};">${unsub}</td>
      </tr>` : ''}
    </table>`;
}

// ── Design du centre : en-tete par gabarit, signature, cloture en double ────
//
// Tout ce qui suit ne s active QUE si l appelant passe un design resolu
// (resolveEmailDesign). Sans design, emailShell rend exactement ce qu il
// rendait avant : les appelants historiques (simulation, gates, scripts) ne
// voient aucune difference.

const PRESETS_CONNUS = ['simple', 'classique', 'epure', 'carte', 'contraste'];

function imageDEnTete(url, largeur, nom, extra = '') {
  return `<img src="${escapeHtml(url)}" width="${largeur}" alt="${escapeHtml(nom)}" style="display:block;border:0;outline:none;text-decoration:none;width:${largeur}px;max-width:${largeur}px;height:auto;${extra}">`;
}

// L en-tete selon le design : nom (le gabarit historique), logo, logo + nom,
// ou rien. Un logo demande mais absent du catalogue retombe sur le nom :
// jamais une image inventee. Le gabarit « contraste » n utilise que le logo
// BLANC declare par le centre (branding.emailLogoDark) : une image prevue pour
// un fond clair, custom ou non, serait illisible sur le bandeau sombre.
function brandHeaderDesign(design, center, preset, couleur) {
  const nom = String(center?.name || '').trim();
  const mode = String(design?.header?.mode || 'nom');
  if (mode === 'aucun') return '';
  const largeur = Number(design?.header?.logoWidth) || 140;
  const veutLogo = mode === 'logo' || mode === 'logo-nom';
  if (preset === 'contraste') {
    const logoBlanc = emailDesign.urlDImage(center?.branding?.emailLogoDark);
    const nomBlanc = nom
      ? `<p style="margin:0;font-family:${EMAIL_THEME.font};font-size:13.5px;line-height:1.3;font-weight:700;letter-spacing:0.2px;color:${EMAIL_THEME.onBlack};">${escapeHtml(nom)}</p>`
      : '';
    let contenu = '';
    if (veutLogo && logoBlanc) {
      contenu = imageDEnTete(logoBlanc, largeur, nom) + (mode === 'logo-nom' && nomBlanc ? `<div style="height:10px;line-height:10px;font-size:10px;">&nbsp;</div>${nomBlanc}` : '');
    } else {
      contenu = nomBlanc;
    }
    if (!contenu) return '';
    return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${EMAIL_THEME.ink}" style="border-collapse:collapse;background:${EMAIL_THEME.ink};">
      <tr>
        <td bgcolor="${EMAIL_THEME.ink}" style="padding:22px 28px;background:${EMAIL_THEME.ink};">${contenu}</td>
      </tr>
    </table>`;
  }
  const logo = design?.header?.logoUrl || emailDesign.urlDImage(center?.branding?.emailLogo);
  if (veutLogo && logo) {
    const texte = mode === 'logo-nom' && nom
      ? `<p style="margin:10px 0 0;font-family:${EMAIL_THEME.font};font-size:13.5px;line-height:1.3;font-weight:700;letter-spacing:0.2px;color:${EMAIL_THEME.ink};">${escapeHtml(nom)}</p>`
      : '';
    const filet = preset === 'epure' ? '' : `border-bottom:1px solid ${EMAIL_THEME.borderSoft};`;
    return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
      <tr>
        <td style="padding:${preset === 'epure' ? '4px 8px 18px' : '18px 28px'};${filet}">${imageDEnTete(logo, largeur, nom)}${texte}</td>
      </tr>
    </table>`;
  }
  if (preset === 'epure') {
    if (!nom) return '';
    return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
      <tr>
        <td style="padding:4px 8px 18px;">
          <p style="margin:0;font-family:${EMAIL_THEME.font};font-size:13.5px;line-height:1.3;font-weight:700;letter-spacing:0.2px;color:${couleur === EMAIL_THEME.ink ? EMAIL_THEME.ink : couleur};">${escapeHtml(nom)}</p>
        </td>
      </tr>
    </table>`;
  }
  return brandHeader(center);
}

// LA SIGNATURE (2026-09-16) : formule de politesse, qui signe (la personne
// sur un mail manuel, l equipe sur une sequence), coordonnees, reseaux. Tout
// vient du design resolu, donc du catalogue ou du gerant : un champ vide est
// OMIS, jamais rempli. Les reseaux sont des liens TEXTE (« Facebook ·
// Instagram ») : aucune icone image, aucune image externe. Le seul <img> est
// le logo, et seulement si une URL existe.
const RESEAUX_LIBELLES = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', linkedin: 'LinkedIn' };

function libelleDuSite(url) {
  try {
    const parsee = new URL(String(url));
    return `${parsee.hostname}${parsee.pathname === '/' ? '' : parsee.pathname}`.replace(/^www\./, '');
  } catch (error) {
    return String(url || '');
  }
}

function renderSignatureHtml({ design = null, center = null, person = null, accent = EMAIL_THEME.ink } = {}) {
  const sig = design && design.signature && typeof design.signature === 'object' ? design.signature : {};
  const nomCentre = String(center?.name || '').trim();
  const police = EMAIL_THEME.font;
  const doux = `color:${EMAIL_THEME.inkSoft};font-size:13px;`;
  const ligne = (html, extra = '') => `<p style="margin:0;font-family:${police};font-size:14px;line-height:1.6;color:${EMAIL_THEME.ink};${extra}">${html}</p>`;
  const lien = (href, texte) => `<a href="${href}" style="color:${accent === EMAIL_THEME.ink ? EMAIL_THEME.ink : accent};text-decoration:underline;">${texte}</a>`;
  const personne = person && String(person.name || '').trim()
    ? { name: String(person.name).trim(), role: String(person.role || '').trim() }
    : null;
  const equipe = String(sig.teamLabel || '').trim() || (nomCentre ? `L'équipe ${nomCentre}` : "L'équipe du centre");
  const closing = String(sig.closing || '').trim();

  // Qui signe.
  const identite = [];
  if (personne) {
    identite.push(`<strong>${escapeHtml(personne.name)}</strong>`);
    // Un role identique au nom (« Direction » signe « Direction ») ne se repete pas.
    const roleDistinct = personne.role && personne.role.toLowerCase() !== personne.name.toLowerCase() ? personne.role : '';
    const sous = [roleDistinct, nomCentre].filter(Boolean).join(' · ');
    if (sous) identite.push(escapeHtml(sous));
  } else {
    identite.push(`<strong>${escapeHtml(equipe)}</strong>`);
    if (String(sig.role || '').trim()) identite.push(escapeHtml(String(sig.role).trim()));
  }

  // Comment joindre.
  const contacts = [];
  const phone = String(sig.phone || '').trim();
  if (phone) {
    const chiffres = phone.replace(/[^\d+]/g, '');
    contacts.push(chiffres.length >= 6 ? lien(`tel:${escapeHtml(chiffres)}`, escapeHtml(phone)) : escapeHtml(phone));
  }
  const email = String(sig.email || '').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) contacts.push(lien(`mailto:${escapeHtml(email)}`, escapeHtml(email)));
  const site = String(sig.website || '').trim();
  const siteSur = /^https:\/\//i.test(site) ? safeUrl(site) : '';
  if (siteSur) contacts.push(lien(siteSur, escapeHtml(libelleDuSite(site))));
  const address = String(sig.address || '').trim();
  if (address) contacts.push(escapeHtml(address));
  const reseaux = [];
  for (const [reseau, libelle] of Object.entries(RESEAUX_LIBELLES)) {
    const url = String((sig.socials && sig.socials[reseau]) || '').trim();
    const sur = /^https:\/\//i.test(url) ? safeUrl(url) : '';
    if (sur) reseaux.push(lien(sur, libelle));
  }

  const rows = [];
  if (closing) rows.push(ligne(escapeHtml(closing), 'margin:0 0 10px;'));
  if (String(sig.layout || 'carte') === 'ligne') {
    // Une seule ligne compacte, sans logo : le nom, puis les coordonnees.
    const morceaux = [identite[0], ...contacts, ...(reseaux.length ? [reseaux.join(' · ')] : [])];
    rows.push(ligne(morceaux.join(' · ')));
    if (identite[1]) rows.push(ligne(identite[1], doux));
    return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin-top:26px;">
      <tr>
        <td valign="top" style="padding:0;">${rows.join('')}</td>
      </tr>
    </table>`;
  }
  rows.push(ligne(identite[0]));
  if (identite[1]) rows.push(ligne(identite[1], doux));
  for (const contact of contacts) rows.push(ligne(contact, doux));
  if (reseaux.length) rows.push(ligne(reseaux.join(' · '), `${doux}margin-top:6px;`));
  const logoUrl = String(sig.logoUrl || '').trim();
  const largeur = Number(sig.logoWidth) || 120;
  const logo = logoUrl
    ? `<td width="${largeur}" valign="top" style="padding:0 18px 0 0;">${imageDEnTete(logoUrl, largeur, nomCentre, 'border-radius:8px;')}</td>`
    : '';
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin-top:26px;">
      <tr>
        ${logo}
        <td valign="top" style="padding:0;${logo ? `padding-left:16px;border-left:2px solid ${EMAIL_THEME.border};` : ''}">${rows.join('')}</td>
      </tr>
    </table>`;
}

// La version texte de la signature, pour l alternative texte d un mail qui
// porte le bloc HTML. Memes champs, meme ordre, sans balise.
function renderSignatureText({ design = null, center = null, person = null } = {}) {
  const sig = design && design.signature && typeof design.signature === 'object' ? design.signature : {};
  const nomCentre = String(center?.name || '').trim();
  const lignes = [];
  const closing = String(sig.closing || '').trim();
  if (closing) lignes.push(closing);
  if (person && String(person.name || '').trim()) {
    lignes.push(String(person.name).trim());
    const role = String(person.role || '').trim();
    const sous = [role.toLowerCase() !== String(person.name).trim().toLowerCase() ? role : '', nomCentre].filter(Boolean).join(' · ');
    if (sous) lignes.push(sous);
  } else {
    lignes.push(String(sig.teamLabel || '').trim() || (nomCentre ? `L'équipe ${nomCentre}` : "L'équipe du centre"));
  }
  for (const cle of ['phone', 'email', 'website', 'address']) {
    const valeur = String(sig[cle] || '').trim();
    if (valeur) lignes.push(valeur);
  }
  return lignes.join('\n');
}

// NE PAS SIGNER DEUX FOIS. Les textes des sequences (et les modeles du
// composeur) se terminent par « À très vite, / L'équipe X » ou par le nom du
// centre seul ; le gerant recopie souvent ces memes lignes dans ses textes.
// Quand le bloc signature est rendu, cette cloture textuelle est retiree du
// corps HTML (le texte source et l alternative texte restent entiers) : le
// mail se termine par UNE signature, la vraie.
function retirerClotureEnDouble(body, center = null) {
  const nom = String(center?.name || '').trim();
  const lignes = String(body || '').replace(/\r\n/g, '\n').split('\n');
  const derniereNonVide = () => {
    let index = lignes.length - 1;
    while (index >= 0 && !lignes[index].trim()) index -= 1;
    return index;
  };
  const normal = (texte) => String(texte || '').trim().toLowerCase().replace(/[’ʼ]/g, '\'').replace(/\s+/g, ' ');
  const signatures = ["l'équipe du centre", "l'equipe du centre"];
  if (nom) {
    const bas = normal(nom);
    signatures.push(`l'équipe ${bas}`, `l'equipe ${bas}`, bas);
  }
  let index = derniereNonVide();
  if (index < 0 || !signatures.includes(normal(lignes[index]))) return body;
  lignes.splice(index);
  index = derniereNonVide();
  if (index >= 0) {
    const avant = lignes[index].trim();
    if (/,$/.test(avant) && avant.length <= 60) lignes.splice(index);
  }
  while (lignes.length && !lignes[lignes.length - 1].trim()) lignes.pop();
  return lignes.join('\n');
}

// Les interrupteurs du pied, moins ce que la signature affiche deja (compare
// au catalogue, qui est la source du pied).
function piedSansDoublonDeSignature(design, center, avecSignature) {
  const footer = design && design.footer && typeof design.footer === 'object' ? design.footer : {};
  if (!avecSignature) return footer;
  const sig = design.signature || {};
  const info = (center && center.publicInfo) || {};
  const memeTexte = (a, b) => String(a || '').trim().toLowerCase().replace(/\s+/g, ' ') === String(b || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return {
    ...footer,
    adresse: footer.adresse !== false && !memeTexte(sig.address, emailDesign.adressePostaleDuCentre(center)),
    telephone: footer.telephone !== false && !memeTexte(sig.phone, info.phone),
    email: footer.email !== false && !memeTexte(sig.email, info.email),
  };
}

// Signature conservee a l'octet pres pour les 13 templates appelants
// (title, body, footer, preheader, details, action, note). Les champs ajoutes
// (center, eyebrow, replyLine, design, signature) sont OPTIONNELS : un appelant
// qui les ignore obtient exactement le meme rendu qu'avant, en mieux habille.
function emailShell({
  title,
  body,
  footer = '',
  preheader = '',
  details = [],
  action = null,
  note = '',
  center = null,
  eyebrow = '',
  // Pas de valeur par defaut : `undefined` signifie « prends la phrase client
  // standard », alors qu'un '' explicite (mails staff) supprime la ligne.
  replyLine,
  // Couleur d'accent (eyebrow + bouton). Defaut = ENCRE NEUTRE : le gabarit
  // est commun a tous les centres, aucune couleur de client par defaut. Les
  // mails STAFF passent l'ambre : un « ALERTE TERRAIN » ne peut pas avoir la
  // meme temperature qu'un « RESERVATION CONFIRMEE » dans une boite.
  accent = EMAIL_THEME.ink,
  // Ligne de retrait, campagnes marketing UNIQUEMENT.
  unsubscribeLine = '',
  // Le design RESOLU du centre (resolveEmailDesign) : gabarit, accent, en-tete,
  // pied. Null = rendu historique, a l identique.
  design = null,
  // { enabled, person: { name, role } | null } : le bloc signature, et qui
  // signe. `person` n est fourni que par les envois MANUELS ; une sequence
  // signe de l equipe.
  signature = null,
}) {
  // Le preheader est le texte d'apercu en boite de reception : c'est lui qui
  // decide de l'ouverture. Les caracteres invisibles qui suivent empechent le
  // client mail de completer l'apercu avec le debut du corps (« Bonjour
  // Marie, » en apercu = une ligne gachee).
  const preheaderHtml = preheader
    ? `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;color:transparent;font-size:1px;line-height:1px;">${escapeHtml(preheader)}${'&#8203;&nbsp;'.repeat(60)}</div>`
    : '';

  const gabarit = design && typeof design === 'object' ? design : null;
  const preset = gabarit && PRESETS_CONNUS.includes(gabarit.preset) ? gabarit.preset : 'classique';
  // « Mail simple » : le mail d une personne, pas une affiche. Le sujet reste
  // dans l objet du mail, jamais repete en titre dans le corps.
  const simple = Boolean(gabarit) && preset === 'simple';
  // L accent explicite d un appelant (l ambre des alertes staff) prime sur la
  // couleur du design : un signal d exploitation ne prend pas la couleur du
  // client.
  const couleur = accent !== EMAIL_THEME.ink ? accent : (gabarit ? emailDesign.accentEffectif(gabarit, center, EMAIL_THEME.ink) : accent);
  const avecSignature = Boolean(gabarit && signature && signature.enabled && gabarit.signature && gabarit.signature.enabled !== false);
  const signatureHtml = avecSignature
    ? renderSignatureHtml({ design: gabarit, center, person: signature.person || null, accent: couleur })
    : '';
  const corps = signatureHtml ? retirerClotureEnDouble(body, center) : body;
  const enTete = simple ? '' : (gabarit ? brandHeaderDesign(gabarit, center, preset, couleur) : brandHeader(center));
  const fondPage = preset === 'epure' || simple ? EMAIL_THEME.card : EMAIL_THEME.paper;
  // Mail simple : AUCUN fond. Gmail en sombre transformait le blanc declare en
  // panneau gris ; sans fond, la messagerie pose le sien, comme pour un vrai mail.
  const styleCarte = simple ? 'padding:0;' : preset === 'epure'
    ? `background:${EMAIL_THEME.card};padding:0;`
    : `background:${EMAIL_THEME.card};border:1px solid ${EMAIL_THEME.border};${preset === 'carte' ? `border-top:4px solid ${couleur};` : ''}border-radius:12px;overflow:hidden;padding:0;`;
  const margesCorps = simple ? '0 0 8px' : (preset === 'epure' ? '22px 8px 34px' : '26px 28px 30px');
  const styleTitre = preset === 'epure'
    ? `margin:0 0 18px;padding-bottom:14px;border-bottom:1px solid ${EMAIL_THEME.borderSoft};font-family:${EMAIL_THEME.font};font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.2px;color:${EMAIL_THEME.ink};`
    : `margin:0 0 16px;font-family:${EMAIL_THEME.font};font-size:20px;line-height:1.3;font-weight:700;letter-spacing:-0.2px;color:${EMAIL_THEME.ink};`;
  // UNE COORDONNEE NE S ECRIT PAS DEUX FOIS. Quand la signature porte deja le
  // telephone, l email ou l adresse du catalogue, le pied ne les repete pas :
  // il garde le nom du centre, la phrase de reponse, la mention libre et la
  // ligne de retrait. Le gerant garde la main : un champ retire de la
  // signature revient au pied si son interrupteur de pied est allume.
  // Un mail simple n a pas de pied de marque : seulement la mention libre du
  // gerant et, sur une campagne, la ligne de retrait (obligatoire).
  const pied = simple
    ? footerBlock({
      footer, center: null, replyLine: '', unsubscribeLine,
      mentions: { adresse: false, telephone: false, email: false, mention: String((gabarit.footer && gabarit.footer.mention) || '') },
    })
    : footerBlock({
      footer, center, replyLine, unsubscribeLine,
      mentions: gabarit ? piedSansDoublonDeSignature(gabarit, center, avecSignature) : null,
    });

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    ${simple ? '' : `<meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">`}
    <title>${escapeHtml(preheader || title || 'Message de votre centre')}</title>
    <!-- FINITION MOBILE, strictement ADDITIVE. Tous les styles de base restent
         inline : ce bloc ne fait que les raffiner sous 480px. Un client qui
         ignore <style> ou les media queries (Outlook Windows) garde la version
         desktop, qui est deja juste. Le !important est indispensable, une regle
         de feuille ne bat pas un style inline sans lui.
         .fg-h1     : 26px en capitales tenait jusqu'a trois lignes sur un
                      telephone de 390px, avec des orphelines a quatre lettres
                      (« POUR » / « L'ANNIVERSAIRE DE » / « TOM »). Les
                      majuscules coutent environ 15 % de largeur en plus, le
                      probleme est structurel.
         .fg-logo   : la largeur d'une image en mail se pilote par l'attribut
                      width ET par le style. On ne peut pas changer l'attribut
                      selon la largeur d'ecran, donc la regle CSS le surcharge,
                      et la hauteur figee de la cellule suit dans le meme
                      mouvement, sinon le bandeau garderait la reserve desktop
                      sous un logo devenu plus petit. -->
    <style>
      @media only screen and (max-width:480px) {
        .fg-h1 { font-size:18px !important; }
      }
    </style>
    <!--[if mso]>
    <style>body,table,td,p,h1,a{font-family:'Montserrat','Segoe UI',Arial,sans-serif !important;}</style>
    <![endif]-->
  </head>
  <body style="margin:0;padding:0;width:100%;${simple ? '' : `background:${fondPage};`}${simple ? 'font-family:Arial,Helvetica,sans-serif;' : `font-family:${EMAIL_THEME.font};color:${EMAIL_THEME.ink};`}-webkit-font-smoothing:antialiased;">
    ${simple && String(preheader || '').trim() === String(title || '').trim() ? '' : preheaderHtml}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" ${simple ? 'style="border-collapse:collapse;"' : `bgcolor="${fondPage}" style="border-collapse:collapse;background:${fondPage};"`}>
      <tr>
        <td align="${simple ? 'left' : 'center'}" style="padding:${simple ? '0' : '32px 16px 40px'};">
          <table role="presentation" width="${simple ? '100%' : '600'}" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;${simple ? '' : 'max-width:600px;'}">
            <tr>
              <td ${simple ? '' : `bgcolor="${EMAIL_THEME.card}" `}style="${styleCarte}">
                ${enTete}
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                  <tr>
                    <td style="padding:${margesCorps};">
                ${eyebrow && !simple ? `<p style="margin:0 0 10px;font-family:${EMAIL_THEME.font};font-size:11px;line-height:1.3;letter-spacing:1px;font-weight:700;color:${couleur === EMAIL_THEME.ink ? EMAIL_THEME.inkSoft : couleur};text-transform:uppercase;">${escapeHtml(eyebrow)}</p>` : ''}
                ${simple ? '' : `<h1 class="fg-h1" style="${styleTitre}">${escapeHtml(title)}</h1>`}
                ${textToHtml(corps, { simple })}
                ${detailRows(details, { sansFond: simple })}
                ${actionButton(action, couleur)}
                ${signatureHtml}
                ${note ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin-top:22px;">
                  <tr>
                    <td style="padding-top:18px;border-top:1px solid ${EMAIL_THEME.borderSoft};font-family:${EMAIL_THEME.font};font-size:13.5px;line-height:1.6;color:${EMAIL_THEME.inkSoft};">${escapeHtml(note)}</td>
                  </tr>
                </table>` : ''}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td>${pied}</td>
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
  // Formules « Ancres + Liberté » : plus d'ordre imposé, les rendez-vous
  // (ancres), la table et le pass liberté sont décrits séparément.
  if (reservation.type === 'formule') return '';
  const steps = Array.isArray(reservation.opsPlan?.timeline)
    ? reservation.opsPlan.timeline.filter((step) => step.type === 'activity').slice(0, 4)
    : [];
  if (!steps.length) return '';
  const order = steps.map((step) => step.label).join(' puis ');
  return `L’ordre prévu pour votre groupe est ${order}.`;
}

// LE PROGRAMME DU DOSSIER, HEURE PAR HEURE (Movsar, 2026-10-14 : « les mails
// sont pas correct et explique mal [...] ya les deux parties de laser qui ont
// un horaire choisi et arcade aussi et ça dit que arcade c a votre rythme »).
// Tout vient du plan que la reservation garde (opsPlan), jamais de la demande :
// chaque partie a sa ligne (countIndex), ses sessions a la suite comprises ;
// les arcades a l heure choisie (etape posee de la frise, flexible: false) sont
// a l heure ; une partie laissee a l equipe (laserPassPlan) se dit placee sur
// place ; seul ce qui n a pas d heure se vit « à votre rythme ». Formule ou
// visite, le meme programme, dans la confirmation et dans le rappel.
const RESSOURCES_A_HEURE = ['bowling_lane', 'laser_arena'];
const NOMS_DE_RESSOURCE = { bowling_lane: 'Bowling', laser_arena: 'Laser Game' };
function nomDuCatalogue(id) {
  if (!id) return '';
  try { const a = require('./ops-knowledge').getActivity(id); return (a && (a.name || a.label)) || ''; } catch (error) { return ''; }
}
function minutesDuPlan(heure) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(heure || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}
function heureDuPlan(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
function listeFr(mots) {
  return mots.length < 2 ? (mots[0] || '') : `${mots.slice(0, -1).join(', ')} et ${mots[mots.length - 1]}`;
}
function programmeDuPlan(reservation, formula = null) {
  const plan = reservation.opsPlan || {};
  const blocs = Array.isArray(plan.resourceBlocks) ? plan.resourceBlocks : [];
  const frise = Array.isArray(plan.timeline) ? plan.timeline : [];
  // « Laser Game - groupe 2/3 » : le nom de l activite, sans la session ;
  // sans libelle, celui du catalogue, sinon celui de la ressource.
  const nomDe = (label, id, ressource) => String(label || '').replace(/\s+-\s+groupe\s+\d+\/\d+$/i, '').trim()
    || nomDuCatalogue(id) || NOMS_DE_RESSOURCE[ressource] || String(id || '');
  // Une partie = ses sessions ; sans countIndex, une session suivante
  // (groupWaveIndex > 1) rejoint la partie d avant.
  const parties = [];
  blocs.forEach((b) => {
    if (!b || !b.startTime || !RESSOURCES_A_HEURE.includes(b.resourceType)) return;
    const index = Number(b.countIndex);
    const memes = parties.filter((p) => p.ressource === b.resourceType);
    let p = Number.isFinite(index) ? memes.find((x) => x.index === index)
      : (Number(b.groupWaveIndex) > 1 ? memes[memes.length - 1] : null);
    if (!p) {
      p = { ressource: b.resourceType, index: Number.isFinite(index) ? index : memes.length + 1, debut: b.startTime, fin: b.endTime || '', blocs: 0, sessions: 0, quoi: nomDe(b.label, b.activityId, b.resourceType), pistes: Number(b.requiredLanes) || 0 };
      parties.push(p);
    }
    if (b.startTime < p.debut) p.debut = b.startTime;
    if (String(b.endTime || '') > p.fin) p.fin = String(b.endTime || '');
    p.blocs += 1;
    p.sessions = Math.max(p.blocs, Number(b.groupWaveCount) || 0);
  });
  const lasers = parties.filter((p) => p.ressource === 'laser_arena');
  const passe = plan.laserPassPlan || {};
  // Les parties que l equipe place : celles du plan, sinon celles qui restent
  // apres les parties posees.
  const enAttente = Array.isArray(passe.pendingPasses) && passe.pendingPasses.length
    ? passe.pendingPasses.map((x) => Number(x && x.countIndex)).filter((k) => k > 0)
    : Array.from({ length: Math.max(0, Math.trunc(Number(passe.remainingGames) || 0)) }, (_, k) => lasers.length + k + 1);
  const totalLaser = Math.max(lasers.length + enAttente.length, Math.trunc(Number(passe.totalGames) || 0));
  const lignes = [];
  parties.forEach((p) => {
    const detail = p.ressource === 'laser_arena'
      ? [totalLaser > 1 ? `partie ${p.index} sur ${totalLaser}` : '', p.sessions > 1 ? `en ${p.sessions} sessions à la suite` : '']
      : [p.pistes > 0 ? `${p.pistes} piste${p.pistes > 1 ? 's' : ''}` : '', p.sessions > 1 ? `en ${p.sessions} tours` : ''];
    lignes.push({ debut: p.debut, fin: p.fin, quoi: [p.quoi, ...detail].filter(Boolean).join(', ') });
  });
  // Ce que la frise pose a une heure sans ressource a heure (les arcades a
  // l heure choisie).
  frise.forEach((e) => {
    if (!e || e.type !== 'activity' || e.flexible !== false || !e.startTime || !e.activityId) return;
    if (RESSOURCES_A_HEURE.includes(e.resourceType) || e.resourceType === 'party_table' || e.activityId === 'service_drinks') return;
    if (['bowling', 'laser_game'].includes(e.activityId)) return;
    lignes.push({ debut: e.startTime, fin: e.endTime || '', quoi: nomDe(e.label, e.activityId) });
  });
  lignes.sort((a, b) => minutesDuPlan(a.debut) - minutesDuPlan(b.debut));
  const sansHeure = [];
  if (enAttente.length) {
    const nomLaser = (lasers[0] && lasers[0].quoi) || 'Laser Game';
    const plusieurs = enAttente.length > 1;
    sansHeure.push(`${nomLaser}, partie${plusieurs ? 's' : ''} ${listeFr(enAttente.map(String))} sur ${totalLaser}, placée${plusieurs ? 's' : ''} sur place avec l'équipe selon l'affluence`);
  }
  // Ce qui se vit sans heure : les etapes libres de la frise d une formule,
  // les activites sans creneau d une visite.
  const libres = [];
  frise.forEach((e) => {
    if (!e || e.type !== 'activity' || !e.activityId || e.flexible === false || e.activityId === 'service_drinks') return;
    if (RESSOURCES_A_HEURE.includes(e.resourceType) || e.resourceType === 'party_table' || ['bowling', 'laser_game'].includes(e.activityId)) return;
    const quoi = nomDe(e.label, e.activityId);
    const minutes = e.activityId === 'arcade_time' ? Math.round(Number(e.durationMinutes) || 0) : 0;
    libres.push(`${quoi}${minutes > 0 ? `, ${minutes} min` : ''}, à votre rythme`);
  });
  const items = Array.isArray(reservation.program) ? reservation.program : (reservation.program && reservation.program.items) || [];
  if (reservation.type !== 'formule') {
    items.forEach((it) => {
      if (!it || it.planned === true || !it.activityId || it.waitOffer === true) return;
      libres.push(`${it.name || it.activityId}, à votre rythme`);
    });
  }
  const boissons = frise.some((e) => e && e.activityId === 'service_drinks');
  const etapeBoissons = boissons && formula && Array.isArray(formula.steps) ? formula.steps.find((s) => s && s.activityId === 'service_drinks') : null;
  [...new Set(libres)].forEach((l) => sansHeure.push(l));
  if (boissons) sansHeure.push((etapeBoissons && etapeBoissons.label) || 'Boissons');
  // La fin dite au client, sans la marge de l equipe. UNE VISITE A LA CARTE
  // (2026-10-15) : son plan ne porte que le bowling et le laser ; sa fin est
  // celle de toute la visite, que le formulaire et la fenetre Reserver disent
  // (finDeLaVisite : les activites libres, chacune d un bloc). Le mail disait
  // « Fin estimée vers 17:00 » une visite que le formulaire finissait a 17:45.
  const finPlan = minutesDuPlan(plan.endTime);
  let fin = Number.isFinite(finPlan) && lignes.length ? heureDuPlan(Math.max(0, finPlan - Math.max(0, Math.round(Number(plan.bufferMinutes) || 0)))) : '';
  // Seul un dossier qui porte son programme change : un bowling ou un laser
  // seul garde sa fin. Charge a l appel : la fenetre Reserver passe par
  // reservation-ops, qui charge ce module.
  if (fin && reservation.type !== 'formule' && items.length) fin = require('./reserver-fenetre').finDeLaVisite(plan, reservation) || fin;
  const table = blocs.find((b) => b && b.resourceType === 'party_table' && b.startTime);
  return { lignes, sansHeure, fin, table: table ? table.startTime : '' };
}
// Le programme en lignes de mail : un titre, une puce par chose (a l heure,
// puis sans heure), la fin. Rien quand le plan ne pose aucune heure.
// LA FIN EST UNE ESTIMATION (Movsar, 2026-10-14 : « fin de la visite c une
// estimation mais pas une obligation ») : elle se dit comme telle, jamais
// comme une heure de depart.
function lignesDuProgramme(reservation, formula = null) {
  const p = programmeDuPlan(reservation, formula);
  const out = [];
  if (p.lignes.length) {
    out.push('**Votre programme**');
    p.lignes.forEach((l) => out.push(`- ${l.debut}${l.fin ? ` à ${l.fin}` : ''}, ${l.quoi}`));
    p.sansHeure.forEach((l) => out.push(`- ${l}`));
    if (p.fin) out.push(`Fin estimée vers ${p.fin}, à titre indicatif et sans heure de départ imposée.`);
  }
  if (p.table) out.push(`Votre table vous attend dès votre arrivée (${p.table}).`);
  return out;
}

function buildLaserSessionSentence(reservation) {
  const hasLaser = reservation.type === 'laser'
    || (reservation.opsPlan?.resourceBlocks || []).some((block) => block.resourceType === 'laser_arena');
  if (!hasLaser) return '';
  const sharing = reservation.opsPlan?.laserSharing || null;
  if (sharing?.splitGroup) {
    // LA CAUSE AVANT LA CONSEQUENCE, et le MEME vocabulaire que le tunnel
    // (« postes », « sessions »). Le nombre de postes n est cite que si le
    // centre l a declare : un `|| 30` faisait ecrire une capacite inventee a
    // un client dont le centre en a vingt.
    const postes = Number(sharing.weaponCount) > 0 ? Math.trunc(Number(sharing.weaponCount)) : null;
    const joueurs = Number(sharing.requestedPlayers) > 0 ? Math.trunc(Number(sharing.requestedPlayers)) : null;
    const sessions = Math.max(2, Math.trunc(Number(sharing.waveCount) || 2));
    const cause = postes && joueurs
      ? `Vous êtes ${joueurs} et l’arène Laser Game compte ${postes} postes, `
      : (postes ? `L’arène Laser Game compte ${postes} postes, ` : '');
    const suite = `votre groupe jouera ${cause ? 'donc ' : ''}en ${sessions} sessions qui se suivent, chacune avec le même nombre de parties.`;
    return cause
      ? `${cause}${suite}`
      : `Pour le Laser Game, ${suite}`;
  }
  if (sharing?.sharedNow) {
    return 'Votre session Laser Game est prévue sur un départ qui peut être partagé avec un autre groupe.';
  }
  return 'Pour le Laser Game, la session peut être complétée avec d’autres joueurs selon l’affluence.';
}

// Substitution des variables {{...}} des textes personnalisés (accents
// tolérés). Les tokens inconnus sont REJETÉS à la sauvegarde : jamais laissés
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
// détails : le texte du gérant EST le message, même choix que l'override des
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

// Passe un message construit par buildDefaultMessage dans le gabarit. Le SUJET
// vend l'ouverture en boite de reception, le TITRE vend la lecture une fois le
// mail ouvert : ce ne sont pas le meme texte. Sans `title`, on retombe sur le
// sujet (comportement historique des appelants qui n'ont pas ete touches).
// Centre reel ou null. Jamais d'exception : un pied de page sans telephone vaut
// mieux qu'un mail qui n'part pas parce qu'un centre a ete renomme.
function centerOrNull(centerId) {
  try {
    return getCenter(centerId || 'libramont');
  } catch (error) {
    return null;
  }
}

// `habillage` = { design, signature } resolu par l appelant (voir habillageDe).
// Absent : rendu historique, sans signature.
function shellFromMessage(message, center = null, habillage = null) {
  return emailShell({
    title: message.title || message.subject,
    body: message.body,
    preheader: message.preheader,
    details: message.details,
    action: message.action,
    note: message.note,
    eyebrow: message.eyebrow,
    replyLine: message.replyLine,
    accent: message.accent,
    unsubscribeLine: message.unsubscribeLine,
    center,
    design: habillage ? habillage.design : null,
    signature: habillage ? habillage.signature : null,
  });
}

// L habillage d un envoi : le design du centre et la signature selon la
// PORTEE (manual, sequences, campaigns) choisie par le gerant. `person` n est
// fourni que par un envoi manuel (celui qui ecrit signe) ; une sequence signe
// de l equipe. Un centre inconnu (design null) rend le gabarit historique.
function habillageDe(design, portee, person = null) {
  if (!design || typeof design !== 'object') return null;
  const scope = design.signatureScope && typeof design.signatureScope === 'object' ? design.signatureScope : {};
  return { design, signature: { enabled: scope[portee] === true, person: person || null } };
}

// Le centre d un design : jamais un repli sur libramont (un design sans centre
// n a ni coordonnees ni logo), et jamais d exception.
function centreDuDesign(centerId) {
  const id = String(centerId || '').trim();
  if (!id) return null;
  try {
    return getCenter(id);
  } catch (error) {
    return null;
  }
}

// Le design RESOLU d un centre : defauts du catalogue + ce que le gerant a
// enregistre (settings.email_design), valide avec indulgence. Cache memoire
// de 60 s par centre, UNIQUEMENT sur les deps par defaut : un `query` injecte
// (gates, scripts) lit toujours la base qu on lui donne.
const DESIGN_CACHE = new Map();
const DESIGN_CACHE_MS = 60 * 1000;

async function resolveEmailDesign(centerId, deps = defaultDeps()) {
  const cle = String(centerId || '').trim();
  const cachable = Boolean(deps && deps.parDefaut);
  if (cachable) {
    const enCache = DESIGN_CACHE.get(cle);
    if (enCache && enCache.expire > Date.now()) return enCache.design;
  }
  const center = centreDuDesign(cle);
  const stored = cle ? await readStoredAutomationSettings(cle, deps) : {};
  const design = emailDesign.fusionnerEmailDesign(stored.email_design, center);
  if (cachable) DESIGN_CACHE.set(cle, { design, expire: Date.now() + DESIGN_CACHE_MS });
  return design;
}

function invaliderCacheDesign(centerId) {
  if (centerId === undefined) DESIGN_CACHE.clear();
  else DESIGN_CACHE.delete(String(centerId || '').trim());
}

// L ecriture du design : UNE cle du jsonb, jamais le blob entier. Les
// sequences (request_received, confirmation...), custom_sequences et
// email_brain vivent dans le meme objet : une lecture-modification-ecriture
// les aurait ecrases au premier enregistrement concurrent.
async function saveEmailDesign(centerId, brouillon, { member = null } = {}, deps = defaultDeps()) {
  const cle = String(centerId || '').trim();
  if (!cle) {
    const error = new Error('Centre requis.');
    error.expose = true;
    error.statusCode = 400;
    throw error;
  }
  const center = centreDuDesign(cle);
  const valide = emailDesign.validateEmailDesign(brouillon, center);
  valide.updatedAt = new Date().toISOString();
  valide.updatedBy = String((member && (member.name || member.id)) || '').slice(0, 80);
  await deps.query(
    `insert into center_automation_settings (center_id, settings, updated_at)
     values ($1, jsonb_build_object('email_design', $2::jsonb), now())
     on conflict (center_id) do update
       set settings = coalesce(center_automation_settings.settings, '{}'::jsonb) || jsonb_build_object('email_design', $2::jsonb),
           updated_at = now();`,
    [cle, JSON.stringify(valide)],
  );
  invaliderCacheDesign(cle);
  return emailDesign.fusionnerEmailDesign(valide, center);
}

// Tout ce que la page Apparence a besoin de lire en un appel.
// OU ARRIVENT LES REPONSES DES CLIENTS (2026-09-17) : l adresse que les mails
// donnent vraiment en Reply-To, calculee par la regle de l envoi. La page
// Expediteurs lisait l adresse publique de la fiche et en affichait une fausse
// quand le reglage de retour la remplacait par l adresse de reception.
function adresseDeReponseDuCentre(centerId) {
  const adresse = replyToAddress({ centerId, payload: {} });
  return { adresse, versPinlane: Boolean(adresse) && domaineDe(adresse) === domaineReception() };
}

async function getEmailDesignBundle(centerId, deps = defaultDeps()) {
  const cle = String(centerId || '').trim();
  const center = centreDuDesign(cle);
  const stored = cle ? await readStoredAutomationSettings(cle, deps) : {};
  const brut = stored.email_design && typeof stored.email_design === 'object' ? stored.email_design : null;
  return {
    design: emailDesign.fusionnerEmailDesign(brut, center),
    stored: brut,
    defaults: emailDesign.getEmailDesignDefaults(center),
    presets: emailDesign.EMAIL_DESIGN_PRESETS.map((preset) => ({ ...preset })),
    center: center
      ? { id: String(center.id || cle), name: String(center.name || ''), publicInfo: center.publicInfo || {}, branding: center.branding || {} }
      : { id: cle, name: '', publicInfo: {}, branding: {} },
    logos: emailDesign.logosDisponibles(center),
    reponse: adresseDeReponseDuCentre(cle),
  };
}

function buildMessage({ reservation, templateId, channel, overrides = null }) {
  const base = buildDefaultMessage({ reservation, templateId, channel });
  const bowlingWarnings = [...new Set((reservation.opsPlan?.resourceBlocks || []).map((b) => b.emergencyWarning).filter(Boolean))];
  if (channel === 'email' && bowlingWarnings.length) {
    base.body = [base.body, ...bowlingWarnings].join('\n');
    if (Array.isArray(base.details)) base.details.push({ label: 'Capacité bowling', value: bowlingWarnings.join(' ') });
  }
  const items = Array.isArray(reservation.program) ? reservation.program : reservation.program?.items;
  if (channel === 'email' && Array.isArray(items) && items.length && Array.isArray(base.details)) {
    base.details = base.details.map((detail) => detail.label === 'Participants'
      ? { ...detail, label: 'Personnes présentes' }
      : detail);
    base.details.push(...items.map((item) => {
      const count = item.participants ?? reservation.pax;
      const noun = /enfant/i.test(item.unitLabel || '') ? 'enfant' : 'participant';
      return {
        label: item.name || item.activityId,
          value: `${count} ${noun}${count > 1 ? 's' : ''}${item.extraLaser ? ` · ${item.games} partie${item.games > 1 ? 's' : ''} + ${item.extraLaser.games - item.games} partie${item.extraLaser.games - item.games > 1 ? 's' : ''} pour ${item.extraLaser.participants} participants, placée${item.extraLaser.games - item.games > 1 ? 's' : ''} sur place` : ''} · ${item.priceKnown === true ? formatEuro(item.price) : 'Tarif à l’accueil'}${Number((item.extraLaser || item.upsell)?.discountAmount) > 0 ? ` · remise ${formatEuro((item.extraLaser || item.upsell).discountAmount)}` : ''}${item.arcadeOffer ? ` · ${require('./arcade-offers').arcadeSummary(item)}` : ''}`,
      };
    }));
  }
  if (channel !== 'email' || !overrides) return base;
  if (!['request_received', 'confirmation', 'reminder_48h'].includes(templateId)) return base;
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
  // sur la fenêtre fixe du plan Ops (10 min par défaut). ZERO EST UNE VALEUR
  // (2026-10-13) : la premiere activite ouvre la journee et le groupe vient a
  // son heure, ou le dossier a ete compose a partir de l heure d arrivee du
  // client, accueil compris. `|| 10` lui faisait dire « 10 minutes plus tot ».
  const avanceDuPlan = reservation.opsPlan ? reservation.opsPlan.arrivalMinutes : null;
  const arrivalLead = reservation.opsPlan && reservation.opsPlan.arrivalPlan ? 0
    : avanceDuPlan === null || avanceDuPlan === undefined || avanceDuPlan === '' || !Number.isFinite(Number(avanceDuPlan)) ? 10
      : Math.max(0, Math.round(Number(avanceDuPlan)));
  const offer = reservation.label || formula?.name || (reservation.type === 'formule' ? 'votre formule' : reservation.type === 'laser' ? 'Laser Game' : 'bowling');
  const programme = lignesDuProgramme(reservation, formula);
  // Le programme dit deja l ordre, heure par heure.
  const opsPlanSentence = programme.length ? '' : buildOpsPlanSentence(reservation);
  const laserSentence = buildLaserSessionSentence(reservation);
  const delayUpdate = reservation.delayUpdate || reservation.opsDelay || null;

  if (channel === 'sms') {
    const lead = `${arrivalLead} min`;
    return {
      subject: '',
      body: `${center.name}: petit rappel pour ${reservation.name}. Réservation ${reservation.date} à ${reservation.startTime}.${arrivalLead > 0 ? ` Merci d'arriver ${lead} avant.` : ''} Si vous avez du retard, prévenez le centre.`,
    };
  }

  // ── Famille STAFF ────────────────────────────────────────────────────────
  // Ces messages ne partent PAS au client. Le staff lit son mail entre deux
  // groupes, souvent debout : l'objet doit contenir la decision a prendre et
  // les faits chiffres, le corps tient en trois lignes, la carte de details
  // porte le reste. Aucune formule commerciale, aucun « nous avons le plaisir ».
  if (templateId === 'staff_review_request') {
    // ECRIT COMME UN COLLEGUE ECRIT (2026-10-05, Movsar : « texte trop IA, les
    // deux-points mis inutilement »). Pas d etiquettes « Pourquoi : », pas de
    // jargon entre parentheses : des phrases. La raison vient du moteur
    // (situations-validation, champ `phrase`), une seule source pour le mail
    // et la console.
    const decision = (reservation.opsPlan && reservation.opsPlan.validation) || reservation.validation || null;
    const declencheurs = decision && Array.isArray(decision.declencheurs) ? decision.declencheurs : [];
    // « Arene presque pleine » dit deja le partage : on ne le redit pas.
    const dejaDit = new Set(declencheurs.map((d) => d.id));
    const aSurveiller = (decision && Array.isArray(decision.aSurveiller) ? decision.aSurveiller : [])
      .filter((d) => !(d.id === 'laser_partage' && dejaDit.has('laser_plein')));
    const phraseDe = (d) => d.phrase || (d.detail ? `${d.mot}, ${d.detail}.` : `${d.mot}.`);
    const blockingLabels = (reservation.opsPlan?.conflicts || [])
      .filter((conflict) => conflict.severity === 'blocking')
      .map((conflict) => conflict.label || conflict.message)
      .filter(Boolean);
    // « FORMULE 4 » du catalogue ne crie pas dans une phrase : « Formule 4 ».
    const offreLisible = /^[^a-z]+$/.test(offer) && /[A-Z]{3}/.test(offer) ? offer.charAt(0) + offer.slice(1).toLowerCase() : offer;
    const parFormule = !declencheurs.length && decision && decision.raison;
    const impossible = declencheurs.some((d) => d.id === 'impossible') || (!declencheurs.length && !parFormule);
    const sansPoint = (t) => String(t || '').trim().replace(/[.\s]+$/, '');
    const raisons = declencheurs.length
      ? declencheurs.map(phraseDe)
      : parFormule
        ? [`${offreLisible} est réglée pour toujours passer par l’équipe.`]
        : [`Le planning n’a pas trouvé de place sûre pour ce groupe. ${blockingLabels.length ? `${blockingLabels.map(sansPoint).join(', ')}.` : (reservation.planWarning ? `${sansPoint(reservation.planWarning)}.` : 'Il faut caler les pistes, le laser ou les tables à la main.')}`];
    const quand = `${formatDateLongFr(reservation.date)} à ${reservation.startTime}`;
    const niveauMot = { minimal: 'Minimal', normal: 'Normal', prudent: 'Prudent' }[decision && decision.niveau] || '';
    return {
      subject: `Réservation à valider · ${reservation.name} · ${formatDateFr(reservation.date).slice(0, 5)} à ${reservation.startTime} · ${reservation.pax} pers.`,
      title: `${reservation.name}, ${quand}`,
      eyebrow: 'Réservation à valider',
      body: [
        impossible
          ? `La demande de ${reservation.name} n’a pas pu être placée toute seule.`
          : `La demande de ${reservation.name} est placée, mais elle attend ton accord.`,
        '',
        ...raisons,
        ...aSurveiller.map(phraseDe),
        '',
        impossible
          ? 'Regarde le planning, place le groupe, puis confirme ou propose une autre heure au client.'
          : 'Tu peux la confirmer telle quelle depuis la console, ou proposer une autre heure au client.',
        '',
        'Le client a reçu un accusé de réception. Sa réservation sera confirmée quand tu l’auras validée.',
      ].join('\n'),
      preheader: `${reservation.name}, ${reservation.pax} personnes, ${quand}.`,
      // Le titre dit deja qui et quand : la carte ne porte que le reste.
      details: [
        ...(reservation.phone ? [{ label: 'Téléphone', value: reservation.phone }] : []),
        { label: 'Personnes', value: `${reservation.pax}` },
        { label: 'Offre', value: offreLisible },
      ],
      action: { href: `${publicAppUrl()}/`, label: 'Ouvrir la console' },
      replyLine: '',
      // La couleur du centre (son design), comme ses autres mails : plus de
      // marron « alerte » qui n est ni Pinlane ni le centre (Movsar, 2026-10-05).
      // Le reglage qui a fait partir ce mail, dit en petit, sans etiquette.
      note: declencheurs.length && niveauMot
        ? `Ce mail part parce que ton centre est réglé sur « ${niveauMot} ». Tu peux changer ce réglage dans Établissement, onglet Règles.`
        : parFormule
          ? 'Ce réglage se change dans Tarifs & formules.'
          : '',
    };
  }

  // Alerte terrain : un retard est constaté pendant le service. Le staff a
  // besoin de trois choses et rien d'autre : qui, combien de minutes, quoi faire.
  if (templateId === 'staff_alert' || templateId === 'delay_staff_attention') {
    const delayMinutes = Number(delayUpdate?.delayMinutes || reservation.delayMinutes || 0);
    const reasonLabel = delayUpdate?.reason || reservation.delayReason || 'retard signalé';
    const nextAction = delayUpdate?.nextAction
      || reservation.nextAction
      || 'Prévenir le groupe suivant et décaler le lancement si la marge ne tient pas.';
    // Ces deux mails partaient avec le MEME objet, le meme eyebrow et le meme
    // titre : dans une boite, le second passait pour un doublon du premier et
    // se faisait ignorer. Or ils ne demandent pas la meme chose. `staff_alert`
    // INFORME (le retard est constate, le plan tient), `delay_staff_attention`
    // reclame une DECISION (le decalage n'a pas pu etre absorbe). L'objet, le
    // sur-titre et le titre disent maintenant lequel des deux c'est.
    const needsDecision = templateId === 'delay_staff_attention';
    const who = `${reservation.name}, ${reservation.startTime}`;
    const howLate = delayMinutes ? `${delayMinutes} min` : 'terrain';
    return {
      subject: needsDecision
        ? `Décision à prendre : retard ${howLate}, ${who}`
        : `Info retard ${howLate} : ${who}`,
      title: needsDecision ? 'Ce retard demande une décision' : 'Retard terrain en cours',
      eyebrow: needsDecision ? 'Décision staff requise' : 'Info terrain',
      // La couleur du centre (son design), comme ses autres mails : plus de
      // marron « alerte » qui n est ni Pinlane ni le centre (Movsar, 2026-10-05).
      body: [
        `${reservation.name} (${reservation.pax} pers., ${offer}) prend ${delayMinutes ? `${delayMinutes} minutes` : 'du'} de retard.`,
        '',
        `Cause : ${reasonLabel}.`,
        `À faire : ${nextAction}`,
        '',
        needsDecision
          ? "Le décalage n'a pas pu être absorbé tout seul : quelqu'un doit trancher avant le prochain lancement."
          : 'Aucun mail client ne part tant que le décalage n\'est pas validé côté staff.',
      ].join('\n'),
      preheader: needsDecision
        ? `À trancher avant le prochain lancement : ${who}, ${howLate}. ${nextAction}`
        : `Pour info, rien à trancher : ${who}, ${howLate}. ${nextAction}`,
      details: [
        { label: 'Client', value: reservation.name },
        { label: 'Créneau', value: `${formatDateFr(reservation.date)} à ${reservation.startTime}` },
        { label: 'Retard', value: delayMinutes ? `${delayMinutes} minutes` : 'à évaluer' },
        { label: 'Participants', value: `${reservation.pax}` },
        { label: 'Offre', value: offer },
      ],
      action: {
        href: `${publicAppUrl()}/direction.html`,
        label: needsDecision ? 'Trancher dans le cockpit' : 'Voir le planning du jour',
      },
      replyLine: '',
      note: '',
    };
  }

  // ── Famille CLIENT ───────────────────────────────────────────────────────
  // Vouvoiement (c'est le parent qui reserve), energique et complice, concret.
  // Interdits de marque : promesse floue, superlatif vide, garantie de
  // disponibilite, ton administratif. Le centre encaisse SUR PLACE : aucun
  // acompte, aucun paiement en ligne, jamais.
  const longDate = formatDateLongFr(reservation.date);

  if (templateId === 'delay_update') {
    const previousStartTime = delayUpdate?.previousStartTime || delayUpdate?.oldStartTime || reservation.previousStartTime || '';
    const proposedStartTime = delayUpdate?.proposedStartTime || delayUpdate?.newStartTime || reservation.startTime || '';
    const delayMinutes = Number(delayUpdate?.delayMinutes || 0);
    const reasonLabel = delayUpdate?.reason || 'retard signalé';
    return {
      subject: proposedStartTime
        ? `Votre horaire de ${longDate} passe à ${proposedStartTime}`
        : `Ajustement de votre horaire de ${longDate}`,
      title: 'Un décalage sur votre horaire',
      eyebrow: 'Changement d\'horaire',
      body: [
        `Bonjour ${clientName},`,
        '',
        // Meme raison qu'a la confirmation : `offer` vaut "votre formule" en
        // repli, ce qui donnait "Votre réservation votre formule du ...".
        `Votre réservation du ${longDate} reste confirmée. L'équipe de ${center.name} vous prévient d'un décalage${delayMinutes ? ` de ${delayMinutes} minutes` : ''}.`,
        previousStartTime && proposedStartTime
          ? `Vous étiez attendu à ${previousStartTime}, ce sera finalement ${proposedStartTime}.`
          : proposedStartTime ? `Le nouvel horaire retenu est ${proposedStartTime}.` : '',
        `La raison, ${reasonLabel}.`,
        '',
        // LE MONTANT SE DIT QUAND LA RESERVATION BOUGE (Movsar, 2026-09-18). Un
        // client dont l horaire change se demande ce qu il va payer ; le
        // silence se lit comme une mauvaise nouvelle. Ici rien ne change : les
        // activites et l effectif sont les memes, seule l heure bouge.
        "Le montant estimé ne change pas, seul l'horaire bouge. Le reste de votre programme est inchangé.",
        "L'équipe préfère vous prévenir maintenant plutôt que vous faire patienter sur place.",
        "Si ce nouvel horaire ne vous arrange pas, répondez à ce message ou appelez le centre, l'équipe cherchera autre chose avec vous.",
      ].filter(Boolean).join('\n'),
      preheader: proposedStartTime
        ? `Vous êtes maintenant attendu à ${proposedStartTime}. Le reste de votre programme ne change pas.`
        : 'Votre réservation reste confirmée, seul l\'horaire bouge un peu.',
      details: [
        { label: 'Centre', value: center.name },
        { label: 'Date', value: longDate },
        { label: 'Ancien horaire', value: previousStartTime || 'Non précisé' },
        { label: 'Nouvel horaire', value: proposedStartTime || reservation.startTime || 'À confirmer' },
        { label: 'Participants', value: `${reservation.pax}` },
        { label: 'Offre', value: offer },
      ],
      note: "Ce décalage a été validé par l'équipe avant envoi. Le montant se règle sur place, comme prévu.",
    };
  }

  if (templateId === 'reminder_48h') {
    const isFormula = reservation.type === 'formule';
    // UNE SEULE source de verite pour l'heure d'arrivee : `arrivalLead`, issu de
    // opsPlan.arrivalMinutes (le plan Ops, qui fixe FORMULA_ARRIVAL_MINUTES).
    // Un `15` code en dur ici faisait dire 10 minutes a la confirmation et 15 au
    // rappel POUR LA MEME RESERVATION, jusque dans le preheader.
    const lead = arrivalLead;
    return {
      subject: `Votre venue du ${longDate} approche`,
      title: `Votre venue du ${longDate}`,
      eyebrow: 'Rappel',
      body: [
        `Bonjour ${clientName},`,
        '',
        `Votre créneau du ${longDate} à ${reservation.startTime} chez ${center.name} est retenu à votre nom.`,
        // LE PROGRAMME SE REPETE LA VEILLE. La confirmation le donne heure par
        // heure ; ce rappel, lui, ne donnait que l heure d arrivee. Le client
        // relit son DERNIER mail la veille et croit que tout s enchaine des
        // 15:00 : il arrive a 14:50 et repart avant son laser.
        ...programme,
        isFormula
          ? `Un seul service à rendre à l'équipe, arriver avec tout le groupe ${lead > 0 ? `${lead} minutes avant` : `à ${reservation.startTime}`}. C'est ce qui permet de lancer tout le monde ensemble, surtout avec du Laser Game dans la formule.`
          : lead > 0 ? `Arrivez ${lead} minutes avant l'heure prévue, l'équipe vous installe tranquillement.` : `Arrivez à l'heure prévue, l'équipe vous installe tranquillement.`,
        laserSentence,
        '',
        `L'équipe de ${center.name} vous attend.`,
      ].filter(Boolean).join('\n'),
      preheader: `${longDate} à ${reservation.startTime}, ${center.name}.${lead > 0 ? ` Arrivez ${lead} minutes avant.` : ''}`,
      details: [
        { label: 'Date', value: longDate },
        { label: 'Heure', value: reservation.startTime },
        { label: 'Participants', value: `${reservation.pax}` },
        { label: 'Offre', value: offer },
      ],
      note: isFormula
        ? "Un imprévu ou un retard ? Un appel au centre plutôt qu'une course, l'ordre des activités se réorganise et vous ne perdez rien."
        : "Un imprévu ou un retard ? Un appel au centre suffit, l'équipe ajuste avec vous.",
    };
  }

  if (templateId === 'request_received') {
    return {
      subject: `Votre demande pour ${longDate} est bien arrivée`,
      title: 'Votre demande est bien arrivée',
      eyebrow: 'Demande reçue',
      body: [
        `Bonjour ${clientName},`,
        '',
        `Votre demande pour ${offer} est enregistrée et transmise à l'équipe de ${center.name}.`,
        "Avant toute confirmation, l'équipe cale l'enchaînement des activités pour votre groupe. C'est ce qui sépare une visite fluide d'une visite passée à attendre, et cela demande un peu de temps.",
        // LE DELAI FERME, mot pour mot (Movsar, 2026-09-18). « On revient vers
        // vous » n est pas un delai : le client ne sait pas s il doit attendre
        // une heure ou trois jours, et il rappelle.
        `Une réponse précise sur la validité de ce créneau sera donnée sous ${DELAI_REPONSE}.`,
        '',
        arrivalTime
          ? (arrivalLead > 0 ? `Notez déjà une arrivée ${arrivalLead} minutes avant ${arrivalTime}.` : `Notez déjà une arrivée à ${arrivalTime}.`)
          : arrivalLead > 0 ? `L'heure exacte suivra, avec ${arrivalLead} minutes d'avance à prévoir.` : "L'heure exacte suivra.",
      ].filter(Boolean).join('\n'),
      preheader: `${offer}, ${reservation.pax} personnes, ${longDate}. Réponse précise sous ${DELAI_REPONSE}.`,
      details: [
        { label: 'Centre', value: center.name },
        { label: 'Date', value: longDate },
        { label: 'Heure souhaitée', value: reservation.startTime },
        { label: 'Participants', value: `${reservation.pax}` },
        { label: 'Offre', value: offer },
      ],
      note: "Ce message accuse réception de la demande, ce n'est pas une confirmation. Un second message suivra dès que le créneau sera retenu.",
    };
  }

  return {
    subject: `Votre réservation du ${longDate} est confirmée`,
    title: `Rendez-vous ${longDate}`,
    eyebrow: 'Réservation confirmée',
    body: [
      `Bonjour ${clientName},`,
      '',
      // Accord invariable volontaire : `offer` peut etre masculin (bowling,
      // Laser Game) ou feminin (FORMULE 4), et vaut meme "votre formule" en
      // repli (ligne 591). Toute tournure qui accorde sur `offer` produit
      // "votre bowling est confirmée". L'offre est de toute facon rappelee
      // dans la carte de details ({ label: 'Offre' }), donc on ne la repete pas.
      `Votre réservation est confirmée chez ${center.name}, à votre nom.`,
      arrivalTime
        ? (arrivalLead > 0 ? `Rendez-vous à ${arrivalTime}. Merci d'arriver ${arrivalLead} minutes plus tôt, le temps de vous accueillir et de lancer tout le groupe ensemble.` : `Rendez-vous à ${arrivalTime} : l'équipe vous accueille et lance tout le groupe ensemble.`)
        : arrivalLead > 0 ? `Merci d'arriver ${arrivalLead} minutes avant l'heure prévue, le temps de vous accueillir et de lancer tout le groupe ensemble.` : "Merci d'arriver à l'heure prévue : l'équipe vous accueille et lance tout le groupe ensemble.",
      opsPlanSentence,
      ...programme,
      laserSentence,
      '',
      "Le montant se règle sur place le jour même, aucun paiement n'est demandé à l'avance.",
      `L'équipe de ${center.name} vous attend.`,
    ].filter(Boolean).join('\n'),
    preheader: `${offer}, ${reservation.pax} personnes, ${longDate} à ${reservation.startTime}. Le paiement se fait sur place.`,
    details: [
      { label: 'Centre', value: center.name },
      { label: 'Date', value: longDate },
      { label: 'Heure', value: reservation.startTime },
      { label: 'Participants', value: `${reservation.pax}` },
      { label: 'Offre', value: offer },
      // « Montant estimé » et pas « À régler sur place » : la VALEUR est un
      // calcul (getBasePrice, per_pax x pax) fait avant la venue. Le jour J, le
      // nombre reel de joueurs, les boissons et les extras la font bouger.
      // Annoncer ce chiffre comme un montant ferme, c'est promettre un ticket
      // que la caisse ne tiendra pas. Le fait « rien a payer d'avance » est deja
      // dit dans le corps : le libelle n'a pas a le repeter au prix d'un
      // engagement faux.
      { label: 'Montant estimé', value: reservation.price !== undefined ? formatEuro(reservation.price) || 'Sur place' : 'Sur place' },
    ],
    // Les heures sont dans le programme : la note dit ce qui en decoule, sans
    // nommer une activite que la formule n a pas, ni un « rythme » qu elle n a
    // pas.
    note: reservation.type === 'formule' && programme.length
      ? `Les heures du programme sont tenues pour votre groupe${programme.some((l) => /à votre rythme/.test(l)) ? ', le reste se vit à votre rythme' : ''}. Un retard ? Un appel au centre suffit, l'équipe s'adapte.`
      : reservation.type === 'formule'
        ? "Le programme de la formule se vit à votre rythme sur place. Un retard ? Un appel au centre suffit, l'équipe s'adapte."
      // La queue « <date>, on note. » ne voulait rien dire et recollait une date
      // NUMERIQUE dans un mail ou la date est deja ecrite en toutes lettres.
      : "Un empêchement ou un retard ? Un message ou un appel au centre suffit, l'équipe s'adapte.",
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
  // Coordonnees reelles du centre pour le pied de page (nom, ville, telephone).
  // Un centre inconnu renvoie null : le gabarit n'affiche alors AUCUN nom ni
  // numero, plutot qu'une identite ou une coordonnee inventee.
  let messageCenter = null;
  try {
    messageCenter = getCenter(centerId);
  } catch (error) {
    messageCenter = null;
  }
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
  const deps = options.deps || defaultDeps();
  const automation = await getAutomationSettings(centerId, deps);
  // L'IDENTITE D'EXPEDITEUR DU CENTRE, sur les emails DECLENCHES PAR UNE
  // RESERVATION. Le correctif du 2026-08-08 ne l'avait branchee que sur les
  // sequences marketing (anniversaire, reactivation, sequences personnalisees) :
  // l'accuse de reception, la confirmation et le rappel J-2 repartaient sur
  // l'adresse de la plateforme, alors que ce sont les mails que le client final
  // voit le plus. Repli inchange et honnete : sans identite configuree,
  // resolveCenterSenderIdentity rend {} et sendEmail retombe sur l'adresse
  // plateforme au NOM du centre. Aucune adresse n'est inventee.
  const sender = await resolveCenterSenderIdentity(centerId, deps);
  // Le design du centre, resolu UNE fois par enfilement. Les mails CLIENT
  // signent de l equipe si le gerant l a voulu pour les sequences ; le mail
  // STAFF garde le gabarit mais ne se signe pas : on n ecrit pas « À très
  // bientôt » a sa propre equipe.
  const design = await resolveEmailDesign(centerId, deps);
  const habillageClient = habillageDe(design, 'sequences');
  // Le mail d EQUIPE garde la couleur du centre mais toujours le gabarit en
  // carte, avec ses marges : le « Mail simple » (sans marge, fait pour imiter
  // un mail ecrit a la main) collait le tableau et le bouton au bord.
  const habillageStaff = design ? { design: { ...design, preset: design.preset === 'simple' ? 'classique' : design.preset }, signature: { enabled: false, person: null } } : null;

  if (email) {
    const templateId = validationMode === 'staff_review' ? 'request_received' : 'confirmation';
    // Le gerant peut couper cette sequence depuis la page Emails. Le garde vit
    // ICI (enfilement) et jamais au dispatch : une sequence coupee empeche les
    // envois FUTURS, elle n'annule pas un mail deja promis a un client.
    // `!== false` et non `=== true` : une cle absente du jsonb vaut ON, donc le
    // jour du deploiement rien ne se coupe tout seul en prod.
    if (wantsTemplate(templateId) && automation[templateId]?.enabled !== false) {
      const message = buildMessage({
        reservation,
        templateId,
        channel: 'email',
        overrides: automation[templateId] || null,
      });
      created.push(enqueue({
        centerId,
        reservationId,
        channel: 'email',
        templateId,
        recipient: email,
        subject: message.subject,
        body: shellFromMessage(message, messageCenter, habillageClient),
        status: 'queued',
        scheduledAt: addMinutes(new Date(), templateId === 'confirmation' ? confirmationDelayMinutes : receivedDelayMinutes).toISOString(),
        idempotencyKey: `reservation:${reservationKey}:${templateId}:email`,
        payload: { textBody: message.body, validationMode, ...sender },
      }));
    }

    const reminderOffsetDays = Number.isInteger(automation.reminder_48h?.offsetDays)
      ? automation.reminder_48h.offsetDays
      : 2;
    const reminderDate = addDaysToDateStr(reservation.date, -reminderOffsetDays);
    const reminderAt = zonedTimeToUtc(reminderDate, '10:00').toISOString();
    // LE RAPPEL NE PROMET QUE CE QUI EST VRAI (2026-08-31). Il dit "tout est
    // deja bloque a votre nom" : il ne peut pas partir sur un dossier que
    // personne n a valide. request_received, confirmation et
    // staff_review_request testaient tous validationMode ; celui-ci, non. Si
    // personne ne traitait le dossier avant J-2, le client recevait la
    // promesse, se presentait, et rien n etait reserve.
    // Quand le staff valide, refreshReservationAutomation regenere les
    // communications (validationStatus fait partie de AUTOMATION_REFRESH_FIELDS)
    // : le rappel est alors cree, avec la bonne date.
    if (validationMode !== 'staff_review' && wantsTemplate('reminder_48h') && automation.reminder_48h?.enabled !== false && isFuture(reminderAt, 5)) {
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
        body: shellFromMessage(reminder, messageCenter, habillageClient),
        status: 'queued',
        scheduledAt: reminderAt,
        idempotencyKey: `reservation:${reservationKey}:reminder_48h:email`,
        payload: { textBody: reminder.body, ...sender },
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

  // Saisie AU COMPTOIR : la personne qui l a tapee EST l equipe, elle voit la
  // validation a l ecran. Lui ecrire serait le mail inutile par excellence.
  if (staffEmail && validationMode === 'staff_review' && reservation.channel !== 'staff' && wantsTemplate('staff_review_request')
    && !(await boiteStaffDUnAutreClient(centerId, staffEmail, deps))) {
    const message = buildMessage({ reservation, templateId: 'staff_review_request', channel: 'email' });
    created.push(enqueue({
      centerId,
      reservationId,
      channel: 'email',
      templateId: 'staff_review_request',
      recipient: staffEmail,
      subject: message.subject,
      body: shellFromMessage(message, messageCenter, habillageStaff),
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
// décalage d'horaire, changement de piste, ou les deux. Ton du centre.
function buildDelayChangeMessage({ reservation, change, channel = 'email' }) {
  const center = getCenter(reservation.centerId || 'libramont');
  const clientName = reservation.name || 'Bonjour';
  const offer = reservation.label || (reservation.type === 'formule' ? 'votre formule' : reservation.type === 'laser' ? 'Laser Game' : 'bowling');
  const longDate = formatDateLongFr(reservation.date);
  const laneChangeSentence = change.laneChanged && change.newLanes?.length
    ? `Vous jouerez sur la piste ${change.newLanes.join(', ')} au lieu de la piste ${(change.previousLanes || []).join(', ') || 'prévue'}. Rien d'autre ne change, c'est simplement l'autre bout du bowling.`
    : '';
  const shiftSentence = Number(change.shiftMinutes || 0) > 0
    ? `Vous étiez attendu à ${change.previousStartTime}, ce sera finalement ${change.newStartTime}, soit ${change.shiftMinutes} minutes plus tard.`
    : (change.moves || []).length
      ? `Le programme bouge un peu : ${change.moves.map((move) => `${move.label} passe de ${move.previousStartTime} à ${move.newStartTime}`).join(' · ')}.`
      : '';

  if (channel === 'sms') {
    return {
      subject: '',
      body: `${center.name}: ajustement pour ${reservation.name}. ${shiftSentence || laneChangeSentence} Votre réservation reste confirmée. En cas de souci, contactez le centre.`,
    };
  }

  // OBJET : `delay_update` porte deja « Votre horaire de <date> passe a <h> ».
  // Deux mails differents avec le meme objet sont indistinguables en boite, et
  // le second passe pour un doublon. Celui-ci dit donc CE QUI change vraiment
  // (horaire, piste, ou les deux), pas seulement qu'il y a un changement.
  const shifted = Number(change.shiftMinutes || 0) > 0;
  const laneChanged = Boolean(change.laneChanged && change.newLanes?.length);
  const subject = shifted && laneChanged
    ? `Nouvel horaire et nouvelle piste pour ${longDate}`
    : laneChanged
      ? `Votre piste change pour ${longDate}`
      : shifted
        ? `Votre venue du ${longDate} passe à ${change.newStartTime}`
        : `Une adaptation pour votre venue du ${longDate}`;

  return {
    subject,
    title: 'Un ajustement sur votre venue',
    eyebrow: 'Mise à jour du planning',
    body: [
      `Bonjour ${clientName},`,
      '',
      `Votre réservation ${offer} du ${longDate} chez ${center.name} reste confirmée. L'équipe vous prévient d'un ajustement de planning.`,
      shiftSentence,
      laneChangeSentence,
      '',
      // Le montant, pour la meme raison qu'au decalage d horaire : ni les
      // activites ni l effectif ne changent, donc il est inchange, et le dire
      // vaut mieux que laisser le client le supposer.
      "Le montant estimé ne change pas, seule l'organisation bouge. Le reste de votre programme est inchangé.",
      "L'équipe préfère vous prévenir maintenant plutôt que vous laisser le découvrir sur place.",
      "Si cela ne vous arrange pas, répondez à ce message ou appelez le centre.",
    ].filter(Boolean).join('\n'),
    preheader: change.newStartTime
      ? `Votre réservation reste confirmée${Number(change.shiftMinutes || 0) > 0 ? `, nouvel horaire ${change.newStartTime}` : ''}. Le reste ne change pas.`
      : 'Votre réservation reste confirmée, on ajuste juste un détail du planning.',
    details: [
      { label: 'Centre', value: center.name },
      { label: 'Date', value: longDate },
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
    note: "Cet ajustement a été validé par l'équipe avant envoi. Le montant se règle sur place, comme prévu.",
  };
}

// Met en file la notification retard d'UN client, pour les canaux demandés.
// N'est JAMAIS appelée automatiquement : uniquement depuis l'action staff
// explicite « Envoyer les emails » de l'étape notification.
async function enqueueDelayChangeCommunications({ reservation, change, incidentId, channels = ['email'], override = null }) {
  const created = [];
  const centerId = reservation.centerId || 'libramont';
  let delayCenter = null;
  try {
    delayCenter = getCenter(centerId);
  } catch (error) {
    delayCenter = null;
  }
  const reservationId = reservation.id ? Number(reservation.id) : null;
  // `override` = texte relu/modifié par le staff à l'étape notification. Quand
  // il est fourni, il fait AUTORITÉ sur le corps (le staff a validé ce texte) ;
  // sinon on retombe sur le template généré. Le serveur reste la source de
  // vérité de l'envoi et de la trace : le front ne fait que composer.
  const overrideBody = override && typeof override.body === 'string' && override.body.trim()
    ? override.body
    : '';
  const overrideSubject = override && typeof override.subject === 'string' && override.subject.trim()
    ? override.subject
    : '';
  // Une notification de retard est un mail de service : elle signe comme les
  // sequences, avec le design du centre.
  const habillageRetard = habillageDe(await resolveEmailDesign(centerId), 'sequences');

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
        ? (overrideBody
          // Texte relu et modifie par le staff : il fait autorite sur le corps,
          // mais il herite quand meme du gabarit (logotype, pied de page).
          ? emailShell({
            title: finalSubject, body: finalBody, preheader: message.preheader, center: delayCenter,
            design: habillageRetard ? habillageRetard.design : null, signature: habillageRetard ? habillageRetard.signature : null,
          })
          : shellFromMessage(message, delayCenter, habillageRetard))
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

// Adresse de réponse réelle du centre. Ordre : l'identité d'expéditeur choisie
// pour CE message, sinon l'adresse de réponse configurée, sinon la boîte de
// validation staff (celle que l'équipe relève déjà). Aucune adresse inventée :
// sans configuration, on n'envoie pas d'en-tête plutôt que d'en poser un qui
// rebondit, ce qui serait pire que l'absence pour la réputation du domaine.
// L ADRESSE PUBLIQUE DU CENTRE : celle que le client lit deja sur le site et
// dans le mail. C est la seule qui rend vraie la promesse du pied de page
// (« repondez simplement a ce message, il arrive directement chez nous ») :
// l expediteur, lui, est une adresse d ENVOI (RESEND_FROM ou l identite du
// studio mails), et rien ne garantit qu une boite la releve. Un centre ne dans
// la console n en declare pas : on retombe alors sur les replis d avant.
// LA BOITE STAFF GLOBALE NE RECOIT QUE LES CENTRES DONT ELLE PEUT ETRE
// (2026-09-16). STAFF_REVIEW_EMAIL sert tous les centres : posee sur l adresse
// d un client, les demandes de validation des AUTRES clients (nom, telephone,
// detail de la reservation) y partaient. Elle est refusee aux centres dont le
// client ne tient pas son domaine ; une adresse qu aucun client ne tient
// (plateforme, boite personnelle) continue de tout recevoir. Base illisible :
// on n envoie pas, plutot que de risquer la boite d un autre client.
async function boiteStaffDUnAutreClient(centerId, adresse, deps) {
  try {
    const declarations = await chargerDeclarations((text, params) => deps.query(text, params));
    return adresseDUnAutreClient(centerId, adresse, declarations);
  } catch (error) {
    console.warn(`ops-communications: proprietaire de la boite staff illisible, notification de validation non envoyee (${String((error && error.message) || error).slice(0, 120)})`);
    return true;
  }
}

function adresseDuCentre(centerId) {
  // SANS CENTRE, AUCUNE ADRESSE (2026-09-16). centerOrNull retombe sur
  // libramont : un mail parti sans centre (l accuse de demande sur mesure)
  // renvoyait les reponses de TOUS les clients dans la boite de Fun Galaxy.
  if (!String(centerId || '').trim()) return '';
  const centre = centerOrNull(centerId);
  return String((centre && centre.publicInfo && centre.publicInfo.email) || '').trim();
}

// L ADRESSE VERS LAQUELLE LES REPONSES REVIENNENT, par centre (CENTER_REPLY_TO,
// une carte JSON `{ "<centre>": "<adresse>" }`).
//
// Elle existe pour une raison precise : faire revenir la conversation DANS
// Pinlane. L adresse publique d un centre arrive dans SA boite, pas ici ; le
// staff repond alors depuis l outil et ne voit jamais la suite. Pointer la
// reponse sur l adresse de RECEPTION du centre ferme la boucle : question,
// reponse, question, au meme endroit.
//
// Laissee vide, rien ne change : la reponse va dans la boite du centre, et
// c est la regle de copie de son hebergeur qui la fait aussi arriver ici. Les
// deux mondes sont donc possibles, et c est le REGLAGE qui tranche, jamais le
// code. Un reglage illisible ou une adresse mal formee ne cassent aucun envoi.
function adresseDeRetourDuCentre(centerId) {
  const brut = String(process.env.CENTER_REPLY_TO || '').trim();
  const centre = String(centerId || '').trim();
  if (!brut || !centre) return '';
  let carte = null;
  try {
    carte = JSON.parse(brut);
  } catch (error) {
    // Le contenu n est jamais recopie : il porte des adresses de clients.
    return '';
  }
  if (!carte || typeof carte !== 'object' || Array.isArray(carte)) return '';
  const adresse = String(carte[centre] || '').trim();
  // Une adresse de reception ne vaut que pour le centre qu elle nomme : posee
  // sur un autre, ses clients ecriraient dans la boite du premier.
  return adresseDeReceptionDUnAutreCentre(centre, adresse) ? '' : adresse;
}

function replyToAddress(communication) {
  const candidates = [
    communication.payload?.replyTo,
    // Le retour declare AVANT l adresse publique : c est lui qui ramene la
    // conversation dans l outil quand un centre y a une adresse de reception.
    adresseDeRetourDuCentre(communication.centerId),
    // Le centre AVANT tout reglage de plateforme : une variable globale
    // enverrait les reponses de tous les clients au meme endroit.
    adresseDuCentre(communication.centerId),
    // Les variables d environnement valent pour TOUS les clients : seule une
    // adresse de la plateforme y est lue (lib/sender-domains.js).
    adresseDePlateforme(process.env.RESEND_REPLY_TO),
    communication.payload?.fromEmail,
    adresseDePlateforme(process.env.STAFF_REVIEW_EMAIL),
    adresseDePlateforme(process.env.RESERVATION_STAFF_EMAIL),
  ];
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return value;
  }
  return '';
}

// RFC 2606 : .test, .invalid, .example et .localhost sont RESERVES - aucune
// boite ne peut exister derriere. Leur envoyer un mail ne produit qu'un bounce
// dur, et un taux de bounces eleve degrade la reputation du domaine expediteur
// pour les VRAIS clients. Garde permanente (elle protege aussi de toute adresse
// de test saisie au comptoir), et c'est ce qui rend le jeu de demonstration
// (adresses en @demo.fungalaxy.test) sans effet sur la delivrabilite.
const UNROUTABLE_EMAIL = /@[^@]*\.(test|invalid|example|localhost)$/i;

async function sendEmail(communication) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { skipped: true, reason: 'RESEND_API_KEY manquant.' };
  if (UNROUTABLE_EMAIL.test(String(communication.recipient || ''))) {
    return { skipped: true, unroutable: true, reason: 'Adresse de test non routable (RFC 2606) : rien envoyé.' };
  }

  // Identité d'expéditeur par communication (studio mails). L'adresse doit
  // être vérifiée côté Resend ; tant qu'aucune identité n'est configurée,
  // fallback sur l'expéditeur plateforme.
  const payloadFrom = String(communication.payload?.fromEmail || '').trim();
  const payloadLabel = String(communication.payload?.fromLabel || '').trim();
  // RESEND_FROM vaut pour tous les clients : son ADRESSE seule, et seulement si
  // c est une adresse de la plateforme (lib/sender-domains.js). Un nom affiche
  // dans la variable (« Fun Galaxy <...> ») signait les mails des autres.
  const configuredFrom = payloadFrom || adresseDePlateforme(process.env.RESEND_FROM) || 'onboarding@resend.dev';
  // Le NOM affiche : l'identite choisie pour ce message, sinon le nom du CENTRE
  // qui envoie. 'Fun Galaxy' etait ecrit en dur ici : le client d'un deuxieme
  // centre recevait un mail signe du nom du premier. Et sans centre, aucun nom
  // de centre : centerOrNull retombe sur libramont.
  const centerLabel = (communication.centerId ? centerOrNull(communication.centerId)?.name : '') || 'Pinlane';
  const from = configuredFrom.includes('<')
    ? configuredFrom
    : `${payloadLabel || centerLabel} <${configuredFrom}>`;
  // LES EN-TETES DU MESSAGE. List-Unsubscribe sur le marketing seulement (voir
  // plus bas). In-Reply-To et References sur une REPONSE a un mail recu
  // (2026-09-16) : c est ce qui range notre reponse dans la conversation du
  // client, chez lui, et ce qui permet a sa prochaine reponse de retrouver
  // notre fil ici (lib/email-threads.js).
  const entetes = {};
  const inReplyTo = String(communication.payload?.inReplyTo || '').trim();
  const references = String(communication.payload?.references || '').trim();
  if (inReplyTo) entetes['In-Reply-To'] = inReplyTo;
  if (references) entetes.References = references;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(communication.idempotencyKey ? { 'Idempotency-Key': communication.idempotencyKey } : {}),
    },
    // DÉLIVRABILITÉ (le sujet prime sur tout ajout de fonctionnalité) :
    // `text` = l'alternative texte. Un mail HTML sans version texte est un
    // signal de spam classique, et c'est le seul levier gratuit ici : zéro
    // lien, zéro image, zéro octet visible pour le lecteur. `payload.textBody`
    // est déjà posé sur la quasi-totalité des envois.
    // `reply_to` = le pied de page promet « répondez simplement à ce message,
    // il arrive directement chez nous ». Sans cet en-tête, les réponses
    // partaient vers l'adresse d'envoi Resend : promesse fausse, et un domaine
    // qui ne reçoit jamais de réponse est un mauvais signal de réputation.
    // En-tête List-Unsubscribe : posé UNIQUEMENT quand la communication porte un
    // unsubToken, c'est-à-dire sur les mails MARKETING (campagne, anniversaire
    // J-30, réactivation, séquences personnalisées). Les transactionnels n'ont
    // jamais de unsubToken : ils ne reçoivent donc jamais cet en-tête, et un
    // lien de désinscription sur une confirmation la pousserait vers Promotions.
    // Le bouton natif « Se désabonner » de Gmail/Outlook est le meilleur signal
    // anti-plainte gratuit : List-Unsubscribe-Post (RFC 8058) l'active en
    // one-click (POST /api/u, cf. api/u.js).
    body: JSON.stringify({
      from,
      to: communication.recipient,
      subject: communication.subject,
      html: communication.body,
      ...(String(communication.payload?.textBody || '').trim()
        ? { text: String(communication.payload.textBody) }
        : {}),
      ...(replyToAddress(communication) ? { reply_to: replyToAddress(communication) } : {}),
      ...(String(communication.payload?.unsubToken || '').trim()
        ? {
          headers: {
            ...entetes,
            'List-Unsubscribe': `<${unsubscribeUrl(communication.payload.unsubToken)}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }
        : (Object.keys(entetes).length ? { headers: entetes } : {})),
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Narrow documented rejection only; an arbitrary 4xx is not evidence that
    // nothing was accepted (409 can refer to an earlier/in-flight request).
    // https://resend.com/docs/api-reference/errors
    const providerNotAccepted = response.status === 400 && payload?.name === 'validation_error'
      && (payload.statusCode === undefined || payload.statusCode === 400) && !payload.id;
    throw Object.assign(new Error(payload?.message || payload?.error || `Resend ${response.status}`), { providerNotAccepted });
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

function canReleaseDispatchCommitment(communication) {
  const attempts = Number(communication.attempts || 0);
  // Inspect the CLAIM snapshot, before committing this attempt. A previous
  // commitment includes crashes/timeouts even if no attempt was finalized.
  // Historical attempts without proof are deliberately not considered safe.
  return !communication.payload?.dispatchCommittedAt && (attempts === 0
    || communication.payload?.dispatchNotSentThroughAttempt === attempts);
}

async function dispatchCommunication(communication) {
  const ownership = { dispatchOwner: communication.payload?.dispatchOwner };
  const canReleaseCommitment = canReleaseDispatchCommitment(communication);
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
      ...ownership,
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
      ...ownership,
      status: 'failed',
      incrementAttempts: 1,
      lastError: 'Destinataire manquant.',
    });
  }

  const engaged = await updateCommunicationStatus(communication.id, { ...ownership, status: 'processing', engage: true });
  if (!engaged || engaged.status !== 'processing') {
    return { ...(engaged || communication), status: engaged?.status || 'processing', skipped: true,
      skipReason: engaged?.lastError || 'Envoi non engage : annulation ou prise en charge remplacee.' };
  }
  communication = engaged;
  const sendResult = communication.channel === 'sms'
    ? await sendSms(communication)
    : await sendEmail(communication);

  if (sendResult.skipped) {
    // UNE ADRESSE RESERVEE (RFC 2606) NE REVIENT JAMAIS EN FILE (2026-09-05).
    // Elle restait « queued » avec un nouveau nextRetryAt : 159 lignes du jeu
    // de demonstration (@demo.fungalaxy.test) ont ainsi rempli chaque fournee
    // du cron (50 lignes) pendant cinq semaines, et les confirmations des
    // vrais clients n atteignaient jamais leur tour. Le motif est structurel
    // (aucune boite n existe derriere), donc la ligne est annulee, pas rejouee.
    if (sendResult.unroutable) {
      // A local skip proves nothing about an earlier committed attempt.
      const updated = await updateCommunicationStatus(communication.id, {
        ...ownership,
        notSent: canReleaseCommitment,
        status: canReleaseCommitment ? 'cancelled' : 'queued',
        incrementAttempts: 0,
        lastError: sendResult.reason,
        nextRetryAt: canReleaseCommitment ? null : retryDateForAttempt(Number(communication.attempts || 0) + 1),
      });
      return {
        ...updated,
        skipped: true,
        skipReason: sendResult.reason,
      };
    }
    const queued = await updateCommunicationStatus(communication.id, {
      ...ownership,
      notSent: canReleaseCommitment,
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

  const sent = await updateCommunicationStatus(communication.id, {
    ...ownership,
    status: 'sent',
    incrementAttempts: 1,
    providerMessageId: sendResult.providerMessageId,
    lastError: '',
    nextRetryAt: null,
  });
  if (sent?.status === 'sent' && sent.payload?.replyToCommunicationId) {
    await linkReplyToInbound({
      centerId: sent.centerId,
      recipient: sent.recipient,
      replyToCommunicationId: sent.payload.replyToCommunicationId,
      replyCommunicationId: sent.id,
      sentSubject: sent.subject,
      sentBody: sent.payload.textBody,
      sentAt: sent.sentAt,
    }).catch(() => null);
  }
  return sent || { ...communication, skipped: true, skipReason: 'Finalisation refusee : prise en charge remplacee.' };
}

function retryDateForAttempt(attempt) {
  const minutes = Math.min(120, Math.max(2, Number(attempt || 1) * 5));
  return addMinutes(new Date(), minutes).toISOString();
}

async function dispatchDueCommunications({ limit = 25, centerId = '', reservationId = null, communicationId = null } = {}) {
  const due = await listDueCommunications({ limit, centerId, reservationId, communicationId });
  const results = [];

  for (const communication of due) {
    try {
      const sent = await dispatchCommunication(communication);
      results.push({ id: communication.id, status: sent?.status || 'processing', skipped: Boolean(sent?.skipped), reason: sent?.skipReason || '' });
    } catch (error) {
      const nextAttempts = Number(communication.attempts || 0) + 1;
      const failed = nextAttempts >= Number(communication.maxAttempts || 3);
      const updated = await updateCommunicationStatus(communication.id, {
        dispatchOwner: communication.payload?.dispatchOwner,
        notSent: error.providerNotAccepted === true && canReleaseDispatchCommitment(communication),
        status: failed ? 'failed' : 'queued',
        incrementAttempts: 1,
        lastError: error.message || 'Erreur envoi.',
        nextRetryAt: failed ? null : retryDateForAttempt(nextAttempts),
      });
      results.push({ id: communication.id, status: updated?.status || 'processing', error: updated?.lastError || error.message });
    }
  }

  const failed = results.filter((item) => item.status === 'failed').length;
  const retried = results.filter((item) => item.status === 'queued' && !item.skipped).length;
  return {
    ok: failed === 0 && retried === 0 && !results.some((item) => item.error),
    checked: due.length,
    failed,
    retried,
    results,
  };
}

function buildEmailSamples() {
  // Meme reservation de demonstration que l'apercu des sequences
  // (PREVIEW_RESERVATION) : un seul jeu de donnees fictif dans tout le depot,
  // donc un seul rendu de reference a juger.
  const baseReservation = PREVIEW_RESERVATION;

  // Les 5 templates historiques passent par buildMessage (chemin de prod exact).
  // Les templates a texte libre (studio, campagne, reponse a un entrant) et les
  // alertes staff sont ajoutes ensuite : ce sont les MEMES fonctions de rendu,
  // avec des donnees representatives, pour que le rendu se juge sur pieces.
  const templateIds = [
    'request_received',
    'confirmation',
    'reminder_48h',
    'staff_review_request',
    'delay_update',
    'staff_alert',
    'delay_staff_attention',
  ];
  let sampleCenter = null;
  try {
    sampleCenter = getCenter(baseReservation.centerId);
  } catch (error) {
    sampleCenter = null;
  }

  return templateIds.map((templateId) => {
    const channel = 'email';
    const message = buildMessage({
      reservation: {
        ...baseReservation,
        startTime: templateId === 'delay_update' ? '15:10' : baseReservation.startTime,
        delayUpdate: {
          previousStartTime: '15:00',
          proposedStartTime: '15:10',
          delayMinutes: 10,
          reason: 'une partie de laser qui a débordé sur le créneau précédent',
          nextAction: 'Prévenir le groupe de 17:00 et décaler le lancement bowling de 10 minutes.',
        },
      },
      templateId,
      channel,
    });
    return {
      templateId,
      subject: message.subject,
      preheader: message.preheader || '',
      html: shellFromMessage(message, sampleCenter),
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

// « samedi 20 juin » : une date ecrite en toutes lettres se lit sans effort et
// donne au mail son registre. « 2026-06-20 » dans un mail client fait export
// de base de donnees. Sans jour valide, on retombe sur le format court plutot
// que d'afficher une date fausse.
const FR_WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const FR_MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function formatDateLongFr(dateStr = '', { withYear = false } = {}) {
  const parts = String(dateStr).split('-').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part) || part <= 0)) return String(dateStr || '');
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (Number.isNaN(date.getTime())) return String(dateStr || '');
  const label = `${FR_WEEKDAYS[date.getUTCDay()]} ${day} ${FR_MONTHS[month - 1]}`;
  return withYear ? `${label} ${year}` : label;
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
    price: priceValue !== null ? formatEuro(priceValue) : 'à régler sur place',
    centerName: center.name,
  };
}

// Bibliothèque de modèles prêts à l'emploi, bien rédigés, au nom du centre.
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
      subject: `Votre réservation ${v.centerName} est confirmée`,
      body: [
        `Bonjour ${v.clientName},`,
        '',
        `Votre réservation pour ${v.offer} le ${v.date} à ${v.startTime}${v.pax ? ` pour ${v.pax} personne(s)` : ''} est confirmée.`,
        'Merci d’arriver une dizaine de minutes avant l’heure prévue, pour un lancement fluide.',
        'Le paiement se fait sur place.',
        '',
        'Bien à vous,',
        v.centerName,
      ].join('\n'),
    }),
    sms: (v) => `${v.centerName}: reservation confirmee pour ${v.firstName} le ${v.date} a ${v.startTime}. Merci d'arriver 10 min avant. A bientot !`,
  },
  {
    id: 'reminder',
    label: 'Rappel de venue',
    category: 'Avant venue',
    description: 'Rappelle un rendez-vous proche.',
    email: (v) => ({
      subject: `Petit rappel pour votre venue chez ${v.centerName}`,
      body: [
        `Bonjour ${v.clientName},`,
        '',
        `Votre venue est prévue le ${v.date} à ${v.startTime} pour ${v.offer}.`,
        'Si possible, arrivez une dizaine de minutes avant l’heure prévue.',
        'En cas de retard, appelez le centre, l’équipe ajuste le planning avec vous.',
        '',
        'Bien à vous,',
        v.centerName,
      ].join('\n'),
    }),
    sms: (v) => `${v.centerName}: rappel, votre venue est prevue le ${v.date} a ${v.startTime}. Merci d'arriver 10 min avant. En cas de retard, appelez le centre.`,
  },
  {
    id: 'delay',
    label: 'Retard / attente',
    category: 'Le jour J',
    description: 'Prévenir d’un léger retard côté centre.',
    email: (v) => ({
      subject: `Ajustement de votre réservation ${v.centerName}`,
      body: [
        `Bonjour ${v.clientName},`,
        '',
        `Ajustement côté planning, votre réservation ${v.offer} du ${v.date} reste confirmée, avec un léger décalage sur l’horaire.`,
        'Le montant ne change pas, seul l’horaire est concerné.',
        'L’équipe vous accueille dès votre arrivée et vous tient au courant sur place.',
        'Si ce changement pose problème, répondez simplement à ce message ou contactez le centre.',
        '',
        'Merci de votre compréhension,',
        v.centerName,
      ].join('\n'),
    }),
    sms: (v) => `${v.centerName}: decalage sur votre reservation du ${v.date}. Elle reste confirmee, l'equipe vous accueille des l'arrivee. Merci de votre comprehension.`,
  },
  {
    id: 'reschedule',
    label: 'Modification d’horaire',
    category: 'Le jour J',
    description: 'Proposer un nouvel horaire à valider.',
    email: (v) => ({
      subject: `Modification d’horaire pour votre réservation ${v.centerName}`,
      body: [
        `Bonjour ${v.clientName},`,
        '',
        `L’horaire de votre réservation ${v.offer} du ${v.date} doit être ajusté (initialement ${v.startTime}).`,
        'Le montant reste inchangé, seul l’horaire est concerné.',
        'Pouvez-vous confirmer si le nouvel horaire proposé vous convient ? L’équipe reste flexible pour trouver le meilleur créneau.',
        'Répondez simplement à ce message ou appelez le centre.',
        '',
        'Merci d’avance,',
        v.centerName,
      ].join('\n'),
    }),
    sms: (v) => `${v.centerName}: l'horaire de votre reservation du ${v.date} (${v.startTime}) doit etre ajuste. Merci de rappeler le centre pour valider un nouveau creneau.`,
  },
  {
    id: 'cancellation',
    label: 'Annulation',
    category: 'Le jour J',
    description: 'Informer d’une annulation avec tact.',
    email: (v) => ({
      subject: `Au sujet de votre réservation ${v.centerName}`,
      body: [
        `Bonjour ${v.clientName},`,
        '',
        `Votre réservation ${v.offer} du ${v.date} à ${v.startTime} doit malheureusement être annulée.`,
        'Aucun montant n’est dû.',
        'L’équipe en est sincèrement désolée et serait ravie de vous retrouver sur un prochain créneau. Contactez le centre, la meilleure date sera cherchée avec vous.',
        '',
        'Avec toutes les excuses de l’équipe,',
        v.centerName,
      ].join('\n'),
    }),
    sms: (v) => `${v.centerName}: votre reservation du ${v.date} a ${v.startTime} doit etre annulee. Toutes les excuses de l'equipe. Contactez le centre pour reprogrammer.`,
  },
  {
    id: 'thanks',
    label: 'Remerciement post-visite',
    category: 'Après venue',
    description: 'Remercier après la visite et inviter au retour.',
    email: (v) => ({
      subject: 'Merci d\'être passés',
      body: [
        `Bonjour ${v.clientName},`,
        '',
        `Merci d'être venus chez ${v.centerName}. L'équipe espère que vous avez passé un bon moment, et qu'il reste quelques revanches à jouer.`,
        // La demande d'avis en ligne a ete RETIREE d'ici. Ce message est envoye
        // a la main par le staff depuis une fiche resa : il n'a pas de jeton de
        // redirection, donc pas de bouton « Laisser un avis Google », donc il
        // demandait une action sans donner le moyen de la faire. La demande
        // d'avis vit dans « Merci post-visite » (buildPostVisitMessage), qui a
        // le bouton tracke. Une seule demande d'avis, un seul chemin.
        'Et si quelque chose n\'allait pas, dites-le en répondant à ce message. L\'équipe préfère le savoir.',
        '',
        'Au plaisir de vous revoir,',
        v.centerName,
      ].join('\n'),
    }),
    sms: (v) => `${v.centerName}: merci pour votre visite ${v.firstName} ! L'equipe espere que vous vous etes bien amuses. A bientot !`,
  },
  {
    id: 'practical_info',
    label: 'Informations pratiques',
    category: 'Avant venue',
    description: 'Adresse, accès et infos utiles.',
    email: (v) => ({
      subject: `Infos pratiques pour votre venue chez ${v.centerName}`,
      body: [
        `Bonjour ${v.clientName},`,
        '',
        `Voici quelques infos pour votre venue le ${v.date} à ${v.startTime} chez ${v.centerName}.`,
        'Un parking est disponible sur place. Merci d’arriver une dizaine de minutes avant l’heure prévue.',
        'Pour toute question (accès, horaires), répondez à ce message ou contactez le centre.',
        '',
        'Bien à vous,',
        v.centerName,
      ].join('\n'),
    }),
    sms: (v) => `${v.centerName}: rendez-vous le ${v.date} a ${v.startTime}. Parking sur place, merci d'arriver 10 min avant. A bientot !`,
  },
  {
    id: 'promo',
    label: 'Offre / promo',
    category: 'Fidélisation',
    description: 'Partager une offre commerciale.',
    email: (v) => ({
      subject: `Une offre pour votre prochaine visite chez ${v.centerName}`,
      body: [
        `Bonjour ${v.clientName},`,
        '',
        `Une offre est disponible pour votre prochaine visite chez ${v.centerName}.`,
        'Réservez dès maintenant en ligne, ou répondez à ce message et l’équipe s’occupe du reste.',
        '',
        'Bien à vous,',
        v.centerName,
      ].join('\n'),
    }),
    sms: (v) => `${v.centerName}: une offre est disponible pour votre prochaine visite. Reservez en ligne. A bientot !`,
  },
  {
    id: 'custom',
    label: 'Message vierge',
    category: 'Personnalisé',
    description: 'Rédiger un message libre.',
    email: (v) => ({
      subject: `Un message de ${v.centerName}`,
      body: [
        `Bonjour ${v.clientName},`,
        '',
        '',
        '',
        v.centerName,
      ].join('\n'),
    }),
    sms: (v) => `${v.centerName}: `,
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
  // Le membre de session { id, name, role } : il signe le mail et reste dans
  // payload.sentBy (qui a repondu, lisible dans le fil).
  member = null,
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
  // Un message manuel : signature de la personne qui ecrit, portee « manuel ».
  const personne = personneDuMembre(member);
  const habillage = channel === 'email' ? habillageDe(await resolveEmailDesign(resolvedCenterId), 'manual', personne) : null;
  const sentBy = sentByDuMembre(member);
  const communication = await createCommunication({
    centerId: resolvedCenterId,
    reservationId,
    channel,
    templateId: `client_${templateId || 'custom'}`,
    recipient,
    subject: channel === 'email' ? finalSubject : '',
    body: channel === 'email'
      ? emailShell({
        title: finalSubject, body: finalBody, preheader: finalSubject, center: centerOrNull(resolvedCenterId),
        design: habillage ? habillage.design : null, signature: habillage ? habillage.signature : null,
      })
      : finalBody,
    status: 'queued',
    scheduledAt: new Date().toISOString(),
    payload: {
      textBody: finalBody,
      clientMessage: true,
      templateId,
      staffMember,
      ...(sentBy ? { sentBy } : {}),
    },
  });

  const dispatched = communication.id
    ? await dispatchDueCommunications({ limit: 5, centerId: resolvedCenterId, reservationId }).catch(() => null)
    : null;

  return { communication, dispatched };
}

// Qui signe et qui a envoye, a partir du membre de session { id, name, role }.
// Un membre sans nom ne signe pas de sa personne (l equipe signe) et n est
// pas trace comme auteur : mieux vaut rien qu un « staff » anonyme.
// UNE IDENTITE TECHNIQUE NE SIGNE PAS UN MAIL CLIENT (2026-09-17). Le compte
// « Proprietaire plateforme » (acces proprietaire ou de secours) n est pas une
// personne du centre : le client lirait « Proprietaire plateforme » sous la
// reponse. Sans nom de personne, l equipe du centre signe. Un nom tape a la
// main dans le composeur reste respecte, sauf s il est ce libelle technique.
const LIBELLE_TECHNIQUE = 'proprietaire plateforme';
function sansAccents(texte) {
  return String(texte || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}
function personneDuMembre(member, { name = '', role = '' } = {}) {
  const explicite = String(name || '').trim();
  const nom = String(explicite || (member && member.name) || '').trim();
  if (!nom) return null;
  const membreTechnique = !explicite && Boolean(member) && (/platform-owner/.test(String(member.id || '')) || member.emergency === true);
  if (sansAccents(nom) === LIBELLE_TECHNIQUE || membreTechnique) return null;
  const roleBrut = String(role || (member && member.role) || '').trim();
  return { name: nom.slice(0, 120), role: sansAccents(roleBrut) === LIBELLE_TECHNIQUE ? '' : roleBrut.slice(0, 80) };
}

function sentByDuMembre(member) {
  if (!member || typeof member !== 'object') return null;
  const memberId = String(member.id || '').trim();
  const memberName = String(member.name || '').trim();
  if (!memberId && !memberName) return null;
  return { memberId, memberName, memberRole: String(member.role || '').trim() };
}

// Envoi libre (studio mails ET composer de la page Emails) : MÊME pipeline que
// les messages client (communication en file + dispatch immédiat) : historique
// et retries unifiés. AUCUNE réservation requise.
// `replyToCommunicationId` : cet envoi répond à un email REÇU → l'inbound est
// marqué répondu, et si le staff a modifié la réponse proposée par l'agent, la
// version corrigée devient une leçon (mémoire de l'agent). Depuis le
// 2026-09-16, la reponse porte aussi les en-tetes In-Reply-To / References du
// message recu et rejoint son fil (lib/email-threads.js).
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
  attemptId = '',
  idempotencyKey = '',
  // Fil de conversation cible (sans reponse a un message precis), signature
  // (true / false / undefined = portee « manuel » du design) et signataire.
  threadId = null,
  signature,
  signatoryName = '',
  signatoryRole = '',
  // Le membre de session { id, name, role } : signataire par defaut et
  // payload.sentBy. Le handler api/ops.js le passe depuis la session.
  member = null,
}, deps = {}) {
  const enqueue = deps.enqueue || createCommunication;
  const depsLecture = deps.query ? deps : defaultDeps();
  const query = depsLecture.query;
  const recipient = String(to || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    const error = new Error('Adresse email du destinataire invalide.');
    error.expose = true;
    throw error;
  }
  let finalSubject = String(subject || '').trim();
  const finalBody = String(body || '').trim();
  if (!finalBody) { const e = new Error('Le message est vide.'); e.expose = true; throw e; }
  if (finalBody.length > 20000) { const e = new Error('Message trop long (20 000 caractères max).'); e.expose = true; throw e; }
  const suppliedReply = replyToCommunicationId !== null && replyToCommunicationId !== undefined && replyToCommunicationId !== '';
  const replyToId = suppliedReply ? Number(replyToCommunicationId) : null;
  if (suppliedReply && (!Number.isSafeInteger(replyToId) || replyToId <= 0)) {
    throw Object.assign(new Error('Message recu introuvable.'), { statusCode: 400, expose: true });
  }
  // Le message repondu : ses en-tetes et son fil. Le sujet vide d une reponse
  // devient « Re: » + le sujet d origine (sans empiler les prefixes).
  let reponseA = null;
  if (replyToId) {
    const inbound = await query(
      `select payload, message_id, references_ids, thread_id, subject from communications where id = $1 and center_id = $2
       and direction = 'inbound' and lower(recipient) = lower($3) limit 1;`,
      [replyToId, centerId, recipient],
    );
    if (!inbound.rows.length) {
      throw Object.assign(new Error('Message recu introuvable pour ce centre et ce destinataire.'), { statusCode: 404, expose: true });
    }
    const ligne = inbound.rows[0];
    const messageId = String(ligne.message_id || '').trim();
    const filDuMessage = Number(ligne.thread_id);
    reponseA = {
      inReplyTo: messageId,
      references: `${String(ligne.references_ids || '').trim()} ${messageId}`.trim(),
      threadId: Number.isSafeInteger(filDuMessage) && filDuMessage > 0 ? filDuMessage : null,
      subject: String(ligne.subject || '').trim(),
    };
    if (!finalSubject && reponseA.subject) finalSubject = `Re: ${sujetSansPrefixe(reponseA.subject)}`;
  }
  if (!finalSubject) { const e = new Error("L'objet est requis."); e.expose = true; throw e; }
  // Un fil cible sans reponse a un message precis : il doit etre DU centre.
  let filCible = null;
  const filDemande = Number(threadId);
  if (!reponseA && Number.isSafeInteger(filDemande) && filDemande > 0) {
    const fil = await query('select id from email_threads where id = $1 and center_id = $2 limit 1;', [filDemande, centerId]);
    if (!fil.rows.length) {
      throw Object.assign(new Error('Conversation introuvable pour ce centre.'), { statusCode: 404, expose: true });
    }
    filCible = filDemande;
  }
  const crypto = require('crypto');
  // Legacy internal callers can receive a generated attempt; HTTP requires
  // the client to supply it so a lost response can be retried safely.
  const stableAttempt = String(attemptId || idempotencyKey || crypto.randomUUID());
  if (!/^[A-Za-z0-9:_-]{8,128}$/.test(stableAttempt)
    || (attemptId && idempotencyKey && attemptId !== idempotencyKey)) {
    throw Object.assign(new Error('Identifiant de tentative invalide.'), { statusCode: 400, expose: true });
  }
  // Envoi programmé : date future (tolérance horloge 2 min) plafonnée à 1 an.
  let sendAt = new Date();
  let deferred = false;
  if (scheduledAt) {
    const requested = new Date(scheduledAt);
    if (Number.isNaN(requested.getTime())) { const e = new Error("Date d'envoi programmé invalide."); e.expose = true; throw e; }
    if (requested.getTime() > Date.now() + 365 * 86400000) { const e = new Error("L'envoi ne peut pas être programmé à plus d'un an."); e.expose = true; throw e; }
    if (requested.getTime() > Date.now() + 2 * 60000) { sendAt = requested; deferred = true; }
  }

  // Le design du centre et la signature : portee « manuel » par defaut, le
  // gerant peut la retirer ou l imposer message par message. La personne qui
  // signe est le membre connecte, sauf si le composeur en nomme une autre.
  const design = await resolveEmailDesign(centerId, depsLecture);
  const personne = personneDuMembre(member, { name: signatoryName, role: signatoryRole });
  const signatureActive = signature === undefined || signature === null
    ? Boolean(design && design.signatureScope && design.signatureScope.manual)
    : Boolean(signature);
  const sentBy = sentByDuMembre(member);
  const directFingerprint = crypto.createHash('sha256').update(JSON.stringify({
    centerId, recipient: recipient.toLowerCase(), subject: finalSubject, body: finalBody,
    fromEmail, fromLabel, category, templateRef, identityId: Number(identityId) || null,
    replyToId, name: String(name || ''), scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
    signature: signatureActive, signatory: personne, threadId: filCible,
  })).digest('hex');
  const communication = await enqueue({
    centerId,
    reservationId: null,
    channel: 'email',
    templateId: templateRef ? `studio_${templateRef}` : `studio_${category}`,
    recipient,
    subject: finalSubject,
    body: emailShell({
      title: finalSubject, body: finalBody, preheader: finalSubject, center: centerOrNull(centerId),
      design, signature: { enabled: signatureActive, person: personne },
    }),
    status: 'queued',
    scheduledAt: sendAt.toISOString(),
    idempotencyKey: `direct:${centerId}:${stableAttempt}`,
    payload: {
      directFingerprint,
      attemptId: stableAttempt,
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
      signature: signatureActive,
      ...(personne ? { signatory: personne } : {}),
      ...(sentBy ? { sentBy } : {}),
      ...(deferred ? { scheduled: true } : {}),
      ...(replyToId ? { replyToCommunicationId: replyToId } : {}),
      // En-tetes et fil de la reponse : lus par sendEmail (In-Reply-To,
      // References) et par assurerFilPourCommunication (threadId).
      ...(reponseA && reponseA.inReplyTo ? { inReplyTo: reponseA.inReplyTo, references: reponseA.references } : {}),
      ...(reponseA && reponseA.threadId ? { threadId: reponseA.threadId } : {}),
      ...(filCible ? { threadId: filCible } : {}),
    },
  });

  // Programmé pour plus tard : le cron/dispatch du moment venu s'en charge.
  const dispatched = communication.id && !deferred
    ? await dispatchDueCommunications({ limit: 1, centerId, communicationId: communication.id }).catch(() => null)
    : null;

  return { communication, dispatched, attemptId: stableAttempt, resendConfigured: Boolean(process.env.RESEND_API_KEY) };
}

// Aperçu d'un mail libre du composeur : EXACTEMENT le même habillage que
// l'envoi (emailShell + textToHtml), sans rien écrire nulle part. C'est ce qui
// rend l'aperçu honnête : même chemin de rendu que le vrai départ, design et
// signature compris (memes regles que sendDirectEmail).
async function buildDirectEmailPreview({
  centerId = 'libramont', subject = '', body = '', signature, signatoryName = '', signatoryRole = '', member = null,
} = {}, deps = defaultDeps()) {
  const finalSubject = String(subject || '').trim() || 'Aperçu du message';
  const design = await resolveEmailDesign(centerId, deps);
  const personne = personneDuMembre(member, { name: signatoryName, role: signatoryRole });
  const signatureActive = signature === undefined || signature === null
    ? Boolean(design && design.signatureScope && design.signatureScope.manual)
    : Boolean(signature);
  return {
    subject: finalSubject,
    html: emailShell({
      title: finalSubject, body: String(body || ''), preheader: finalSubject, center: centerOrNull(centerId),
      design, signature: { enabled: signatureActive, person: personne },
    }),
  };
}

// Boucle fermée inbox : marque l'email reçu comme répondu + apprentissage
// implicite (réponse envoyée ≠ réponse proposée → leçon). Best-effort : ne
// bloque jamais l'envoi.
async function linkReplyToInbound({
  centerId,
  recipient,
  replyToCommunicationId,
  replyCommunicationId,
  sentSubject,
  sentBody,
  sentAt,
  deps = {},
}) {
  const query = deps.query || defaultDeps().query;
  const found = await query(
    `select payload from communications where id = $1 and center_id = $2
     and direction = 'inbound' and lower(recipient) = lower($3) limit 1;`,
    [Number(replyToCommunicationId), centerId, recipient],
  );
  if (!found.rows.length) return;
  const payload = found.rows[0].payload && typeof found.rows[0].payload === 'object'
    ? found.rows[0].payload
    : {};
  const linked = await query(
    `update communications set payload = payload || $2::jsonb
     where id = $1 and center_id = $3 and direction = 'inbound'
       and lower(recipient) = lower($4)
       and coalesce(payload->>'replyCommunicationId', '') <> ($2::jsonb->>'replyCommunicationId')
       and exists (select 1 from communications sent
         where sent.id = $5 and sent.center_id = $3 and sent.direction = 'outbound'
           and sent.status in ('sent', 'delivered') and lower(sent.recipient) = lower($4))
     returning payload;`,
    [Number(replyToCommunicationId), JSON.stringify({
      repliedAt: sentAt || new Date().toISOString(),
      replyCommunicationId: replyCommunicationId || null,
    }), centerId, recipient, Number(replyCommunicationId)],
  );
  if (!linked.rows.length) return;
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

// Toutes les occasions que le tunnel propose (CUSTOM_REQUEST_OCCASIONS,
// api/public-booking-meta.js) ont leur libelle : 'evg' manquait et le repli
// `labels[occ] || request.occasion` affichait le code brut dans l'email.
// Libelle aligne sur celui de l'ecran staff (assets/app-main.js).
const CUSTOM_REQUEST_OCCASION_LABELS = {
  anniversaire: 'Anniversaire',
  amis: 'Entre amis / groupe',
  entreprise: 'Entreprise / team-building',
  ecole: 'École / association',
  evg: 'EVG / EVJF',
  famille: 'En famille',
  autre: 'Autre',
};

// Accusé de réception d'une demande SUR MESURE (lead). Best-effort : renvoie
// { skipped } si Resend n'est pas configuré, ne lève jamais pour ne pas bloquer
// l'enregistrement du lead. Ne crée PAS de communication liée à une réservation
// (le lead n'a pas de reservationId).
// LE TEXTE DE L ACCUSE, SEPARE DE SON ENVOI. Ce qu un client lit doit pouvoir
// etre juge sans base, sans reseau et sans effet de bord : le gate d ecriture
// (scripts/ecriture-client-check.js) appelle cette fonction, pas l envoi.
// `sendCustomRequestAck` compose exactement ce texte, il n en existe pas deux
// versions.
function buildCustomRequestAck(request = {}) {
  // La demande STRUCTUREE du formulaire (lib/custom-request) : le client
  // relit ce qu il a demande, groupe, envies et date, tel que l equipe le lit.
  const d = request.demande && typeof request.demande === 'object' ? request.demande : null;
  const nom = (liste) => (Array.isArray(liste) ? liste : []).map((x) => x && x.name).filter(Boolean).join(', ');
  const activites = d ? (Array.isArray(d.activities) ? d.activities : [])
    .map((a) => require('./custom-request').libelleActivite(a, d.participants)).join(', ') : '';
  const accompagnants = d && Number(d.companions) > 0
    ? ` + ${d.companions} accompagnant${Number(d.companions) > 1 ? 's' : ''}`
    : '';
  const details = (d ? [
    ['Groupe', [d.groupTypeLabel, d.organisation].filter(Boolean).join(', ')],
    request.requestedDate ? ['Date souhaitée', request.requestedDate] : null,
    Number(request.pax) > 0 ? ['Participants', `${request.pax}${accompagnants}`] : null,
    activites ? ['Activités', activites] : null,
    nom(d.formulas) ? ['Formules', nom(d.formulas)] : null,
    d.advice ? ['Conseil', 'L’équipe vous propose un programme'] : null,
  ] : [
    request.occasion ? ['Type d\'occasion', CUSTOM_REQUEST_OCCASION_LABELS[request.occasion] || request.occasion] : null,
    request.requestedDate ? ['Date souhaitée', request.requestedDate] : null,
    Number(request.pax) > 0 ? ['Personnes (approx.)', String(request.pax)] : null,
    request.company ? ['Société', request.company] : null,
  ]).filter(Boolean);

  const firstName = String(request.contactName || '').trim().split(/\s+/)[0] || 'bonjour';
  return {
    subject: 'Votre demande sur mesure est bien arrivée',
    title: 'Votre demande sur mesure est bien arrivée',
    eyebrow: 'Demande sur mesure',
    body: [
      `Bonjour ${firstName},`,
      '',
      'Votre demande est enregistrée et transmise à l’équipe du centre. Privatisation, formule taillée pour votre groupe, devis entreprise : chaque demande est étudiée à la main, car elle dépend du planning et des ressources disponibles à la date visée.',
      request.message ? `\nLe message reçu, « ${String(request.message).slice(0, 500)} »` : '',
      '',
      `Une réponse précise sur la faisabilité et sur le montant sera donnée sous ${DELAI_REPONSE}.`,
      'Si un détail vous revient d’ici là, répondez simplement à ce message, il rejoint le même dossier.',
    ].filter((line) => line !== null).join('\n'),
    preheader: `Demande enregistrée et transmise à l’équipe. Réponse précise sous ${DELAI_REPONSE}.`,
    details,
    note: 'Ce message accuse réception de la demande. Ce n’est pas une réservation, et rien n’est encore retenu à votre nom.',
  };
}

async function sendCustomRequestAck(request = {}) {
  const recipient = String(request.email || '').trim();
  if (!recipient) return { skipped: true, reason: 'Email destinataire manquant.' };
  // LE CENTRE QUI A RECU LA DEMANDE SIGNE L ACCUSE (2026-09-16). Il partait sans
  // centre : centerOrNull retombait sur libramont, et un client de N'IMPORTE
  // QUEL centre recevait un mail signe « Fun Galaxy Libramont », sa reponse
  // arrivant dans la boite de Libramont. Sans centre, aucun nom de centre.
  const centerId = String(request.centerId || '').trim();
  const centre = centerId ? centerOrNull(centerId) : null;

  const message = buildCustomRequestAck(request);
  const { subject, body } = message;

  // Un accuse automatique signe comme une sequence, avec le design du centre.
  // Sans centre : aucun design, donc aucune signature (rien d invente).
  const habillageAccuse = centerId ? habillageDe(await resolveEmailDesign(centerId), 'sequences') : null;
  const html = emailShell({
    title: message.title,
    eyebrow: message.eyebrow,
    body,
    preheader: message.preheader,
    details: message.details,
    note: message.note,
    center: centre,
    design: habillageAccuse ? habillageAccuse.design : null,
    signature: habillageAccuse ? habillageAccuse.signature : null,
  });

  try {
    // L'identite d'expediteur du centre, comme pour tous ses autres mails.
    const sender = centerId ? await resolveCenterSenderIdentity(centerId) : {};
    const result = await sendEmail({
      centerId,
      recipient,
      subject,
      body: html,
      idempotencyKey: request.idempotencyKey || (request.id ? `custom-request-ack-${request.id}` : ''),
      payload: { ...sender },
    });
    return { ok: !result.skipped, ...result };
  } catch (error) {
    return { skipped: true, reason: error.message || 'Envoi impossible.' };
  }
}

// Campagnes : un envoi PAR destinataire via la pipeline standard (queue,
// retries, historique). Idempotence par campagne+email : relancer la même
// campagne ne double jamais un envoi. Dispatch immédiat seulement si non
// programmée : sinon le worker s'en charge à l'heure dite.
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
  deps = defaultDeps(),
  // `enqueue` injectable (defaut = createCommunication) : meme convention que
  // les sweeps, ce qui rend l'envoi testable sans base (gate de separation).
  enqueue = createCommunication,
}) {
  // FILTRAGE AU POINT D'ENVOI (M4) : les adresses retirees de la liste
  // marketing sont exclues ICI, pas dans l'interface. Une campagne relancee par
  // le cron passe par la meme fonction et filtre donc aussi. Une seule requete
  // par lot (index unique). Erreur DB -> set vide (l'envoi n'est jamais bloque
  // par une lecture ratee, cf. lib/marketing-suppression.js).
  const suppressed = await listSuppressedSet(centerId, recipients.map((r) => r.email), deps);
  // Une campagne signe seulement si le gerant l a voulu (portee « campaigns »,
  // coupee par defaut : un mail de masse n a pas a porter des coordonnees).
  const habillageCampagne = habillageDe(await resolveEmailDesign(centerId, deps), 'campaigns');
  let queued = 0;
  let skipped = 0;
  for (const recipient of recipients) {
    if (suppressed.has(String(recipient.email || '').trim().toLowerCase())) { skipped += 1; continue; }
    const personalSubject = personalize(subject, recipient);
    const personalBody = personalize(body, recipient);
    const unsub = buildUnsubscribe(centerId, recipient.email);
    await enqueue({
      centerId,
      reservationId: null,
      channel: 'email',
      templateId: `campaign_${campaignId}`,
      recipient: recipient.email,
      subject: personalSubject,
      body: emailShell({
        title: personalSubject,
        body: personalBody,
        preheader: personalSubject,
        center: centerOrNull(centerId),
        unsubscribeLine: { text: unsub.line, url: unsub.url, label: unsub.label },
        design: habillageCampagne ? habillageCampagne.design : null,
        signature: habillageCampagne ? habillageCampagne.signature : null,
      }),
      status: 'queued',
      scheduledAt: scheduledAt || new Date().toISOString(),
      payload: { textBody: `${personalBody}\n\n${unsub.textLine}`, campaignId, fromEmail, fromLabel, unsubToken: unsub.token },
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
  return { queued, skipped };
}

/* ============================================================================
   SÉQUENCES AUTOMATIQUES : config ON/OFF par centre, relance client 1-clic
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
  request_received: { enabled: true },
  confirmation: { enabled: true },
  reminder_48h: { enabled: true },
  post_visit: { enabled: true },
  birthday_j30: { enabled: true },
  reactivation: { enabled: false },
};

// Contenus/timings par défaut de chaque séquence : l'UI les affiche comme
// placeholders et « Réinitialiser » y revient. Les textes MIROIRENT ce que les
// builders produisent réellement (aucune promesse chiffrée).
const AUTOMATION_CONTENT_DEFAULTS = {
  // Accuse de reception : le mail que recoit un client dont la demande part en
  // validation staff. Le plus envoye du corpus apres la confirmation, et le
  // seul qui n'etait pas editable jusqu'ici.
  request_received: {
    subject: 'Votre demande est bien arrivée',
    body: [
      'Bonjour {{nom}},',
      '',
      'Votre demande pour {{formule}} le {{date}} est enregistrée et transmise à l’équipe.',
      'Avant toute confirmation, l’équipe cale l’enchaînement des activités pour votre groupe. C’est ce qui sépare une visite fluide d’une visite passée à attendre.',
      '',
      `Une réponse précise sur la validité de ce créneau sera donnée sous ${DELAI_REPONSE}.`,
      '',
      '{{centre}}',
    ].join('\n'),
    variables: ['prenom', 'nom', 'date', 'heure', 'formule', 'pax', 'centre'],
  },
  confirmation: {
    subject: 'Votre réservation {{centre}} est confirmée',
    body: [
      'Bonjour {{nom}},',
      '',
      'Votre réservation pour {{formule}} est confirmée.',
      'Rendez-vous le {{date}} à {{heure}}.',
      'Merci d’arriver 10 minutes avant, surtout si le groupe doit être lancé ensemble.',
      '',
      'Le paiement se fait sur place.',
      '',
      'Bien à vous,',
      '{{centre}}',
    ].join('\n'),
    variables: ['prenom', 'nom', 'date', 'heure', 'formule', 'pax', 'centre', 'prix'],
  },
  reminder_48h: {
    subject: 'Rappel pour votre réservation {{centre}}',
    body: [
      'Bonjour {{nom}},',
      '',
      'Votre venue est prévue le {{date}} à {{heure}} chez {{centre}}.',
      'Si possible, arrivez 10 minutes avant l’heure prévue.',
      '',
      'Bien à vous,',
      '{{centre}}',
    ].join('\n'),
    offsetDays: 2,
    offsetRange: [1, 4],
    offsetLabel: 'jours avant la venue',
    variables: ['prenom', 'nom', 'date', 'heure', 'formule', 'pax', 'centre'],
  },
  post_visit: {
    subject: 'Merci pour votre visite chez {{centre}}',
    body: [
      'Bonjour {{nom}},',
      '',
      'Merci d’être venu chez {{centre}}.',
      'Si tout s’est bien passé, l’équipe sera ravie de vous revoir pour une prochaine session.',
      'Si quelque chose peut être amélioré, répondez simplement à ce message, votre retour arrive directement à l’équipe.',
      '',
      '{{centre}}',
    ].join('\n'),
    offsetDays: 1,
    offsetRange: [0, 3],
    offsetLabel: 'jours après la visite',
    variables: ['prenom', 'nom', 'centre'],
    // Lien « Laissez-nous un avis Google » ajouté au mail quand configuré
    // (fiche Google du centre). Vide = pas de bouton.
    reviewUrl: '',
  },
  birthday_j30: {
    subject: 'Un anniversaire approche 🎂',
    body: [
      'Bonjour {{prenom}},',
      '',
      'L’année dernière (le {{date_fete}}), vous avez fêté un anniversaire chez {{centre}}, et l’équipe espère que c’était une belle journée.',
      'La date approche à nouveau. Pour remettre ça, réservez tôt, la table sera préparée et prête.',
      '',
      'Répondez à ce message ou réservez en ligne, c’est le plus simple.',
      '',
      'Bien à vous,',
      'L’équipe {{centre}}',
    ].join('\n'),
    offsetDays: 30,
    offsetRange: [15, 60],
    offsetLabel: 'jours avant la date d’anniversaire',
    variables: ['prenom', 'date_fete', 'centre'],
  },
  reactivation: {
    subject: 'Une place vous attend',
    body: [
      'Bonjour {{prenom}},',
      '',
      'Cela fait quelques mois sans vous voir chez {{centre}}. Le bowling, le laser game et les nouveautés vous attendent, en famille ou entre amis.',
      'Réservez en ligne quand vous voulez, c’est le plus rapide.',
      '',
      'Au plaisir de vous revoir,',
      'L’équipe {{centre}}',
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
// offsetDays?, cap?}, seuls les écarts valides sont exposés.
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
    if (key === 'post_visit' && typeof raw.reviewUrl === 'string' && raw.reviewUrl.trim()) {
      entry.reviewUrl = raw.reviewUrl.trim();
    }
    settings[key] = entry;
  }
  return settings;
}

// Séquence → template_id réellement écrits dans `communications` (pour stats).
const AUTOMATION_TEMPLATE_IDS = {
  request_received: ['request_received'],
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
  // `parDefaut` : c est la vraie base. Le cache du design (60 s) ne s applique
  // qu a elle ; un `query` injecte par un gate lit toujours ce qu on lui donne.
  return { query: (text, params) => getPool().query(text, params), parDefaut: true };
}

// L'IDENTITE D'EXPEDITEUR DU CENTRE.
//
// Elle n'etait attachee qu'aux campagnes et aux messages directs (le staff la
// choisit dans le studio mails). Les sequences AUTOMATIQUES (anniversaire J-30,
// reactivation, sequences personnalisees) repartaient sur l'expediteur
// plateforme : le client d'un deuxieme centre recevait un mail signe Fun Galaxy.
//
// La source est la meme table que le studio (email_identities, migration 0013)
// et le meme ordre de priorite (is_default d'abord). Fail-soft : sans identite
// configuree, on ne pose rien et sendEmail garde son repli plateforme. On
// n'invente JAMAIS une adresse : une adresse non verifiee cote Resend ne part
// pas, et un domaine qui rebondit coute la reputation de tous les centres.
async function resolveCenterSenderIdentity(centerId, deps = defaultDeps()) {
  try {
    const result = await deps.query(
      'select label, email from email_identities where center_id = $1 order by is_default desc, id asc limit 1;',
      [centerId],
    );
    const row = result.rows[0];
    if (!row) return {};
    const email = String(row.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return {};
    return { fromEmail: email, fromLabel: String(row.label || '').trim() };
  } catch (error) {
    return {};
  }
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
// timing/cap) : l'état ON/OFF choisi par le gérant est conservé.
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
    delete entry.reviewUrl;
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
  if (normalized.reviewUrl !== undefined) {
    if (key !== 'post_visit') expose('Le lien avis Google se règle sur la séquence « Merci post-visite ».');
    const reviewUrl = String(normalized.reviewUrl || '').trim();
    if (!reviewUrl) {
      delete entry.reviewUrl;
    } else {
      let parsed = null;
      try { parsed = new URL(reviewUrl); } catch (error) { parsed = null; }
      const host = parsed ? parsed.hostname.toLowerCase() : '';
      const googleHost = host === 'g.page' || host === 'google.com' || host.endsWith('.google.com')
        || host === 'goo.gl' || host === 'maps.app.goo.gl' || host === 'g.co';
      if (!parsed || parsed.protocol !== 'https:' || !googleHost) {
        expose('Le lien doit être l’adresse https de votre fiche Google (google.com, g.page, maps.app.goo.gl…).');
      }
      if (reviewUrl.length > 500) expose('Lien trop long (500 caractères maximum).');
      entry.reviewUrl = reviewUrl;
    }
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

/* ── Aperçu et test d'une séquence ─────────────────────────────────────────
   Le gérant doit voir le mail TEL QUE LE CLIENT LE RECEVRA, avec son propre
   texte, AVANT d'enregistrer. Un aperçu approximatif serait pire que pas
   d'aperçu : il donnerait confiance dans un rendu qui n'existe pas.
   D'où la règle de construction : l'aperçu, l'envoi de test et la prod passent
   par les MÊMES builders et le MÊME shellFromMessage. Ils ne peuvent pas
   diverger, parce qu'il n'y a qu'un seul chemin de rendu.
   ──────────────────────────────────────────────────────────────────────── */

// Réservation de démonstration partagée par buildEmailSamples et l'aperçu :
// une seule fixture, donc un seul rendu de référence à juger.
const PREVIEW_RESERVATION = {
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

// Le patch envoyé par l'éditeur, construit par une fonction PURE. Elle existe
// pour une raison précise : le handler HTTP construisait ce patch à la main et
// avait oublié `reviewUrl`, rendant le champ « Lien avis Google » mort depuis
// sa création. Les gates Playwright mockent fetch et n'exercent jamais le
// serveur : un oubli ici était structurellement invisible. Ici, il est testable
// sans réseau (cf. scripts/emails-automation-check.js).
// `undefined` sur un champ absent = « ne touche pas à ce qui est en base ».
function buildAutomationPatch(body = {}) {
  return {
    enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    subject: typeof body.subject === 'string' ? body.subject : undefined,
    body: typeof body.body === 'string' ? body.body : undefined,
    offsetDays: body.offsetDays,
    cap: body.cap,
    reviewUrl: typeof body.reviewUrl === 'string' ? body.reviewUrl : undefined,
    reset: body.reset === true,
  };
}

// Valide un brouillon NON ENREGISTRÉ avec exactement les règles de la
// sauvegarde : longueurs et variables autorisées. Sans ça, on présenterait un
// aperçu impeccable d'un texte que le POST refusera trois secondes plus tard.
function validateAutomationDraft(key, patch = {}) {
  const content = AUTOMATION_CONTENT_DEFAULTS[key] || {};
  const expose = (message) => {
    const error = new Error(message);
    error.expose = true;
    error.statusCode = 400;
    throw error;
  };
  const checkField = (value, max, label) => {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.length > max) expose(`${label} trop long (${max} caractères maximum).`);
    const unknown = findUnknownAutomationTokens(text, content.variables || []);
    if (unknown.length) {
      expose(`Variable(s) inconnue(s) : ${unknown.join(', ')}. Disponibles : ${(content.variables || []).map((v) => `{{${v}}}`).join(' ')}.`);
    }
    return text;
  };
  return {
    subject: checkField(patch.subject, 140, 'Objet'),
    body: checkField(patch.body, 4000, 'Message'),
  };
}

// {key, patch} → {subject, html, textBody} rendu par le VRAI chemin de prod.
// Le brouillon prime sur ce qui est enregistré : c'est un aperçu de ce que le
// gérant est en train d'écrire, pas de ce qu'il a écrit hier.
async function buildAutomationPreview(centerId = 'libramont', key = '', patch = {}, deps = defaultDeps()) {
  if (!Object.prototype.hasOwnProperty.call(AUTOMATION_DEFAULTS, key)) {
    const error = new Error('Séquence inconnue.');
    error.expose = true;
    error.statusCode = 400;
    throw error;
  }
  const draft = validateAutomationDraft(key, patch);
  const stored = await getAutomationSettings(centerId, deps);
  const overrides = {
    ...(stored[key] || {}),
    ...(draft.subject ? { subject: draft.subject } : {}),
    ...(draft.body ? { body: draft.body } : {}),
  };
  const center = centerOrNull(centerId);
  const centerName = center?.name || '';
  const reservation = { ...PREVIEW_RESERVATION, centerId };
  // Le design du centre : l apercu de l editeur EST le mail reel, signature
  // comprise (portee « sequences »).
  const habillage = habillageDe(await resolveEmailDesign(centerId, deps), 'sequences');

  let message;
  if (key === 'request_received' || key === 'confirmation' || key === 'reminder_48h') {
    message = buildMessage({
      reservation: {
        ...reservation,
        validationStatus: key === 'request_received' ? 'staff_review' : 'confirmed',
      },
      templateId: key,
      channel: 'email',
      overrides,
    });
  } else if (key === 'post_visit') {
    // hasReviewLink suit le brouillon : le texte d'usine ne demande un avis que
    // si le bouton qui permet de le laisser existe vraiment.
    const reviewUrl = String(patch.reviewUrl !== undefined ? patch.reviewUrl : (stored.post_visit?.reviewUrl || '')).trim();
    message = buildPostVisitMessage(
      { name: reservation.name, hasReviewLink: Boolean(reviewUrl), centerName },
      overrides,
    );
    // Lien d'aperçu volontairement inerte : l'aperçu ne doit pas fabriquer de
    // token de tracking réel, il montre seulement que le bouton sera là.
    if (reviewUrl) message.action = { href: `${publicAppUrl()}/api/r?k=apercu`, label: 'Laisser un avis Google' };
  } else if (key === 'birthday_j30') {
    message = buildBirthdayJ30Message({ name: reservation.name, centerName, partyDateFr: '20 juin' }, overrides);
  } else {
    message = buildReactivationMessage({ name: reservation.name, centerName }, overrides);
  }

  return {
    key,
    subject: message.subject,
    html: shellFromMessage(message, center, habillage),
    textBody: message.body,
  };
}

// Envoi de test d'une séquence AU MEMBRE DU STAFF CONNECTÉ.
// SÉCURITÉ, règle non négociable : le destinataire est dérivé de la session
// serveur et JAMAIS d'une adresse fournie dans la requête. Sans ça, l'action
// deviendrait un relais d'envoi anonyme vers n'importe quelle boîte, signé du
// domaine du centre. `member` vient de `options.session.member` côté API.
// Le mail rendu est le MÊME objet que l'aperçu (buildAutomationPreview) : le
// test ne peut pas montrer autre chose que ce que le client recevra.
async function sendAutomationTest({ centerId = 'libramont', key = '', patch = {}, member = null } = {}, deps = {}) {
  const expose = (message, statusCode = 400) => {
    const error = new Error(message);
    error.expose = true;
    error.statusCode = statusCode;
    throw error;
  };
  const recipient = String(member?.contact || '').trim();
  if (!recipient) {
    expose('Aucune adresse email sur votre compte staff : ajoutez-la dans Réglages pour recevoir un test.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    expose('Le contact de votre compte staff n’est pas une adresse email : le test ne peut pas partir.');
  }

  const preview = await buildAutomationPreview(centerId, key, patch, deps.deps || defaultDeps());
  const enqueue = deps.enqueue || createCommunication;
  const dispatch = deps.dispatch || dispatchDueCommunications;
  // LE TEST PART COMME LE VRAI MAIL, expediteur compris (2026-09-16). Sans
  // l identite du centre, un test partait de l adresse plateforme alors que la
  // sequence reelle part de celle du centre : le bouton confirmait un envoi qui
  // n est pas celui que recoivent les clients.
  const sender = await resolveCenterSenderIdentity(centerId, deps.deps || defaultDeps());

  // template_id `test_<clé>` : la ligne reste dans le journal (le gérant voit
  // que son test est parti, et pourquoi il a échoué le cas échéant) mais elle
  // ne pollue ni les stats par séquence (AUTOMATION_TEMPLATE_IDS ne la connaît
  // pas) ni l'analyse des causes d'échec (getEmailInsightRows l'exclut).
  const communication = await enqueue({
    centerId,
    channel: 'email',
    templateId: `test_${key}`,
    recipient,
    subject: `[TEST] ${preview.subject}`,
    body: preview.html,
    status: 'queued',
    scheduledAt: new Date().toISOString(),
    idempotencyKey: `test:${key}:${member?.id || 'staff'}:${Date.now()}`,
    payload: { textBody: preview.textBody, test: true, sequence: key, ...sender },
  });

  const result = await dispatch({ limit: 1, centerId });
  const line = (result?.results || []).find((row) => row.id === communication?.id) || {};
  return {
    recipient,
    subject: `[TEST] ${preview.subject}`,
    status: line.status || communication?.status || 'queued',
    error: line.error || '',
  };
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
  // Le membre de session { id, name, role } : il signe et reste dans sentBy.
  member = null,
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
  // Une relance est un envoi manuel : le centre en tete de carte, le design
  // du centre, la signature de celui qui ecrit (portee « manuel »).
  const habillage = habillageDe(await resolveEmailDesign(centerId, deps.query ? deps : defaultDeps()), 'manual', personneDuMembre(member));
  const sentBy = sentByDuMembre(member);

  const communication = await enqueue({
    centerId,
    reservationId: null,
    channel: 'email',
    templateId: `relance_${safeReason}`,
    recipient,
    subject: finalSubject,
    // emailShell applique déjà textToHtml : passer le texte BRUT (une double
    // passe faisait apparaître les balises <p> en clair chez le client).
    body: emailShell({
      title: finalSubject, body: finalBody, preheader: finalSubject, center: centerOrNull(centerId),
      design: habillage ? habillage.design : null, signature: habillage ? habillage.signature : null,
    }),
    status: 'queued',
    scheduledAt: new Date().toISOString(),
    payload: {
      textBody: finalBody,
      relance: true,
      reason: safeReason,
      clientKey,
      clientName: name,
      staffMember,
      ...(sentBy ? { sentBy } : {}),
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
          and ${simulationSqlExclusion('res')}
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
  const { phoneAliases, resolvedNote } = require('./customer-notes');
  const result = await deps.query(
    'select client_key, body, updated_at::text as version, updated_by from client_notes where center_id = $1 and client_key = any($2::text[]);',
    [centerId, phoneAliases(clientKey)],
  );
  const resolved = resolvedNote(clientKey, result.rows);
  if (resolved.conflict) throw Object.assign(new Error(resolved.message), { statusCode: 409, expose: true });
  return resolved.note ? { ...resolved.note, clientKey: resolved.clientKey } : null;
}

async function saveClientNote(centerId = 'libramont', clientKey = '', body = '', deps = null, options = {}) {
  if (!clientKey) { const e = new Error('Client inconnu.'); e.expose = true; throw e; }
  const { saveCustomerNoteForKey } = require('./customer-notes');
  const pool = deps ? { query: deps.query, connect: async () => ({ query: deps.query, release() {} }) } : getPool();
  const saved = await saveCustomerNoteForKey({ centerId, clientKey, body: String(body || ''), baseUpdatedAt: options.baseUpdatedAt, updatedBy: options.updatedBy || '' }, pool);
  return { ok: true, note: saved.note, clientKey: saved.clientKey };
}

// ── Messages des séquences (sobres, FR belge, zéro promesse chiffrée) ───────
// Chaque builder accepte un override {subject?, body?} (texte du gérant, avec
// variables {{...}} substituées). Sans override : texte historique inchangé.
function buildBirthdayJ30Message({ name = '', partyDateFr = '', centerName = '' } = {}, overrides = null) {
  const prenom = firstNameOf(name);
  // Sans nom de centre, « chez le centre » plutot que « chez nous » : le
  // pronom est interdit (lib/client-writing.js), et rien ne s invente.
  const chez = String(centerName || '').trim() || 'le centre';
  const subject = 'Un anniversaire approche 🎂';
  const body = [
    `Bonjour ${prenom},`,
    '',
    `L'année dernière${partyDateFr ? ` (le ${partyDateFr})` : ''}, vous avez fêté un anniversaire chez ${chez}, et l'équipe espère que c'était une belle journée.`,
    'La date approche à nouveau. Pour remettre ça, réservez tôt, la table sera préparée et prête.',
    '',
    'Répondez à ce message ou réservez en ligne, c\'est le plus simple.',
    '',
    'Bien à vous,',
    signatureLine(centerName),
  ].join('\n');
  return applyMessageOverrides({ subject, body }, overrides, {
    prenom: prenom || 'vous',
    date_fete: partyDateFr,
    centre: centerName || 'votre centre',
  });
}

function buildReactivationMessage({ name = '', centerName = '' } = {}, overrides = null) {
  const prenom = firstNameOf(name);
  const chez = String(centerName || '').trim() || 'le centre';
  const subject = 'Une place vous attend';
  const body = [
    `Bonjour ${prenom},`,
    '',
    `Cela fait quelques mois sans vous voir chez ${chez}. Le bowling, le laser game et les nouveautés vous attendent, en famille ou entre amis.`,
    'Réservez en ligne quand vous voulez, c\'est le plus rapide.',
    '',
    'Au plaisir de vous revoir,',
    signatureLine(centerName),
  ].join('\n');
  return applyMessageOverrides({ subject, body }, overrides, {
    prenom: prenom || 'vous',
    centre: centerName || 'votre centre',
  });
}

// Merci post-visite (déclenché par ops-jobs après la venue). Textes par défaut
// IDENTIQUES à l'historique (lib/ops-jobs.js) pour la non-régression.
// `hasReviewLink` : le bouton « avis » n'existe que si le gerant a configure sa
// fiche (overrides.reviewUrl, cf. lib/ops-jobs.js). Sans ce reglage, demander un
// avis en ligne sans donner le moyen de le laisser envoie le client se
// debrouiller : on ne demande donc que ce qu'on rend possible.
function buildPostVisitMessage({ name = '', hasReviewLink = false, centerName = '' } = {}, overrides = null) {
  const subject = 'Alors, cette partie ?';
  const chez = String(centerName || '').trim() || 'le centre';
  const body = [
    `Bonjour ${firstNameOf(name) || ''},`.trim(),
    '',
    `Merci d'être passé chez ${chez}. L'équipe espère que vous êtes reparti avec le sourire, et quelques scores à venger.`,
    '',
    ...(hasReviewLink
      ? [
        'Deux choses, et vous serez tranquille.',
        'Si tout s\'est bien passé, un avis en ligne prend trente secondes et aide vraiment, c\'est ce qui décide les familles qui hésitent encore.',
        'Si quelque chose vous a déplu, répondez plutôt à ce message. Votre retour arrive directement chez l\'équipe, qui préfère mille fois le lire que le découvrir ailleurs.',
      ]
      : [
        'Une chose, et vous serez tranquille. Si quelque chose peut être amélioré, répondez simplement à ce message. Votre retour arrive directement chez l\'équipe, qui préfère mille fois le lire que le découvrir ailleurs.',
      ]),
    '',
    'Au plaisir de vous revoir.',
  ].join('\n');
  return applyMessageOverrides({ subject, body }, overrides, {
    prenom: firstNameOf(name) || 'vous',
    nom: name || 'vous',
    centre: String(centerName || '').trim() || 'votre centre',
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
  // J+10 : avec offset 30, c'est la fenêtre historique 330-345 j.
  const offsetDays = Number.isInteger(settings.birthday_j30.offsetDays)
    ? settings.birthday_j30.offsetDays
    : 30;
  const windowStartDays = 365 - offsetDays + 10;
  const windowEndDays = 365 - offsetDays - 5;
  const centerName = (() => {
    try { return getCenter(centerId).name; } catch (error) { return ''; }
  })();
  const sender = await resolveCenterSenderIdentity(centerId, deps);
  const habillage = habillageDe(await resolveEmailDesign(centerId, deps), 'sequences');

  const candidates = await deps.query(
    `select id, name, phone, email, date::text as date
     from reservations
     where center_id = $1
       and ${simulationSqlExclusion()}
       and status != 'cancelled'
       and occasion = 'anniversaire'
       and coalesce(email, '') != ''
       and date between ($2::date - ($3 || ' days')::interval) and ($2::date - ($4 || ' days')::interval)
     order by date asc;`,
    [centerId, todayStr, String(windowStartDays), String(windowEndDays)],
  );

  // Exclusion marketing (M4) : les adresses retirees de la liste ne reçoivent
  // pas l'anniversaire J-30. Filtre au POINT D'ENFILEMENT, donc le cron filtre
  // aussi. Une requête par lot (index unique).
  const suppressed = await listSuppressedSet(centerId, candidates.rows.map((r) => r.email), deps);
  let enqueued = 0;
  const skipped = [];
  for (const row of candidates.rows) {
    if (suppressed.has(String(row.email || '').trim().toLowerCase())) { skipped.push('suppressed'); continue; }
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
    const unsub = buildUnsubscribe(centerId, row.email);
    await enqueue({
      centerId,
      reservationId: null,
      channel: 'email',
      templateId: 'birthday_j30',
      recipient: String(row.email).trim(),
      subject: message.subject,
      // Texte BRUT : emailShell fait la conversion HTML (double passe = balises visibles).
      body: emailShell({
        title: message.subject,
        body: message.body,
        preheader: message.subject,
        center: centerOrNull(centerId),
        unsubscribeLine: { text: unsub.line, url: unsub.url, label: unsub.label },
        design: habillage ? habillage.design : null,
        signature: habillage ? habillage.signature : null,
      }),
      status: 'queued',
      scheduledAt: scheduledAt.toISOString(),
      payload: {
        textBody: `${message.body}\n\n${unsub.textLine}`,
        sequence: 'birthday_j30',
        clientKey,
        clientName: row.name,
        partyDate: row.date,
        unsubToken: unsub.token,
        ...sender,
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
    try { return getCenter(centerId).name; } catch (error) { return ''; }
  })();
  const sender = await resolveCenterSenderIdentity(centerId, deps);
  const habillage = habillageDe(await resolveEmailDesign(centerId, deps), 'sequences');

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
         and ${simulationSqlExclusion()}
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

  // Exclusion marketing (M4) : filtre au point d'enfilement (le cron filtre
  // donc aussi). Une requête par lot sur l'audience candidate.
  const suppressed = await listSuppressedSet(centerId, candidates.rows.map((r) => r.email), deps);
  let enqueued = 0;
  for (const row of candidates.rows) {
    if (enqueued >= effectiveCap) break;
    if (suppressed.has(String(row.email || '').trim().toLowerCase())) continue;
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
    const unsub = buildUnsubscribe(centerId, row.email);
    await enqueue({
      centerId,
      reservationId: null,
      channel: 'email',
      templateId: 'reactivation',
      recipient: String(row.email).trim(),
      subject: message.subject,
      // Texte BRUT : emailShell fait la conversion HTML (double passe = balises visibles).
      body: emailShell({
        title: message.subject,
        body: message.body,
        preheader: message.subject,
        center: centerOrNull(centerId),
        unsubscribeLine: { text: unsub.line, url: unsub.url, label: unsub.label },
        design: habillage ? habillage.design : null,
        signature: habillage ? habillage.signature : null,
      }),
      status: 'queued',
      scheduledAt: new Date().toISOString(),
      payload: {
        textBody: `${message.body}\n\n${unsub.textLine}`,
        sequence: 'reactivation',
        clientKey: row.client_key,
        clientName: row.name,
        lastVisit: row.last_visit,
        unsubToken: unsub.token,
        ...sender,
      },
    });
    enqueued += 1;
  }
  return { ok: true, enqueued, scanned: candidates.rows.length };
}

/* ── SÉQUENCES PERSONNALISÉES : le gérant crée SES automatisations ──────────
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
  // Jour 1 à 28 : un « 30 » sauterait février en silence, on ne propose que
  // des jours qui existent TOUS les mois.
  monthly: {
    label: 'Chaque mois, un jour fixe',
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
  if (trigger.type === 'monthly') {
    const monthday = Number(trigger.monthday);
    if (!Number.isInteger(monthday) || monthday < 1 || monthday > 28) fail('Choisissez un jour du mois entre 1 et 28 (il existe tous les mois).');
    out.monthday = monthday;
  }
  let segment = null;
  if (trigger.type === 'weekly' || trigger.type === 'monthly') {
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
      fail(`Maximum ${CUSTOM_SEQUENCE_LIMITS.maxSequences} séquences personnalisées : supprimez-en une d'abord.`);
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
  // monthly : une fenêtre par mois calendaire, même logique que la semaine ISO.
  if (sequence.trigger.type === 'monthly') return todayStr.slice(0, 7);
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
         and ${simulationSqlExclusion()}
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
         and ${simulationSqlExclusion()}
         and date = ($2::date + ($3 || ' days')::interval)::date
       limit $4;`,
      [centerId, todayStr, String(days), sequence.cap * 2],
    );
  }
  // weekly et monthly : audience du segment choisi. $2 (date du jour) est
  // toujours référencé par la CTE (colonne `future`), le jeu de paramètres est
  // fixe. Le CHOIX du jour (weekday/monthday) est fait par le sweep, pas ici.
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
    try { return getCenter(centerId).name; } catch (error) { return ''; }
  })();
  const sender = await resolveCenterSenderIdentity(centerId, deps);
  const habillage = habillageDe(await resolveEmailDesign(centerId, deps), 'sequences');

  let totalEnqueued = 0;
  const details = [];
  const monthdayToday = Number(todayStr.slice(8, 10));
  for (const sequence of active) {
    if (sequence.trigger.type === 'weekly' && sequence.trigger.weekday !== weekdayToday) continue;
    if (sequence.trigger.type === 'monthly' && Number(sequence.trigger.monthday) !== monthdayToday) continue;
    let candidates;
    try {
      candidates = await findCustomSequenceCandidates(sequence, centerId, todayStr, deps);
    } catch (error) {
      details.push({ id: sequence.id, error: true });
      continue;
    }
    const periodKey = customPeriodKey(sequence, todayStr);
    // Exclusion marketing (M4) : une séquence personnalisée est du marketing.
    // Filtre au point d'enfilement, une requête par lot sur les candidats.
    const suppressed = await listSuppressedSet(centerId, (candidates.rows || []).map((r) => r.email), deps);
    let enqueued = 0;
    for (const row of candidates.rows || []) {
      if (enqueued >= sequence.cap) break;
      if (suppressed.has(String(row.email || '').trim().toLowerCase())) continue;
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
      const unsub = buildUnsubscribe(centerId, row.email);
      await enqueue({
        centerId,
        reservationId: sequence.trigger.type === 'before_visit' ? Number(row.id) || null : null,
        channel: 'email',
        templateId: `custom_${sequence.id}`,
        recipient: String(row.email).trim(),
        subject,
        body: emailShell({
          title: subject,
          body: bodyText,
          preheader: subject,
          center: centerOrNull(centerId),
          unsubscribeLine: { text: unsub.line, url: unsub.url, label: unsub.label },
          design: habillage ? habillage.design : null,
          signature: habillage ? habillage.signature : null,
        }),
        status: 'queued',
        scheduledAt: new Date().toISOString(),
        payload: {
          textBody: `${bodyText}\n\n${unsub.textLine}`,
          sequence: 'custom',
          sequenceId: sequence.id,
          sequenceName: sequence.name,
          clientKey,
          clientName: row.name || '',
          dedupeKey,
          unsubToken: unsub.token,
          ...sender,
        },
      });
      enqueued += 1;
    }
    totalEnqueued += enqueued;
    details.push({ id: sequence.id, name: sequence.name, enqueued });
  }
  return { ok: true, enqueued: totalEnqueued, sequences: active.length, details };
}

/* ── APERCU ET TEST D UNE SEQUENCE PERSONNALISEE (2026-09-16) ────────────────
   Le gerant doit voir ce que sa sequence ECRIT VRAIMENT, avec ses variables
   remplies, avant d enregistrer. Memes builders que runCustomSequencesSweep
   (applyAutomationVars, emailShell, ligne de retrait), un client d EXEMPLE
   clairement neutre (Marie Dupont, venue dans 7 jours) : l apercu ne fabrique
   ni jeton de retrait reel ni donnee client. ── */

const CLIENT_D_EXEMPLE = { prenom: 'Marie', nom: 'Dupont', email: 'apercu@example.com', heure: '15:00', pax: '6' };

function dateDExempleDansSeptJours() {
  const date = new Date(Date.now() + 7 * 86400000);
  return date.toISOString().slice(0, 10);
}

async function buildCustomSequencePreview({ centerId = 'libramont', sequence = {}, deps = defaultDeps() } = {}) {
  // La validation de la sauvegarde, a l identique : un apercu impeccable d un
  // texte que l enregistrement refusera trois secondes plus tard ne sert a rien.
  const validee = validateCustomSequence(sequence || {});
  const center = centreDuDesign(centerId);
  const centerName = String((center && center.name) || '').trim();
  const vars = {
    prenom: CLIENT_D_EXEMPLE.prenom,
    centre: centerName || 'votre centre',
    ...(validee.trigger.type === 'before_visit' ? {
      date: dateDExempleDansSeptJours(),
      heure: CLIENT_D_EXEMPLE.heure,
      formule: 'votre réservation',
      pax: CLIENT_D_EXEMPLE.pax,
    } : {}),
  };
  const subject = applyAutomationVars(validee.subject, vars);
  const bodyText = applyAutomationVars(validee.body, vars);
  // La ligne de retrait de l apercu est INERTE (`k=apercu`) : on montre qu elle
  // sera la, sans fabriquer un jeton reel.
  const unsub = buildUnsubscribe(centerId, CLIENT_D_EXEMPLE.email);
  const urlInerte = `${publicAppUrl()}/api/u?k=apercu`;
  const habillage = habillageDe(await resolveEmailDesign(centerId, deps), 'sequences');
  return {
    subject,
    html: emailShell({
      title: subject,
      body: bodyText,
      preheader: subject,
      center,
      unsubscribeLine: { text: unsub.line, url: urlInerte, label: unsub.label },
      design: habillage ? habillage.design : null,
      signature: habillage ? habillage.signature : null,
    }),
    textBody: `${bodyText}\n\n${unsub.line} ${unsub.label} : ${urlInerte}`,
    exemple: { prenom: CLIENT_D_EXEMPLE.prenom, nom: CLIENT_D_EXEMPLE.nom, date: vars.date || '' },
  };
}

// Le destinataire vient de la SESSION, jamais de la requete (meme regle que
// sendAutomationTest). Le mail rendu est l objet exact de l apercu.
async function sendCustomSequenceTest({ centerId = 'libramont', member = null, sequence = {} } = {}, deps = {}) {
  const expose = (message, statusCode = 400) => {
    const error = new Error(message);
    error.expose = true;
    error.statusCode = statusCode;
    throw error;
  };
  const recipient = String(member?.contact || '').trim();
  if (!recipient) expose('Aucune adresse email sur votre compte staff : ajoutez-la dans Réglages pour recevoir un test.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) expose('Le contact de votre compte staff n’est pas une adresse email : le test ne peut pas partir.');
  const preview = await buildCustomSequencePreview({ centerId, sequence, deps: deps.deps || defaultDeps() });
  const enqueue = deps.enqueue || createCommunication;
  const dispatch = deps.dispatch || dispatchDueCommunications;
  const sender = await resolveCenterSenderIdentity(centerId, deps.deps || defaultDeps());
  const communication = await enqueue({
    centerId,
    channel: 'email',
    templateId: 'test_custom',
    recipient,
    subject: `[TEST] ${preview.subject}`,
    body: preview.html,
    status: 'queued',
    scheduledAt: new Date().toISOString(),
    idempotencyKey: `test:custom:${member?.id || 'staff'}:${Date.now()}`,
    payload: { textBody: preview.textBody, test: true, sequence: 'custom', sequenceName: String(sequence?.name || ''), ...sender },
  });
  const result = await dispatch({ limit: 1, centerId });
  const line = (result?.results || []).find((row) => row.id === communication?.id) || {};
  return {
    recipient,
    subject: `[TEST] ${preview.subject}`,
    status: line.status || communication?.status || 'queued',
    error: line.error || '',
  };
}

/* ── APERCU ET TEST DU DESIGN (page Apparence) ──────────────────────────────
   Le brouillon de design est valide comme a l enregistrement, puis rendu par
   le VRAI emailShell sur trois messages d exemple : une confirmation (le
   builder de production sur la reservation de demonstration), une reponse
   manuelle signee par le membre connecte, une campagne avec sa ligne de
   retrait inerte. Chaque exemple suit la PORTEE de signature qui lui
   correspond : ce que l ecran montre est ce qui partira. ── */

const ECHANTILLONS_DESIGN = ['confirmation', 'reponse', 'campagne'];

async function buildDesignPreview({ centerId = 'libramont', design = null, sample = 'confirmation', member = null } = {}, deps = defaultDeps()) {
  const center = centreDuDesign(centerId);
  const stored = await resolveEmailDesign(centerId, deps);
  // Un brouillon fourni est valide strictement (les erreurs remontent au
  // gerant) ; sans brouillon, on montre le design enregistre.
  const resolu = design && typeof design === 'object' ? emailDesign.validateEmailDesign(design, center) : stored;
  const choix = ECHANTILLONS_DESIGN.includes(sample) ? sample : 'confirmation';
  if (choix === 'confirmation') {
    const message = buildDefaultMessage({ reservation: { ...PREVIEW_RESERVATION, centerId: (center && center.id) || PREVIEW_RESERVATION.centerId }, templateId: 'confirmation', channel: 'email' });
    return {
      sample: choix,
      subject: message.subject,
      html: shellFromMessage(message, center, habillageDe(resolu, 'sequences')),
    };
  }
  if (choix === 'reponse') {
    const subject = 'Re: Votre demande pour samedi';
    const body = [
      `Bonjour ${CLIENT_D_EXEMPLE.prenom},`,
      '',
      'Merci pour votre message. Oui, il reste de la place samedi : je vous propose 15 h, le temps de vous installer et de lancer tout le groupe ensemble.',
      'Dites-moi si cela vous convient, et je bloque le créneau à votre nom.',
    ].join('\n');
    return {
      sample: choix,
      subject,
      html: emailShell({
        title: subject, body, preheader: subject, center,
        design: resolu,
        signature: { enabled: Boolean(resolu.signatureScope && resolu.signatureScope.manual), person: personneDuMembre(member) },
      }),
    };
  }
  const subject = 'Une soirée bowling entre amis ?';
  const body = [
    `Bonjour ${CLIENT_D_EXEMPLE.prenom},`,
    '',
    'Les soirées rallongent : c est le moment de réserver une piste entre amis ou en famille. Réservez en ligne, on s occupe du reste.',
  ].join('\n');
  const unsub = buildUnsubscribe(centerId, CLIENT_D_EXEMPLE.email);
  return {
    sample: choix,
    subject,
    html: emailShell({
      title: subject, body, preheader: subject, center,
      unsubscribeLine: { text: unsub.line, url: `${publicAppUrl()}/api/u?k=apercu`, label: unsub.label },
      design: resolu,
      signature: { enabled: Boolean(resolu.signatureScope && resolu.signatureScope.campaigns), person: null },
    }),
  };
}

async function sendDesignTest({ centerId = 'libramont', member = null, design = null, sample = 'confirmation' } = {}, deps = {}) {
  const expose = (message, statusCode = 400) => {
    const error = new Error(message);
    error.expose = true;
    error.statusCode = statusCode;
    throw error;
  };
  const recipient = String(member?.contact || '').trim();
  if (!recipient) expose('Aucune adresse email sur votre compte staff : ajoutez-la dans Réglages pour recevoir un test.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) expose('Le contact de votre compte staff n’est pas une adresse email : le test ne peut pas partir.');
  const preview = await buildDesignPreview({ centerId, design, sample, member }, deps.deps || defaultDeps());
  const enqueue = deps.enqueue || createCommunication;
  const dispatch = deps.dispatch || dispatchDueCommunications;
  const sender = await resolveCenterSenderIdentity(centerId, deps.deps || defaultDeps());
  const communication = await enqueue({
    centerId,
    channel: 'email',
    templateId: 'test_design',
    recipient,
    subject: `[TEST] ${preview.subject}`,
    body: preview.html,
    status: 'queued',
    scheduledAt: new Date().toISOString(),
    idempotencyKey: `test:design:${member?.id || 'staff'}:${Date.now()}`,
    payload: { textBody: `Test du design (${preview.sample}) : ${preview.subject}`, test: true, sequence: 'design', sample: preview.sample, ...sender },
  });
  const result = await dispatch({ limit: 1, centerId });
  const line = (result?.results || []).find((row) => row.id === communication?.id) || {};
  return {
    recipient,
    subject: `[TEST] ${preview.subject}`,
    status: line.status || communication?.status || 'queued',
    error: line.error || '',
  };
}

module.exports = {
  buildClientMessage,
  buildCustomRequestAck,
  sendCustomRequestAck,
  buildDelayChangeMessage,
  buildMessage,
  buildEmailSamples,
  emailShell,
  // Design des mails (gabarit, accent, en-tete, pied, signature)
  resolveEmailDesign,
  saveEmailDesign,
  getEmailDesignBundle,
  getEmailDesignDefaults: emailDesign.getEmailDesignDefaults,
  validateEmailDesign: emailDesign.validateEmailDesign,
  EMAIL_DESIGN_PRESETS: emailDesign.EMAIL_DESIGN_PRESETS,
  renderSignatureHtml,
  renderSignatureText,
  buildDesignPreview,
  sendDesignTest,
  buildCustomSequencePreview,
  sendCustomSequenceTest,
  dispatchDueCommunications,
  enqueueDelayChangeCommunications,
  enqueueReservationCommunications,
  listClientMessageChannels,
  listClientMessageTemplates,
  listDelayNotificationChannels,
  normalizePhoneForSms,
  sendClientMessage,
  sendDirectEmail,
  buildDirectEmailPreview,
  enqueueCampaign,
  // Séquences automatiques + relances
  AUTOMATION_DEFAULTS,
  AUTOMATION_TEMPLATE_IDS,
  normalizeClientKey,
  getAutomationSettings,
  getAutomationDefaults,
  setAutomationSetting,
  buildAutomationPatch,
  buildAutomationPreview,
  sendAutomationTest,
  getAutomationStats,
  sendClientRelance,
  getRelanceStats,
  getClientNote,
  saveClientNote,
  buildBirthdayJ30Message,
  buildReactivationMessage,
  buildPostVisitMessage,
  resolveCenterSenderIdentity,
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
    // Exposé pour le gate de séparation (scripts/unsubscribe-separation-check.js) :
    // l'en-tête List-Unsubscribe est posé DANS sendEmail, il faut donc la vraie
    // fonction pour l'observer via un fetch mocké (assertion comportementale).
    sendEmail,
    footerBlock,
    // Design : exposes pour les gates (rendu, cloture en double, cache).
    retirerClotureEnDouble,
    habillageDe,
    personneDuMembre,
    invaliderCacheDesign,
    brandHeaderDesign,
  },
};
