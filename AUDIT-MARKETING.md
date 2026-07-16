# AUDIT-MARKETING : la zone Marketing avant refonte

Date : 2026-07-17. Methode : 13 agents de cartographie et de verification adverse en lecture
seule (6 onglets, 1 architecture du cerveau, 6 defauts verifies par des sceptiques dont la
consigne etait d'INFIRMER), plus verification directe du defaut D et du bug centerId par
l'orchestrateur. Zero ligne de code produite ou modifiee par ce run.

Chaque affirmation porte un chemin:ligne verifie dans le code au moment de l'audit, ou une
sortie de requete SQL prod. Ce qui n'a pas pu etre verifie est liste en fin de document.

**Faits SQL prod (2026-07-17, requetes directes)** : `marketing_patterns` = 0 ligne ·
`marketing_dna` = 28 regles actives (35 ingerees) · `marketing_plans` = 2 proposed mode ai +
2 archived · `llm_spend` juillet = 0,83 USD / 131 appels (plafond 5) · `marketing_insights` =
6 lignes · `daily_center_metrics` = 18 dates eparses du 26/04 au 15/07 (libramont 18 lignes,
gembloux 8). La table s'appelle `daily_center_metrics`, PAS `daily_metrics`
(`database/daily-metrics-schema.sql:18`, insert `lib/center-metrics.js:279`).

---

## 0. Verdict d'ensemble

Le backend est plus honnete que l'ecran. Les calculs sont sources, les seuils d'echantillon
existent, les garde-fous anti-invention existent en partie ; mais la surface transporte trois
generations de design recousues, un etat d'erreur mort sur toute la zone, un bug de centre qui
fait mentir chaque chiffre pour Gembloux, et un onglet entier (« Ce qui marche ») qui ne peut
structurellement rien dire avant ~72 jours de plus. Le grief du proprietaire (« tout est en
desordre, l'IA n'est pas folle ») a des causes precises et reparables, listees ici.

---

## 1. LE BUG TRANSVERSAL N°1 : le centre fantome (CRITIQUE)

`state.currentCenterId` est lu **48 fois** dans `assets/staff-pages-v2.js` (verifie par grep,
dont le fetch central `loadMarketingBrief`, `assets/staff-pages-v2.js:2155`) et n'est
**assigne nulle part** dans `assets/` (grep `currentCenterId =` : 0 ecriture). Le champ
reellement pilote par le switcher de centre est `state.adminCenterId`
(`assets/app-main.js:1545`, `:2032`, `:2158`).

Consequence : **toute la zone Marketing envoie toujours `centerId=libramont`**, via le
fallback `state.currentCenterId || 'libramont'`. Un gerant sur Gembloux voit le brief, le
radar, les propositions, le plan et la paie de Libramont. Les plans Gembloux existent
pourtant en base (le cron itere bien les deux centres, `lib/ops-jobs.js:293`).

Nuance honnete : la correction cote serveur par la session n'a pas ete auditee en profondeur ;
au niveau du front, les 48 sites d'appel envoient un centre fige. A corriger en RUN B (une
seule source de verite du centre courant), et a couvrir d'un test.

---

## 2. LE DEFAUT TRANSVERSAL N°2 : l'etat d'erreur est mort sur toute la zone

Pour le chemin central `marketingBrief`, la seule UI d'erreur + retry est `brZ1`
(`assets/staff-pages-v2.js:2191-2198`), une fonction **jamais appelee** (grep : definition
seule). Il existe UN bouton Reessayer vivant dans la zone, mais il ne couvre que l'echec de
variante reseau d'une carte de proposition (`:2405`), pas le chargement de la page. Si
`marketingBrief` echoue :

- `mkwHero` (`:3262`), `mkwBriefMemo` (`:3307`), `brZ2` (`:2289`), `brZ3` (`:2436`),
  `mkwFacts` (`:3337`), `brZ4` (`:2715`) rendent des squelettes A VIE ;
- la garde de re-fetch (`:3566`, condition `!mkBrief.error`) bloque toute nouvelle tentative ;
- aucun message, aucun bouton Reessayer. Le gerant voit une page qui « charge » eternellement.

Meme motif sur Concurrents : `loadCompetitors` avale l'erreur (`catch { mkComp.data = []; }`,
`:2800`) et affiche l'onboarding « Ajoute les centres qui te prennent des clients » : un echec
reseau se deguise en « aucun concurrent ». L'erreur est en plus collante : `[]` est truthy
pour la garde `:2795`, donc plus aucune retentative de la session. Sur Le plan : une fois
`mkPlan.error` pose, l'auto-chargement ne se relance jamais (`:3520`) et la carte d'erreur
(`:3522`) n'a pas de bouton reessayer. Sur le selecteur de periode : echec silencieux, le
segment actif change mais le chiffre garde l'ancienne periode (`:2252-2268`).

Regle pour RUN C : une erreur reseau dit qu'il y a une erreur reseau, partout, avec un retry.

