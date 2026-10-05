// D OU VIENT LE CLIENT : LA SOURCE EST JUSTE, ET RIEN DE PERSONNEL NE PASSE (2026-10-05).
//   [A] chaque source se reconnait : Google Ads (gclid, gbraid, utm cpc),
//       Google naturel (referrer), Facebook / Instagram (fbclid, utm), Bing
//       Ads, TikTok, e-mail, un autre site, direct ;
//   [B] une adresse de page garde ses parametres de campagne et perd tout le
//       reste (un e-mail ou un jeton glisse dans l URL ne sort jamais) ;
//   [C] l appareil (mobile, tablette, ordinateur) ; un objet illisible ne
//       plante pas ; les longueurs sont bornees.
//   Contre-epreuve : sans le tri des parametres, [B] rougit.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const a = require(path.join(ROOT, 'lib/acquisition.js'));
let failures = 0;
function ok(c, l, d = '') { console.log(`${c ? 'ok  ' : 'FAIL'}  ${l}${d ? `  ${d}` : ''}`); if (!c) failures += 1; }
const src = (o, ua = '') => a.normaliserAcquisition({ dernier: o }, { userAgent: ua }).source;

console.log('[A] les sources');
ok(src({ gclid: 'x' }) === 'Google Ads', '[A] gclid : Google Ads');
ok(src({ gbraid: 'x' }) === 'Google Ads', '[A] gbraid (iOS) : Google Ads');
ok(src({ utm_source: 'google', utm_medium: 'cpc' }) === 'Google Ads', '[A] utm google / cpc : Google Ads');
ok(src({ referrer: 'https://www.google.be/' }) === 'Google (naturel)', '[A] referrer google : naturel');
ok(src({ fbclid: 'x' }) === 'Facebook / Instagram', '[A] fbclid : Facebook / Instagram');
ok(src({ utm_source: 'facebook', utm_medium: 'paid' }) === 'Facebook / Instagram (pub)', '[A] utm facebook paid : pub');
ok(src({ msclkid: 'x' }) === 'Bing Ads', '[A] msclkid : Bing Ads');
ok(src({ utm_medium: 'email', utm_source: 'newsletter' }) === 'E-mail', '[A] newsletter : E-mail');
ok(src({ referrer: 'https://www.tripadvisor.be/x' }) === 'Site : tripadvisor.be', '[A] un autre site se nomme');
ok(src({}) === 'Direct', '[A] rien : Direct');
console.log('[B] rien de personnel');
const n = a.normaliserAcquisition({ dernier: { landing: 'https://fungalaxy.be/x?utm_source=google&email=moi@x.be&token=abc', referrer: 'https://site.be/p?nom=Dupont' } });
ok(n.dernier.landing === 'https://fungalaxy.be/x?utm_source=google', '[B] la page garde la campagne, perd l e-mail et le jeton', n.dernier.landing);
ok(n.dernier.referrer === 'https://site.be/p', '[B] la page d avant perd ses parametres', n.dernier.referrer);
ok(a.pageSansSecret('javascript:alert(1)') === '', '[B] une adresse non web est refusee');
console.log('[C] appareil et bornes');
ok(a.appareilDe('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)') === 'mobile' && a.appareilDe('Mozilla/5.0 (iPad; CPU OS 17_0)') === 'tablette' && a.appareilDe('Mozilla/5.0 (Windows NT 10.0)') === 'ordinateur', '[C] mobile, tablette, ordinateur');
ok(a.normaliserAcquisition('n importe quoi').source === 'Direct' && a.normaliserAcquisition(null).source === 'Direct', '[C] un objet illisible : Direct, sans planter');
ok(a.normaliserAcquisition({ dernier: { utm_campaign: 'x'.repeat(900) } }).dernier.utm_campaign.length <= 150, '[C] longueurs bornees');

const source = fs.readFileSync(path.join(ROOT, 'lib/acquisition.js'), 'utf8');
const ancre = 'for (const cle of CLES_CAMPAGNE) if (u.searchParams.get(cle)) garde.set(cle, texte(u.searchParams.get(cle), 120));';
if (source.split(ancre).length !== 2) ok(false, '[contre-épreuve] ancre absente');
else {
  const f = path.join(os.tmpdir(), `acq-mute-${process.pid}.js`);
  fs.writeFileSync(f, source.replace(ancre, 'u.searchParams.forEach((v, k) => garde.set(k, v));'));
  const m = require(f); fs.unlinkSync(f);
  ok(/email=/.test(m.normaliserAcquisition({ dernier: { landing: 'https://a.be/?email=moi@x.be' } }).dernier.landing), '[contre-épreuve] sans le tri, [B] rougit (l e-mail passe)');
}
console.log('');
console.log(failures ? `acquisition-check: ${failures} FAIL` : 'acquisition-check: ALL OK (sources, rien de personnel, appareil, bornes)');
process.exit(failures ? 1 : 0);
