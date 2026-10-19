// LE TRACEUR DE LECTURES (2026-10-19) : la preuve de la selection par impact.
//
// Charge par le lanceur (node scripts/gates-lancer.js --tracer) dans chaque
// processus node d un gate (NODE_OPTIONS=--require, herite par ses fils et
// ses serveurs), il note chaque fichier du depot que le gate lit vraiment :
// require, readFile, flux servis au navigateur. scripts/gates-impactes.js
// --verifier-traces compare ensuite ces lectures a l index statique : un
// fichier lu qu il ne prevoyait pas est un trou de la selection.
// N ecrit que dans PINLANE_GATE_TRACE_FILE, n altere aucune lecture.
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

const RACINE = String(process.env.PINLANE_GATE_TRACE_ROOT || '');
const SORTIE = String(process.env.PINLANE_GATE_TRACE_FILE || '');
if (RACINE && SORTIE) {
  const racine = path.resolve(RACINE).toLowerCase() + path.sep;
  const vus = new Set();
  const ecrire = fs.appendFileSync;
  const noter = (cible) => {
    try {
      if (typeof cible !== 'string' && !(cible instanceof URL) && !Buffer.isBuffer(cible)) return;
      const absolu = path.resolve(cible instanceof URL ? cible.pathname.replace(/^\/([A-Za-z]:)/, '$1') : String(cible));
      if (!absolu.toLowerCase().startsWith(racine)) return;
      const rel = absolu.slice(racine.length).split(path.sep).join('/');
      if (vus.has(rel) || /^(?:node_modules|tmp|artifacts|tests)\//.test(rel)) return;
      vus.add(rel);
      ecrire(SORTIE, `${rel}\n`);
    } catch (error) { /* le traceur ne fait jamais tomber un gate */ }
  };
  for (const nom of ['readFileSync', 'readFile', 'createReadStream', 'openSync', 'open']) {
    const original = fs[nom];
    if (typeof original !== 'function') continue;
    fs[nom] = function traceLecture(cible, ...reste) {
      const drapeaux = nom.startsWith('open') ? reste[0] : null;
      if (!drapeaux || /^r/.test(String(drapeaux))) noter(cible);
      return original.call(this, cible, ...reste);
    };
  }
  const promesse = fs.promises && fs.promises.readFile;
  if (promesse) fs.promises.readFile = function traceLecturePromesse(cible, ...reste) { noter(cible); return promesse.call(this, cible, ...reste); };
  const compiler = Module.prototype._compile;
  Module.prototype._compile = function traceCompilation(source, fichier) { noter(fichier); return compiler.call(this, source, fichier); };
}