---

## 3. LE DEFAUT TRANSVERSAL N°3 : trois generations de design dans la meme page

- Couche `mkw-*` (refonte « machine de guerre », `assets/pinlane-staff.css:8383-8832`) ;
- couche `br-*` (refonte « LE BRIEF », `:8211-8376`), recollee par un shim `.mkw-surface .br-*`
  (`:8573-8610`) qui re-skinne a la volee ;
- boutons `pv2-*` melanges dans les cartes (`assets/staff-pages-v2.js:2419`, `:2455`).

Primitives dupliquees entre couches (verifie) : liens (`.br-link` muted `:8227` vs
`.mkw-link` accent `:8423` : le meme geste a deux couleurs selon le bloc), notes de methode
(`.br-method` `:8226` vs `.mkw-method` `:8422`), squelettes (`.br-skel` `:8359` vs
`.mkw-skel` `:8557`), tuiles KPI (`.br-kpi` `:8280` vs `.mkw-kpi` `:8470`), toggles de
periode (`.br-toggle` `:8240`, mort, vs `.mkw-seg` `:8445`), memos (`.br-memo` `:8251`, mort,
vs `.mkw-memo` `:8462`).

**Code mort a supprimer** : `brZ1` (`assets/staff-pages-v2.js:2191`), `brPulse` (`:2234`),
`brFooter` (`:2807`) : trois rendus complets jamais appeles, doublons exacts de
`mkwHero`+`mkwBriefMemo`, `mkwPulseStrip` et `mkwRivals`, avec leur CSS orphelin
(`.br-shell` `:8217`, `.br-pay*`/`.br-memo` `:8236-8253`, `.br-pulse` `:8279-8283`,
`.br-veille` `:8346-8356`). Le brFooter mort porte en plus des ids dupliques en puissance
(`brCompName`/`brCompSite` `:2825-2826` vs `:3438-3439`). Et le brief quotidien pointe encore
vers lui : « detail en bas de page » (`lib/marketing-brief.js:283`) envoie le gerant vers un
bloc qui n'existe plus.

**Tokens fantomes** (bloc plan, `assets/pinlane-staff.css`) : `var(--ink)` (`:8823`, `:8827`,
`:8830`) et `var(--font-mono)` (`:8823`) ne sont definis nulle part (les bons tokens :
`--text` `pinlane.css:57`, `--font-data` `:89`) ; `var(--ok, var(--accent-strong))`
(`:8817`) : `--ok` n'existe pas, le fallback gagne toujours, donc `.tone-good` rend
exactement comme `.tone-info` (`:8818`). Le lisere est pourtant le SEUL vecteur du signal de
confiance (commentaire `:8811-8813`). Le bon token de succes est `--success` (`pinlane.css:68`
light, `:157` dark). Ironie assumee : le commentaire du bloc (`:8808-8810`) proclame
« tokens uniquement ». Ces lignes datent de la veille de l'audit (commit 458d4d9, 2026-07-16) : l'erreur est recente et
n'a pas ete attrapee parce qu'aucun gate ne verifie les tokens (RUN C cree
`ghost-token-check`).

---

## 4. Diagnostic par onglet

### 4.1 Aujourd'hui (`today`)

Composition : `mkwHero('today')` + `mkwBriefMemo()` + `brZ2()` + `brZ3()`
(`assets/staff-pages-v2.js:3559`).

**Ce qui paie sa place (verifie bloc par bloc)** :
- le heros paie (euros attribues 7/30/90 j, `lib/marketing-roi.js:38`) : LA decision
  « mon marketing rapporte-t-il ? », et l'argument qui justifie l'abonnement ;
- le radar 14 jours (`brZ2`, `:2287-2330`) : le coeur metier, « quel jour sera creux, je le
  remplis maintenant », chaque donnee de la cellule sert cette unique decision ;
- la file de propositions (`brZ3`, `:2434-2459`) : l'acte qui genere l'argent, avec la boucle
  « Copier, Publie ?, verdict J+14 », meilleur moment UX de la page ;
- la barre « Demande-moi quelque chose » : capture l'intention du gerant sans friction.

**Casse (verifie)** :
- **Boucle focus/re-render sur la barre de demande** : `onfocus="mkBrAskFocus(true)"`
  (`:2454`) declenche `renderStaffCampaignsPage()` sans garde (`:2610-2612`), qui reconstruit
  le DOM par innerHTML, detruit l'input focalise, refocalise apres 30 ms (`:2613`), et
  reboucle. Chaque re-render recree l'input vide : le texte tape est efface en continu. La
  barre est de facto inutilisable en l'etat du code (deduit du chemin de code, pas execute).
- Bouton radar « Voir la proposition » silencieusement inoperant si la cible est au-dela des
  3 cartes visibles : `mkBrGoCard` (`:2336-2347`) ne force pas `moreOpen`, querySelector ne
  trouve rien, aucun feedback. Cas realiste : prod = 6 insights (`:2438`, slice(0,3)).
