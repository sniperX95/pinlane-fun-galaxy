/* ============================================================================
   LA MARQUE D'UN CENTRE, A PARTIR D'UNE SEULE COULEUR (2026-08-08)
   ----------------------------------------------------------------------------
   POURQUOI CE FICHIER EXISTE. La config d'un centre porte QUATRE jetons de
   couleur par theme (accent, accentStrong, accentSoft, accentContrast, plus la
   variante sombre) : c'est ce que le tunnel consomme, et lib/center-config.js
   refuse d'en deriver le moindre au rendu ("un contraste ne s'invente pas, il
   se declare"). Demander huit couleurs a un gerant qui veut juste "du vert",
   c'est un formulaire de configuration, pas un accueil de client.

   Ce module tient les deux bouts : le gerant saisit UNE couleur d'accent, la
   console en derive le jeu complet ICI, et l'envoie DECLARE dans la config.
   Rien n'est calcule au moment de peindre : la donnee reste la seule source.

   ZERO COULEUR EN DUR. La derivation ne connait aucune couleur : elle melange
   l'accent saisi avec les jetons de la PLATEFORME (--surface, --text, lus dans
   le DOM par readPlatformPalette). Les deux extremites de l'axe de luminosite
   sont donc le fond et le texte du theme, jamais un litteral.

   LE CONTRASTE NE SE DEVINE PAS. auditBranding() mesure le contraste WCAG 2.2
   reel de la couleur saisie CONTRE LES FONDS OU ELLE SERT, dans les deux
   themes, et rend des constats lisibles. La console AVERTIT, elle ne bloque
   jamais : c'est la marque du client, pas la notre.

   Double vie : global navigateur (window.PinlaneBrand) et module CommonJS, pour
   que le gate du deuxieme client exerce EXACTEMENT ce code et pas une copie.
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PinlaneBrand = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HEX6 = /^#[0-9a-f]{6}$/i;
  const HEX3 = /^#[0-9a-f]{3}$/i;

  // Seuils WCAG 2.2. 4.5:1 pour du texte courant (1.4.3), 3:1 pour un composant
  // ou une bordure porteuse de sens (1.4.11).
  const TEXT_RATIO = 4.5;
  const COMPONENT_RATIO = 3;

  // Jetons de branding attendus par lib/center-config.js (BRANDING_KEYS).
  const KEYS = ['accent', 'accentStrong', 'accentSoft', 'accentContrast'];

  function normalizeHex(value) {
    const raw = String(value == null ? '' : value).trim().toLowerCase();
    if (HEX6.test(raw)) return raw;
    if (HEX3.test(raw)) return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
    return '';
  }

  function isValidHex(value) {
    return normalizeHex(value) !== '';
  }

  function toRgb(hex) {
    const safe = normalizeHex(hex);
    if (!safe) return null;
    return {
      r: parseInt(safe.slice(1, 3), 16),
      g: parseInt(safe.slice(3, 5), 16),
      b: parseInt(safe.slice(5, 7), 16),
    };
  }

  function toHex(rgb) {
    const part = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
  }

  // Luminance relative WCAG (sRGB linearise).
  function relativeLuminance(hex) {
    const rgb = toRgb(hex);
    if (!rgb) return null;
    const channel = (value) => {
      const c = value / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
  }

  // Rapport de contraste WCAG entre deux couleurs opaques. null si l'une des
  // deux est illisible : on ne rend JAMAIS un chiffre invente.
  function contrastRatio(a, b) {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    if (la === null || lb === null) return null;
    const light = Math.max(la, lb);
    const dark = Math.min(la, lb);
    return (light + 0.05) / (dark + 0.05);
  }

  function roundRatio(ratio) {
    return ratio === null ? null : Math.round(ratio * 100) / 100;
  }

  // Melange lineaire en sRGB : t = 0 rend `from`, t = 1 rend `to`.
  function mix(from, to, t) {
    const a = toRgb(from);
    const b = toRgb(to);
    if (!a || !b) return normalizeHex(from) || normalizeHex(to);
    const k = Math.max(0, Math.min(1, Number(t) || 0));
    return toHex({
      r: a.r + (b.r - a.r) * k,
      g: a.g + (b.g - a.g) * k,
      b: a.b + (b.b - a.b) * k,
    });
  }

  // Pousse `color` vers `towards` par paliers, jusqu'a atteindre `target` de
  // contraste contre `against`. Rend la premiere valeur qui passe, sinon la
  // plus contrastee atteinte : on ne ment pas sur l'echec, auditBranding le dira.
  function pushUntilContrast(color, towards, against, target) {
    let best = normalizeHex(color);
    let bestRatio = contrastRatio(best, against) || 0;
    if (bestRatio >= target) return best;
    for (let step = 1; step <= 20; step += 1) {
      const candidate = mix(color, towards, step / 20);
      const ratio = contrastRatio(candidate, against) || 0;
      if (ratio > bestRatio) { best = candidate; bestRatio = ratio; }
      if (ratio >= target) return candidate;
    }
    return best;
  }

  // Des deux extremites du theme (fond, texte), celle qui se lit le mieux SUR
  // l'accent. C'est le seul choix "binaire" de la derivation, et il est mesure.
  function bestOn(color, optionA, optionB) {
    const ra = contrastRatio(color, optionA) || 0;
    const rb = contrastRatio(color, optionB) || 0;
    return ra >= rb ? normalizeHex(optionA) : normalizeHex(optionB);
  }

  // Palette de repli : utilisee UNIQUEMENT si l'appelant n'a pas de DOM a lire
  // (le gate en Node). Les valeurs sont celles des jetons de assets/pinlane.css
  // et ne servent qu'a mesurer, jamais a peindre.
  const FALLBACK_PALETTE = {
    light: { surface: '#ffffff', text: '#0a0a0a' },
    dark: { surface: '#0a0a0a', text: '#ededed' },
  };

  function normalizePalette(input) {
    const src = input && typeof input === 'object' ? input : {};
    const pick = (block, fallback) => {
      const b = block && typeof block === 'object' ? block : {};
      return {
        surface: normalizeHex(b.surface) || fallback.surface,
        text: normalizeHex(b.text) || fallback.text,
      };
    };
    return {
      light: pick(src.light, FALLBACK_PALETTE.light),
      dark: pick(src.dark, FALLBACK_PALETTE.dark),
    };
  }

  // Lit les jetons REELS de la plateforme, dans LES DEUX themes.
  //
  // Le theme clair n'a pas de selecteur a lui (pinlane.css le pose sur :root, et
  // seul `[data-theme='dark']` le surcharge) : un noeud sonde portant
  // data-theme="light" HERITE donc du theme courant au lieu de le remettre a
  // zero. C'etait une mesure fausse, et elle produisait une couleur de texte
  // choisie contre le mauvais fond. On bascule donc l'attribut sur <html> le
  // temps d'UNE lecture, dans la meme tache : aucun repaint ne s'intercale,
  // rien ne clignote, et l'attribut est restaure tel qu'il etait.
  function readPlatformPalette(doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || !d.documentElement || typeof getComputedStyle !== 'function') {
      return normalizePalette(null);
    }
    const root = d.documentElement;
    const readRoot = () => {
      const style = getComputedStyle(root);
      return {
        surface: normalizeHex(style.getPropertyValue('--surface')),
        text: normalizeHex(style.getPropertyValue('--text')),
      };
    };
    const previous = root.getAttribute('data-theme');
    const current = previous === 'dark' ? 'dark' : 'light';
    const here = readRoot();
    let other = { surface: '', text: '' };
    try {
      root.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
      other = readRoot();
    } catch (error) {
      // Document non peint : on retombe sur la palette de repli.
    } finally {
      if (previous === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', previous);
    }
    return normalizePalette(current === 'dark' ? { dark: here, light: other } : { light: here, dark: other });
  }

  // DERIVATION : une couleur saisie -> le jeu complet des jetons, deux themes.
  // Rend null si la saisie n'est pas une couleur : "pas de marque" est un etat
  // legitime (le tunnel garde alors l'accent plateforme).
  function deriveBranding(accentInput, paletteInput) {
    const accent = normalizeHex(accentInput);
    if (!accent) return null;
    const palette = normalizePalette(paletteInput);

    // Theme clair : l'accent est garde TEL QUEL (c'est la marque du client, on
    // ne la corrige pas en douce). Seuls les jetons derives sont amenes au
    // contraste : accentStrong porte le TEXTE accentue, il doit se lire.
    const light = {
      accent,
      accentContrast: bestOn(accent, palette.light.surface, palette.light.text),
      accentSoft: mix(accent, palette.light.surface, 0.92),
      accentStrong: pushUntilContrast(accent, palette.light.text, palette.light.surface, TEXT_RATIO),
    };

    // Theme sombre : un accent concu pour du blanc disparait sur du noir. On le
    // remonte vers le texte clair jusqu'au seuil composant (3:1), pas au-dela :
    // la teinte reste reconnaissable.
    const darkAccent = pushUntilContrast(accent, palette.dark.text, palette.dark.surface, COMPONENT_RATIO);
    const dark = {
      accent: darkAccent,
      accentContrast: bestOn(darkAccent, palette.dark.surface, palette.dark.text),
      accentSoft: mix(darkAccent, palette.dark.surface, 0.86),
      accentStrong: pushUntilContrast(darkAccent, palette.dark.text, palette.dark.surface, TEXT_RATIO),
    };

    return { ...light, dark };
  }

  // Les endroits ou la couleur SERT vraiment, dans l'ordre ou ils comptent.
  // Chaque constat porte sa mesure, son seuil et sa phrase : l'interface n'a
  // qu'a les afficher, elle n'a rien a decider.
  function auditBranding(branding, paletteInput) {
    if (!branding || typeof branding !== 'object' || !normalizeHex(branding.accent)) return [];
    const palette = normalizePalette(paletteInput);
    const dark = branding.dark && typeof branding.dark === 'object' ? branding.dark : {};
    const checks = [
      {
        id: 'button-text-light',
        label: 'Texte sur le bouton (clair)',
        pair: [branding.accentContrast, branding.accent],
        threshold: TEXT_RATIO,
      },
      {
        id: 'button-surface-light',
        label: 'Bouton sur la page (clair)',
        pair: [branding.accent, palette.light.surface],
        threshold: COMPONENT_RATIO,
      },
      {
        id: 'accent-text-light',
        label: 'Texte accentue (clair)',
        pair: [branding.accentStrong, palette.light.surface],
        threshold: TEXT_RATIO,
      },
      {
        id: 'button-text-dark',
        label: 'Texte sur le bouton (sombre)',
        pair: [dark.accentContrast, dark.accent],
        threshold: TEXT_RATIO,
      },
      {
        id: 'button-surface-dark',
        label: 'Bouton sur la page (sombre)',
        pair: [dark.accent, palette.dark.surface],
        threshold: COMPONENT_RATIO,
      },
    ];
    return checks
      .filter((check) => isValidHex(check.pair[0]) && isValidHex(check.pair[1]))
      .map((check) => {
        const ratio = contrastRatio(check.pair[0], check.pair[1]);
        return {
          id: check.id,
          label: check.label,
          ratio: roundRatio(ratio),
          threshold: check.threshold,
          ok: ratio !== null && ratio >= check.threshold,
        };
      });
  }

  // Une phrase, celle que l'interface montre sous le champ. Jamais un blocage :
  // on dit ce qui se passera, le gerant tranche.
  function contrastNotice(branding, paletteInput) {
    const checks = auditBranding(branding, paletteInput);
    if (!checks.length) return null;
    const failed = checks.filter((check) => !check.ok);
    if (!failed.length) {
      const worst = checks.reduce((min, c) => (c.ratio < min.ratio ? c : min), checks[0]);
      return {
        tone: 'ok',
        text: `Contraste tenu partout (au plus juste ${worst.ratio}:1 pour ${worst.label.toLowerCase()}).`,
        checks,
      };
    }
    const first = failed[0];
    const rest = failed.length > 1 ? ` et ${failed.length - 1} autre${failed.length > 2 ? 's' : ''} usage${failed.length > 2 ? 's' : ''}` : '';
    return {
      tone: 'warn',
      text: `${first.label} : ${first.ratio}:1, sous le seuil de ${first.threshold}:1${rest}. La couleur est acceptee, mais elle se lira mal.`,
      checks,
    };
  }

  return {
    TEXT_RATIO,
    COMPONENT_RATIO,
    KEYS,
    normalizeHex,
    isValidHex,
    relativeLuminance,
    contrastRatio,
    mix,
    readPlatformPalette,
    deriveBranding,
    auditBranding,
    contrastNotice,
  };
}));
