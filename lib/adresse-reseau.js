'use strict';
// UNE ADRESSE IPv6 SE COMPTE PAR SON BLOC /64 (passe securite du 2026-11-08) : un abonne
// en recoit des milliards, et changer d adresse dans son bloc remettait le compteur a
// zero. Une adresse IPv4 reste telle quelle.
//
// La regle vit ici, seule (2026-11-16) : le limiteur (lib/rate-limit.js, cleDeLAdresse) et
// l empreinte de l appareil des retenues (api/public-reservations.js) la lisent toutes les
// deux. Dans le limiteur, elle n etait pas joignable depuis les bancs qui le remplacent.
function blocDeLAdresse(ip) {
  const s = String(ip || '').trim().replace(/^::ffff:(?=\d+\.)/i, '').split('%')[0];
  if (!s.includes(':')) return s || 'unknown';
  const [tete, queue] = s.split('::');
  const debut = tete ? tete.split(':') : [];
  const fin = queue !== undefined && queue !== '' ? queue.split(':') : [];
  const manque = queue !== undefined ? Math.max(0, 8 - debut.length - fin.length) : 0;
  const groupes = [...debut, ...Array(manque).fill('0'), ...fin].slice(0, 4);
  while (groupes.length < 4) groupes.push('0');
  return `${groupes.map((g) => (g || '0').toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

module.exports = { blocDeLAdresse };
