const {
  createCommunication,
  listDueCommunications,
  updateCommunicationStatus,
} = require('./database');
const { getCenter, getFormula } = require('./ops-knowledge');
// Ciblage des messages = point de consommation analytique le plus sensible :
// une persona de simulation ne doit JAMAIS declencher un email ou un SMS reel.
const { simulationSqlExclusion } = require('./simulation-filter');
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
// casse, bouton rectangulaire encre, pied discret. Le magenta releve sur
// fungalaxy.be ne survit que dans les liens : une couleur d'accent, plus un
// decor. Zero image : le rendu est identique images bloquees ou non.
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
// ton, pas une charte graphique). Les valeurs ci-dessous ne sont PAS un choix
// d'auteur : elles sont RELEVEES sur https://www.fungalaxy.be (styles calcules).
//   - brand #944292 : magenta-violet, la couleur du bouton principal du site
//     (« DECOUVRIR FUN GALAXY »). C'est LA couleur de marque, pas une
//     interpretation. L'ancien #3B2A6B etait un violet invente, absent du site.
//   - teal  #00ACAD : accent secondaire, present dans le degrade du logo
//     (turquoise vers magenta). Utilise en filet, jamais en aplat de texte.
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
  brand: '#944292',
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
  // profond, pas un orange de notification : il tient a cote du magenta de
  // marque sans casser la palette, donne du blanc lisible en bouton (contraste
  // ~6,5:1) et reste fonce, donc il survit a l'inversion comme le magenta.
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
    return `<a href="${escapeHtml(href)}" style="color:${EMAIL_THEME.brand};font-weight:600;">${label}</a>`;
  });
  s = s.replace(/\*\*([^*\n]{1,300}?)\*\*/g, '<strong>$1</strong>');
  // L'italique exige un non-mot de chaque cote : un identifiant snake_case ne
  // doit jamais se transformer.
  s = s.replace(/(^|[^\w&])_([^_\n]{1,300}?)_(?=$|[^\w])/g, '$1<em>$2</em>');
  return s;
}

