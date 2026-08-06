# MARKETING-AGENT-DESIGN : la console de l'employe marketing

Date : 2026-08-06. Statut : execute (ce document decrit ce qui est construit, pas un souhait).
Complement de AUDIT-MARKETING.md (2026-07-17) : l'audit reste la reference des defauts du
cerveau ; ici on ne traite que l'EXPERIENCE de la zone Marketing.

## 1. Diagnostic du rendu actuel (capture du 2026-08-06, avant refonte)

Verdict en une phrase : le fond et l'ambiance sont bons, la COMPOSITION est un empilement de
petits panneaux egaux qui se lit comme un tableau de bord fragmente, pas comme un employe.

Mesure sur la capture (1440 px, dark) :

- une seule colonne etroite (~900 px utiles) : brief, propositions, radar, veille se suivent
  verticalement, tous au meme rang visuel ; rien ne dit « ici on decide, la on consulte » ;
- la demande du gerant est UNE ligne coincee en bas du panneau propositions : l'entree la
  plus importante de la page (parler a l'agent) est un champ perdu ;
- 4 compteurs muets en tete : ils comptent, ils ne font rien faire (aucun n'est cliquable) ;
- aucun espace d'actions : ce qui attend une decision, ce qui tourne cote serveur et ce qui
  est a surveiller sont melanges au fil des panneaux ;
- 5 onglets co-egaux dont « Aujourd'hui » : la maison est un onglet parmi d'autres.

Ce qui est deja BON et se conserve tel quel : le fond de points interactif (halftone WebGL +
repli canvas 2D), l'en-tete identite + pastille « analyse chaque matin », le cablage complet
des actions (publier/refuser/variante/angle/remplir un creux), l'hygiene de file (perimees,
doublons), les etats d'erreur avec retry, l'honnetete des textes (aucun chiffre invente).

## 2. Architecture cible : le bureau de l'agent

Trois etages, un seul flux :

```
mkwHead        identite de l'agent + centre selectionne + derniere analyse + rail (4 profondeurs)
mkw-desk       grille desktop : LE FIL (conversation, large) | LE TABLEAU (actions, 360 px, sticky)
  mkw-fil        tour 1 : le brief du matin (texte + radar 14 j integre + veille/impact en
                 pieces de contexte depliables inline)
                 tours suivants : chaque proposition = un tour de l'agent (titre de decision,
                 pourquoi maintenant, faits, UNE action) ; une proposition nee d'une demande
                 rend d'abord le tour du gerant (sa phrase citee) puis la reponse
                 tours de session : questions du mode Demander + reponses assemblees
  mkw-composer   fixe en bas du fil : modes « Demander » / « Creer », suggestions courtes
                 tirees des donnees reelles, envoi clavier, frappe qui survit aux re-rendus
  mkw-board      « A valider » (propositions en attente d'une decision humaine)
                 « En cours » (ce qui existe VRAIMENT cote serveur : mesures J+14 ouvertes,
                 construction du plan avec ses etapes reelles, generation Studio en vol)
                 « A surveiller » (jours creux du radar, concurrents qui ont bouge,
                 evenement qui arrive, apprentissage encore trop jeune)
```

Les profondeurs (rail discret, 4 destinations maximum) : **Plan** (ex Le plan), **Creations**
(ex Studio), **Marche** (ex Concurrents), **Impact** (ex Resultats). « Aujourd'hui » n'est
plus un onglet : c'est le bureau, l'etat par defaut, et chaque profondeur porte son retour.

## 3. Les deux modes du composer (contrats reels, zero fiction)

- **Creer** : POST `propositionCreate` (moteur deterministe + ADN cote serveur, aucun appel
  IA requis). Le livrable arrive comme OBJET REEL : la file se recharge, le fil rend le tour
  du gerant + la proposition, le tableau la classe « A valider » avec une entree animee
  (200 ms, opacite + translation) parce qu'une action vient de naitre. Pendant la requete :
  un seul etat d'attente honnete, jamais d'etapes inventees.
- **Demander** : il n'existe AUCUN endpoint d'analyse libre et aucun credit IA. La reponse
  est donc ASSEMBLEE EN LOCAL depuis le bundle deja charge (radar, panier moyen mesure,
  veille, plan, paie, verdicts causaux) : chaque nombre affiche vient du serveur, chaque
  reponse cite sa source a l'ecran (« assemble depuis le brief du matin »), et une question
  hors de ce perimetre recoit un « je ne sais pas encore faire ca » + la voie Creer. C'est
  une COUCHE DE ROUTAGE deterministe, pas un modele simule : rien n'est invente, jamais de
  fausse chaine de pensee. Les tours Demander sont des tours de session (non persistes) ; au
  rechargement, le fil se reconstruit depuis les objets serveur, qui sont la verite.

## 4. Conserve / fusionne / retire

| Sort | Quoi |
|---|---|
| Conserve tel quel | fond de points (halftone + repli 2D), atelier d'une proposition (reseaux, papier, copier, publie ?, autre angle), radar et son explication par jour, Plan avec poignees (« C'est fait » -> planActionDone, pont Creations, fraicheur), Creations (packs, badge honnete, fabrication reelle), Marche (concurrents, colle-un-post, ADN retenu), Impact (heros euros seul exemplaire, recus, verdicts, memoire par contexte), etats d'erreur avec retry, hygiene de file |
| Fusionne | brief + radar + veille + pointeur impact -> UN tour d'ouverture du fil ; barre de demande + bouton Preparer -> le composer a deux modes ; compteurs -> les groupes du tableau (ce qui attend = A valider, jours creux/veille = A surveiller, mesure = En cours) |
| Retire | la rangee de 4 compteurs muets (`mkwCounters`), les panneaux egaux du feed (`mkw-brief`/`mkw-props`/`mkw-radar-card`/`mkw-veille` en tant que panneaux), l'onglet « Aujourd'hui » du rail (la maison n'est pas un onglet), le CSS devenu orphelin apres bascule (verifie par grep avant suppression) |
| Nouveau | `mkw-desk` (grille fil + tableau), tours du fil, composer 2 modes + suggestions reelles, tableau d'actions 3 groupes, reponse Demander deterministe sourcee, remise a zero de TOUT l'etat marketing au changement de centre (le centre gouverne : plus jamais de donnees d'un autre centre a l'ecran), profondeur ouverte avec intention (veille -> Marche avec le concurrent mis en evidence) |

## 5. Regles tenues (les memes que le reste de la console)

Tokens uniquement (pinlane.css), zero `!important`, zero couleur en dur ; nombres en
`--font-data` tabular-nums ; motions 150-220 ms transform/opacity, entree d'une action
180-260 ms, `prefers-reduced-motion` respecte ; contrastes AA ; chaque lecture asynchrone a
squelette + erreur + retry ; chaque bouton declenche un contrat serveur reel ou une
navigation reelle (Product Rule §9) ; le gate `scripts/marketing-ia-check.js` est reecrit
dans le meme mouvement avec contre-preuves (zero theatre, zero chiffre hors bundle dans une
reponse Demander, scope centre prouve par bascule).