- Le memo redit en prose ce que heros et radar montrent deja : trois zones disent le meme
  fait le meme matin. Verdict : fusionner (garder la voix, couper la redondance).
- « passe lundi a 08:12 » affiche l'heure du fetch HTTP, pas celle du cron
  (`lib/marketing-brief.js:513`) : legere tromperie de fraicheur.
- Classe fantome `br-radar-skel` (`:2289`) definie dans aucun CSS.

### 4.2 Le plan (`plan`)

La phrase du proprietaire (« c'est juste digne d'une image ») est un diagnostic exact :
**les 8 cartes sont en lecture seule integrale**. Les actions sont des `<li>` inertes
(`assets/staff-pages-v2.js:3507`), zero handler ; les deux seuls boutons de l'onglet agissent
sur le plan lui-meme (construire/reconstruire), jamais sur son contenu.

Le backend a pourtant TOUT prevu : `planActionDone` existe (`api/ops.js:1274-1280`, insere
l'action en applied pour la mesure J+14) mais **aucun fichier de assets/ ne l'appelle**
(grep : 0 resultat hors api/). La boucle plan, execution, mesure, `marketing_patterns` est
coupee cote UI : la table a 0 ligne ne peut jamais se remplir depuis cet ecran.

Trois ponts transforment l'image en plan (cible RUN C) : « C'est fait » sur chaque action
(vers `planActionDone`) ; « Preparer ce post » (vers le Studio pre-rempli avec l'angle de la
semaine) ; un etat visible par semaine (fait / a faire / passee).

Autres constats : attente = texte nu sans skeleton (`:3521`) alors que l'attente peut durer
30 s (construction a la volee, `api/ops.js:1348-1358`) ; la fraicheur du plan n'est jamais
affichee (`plan.generatedAt` existe, `lib/marketing-strategist.js:323`, jamais rendu) ;
erreur cul-de-sac (section 2) ; tokens fantomes (section 3) ; defauts A et B (section 5).

### 4.3 Ce qui marche (`works`)

**Fait structurel** : a 18 jours de donnees eparses, AUCUN verdict causal ne peut exister.
Chaque fait exige >= 4 echantillons par jour de semaine (`MIN_SAMPLE_PER_BUCKET`,
`lib/center-metrics.js:23`, `:449`) ; meteo/vacances exigent 4+4 (`:406`) ; meilleur mois
exige des mois a >= 8 jours de donnees (`:533`) ; tendance exige 56 jours (`:564-566`). Seul
le fait `data_age` est emis (`:431-439`), et `shapeFacts` l'ignore (data_age n'apparait nulle
part dans `lib/marketing-brief.js:367-397`). L'onglet repondra « je ne sais pas encore »
pendant au moins ~72 jours
de plus, et sa carte patterns exige en plus le cycle complet publier, appliquer, J+14,
agregation (`lib/marketing-agents.js:1750-1753`) avant sa premiere ligne.

**Mensonges latents a corriger meme apres fusion** :
- signe « + » en dur : `+${f.holidayEffectPct}%` (`assets/staff-pages-v2.js:3358`) rendrait
  « +-12% » pour un effet negatif ;
- confiance « solide » en dur pour l'effet vacances (`:3358`) alors que le backend calcule
  exploratoire/signal/solide (`lib/center-metrics.js:419-422`) et que `shapeFacts` perd cette
  confiance (`lib/marketing-brief.js:390`) ;
- l'en-tete « effet net mesure vs journee comparable » peut couvrir un delta BRUT
  (`shapePatterns` substitue `rawDeltaPct`, `lib/marketing-brief.js:414`) ;
- tri casse pour 0 % : `(c.netDeltaPct || -999)` (`:3361`) traite un effet net nul comme
  absent ;
- « +null% de monde » possible si la mediane visiteurs vaut 0 (`lib/marketing-brief.js:370`,
  rendu `:3343`).

Vocabulaire de confiance incoherent : `MKW_CONF` declare 4 niveaux dont `signal_faible`
(`:3329`) qu'aucun backend n'emet. Seuil 90 jours duplique front (`:3339`) et backend
(`lib/center-metrics.js:20`).

**Verdict d'onglet : ne merite pas d'exister seul** (argument complet en section 6).

### 4.4 Studio (`studio`)

L'architecture serveur est la plus saine de la zone : faits du centre uniquement, interdits
produit au sommet du prompt (`lib/content-studio.js:132`), scoring anti-promesse bloquant,
filet template (jamais de page vide), bandit d'angle (`recommendAngle`, `lib/content-studio.js:208`), ADN injecte dans le bloc stable (`:226`).

