// D OU VIENT LE CLIENT (2026-10-05).
//
// Movsar : « on va taffer sur le SEO, Tag Manager, SEA : regarde si on a toutes
// les infos stockees pour analyser ». On n avait RIEN : ni UTM, ni gclid, ni
// site d origine. Le formulaire (et embed.js sur le site du centre) envoie ce
// qu il voit ; ce module le borne et en deduit une SOURCE lisible (« Google
// Ads », « Google (naturel) », « Facebook / Instagram (pub) »...).
//
// Rien de personnel : des parametres de campagne, des adresses de pages sans
// leurs parametres prives, le type d appareil. Pas d adresse IP.
'use strict';

const CLES_CAMPAGNE = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid'];

function texte(v, max = 200) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

// Une adresse de page sans ses parametres (sauf ceux de campagne) : on garde
// d ou vient la visite, jamais un e-mail ou un jeton glisse dans une URL.
function pageSansSecret(url) {
  const brut = texte(url, 600);
  if (!brut) return '';
  try {
    const u = new URL(brut);
    if (!/^https?:$/.test(u.protocol)) return '';
    const garde = new URLSearchParams();
    for (const cle of CLES_CAMPAGNE) if (u.searchParams.get(cle)) garde.set(cle, texte(u.searchParams.get(cle), 120));
    const q = garde.toString();
    return `${u.origin}${u.pathname}${q ? `?${q}` : ''}`.slice(0, 300);
  } catch (error) {
    return '';
  }
}

function appareilDe(userAgent = '') {
  const ua = String(userAgent || '');
  if (/iPad|Tablet|(Android(?!.*Mobile))/i.test(ua)) return 'tablette';
  if (/Mobi|iPhone|Android/i.test(ua)) return 'mobile';
  return ua ? 'ordinateur' : '';
}

function campagneDe(src) {
  const c = {};
  for (const cle of CLES_CAMPAGNE) {
    const v = texte(src && src[cle], 150);
    if (v) c[cle] = v;
  }
  return c;
}

// LA SOURCE, en mots, pour grouper sans retraiter.
function sourceDe(c = {}, referrer = '') {
  const ref = String(referrer || '').toLowerCase();
  const src = String(c.utm_source || '').toLowerCase();
  const med = String(c.utm_medium || '').toLowerCase();
  if (c.gclid || c.gbraid || c.wbraid || (src.includes('google') && /cpc|ppc|paid|ads/.test(med))) return 'Google Ads';
  if (c.fbclid && !src) return 'Facebook / Instagram';
  if (/facebook|instagram|meta|fb|ig/.test(src)) return /cpc|paid|ads/.test(med) ? 'Facebook / Instagram (pub)' : 'Facebook / Instagram';
  if (c.msclkid) return 'Bing Ads';
  if (c.ttclid || src.includes('tiktok')) return 'TikTok';
  if (/mail|newsletter/.test(med) || /mail|newsletter/.test(src)) return 'E-mail';
  if (src) return texte(c.utm_source, 60);
  if (/google\./.test(ref)) return 'Google (naturel)';
  if (/bing\.|duckduckgo|yahoo|ecosia|qwant/.test(ref)) return 'Autre moteur de recherche';
  if (/facebook|instagram|fb\.|l\.instagram/.test(ref)) return 'Facebook / Instagram';
  if (/tiktok/.test(ref)) return 'TikTok';
  if (ref) {
    try { return `Site : ${new URL(ref).hostname.replace(/^www\./, '')}`; } catch (error) { return 'Autre site'; }
  }
  return 'Direct';
}

// UN CONTACT (premier ou dernier) : campagne + pages + source.
function contact(src = {}) {
  const c = campagneDe(src);
  const referrer = pageSansSecret(src.referrer);
  const entree = pageSansSecret(src.landing);
  const hote = pageSansSecret(src.hote);
  const at = /^\d{4}-\d{2}-\d{2}T/.test(String(src.at || '')) ? String(src.at).slice(0, 24) : '';
  return { ...c, ...(referrer ? { referrer } : {}), ...(entree ? { landing: entree } : {}), ...(hote ? { hote } : {}), ...(at ? { at } : {}), source: sourceDe(c, src.referrer) };
}

// CE QUI EST STOCKE : le premier contact (ce qui a fait connaitre le centre)
// et le dernier (ce qui a fait reserver), l appareil.
function normaliserAcquisition(brut, { userAgent = '' } = {}) {
  const b = brut && typeof brut === 'object' && !Array.isArray(brut) ? brut : {};
  const dernier = contact(b.dernier && typeof b.dernier === 'object' ? b.dernier : b);
  const premier = b.premier && typeof b.premier === 'object' ? contact(b.premier) : dernier;
  return {
    source: dernier.source,
    sourcePremiere: premier.source,
    premier,
    dernier,
    appareil: appareilDe(userAgent),
  };
}

module.exports = { CLES_CAMPAGNE, normaliserAcquisition, sourceDe, pageSansSecret, appareilDe };