function textToHtml(text = '', { size = 16, color = EMAIL_THEME.ink } = {}) {
  const style = `margin:0 0 14px;font-family:${EMAIL_THEME.font};font-size:${size}px;line-height:1.65;color:${color};`;
  const liStyle = `margin:0 0 8px;font-family:${EMAIL_THEME.font};font-size:${size}px;line-height:1.5;color:${color};`;
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
function detailRows(details = []) {
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
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;margin:26px 0 4px;background:${EMAIL_THEME.panel};border:1px solid ${EMAIL_THEME.border};border-radius:12px;">
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
function actionButton(action, accent = EMAIL_THEME.brand) {
  const href = safeUrl(action?.href || '');
  const label = String(action?.label || '').trim();
  if (!href || !label) return '';
  // Bouton PRO (2026-08-06) : rectangle encre, bas de casse, rayon discret. La
  // pilule magenta en capitales lisait « animation commerciale » ; un recu
  // serieux appuie sur un bouton sobre. L'accent ne colore le bouton que
  // lorsqu'un appelant STAFF le passe explicitement (alerte ambre).
  const bg = accent === EMAIL_THEME.brand ? EMAIL_THEME.ink : accent;
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
function footerBlock({ footer, center, replyLine, unsubscribeLine = '' }) {
  const info = center?.publicInfo || {};
  const lines = [];
  const centerName = String(center?.name || '').trim();
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
  if (place) lines.push(escapeHtml(place));
  const contact = [info.phone ? `Tel. ${info.phone}` : '', info.email || ''].filter(Boolean).join('  ·  ');
  if (contact) lines.push(escapeHtml(contact));
  const custom = String(footer || '').trim();
  if (custom) lines.push(escapeHtml(custom));
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

// Signature conservee a l'octet pres pour les 13 templates appelants
// (title, body, footer, preheader, details, action, note). Les champs ajoutes
// (center, eyebrow, replyLine) sont OPTIONNELS : un appelant qui les ignore
// obtient exactement le meme rendu qu'avant, en mieux habille.
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
  // Couleur d'accent (eyebrow + bouton). Defaut = violet de marque, cote
  // client. Les mails STAFF passent l'ambre : un « ALERTE TERRAIN » ne peut pas
  // avoir la meme temperature qu'un « RESERVATION CONFIRMEE » dans une boite.
  accent = EMAIL_THEME.brand,
  // Ligne de retrait, campagnes marketing UNIQUEMENT.
  unsubscribeLine = '',
}) {
  // Le preheader est le texte d'apercu en boite de reception : c'est lui qui
  // decide de l'ouverture. Les caracteres invisibles qui suivent empechent le
  // client mail de completer l'apercu avec le debut du corps (« Bonjour
  // Marie, » en apercu = une ligne gachee).
  const preheaderHtml = preheader
    ? `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;color:transparent;font-size:1px;line-height:1px;">${escapeHtml(preheader)}${'&#8203;&nbsp;'.repeat(60)}</div>`
    : '';

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
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
  <body style="margin:0;padding:0;width:100%;background:${EMAIL_THEME.paper};font-family:${EMAIL_THEME.font};color:${EMAIL_THEME.ink};-webkit-font-smoothing:antialiased;">
    ${preheaderHtml}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${EMAIL_THEME.paper}" style="border-collapse:collapse;background:${EMAIL_THEME.paper};">
      <tr>
        <td align="center" style="padding:32px 16px 40px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;max-width:600px;">
            <tr>
              <td bgcolor="${EMAIL_THEME.card}" style="background:${EMAIL_THEME.card};border:1px solid ${EMAIL_THEME.border};border-radius:12px;overflow:hidden;padding:0;">
                ${brandHeader(center)}
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                  <tr>
                    <td style="padding:26px 28px 30px;">
                ${eyebrow ? `<p style="margin:0 0 10px;font-family:${EMAIL_THEME.font};font-size:11px;line-height:1.3;letter-spacing:1px;font-weight:700;color:${accent === EMAIL_THEME.brand ? EMAIL_THEME.inkSoft : accent};text-transform:uppercase;">${escapeHtml(eyebrow)}</p>` : ''}
                <h1 class="fg-h1" style="margin:0 0 16px;font-family:${EMAIL_THEME.font};font-size:20px;line-height:1.3;font-weight:700;letter-spacing:-0.2px;color:${EMAIL_THEME.ink};">${escapeHtml(title)}</h1>
                ${textToHtml(body)}
                ${detailRows(details)}
                ${actionButton(action, accent)}
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
              <td>${footerBlock({ footer, center, replyLine, unsubscribeLine })}</td>
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

function shellFromMessage(message, center = null) {
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
  });
}

function buildMessage({ reservation, templateId, channel, overrides = null }) {
  const base = buildDefaultMessage({ reservation, templateId, channel });
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
      body: `${center.name}: petit rappel pour ${reservation.name}. Réservation ${reservation.date} à ${reservation.startTime}. Merci d'arriver ${lead} avant. Si vous avez du retard, prévenez le centre.`,
    };
  }

  // ── Famille STAFF ────────────────────────────────────────────────────────
  // Ces messages ne partent PAS au client. Le staff lit son mail entre deux
  // groupes, souvent debout : l'objet doit contenir la decision a prendre et
  // les faits chiffres, le corps tient en trois lignes, la carte de details
  // porte le reste. Aucune formule commerciale, aucun « nous avons le plaisir ».
  if (templateId === 'staff_review_request') {
    const blockingLabels = (reservation.opsPlan?.conflicts || [])
      .filter((conflict) => conflict.severity === 'blocking')
      .map((conflict) => conflict.label || conflict.message)
      .filter(Boolean);
    const reason = blockingLabels.length
      ? `Motif : ${blockingLabels.join(' ; ')}.`
      : (reservation.planWarning
        ? `Motif : ${reservation.planWarning}`
        : 'Motif : aucun créneau automatique assez sûr pour cette demande. À caler à la main (pistes, laser ou tables) avant de confirmer.');
    return {
      subject: `À valider : ${offer}, ${reservation.pax} pers., ${formatDateFr(reservation.date)} ${reservation.startTime}`,
      title: 'Une réservation attend ta validation',
      eyebrow: 'Action staff requise',
      body: [
        // « La demande de X » plutot que « X ne peut pas etre confirme » :
        // evite l'accord de genre sur un prenom qu'on ne connait pas.
        `La demande de ${reservation.name} ne peut pas être placée automatiquement.`,
        '',
        reason,
        '',
        reservation.opsPlan?.staffSummary || 'Vérifie les pistes, le laser, les tables et les marges, puis confirme ou propose un autre créneau.',
        '',
        'Tant que personne ne tranche, le client reste en attente : il a reçu un accusé de réception, pas une confirmation.',
      ].join('\n'),
      preheader: `${reservation.name}, ${reservation.pax} pers., ${formatDateFr(reservation.date)} à ${reservation.startTime}. Placement automatique impossible.`,
      details: [
        { label: 'Client', value: reservation.name },
        { label: 'Date', value: `${formatDateFr(reservation.date)} à ${reservation.startTime}` },
        { label: 'Participants', value: `${reservation.pax}` },
        { label: 'Offre', value: offer },
        // `riskLevel` est une enum interne (low/medium/high/critical) : elle ne
        // sort JAMAIS telle quelle dans un mail, meme staff.
        { label: 'Risque', value: `${riskLabelFr(reservation.riskLevel)}${reservation.riskScore !== null && reservation.riskScore !== undefined ? ` (${reservation.riskScore}/100)` : ''}` },
      ],
      // « Ouvrir le cockpit direction » : 27 caracteres en capitales, la pilule
      // passait de 314x48 sur une ligne en desktop a 300x66 sur DEUX lignes a
      // 390px, seule de son espece sur les cinq boutons du gabarit. « Direction »
      // ne dit rien de plus ici : ce mail ne part qu'au staff, et le lien mene
      // au cockpit, il n'y en a pas d'autre. Le libelle raccourci tient sur une
      // ligne aux deux largeurs (mesure). Les libelles CLIENT ne bougent pas.
      action: { href: `${publicAppUrl()}/direction.html`, label: 'Ouvrir le cockpit' },
      replyLine: '',
      accent: EMAIL_THEME.alert,
      note: '',
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
      accent: EMAIL_THEME.alert,
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
      title: 'Un petit décalage sur votre horaire',
      eyebrow: 'Changement d\'horaire',
      body: [
        `Bonjour ${clientName},`,
        '',
        // Meme raison qu'a la confirmation : `offer` vaut "votre formule" en
        // repli, ce qui donnait "Votre réservation votre formule du ...".
        `Votre réservation du ${longDate} reste confirmée, on vous prévient juste d'un décalage${delayMinutes ? ` de ${delayMinutes} minutes` : ''}.`,
        previousStartTime && proposedStartTime
          ? `Vous étiez attendu à ${previousStartTime}, ce sera finalement ${proposedStartTime}.`
          : proposedStartTime ? `Le nouvel horaire retenu est ${proposedStartTime}.` : '',
        `La raison : ${reasonLabel}.`,
        '',
        'On préfère vous le dire maintenant plutôt que vous faire patienter sur place. Tout le reste de votre programme ne bouge pas.',
        'Si ce nouvel horaire ne vous arrange pas, répondez à ce message ou appelez-nous, on vous trouve autre chose.',
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
      note: 'Ce décalage a été validé par notre équipe avant de vous être envoyé. Rien à payer d\'avance : tout se règle sur place.',
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
      subject: `C'est ${longDate} : tout est prêt pour vous`,
      title: 'On y est presque',
      eyebrow: 'Votre venue approche',
      body: [
        `Bonjour ${clientName},`,
        '',
        `Petit mot avant ${longDate} : on vous attend à ${reservation.startTime} chez ${center.name}, et tout est déjà bloqué à votre nom.`,
        isFormula
          ? `Le seul service à nous rendre : arriver avec tout le groupe ${lead} minutes avant. C'est ce qui nous permet de vous lancer ensemble, surtout quand il y a du Laser Game dans la formule.`
          : `Arrivez ${lead} minutes avant l'heure prévue, on vous installe tranquillement.`,
        laserSentence,
        '',
        'On a hâte de vous voir.',
      ].filter(Boolean).join('\n'),
      preheader: `${longDate} à ${reservation.startTime}, ${center.name}. Arrivez ${lead} minutes avant.`,
      details: [
        { label: 'Date', value: longDate },
        { label: 'Heure', value: reservation.startTime },
        { label: 'Participants', value: `${reservation.pax}` },
        { label: 'Offre', value: offer },
      ],
      note: isFormula
        ? "Un imprévu, un retard ? Appelez-nous plutôt que de courir : on réorganise l'ordre des activités et vous ne perdez rien."
        : 'Un imprévu, un retard ? Appelez-nous, on ajuste avec vous.',
    };
  }

  if (templateId === 'request_received') {
    return {
      subject: `On a votre demande pour ${longDate}`,
      title: 'Votre demande est bien arrivée',
      eyebrow: 'Demande reçue',
      body: [
        `Bonjour ${clientName},`,
        '',
        `Votre demande pour ${offer} est bien chez nous, et elle est déjà entre les mains de l'équipe de ${center.name}.`,
        "Avant de vous confirmer, on cale l'enchaînement des activités pour votre groupe. C'est ce qui fait la différence entre une visite fluide et une visite passée à attendre, alors on prend le temps de le faire correctement.",
        '',
        arrivalTime
          ? `On revient vers vous dès que c'est bouclé. Notez déjà une arrivée ${arrivalLead} minutes avant ${arrivalTime}.`
          : `On revient vers vous dès que c'est bouclé, avec l'heure exacte et ${arrivalLead} minutes d'avance à prévoir.`,
      ].filter(Boolean).join('\n'),
      preheader: `${offer}, ${reservation.pax} personnes, ${longDate}. On vérifie le planning et on revient vers vous.`,
      details: [
        { label: 'Centre', value: center.name },
        { label: 'Date', value: longDate },
        { label: 'Heure souhaitée', value: reservation.startTime },
        { label: 'Participants', value: `${reservation.pax}` },
        { label: 'Offre', value: offer },
      ],
      note: "Ce message accuse réception de votre demande, ce n'est pas encore une confirmation. Vous recevrez un second mail dès que votre créneau est bloqué.",
    };
  }

  return {
    subject: `C'est confirmé : on vous attend ${longDate}`,
    title: `On vous attend ${longDate}`,
    eyebrow: 'Réservation confirmée',
    body: [
      `Bonjour ${clientName},`,
      '',
      // Accord invariable volontaire : `offer` peut etre masculin (bowling,
      // Laser Game) ou feminin (FORMULE 4), et vaut meme "votre formule" en
      // repli (ligne 591). Toute tournure qui accorde sur `offer` produit
      // "votre bowling est confirmée". L'offre est de toute facon rappelee
      // dans la carte de details ({ label: 'Offre' }), donc on ne la repete pas.
      `C'est officiel : votre réservation est confirmée chez ${center.name}, à votre nom.`,
      arrivalTime
        ? `Rendez-vous à ${arrivalTime}. Arrivez ${arrivalLead} minutes avant : le temps de vous accueillir et de lancer tout le groupe ensemble.`
        : `Arrivez ${arrivalLead} minutes avant l'heure prévue, le temps de vous accueillir et de lancer tout le groupe ensemble.`,
      opsPlanSentence,
      ...buildFormulaEngagementLines(reservation),
      laserSentence,
      '',
      "Rien à payer d'avance : le montant se règle sur place le jour même.",
      "Il ne vous reste plus qu'à venir.",
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
    note: reservation.type === 'formule'
      ? "Vos rendez-vous (bowling, laser) sont calés à l'heure. Le reste de la formule se vit à votre rythme sur place, sans horaire imposé."
      // La queue « <date>, on note. » ne voulait rien dire et recollait une date
      // NUMERIQUE dans un mail ou la date est deja ecrite en toutes lettres.
      : "Un empêchement, un retard ? Un mot ou un appel et on s'adapte.",
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
        body: shellFromMessage(message, messageCenter),
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
    if (wantsTemplate('reminder_48h') && automation.reminder_48h?.enabled !== false && isFuture(reminderAt, 5)) {
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
        body: shellFromMessage(reminder, messageCenter),
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

  if (staffEmail && validationMode === 'staff_review' && wantsTemplate('staff_review_request')) {
    const message = buildMessage({ reservation, templateId: 'staff_review_request', channel: 'email' });
    created.push(enqueue({
      centerId,
      reservationId,
      channel: 'email',
      templateId: 'staff_review_request',
      recipient: staffEmail,
      subject: message.subject,
      body: shellFromMessage(message, messageCenter),
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
    ? `Vous jouerez sur la piste ${change.newLanes.join(', ')} au lieu de la piste ${(change.previousLanes || []).join(', ') || 'prévue'}. Rien ne change pour vous, c'est juste l'autre bout du bowling.`
    : '';
  const shiftSentence = Number(change.shiftMinutes || 0) > 0
    ? `Vous étiez attendu à ${change.previousStartTime}, ce sera finalement ${change.newStartTime}, soit ${change.shiftMinutes} minutes plus tard.`
    : (change.moves || []).length
      ? `Le programme bouge un peu : ${change.moves.map((move) => `${move.label} passe de ${move.previousStartTime} à ${move.newStartTime}`).join(' · ')}.`
      : '';

  if (channel === 'sms') {
    return {
      subject: '',
      body: `${center.name}: petit ajustement pour ${reservation.name}. ${shiftSentence || laneChangeSentence} Votre réservation reste confirmée. En cas de souci, contactez le centre.`,
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
        ? `On décale votre venue de ${longDate} à ${change.newStartTime}`
        : `Une petite adaptation pour votre venue de ${longDate}`;

  return {
    subject,
    title: 'Un ajustement sur votre venue',
    eyebrow: 'Mise à jour du planning',
    body: [
      `Bonjour ${clientName},`,
      '',
      `Votre réservation ${offer} du ${longDate} chez ${center.name} reste bien confirmée. On vous prévient simplement d'un ajustement de planning.`,
      shiftSentence,
      laneChangeSentence,
      '',
      "On préfère vous prévenir maintenant plutôt que vous laisser le découvrir sur place. Le reste de votre programme ne bouge pas d'un pouce.",
      'Si ça ne vous arrange pas, répondez à ce message ou appelez-nous : on trouve une solution avec vous.',
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
    note: 'Cet ajustement a été validé par notre équipe avant de vous être envoyé. Rien à payer d\'avance : tout se règle sur place.',
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
          ? emailShell({ title: finalSubject, body: finalBody, preheader: message.preheader, center: delayCenter })
          : shellFromMessage(message, delayCenter))
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
function replyToAddress(communication) {
  const candidates = [
    communication.payload?.replyTo,
    communication.payload?.fromEmail,
    process.env.RESEND_REPLY_TO,
    process.env.STAFF_REVIEW_EMAIL,
    process.env.RESERVATION_STAFF_EMAIL,
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
    return { skipped: true, reason: 'Adresse de test non routable (RFC 2606) : rien envoyé.' };
  }

  // Identité d'expéditeur par communication (studio mails). L'adresse doit
  // être vérifiée côté Resend ; tant qu'aucune identité n'est configurée,
  // fallback sur l'expéditeur plateforme.
  const payloadFrom = String(communication.payload?.fromEmail || '').trim();
  const payloadLabel = String(communication.payload?.fromLabel || '').trim();
  const configuredFrom = payloadFrom || process.env.RESEND_FROM || 'onboarding@resend.dev';
  // Le NOM affiche : l'identite choisie pour ce message, sinon le nom du CENTRE
  // qui envoie. 'Fun Galaxy' etait ecrit en dur ici : le client d'un deuxieme
  // centre recevait un mail signe du nom du premier.
  const centerLabel = centerOrNull(communication.centerId)?.name || 'Pinlane';
  const from = configuredFrom.includes('<')
    ? configuredFrom
    : `${payloadLabel || centerLabel} <${configuredFrom}>`;
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
            'List-Unsubscribe': `<${unsubscribeUrl(communication.payload.unsubToken)}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }
        : {}),
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
        `C’est confirmé pour ${v.offer} le ${v.date} à ${v.startTime}${v.pax ? ` pour ${v.pax} personne(s)` : ''}.`,
        'Merci d’arriver une dizaine de minutes avant l’heure prévue pour un lancement fluide.',
        'Le paiement se fait sur place.',
        '',
        'À très vite,',
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
        `On vous attend le ${v.date} à ${v.startTime} pour ${v.offer}.`,
        'Si possible, venez une dizaine de minutes avant l’heure prévue.',
        'En cas de retard, appelez-nous : on ajuste le planning avec vous.',
        '',
        'À très vite,',
        v.centerName,
      ].join('\n'),
    }),
    sms: (v) => `${v.centerName}: rappel, on vous attend le ${v.date} a ${v.startTime}. Merci d'arriver 10 min avant. En cas de retard, appelez le centre.`,
  },
  {
    id: 'delay',
    label: 'Retard / attente',
    category: 'Le jour J',
    description: 'Prévenir d’un léger retard côté centre.',
    email: (v) => ({
      subject: `Petit ajustement de votre réservation ${v.centerName}`,
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
    sms: (v) => `${v.centerName}: petit decalage sur votre reservation du ${v.date}. Elle reste confirmee, l'equipe vous accueille des l'arrivee. Merci de votre comprehension.`,
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
        `Nous devons ajuster l’horaire de votre réservation ${v.offer} du ${v.date} (initialement ${v.startTime}).`,
        'Pourriez-vous nous confirmer si le nouvel horaire proposé vous convient ? Nous restons flexibles pour trouver le meilleur créneau.',
        'Répondez simplement à ce message ou appelez-nous.',
        '',
        'Merci beaucoup,',
        v.centerName,
      ].join('\n'),
    }),
    sms: (v) => `${v.centerName}: nous devons ajuster l'horaire de votre reservation du ${v.date} (${v.startTime}). Merci de nous rappeler pour valider un nouveau creneau.`,
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
        `Nous sommes au regret de devoir annuler votre réservation ${v.offer} du ${v.date} à ${v.startTime}.`,
        'Nous en sommes sincèrement désolés et serions ravis de vous retrouver sur un prochain créneau : contactez-nous, on vous trouve la meilleure date.',
        '',
        'Avec toutes nos excuses,',
        v.centerName,
      ].join('\n'),
    }),
    sms: (v) => `${v.centerName}: nous devons annuler votre reservation du ${v.date} a ${v.startTime}. Toutes nos excuses. Contactez-nous pour reprogrammer.`,
  },
  {
    id: 'thanks',
    label: 'Remerciement post-visite',
    category: 'Après venue',
    description: 'Remercier après la visite et inviter au retour.',
    email: (v) => ({
      subject: 'Merci d\'être passés nous voir',
      body: [
        `Bonjour ${v.clientName},`,
        '',
        `Merci d'être venus chez ${v.centerName}. On espère que vous avez passé un bon moment et qu'il reste quelques revanches à jouer.`,
        // La demande d'avis en ligne a ete RETIREE d'ici. Ce message est envoye
        // a la main par le staff depuis une fiche resa : il n'a pas de jeton de
        // redirection, donc pas de bouton « Laisser un avis Google », donc il
        // demandait une action sans donner le moyen de la faire. La demande
        // d'avis vit dans « Merci post-visite » (buildPostVisitMessage), qui a
        // le bouton tracke. Une seule demande d'avis, un seul chemin.
        'Et si quelque chose n\'allait pas, dites-le nous en répondant à ce message. On préfère le savoir.',
        '',
        'Au plaisir de vous revoir,',
        v.centerName,
      ].join('\n'),
    }),
    sms: (v) => `${v.centerName}: merci pour votre visite ${v.firstName} ! On espere que vous vous etes bien amuses. A tres vite !`,
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
        'À très vite,',
        v.centerName,
      ].join('\n'),
    }),
    sms: (v) => `${v.centerName}: rendez-vous le ${v.date} a ${v.startTime}. Parking sur place, merci d'arriver 10 min avant. A tres vite !`,
  },
  {
    id: 'promo',
    label: 'Offre / promo',
    category: 'Fidélisation',
    description: 'Partager une offre commerciale.',
    email: (v) => ({
      subject: `Une offre rien que pour vous chez ${v.centerName}`,
      body: [
        `Bonjour ${v.clientName},`,
        '',
        'On a une petite attention pour vous : profitez de notre offre du moment lors de votre prochaine visite.',
        'Réservez dès maintenant en ligne ou répondez à ce message, on s’occupe de tout.',
        '',
        'À très vite,',
        v.centerName,
      ].join('\n'),
    }),
    sms: (v) => `${v.centerName}: une offre rien que pour vous sur votre prochaine visite ! Reservez en ligne. A tres vite !`,
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
      ? emailShell({ title: finalSubject, body: finalBody, preheader: finalSubject, center: centerOrNull(resolvedCenterId) })
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
// les messages client (communication en file + dispatch immédiat) : historique
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
    body: emailShell({ title: finalSubject, body: finalBody, preheader: finalSubject, center: centerOrNull(centerId) }),
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

// Aperçu d'un mail libre du composeur : EXACTEMENT le même habillage que
// l'envoi (emailShell + textToHtml), sans rien écrire nulle part. C'est ce qui
// rend l'aperçu honnête : même chemin de rendu que le vrai départ.
function buildDirectEmailPreview({ centerId = 'libramont', subject = '', body = '' } = {}) {
  const finalSubject = String(subject || '').trim() || 'Aperçu du message';
  return {
    subject: finalSubject,
    html: emailShell({ title: finalSubject, body: String(body || ''), preheader: finalSubject, center: centerOrNull(centerId) }),
  };
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
  const subject = 'On a bien reçu votre projet';
  const body = [
    `Bonjour ${firstName},`,
    '',
    "Votre demande sur mesure est bien arrivée chez nous. Privatisation, formule taillée pour votre groupe, devis entreprise : quelqu'un de l'équipe la reprend et vous recontacte pour en parler de vive voix.",
    request.message ? `\nCe que vous nous avez écrit : « ${String(request.message).slice(0, 500)} »` : '',
    '',
    "En attendant, si un détail vous revient, répondez simplement à ce message : ça atterrit dans le même dossier.",
  ].filter((line) => line !== null).join('\n');

  const html = emailShell({
    title: 'On a bien reçu votre projet',
    eyebrow: 'Demande sur mesure',
    body,
    preheader: "Un membre de l'équipe reprend votre demande et vous recontacte pour en parler.",
    details,
    note: "Cet email accuse réception de votre demande. Ce n'est pas encore une réservation confirmée.",
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
    subject: 'On a bien reçu votre demande',
    body: [
      'Bonjour {{nom}},',
      '',
      'Votre demande pour {{formule}} le {{date}} est bien arrivée chez nous.',
      'On cale l’enchaînement des activités pour votre groupe avant de vous confirmer : c’est ce qui fait la différence entre une visite fluide et une visite passée à attendre.',
      '',
      'On revient vers vous dès que c’est bouclé.',
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
    subject: 'Petit rappel pour votre réservation {{centre}}',
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
    subject: 'Merci pour votre visite chez {{centre}}',
    body: [
      'Bonjour {{nom}},',
      '',
      'Merci d’être venu chez {{centre}}.',
      'Si tout s’est bien passé, on sera ravi de vous revoir pour une prochaine session.',
      'Si quelque chose peut être amélioré, répondez simplement à ce message : votre retour arrive directement à l’équipe.',
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
      'L’année dernière (le {{date_fete}}), vous avez fêté un anniversaire chez nous, et on espère que c’était une belle journée.',
      'La date approche à nouveau : si vous voulez remettre ça, réservez tôt, on vous garde la table et on prépare tout.',
      '',
      'Répondez à ce message ou réservez en ligne, c’est le plus simple.',
      '',
      'À très vite,',
      'L’équipe {{centre}}',
    ].join('\n'),
    offsetDays: 30,
    offsetRange: [15, 60],
    offsetLabel: 'jours avant la date d’anniversaire',
    variables: ['prenom', 'date_fete', 'centre'],
  },
  reactivation: {
    subject: 'Ça fait un moment, on vous a gardé une place',
    body: [
      'Bonjour {{prenom}},',
      '',
      'Ça fait quelques mois qu’on ne vous a pas vus au centre. Le bowling, le laser game et les nouveautés vous attendent, en famille ou entre amis.',
      'Réservez en ligne quand vous voulez : c’est le plus rapide.',
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
  return { query: (text, params) => getPool().query(text, params) };
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
    html: shellFromMessage(message, center),
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
    payload: { textBody: preview.textBody, test: true, sequence: key },
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
    `L'année dernière${partyDateFr ? ` (le ${partyDateFr})` : ''}, vous avez fêté un anniversaire chez nous, et on espère que c'était une belle journée.`,
    'La date approche à nouveau : si vous voulez remettre ça, réservez tôt, on vous garde la table et on prépare tout.',
    '',
    'Répondez à ce message ou réservez en ligne, c\'est le plus simple.',
    '',
    'À très vite,',
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
  const subject = 'Ça fait un moment : on vous a gardé une place';
  const body = [
    `Bonjour ${prenom},`,
    '',
    'Ça fait quelques mois qu\'on ne vous a pas vus au centre. Le bowling, le laser game et les nouveautés vous attendent, en famille ou entre amis.',
    'Réservez en ligne quand vous voulez : c\'est le plus rapide.',
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
  const chez = String(centerName || '').trim() || 'nous';
  const body = [
    `Bonjour ${firstNameOf(name) || ''},`.trim(),
    '',
    `Merci d'être passé chez ${chez}. On espère que vous êtes reparti avec le sourire, et quelques scores à venger.`,
    '',
    ...(hasReviewLink
      ? [
        'Deux choses, et on vous laisse tranquille.',
        'Si tout s\'est bien passé, un avis en ligne prend trente secondes et nous aide vraiment : c\'est ce qui décide les familles qui hésitent encore.',
        'Si quelque chose vous a déplu, répondez plutôt à ce message. Votre retour arrive directement chez nous, et on préfère mille fois le lire que le découvrir ailleurs.',
      ]
      : [
        'Une chose, et on vous laisse tranquille : si quelque chose peut être amélioré, répondez simplement à ce message. Votre retour arrive directement chez nous, et on préfère mille fois le lire que le découvrir ailleurs.',
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
  buildDirectEmailPreview,
  enqueueCampaign,
  // Séquences automatiques + relances
  AUTOMATION_DEFAULTS,
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
  },
};