**Mais la surface jette le theatre de fabrication que le serveur persiste deja** :
`quality.iterations` trace chaque passage avec mode et score (`lib/content-studio.js:219`,
`:238`, `:265`), `fixesFrom` produit les corrections lisibles en francais (`:187-199`,
`CRITERION_FIX_HINTS` `lib/marketing-agents.js:1336`) ; rien n'en est montre. Pendant les
5-20 s, l'utilisateur voit un rectangle qui brille et une phrase figee. L'ecart avec
« l'atelier ou l'on voit la matiere se fabriquer » n'est pas un manque de donnees : c'est de
l'affichage. `generationMode` (ai vs template) n'est jamais rendu (grep front : 0 occurrence),
le score non plus.

**Casse (verifie)** :
- pack mal classe si le gerant change de canal pendant la generation : la requete part avec
  `platform` lu au clic (`:2693`) mais le resultat est range sous `studioChannel` relu APRES
  l'await (`:2695`) ; les onglets canaux ne sont pas desactives pendant `studioBusy` (`mkBrStudioChannel` `:2681-2684`, aucune garde) ;
- persistance promise jamais branchee : `studioPacks` existe cote serveur (`api/ops.js:360-365`,
  `listTodayPacks` `lib/content-studio.js:287-302`) mais aucun appel front : apres un reload,
  regenerer repaie un appel LLM pour un pack deja en base ;
- le brief tape est efface au clic (input sans value bindee, `:2673`) : le script QA contourne
  d'ailleurs le bug en re-remplissant (`scripts/marketing-ia-check.js:346-348`) ;
- budget temps au ras du plafond : 2 iterations x 15 s de timeout = 30 s de LLM seul, avec
  `maxDuration 30` (`vercel.json:12-14`) : pire cas, la fonction meurt et le pack template
  valide deja calcule est perdu ;
- surpromesse : « je reecris jusqu'a ce que ca passe » (`:2666`) alors que la boucle s'arrete
  a `MAX_ITERATIONS=2` et peut rendre un pack review ; en mode template la phrase s'affiche
  aussi, alors qu'aucune reecriture n'a eu lieu ;
- le mot « angle » designe trois choses a l'ecran (l'input, le theme du jour du badge,
  l'angle du bandit jamais montre).

### 4.5 Concurrents (`rivals`)

Le seul onglet dont chaque bloc vivant passe le test de la loi 2 : signaux prix/offres
extraits des sites (`lib/competitor-watch.js:218-259`), note Google, deep-link Meta Ad
Library (zero scraping, zero cout), colle-un-post qui produit une riposte ET des regles
d'ecriture reinjectees dans les prompts du Studio (`lib/content-studio.js:226`).

**Casse (verifie)** :
- l'erreur avalee et collante (section 2) : le trou principal ;
- **l'apprentissage est invisible** : le backend renvoie `adn` + `dnaLearned`
  (`lib/competitor-watch.js:505-514`), le front ne les rend jamais (grep : 0 occurrence).
  Le geste le plus rentable de l'onglet ne montre pas son benefice : le gerant ne
  recommencera pas ;
- la riposte est un cul-de-sac : aucun bouton « en faire un post » vers le Studio ;
- le texte colle est perdu en cas d'echec d'analyse (re-render efface la textarea, `:3445`) ;
- « j'inspecte leurs sites chaque nuit » (`:3433`, seconde occurrence vivante `:3451`) : le
  sweep tourne a 08:15 UTC, soit ~10:15 heure belge (`vercel.json:22-23`). C'est chaque
  matin ;
- inputs etiquetes par placeholder seul (`:3438-3439`, `:3445`) : accessibilite faible.

### 4.6 Resultats (`results`)

