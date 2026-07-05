/* ==========================================================================
   FUN GALAXY — La Carte
   Vanilla JS, zéro dépendance, self-contained. Données inline (menu-data.json).
   Expérience : liste verticale par sections + barre de catégories sticky
   (scroll-spy) + recherche live + filtre « Sans alcool ». Ambiance galactique.
   ========================================================================== */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ Données */
  var DATA = {
    brand: {
      name: "Fun Galaxy",
      tagline: "bowling, laser game & more",
      note: "L'abus d'alcool est dangereux pour la santé, à consommer avec modération. Pour votre santé, pratiquez une activité physique régulière.",
      socials: [
        { label: "Instagram", handle: "@fungalaxy", url: "" },
        { label: "Facebook", handle: "Fun Galaxy", url: "" },
        { label: "Site web", handle: "fungalaxy.be", url: "https://fungalaxy.be" }
      ]
    },
    categories: [
      { id: "bieres-bouteille", name: "Bières en bouteille", icon: "beer", alcohol: true, items: [
        { name: "Duvel", price: "5€" },
        { name: "Hoegaarden Blanche", price: "3.70€" },
        { name: "Hoegaarden Rosée", price: "3.70€" },
        { name: "Kriek Belle-Vue", price: "3.80€" },
        { name: "Leffe Blonde", price: "4.50€" }
      ] },
      { id: "bieres-speciales", name: "Bières spéciales", icon: "beer", alcohol: true, items: [
        { name: "Cubanisto", price: "4.50€" },
        { name: "Leffe Bleue", price: "5€" },
        { name: "Orval", price: "5.50€" },
        { name: "Chouffe", price: "5.50€" },
        { name: "Corona", price: "4.50€" },
        { name: "Victoria", price: "5€" }
      ] },
      { id: "au-fut", name: "Au fût (25cl / 33cl)", icon: "beer", alcohol: true, items: [
        { name: "Jupiler", price: "3€ / 3.50€" },
        { name: "Mazout", price: "3€ / 3.50€" },
        { name: "Triple Karmeliet", price: "3.80€ / 4.80€" },
        { name: "CTS Scotch", price: "4€" }
      ] },
      { id: "bieres-zero", name: "Bières zéro", icon: "beer", alcohol: false, zero: true, items: [
        { name: "Jupiler 0°", price: "3€" },
        { name: "Triple Karmeliet 0°", price: "4.80€" },
        { name: "Hoegaarden Rosée 0°", price: "3.70€" },
        { name: "Corona 0°", price: "4.50€" }
      ] },
      { id: "softs", name: "Softs", icon: "soda", alcohol: false, items: [
        { name: "Pepsi / Pepsi Max", price: "3.30€" },
        { name: "Ice Tea (Pétillant / Pêche / Green)", price: "3.30€" },
        { name: "Schweppes (Agrume / Tonic)", price: "3.30€" },
        { name: "Oasis Tropical", price: "3.30€" },
        { name: "Orangina", price: "3.30€" },
        { name: "Seven Up", price: "3.30€" },
        { name: "Gini Lemon", price: "3.30€" },
        { name: "Canada Dry", price: "3.30€" },
        { name: "Eau plate 33cl", price: "2.90€" },
        { name: "Eau plate 50cl", price: "4.80€" },
        { name: "Perrier", price: "3.30€" },
        { name: "San Pellegrino 50cl", price: "5€" },
        { name: "Looza", price: "3.30€" },
        { name: "Pomme Cerise / Orange / Pomme", price: "3€" },
        { name: "Cécémel", price: "3€" },
        { name: "Redbull", price: "4€" }
      ] },
      { id: "boissons-chaudes", name: "Boissons chaudes", icon: "coffee", alcohol: false, items: [
        { name: "Café", price: "3€" },
        { name: "Cappuccino", price: "3.50€" },
        { name: "Expresso", price: "3€" },
        { name: "Café Latte", price: "3.50€" },
        { name: "Yellow Tea", price: "3€" },
        { name: "Thé aux fruits rouges", price: "3€" },
        { name: "Thé à la menthe", price: "3€" },
        { name: "Chocolat chaud", price: "3€" }
      ] },
      { id: "granitas", name: "Granitas", icon: "ice", alcohol: false, items: [
        { name: "Granita (en fonction de la saison)", price: "3.80€" }
      ] },
      { id: "sucre", name: "Sucré", icon: "dessert", alcohol: false, items: [
        { name: "Crêpe au sucre", price: "6€" },
        { name: "Crêpe au Nutella", price: "6€" },
        { name: "Gaufre", price: "6€" },
        { name: "Glace", price: "3€" },
        { name: "Bonbons", price: "3€" }
      ] },
      { id: "snacks", name: "Snacks et Tapas", icon: "snack", alcohol: false, items: [
        { name: "Paquet de chips", price: "2.70€", desc: "Croky Explosions, Paprika, Naturel, Monster Munch…" },
        { name: "Nachos et sauce (petite portion)", price: "5.50€" },
        { name: "Nachos Together", price: "14€" },
        { name: "Panini mozzarella-tomate", price: "5.50€" },
        { name: "Panini jambon-fromage", price: "5.50€" },
        { name: "Assiette apéro", price: "19€" }
      ] },
      { id: "pizzas", name: "Pizzas (29cm)", icon: "pizza", alcohol: false, items: [
        { name: "Margherita", price: "14€" },
        { name: "Quattro Fromaggi", price: "14€" },
        { name: "Verdure Grigliate (Vege)", price: "14€" },
        { name: "Salame", price: "14€" },
        { name: "Prosciutto", price: "14€" },
        { name: "Chicken Barbecue", price: "14€" }
      ] },
      { id: "cocktails", name: "Cocktails", icon: "cocktail", alcohol: true, priceHint: "10€", items: [
        { name: "1. Barracuda", price: "10€", desc: "Rhum blanc, liqueur de vanille, jus d'ananas, jus de citron" },
        { name: "3. Old San Juan Cocktail", price: "10€", desc: "Rhum brun, jus d'ananas, grenadine, jus de citron" },
        { name: "6. Pink Pussycat", price: "10€", desc: "Gin, grenadine, jus d'ananas" },
        { name: "9. Pina Colada", price: "10€", desc: "Rhum, crème, noix de coco, jus d'ananas" },
        { name: "10. Alice Deluxe", price: "10€", desc: "Jus d'ananas, jus d'orange, crème, grenadine, vodka" },
        { name: "13. Flying Kangaroo", price: "10€", desc: "Vodka, noix de coco, jus d'ananas, jus d'orange" },
        { name: "14. Golden Sunrise", price: "10€", desc: "Grenadine, jus de citron, jus d'orange, ananas" },
        { name: "17. Bacardi Sunrise", price: "10€", desc: "Rhum blanc, jus de citron, jus d'orange, grenadine" },
        { name: "22. Tequila Sunrise", price: "10€", desc: "Tequila argent, jus d'orange, jus de citron, grenadine" },
        { name: "53. Painkiller", price: "10€", desc: "Rhum brun, noix de coco, jus d'orange, jus d'ananas" }
      ] },
      { id: "mocktails", name: "Mocktails", icon: "mocktail", alcohol: false, zero: true, priceHint: "7€", items: [
        { name: "37. Red One", price: "7€", desc: "Grenadine, jus de citron, jus d'ananas, jus d'orange" },
        { name: "39. Baby Simply Red", price: "7€", desc: "Grenadine, jus de citron, jus d'ananas, noix de coco" },
        { name: "42. Alice", price: "7€", desc: "Grenadine, jus d'orange, crème, jus d'ananas" },
        { name: "43. Ballerina", price: "7€", desc: "Jus de citron, jus d'orange, jus d'ananas" },
        { name: "48. Virgin Tequila Sunrise", price: "7€", desc: "Jus de citron, grenadine, jus d'orange, jus d'ananas" },
        { name: "60. Princesse", price: "7€", desc: "Grenadine, crème, noix de coco, jus d'ananas" }
      ] },
      { id: "alcools", name: "Alcools", icon: "spirit", alcohol: true, items: [
        { name: "Martini blanc / rouge", price: "5€" },
        { name: "Rhum blanc / brun", price: "6.50€" },
        { name: "Whisky", price: "6.50€" },
        { name: "Gin", price: "6€" },
        { name: "Vodka", price: "6€" },
        { name: "Amaretto", price: "6€" },
        { name: "Apérol Spritz", price: "8€" },
        { name: "Accompagnement soft", price: "2.50€" }
      ] },
      { id: "vins", name: "Vins", icon: "wine", alcohol: true, items: [
        { name: "Rouge Merlot Croix d'Or — bouteille", price: "24€" },
        { name: "Blanc Chardonnay Croix d'Or — bouteille", price: "24€" },
        { name: "Rosé Syrah Croix d'Or — bouteille", price: "24€" },
        { name: "Verre (rouge / blanc / rosé)", price: "4.50€" }
      ] }
    ]
  };

  /* ------------------------------------------------------- Illustrations SVG */
  function svg(inner) {
    return '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + inner + '</svg>';
  }
  var ICONS = {
    beer: '<path d="M15 17h15v21a4 4 0 0 1-4 4h-7a4 4 0 0 1-4-4V17Z"/>' +
          '<path d="M30 21h4.5a3.5 3.5 0 0 1 3.5 3.5v5a3.5 3.5 0 0 1-3.5 3.5H30"/>' +
          '<path d="M14 17c.4-3 3.4-3.6 5-1.6 1-3.1 5.2-3.1 6.6-.4 2-1.6 4.7-.4 4.4 2"/>' +
          '<path d="M19 27v9M23 27v9M27 27v9" stroke-width="1.2" opacity=".55"/>',
    soda: '<path d="M15 16h18l-2.4 25a2 2 0 0 1-2 1.8H19.4a2 2 0 0 1-2-1.8L15 16Z"/>' +
          '<path d="M28 16l4-6"/>' +
          '<circle cx="22" cy="27" r="1.3"/><circle cx="26.5" cy="32" r="1.3"/><circle cx="22.5" cy="36" r="1.1"/>',
    coffee: '<path d="M15 22h16v6a8 8 0 0 1-16 0v-6Z"/>' +
            '<path d="M31 23.5h3.2a4 4 0 0 1 0 8H31"/>' +
            '<path d="M12 40h22"/>' +
            '<path d="M20 12c-1.2 2 1 3 0 5M26 12c-1.2 2 1 3 0 5" stroke-width="1.4" opacity=".7"/>',
    ice: '<path d="M16.5 23h15l-1.9 17.4a3 3 0 0 1-3 2.6H21.4a3 3 0 0 1-3-2.6L16.5 23Z"/>' +
         '<path d="M15 23c1-5.5 4.6-8.5 9-8.5s8 3 9 8.5"/>' +
         '<path d="M20 18.5c1.4-1.6 3-1.6 4.4 0 1.4-1.6 3-1.6 4.4 0" stroke-width="1.3" opacity=".7"/>' +
         '<path d="M27.5 15.5 31 9.5"/>',
    dessert: '<path d="M17.5 24 24 42l6.5-18"/>' +
             '<path d="M15.5 24h17"/>' +
             '<path d="M27 30l-6 6M29 33l-4 4" stroke-width="1.2" opacity=".5"/>' +
             '<path d="M15.8 24c-1-6 3.6-10 8.2-10s9.2 4 8.2 10"/>' +
             '<circle cx="24" cy="11" r="2"/>',
    snack: '<path d="M12 26h24a12 12 0 0 1-24 0Z"/>' +
           '<path d="M18.5 26 22.5 14 26.5 26Z"/>' +
           '<path d="M25 26 29.5 16 33 26Z"/>',
    pizza: '<path d="M9 18 24 43 39 18"/>' +
           '<path d="M9 18a42 42 0 0 1 30 0"/>' +
           '<circle cx="20" cy="26" r="1.8"/><circle cx="28" cy="24.5" r="1.8"/><circle cx="24" cy="33" r="1.8"/>',
    cocktail: '<path d="M11 14h26L24 29Z"/>' +
              '<path d="M24 29v11"/><path d="M17.5 40h13"/>' +
              '<path d="M31 17.5 35.5 11"/><circle cx="36" cy="10" r="1.7"/>',
    mocktail: '<path d="M17 15h14v25a2 2 0 0 1-2 2H19a2 2 0 0 1-2-2V15Z"/>' +
              '<path d="M17 30h14"/><path d="M27 15l4.5-6"/>' +
              '<circle cx="31" cy="15" r="4.2"/><path d="M31 10.8v8.4M26.8 15h8.4" stroke-width="1.2"/>',
    spirit: '<path d="M21 9h5v6l2.6 4.6V40a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V19.6L18.4 15V9Z"/>' +
            '<path d="M20.6 9h6"/><path d="M17 27h11" stroke-width="1.3" opacity=".7"/>' +
            '<path d="M31.5 30h7.5l-1.1 10.2a1.6 1.6 0 0 1-1.6 1.4h-1.5a1.6 1.6 0 0 1-1.6-1.4L31.5 30Z"/>',
    wine: '<path d="M15 10h18a9 9 0 0 1-9 13.5A9 9 0 0 1 15 10Z"/>' +
          '<path d="M16.5 15.5h15" stroke-width="1.2" opacity=".6"/>' +
          '<path d="M24 23.5V36"/><path d="M17.5 36h13"/>'
  };
  var UI = {
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="21" y2="21"/>',
    droplet: '<path d="M12 3s6.5 7 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 10 12 3 12 3Z"/><line x1="4" y1="20.5" x2="20" y2="4.5"/>',
    ig: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none"/>',
    fb: '<path d="M14 8.5h2.2V5.2H14c-2.2 0-3.7 1.5-3.7 3.8V11H8v3.3h2.3V21h3.3v-6.7h2.4l.4-3.3h-2.8V9.4c0-.6.3-.9 1.1-.9Z" fill="currentColor" stroke="none"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.7 3 2.7 15 0 18M12 3c-2.7 3-2.7 15 0 18"/>'
  };
  function uiIcon(id, w) {
    w = w || 20;
    return '<svg viewBox="0 0 24 24" width="' + w + '" height="' + w + '" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + UI[id] + '</svg>';
  }

  /* ------------------------------------------------------------- Utilitaires */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function norm(s) {
    return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  /* ------------------------------------------------------------- Références DOM */
  var app = document.getElementById("app");
  var noAlc = false;
  var query = "";

  /* ---------------------------------------------- Fourchette de prix par catégorie */
  function priceRange(cat) {
    var nums = [];
    cat.items.forEach(function (it) {
      var m = String(it.price).match(/\d+(?:[.,]\d+)?/g);
      if (m) m.forEach(function (v) { nums.push(parseFloat(v.replace(",", "."))); });
    });
    if (!nums.length) return "";
    var min = Math.min.apply(null, nums), max = Math.max.apply(null, nums);
    var fmt = function (n) { return (Number.isInteger(n) ? String(n) : n.toFixed(2)) + "€"; };
    return min === max ? fmt(min) : fmt(min) + "–" + fmt(max);
  }
  function visibleCats() {
    return DATA.categories.filter(function (c) { return !(noAlc && c.alcohol); });
  }

  /* --------------------------------------------------------------- Rendu item */
  function itemHTML(cat, it, q) {
    var badge = cat.zero ? '<span class="badge0">0%</span>' : "";
    var name = q ? highlight(it.name, q) : esc(it.name);
    var desc = it.desc
      ? '<p class="item__desc">' + (q ? highlight(it.desc, q) : esc(it.desc)) + "</p>"
      : "";
    var priceCls = it.price.length > 7 ? "item__price item__price--sm" : "item__price";
    return '<li class="item">' +
      '<div class="item__body">' +
        '<p class="item__name">' + name + badge + "</p>" + desc +
      "</div>" +
      '<span class="item__lead" aria-hidden="true"></span>' +
      '<span class="' + priceCls + '">' + esc(it.price) + "</span>" +
      "</li>";
  }

  function sectionHTML(cat, items, q) {
    var rows = items.map(function (it) { return itemHTML(cat, it, q); }).join("");
    var n = items.length;
    return '<section class="section" id="sec-' + cat.id + '" aria-labelledby="t-' + cat.id + '">' +
      '<div class="section__head">' +
        '<span class="section__icon">' + svg(ICONS[cat.icon] || ICONS.soda) + "</span>" +
        '<h2 class="section__title" id="t-' + cat.id + '">' + esc(cat.name) + "</h2>" +
        '<span class="section__count">' + n + " choix</span>" +
      "</div>" +
      '<div class="section__rule"></div>' +
      '<ul class="items">' + rows + "</ul>" +
      "</section>";
  }

  /* ------------------------------------------------------- Recherche : surlignage */
  function highlight(text, q) {
    if (!q) return esc(text);
    var nt = norm(text), nq = norm(q), i = nt.indexOf(nq);
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + "<mark>" + esc(text.slice(i, i + q.length)) + "</mark>" + esc(text.slice(i + q.length));
  }
  function matches(it, nq) {
    return norm(it.name).indexOf(nq) > -1 || (it.desc && norm(it.desc).indexOf(nq) > -1);
  }

  /* ============================================================ HUB D'ACCUEIL */
  function hubHTML() {
    var total = DATA.categories.reduce(function (a, c) { return a + c.items.length; }, 0);
    return '' +
      '<header class="hero">' +
        '<img class="hero__logo" src="./assets/logo-fun-galaxy.svg" ' +
          'alt="Fun Galaxy — bowling, games & more" width="522" height="354">' +
        '<p class="hero__tagline">Bar &amp; Snacks</p>' +
        '<div class="hero__rule"></div>' +
        '<p class="hero__title">La carte</p>' +
        '<p class="hero__sub">' + DATA.categories.length + ' catégories, ' + total + ' saveurs à explorer sous les étoiles.</p>' +
      '</header>' +
      '<div class="nav">' +
        '<div class="nav__row">' +
          '<label class="field">' + uiIcon("search", 18) +
            '<input id="q" type="search" inputmode="search" autocomplete="off" ' +
            'placeholder="Rechercher un produit, un ingrédient…" aria-label="Rechercher dans la carte">' +
          "</label>" +
          '<button class="toggle" id="noalc" type="button" aria-pressed="' + (noAlc ? "true" : "false") + '">' +
            uiIcon("droplet", 17) + "<span>Sans alcool</span></button>" +
        "</div>" +
      "</div>" +
      '<div id="hubbody"></div>' +
      footerHTML();
  }

  function catCardHTML(cat) {
    var badge = cat.zero ? '<span class="badge0">0%</span>' : "";
    return '<li><a class="cat-card" href="#cat-' + cat.id + '">' +
      '<span class="cat-card__icon">' + svg(ICONS[cat.icon] || ICONS.soda) + "</span>" +
      '<span class="cat-card__name">' + esc(cat.name) + "</span>" +
      '<span class="cat-card__meta">' + cat.items.length + ' choix' +
        '<span class="dot">·</span><span class="price">' + esc(priceRange(cat)) + "</span></span>" +
      badge +
      "</a></li>";
  }

  function renderHubBody() {
    var box = document.getElementById("hubbody");
    var q = query.trim(), nq = norm(q);
    if (nq) {
      var results = [];
      visibleCats().forEach(function (cat) {
        var items = cat.items.filter(function (it) { return matches(it, nq); });
        if (items.length) results.push(sectionHTML(cat, items, q));
      });
      box.innerHTML = results.length
        ? '<div class="sections">' + results.join("") + "</div>"
        : '<p class="empty">Aucun résultat pour «&nbsp;<b>' + esc(q) + '</b>&nbsp;».<br>Essayez un autre mot.</p>';
      return;
    }
    var cards = visibleCats().map(catCardHTML).join("");
    box.innerHTML = '<ul class="cats">' + cards + "</ul>";
  }

  function renderHub() {
    app.innerHTML = hubHTML();
    renderHubBody();
    var input = document.getElementById("q");
    input.value = query;
    input.addEventListener("input", onSearch);
    document.getElementById("noalc").classList.toggle("is-on", noAlc);
    document.getElementById("noalc").addEventListener("click", toggleNoAlc);
    window.scrollTo(0, 0);
  }

  /* ============================================================ VUE CATÉGORIE */
  function pagerBtnHTML(cat, dir) {
    var label = dir === "prev" ? "Précédent" : "Suivant";
    var arrow = dir === "prev"
      ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>'
      : '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
    var txt = '<span class="pager__txt"><span class="pager__dir">' + label + '</span>' +
      '<span class="pager__name">' + (cat ? esc(cat.name) : "—") + "</span></span>";
    var cls = "pager__btn pager__btn--" + (dir === "prev" ? "prev" : "next");
    if (!cat) return '<span class="' + cls + '" disabled>' + (dir === "prev" ? arrow + txt : txt + arrow) + "</span>";
    return '<a class="' + cls + '" href="#cat-' + cat.id + '">' + (dir === "prev" ? arrow + txt : txt + arrow) + "</a>";
  }

  function renderCategory(cat) {
    var list = DATA.categories;
    var idx = list.indexOf(cat);
    var prev = idx > 0 ? list[idx - 1] : null;
    var next = idx < list.length - 1 ? list[idx + 1] : null;
    var backArrow = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';

    app.innerHTML =
      '<div class="catview">' +
        '<a class="back" href="#accueil">' + backArrow + "<span>Toutes les catégories</span></a>" +
        '<p class="catview__pos">Catégorie ' + (idx + 1) + " / " + list.length + "</p>" +
        '<div class="sections">' + sectionHTML(cat, cat.items, "") + "</div>" +
        '<nav class="pager" aria-label="Navigation entre catégories">' +
          pagerBtnHTML(prev, "prev") + pagerBtnHTML(next, "next") +
        "</nav>" +
      "</div>" +
      footerHTML();
    window.scrollTo(0, 0);
  }

  function footerHTML() {
    var socials = DATA.brand.socials.map(function (s) {
      var icon = s.label === "Instagram" ? "ig" : s.label === "Facebook" ? "fb" : "globe";
      var inner = uiIcon(icon, 17) + '<span>' + esc(s.handle) + '</span>';
      if (s.url) {
        return '<li><a class="social social--link" href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + inner + '</a></li>';
      }
      return '<li><span class="social social--dead" aria-disabled="true" title="Bientôt disponible">' + inner + '</span></li>';
    }).join("");
    return '<footer class="foot">' +
      '<h2 class="foot__title">Suivez-nous</h2>' +
      '<ul class="socials">' + socials + "</ul>" +
      '<div class="foot__rule"></div>' +
      '<p class="legal">' + esc(DATA.brand.note) + "</p>" +
      '<p class="brandline">Fun Galaxy · ' + esc(DATA.brand.tagline) + "</p>" +
      "</footer>";
  }

  /* ------------------------------------------------------------------ Actions */
  var searchTimer = null;
  function onSearch(e) {
    query = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderHubBody, 90);
  }
  function toggleNoAlc() {
    noAlc = !noAlc;
    var btn = document.getElementById("noalc");
    btn.classList.toggle("is-on", noAlc);
    btn.setAttribute("aria-pressed", noAlc ? "true" : "false");
    renderHubBody();
  }

  /* ------------------------------------------------------------------ Routeur */
  function catById(id) {
    for (var i = 0; i < DATA.categories.length; i++) {
      if (DATA.categories[i].id === id) return DATA.categories[i];
    }
    return null;
  }
  function route() {
    var hash = (location.hash || "").replace(/^#/, "");
    if (hash.indexOf("cat-") === 0) {
      var cat = catById(hash.slice(4));
      if (cat) { renderCategory(cat); return; }
    }
    renderHub();
  }

  /* ---------------------------------------------------------------- Démarrage */
  window.addEventListener("hashchange", route);
  route();
})();
