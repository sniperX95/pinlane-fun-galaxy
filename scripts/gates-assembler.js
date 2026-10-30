// LE BILAN D UNE SUITE JOUEE EN PARTS (2026-10-30, le workflow GitHub).
//
// Chaque machine du workflow joue sa part (gates-lancer.js --partie K/N) et
// laisse son bilan.json. Celui-ci les rassemble en un seul bilan, script par
// script : un script dont les unites sont tombees dans deux parts est rendu
// entier, son etat est le pire de ses unites. Il rougit aussi quand une part
// n a rendu AUCUN bilan : une machine tombee (delai, plantage, annulation) ne
// passe pas pour une part verte.
//
// Usage : node scripts/gates-assembler.js <dossier des bilans> --parts N [--sortie <dossier>]
// Sortie 1 si un rouge ou une part sans bilan. Avec GITHUB_STEP_SUMMARY, le
// bilan s ecrit aussi dans le resume du workflow.
'use strict';
const fs = require('fs');
const path = require('path');

const ORDRE = ['ROUGE', 'INSTABLE', 'SAUTE', 'VERT'];

function duree(ms) {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
}

function trouverBilans(dossier) {
  const trouves = [];
  const parcourir = (d) => {
    let entrees = [];
    try { entrees = fs.readdirSync(d, { withFileTypes: true }); } catch (error) { return; }
    for (const e of entrees) {
      const chemin = path.join(d, e.name);
      if (e.isDirectory()) parcourir(chemin);
      else if (e.name === 'bilan.json') trouves.push(chemin);
    }
  };
  parcourir(dossier);
  return trouves.sort();
}

function etatDuScript(unites) {
  const etats = unites.map((u) => u.etat);
  if (etats.includes('ROUGE')) return 'ROUGE';
  if (etats.length && etats.every((e) => e === 'SAUTE')) return 'SAUTE';
  return etats.includes('INSTABLE') ? 'INSTABLE' : 'VERT';
}

// bilans : [{ partie: 'K/N', msMur, scripts: [{ nom, unites: [...] }] }]
function assembler(bilans, attendues) {
  const parScript = new Map();
  for (const b of bilans) {
    for (const s of b.scripts || []) {
      const e = parScript.get(s.nom) || { nom: s.nom, unites: [] };
      e.unites.push(...(s.unites || []).map((u) => ({ ...u, partie: b.partie || null })));
      parScript.set(s.nom, e);
    }
  }
  const scripts = [...parScript.values()].map((s) => ({ ...s, etat: etatDuScript(s.unites), ms: s.unites.reduce((t, u) => t + (u.ms || 0), 0) }));
  const vues = new Set(bilans.map((b) => b.partie).filter(Boolean));
  const manquantes = [];
  for (let k = 1; k <= attendues; k += 1) if (!vues.has(`${k}/${attendues}`)) manquantes.push(`${k}/${attendues}`);
  const compte = (etat) => scripts.filter((s) => s.etat === etat).length;
  return {
    scripts,
    manquantes,
    rouges: compte('ROUGE'),
    instables: compte('INSTABLE'),
    sautes: compte('SAUTE'),
    verts: compte('VERT'),
    unites: scripts.reduce((t, s) => t + s.unites.length, 0),
    msMur: Math.max(0, ...bilans.map((b) => b.msMur || 0)),
    msSomme: scripts.reduce((t, s) => t + s.ms, 0),
  };
}

function texteDuBilan(a, attendues) {
  const lignes = [];
  for (const s of [...a.scripts].sort((x, y) => ORDRE.indexOf(x.etat) - ORDRE.indexOf(y.etat) || y.ms - x.ms)) {
    lignes.push(`${s.etat.padEnd(8)} ${s.nom.padEnd(40)} ${duree(s.ms).padStart(10)}`);
    for (const u of s.unites) {
      if (u.etat === 'SAUTE') lignes.push(`         ${u.commande} : SAUTE ${u.raison || ''}`);
      if (u.etat === 'ROUGE' || u.etat === 'INSTABLE') {
        lignes.push(`         ${u.commande} : code ${u.code}${u.etat === 'INSTABLE' ? ' puis vert au second tour' : ''}  (part ${u.partie})`);
        (u.fails && u.fails.length ? u.fails : (u.fin || []).map((l) => `| ${l}`)).forEach((l) => lignes.push(`           ${String(l).slice(0, 220)}`));
      }
    }
  }
  for (const p of a.manquantes) lignes.push(`ROUGE    part ${p} : aucun bilan (machine tombee, delai ou annulation)`);
  const resume = `BILAN ASSEMBLE ${a.scripts.length} scripts (${a.unites} unites) en ${attendues} parts : ${a.verts} verts, ${a.rouges} rouges, ${a.sautes} sautes${a.instables ? `, ${a.instables} instables` : ''}${a.manquantes.length ? `, ${a.manquantes.length} parts sans bilan` : ''} ; la plus longue part ${duree(a.msMur)}, somme des unites ${duree(a.msSomme)}`;
  lignes.push('', resume);
  return { texte: lignes.join('\n'), resume };
}

function resumeMarkdown(a, resume) {
  const lignes = [`### ${a.rouges || a.manquantes.length ? 'Rouge' : 'Vert'} : ${resume}`, ''];
  const aDire = a.scripts.filter((s) => s.etat === 'ROUGE' || s.etat === 'INSTABLE');
  if (aDire.length || a.manquantes.length) {
    lignes.push('| Etat | Script | Part | Premiere ligne en echec |', '|---|---|---|---|');
    for (const s of aDire) {
      for (const u of s.unites.filter((x) => x.etat === 'ROUGE' || x.etat === 'INSTABLE')) {
        const premiere = (u.fails && u.fails[0]) || (u.fin && u.fin[u.fin.length - 1]) || '';
        lignes.push(`| ${u.etat} | \`${u.commande}\` | ${u.partie} | ${String(premiere).replace(/\|/g, '/').slice(0, 160)} |`);
      }
    }
    for (const p of a.manquantes) lignes.push(`| ROUGE | (part entiere) | ${p} | aucun bilan |`);
  }
  return `${lignes.join('\n')}\n`;
}

function principal() {
  const args = process.argv.slice(2);
  const option = (nom) => { const i = args.indexOf(nom); return i >= 0 ? args[i + 1] : undefined; };
  const dossier = args.find((x, i) => !x.startsWith('--') && !/^--/.test(args[i - 1] || ''));
  const attendues = Number(option('--parts'));
  if (!dossier || !Number.isInteger(attendues) || attendues < 1) {
    console.error('Usage : node scripts/gates-assembler.js <dossier des bilans> --parts N [--sortie <dossier>]');
    return 2;
  }
  const bilans = trouverBilans(path.resolve(dossier)).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  const a = assembler(bilans, attendues);
  const { texte, resume } = texteDuBilan(a, attendues);
  const sortie = path.resolve(option('--sortie') || dossier);
  fs.mkdirSync(sortie, { recursive: true });
  fs.writeFileSync(path.join(sortie, 'bilan-assemble.txt'), `${texte}\n`);
  fs.writeFileSync(path.join(sortie, 'bilan-assemble.json'), JSON.stringify({ resume, ...a }, null, 1));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, resumeMarkdown(a, resume));
  console.log(texte);
  return a.rouges || a.manquantes.length ? 1 : 0;
}

if (require.main === module) process.exit(principal());

module.exports = { assembler, etatDuScript, texteDuBilan, trouverBilans };