**Chevauchement confirme avec Aujourd'hui** : `mkwHero` est rendu par les DEUX onglets
(`mkwSurface` case 'results' `:3557` et case 'today' `:3559`) sur la MEME donnee (un seul
fetch, un seul `mkBrief.data.paie`, meme etat period/payOpen partage : ouvrir le detail sur
l'un l'ouvre sur l'autre). Seul l'eyebrow change : « La paie » vs « Ce que le marketing a
rapporte » (`:3283`). Le meme chiffre vit deux fois sous deux noms.

**Mensonges de libelle (verifies dans le SQL)** :
- « generes par tes publications » (`:3269`) : les 6 sources sont toutes des MESSAGES
  (relances, anniversaires, reactivation, campagnes, sequences, composer :
  `lib/marketing-roi.js:16-23`), jamais un post Facebook/Instagram, qui n'a pas de
  destinataire tracable. La branche zero du meme heros dit d'ailleurs « messages » (`:3271`) ;
- « venues liees » compte les resas `pending` (seule `cancelled` est exclue,
  `lib/marketing-roi.js:71`) : une resa non honoree n'est pas une venue ;
- « le dernier message qu'elle a VU » (`:3300`) : le SQL ne filtre que sent/delivered
  (`:59`), jamais l'ouverture. « Recu » serait exact ;
- le chip « clics avis Google » vient d'un template transactionnel explicitement EXCLU des
  sources marketing (`lib/marketing-roi.js:7-8`, `:97-100`) ;
- conflation « jeune » / « rien envoye sur la fenetre » : `young = roi.sent === 0`
  (`lib/marketing-brief.js:523`) : un centre avec 6 mois d'historique qui n'a rien envoye sur
  7 jours lit « Encore trop tot pour un chiffre honnete ».

**Les recus (brZ4) sont le bon objet** : mesure J+14 reelle (`lib/center-metrics.js:1011-1096`),
effet net vs baseline jour x vacances x meteo, honnetete exemplaire (% de frequentation, pas
de faux euros par action). Deux defauts sur « On le refait ? » : le toast « premiere
position » (`assets/staff-pages-v2.js:2742`) est faux (clone insere sans due_date,
`lib/center-metrics.js:1328-1331`, trie dernier par `lib/marketing-brief.js:212`, voire
ejecte par slice(0,6)) ; et `redoInsight`
selectionne par id sans filtre center_id (`:1299`, meme faille dans `setInsightStatus`
`:1211-1218`) : isolation multi-tenant trouee (gravite faible aujourd'hui : meme client,
permission requise ; inacceptable pour un SaaS multi-tenant).

---

## 5. Les 7 defauts du cerveau : verdicts

Tous verifies par des agents adverses dont la consigne etait d'infirmer. **7 sur 7
confirmes** (D par mesure directe de l'orchestrateur apres echec de son agent sur limite de
session).

**A. CONFIRME (serieuse). Le garde-fou anti-invention du Stratege est a moitie mort.**
`generateMarketingPlan` ecrase le champ `faits` des semaines IA par la version deterministe
AVANT `verifyPlanGrounding` (`lib/marketing-strategist.js:303`), et `PLAN_SCHEMA`
(`:240-249`, additionalProperties false, pas de propriete faits) empeche de toute facon le
modele de declarer des faits : la branche « fait invente » (`:213-215`) a `invented` toujours
vide dans le chemin prod. Seuls l'index et les dates sont controles (`:205-207`). Un evenement
invente dans `pourquoi`/`objectif`/`actions` passe sans filtre (`:311-314`), seule la consigne
du prompt s'y oppose (`:261-262`). Le test qui « prouve » la branche invente alimente `faits`
a la main, une forme que la prod ne produit jamais (`scripts/marketing-strategist-check.js:59-67`).
Honnetete due : ce code date d'hier et le rejet « semaine hors horizon » observe en prod etait
reel, mais la fierte affichee sur la branche invente etait fausse. Correction : ne plus
ecraser `faits` avant verification, exposer `faits` dans le schema (le modele declare ce
qu'il utilise), scanner le texte libre contre les labels des autres semaines.

**B. CONFIRME (serieuse, latente). `weekConfidence` ne scope pas les patterns a la semaine.**
`patterns.find((p) => Number(p.n) >= 3 && p.confidence !== 'exploratoire')`
(`lib/marketing-strategist.js:118`) ignore la semaine passee en argument : des qu'UN pattern
qualifiant existera, les 8 semaines afficheront « Mesure chez nous », y compris en ecrasant
« calendrier » sur les semaines ancrees. Dormant uniquement parce que la table est a 0 ligne.
Correction : matcher le contexte du pattern (trigger) contre les types presents dans
`week.calendarFacts`.

**C. CONFIRME (serieuse). Le scorer recompense l'invention de chiffres.**
`proof_from_data` : `let score = 58; if (hasNumbers) score = 78` avec `hasNumbers =
/\d/.test(text)` (`lib/marketing-agents.js:1240-1243`) : n'importe quel chiffre, invente ou
non, rapporte 20 points. `forbiddenClaims` (`:401-412`) ne couvre aucun motif prix/promo ;
`risk_guardrail` (`:1220`) non plus ; `llm-grounding-check` non plus
(`scripts/llm-grounding-check.js:49-54`). Un « -20% avant 17h » invente franchit la barre de
82 et sort etiquete « ready ». C'est le scenario « l'IA promet une promo que le client n'a
jamais decidee », et ce repo documente deja que le prompt seul ne suffit pas (Karting VR).
Nuance : les faits contiennent UN prix (golf o'clock Gembloux, `ops-knowledge/centers.json:239`),
sans effet car le scorer ne compare jamais. Correction : bloquer tout motif prix/promo absent
des faits, et ne crediter `proof_from_data` que si le chiffre correspond a un fait connu de
CE centre.

**D. CONFIRME (mineure), par mesure directe.** Le `stableSystem` reel d'une generation studio
(avec l'ADN prod) fait 8 281 caracteres, soit ~2 200-2 600 tokens (mesure du 2026-07-17,
`COPY_SYSTEM_CORE` = 5 035 chars, `dnaBlock` facebook = 2 850 chars). Le minimum cacheable de
Haiku 4.5 est 4 096 tokens : `cache_control: ephemeral` (`lib/llm-client.js:38`) est un no-op
silencieux, l'ADN est paye plein tarif a chaque appel. Precision due (relecture adverse) : le
commentaire du module documente DEJA ce risque en toutes lettres (« sous le minimum cacheable
c'est un no-op silencieux », `lib/llm-client.js:14`, commit 83e03cd du 2026-07-14) : le code
etait honnete, l'hypothese du prompt de campagne ne l'etait pas sur ce point. Ce qui reste
vrai : rien ne MESURE ni n'alerte quand le bloc stable est sous le seuil, donc personne ne
sait que le cache dort. Impact financier negligeable (0,83 USD/mois). Correction : un controle
qui loggue la taille du bloc stable vs le seuil du modele, ou regrouper les appels ; pas de
proces au commentaire.

**E. CONFIRME (serieuse, dormante). Le budget est une passoire sur le chemin OpenAI.**
`PRICES` ne couvre que haiku/sonnet (`lib/llm-budget.js:12-15`), tout modele inconnu est
facture au tarif Haiku, LE MOINS CHER (`:20`) ; et `recordSpend` n'est appele que dans
`callAnthropic` (`lib/llm-client.js:66`) : `callOpenAi` (`:97-131`) ne debite jamais rien.
Le garde `isBudgetExhausted` existe sur les deux chemins (`:153`) mais ne peut pas se
declencher si rien n'est enregistre. Dormant aujourd'hui (la prod tourne sur Anthropic,
prouve par `llm_spend` ecrit uniquement par le chemin Anthropic), mais `OPENAI_API_KEY` est
documentee comme variable optionnelle du worker (`docs/railway-ops-worker.md:43`) : le
scenario d'activation est reel. **A corriger avant tout nouvel appel IA en prod en RUN B**
(exige par le prompt de campagne). Correction : `recordSpend` dans `callOpenAi`, tarifs
OpenAI dans `PRICES`, fallback modele-inconnu au tarif le plus CHER.

**F. CONFIRME (serieuse). Deux doctrines d'acceptation IA coexistent.**
`content-studio.js:246` : l'IA gagne des qu'elle passe la barre absolue (82), avec le
commentaire qui documente le piege constate en reel (rules 87 vs ai 86, `:239-245`). Mais
`marketing-agents.js:997` garde `aiScore.score >= templateScore.score` sur le chemin du cron
(`cron-tasks.js:162` vers `runMarketingAgentCycle` `:1618` vers `buildBestDraftForPlatform`
`:986`), avec le MEME scorer taille pour le template (`scoreDraft` importe par les deux
modules). L'appel LLM payant part AVANT la comparaison (`:993`) : quand l'IA perd, on a paye
pour un draft jete (`rejectedAi`, `:1000-1012`). Correction : une seule doctrine, la barre
absolue partagee, le template en filet.

**G. CONFIRME (serieuse). Les regles ADN sont departagees par leur LONGUEUR.**
Tri de `loadDnaRules` : confiance, puis canal, puis `length(regle)` ASC, limit 12
(`lib/marketing-dna.js:41-43`, `:24`). Or (a) aucun chemin de prod ne peut creer une regle
« solide » (les deux voies plafonnent a plausible : `_mkdev/recolte.js:39`,
`lib/competitor-watch.js:494`), donc la section « Regles etablies » de `renderDnaBlock`
(`:63-66`) est structurellement toujours vide ; (b) plus fort que l'hypothese : AUCUNE regle
n'a de canal non vide (l'ingestion recherche ingere sans channel, `_mkdev/recolte.js:49`, colle-un-post passe
channel:'' en dur, `competitor-watch.js:497`), donc le 2e critere est lui aussi inerte.
[Correctif de l'orchestrateur : des canaux ont ete assignes en base a la main le 16/07
(email 5, linkedin 2, sms 1, transverse 21) ; le constat de l'agent reste vrai pour toute
regle FUTURE, l'ingestion ne pose toujours pas de canal.] A l'interieur du palier plausible,
la coupe des 12 sur 28 se fait par longueur croissante : les regles longues ne rentrent
jamais, quelle que soit leur pertinence. Le commentaire promet « les meilleures regles
d'abord » (`:19`) mais rien ne mesure « meilleur ». C'est le coeur mecanique du « l'IA n'est
pas folle ». Correction : critere de pertinence reel (angle matche contre le brief/theme du
jour, canal alimente a l'ingestion, feedback des plans valides), plus jamais la longueur.

**Decouvertes hors liste, remontees par la cartographie du cerveau** :
- `lib/marketing-strategist.js:274` lit `p.context_key`/`p.avg_net_delta` alors que
  `listMarketingPatterns` renvoie du camelCase (`contextKey`/`netDeltaPct`,
  `lib/center-metrics.js:1131-1141`) : le jour ou des patterns existeront, le stratege enverra
  `undefined` au modele. Dormant, meme famille que B.
- `buildCenterFacts` existe en DEUX implementations (marketing : `marketing-agents.js:391` ;
  email : `email-agent.js:89`) : deux verites terrain a maintenir.
- `market-playbook.md` n'est lu par AUCUN code (grep : zero hit) : documentation morte
  presentee comme couche active.
- Le scorer du studio ne verifie pas le grounding des NOMBRES, contrairement aux chemins
  polish qui rejettent tout nombre hors entree (`lib/center-metrics.js:761-768`,
  `lib/marketing-brain.js:500-503`) : deux niveaux d'exigence pour la meme doctrine.
- `bestTime` a trois sources possibles non hierarchisees (`content-studio.js:85`, `:119`,
  `marketing-brain.js:456-457`).

---

## 6. LA DECISION SUR LES ONGLETS : 6 deviennent 5

Test applique : loi 2 (chaque data paie sa place) et loi 3 (une categorie, pas deux), bloc
par bloc, ci-dessus. Constat central : la question « qu'est-ce que ca rapporte ? » est
aujourd'hui repondue a TROIS endroits (heros d'Aujourd'hui, patterns de Ce qui marche, heros +
recus de Resultats), sur la meme donnee source (`marketing_insights` mesurees + ROI), par le
meme fetch. C'est la violation la plus nette de la loi 3, et la source du sentiment de
desordre au-dela du CSS.

**Decision** :

1. **« Ce qui marche » disparait comme onglet.** A 18 jours de donnees et 0 pattern, rien
   sur cette surface ne change une decision qui rapporte : les verdicts causaux sont
   structurellement vides pour ~72 jours encore, les patterns sont une promesse, le pulse est
   du contexte. Un onglet qui repond « je ne sais pas encore » a chaque visite pendant des
   mois eduque le gerant a ne plus revenir. Ses contenus VIVANTS demenagent dans
   « Resultats » : les verdicts causaux et la memoire par contexte y rejoignent les recus,
   puisque c'est la meme question a deux granularites (unitaire vs agregee).
2. **Le heros euros quitte « Aujourd'hui »**. Il vit UNE fois, dans « Resultats », la maison
   unique de la preuve (heros + sources + recus + verdicts causaux + patterns). « Aujourd'hui »
   garde une ligne compacte « Ton marketing a rapporte X EUR ces 30 derniers jours, voir le
   detail » qui pointe vers Resultats : le rappel quotidien reste, la duplication meurt.
3. **Le pulse strip (CA 30 j, visiteurs, panier, attendus) sort de la zone Marketing.**
   Aucune de ces tuiles ne change une decision de PUBLICATION ; c'est du tableau de bord
   d'activite, deja porte par la page Direction. La valeur d'un creux rempli (panier moyen)
   peut vivre dans l'explication de la cellule radar, la ou la decision se prend.
4. **Le memo du matin fusionne dans le haut d'« Aujourd'hui »** (une ligne de voix, pas un
   bloc) : la voix de l'employe reste, la redondance (trois zones qui disent le meme fait)
   meurt.
5. Les quatre autres onglets restent : **Aujourd'hui** (le jour J : memo-ligne, radar, file,
   demande libre), **Le plan** (l'horizon 8 semaines, avec poignees), **Studio** (l'atelier),
   **Concurrents** (la veille + riposte + ADN).

Resultat : **5 onglets** : Aujourd'hui · Le plan · Studio · Concurrents · Resultats.
Chaque question du gerant a UNE maison : qu'est-ce que je fais la maintenant / que prevoir /
fabriquer un post / qui me prend des clients / qu'est-ce que ca a rapporte.

Note d'execution pour RUN C : `test:marketing-ia` verrouille le nombre exact d'onglets
(`scripts/marketing-ia-check.js`, assertion « les 6 surfaces dans l'ordre ») : le mettre a
jour dans le meme commit que la fusion, avec la raison. Le test fait son travail.

---

## 7. Architecture d'information cible (ce que RUN C execute)

### Aujourd'hui
1. Ligne de voix (ex-memo, 1 phrase max, signee, avec la vraie heure du cron).
2. Ligne paie compacte, lien vers Resultats (le heros demenage).
3. Radar 14 jours (inchange dans sa fonction ; reparer « Voir la proposition » au-dela de 3
   cartes ; l'explication de cellule porte la valeur d'un creux en euros via panier moyen).
4. File de propositions (inchangee dans sa fonction ; reparer la boucle focus de la barre de
   demande ; conserver le texte tape entre re-renders).
5. Etat d'erreur avec retry (nouveau, partage par toute la zone).

### Le plan
1. Bandeau d'honnetete (existant, garder).
2. 8 cartes semaine AVEC poignees : case « C'est fait » par action (vers `planActionDone`),
   bouton « Preparer ce post » (vers Studio pre-rempli), etat de semaine (fait / a faire /
   passee), fraicheur du plan affichee (`generatedAt`).
3. Skeleton pendant la construction (composant de progression du RUN B), erreur avec retry.
4. Correctifs backend prealables (RUN B) : defauts A et B, tokens fantomes (RUN C), centerId.

### Studio
1. L'atelier : au retour de generation, rejouer les iterations reelles (v1 notee X, corrections
   appliquees, v2 notee Y) depuis `quality.iterations` : la matiere existe deja, l'afficher.
2. Badge honnete : score + mode (IA / modele de secours) affiches ; retirer la surpromesse.
3. Brancher `studioPacks` au chargement (le pack du jour se recharge sans repayer).
4. Conserver le brief tape ; verrouiller le changement de canal pendant une generation.
5. Progression reelle si la generation passe par la queue (composant RUN B) ; sinon etat
   d'attente soigne sans etapes inventees.

### Concurrents
1. Reparer l'erreur avalee et collante (un echec reseau se dit).
2. Afficher l'apprentissage : « J'ai retenu N techniques de ce post » avec les regles
   (`adn`/`dnaLearned` deja renvoyes par le backend).
3. Pont riposte vers Studio (« En faire un post »).
4. Conserver le texte colle apres echec ; labels d'accessibilite ; « chaque matin » au lieu
   de « chaque nuit » ; retirer le pointeur mort du brief (`marketing-brief.js:283`).

### Resultats (la maison de la preuve)
1. Heros euros (seul exemplaire) avec libelles corriges : « messages » (pas « publications »),
   « recu » (pas « vu »), « reservations liees » (pas « venues » tant que pending compte), et
   la conflation jeune/inactif separee en deux etats distincts.
2. Detail des sources (existant, garder).
3. Recus J+14 (existants, garder) ; reparer le toast « premiere position » (poser une
   due_date au clone redo) et le scoping center_id de `redoInsight`/`setInsightStatus`.
4. Verdicts causaux + memoire par contexte (demenages de Ce qui marche), avec leurs 5
   mensonges latents corriges, affiches seulement quand ils existent (sinon une ligne
   « j'apprends encore », pas un onglet entier de promesses).

### Transversal
- Un seul vocabulaire CSS (`mkw-*`), suppression du code mort (`brZ1`, `brPulse`, `brFooter`,
  CSS orphelin, `br-radar-skel`), des tokens fantomes, du shim `.mkw-surface .br-*`.
- Une seule source de verite du centre courant, cablee sur le switcher reel.
- `ghost-token-check` committe dans le gate (echoue sur echantillon vide).
- Etats erreur partout, avec retry.

---

## 8. Cerveau IA cible (ce que RUN B execute, par gravite)

1. **centerId fantome** (section 1) : une source de verite, un test.
2. **E, budget** : recordSpend sur le chemin OpenAI + tarifs + fallback au plus cher, AVANT
   tout appel IA de verification en prod.
3. **C, scorer** : bloquer prix/promo hors faits ; `proof_from_data` ne credite que les
   chiffres presents dans les faits du centre.
4. **A, garde-fou du Stratege** : faits declares par le modele + verification du texte libre.
5. **F, doctrine unique** : barre absolue partagee, template en filet, sur les deux chemins.
6. **G, selection ADN** : pertinence (angle x theme du jour x canal) au lieu de la longueur ;
   canal pose a l'ingestion ; garde le plafond de 12.
7. **B, weekConfidence scope** + le cablage camelCase (`context_key` vs `contextKey`).
8. **D, cache** : trancher (documenter l'inactivite ou restructurer les appels).
9. Unifier les deux `buildCenterFacts` ; supprimer `market-playbook.md` ou le brancher ;
   hierarchiser `bestTime`.
10. Chantier progression live (spec detaillee dans le prompt de campagne, RUN B chantier 1) :
    migration 0028 additive nullable, etapes reelles ecrites par les handlers, action `job`
    en lecture, poller client, premiere etape visible en moins de 5 s.

---

## 9. Ce qui n'a PAS ete verifie (honnetete du run)

- Aucun rendu navigateur : la boucle focus, les squelettes infinis, le trou d'espacement de
  works et les consequences visuelles des tokens fantomes sont demontres par le chemin de
  code, pas observes a l'ecran.
- La correction eventuelle du centerId par la session cote serveur (les permissions par
  centre pourraient attenuer la gravite ; le front envoie quand meme le mauvais centre).
- Le contenu prod de `marketing_competitors`/`competitor_snapshots` (combien de concurrents
  configures) et la presence de `GOOGLE_MAPS_API_KEY` (la note Google peut etre vide).
- La repartition par statut des 6 `marketing_insights` (donc si la liste des recus est vide
  ou peuplee aujourd'hui).
- La justesse statistique de `computeAttendanceOutlook` (entrees/sorties verifiees, pas le
  modele).
- Les logs d'execution reels des crons Vercel (schedules lus dans `vercel.json` seulement).
- Le minimum cacheable de 4 096 tokens pour Haiku 4.5 vient de la connaissance du modele et
  du prompt de campagne, pas d'une lecture de la doc du jour (l'agent D est mort avant ; la
  mesure des 2 200-2 600 tokens, elle, est directe et reproductible).
