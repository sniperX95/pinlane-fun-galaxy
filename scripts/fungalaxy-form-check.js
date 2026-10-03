// LE FORMULAIRE FUN GALAXY (fungalaxy.html) FAIT LE MEME PARCOURS QUE LE TUNNEL,
// SUR LES MEMES API, ET CE QU IL AFFICHE VIENT DE CES API.
//
// Le formulaire est une seconde interface au-dessus de public-booking-meta,
// public-availability et public-reservations. Ce gate joue le parcours entier
// dans un navigateur, sur le MEME mock que l ecran regarde a la main
// (scripts/dev-tunnel-server.js : catalogue mocke, calendrier REEL de la
// Wallonie sur la table servie, disponibilite REELLE sur un instantane vide,
// POST factice qui garde le corps recu), et confronte chaque ecran a la
// reponse d API qui l a produit. Aucun montant, aucune heure, aucun jour ferie
// n est attendu « en dur » : l oracle est relu sur les memes routes, cote Node.
//
// LES PROPRIETES (v3.2, 2026-09-22) :
//   [A] MONTAGE : la page se charge, le catalogue est lu (le jour propose est le
//       premier jour ouvert, et son indice dit « Aujourd hui » ou « Demain »
//       quand c est le cas), le fil des 5 etapes est rendu, la photo est
//       decodee, le poids SERVI (apres tools/build-public.js, qui retire les
//       commentaires) reste celui d un poste faible (a analyser et a
//       transferer, plafonds rederives sur mesure plus bas, BUDGET_SERVI et
//       BUDGET_TRANSFERE), aucune photo 1600 demandee sur un ecran de 1440, le « ? » du
//       titre ne part jamais seul sur sa ligne.
//   [A2] CALENDRIER PAR MOIS : chaque mois, du mois en cours jusqu a l horizon
//       de reservation (un an), est le calendrier servi jour par jour (ferme
//       grise, horaires ou motif dans le titre, point ferie/conge) ; les mois
//       au-dela des 45 premiers jours se chargent a la demande (calendarFrom) ;
//       la fleche « suivant » s arrete a l horizon, et chaque mois glisse dans
//       son sens (jamais a la reouverture) ; le clavier se deplace de
//       jour ouvert en jour ouvert et Entree choisit ; un lundi de conge
//       scolaire est ouvert ; le nombre de personnes se TAPE (borne a 240,
//       dite sous le compteur avec le numero du centre).
//   [A3] EMPILEMENT : le calendrier ouvert passe DEVANT le compteur et le
//       bouton ; dans une colonne etroite, seul le libelle de l etape en cours.
//   [B] ACTIVITES : une carte par activite, prix « des X » = minimum de la
//       grille servie, Fun Run qui TOURNE au-dela de 5 joueurs ; cochee, une
//       carte ouvre SOUS elle un tiroir de pastilles (toutes les options de la
//       grille, prix de chacune), la retenue part dans le programme, les
//       fleches du clavier passent d une option a l autre, et les cartes d une
//       rangee gardent la meme hauteur ; un tiroir ferme sort du parcours
//       clavier, un tiroir ouvert y entre.
//   [C] HEURES : une piste par activite planifiee, TOUTES les heures du jour
//       rangees en trois menus (matin, apres-midi, soiree), chacune dans l etat
//       du moteur : possible, SERREE (choisissable, la visite finira a la
//       fermeture), A DECALER (une AUTRE activite posee se deplace ; un
//       chevauchement avec sa propre partie n est pas un decalage : le moteur
//       juge a cote le DEPLACEMENT de cette partie, `move`, et l heure en prend
//       le verdict, jamais un « pris » qui ne se prend pas), IMPOSSIBLE, ou A
//       VOTRE PARTIE (l heure que joue le groupe suivant d une heure RETENUE,
//       lue dans le plan ; l heure proposee n emporte rien ; elle reste
//       marquee « partie N » ou « 2e groupe » mais SE CHOISIT : la partie y
//       part, sauf quand le moteur refuse ce depart) ;
//       SOUS CHAQUE PLAGE, chaque heure qui n est
//       ni libre, ni choisie, ni proposee est expliquee une fois et une seule,
//       avec la raison du moteur mot pour mot, l activite et la plage reelle
//       qui se deplaceraient, ou le groupe, sa taille et son jeu ; toucher une
//       heure qui ne se prend pas eclaire SA ligne sans rien demander ; le
//       menu ouvert suit l heure choisie ou proposee ; l heure se centre dans
//       sa case ; poser une heure met a jour les cases SUR PLACE (meme noeud,
//       aucun deplacement : plus de tremblement) ; le bloc « votre visite »
//       est la reponse de la route (arrivee et son avance sur la premiere
//       activite, chaque PARTIE a son heure jusqu a la fin de son dernier
//       groupe, ses groupes et ses pistes, les parties laissees a l equipe,
//       activites libres, fin, prix, son detail seulement quand la somme des
//       lignes EST le prix, paiement, ce qui manque) ; plusieurs parties de
//       laser se comptent (« 1 heure choisie sur 2 », une ligne par partie).
//       Tour de l ecran des heures
//       (lot 2) : le menu d une plage dit ce qui reste « au choix » (ou « une
//       seule possible »), sans mot de planning ; l heure touchee s entoure
//       des le toucher et une onde part d elle quand le plan du serveur la
//       retient, JAMAIS sur un plan refuse ; pendant le premier calcul, une
//       carte-squelette de piste (ni piste, ni heure, ni plan), dont seules
//       les barres respirent, immobile en mouvement reduit ; les heures d un
//       menu replie sortent du parcours clavier ; une seule voix (#fgLive,
//       hors des scenes, la zone des heures se tait) dit la visite comme le
//       bloc l ecrit, prix partiel compris ; « revenir a l heure proposee »
//       masque ne fait jamais tomber le focus sur la page.
//   [D] CONTACT : le recapitulatif ENTIER est a cote du formulaire (ouvert,
//       pose sur la photo, a cote de la colonne, contenu par la scene) ; un
//       envoi vide marque les 4 champs, l occasion et la case, chaque erreur
//       liee a son champ (aria-invalid, aria-describedby), celle de la case
//       dite en mots ; le premier champ a corriger prend le focus et fait
//       seul son petit « non », une fois, et chaque erreur glisse en place ;
//       L OCCASION (2026-09-24, « pour avoir les stats de qui vient et
//       pourquoi ») : un groupe radio nomme et requis, EXACTEMENT les valeurs
//       que le serveur garde (OCCASION_VALUES), les fleches d une a l autre
//       (un seul arret de tabulation), « Autre » ouvre sa precision
//       facultative ; tout rempli sauf elle, on reste et le focus y va ;
//       Entree fait avancer d un champ sans envoyer (du telephone a
//       l occasion si aucune n est choisie, sinon a la case si elle n est pas
//       cochee) ; Entree sur un numero faux garde le champ, qui
//       reprend le focus pour que son erreur soit lue ; « +32 (0) » passe ;
//       une faute de frappe dans le domaine de l e-mail fait proposer
//       l adresse probable, en question, que le clavier atteint et qu un
//       toucher accepte, jamais pour le domaine d un vrai pays different ;
//       rempli, il passe au recapitulatif.
//   [E] RECAP + ENVOI : le total est LE prix de la reponse ; le paiement sur
//       place dit ses deux moyens (carte, especes) avec leurs deux logos ; le
//       recapitulatif de l ecran des coordonnees est EXACTEMENT celui-ci ; le
//       POST porte
//       centre, date, heure, groupe, programme, heures posees, plan, contact et
//       occasion (la cle que le serveur garde), rien d autre sur la personne ;
//       le recapitulatif relit l occasion ; plus d etoiles au-dessus du titre ; le
//       titre final dit ce que le serveur a repondu (reservation confirmee, ou
//       demande envoyee) ; la barre des etapes finit pleine, balayee une fois.
//       Le recapitulatif relit les coordonnees qui partiront, sans heure
//       redite ; « Valider ma reservation » dit qu aucun paiement ne se fait
//       en ligne, sans promettre d e-mail ; chaque etape se modifie d un toucher
//       sans perdre les coordonnees ; le telephone part sans son « (0) » et
//       notes vide sans mot pour l equipe. L ecran final est un recu :
//       l arrivee du plan rendu, chaque activite, l e-mail annonce seulement
//       parce que la reponse le met en file, ce que couvre le montant ;
//       l anneau suit le verdict (coche et confettis : confirmee).
//   [F] EMBARQUE : embed.js monte /fungalaxy/<centre>?embed=1 ; dans le cadre,
//       notre bandeau et nos halos disparaissent, le fond de reference est
//       celui du site (les bords de la photo s y fondent), la hauteur suit le
//       corps, chaque etape previent l hote, la reservation pousse
//       pinlane_booking dans le dataLayer sans donnee personnelle ; le mot
//       pour l equipe est repris au recapitulatif et part dans notes.
//   [G] TELEPHONE (390 px) : le sous-titre des heures ne commence jamais une
//       ligne par « · » ou « + » et ne laisse aucun mot seul (« Game ») ; les
//       fleches du mois font 44 px et une etape faite se touche au-dessus de
//       son segment ; calendrier dans l ecran, aucun defilement
//       horizontal, pastilles et heures dans leurs cases, poser une heure ne
//       fait rien sauter ; a l ecran des coordonnees, le recapitulatif se
//       replie sous sa ligne de resume et un bouton de 44 px le deplie, les
//       champs ecrivent en 16 px, une adresse proposee tres longue se coupe
//       dans la colonne ; au recapitulatif, une erreur d envoi s affiche sous le
//       bouton et dans l ecran, un 409 ramene aux heures recalculees, une
//       coupure ne pousse pas a renvoyer.
//   [H] MOUVEMENT REDUIT : plus aucune animation, rideau et halos compris ;
//       la coche de l ecran final est dessinee d office.
//   [K] LES PHOTOS DU CENTRE, QUI TOURNENT (2026-09-23) : le script ne cite
//       que des photos dont la provenance est prouvee (image d origine sur le
//       site du client, page qui dit le centre, envoi apres le changement
//       d enseigne), en paysage, en 800 et en 1600, cadre declare exact ;
//       chaque centre montre SES photos sur ses six ecrans, jamais deux fois
//       la meme d un ecran au voisin, la premiere chargee en priorite ; l ordre
//       depend du tirage de la visite ; un centre sans photo prouvee n en
//       montre aucune ; et les six photos tirees au chargement restent celles
//       du parcours jusqu au bout (verifie en [E]).
//   [L] LISIBLE SUR N IMPORTE QUELLE PHOTO (2026-09-23) : sur les sept
//       ecrans du parcours (les formules comprises), a 1440, 1920, 1024 et
//       375 px, chaque texte visible garde 4,5:1 (3:1 en grand) sur la photo
//       LA PLUS CLAIRE POSSIBLE (chaque photo remplacee par un blanc pur, celle
//       des cartes montree comme au survol), et hors photo sous le coeur des
//       halos. Un controle inactif en est ecarte (WCAG 1.4.3). Et l accent
//       d une capitale ne mord jamais la ligne du dessus d un titre
//       (interligne reel contre hauteur de l accent lue dans la police) ; au
//       dernier ecran, le telephone et l e-mail du centre sont des liens.
//   [M] /reserver/libramont (2026-09-23) : vercel.json sert cette adresse
//       par fungalaxy-site.html AVANT la regle generique du tunnel ; la page
//       est dans les listes du build public et du gate de fuite ; elle porte
//       leur en-tete a leurs mesures (162 px, logo de 196 px, « Libramont »,
//       leurs quatre liens vers leur vrai site, « Réserver »), compare AU
//       PIXEL a la capture de leur page (encre des mots du menu, capitales,
//       bouton, centre), et monte le formulaire par embed.js, en mode
//       embarque, dans le bloc de la copie locale de leur page (1440 px au
//       plus, centre, 32 px au-dessus, 72 en dessous) ; le cadre prend la
//       hauteur du formulaire, a 1440 px comme sur telephone (ou il grandit
//       avec lui) ; sur telephone, un menu, rien ne deborde ; une reservation
//       va jusqu a l ecran final (une demande que l equipe doit verifier ne
//       s y fete pas : enveloppe, aucun confetti, accuse de reception) ;
//       formulaire eteint par l equipe (interrupteur d embed.js), la page
//       renvoie au parcours classique du centre au lieu de rester vide.
//   [I] FORMULES A L ECRAN + FUN RUN QUI TOURNE (2026-09-22) ; a zero, la
//       barre dit quoi faire ; les onglets obeissent aux fleches (motif APG,
//       un seul arret de tabulation) et la pastille couvre l onglet choisi ;
//       une reponse des heures ne sert qu a la demande qui l a produite (le
//       mode, la formule, le programme), meme arrivee apres un changement
//       d onglet. Toucher une formule refusee dit sa raison a la voix. Un
//       jour sans horaire n est plus une impasse : un seul avis (dit aussi a
//       la voix), et deux sorties de 44 px dans la zone des heures (jour ou
//       groupe, formule), qui menent ou elles disent ; une panne des
//       disponibilites se dit a la voix avec le texte de son avis. Une
//       formule garde au recapitulatif l heure de debut envoyee.
//   [J] LES TOURS DU 2026-09-23 : aucune photo de l ANCIEN centre nulle part
//       (ni citee, ni dans le depot) ; le compteur
//       de personnes prend la largeur de son nombre et son encre tombe au
//       milieu de la case SUR LES DEUX AXES ; la barre des etapes remplit un
//       segment par etape atteinte, dit « 01/05 » la ou les libelles tombent,
//       et bouge a chaque changement d ecran (remplir, blanchir, vider),
//       jamais en boucle ; les trois etiquettes (horaire, ferie, dossier) n ont
//       plus de capsule, un temoin positif prouvant que la mesure sait en voir
//       une ; un groupe scinde par le moteur est DIT sur sa piste en une
//       phrase (combien de groupes, de quelle taille, lus dans le plan), et
//       rien n est dit pour une activite qui tient en une fois ; le bloc de la
//       visite dit chaque partie avec ses groupes ; a 40 personnes, l heure
//       proposee n emporte rien, l heure retenue emporte celle de son 2e
//       groupe, qui reste marquee « partie 1 » et se CHOISIT (la partie suit
//       son 1er groupe ; quand le moteur refuse ce depart, elle se lit sans se
//       prendre et la toucher eclaire sa partie) ; plus aucun « pris » :
//       l heure qui chevaucherait sa propre partie la DEPLACE, avec le verdict
//       du moteur sur ce deplacement ; le cadre des parties dit « n heures
//       choisies sur N », une ligne par partie ; et le bowling qui
//       chevaucherait dit l activite ET la
//       plage reelle qu elle occupe ; chaque heure expliquee pointe sa ligne
//       (aria-describedby) ; la barre, la legende et les raisons gardent
//       4,5:1 au PIRE moment (pixels peints sur la photo la plus claire
//       possible, et halos au plus clair) ; la duree totale annoncee est l ecart entre l arrivee et la
//       fin, recalcule en Node, dans le bloc de visite comme au
//       recapitulatif ; la legende des heures perd ses gloses sur telephone.
//   [N] LA BARRE DU BAS (2026-09-23, revue le 2026-09-24) : sur les
//       activites et les heures, elle reste a sa place, en fin d ecran, et ne
//       suit jamais l ecran (telephone 390, 1440x900, embarquee), bouton
//       inactif ou actif ; en bas de page elle montre son resume sans rien
//       couvrir ; sur l ecran des heures elle dit les heures et le prix de la
//       visite, ceux de la reponse, et suit une heure posee (seul le chiffre
//       qui a change y roule) ; au clavier, ce qui prend le focus est dans
//       l ecran et visible (WCAG 2.4.11) ; embarquee, une carte focalisee
//       sous l ecran de l hote y remonte avec son anneau entier, meme posee a
//       cheval sur le bas de cet ecran (2026-09-24 : Chromium y ignore la
//       marge de defilement en faisant defiler la page parente ; le cadre
//       demande la bande a l hote).
//       Le bouton qui avance
//       s eveille une fois quand il devient cliquable (« Continuer » au premier
//       choix, « Garder » a l arrivee sur les heures), et rend sa classe ;
//       cocher une carte fait claquer sa case et rouler son prix, une fois.
//   [O] ON DESCEND PARTOUT, LE CALENDRIER SE VOIT EN ENTIER (2026-09-23,
//       retour de Movsar : « le calendrier on sait pas tout voir, trop gros,
//       on sait pas descendre, plein d endroits ou on est bloque sur mobile,
//       un peu sur PC aussi »). Mesure sur la version en ligne avant la
//       correction : le cadre embarque avait 2 a 6 px de MOINS que son
//       contenu, devenait defilable et avalait un geste sur deux ecrans ; il
//       gardait la hauteur des heures sur les coordonnees ; le bas du mois
//       tombait 70 a 290 px sous l ecran du telephone. Au vrai geste (doigt
//       sur telephone, molette sur bureau), sur la copie de leur page : a
//       l ouverture, la page amene le bouton ET le mois entier dans l ecran
//       (autonome et embarque) ; sur telephone (retour de Movsar sur un vrai
//       iPhone : la barre de Safari cachait le bas du mois amene a 16 px du
//       bord) le calendrier est une fenetre au MILIEU de l ecran, celui de la
//       page hote en embarque, 90 px de marge au moins en haut et en bas, sur
//       un voile qui prend le toucher sans rien activer dessous ; au-dessus de
//       560 px il s ouvre sous le bouton et la page le montre entier (une
//       tablette embarquee le prouve) ; le cadre a la hauteur du
//       formulaire a chaque ecran (jamais plus court, et il rapetisse) ;
//       chaque geste fait descendre la page jusqu en bas ; meme avec 4 px de
//       trop, le cadre ne prend pas le geste (verrou).
//   [R] UNE PANNE SE DIT EN FRANCAIS ET SE RATTRAPE (2026-09-24) : reseau
//       coupe, 504 en HTML, 429 avec son message : l ecran des heures dit
//       le fait constate (ou le message du serveur), jamais l anglais du
//       navigateur, avec « Reessayer » (44 px) qui relance le meme calcul
//       et rend le focus au titre ; catalogue coupe : l alerte le dit en
//       francais, hors des bords, et Continuer le redit ; catalogue en
//       route : Continuer dit qu il charge, et l alerte s efface a
//       l arrivee.
//   [S] UN TOUCHER N EST PAS UN SURVOL (2026-09-24, retour de Movsar : sur
//       iPhone, il fallait toucher deux fois une carte pour la cocher ; Safari
//       prend le premier toucher pour un survol des qu il devoile quelque
//       chose). Chaque regle :hover de la feuille servie est sous
//       @media (hover: hover) ; sur un telephone emule (hover: none), UN
//       toucher coche, la photo prend le voile de la carte cochee et repart a
//       0 une fois decochee (le survol ne reste plus colle) ; un doigt qui
//       fait defiler sur une carte, au vrai geste, ne la coche pas et ne
//       telecharge pas sa photo ; a la souris, le survol la devoile toujours.
//   [T] LE TELEPHONE EN DEUX COLONNES (2026-09-24, la liste d une carte par
//       rangee essayee le matin, jugee moche par Movsar) : a 390 px,
//       deux cartes d activites par rangee ; sous 380 px une seule pour garder
//       les trois cibles de compteur a 44 px, rien hors de la grille ; le tiroir
//       prend la largeur de sa carte, sous elle ; « Ces horaires me vont » tient
//       sur une ligne dans son bouton, sans police sous 11,5 px ; l ecran des
//       coordonnees s ouvre sur sa question (photo, fil, titre) puis la carte
//       de la visite, puis les champs ; a 768 px, deux cartes par rangee ;
//       a 768 et 600 px, la barre du bas tient ses deux boutons sur une
//       rangee et son resume sur une ligne, aux activites comme aux heures,
//       et son retour est un carre de la hauteur du bouton qui avance.
//   [U] UN GESTE PENDANT UNE TRANSITION N EST PLUS PERDU (2026-09-24) :
//       « Retour » touche pendant l arrivee d un ecran part des que la
//       transition finit (aller() le jetait : le client touchait dans le
//       vide, et le gate aussi, sur une machine rapide).
//
// CONTRE-PREUVES [S] ET [T] : survol (la regle du survol des cartes sort de
// (hover: hover)), listetel (le telephone repasse a une carte par rangee des
// 560 px), bouton (la
// barre reprend les marges du bouton : il recoupe a 360 px), question (la
// carte de la visite repasse avant le titre), barretablette (a 768 px,
// « Retour » repasse au-dessus du bouton qui avance), barreetroite (a
// 600 px, le resume des heures retombe sur trois lignes), retourcarre (en
// tablette, le retour retombe a 46 px de haut a cote d un bouton de 54) :
// FEUILLE servie cassee ;
// survoldoigt (le doigt qui passe telecharge de nouveau la photo), anneauhote
// (au clavier, le cadre ne demande plus la bande a l hote : la carte a cheval
// sur le bas de l ecran y reste alignee au pixel, son anneau dehors ; mord la
// ou Chromium ignore la marge de defilement, mesure sur Chromium 1194),
// perdu (un geste pendant une transition est de nouveau jete) : JS servi
// casse.
//
// CONTRE-PREUVES DU TOUR [J] : FG_QA_CASSE=pax (le champ du compteur reprend
// une largeur fixe), centrage (la case du compteur ne centre plus sa ligne en
// hauteur : FEUILLE servie cassee), fil (le rang de l etape disparait), jauge
// (le segment de l etape en cours ne se remplit plus : feuille cassee),
// mouvement (avancer ne remplit plus le segment atteint), contraste (les
// etapes a venir reprennent le gris qui tombait a 3,7:1 sous le halo :
// feuille cassee), legendegris (la legende passe au gris pale : feuille
// cassee ; centree depuis le 2026-09-24, elle passe sous le voile le plus
// sombre, ou son ancien gris tiendrait 4,5:1), legende (la glose
// n est plus balisee, donc plus masquable sur telephone), vagues (le plan est
// ignore, plus personne ne dit qu un groupe se scinde), duree (le total sur
// place derive d un quart d heure), unite (la case du compteur reprend un mot
// a cote du nombre : page servie cassee).
//
// CONTRE-PREUVES DE L ECRAN DES HEURES (tour du 2026-09-23, « tout doit etre
// explique », revu le 2026-09-24) : soi (un chevauchement avec sa propre
// partie redevient un « decale »), emportees (l heure du 2e groupe n est plus
// marquee), proposee (l heure proposee emporte aussi celle de son 2e groupe),
// explication (l heure d une de ses parties s explique de nouveau sous sa
// plage, en plus de son nom sur la case), plage (la phrase du decalage ne
// dit plus la plage reelle), eclaire (toucher une heure qui ne se prend pas
// n eclaire plus sa ligne, ni sa partie), decrit (les heures expliquees ne
// pointent plus leur ligne), titrefin (le titre final dit « demande
// envoyee » meme quand le serveur confirme), choisir (l heure du 2e groupe
// redevient impossible a prendre), suit (toucher l heure du 2e groupe
// ajoute une partie au lieu de deplacer celle qui l emporte).
//
// CONTRE-PREUVES DU TOUR DU 2026-09-24 (l occasion, les parties, la visite) :
// pris (le verdict du deplacement est ignore : l heure qui chevauche sa
// propre partie redevient un refus), deplacement (toucher une telle heure
// ajoute une partie au lieu de deplacer celle qu elle chevauche), comptex (le
// cadre compte les heures choisies sur elles-memes), partiesproposees (sans
// heure choisie, le cadre ne montre plus les parties que l equipe propose),
// detailprix (le detail du prix disparait meme quand la somme des lignes est
// le prix), finvisite (la fin de la visite quitte le bloc), avance
// (l arrivee ne dit plus son avance sur la premiere activite),
// occasionlibre (l occasion ne bloque plus l envoi), occasionperdue
// (l occasion ne part plus au serveur), occasionrecap (le recapitulatif ne
// la relit plus), occasionfleches (les fleches ne passent plus d une
// occasion a l autre). Toutes : JS servi casse.
//
// CONTRE-PREUVES DU TOUR DES TITRES, DU PAIEMENT ET DU RECAPITULATIF
// (2026-09-23) : titres (deux titres rouvrent sur « Vos » : PAGE servie
// cassee), especes (le logo des especes disparait), recapcontact (l ecran des
// coordonnees n a plus son recapitulatif), flotte (la carte ne flotte plus a
// cote du formulaire : feuille cassee).
//
// CONTRE-PREUVES DES PHOTOS : photocentre (un autre centre recoit les photos
// de Libramont), tourne (le tirage ne change plus l ordre), fige (les photos
// se retirent a chaque ecran, donc changent pendant la reservation), proto (la
// table se relit sans garde : « /fungalaxy/constructor » fait tomber la page).
//
// CONTRE-PREUVES DE LA LISIBILITE : emclair (le mot en couleur des titres
// reprend le violet de la marque), colonne (le second voile des ecrans centres
// disparait), fantome (le bouton discret redevient transparent), voilecarte (la
// photo de carte reprend son voile lineaire), compteur (le nombre de formules
// repart au bout du filet, en gris discret). Toutes : FEUILLE servie cassee.
//
// CONTRE-PREUVES DE /reserver/libramont : hotelarge (le bloc prend toute la
// largeur de l ecran : PAGE servie cassee), embedbrut (la balise perd
// data-design : c est l ancien tunnel qui se monte), ordre (la regle du
// centre passe APRES la regle generique : lu dans vercel.json), repli (le
// formulaire eteint par l equipe laisse la page vide), cadrefige (le cadre
// garde ses 720 px quoi que dise le formulaire), menutaille (le menu de
// l en-tete a 23 px : ses mots ne tombent plus sur les leurs).
//
// CONTRE-PREUVES DE LA PASSE « PLUS USER FRIENDLY » (2026-09-23) : accents
// (plus aucun mot accentue ne descend sa ligne : « CONFIRMEE » remord le O),
// liens (le telephone du centre redevient du texte), groupesrecap (le recap
// retaise le 2e groupe), plagerepliee (le menu d une plage repliee ne dit
// plus l heure du 2e groupe qui y tombe). Toutes : JS servi casse.
//
// CONTRE-PREUVES DES COORDONNEES, DU RECAPITULATIF ET DE L ECRAN FINAL
// (2026-09-23) : entree (Entree envoie de nouveau le formulaire), lie (un
// champ en erreur ne se dit plus invalide), relu (un champ qui a deja le
// focus ne le reprend pas : son erreur n est pas lue), zero (le « (0) » part
// au serveur), fautemail (plus aucune adresse proposee), pays (l adresse d un
// vrai pays est « corrigee »), garde (la proposition se redessine sous le
// geste, le clavier la perd), note (le mot pour l equipe ne part pas),
// mailcoupe (une adresse proposee longue deborde du telephone : FEUILLE
// servie cassee), zoom (les champs repassent a 15 px : feuille cassee), nudge
// (le premier champ a corriger ne bouge plus), nudgereste (sa classe reste
// posee), errglisse (les erreurs apparaissent d un coup : feuille cassee),
// quirecap (le recapitulatif tait le telephone), modifier (« le jour ou le
// groupe » ne ramene plus a l ecran 1 : PAGE servie cassee), debutformule
// (une formule perd son heure de debut au recapitulatif), rechoisir
// (« Choisir d autres horaires » ne redemande rien au serveur), alertefraiche
// (l erreur perimee survit a « Modifier »), sousledoigt (l erreur nait hors
// de l ecran), mailfin (l ecran final tait l e-mail mis en file), accuse (une
// demande annonce une confirmation), arriveefin (l arrivee quitte l ecran
// final), couvre (le montant se dit complet quand il ne l est pas), fete (une
// demande a verifier a ses confettis), anneau (elle a sa coche), cochecalme
// (en mouvement reduit, la coche attend un trace qui ne vient pas : feuille
// cassee). Sauf mention : JS servi casse.
//
// CONTRE-PREUVES DE LA BARRE DU BAS : suitencore (la barre colle de nouveau
// au bas de l ecran : FEUILLE servie cassee), resume (le resume des heures
// ne suit plus une heure posee : JS servi casse).
//
// CONTRE-PREUVES DU DEFILEMENT ET DU CALENDRIER : montee (la hauteur ne monte
// plus qu au-dela de 8 px : le cadre reste plus court que son contenu),
// finscene (la fin d une transition ne redonne plus la hauteur : le cadre
// garde celle de l ecran precedent), montrer (le calendrier ouvert n est plus
// amene dans l ecran : la tablette embarquee le voit), verrou (le cadre
// redevient defilable : FEUILLE servie cassee), voir (embed.js ignore la
// demande du cadre de montrer une bande : SCRIPT HOTE servi casse), milieu
// (la fenetre du telephone n est plus centree : feuille cassee), ecranhote
// (embarquee, elle se centre sur le cadre et non sur l ecran de l hote),
// voile (plus de voile : le toucher a cote active le controle dessous).
//
// CONTRE-PREUVES DU MODE DES HEURES : mode (Continuer reprend les heures de
// l autre onglet), modevol (une reponse en vol prend le mode de son arrivee).
// JS servi casse.
//
// CONTRE-PREUVES DES ECRANS DE LA DATE ET DES ACTIVITES (2026-09-23) : azero
// (a zero formule, la barre ne rappelle plus l activite gardee), plafond (au
// plafond, la phrase et le numero du centre ne s affichent plus), relatif (le
// jour propose ne dit plus « Aujourd hui »), sensmois (« mois suivant » glisse
// a l envers), rejouemois (la reouverture rejoue le glissement du mois), coche
// (cocher ne fait plus claquer la case), eveilreste (le bouton qui avance
// garde sa classe de reveil), eveilinactif (« Continuer » s eveille a chaque
// choix), eveilgarde (« Garder » s eveille a chaque heure posee), onglets (les
// fleches ne changent plus d onglet) : JS servi casse ; pastille (la pastille
// reste sous « Activites »), margefocus (sans marge de defilement, la carte
// focalisee dans le cadre embarque remonte au ras de l ecran de l hote, son
// anneau dehors) : FEUILLE servie cassee.
//
// CONTRE-PREUVES DU TOUR DE L ECRAN DES HEURES (lot 2) : auchoix (le menu
// d une plage recompte en « creneaux »), impasse (la sortie « changer de jour
// ou de groupe » ne mene plus nulle part), doublon (un jour sans horaire
// repose un second avis), attente (la case touchee ne s entoure plus pendant
// la demande), onde (plus d onde quand le plan retient l heure), ondeplan
// (l onde part meme quand le serveur ne rend aucun plan), roule (tout le
// resume de la barre roule, meme ce qui n a pas change), squelette (la roue
// revient a la place de la carte-squelette), voix (la voix tait « le reste se
// regle sur place »), voixavis (l avis d un jour sans horaire ne se dit plus),
// voixpanne (une panne ne se dit plus), voixrefus (la raison d une formule
// refusee ne se dit plus), focusperdu (le focus reste sur le bouton masque) :
// JS servi casse ; tiroirfocus (un tiroir ferme reste dans le parcours
// clavier), menufocus (les heures d un menu replie y restent) : FEUILLE servie
// cassee ; unevoix (la zone des heures se relit de nouveau en entier) : PAGE
// servie cassee.
//
// CONTRE-PREUVES DES COUPURES, DES CIBLES ET DE L ECRAN FINAL : separateur
// (le « · » du sous-titre des heures redevient secable), orphelin (le
// dernier mot d un nom se separe de nouveau), flechefocus (la fleche
// eteinte garde le focus), sortieclavier (Tab hors du calendrier le laisse
// ouvert), numero (l ecran final remontre un numero de reservation, dont le
// SaaS ne se sert pas) : JS servi casse ; fleches44 (les fleches du mois
// reviennent a 34 px), cibleetape (la cible d une etape faite se reduit a
// son segment), anneaustepper (l anneau du « - » repart dehors, coupe) :
// FEUILLE servie cassee.
//
// CONTRE-PREUVES DES PANNES [R] : lisible (l ecran des heures montre de
// nouveau le texte du navigateur), relance (« Reessayer » ne relance
// plus), lisiblemeta (le catalogue coupe montre le texte du navigateur),
// panneredite (Continuer sans catalogue repart sur « Choisissez d abord un
// jour ») : JS servi casse ; alertebord (l alerte retouche les bords de
// l ecran) : FEUILLE servie cassee.
//
// CONTRE-PREUVES (le gate mord) : FG_QA_CASSE=prix (prix de carte faux d un
// euro), total (total du recap faux d un euro), raison (les heures perdent leur
// raison), calendrier (les jours fermes restent cliquables), serre (le
// formulaire ne demande plus le mode souple : les heures serrees redeviennent
// des refus), option (la pastille choisie ne part pas dans le programme),
// parties (la partie de laser non posee n est plus annoncee « sur place »).
// Chacune doit rendre ce gate ROUGE.
//
// Usage : node scripts/fungalaxy-form-check.js
'use strict';
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const zlib = require('zlib');
const { isDeepStrictEqual } = require('util');
const { chromium } = require('playwright-core');
const mock = require('./dev-tunnel-server');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PINLANE_FG_PORT || 4247);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const BROWSER_PATH = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CASSE = String(process.env.FG_QA_CASSE || '');
const FICHIERS = ['assets/fungalaxy-booking.js', 'assets/fungalaxy-booking.css', 'fungalaxy.html'];
// LE POIDS DU FORMULAIRE, MESURE DES DEUX COTES.
//
// `BUDGET_TRANSFERE` est ce que l appareil TELECHARGE (Vercel sert ces trois
// fichiers compresses) ; `BUDGET_SERVI` est ce qu il doit ensuite ANALYSER,
// donc le cout d un processeur lent. Ce sont deux proprietes differentes et
// elles se mesurent separement.
//
// Le plafond brut valait 125 Ko. Mesure du 2026-09-23, AVANT le tour du jour :
// 127 539 octets servis, soit 124,55 Ko. Le plafond etait donc atteint a
// 99,6 % : il n exprimait plus une marge, il interdisait toute addition, quelle
// qu elle soit. Un plafond pose a la valeur du jour est un fil tendu, pas un
// budget. Il est redérive ici de ce qu il protege : une page de reservation
// unique, sur un poste faible, tient largement sous 150 Ko a analyser et sous
// 45 Ko a telecharger. Ce tour-ci sert 129 Ko bruts et 33 Ko compresses, ce qui
// laisse une marge reelle pour le prochain, et le gate mord toujours : une
// bibliotheque tierce, une police ou une image en base64 feraient sauter l un
// ou l autre.
//
// Ce qui a ete fait pour le poids REEL avant de toucher au plafond :
// `tools/build-public.js` applique desormais `minifySyntax` (ce que
// `public-leak-check` simulait deja), et les deux cartes de l ecran des
// creneaux partagent une seule regle de forme.
//
// REDERIVE LE 2026-09-24, SUR UNE MESURE ET NON SUR UNE MARGE. Le formulaire
// servait 150,0 Ko (153 640 octets) : le plafond d analyse etait de nouveau
// atteint. Mesure (CDP, processeur ralenti 6 fois, fichiers tels que le build
// les sert, telephone 390 px, jusqu au jour propose affiche, mediane de 5) :
// script 65 ms, recalcul de style 165 ms, mise en page 272 ms. Le cout d un
// ecran de reservation est dans le style et la mise en page, pas dans la
// lecture des octets : quelques Ko de plus ne s y voient pas. Le plafond
// d analyse passe a 160 Ko et garde son role de garde-fou (une bibliotheque,
// une police ou une image en base64 ajoutent d un coup plus de 10 Ko) ; celui
// du TRANSFERT, qui est le vrai cout d un reseau mobile, ne bouge pas.
//
// LE TRANSFERT MESURAIT UNE COMPRESSION QUE LA PROD N ENVOIE PAS (2026-09-24).
// Il etait calcule en gzip 9 ; la prod repond `Content-Encoding: br`, et ses
// octets compresses sont ceux du brotli de QUALITE 3, a l octet pres (page
// 4 606, feuille 12 329, script 26 360 pour 26 359 : fichiers de `0ff8eae`
// passes par le build, identiques decompresses a ceux de la prod). Le brotli 3
// pese 7,4 % de plus que le gzip 9 : la prod envoyait deja 42,3 Ko quand ce
// gate en annoncait 39,4, et l ancien plafond de 45 Ko gzip valait 48,3 Ko
// reels. Le calcul est corrige a la source (brotli 3), puis les deux plafonds
// sont rederives apres les lots 1 a 3 de la passe UX (date et activites,
// ecran des heures, coordonnees et ecran final), sur une MESURE : 170,5 Ko
// servis, 48,1 Ko reellement transferes ; analyse (meme protocole que plus
// haut) : script 63 ms, style 112 ms, mise en page 261 ms, pas plus qu a
// 150 Ko. Le cout reste dans le style et la mise en page. Plafonds : 180 Ko a
// analyser, 52 Ko a transferer, assez pres pour qu une bibliotheque, une
// police ou une image en base64 fassent sauter l un ou l autre.
//
// REDERIVE LE 2026-09-24 AU SOIR, apres le lot « visite complete » (l occasion,
// le cadre des parties de laser, le bloc de la visite et le detail du prix) :
// 187,8 Ko servis, 51,8 Ko transferes. Rien de mort a retirer (releve par
// script : aucune fonction jamais appelee, aucune regle sans cible). Le
// transfert passait encore, mais a 99,6 % de son plafond : un cliquet qui
// aurait bloque le changement suivant, quel qu il soit. Mesure A/B dans la
// meme session (meme protocole, deux tours alternes) : la prod a 172,8 Ko
// donne script 59 puis 80 ms, style 109 puis 127 ms, mise en page 315 puis
// 359 ms ; le lot a 187,8 Ko donne 86 puis 80 ms, 145 puis 129 ms, 415 puis
// 318 ms. L ecart d une version a l autre est plus petit que celui d une
// meme version d un tour a l autre : aucun surcout mesurable. Sur le reseau,
// 3,7 Ko de plus coutent environ 75 ms a 400 kbit/s. Plafonds : 200 Ko a
// analyser, 58 Ko a transferer, soit 12 et 6 Ko de marge : une police ou une
// bibliotheque (plus de 15 Ko compresses) font toujours sauter le second.
//
// REDERIVE LE 2026-09-29, APRES AVOIR RETIRE LE POIDS REEL. La demande sur
// mesure (cinq ecrans, 88 Ko de sources) etait entree dans le formulaire : le
// parcours de reservation servait 271,5 Ko. Elle vit desormais dans
// assets/fungalaxy-sur-mesure.js et sa feuille, CHARGES A LA DEMANDE (57 et
// 6 Ko servis, seulement a qui ouvre la demande ; sur-mesure-check prouve que
// rien n est telecharge a 30 personnes). Reste, pour tous : les lots 3 et 4 de
// l audit QA (formules a l ecran des heures, Kids Fun Day enfants et adultes,
// parties de laser a placer : 194,0 -> 202,0 Ko servis, 53,6 -> 55,6 Ko
// transferes) puis l encart du seuil, la porte des groupes organises et le
// chargeur de la demande (212,2 Ko, 58,6 Ko). Aucune fonction jamais appelee
// (releve par script sur les 197 fonctions). Mesure A/B (meme protocole,
// tirage des photos fige, ordre ABBA, 7 a 9 tours) : memes passes de mise en
// page (6) et de style (11 a 12) ; script +3 a +8 ms ; mise en page de la prod
// 174 a 366 ms d un tour a l autre, pour un ecart des medianes de 47 a 88 ms :
// au pire 15 ms reels, la porte du premier ecran. Plafonds : 225 Ko a
// analyser, 64 Ko a transferer, soit 12,8 et 5,4 Ko de marge : une police
// (20 Ko compresses) ou une bibliotheque font toujours sauter l un ou l autre.
//
// REDERIVE LE 2026-09-29 AU SOIR, apres les six retours de Movsar sur le
// formulaire (la fenetre « Envie d un peu plus ? » a l arrivee au recapitulatif,
// les parties de laser et les compris de la formule rendus « dans la foulee »
// dans la visite, le compteur « Nombre de joueurs »). Le depart etait deja a
// 98,8 % : 222,4 Ko servis et 61,5 Ko transferes au commit 7980f73, un
// cliquet de nouveau. Poids mort cherche par script avant de toucher au
// chiffre : les 235 fonctions nommees sont toutes appelees, les 33 symboles
// SVG tous cites, les 299 classes de la feuille toutes produites sauf une
// (`.fg-card__meta`, retiree avec une variable jamais relue). Le lot sert
// 240 324 octets (234,7 Ko) et en transfere 65 905 (64,4 Ko) : +12,3 Ko et
// +2,9 Ko, du code qui sert. Mesure A/B (meme protocole, 7980f73 contre
// l arbre, ordre ABBA, 8 tours puis 4) : script +16 a +23 ms au processeur
// ralenti 6 fois, soit 3 a 4 ms reels ; style et mise en page dans le bruit
// (mise en page 903 contre 902 ms au premier passage, un meme fichier variant
// de 535 a 1 117 ms d un tour a l autre) ; les passes de mise en page vont de
// 6 a 11 pour l une comme pour l autre version, selon l arrivee des polices
// et des photos. Sur le reseau, 2,9 Ko coutent environ 60 ms a 400 kbit/s.
// Plafonds : 248 Ko a analyser, 70 Ko a transferer, soit 13,3 et 5,6 Ko de
// marge : une police (20 Ko compresses) ou une bibliotheque font toujours
// sauter l un et l autre.
//
// REDERIVE LE 2026-09-30, apres les horaires bloques (bandeau, decompte et
// barre), puis le « Complet » qui dit son calcul (pistes, places de l arene)
// et la phrase du partage du laser. Le depart etait deja a 99,6 % : 252 950
// octets servis au commit 413429e, un cliquet de nouveau. Poids mort cherche
// par script avant de toucher au chiffre : les 263 fonctions nommees sont
// toutes citees, les 34 symboles SVG tous cites, les 314 classes de la feuille
// toutes produites. Le lot sert 254 748 octets (248,8 Ko, +1,8 Ko) et en
// transfere 69 635 (68,0 Ko, +0,6 Ko). Mesure A/B (meme protocole, 413429e
// contre l arbre, tour de chauffe jete, ordre ABBA, 4 tours, 8 mesures par
// version) : medianes script 317 contre 261 ms, style 518 contre 453 ms, mise
// en page 1 641 contre 1 415 ms au processeur ralenti 6 fois, chaque version
// variant du simple au double d un tour a l autre : aucun surcout mesurable.
// Sur le reseau, 0,6 Ko coutent environ 12 ms a 400 kbit/s. Plafonds : 262 Ko
// a analyser, 74 Ko a transferer, soit 13,2 et 6,0 Ko de marge : une police
// (20 Ko compresses) ou une bibliotheque font toujours sauter l un et l autre.
// 03/10, joueurs par activite : base a4bf8e4 264,3 Ko (deja au-dessus du
// vieux plafond), nouveau 272,9 Ko (dont les blocages obsoletes, les choix
// partages avec le sur mesure et le secours selon le stock reel) ;
// brotli3 72,4 -> 74,8 Ko. Comparaison
// navigateur 6x, 7 mesures entrelacees apres chauffe sur la version finale :
// total des taches 1031,18 -> 1051,64 ms, script 77,54 -> 83,31 ms,
// layout 318,30 -> 324,95 ms (mesures locales sous charge).
const BUDGET_SERVI = 274 * 1024;
const BUDGET_TRANSFERE = 75 * 1024;

let failures = 0;
function ok(cond, label, detail) {
  console.log((cond ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '  ' + detail : ''));
  if (!cond) failures += 1;
  return Boolean(cond);
}
// Une attente BORNEE qui rend false a l echeance : jamais un vert par defaut.
async function attendre(page, fn, ms, arg) {
  try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); return true; } catch (error) { return false; }
}
// LA FENETRE « ENVIE D UN PEU PLUS ? » s ouvre seule a l arrivee au
// recapitulatif quand le serveur a joint des offres au creneau : un client la
// ferme (« Non merci ») avant de valider, ce parcours aussi. Tant que le
// formulaire n a pas decide de l ouvrir, elle porte data-attendue.
async function passerLaVitrine(f) {
  await attendre(f, () => { const v = document.querySelector('#vitrine'); return !v || !v.hasAttribute('data-attendue'); }, 5000);
  const ouverte = await f.evaluate(() => { const v = document.querySelector('#vitrine'); return Boolean(v && !v.hidden); });
  if (ouverte) {
    await f.click('#vitrine .fg-vitrine__non');
    await attendre(f, () => document.querySelector('#vitrine').hidden, 3000);
  }
  return ouverte;
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
function euros(n) {
  return (Math.round(Number(n) * 100) / 100).toLocaleString('fr-BE', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';
}
// Les libelles du calendrier sont servis sans accent ; l ecran les accentue.
// On compare sans accent ni apostrophe typographique : le SENS, pas la police.
function plat(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim(); }
// L horaire d un jour tel que l ecran l ecrit (meme regle que horaireLabel).
function horaire(sch) {
  if (!sch) return 'Fermé';
  if (sch.label) return String(sch.label).replace('Minuit', 'minuit');
  const f = (t) => { const h = Math.floor(t); const m = Math.round((t - h) * 60); return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`; };
  return `${f(sch.open)} - ${sch.close === 24 ? 'minuit' : f(sch.close)}`;
}
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function deIso(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function plusJours(s, n) { const d = deIso(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function jourLong(s) { const d = deIso(s); return cap(`${JOURS[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]}`); }
// Le titre d un jour du calendrier (meme regle que infoTexte cote client).
function titreJour(j) {
  const morceaux = [jourLong(j.date), j.open ? `ouvert ${horaire(j.schedule)}` : String(j.closedLabel || 'Fermé').toLowerCase()];
  if (j.holiday) morceaux.push(j.holiday.type === 'public' ? `férié : ${j.holiday.label}` : j.holiday.label);
  if (Array.isArray(j.closedWindows) && j.closedWindows.length) morceaux.push(`fermé ${j.closedWindows.map((c) => `${c.start}-${c.end}`).join(', ')}`);
  return morceaux.join(' · ');
}
function dureeApprox(m) { m = Number(m) || 0; if (m < 60) return `${m} min`; const h = Math.floor(m / 60); const r = m % 60; return `environ ${h} h${r >= 30 ? '30' : ''}`; }
function heureAffichee(t) { return t === '24:00' ? 'minuit' : t; }
function periodeDe(h) { const n = Number(String(h).split(':')[0]); return n < 12 ? 'Matin' : n < 18 ? 'Après-midi' : 'Soirée'; }
// Le mot d une heure refusee suit le CODE du moteur. resource_conflict se dit
// « complet » (le moteur lui-meme ecrit « Complet »), schedule_free est un
// « trop tard ». anchor_overlap ne se dit plus « pris » (2026-09-24) : un
// chevauchement avec une autre de ses parties de laser se dit par le NOM de
// cette partie (« partie 2 »), le reste « occupé ».
// Le texte d une panne ne doit jamais etre celui du navigateur.
const ANGLAIS = /fetch|network|load failed|unexpected|json|token|error|timeout|abort/i;
const MOTS_DURS = { capacity: 'complet', blocked: 'fermé', schedule: 'trop tard', schedule_free: 'trop tard', resource_conflict: 'complet', business_rules: 'non valable', off_grid: 'hors grille', unknown_anchor: 'indispo', anchor_overlap: 'occupé' };

const HOST_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;font-family:sans-serif;background:#111}header.site{height:56px;background:#1b1b2f}main{padding:12px}</style>
</head><body>
<header class="site"></header>
<main><h1 style="color:#fff">Reservez</h1><div class="bloc"></div></main>
<script>
window.__hauteurs = []; window.__ecrans = 0;
window.addEventListener('message', function (e) { var d = e.data || {}; if (d.type === 'pinlane:height') window.__hauteurs.push(d.height); if (d.type === 'pinlane:screen') window.__ecrans += 1; });
</script>
<script src="${BASE_URL}/embed.js" data-center="libramont" data-design="fungalaxy" data-target=".bloc" data-track="datalayer"></script>
</body></html>`;

// Les contre-preuves : une ligne du JS servie cassee expres.
const MUTATIONS = {
  prix: ["'Dès ' + euros(mini)", "'Dès ' + euros(1 + mini)"],
  total: ['data-total="\' + prix + \'"', 'data-total="\' + (prix + 1) + \'"'],
  raison: ['chip.dataset.reason = e.raison;', "chip.dataset.reason = '';"],
  calendrier: ["(off ? 'disabled' : '')", "''"],
  serre: ["q.set('softReserve', '1');", 'void 0;'],
  option: ['state.options[a.id][o.cle] = o.valeur;', 'void 0;'],
  parties: ["      if (!(total >= 1) || posees >= total || (!posees && id !== 'laser_game')) return;", '      return;'],
  pax: ["paxInput.style.width = (n + 0.3) + 'ch';", "paxInput.style.width = '9ch';"],
  fil: ["(i === actif && !fin ? '<span class=\"fg-steps__of\"", "(false ? '<span class=\"fg-steps__of\""],
  mouvement: ["if (sens === 'avance' && i === actif) geste = ' is-filling';", ''],
  legende: ['<em>tout ne tiendra peut-être pas</em>', 'tout ne tiendra peut-être pas'],
  vagues: ['b.activityId === id && Number(b.groupWaveCount) > 1; });', 'b.activityId === id && false; });'],
  duree: ['var m = minutesEntre(debut, fin);', 'var m = minutesEntre(debut, fin) + 15;'],
  soi: [' && t.conflict.activityId !== idPiste;', ';'],
  emportees: ['if ((Number(b.countIndex) || 1) !== partie || !(Number(b.groupWaveIndex) > 1)) return;', 'return;'],
  proposee: ['heuresEmportees(state.creneau, a.activityId, actifs)', 'heuresEmportees(state.creneau, a.activityId, actifs.concat(propose ? [propose] : []))'],
  explication: ["if (!etat || etat === 'ok' || etat === 'wave' || c.classList.contains('is-on')", "if (!etat || etat === 'ok' || c.classList.contains('is-on')"],
  plage: ["var quand = plage ? ' (' + plage + ')' : ' de ' + g.conflit.time;", "var quand = ' de ' + g.conflit.time;"],
  eclaire: ["if (cible) { void cible.offsetWidth; cible.classList.add('is-lit'); }", 'void cible;'],
  decrit: ["groupes.forEach(function (g, k) { g.puces.forEach(function (c) { c.setAttribute('aria-describedby', racine + '-why-' + k); }); });", 'void 0;'],
  titrefin: ["poserTitre($('#t-fin'), confirme ? 'Réservation<br><em>confirmée</em>' : 'Demande<br><em>envoyée</em>');", "poserTitre($('#t-fin'), 'Demande<br><em>envoyée</em>');"],
  choisir: ["chip.dataset.ok = e.etat === 'hard' || e.sous === 'hard' ? 'false' : 'true';", "chip.dataset.ok = e.etat === 'hard' || e.etat === 'wave' ? 'false' : 'true';"],
  accents: ["if (w.offsetTop > haut + 2 && ACCENT_HAUT.test(w.textContent.toUpperCase().normalize('NFD'))) w.classList.add('w--accent');", 'void haut;'],
  liens: ["Une question ? ' + lienContact(contact) + '</span></p>'", "Une question ? ' + esc(contact.phone) + '</span></p>'"],
  groupesrecap: ['        if (grand) morceaux.push(', '        if (false) morceaux.push('],
  plagerepliee: ["      else if (vagues.length) sum = vagues.join(', ') + ' · ' + sum;", '      else if (false) sum = vagues.join();'],
  resume: ['    hourSum.innerHTML = span + ', '    if (!hourSum.innerHTML) hourSum.innerHTML = span + '],
  suit: ['if (j >= 0) state.laserParts[j] = t;', 'if (false) state.laserParts[j] = t;'],
  especes: ['<svg><use href="#i-cash"/></svg>', ''],
  recapcontact: ["$('#recallBody').innerHTML = htmlRecap(false);", 'void 0;'],
  photocentre: ['var pool = (Object.prototype.hasOwnProperty.call(PHOTOS, CENTER) ? PHOTOS[CENTER] : []).slice();', 'var pool = PHOTOS.libramont.slice();'],
  tourne: ['var j = Math.floor(Math.random() * (i + 1));', 'var j = i;'],
  fige: ['    rendreEtapes();\n    chargerPhoto(vers);', '    rendreEtapes();\n    poserPhotos();\n    chargerPhoto(vers);'],
  proto: ['var pool = (Object.prototype.hasOwnProperty.call(PHOTOS, CENTER) ? PHOTOS[CENTER] : []).slice();', 'var pool = (PHOTOS[CENTER] || []).slice();'],
  montee: ['if (!h || h === derniereHauteur || (h < derniereHauteur && derniereHauteur - h < 8)) return;', 'if (!h || Math.abs(h - derniereHauteur) < 8) return;'],
  finscene: ['        posterHauteur();\n        apresAnimations(vers, posterHauteur);\n', ''],
  montrer: ['      if (o && !dayPop.hidden && !milieu) montrer(dayPop, dayBtn);', '      void 0;'],
  ecranhote: ['var milieu = ecranHote && hautCadre !== null ? ecranHote / 2 - hautCadre : cadre / 2;', 'var milieu = cadre / 2;'],
  voile: ['    if (dayVoile) dayVoile.hidden = !milieu;', '    void 0;'],
  azero: ["(nA ? ', ou revenez à ' + (nA > 1 ? 'vos ' + nA + ' activités' : 'votre activité') : '')", "''"],
  mode: ['if (state.dispo && state.dispoCle !== cleDemande()) invaliderDispo();', 'void 0;'],
  modevol: ['state.dispoCle = cle;', 'state.dispoCle = cleDemande();'],
  plafond: ['var auMax = state.pax >= PAX_MAX;', 'var auMax = false;'],
  coche: ["if (on) rejouer(card, 'is-coche'); else card.classList.remove('is-coche');", 'void 0;'],
  eveilreste: ["btn._eveil = setTimeout(function () { btn.classList.remove('is-wake'); }, 600);", 'void 0;'],
  eveilinactif: ['if (bump && etaitInactif && !goHours.disabled) eveiller(goHours);', 'if (bump && !goHours.disabled) eveiller(goHours);'],
  eveilgarde: ['if (slot && reveilGarder) { reveilGarder = false; eveiller(goContact); }', 'if (slot && reveilGarder) { eveiller(goContact); }'],
  relatif: ['if (rel) morceaux.push(rel);', 'void rel;'],
  sensmois: ["rejouer(calGrid, sens > 0 ? 'is-next' : 'is-prev');", "rejouer(calGrid, 'is-prev');"],
  rejouemois: ["if (o) { moisVu = null; calGrid.classList.remove('is-next', 'is-prev'); ", 'if (o) { '],
  onglets: ['    if (!vers) return;\n    e.preventDefault();\n', '    return;\n'],
  auchoix: ["n > 1 ? n + ' au choix'", "n > 1 ? n + ' créneaux'"],
  impasse: ['data-goto="date">Changer de jour ou de groupe', '>Changer de jour ou de groupe'],
  doublon: ["if (slots.length) html += '<section", "html += '<div class=\"fg-notice\"><b>x</b></div>'; if (slots.length) html += '<section"],
  attente: ["chip.classList.add('is-pending');", 'void 0;'],
  onde: ["rejouer(posee, 'is-pose');", 'void 0;'],
  ondeplan: [' && planRetient(idAttente, heureAttente)) rejouer', ') rejouer'],
  roule: ["if (k < sumAvant.length && b.textContent !== sumAvant[k]) b.classList.add('is-maj');", "b.classList.add('is-maj');"],
  squelette: ['hourZone.innerHTML = SQUELETTE;', "hourZone.innerHTML = '<p class=\"fg-loading\">On regarde ce qui est libre…</p>';"],
  voix: ["(complet ? '' : ', plus ' + nomsSansPrix(items) + ', ' + PRIX_ACCUEIL)", "''"],
  voixavis: ["if (sceneCourante === 'heures') dire(msgNotice", "if (false) dire(msgNotice"],
  voixpanne: ["if (sceneCourante === 'heures') dire(msgErr", "if (false) dire(msgErr"],
  voixrefus: ['dire(pourquoi.textContent.trim());', 'void 0;'],
  focusperdu: ['cible.focus({ preventScroll: true });', 'void cible;'],
  entree: ["if (e.key !== 'Enter' || e.isComposing) return;", 'return;'],
  lie: ["if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');", 'void 0;'],
  relu: ['if (premier === doc.activeElement) premier.blur(); ', ''],
  zero: ["telephone: champ('cTel').value.replace(", "telephone: champ('cTel').value.trim(), brut: champ('cTel').value.replace("],
  fautemail: ['(d === 1 || (d === 2 && best.length >= 9))', 'false'],
  pays: ["if (tld !== best.split('.').pop() && PAYS.indexOf(tld) >= 0) return '';", ''],
  garde: ["if ((boiteMail.dataset.s || '') === s) return;", ''],
  note: ["notes: [state.contact.occasion === 'autre' && state.contact.occasionAutre ? 'Occasion : ' + state.contact.occasionAutre : '', state.contact.note || ''].filter(Boolean).join('. '),", "notes: '',"],
  nudge: ["secouer(premier.closest('.fg-field, .fg-check'));", 'void 0;'],
  nudgereste: ["if (w) w.classList.remove('is-nudge');", 'void w;'],
  quirecap: ["esc(state.contact.email) + '&nbsp;· ' + esc(state.contact.telephone) + '</p>'", "esc(state.contact.email) + '</p>'"],
  debutformule: ['var sansDebut = state.heure && !lignes.some(', 'var sansDebut = false && !lignes.some('],
  rechoisir: ["state.dispo = null; signaturePistes = ''; goContact.disabled = true;", 'void 0;'],
  alertefraiche: ["erreurEnvoi(''); rendreRecap();", 'rendreRecap();'],
  sousledoigt: ['if (html) { posterHauteur(); montrer(confirmErr); }', 'if (html) { posterHauteur(); }'],
  mailfin: ["return c && c.channel === 'email' && c.status !== 'draft' && (", 'return false && ('],
  accuse: ["(mailQ.templateId === 'confirmation' ? 'La confirmation part à ' :", "(true ? 'La confirmation part à ' :"],
  arriveefin: ["(arrivee ? '. Arrivée conseillée à <b>'", "(false ? '. Arrivée conseillée à <b>'"],
  couvre: ["(prixComplet ? ', à régler'", "(true ? ', à régler'"],
  fete: ['if (confirme && !reduced) for', 'if (!reduced) for'],
  anneau: ["confirme ? '#i-check' : '#i-mail'", "'#i-check'"],
  lisible: ['var msgErr = err && err.lisible ? err.message : ', 'var msgErr = err.message || '],
  separateur: ["hourSub.innerHTML = '<b>' + esc(insecable(jourCourt(state.date))) + '</b>\\u00a0· '", "hourSub.innerHTML = '<b>' + esc(insecable(jourCourt(state.date))) + '</b> · '"],
  orphelin: ["function finInsecable(s) { return String(s == null ? '' : s).replace(/ ([^ ]+)$/, '\\u00a0$1'); }", "function finInsecable(s) { return String(s == null ? '' : s); }"],
  flechefocus: ['    if (navFocus && navFocus.disabled) (navFocus', '    if (false) (navFocus'],
  sortieclavier: ['  dayWrap.addEventListener(\'focusout\', sortieClavier);\n  dayPop.addEventListener(\'focusout\', sortieClavier);\n', ''],
  numero: ["    $('#finBody').innerHTML = '<div class=\"fg-done__ticket", "    $('#finBody').innerHTML = '<div>Réservation n° ' + esc(r.id) + '</div><div class=\"fg-done__ticket"],
  relance: ["if (e.target.closest('[data-retry]')) {", 'if (false) {'],
  lisiblemeta: ['panneMeta = err && err.lisible ? err.message : ', 'panneMeta = err.message || '],
  panneredite: ['    if (!meta) { direErreur(panneMeta ||', '    if (false) { direErreur(panneMeta ||'],
  survoldoigt: ["    if (e.pointerType === 'touch') return;\n", ''],
  anneauhote: ["    if (el && el.matches && el.matches('.fg-card, .fg-pill, .fg-tab') && focusClavier(el)) montrer(el);\n", ''],
  perdu: ['    if (enTransition) { allerEnAttente = { cible: cible, retour: retour }; return; }\n', '    if (enTransition) return;\n'],
  pris: ['function verdictDu(t) { return t && t.ok === false && t.move ? t.move : t; }', 'function verdictDu(t) { return t; }'],
  deplacement: ["var remplacee = chip.dataset.replaces || (vague ? vague.depuis : '');", "var remplacee = vague ? vague.depuis : '';"],
  comptex: ["' choisie' + (n > 1 ? 's' : '') + ' sur ' + total", "' choisie' + (n > 1 ? 's' : '') + ' sur ' + n"],
  partiesproposees: ['var heures = n ? state.laserParts.slice() : debutsDesParties(state.creneau, a.activityId);', 'var heures = state.laserParts.slice();'],
  detailprix: ['      if (Math.abs(connus - prix) < 0.01) {', '      if (false) {'],
  finvisite: ["    if (fin) lignes += etapeVisite({ genre: 'out'", "    if (false) lignes += etapeVisite({ genre: 'out'"],
  avance: ["detail: avance > 0 ? avance + ' min avant votre ' + nomBas(premiere) : 'on vous accueille'", "detail: 'on vous accueille'"],
  occasionlibre: ['    if (!occ) ok = false;\n', ''],
  occasionperdue: ["occasion: state.contact.occasion || '',", "occasion: '',"],
  occasionrecap: ['if (final && state.contact.occasion) html +=', 'if (false) html +='],
  occasionfleches: ["    if (!pas || !e.target.classList || !e.target.classList.contains('fg-occasion')) return;", '    return;'],
};
// Les contre-preuves de la FEUILLE : une regle servie cassee expres. La feuille
// est relue en LF, quelle que soit la fin de ligne du depot.
const MUTATIONS_CSS = {
  centrage: ['  flex-wrap: wrap;\n  align-content: center;\n', '  flex-wrap: wrap;\n'],
  jauge: ['.fg-steps__item.is-active .fg-steps__seg::after { transform: scaleX(1); }\n', ''],
  contraste: ['meme au coeur du halo le plus clair. */\n  color: #a0a0a0;\n', 'meme au coeur du halo le plus clair. */\n  color: var(--fg-faint);\n'],
  legendegris: ['sur un pixel blanc de la photo. */\n  color: var(--fg-text);\n', 'sur un pixel blanc de la photo. */\n  color: var(--fg-faint);\n'],
  flotte: ['  float: right;\n  width: min(400px, calc(52% - var(--fg-gutter) - 24px));\n', '  width: min(400px, calc(52% - var(--fg-gutter) - 24px));\n'],
  emclair: ['.fg-title em { font-style: normal; color: var(--fg-purple-em); }\n', '.fg-title em { font-style: normal; color: var(--fg-purple-2); }\n'],
  colonne: ['    linear-gradient(90deg, rgba(5, 5, 5, 0) calc(50% - 490px), rgba(5, 5, 5, 0.55) calc(50% - 350px), rgba(5, 5, 5, 0.55) calc(50% + 350px), rgba(5, 5, 5, 0) calc(50% + 490px)),\n', ''],
  fantome: ['.fg-btn--ghost {\n  background: rgba(8, 8, 8, 0.86);\n', '.fg-btn--ghost {\n  background: transparent;\n'],
  voilecarte: ['rgba(5, 5, 5, 0.3) 0%, rgba(5, 5, 5, 0.82) 34%, rgba(5, 5, 5, 0.92) 100%)', 'rgba(5, 5, 5, 0.25) 0%, rgba(5, 5, 5, 0.9) 100%)'],
  compteur: ['.fg-fam__title span { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: none; color: var(--fg-muted); }', '.fg-fam__title span { order: 3; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: none; color: var(--fg-faint); }'],
  suitencore: ['.fg-dock { padding: 14px 0 16px; }\n', '.fg-dock { position: sticky; bottom: 10px; z-index: 4; padding: 14px 0 16px; }\n'],
  verrou: ['html.fg-pilote { overflow: hidden; }\n', ''],
  milieu: ['  transform: translate(-50%, -50%);\n  box-shadow: 0 24px 64px', '  transform: translate(-50%, 0);\n  box-shadow: 0 24px 64px'],
  pastille: ['.fg-tabs.is-for .fg-tabs__bar { transform: translateX(calc(100% + 4px)); }\n', ''],
  margefocus: ['.fg-card, .fg-pill, .fg-tab { scroll-margin: 8px; }\n', ''],
  tiroirfocus: ['transform: translateY(-6px); visibility: hidden; ', 'transform: translateY(-6px); '],
  menufocus: ['.fg-period__inner { min-height: 0; overflow: hidden; visibility: hidden; ', '.fg-period__inner { min-height: 0; overflow: hidden; '],
  mailcoupe: ['min-height: 44px; max-width: 100%; padding: 0 4px; overflow-wrap: anywhere; ', 'min-height: 44px; padding: 0 4px; '],
  zoom: ['zoome sur le champ touche. */\n  font-size: 16px;', 'zoome sur le champ touche. */\n  font-size: 15px;'],
  errglisse: ['  .fg-field.is-invalid .fg-field__error, #consentWrap.is-invalid + .fg-field__error { animation: fg-err 0.24s var(--fg-ease-out) both; }\n', ''],
  cochecalme: ['@media (prefers-reduced-motion: no-preference) {\n  .fg-done__ring svg { stroke-dasharray: 60; stroke-dashoffset: 60; }\n', '.fg-done__ring svg { stroke-dasharray: 60; stroke-dashoffset: 60; }\n@media (prefers-reduced-motion: no-preference) {\n'],
  fleches44: ['.fg-cal__nav {\n  width: 44px;\n  height: 44px;\n', '.fg-cal__nav {\n  width: 34px;\n  height: 34px;\n'],
  cibleetape: ['.fg-steps__item button::after { content: ""; position: absolute; left: 0; right: 0; top: -16px; bottom: -6px; }\n', ''],
  anneaustepper: ['.fg-stepper__btn:focus-visible { outline-offset: -4px; }\n', ''],
  alertebord: ['  z-index: 3;\n  margin: 12px var(--fg-gutter) 20px;\n', '  z-index: 3;\n  margin: 0 0 20px;\n'],
  survol: ['@media (hover: hover) {\n  .fg-card:hover { border-color: #4a4a4a; transform: translateY(-3px); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 10px 24px rgba(0, 0, 0, 0.45); }\n  .fg-card:hover .fg-card__photo { opacity: 1; }\n}\n', '.fg-card:hover { border-color: #4a4a4a; transform: translateY(-3px); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 10px 24px rgba(0, 0, 0, 0.45); }\n.fg-card:hover .fg-card__photo { opacity: 1; }\n'],
  listetel: ['@media (max-width: 359px) {\n  .fg-grid { grid-template-columns: 1fr; }\n}\n', '@media (max-width: 560px) {\n  .fg-grid { grid-template-columns: 1fr; }\n}\n'],
  bouton: ['  .fg-dock .fg-btn:not(.fg-btn--ghost) { padding: 0 14px; gap: 8px; letter-spacing: 0.04em; white-space: nowrap; }\n', ''],
  question: ['  .fg-scene[data-scene="contact"] .fg-recall { order: 3; }\n', ''],
  barretablette: ['  .fg-dock .fg-actions { flex-wrap: nowrap; gap: 10px; }\n  .fg-dock .fg-bar__count { min-width: 0; }\n  .fg-dock .fg-btn--ghost { flex: 0 0 54px; width: 54px; min-height: 54px; padding: 0; }\n  .fg-dock .fg-btn--ghost .fg-btn__txt { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }\n', ''],
  barreetroite: ['  .fg-dock { flex-direction: column; align-items: stretch; gap: 8px; }\n', ''],
  retourcarre: ['  .fg-dock .fg-btn--ghost { flex: 0 0 54px; width: 54px; min-height: 54px; padding: 0; }\n', '  .fg-dock .fg-btn--ghost { flex: 0 0 54px; width: 54px; padding: 0; }\n'],
  prixtabulaire: ['.fg-visit__price { margin-left: auto; display: inline-flex; flex-direction: column; align-items: flex-end; line-height: 1.15; color: var(--fg-teal); font-weight: 700; font-size: 18px; font-variant-numeric: tabular-nums; }', '.fg-visit__price { margin-left: auto; display: inline-flex; flex-direction: column; align-items: flex-end; line-height: 1.15; color: var(--fg-teal); font-weight: 700; font-size: 18px; }'],
};
// Les contre-preuves d embed.js (le script que la page hote charge), relu en LF.
const MUTATIONS_EMBED = {
  voir: ["    if (data.type === 'pinlane:voir') {", '    if (false) {'],
};
// Les contre-preuves de la PAGE : des lignes de fungalaxy.html servies
// cassees (plusieurs remplacements, chacun sur une ancre unique).
const MUTATIONS_HTML = {
  titres: [
    ['data-words>Choisissez<br><em>vos activités</em></h2>', 'data-words>Vos <em>activités</em></h2>'],
    ['data-words>Quelle heure<br><em>vous arrange&nbsp;?</em></h2>', 'data-words>Vos <em>horaires</em></h2>'],
  ],
  unevoix: [
    ['<div id="hourZone">', '<div id="hourZone" aria-live="polite">'],
  ],
  modifier: [
    ['data-goto="date">le jour ou le groupe</button>', 'data-goto="recap">le jour ou le groupe</button>'],
  ],
  unite: [
    ['value="4" autocomplete="off">', 'value="4" autocomplete="off"><span class="fg-stepper__unit" aria-hidden="true">joueurs</span>'],
  ],
};
// Les contre-preuves de la page /reserver/libramont (fungalaxy-site.html).
const MUTATIONS_SITE = {
  hotelarge: ['#booking > .container { width: min(1440px, 100%); margin: 0 auto; }', '#booking > .container { width: 100%; margin: 0 auto; }'],
  embedbrut: [' data-design="fungalaxy"', ''],
  repli: ["    function verifier() { if (!slot.querySelector('iframe')) repli.hidden = false; }", '    function verifier() {}'],
  cadrefige: ['.pinlane-slot iframe { background: #050505; display: block; width: 100%; border: 0; }', '.pinlane-slot iframe { background: #050505; display: block; width: 100%; border: 0; height: 720px !important; }'],
  menutaille: ['    font-size: 21.14px;', '    font-size: 23px;'],
};

// Le serveur du gate : la page hote en plus, et la contre-preuve (un JS servi
// casse expres) quand FG_QA_CASSE le demande. Tout le reste est le mock partage.
function serveur() {
  const base = mock.createServer({ port: PORT });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname === '/host.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(HOST_HTML); return; }
    if (CASSE && MUTATIONS_SITE[CASSE] && /^\/reserver\/libramont\/?$/.test(url.pathname)) {
      const [a, b] = MUTATIONS_SITE[CASSE];
      const page = fs.readFileSync(path.join(ROOT, 'fungalaxy-site.html'), 'utf8').replace(/\r\n/g, '\n');
      if (page.split(a).length !== 2) { console.error(`fungalaxy-form-check: la mutation ${CASSE} ne trouve pas son ancre une seule fois (la page a change ?)`); process.exit(2); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(page.replace(a, b));
      return;
    }
    if (CASSE && MUTATIONS_HTML[CASSE] && /^\/fungalaxy\/[a-z0-9-]+\/?$/.test(url.pathname)) {
      let page = fs.readFileSync(path.join(ROOT, 'fungalaxy.html'), 'utf8').replace(/\r\n/g, '\n');
      for (const [a, b] of MUTATIONS_HTML[CASSE]) {
        if (page.split(a).length !== 2) { console.error(`fungalaxy-form-check: la mutation ${CASSE} ne trouve pas son ancre une seule fois (la page a change ?)`); process.exit(2); }
        page = page.replace(a, b);
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(page);
      return;
    }
    if (CASSE && MUTATIONS_EMBED[CASSE] && url.pathname === '/embed.js') {
      const [a, b] = MUTATIONS_EMBED[CASSE];
      const src = fs.readFileSync(path.join(ROOT, 'embed.js'), 'utf8').replace(/\r\n/g, '\n');
      if (src.split(a).length !== 2) { console.error(`fungalaxy-form-check: la mutation ${CASSE} ne trouve pas son ancre une seule fois (embed.js a change ?)`); process.exit(2); }
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(src.replace(a, b));
      return;
    }
    const feuille = url.pathname === '/assets/fungalaxy-booking.css';
    if (CASSE && (url.pathname === '/assets/fungalaxy-booking.js' || feuille)) {
      if (!MUTATIONS[CASSE] && !MUTATIONS_CSS[CASSE] && !MUTATIONS_HTML[CASSE] && !MUTATIONS_SITE[CASSE] && !MUTATIONS_EMBED[CASSE] && CASSE !== 'ordre') { console.error(`fungalaxy-form-check: mutation inconnue ${CASSE}`); process.exit(2); }
      const mutation = (feuille ? MUTATIONS_CSS : MUTATIONS)[CASSE];
      if (mutation) {
        const avant = fs.readFileSync(path.join(ROOT, 'assets', feuille ? 'fungalaxy-booking.css' : 'fungalaxy-booking.js'), 'utf8').replace(/\r\n/g, '\n');
        if (avant.split(mutation[0]).length !== 2) { console.error(`fungalaxy-form-check: la mutation ${CASSE} ne trouve pas son ancre une seule fois (le code a change ?)`); process.exit(2); }
        res.writeHead(200, { 'Content-Type': `${feuille ? 'text/css' : 'text/javascript'}; charset=utf-8`, 'Cache-Control': 'no-store' });
        res.end(avant.replace(mutation[0], mutation[1]));
        return;
      }
    }
    base.emit('request', req, res);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

// L ORACLE LIT COMME LA PAGE (horaires bloques, 2026-09-30). Une page passee
// aux coordonnees retient ses horaires : ses lectures portent son jeton, et
// sa place reste libre POUR ELLE. Lue sans ce jeton, la route compterait la
// place de la page comme prise par un autre client.
const jetonsDesPages = new WeakMap();
// LES LECTURES QU UN GESTE DECLENCHE. Les horaires se relisent seuls toutes
// les 15 s sur leur ecran, avec la MEME demande (meme adresse) ; un toucher
// qui recalcule change la demande (ses poses). Seules les lectures a une
// adresse nouvelle viennent d un geste : une relecture tombee dans la fenetre
// d un controle ne le fait plus mentir.
function lecturesNeuves(urls, avant) {
  const dispo = (u) => u.indexOf('/api/public-availability?') >= 0;
  const derniere = urls.slice(0, avant).filter(dispo).pop() || '';
  return urls.slice(avant).filter((u) => dispo(u) && u !== derniere);
}
function suivreJeton(page) {
  page.on('request', (r) => {
    if (r.url().indexOf('/api/public-availability?') >= 0) jetonsDesPages.set(page, r.headers()['x-pinlane-hold'] || '');
  });
}
async function lireJson(url, page) {
  const jeton = page ? jetonsDesPages.get(page) || '' : '';
  const r = await fetch(url, jeton ? { headers: { 'x-pinlane-hold': jeton } } : {});
  return r.json();
}

// Le poids que le navigateur recoit : le build de mise en ligne rejoue sur une
// COPIE des trois fichiers (il retire les commentaires), jamais sur le depot.
function poidsServi() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-poids-'));
  try {
    fs.mkdirSync(path.join(tmp, 'assets'));
    FICHIERS.forEach((f) => fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f)));
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build-public.js')], { cwd: ROOT, env: Object.assign({}, process.env, { BUILD_PUBLIC_ROOT: tmp }), encoding: 'utf8' });
    const sortie = String(r.stdout || '').trim().split('\n')[0];
    const octets = FICHIERS.reduce((s, f) => s + fs.statSync(path.join(tmp, f)).size, 0);
    // Ce que l appareil recoit vraiment : chaque fichier compresse SEUL, comme
    // le serveur les envoie (jamais un seul flux pour les trois). La prod sert
    // du brotli de qualite 3 (etalonne le 2026-09-24, voir BUDGET_TRANSFERE),
    // plus lourd que le gzip 9 mesure jusque-la.
    const transfere = FICHIERS.reduce((s, f) => s + zlib.brotliCompressSync(fs.readFileSync(path.join(tmp, f)), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 3 } }).length, 0);
    return { octets, transfere, nettoyes: /3 fichier\(s\) nettoye/.test(sortie), sortie };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// LES PARTIES DU PLAN, comme le bloc de la visite les ecrit : une par
// activite et par partie (countIndex), ses groupes dans l ordre, la fin du
// dernier, les pistes. Tout vient des blocs du plan rendu par le serveur.
function partiesQa(plan) {
  const index = new Map();
  const liste = [];
  ((plan && plan.resourceBlocks) || []).forEach((b) => {
    if (!b || !(b.type === 'activity' || b.activityId) || !b.activityId || !b.startTime) return;
    const cle = `${b.activityId}#${Number(b.countIndex) || 1}`;
    if (!index.has(cle)) { const p = { id: b.activityId, partie: Number(b.countIndex) || 1, groupes: [], pistes: 0 }; index.set(cle, p); liste.push(p); }
    const p = index.get(cle);
    if (p.groupes.some((g) => g.debut === String(b.startTime))) return;
    p.groupes.push({ joueurs: Number(b.players) || 0, debut: String(b.startTime), fin: String(b.endTime || '') });
    p.pistes = Math.max(p.pistes, Number(b.requiredLanes) || 0);
  });
  liste.forEach((p) => {
    p.groupes.sort((x, y) => x.debut.localeCompare(y.debut));
    p.debut = p.groupes[0].debut;
    p.fin = p.groupes.map((g) => g.fin).sort().pop() || '';
  });
  return liste.sort((x, y) => x.debut.localeCompare(y.debut));
}
// Le plan tel que l ecran doit l ecrire, relu sur la reponse.
function lignePlan(reponse) {
  const slot = (reponse.slots || [])[0];
  if (!slot) return null;
  const plan = slot.opsPlan || {};
  const vus = new Set();
  const blocs = (plan.resourceBlocks || [])
    .filter((b) => b.type === 'activity' || b.activityId)
    .filter((b) => { const k = `${b.activityId}@${b.startTime}`; if (vus.has(k)) return false; vus.add(k); return true; })
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)))
    .map((b) => ({ id: b.activityId, t: b.startTime, partie: Number(b.countIndex) || 1 }));
  const items = (reponse.program && reponse.program.items) || [];
  const parties = partiesQa(plan);
  const planifies = new Set(parties.map((x) => x.id));
  return {
    arrivee: plan.arrivalTime || '',
    blocs,
    parties,
    noms: Object.fromEntries(items.map((i) => [i.activityId, i.name])),
    // Chaque ligne du programme telle que le serveur la chiffre : un montant
    // connu, ou regle sur place.
    items: items.map((i) => ({
      id: i.activityId, nom: i.name || i.activityId, games: Number(i.games) || 0, minutes: Number(i.minutes) || 0,
      participants: Number(i.participants) || 0, enfants: /enfant/i.test(i.unitLabel || ''),
      sessions: i.sessions, services: Array.isArray(i.services) ? i.services.length : 0,
      prix: Number(i.price) || 0, sait: i.priceKnown === true || (i.priceKnown !== false && Number(i.price) > 0),
    })),
    libres: items.filter((i) => !planifies.has(i.activityId)).map((i) => i.name),
    // Le temps que les parties de laser sans heure prennent a la suite.
    suite: Math.max(0, Math.round(Number(plan.laserPassPlan && plan.laserPassPlan.followOnMinutes) || 0)),
    fin: slot.visitEndTime || plan.endTime || '',
    fermeture: Boolean(slot.visitEndsAtClose),
    manque: Number(slot.visitShortfallMinutes) || 0,
    // Ce que le serveur nomme comme ne tenant pas avant la fermeture.
    hors: Array.isArray(slot.visitShortfallItems) ? slot.visitShortfallItems : [],
    prix: Number(reponse.price),
    complet: !reponse.program || reponse.program.priceComplete !== false,
    time: slot.time,
    opsPlan: plan,
  };
}
async function lireEcranPlan(page) {
  return page.evaluate(() => {
    const p = document.querySelector('#planZone .fg-visit');
    if (!p) return null;
    const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
    const etape = (li) => ({ t: txt(li.querySelector(':scope > b')), nom: txt(li.querySelector(':scope > span')), detail: txt(li.querySelector(':scope > small')) });
    const prixEl = p.querySelector('.fg-visit__price');
    const fin = p.querySelector('.fg-visit__step--out');
    const total = p.querySelector('.fg-visit__total');
    return {
      arrivee: txt(p.querySelector('.fg-visit__step--in > b')),
      arriveeDetail: txt(p.querySelector('.fg-visit__step--in > small')),
      etapes: Array.from(p.querySelectorAll('.fg-visit__step:not(.fg-visit__step--in):not(.fg-visit__step--free):not(.fg-visit__step--onsite):not(.fg-visit__step--incl):not(.fg-visit__step--out)')).map((li) => Object.assign(etape(li), { bouge: li.classList.contains('is-moved') })),
      libres: Array.from(p.querySelectorAll('.fg-visit__step--free i')).map((i) => txt(i)),
      surplace: Array.from(p.querySelectorAll('.fg-visit__step--onsite')).map(etape),
      finEtape: fin ? etape(fin) : null,
      span: txt(p.querySelector('.fg-visit__span')),
      prix: prixEl && prixEl.firstChild ? prixEl.firstChild.textContent.trim() : '',
      reste: txt(prixEl && prixEl.querySelector('small')),
      avis: txt(p.querySelector('.fg-visit__warn')),
      prixLignes: Array.from(p.querySelectorAll('.fg-visit__prices > div:not(.fg-visit__total)')).map((l) => ({ dt: txt(l.querySelector('dt')), dd: txt(l.querySelector('dd')) })),
      prixTotal: total ? { dt: txt(total.querySelector('dt')), dd: txt(total.querySelector('dd')) } : null,
      paiement: txt(p.querySelector('.fg-visit__pay')),
      garder: !document.querySelector('#goContact').disabled,
    };
  });
}
// LA DUREE SUR PLACE, REFAITE EN NODE. L ecran ne doit jamais annoncer un
// troisieme chiffre : seulement l ecart de ses deux heures. Additionner les
// minutes du programme aurait menti pour un grand groupe (la ligne du
// programme porte la duree d UN service, pas des deux).
function minutesEntreQa(a, b) {
  const pa = /^(\d{1,2}):(\d{2})$/.exec(String(a || ''));
  const pb = /^(\d{1,2}):(\d{2})$/.exec(String(b || ''));
  if (!pa || !pb) return 0;
  const d = (Number(pb[1]) * 60 + Number(pb[2])) - (Number(pa[1]) * 60 + Number(pa[2]));
  return d > 0 ? d : 0;
}
function dureeExacteQa(m) {
  const v = Math.max(0, Math.round(Number(m) || 0));
  if (v < 60) return `${v} min`;
  const h = Math.floor(v / 60), r = v % 60;
  return `${h} h${r ? ` ${String(r).padStart(2, '0')}` : ''}`;
}
function surPlaceAttendu(debut, fin) {
  const m = minutesEntreQa(debut, fin);
  return m > 0 ? ` · ${dureeExacteQa(m)} sur place` : '';
}
// La forme reelle d un WebP, lue dans l en-tete du fichier : c est elle que le
// `width`/`height` de la balise doit declarer, sinon le navigateur reserve une
// boite fausse et la page saute au chargement de la photo.
function tailleWebp(chemin) {
  const b = fs.readFileSync(chemin);
  const fmt = b.toString('ascii', 12, 16);
  if (fmt === 'VP8X') return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
  if (fmt === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (fmt === 'VP8L') { const bits = b.readUInt32LE(21); return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 }; }
  return null;
}

// LA PROVENANCE DE CHAQUE PHOTO D ECRAN, CENTRE PAR CENTRE (Movsar,
// 2026-09-23 : « que des images de Fun Galaxy Libramont pour Libramont et de
// Gembloux pour Gembloux ; sur internet il y a aussi des images de mi12, fais
// gaffe »). Pour chacune : l image d origine sur le site du client (son
// dossier d envoi dit le mois) et la page qui dit le centre (« Disponible a :
// Libramont » ou « ... : Gembloux » ; l image n apparait sur aucune page de
// l autre centre, releve du 2026-09-23). Le changement d enseigne a ete annonce
// par la page Facebook de Fun Galaxy Gembloux le 27 juillet 2025 (« MI12
// devient officiellement Fun Galaxy ») : toutes ces photos ont ete envoyees
// apres. Celles d octobre 2024 du site (fichiers « mi12-... », minigolf
// « Z-DSCF... », bornes d arcade au logo mi12) sont d avant et n entrent pas
// ici. Une photo absente de cette table n a pas de preuve : le gate la refuse.
const UPLOADS = 'https://fungalaxy.be/wp-content/uploads/';
const PAGE_FG = 'https://fungalaxy.be/activites/';
const PROVENANCE = {
  libramont: {
    duckpin: { origine: `${UPLOADS}2026/04/C_est-Capte-134.jpg`, page: `${PAGE_FG}duckpin-bowling/` },
    'fun-run': { origine: `${UPLOADS}2025/11/fun-run-2.jpg`, page: `${PAGE_FG}fun-run-by-pixel/` },
    'laser-couloir': { origine: `${UPLOADS}2026/04/C_est-Capte-106.jpg`, page: `${PAGE_FG}laser-game/` },
    minigolf: { origine: `${UPLOADS}2026/04/C_est-Capte-80.jpg`, page: `${PAGE_FG}minigolf-blacklight/` },
    'pistes-neon': { origine: `${UPLOADS}2026/04/C_est-Capte-120.jpg`, page: `${PAGE_FG}bowling/` },
    'salle-bowling': { origine: `${UPLOADS}2026/04/C_est-Capte-25.jpg`, page: `${PAGE_FG}bowling/` },
    simulateurs: { origine: `${UPLOADS}2026/04/C_est-Capte-6.jpg`, page: `${PAGE_FG}arcades/` },
    'billards-libramont': { origine: `${UPLOADS}2026/04/C_est-Capte-111.jpg`, page: `${PAGE_FG}billards/` },
  },
  gembloux: {
    'gembloux-golf-salle': { origine: `${UPLOADS}2025/08/Cest-Capte-41.jpg`, page: `${PAGE_FG}golf-oclock/` },
    'gembloux-golf-ecrans': { origine: `${UPLOADS}2025/08/Cest-Capte-2.jpg`, page: `${PAGE_FG}golf-oclock/` },
    'gembloux-golf-quilles': { origine: `${UPLOADS}2025/08/Cest-Capte-14.jpg`, page: `${PAGE_FG}golf-oclock/` },
    'gembloux-golf-rampe': { origine: `${UPLOADS}2025/08/Cest-Capte-33.jpg`, page: `${PAGE_FG}golf-oclock/` },
    'gembloux-golf-balle': { origine: `${UPLOADS}2025/08/Cest-Capte-37.jpg`, page: `${PAGE_FG}golf-oclock/` },
    'gembloux-golf-obstacle': { origine: `${UPLOADS}2025/08/Cest-Capte-11.jpg`, page: `${PAGE_FG}golf-oclock/` },
    'gembloux-golf-cible': { origine: `${UPLOADS}2025/08/Cest-Capte-15.jpg`, page: `${PAGE_FG}golf-oclock/` },
    'gembloux-golf-seaux': { origine: `${UPLOADS}2025/08/Cest-Capte-10.jpg`, page: `${PAGE_FG}golf-oclock/` },
  },
};
// La table des photos du script, relue dans sa source : { centre: [{ f, h }] }.
function photosDuScript(js) {
  const bloc = /var PHOTOS = \{([\s\S]*?)\n  \};/.exec(String(js).replace(/\r\n/g, '\n'));
  const out = {};
  if (!bloc) return out;
  for (const m of bloc[1].matchAll(/([a-z0-9-]+): \[([\s\S]*?)\]/g)) {
    out[m[1]] = Array.from(m[2].matchAll(/\{ f: '([a-z0-9-]+)', h: (\d+) \}/g)).map((x) => ({ f: x[1], h: Number(x[2]) }));
  }
  return out;
}
// Les photos des six ecrans telles que la page les a posees : la photo (le nom
// avant le suffixe de largeur), le cadre declare, et si elle est chargee.
// Les six ecrans du parcours de reservation. Ceux de la demande sur mesure
// (data-scene « sm-... ») n entrent dans la page que si elle se charge (un
// grand groupe tape en route) : ils ont leur propre verification
// (sur-mesure-check).
async function lirePhotosEcrans(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.fg-scene:not([data-scene^="sm-"])')).map((sc) => {
    const img = sc.querySelector('.fg-art img');
    const url = img ? (img.getAttribute('src') || img.dataset.src || '') : '';
    const m = /\/assets\/fungalaxy\/([a-z0-9-]+?)-(?:800|1600)\.webp/.exec(url);
    return { scene: sc.dataset.scene, photo: m ? m[1] : '', w: img ? Number(img.getAttribute('width')) : 0, h: img ? Number(img.getAttribute('height')) : 0, charge: Boolean(img && img.getAttribute('src')) };
  }));
}

// Les mots du client pour une duree, des groupes, une liste (memes regles que
// minutesLabel, taillesGroupes, texteGroupes, joindreListe cote client).
function minutesLabelQa(m) { m = Number(m) || 0; if (m >= 60) { const h = Math.floor(m / 60), r = m % 60; return r ? `${h}h${String(r).padStart(2, '0')}` : `${h} heure${h > 1 ? 's' : ''}`; } return `${m} min`; }
// LA PARTIE DE LASER QUE LE CLIENT LIT (Movsar, 2026-09-30 : « une partie dure
// 20 minutes », plus le temps des regles) : le jeu du centre quand le
// catalogue le sert sous le creneau de l arene, sinon rien (dureeLaser cote
// client). La console garde le creneau (25 min).
function jeuLaserQa() {
  const a = mock.ACTIVITIES.find((x) => x.id === 'laser_game') || {};
  const jeu = Number(a.gameMinutes) || 0;
  return jeu > 0 && Number(a.sessionMinutes) > jeu ? jeu : 0;
}
function sessionsQa(it) { const n = Math.trunc(Number(it.sessions) || 1); const mn = Number(it.minutes) || 0; return n < 2 || !mn ? '' : `${n} sessions de ${minutesLabelQa(Math.round(mn / n))}`; }
function detailLigneQa(it) {
  if (it.games > 0) return `${it.games} partie${it.games > 1 ? 's' : ''}`;
  return sessionsQa(it) || (it.minutes ? `${minutesLabelQa(it.minutes)}${it.services > 1 ? ' par groupe' : ''}` : '');
}
function taillesQa(tailles) { return tailles.every((x) => x === tailles[0]) ? `de ${tailles[0]}` : `(${tailles.join(' + ')})`; }
function joindreQa(liste, et) { return liste.length < 2 ? (liste[0] || '') : liste.slice(0, -1).join(', ') + et + liste[liste.length - 1]; }
function texteGroupesQa(p, avecHeures) {
  if (!p || !(p.groupes.length > 1)) return '';
  return `${p.groupes.length} groupes ${taillesQa(p.groupes.map((g) => g.joueurs))}${avecHeures ? `, à ${joindreQa(p.groupes.map((g) => g.debut), ' puis ')}` : ''}`;
}
const blancs = (x) => String(x).replace(/\s+/g, ' ').trim();
// CE QUE LE BLOC « VOTRE VISITE » DOIT ECRIRE, refait en Node sur la reponse
// (Movsar, 2026-09-24 : « plus complet et serieux, un truc super complet ») :
// l avance de l arrivee sur la premiere activite, une etape par PARTIE (son
// nom, « partie k sur N », la fin de son dernier groupe, ses groupes, ses
// pistes), les parties que le plan ne pose pas, la fin, le detail du prix
// quand la somme des montants connus EST le prix, et ce que la voix en dit.
function visiteAttendue(o) {
  const item = (id) => o.items.find((x) => x.id === id) || { id, nom: o.noms[id] || id, games: 0, minutes: 0, sessions: 1, services: 0 };
  const nom = (id) => item(id).nom || o.noms[id] || id;
  const etapes = o.parties.map((p) => {
    const it = item(p.id);
    const quoi = it.games > 1 ? `partie ${p.partie} sur ${it.games}` : it.games === 1 ? '1 partie'
      : (sessionsQa(it) || (it.minutes ? `${minutesLabelQa(it.minutes)}${p.groupes.length > 1 ? ' par groupe' : ''}` : ''));
    const jeu = p.id === 'laser_game' ? jeuLaserQa() : 0;
    return {
      t: p.debut,
      nom: nom(p.id) + (quoi ? ` · ${quoi}` : ''),
      detail: [it.participants > 0 ? `${it.participants} ${it.enfants ? 'enfant' : 'joueur'}${it.participants > 1 ? 's' : ''}` : '', jeu ? `${jeu} min de jeu` : '', p.fin ? `jusqu’à ${heureAffichee(p.fin)}${jeu ? ' avec les règles et la préparation' : ''}` : '', texteGroupesQa(p, true), p.pistes > 0 ? `${p.pistes} piste${p.pistes > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · '),
      voix: `${nom(p.id)}${quoi ? `, ${quoi}` : ''}, de ${p.debut}${p.fin ? ` à ${heureAffichee(p.fin)}` : ''}${p.groupes.length > 1 ? `, en ${p.groupes.length} groupes` : ''}`,
    };
  });
  if (!o.parties.length && !o.libres.length && !o.arrivee) etapes.push({ t: o.time, nom: 'Début', detail: '', voix: '' });
  const surPlace = [];
  // LES PARTIES SANS HEURE, DANS LA FOULEE (Movsar, 2026-09-29) : sans heure,
  // placees par l equipe, avec le temps qu elles prennent a la suite.
  o.items.forEach((it) => {
    const posees = o.parties.filter((x) => x.id === it.id).length;
    if (!(it.games >= 1) || posees >= it.games || (!posees && it.id !== 'laser_game')) return;
    const reste = [];
    for (let k = posees + 1; k <= it.games; k += 1) reste.push(String(k));
    const quelles = it.games === 1 ? '1 partie' : `partie${reste.length > 1 ? 's' : ''} ${joindreQa(reste, ' et ')} sur ${it.games}`;
    const coupees = it.id === 'laser_game' && o.fermeture ? reste.filter((k) => o.hors.some((h) => h.sansHeure && String(h.partie) === k)) : [];
    const detail = `${reste.length > 1 ? 'placées' : 'placée'} sur place avec l’équipe${it.id === 'laser_game' && o.suite ? ` · environ ${dureeExacteQa(o.suite)}` : ''}`
      + (coupees.length ? ` · ${coupees.length > 1 ? `parties ${joindreQa(coupees, ' et ')} : ne tiendront pas` : `partie ${coupees[0]} : ne tiendra pas`} avant ${heureAffichee(o.fin)}` : '');
    surPlace.push({ t: '', nom: `${nom(it.id)} · ${quelles}`, detail, voix: `${nom(it.id)}, ${quelles}, ${detail}` });
  });
  const premiere = o.parties[0];
  const avance = premiere && o.arrivee ? minutesEntreQa(o.arrivee, premiere.debut) : 0;
  const connus = o.items.filter((it) => it.sait).reduce((x, it) => x + it.prix, 0);
  const detaille = o.items.length > 1 && o.prix > 0 && Math.abs(connus - o.prix) < 0.01;
  return {
    arriveeDetail: o.arrivee ? (avance > 0 ? `${avance} min avant votre ${nom(premiere.id).toLowerCase()}` : 'on vous accueille') : '',
    etapes,
    surPlace,
    fin: o.fin ? { t: heureAffichee(o.fin), nom: 'Fin de la visite', detail: o.fermeture ? 'fermeture du centre' : 'heure estimée' } : null,
    prix: detaille ? {
      lignes: o.items.map((it) => ({ dt: blancs(`${it.nom}${detailLigneQa(it) ? ` · ${detailLigneQa(it)}` : ''}`), dd: blancs(it.sait ? euros(it.prix) : 'prix à l’accueil') })),
      total: { dt: o.complet ? 'Total indicatif' : 'Total indicatif, hors prix à l’accueil', dd: blancs(euros(o.prix)) },
      paiement: 'Montants à titre indicatif. Aucun paiement en ligne : vous réglez sur place, par carte ou en espèces.',
    } : null,
    connus,
  };
}
// CE QUI N A PAS DE TARIF EN LIGNE SE NOMME (Movsar, 2026-10-01 : « pq sur
// place ici ? tout est a payer sur place ») : « prix a l accueil ».
function sansPrixQa(o) { const n = o.items.filter((it) => !it.sait).map((it) => it.nom); return n.length ? joindreQa(n, ' et ') : 'les activités'; }
function totalQa(o) { return o.complet ? 'Total indicatif' : `Total indicatif, sans ${sansPrixQa(o)} (prix à l’accueil)`; }
// CE QUI MANQUE SE DIT PAR SON NOM quand le serveur le nomme (Movsar,
// 2026-10-01 : « faut dire tout ce qui se jouera pas ») ; sinon, la duree.
function phraseManqueQa(o) {
  if (!o.hors.length) return `il manque ${dureeApprox(o.manque)}`;
  const noms = o.hors.map((h) => (h.partie ? `${h.name} (partie ${h.partie})` : `${h.name}${!h.dayAccess && h.minutes > 0 ? ` (${dureeExacteQa(h.minutes)})` : ''}`));
  return `${o.hors.length > 1 ? 'Ne tiendront pas' : 'Ne tiendra pas'} avant la fermeture (${heureAffichee(o.fin)}) : ${joindreQa(noms, ' et ')}.`;
}
function ecartsPlan(ecran, o) {
  if (!ecran) return ['aucun bloc « votre visite » a l ecran'];
  if (!o) return ['aucun creneau dans la reponse de la route'];
  const e = [];
  const v = visiteAttendue(o);
  if (o.arrivee && ecran.arrivee !== o.arrivee) e.push(`arrivee ${ecran.arrivee} vs ${o.arrivee}`);
  if (o.arrivee && ecran.arriveeDetail !== v.arriveeDetail) e.push(`arrivee « ${ecran.arriveeDetail} » vs « ${v.arriveeDetail} »`);
  if (ecran.etapes.length !== v.etapes.length) e.push(`${ecran.etapes.length} etape(s) pour ${v.etapes.length} : ${ecran.etapes.map((x) => `${x.t} ${x.nom}`).join(' | ')}`);
  v.etapes.forEach((a, i) => {
    const x = ecran.etapes[i];
    if (!x) return;
    if (x.t !== a.t || x.nom !== a.nom) e.push(`etape ${i + 1} « ${x.t} ${x.nom} » vs « ${a.t} ${a.nom} »`);
    // « deplace pour votre X a T » s ajoute a l etape que le toucher a fait
    // bouger ([C] le verifie a part).
    const detail = x.bouge ? x.detail.replace(/(?:^| · )déplacé pour votre .+ à \d{2}:\d{2}$/, '') : x.detail;
    if (detail !== a.detail) e.push(`etape ${a.t} « ${x.detail} » vs « ${a.detail} »`);
  });
  if (ecran.libres.join(',') !== o.libres.join(',')) e.push(`libres ${ecran.libres.join(',')} vs ${o.libres.join(',')}`);
  const sp = v.surPlace.map(({ t, nom, detail }) => ({ t, nom, detail }));
  if (JSON.stringify(ecran.surplace) !== JSON.stringify(sp)) e.push(`sur place ${JSON.stringify(ecran.surplace)} vs ${JSON.stringify(sp)}`);
  if (JSON.stringify(ecran.finEtape) !== JSON.stringify(v.fin)) e.push(`fin ${JSON.stringify(ecran.finEtape)} vs ${JSON.stringify(v.fin)}`);
  const fin = o.fermeture ? `jusqu’à la fermeture (${heureAffichee(o.fin)})` : `à ${heureAffichee(o.fin)} environ`;
  if (o.fin && ecran.span.indexOf(fin) < 0) e.push(`fin « ${ecran.span} » sans « ${fin} »`);
  if (ecran.prix !== euros(o.prix)) e.push(`prix ${ecran.prix} vs ${euros(o.prix)}`);
  if ((ecran.reste === `+ ${sansPrixQa(o)}, prix à l’accueil`) !== !o.complet) e.push(`mention « + ${sansPrixQa(o)}, prix a l accueil » : « ${ecran.reste} » pour complet=${o.complet}`);
  const prixVu = { lignes: ecran.prixLignes, total: ecran.prixTotal, paiement: ecran.paiement };
  const prixAttendu = v.prix || { lignes: [], total: null, paiement: '' };
  if (JSON.stringify(prixVu) !== JSON.stringify(prixAttendu)) e.push(`detail du prix ${JSON.stringify(prixVu)} vs ${JSON.stringify(prixAttendu)} (montants connus ${v.connus}, prix ${o.prix})`);
  const manque = o.fermeture && o.manque > 0;
  const phrase = phraseManqueQa(o);
  if (manque && ecran.avis.indexOf(phrase) < 0) e.push(`avis « ${ecran.avis} » sans « ${phrase} »`);
  if (!manque && /tout ne tiendra pas/.test(ecran.avis)) e.push(`manque annonce a tort : ${ecran.avis}`);
  return e;
}

async function lirePistes(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#hourZone .fg-track')).map((t) => ({
    id: t.dataset.activity,
    count: Number(t.dataset.count) || 1,
    touchee: Boolean(t.dataset.touched),
    detail: ((t.querySelector('.fg-track__detail') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    chips: Array.from(t.querySelectorAll('.fg-chip')).map((c) => ({
      t: c.dataset.time, etat: c.dataset.state, ok: c.dataset.ok === 'true', reason: c.dataset.reason || '', conflit: c.dataset.conflict || '', sous: c.dataset.sous || '',
      replaces: c.dataset.replaces || '', partie: c.dataset.partie || '',
      mot: (c.querySelector('small') || {}).textContent || '', on: c.classList.contains('is-on'), proposed: c.classList.contains('is-proposed'),
      titre: c.getAttribute('title') || '', periode: c.closest('.fg-period') ? c.closest('.fg-period').dataset.period : '',
      // La ligne que l heure POINTE (aria-describedby), lue par ses heures.
      decrit: (() => { const id = c.getAttribute('aria-describedby'); if (!id) return ''; const l = document.getElementById(id); return l ? `#${String(l.dataset.heures || '')}` : '#absente'; })(),
    })),
    periodes: Array.from(t.querySelectorAll('.fg-period')).map((s) => ({
      nom: s.dataset.period,
      ouverte: s.classList.contains('is-open'),
      resume: s.querySelector('.fg-period__sum').textContent.trim(),
      expanded: s.querySelector('.fg-period__btn').getAttribute('aria-expanded'),
      listeCachee: s.querySelector('.fg-why-list') ? s.querySelector('.fg-why-list').hidden : null,
      raisons: Array.from(s.querySelectorAll('.fg-why-list__item')).map((l) => ({
        etat: l.dataset.etat || '',
        heures: String(l.dataset.heures || '').split(' ').filter(Boolean),
        cle: (l.querySelector('.fg-key') || {}).textContent || '',
        gras: (l.querySelector('b') || {}).textContent || '',
        texte: l.textContent.replace(/\s+/g, ' ').trim(),
      })),
    })),
    reset: !t.querySelector('[data-reset]').hidden,
    note: t.querySelector('.fg-track__note') && !t.querySelector('.fg-track__note').hidden ? t.querySelector('.fg-track__note').textContent : '',
    vagues: t.querySelector('.fg-track__waves') && !t.querySelector('.fg-track__waves').hidden ? t.querySelector('.fg-track__waves').textContent.replace(/\s+/g, ' ').trim() : '',
    // Le cadre des parties (plusieurs parties de laser).
    parts: (() => {
      const b = t.querySelector('.fg-parts');
      if (!b) return null;
      const txt = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
      return {
        tete: txt(b.querySelector('.fg-parts__head > span')),
        compte: txt(b.querySelector('.fg-parts__head > b')),
        items: Array.from(b.querySelectorAll('.fg-parts__item')).map((li) => ({ texte: txt(li.querySelector(':scope > span')), classe: ['is-set', 'is-proposed', 'is-free'].find((k) => li.classList.contains(k)) || '' })),
      };
    })(),
  })));
}
// L ETAT D UNE HEURE, redit en Node a partir de la reponse :
//   wave  : l heure que joue le groupe suivant d une heure RETENUE (le plan) ;
//   shift : chevauche une AUTRE activite posee, qui se deplacera ;
//   hard  : impossible ;
//   soft  : possible, avec l avertissement du moteur (sauf si TOUT est serre) ;
//   ok    : rien a dire.
// PLUS AUCUN « PRIS » QUI NE SE PREND PAS (Movsar, 2026-09-24 : « c est con,
// c est mal fait »). Une heure qui chevauche l une de SES parties de laser,
// jugee comme une partie en plus, est refusee ; le moteur juge a cote le
// DEPLACEMENT de cette partie-la (`move`, lib/ops-engine.js
// visitFeasibilityAt), par la meme porte que la reservation. Le toucher fait
// ce deplacement : l heure en prend le verdict.
function verdictQa(t) { return t && t.ok === false && t.move ? t.move : t; }
function etatAttendu(t, toutSerre, id, emportees, on) {
  if (!on && emportees && emportees[t.time]) return 'wave';
  const v = verdictQa(t);
  if (v.ok === false) return v.code === 'anchor_overlap' && v.conflict && v.conflict.activityId && v.conflict.activityId !== id ? 'shift' : 'hard';
  if (v.warning && !toutSerre) return 'soft';
  return 'ok';
}
// La raison qu une case porte, lue dans le verdict de ce que le toucher fait.
function raisonQa(v, id) {
  if (v.ok === false) return v.code === 'anchor_overlap' && v.conflict && v.conflict.activityId && v.conflict.activityId !== id ? (v.reason || 'Chevauche une autre activité') : (v.reason || 'Indisponible');
  return v.warning ? (v.warning.reason || 'Peu de temps pour le reste de la visite') : '';
}
// Le rang d une partie de laser posee : l ordre de ses heures.
function rangQa(parts, h) { return (parts || []).indexOf(h) + 1; }
function minutesQa(h) { const p = /^(\d{1,2}):(\d{2})$/.exec(String(h || '')); return p ? Number(p[1]) * 60 + Number(p[2]) : NaN; }
function blocsDu(d, id) { return ((((d.slots || [])[0] || {}).opsPlan || {}).resourceBlocks || []).filter((b) => b && b.activityId === id); }
// LES HEURES DU GROUPE SUIVANT, relues sur le plan, pour les SEULES heures que
// le client a retenues : la partie qu une heure retenue lance a son 1er groupe
// a cette heure, et chacun de ses groupes suivants occupe les heures de la
// grille dont la demi-heure croise son jeu. L heure PROPOSEE n emporte rien :
// le client doit pouvoir faire partir son 1er groupe a la demi-heure d apres.
function emporteesQa(d, a, retenues) {
  const blocs = blocsDu(d, a.activityId);
  const out = {};
  (retenues || []).forEach((h) => {
    const tete = blocs.find((b) => b.startTime === h && Number(b.groupWaveCount) > 1 && (Number(b.groupWaveIndex) || 1) === 1);
    if (!tete) return;
    blocs.filter((b) => (Number(b.countIndex) || 1) === (Number(tete.countIndex) || 1) && Number(b.groupWaveIndex) > 1).forEach((b) => {
      a.times.forEach((t) => {
        const m = minutesQa(t.time);
        if (!out[t.time] && m < minutesQa(b.endTime) && m + 30 > minutesQa(b.startTime)) out[t.time] = { rang: Number(b.groupWaveIndex), joueurs: Number(b.players) || 0, debut: b.startTime, fin: b.endTime, depuis: h };
      });
    });
  });
  return out;
}
// Le depart de chaque partie que le plan pose, dans l ordre des heures.
function debutsQa(d, id) {
  const par = {};
  blocsDu(d, id).forEach((b) => { if (!b.startTime) return; const k = Number(b.countIndex) || 1; if (!par[k] || String(b.startTime) < par[k]) par[k] = String(b.startTime); });
  return Object.values(par).sort();
}
function minusculeQa(s) { s = String(s || ''); return s.charAt(0).toLowerCase() + s.slice(1); }
// La plage reelle qu occupe une activite du plan a partir de son depart : de
// son depart a la fin du DERNIER groupe de la meme partie.
function plageQa(d, id, debut) {
  const parties = new Map();
  blocsDu(d, id).forEach((b) => { const k = Number(b.countIndex) || 1; if (!parties.has(k)) parties.set(k, []); parties.get(k).push(b); });
  for (const liste of parties.values()) {
    if (liste.map((b) => String(b.startTime)).sort()[0] === debut) return `${debut} à ${liste.map((b) => String(b.endTime)).sort().pop()}`;
  }
  return '';
}
// Le mot d une heure. L heure d une de SES parties porte le nom de cette
// partie (« partie 1 » quand le laser en a plusieurs, « 2e groupe » sinon) ;
// un refus qui chevaucherait une autre de ses parties dit laquelle.
function motAttendu(etat, t, w, multi, parts, id) {
  const v = verdictQa(t);
  if (etat === 'hard') {
    if (multi && v.code === 'anchor_overlap' && v.conflict && v.conflict.activityId === id && rangQa(parts, v.conflict.time)) return `partie ${rangQa(parts, v.conflict.time)}`;
    return MOTS_DURS[v.code] || 'indispo';
  }
  if (etat === 'soft') return 'serré';
  if (etat === 'shift') return 'décale';
  if (etat === 'wave') return multi ? `partie ${rangQa(parts, w.depuis)}` : `${w.rang}e groupe`;
  return '';
}
// Une piste de l ecran contre l ancre de la route : etat, raison, mot, titre,
// periode de chaque heure, la partie qu une heure deplace, le resume de chaque
// menu, les raisons ecrites sous chaque plage, puis le cadre des parties.
function ecartsPiste(p, a, actifs, propose, d, laserParts) {
  const e = [];
  if (!p) return [`${a.activityId}: piste absente`];
  const id = a.activityId;
  const multi = id === 'laser_game' && Math.max(1, Number(a.count) || 1) > 1;
  const parts = laserParts || [];
  const possibles = a.times.map(verdictQa).filter((v) => v.ok !== false);
  const toutSerre = possibles.length > 0 && possibles.every((v) => v.warning);
  const emportees = emporteesQa(d, a, actifs);
  const etatDe = (t) => etatAttendu(t, toutSerre, id, emportees, actifs.indexOf(t.time) >= 0);
  // Le verdict de ce que le toucher fait a l heure d un groupe suivant (vide
  // ailleurs), et ce qui se PREND.
  const sousDe = (t) => (etatDe(t) === 'wave' ? etatAttendu(t, toutSerre, id, null, false) : '');
  const prenableDe = (t) => etatDe(t) !== 'hard' && sousDe(t) !== 'hard';
  if (p.chips.length !== a.times.length) e.push(`${id}: ${p.chips.length} cases pour ${a.times.length} heures`);
  a.times.forEach((t, k) => {
    const c = p.chips[k] || {};
    if (c.t !== t.time) { e.push(`${id} ${t.time}: case ${c.t}`); return; }
    const on = actifs.indexOf(t.time) >= 0;
    const prop = !on && propose === t.time;
    const etat = etatDe(t);
    const w = etat === 'wave' ? emportees[t.time] : null;
    const v = verdictQa(t);
    const raison = raisonQa(v, id);
    // La partie que le toucher DEPLACE (verdict `move`), s il en deplace une.
    const deplace = t.ok === false && t.move ? String(t.move.replaces || '') : '';
    if (c.etat !== etat) e.push(`${id} ${t.time}: etat ${c.etat} attendu ${etat}`);
    if (c.ok !== prenableDe(t)) e.push(`${id} ${t.time}: data-ok ${c.ok} attendu ${prenableDe(t)}${w ? ` (depart de la partie ici : ${sousDe(t)})` : ''}`);
    if (c.replaces !== deplace) e.push(`${id} ${t.time}: deplace « ${c.replaces} » attendu « ${deplace} »`);
    if (w) {
      // L heure d un groupe suivant dit a qui elle est (sa partie, son
      // groupe), quand joue cette partie, puis ce que la toucher fait : y
      // faire partir la partie, ou pourquoi le moteur refuse ce depart.
      const sous = sousDe(t);
      const soi = v.ok === false && v.code === 'anchor_overlap' && v.conflict && v.conflict.activityId === id && rangQa(parts, v.conflict.time) > 0;
      const motif = sous === 'ok' ? '' : (soi ? `elle chevaucherait votre partie ${rangQa(parts, v.conflict.time)} (${v.conflict.time})` : minusculeQa(raison));
      const plage = plageQa(d, id, w.depuis);
      const titre = multi
        ? `Votre partie ${rangQa(parts, w.depuis)} joue ${plage ? `de ${plage}` : `à ${w.depuis}`} (${w.rang}e groupe à ${t.time}).`
          + (sous === 'hard' ? ` La faire partir à ${t.time} est impossible : ${motif}.` : ` La toucher la fait partir à ${t.time}${sous === 'ok' ? '.' : ` : ${motif}.`}`)
        : `Votre ${w.rang}e groupe (${w.joueurs} joueurs) joue de ${w.debut} à ${w.fin}, juste après le premier.`
          + (sous === 'hard' ? ` Y faire partir le 1er groupe est impossible : ${motif}.` : ` La choisir y fait partir votre 1er groupe${sous === 'ok' ? '.' : ` : ${motif}.`}`);
      if (c.reason !== titre) e.push(`${id} ${t.time}: raison « ${c.reason} » vs « ${titre} »`);
      if (c.titre !== titre) e.push(`${id} ${t.time}: titre « ${c.titre} » vs « ${titre} »`);
      if (c.sous !== sous) e.push(`${id} ${t.time}: verdict du depart « ${c.sous} » attendu « ${sous} »`);
      if (sous === 'shift' && c.conflit !== ((v.conflict && v.conflict.activityId) || '')) e.push(`${id} ${t.time}: conflit ${c.conflit} pour un depart qui decale`);
      if (c.partie !== (multi ? String(rangQa(parts, w.depuis)) : '')) e.push(`${id} ${t.time}: partie « ${c.partie} »`);
    } else {
      if (c.sous) e.push(`${id} ${t.time}: verdict de depart « ${c.sous} » hors d une heure de groupe suivant`);
      if (c.partie) e.push(`${id} ${t.time}: partie « ${c.partie} » hors d une heure de groupe suivant`);
      if (c.reason !== raison) e.push(`${id} ${t.time}: raison « ${c.reason} » vs « ${raison} »`);
      // Deplacer une partie : laquelle (son rang, son heure) et vers ou.
      let titre = raison;
      if (deplace) {
        const qui = `votre partie${rangQa(parts, deplace) ? ` ${rangQa(parts, deplace)}` : ''} (${deplace})`;
        titre = etat === 'hard' ? `Déplacer ${qui} à ${t.time} est impossible : ${minusculeQa(raison)}.` : `Déplace ${qui} à ${t.time}${etat === 'ok' ? '.' : ` : ${minusculeQa(raison)}.`}`;
      }
      const attendu = etat === 'ok' && prop ? 'Heure proposée pour votre visite' : titre;
      if (c.titre !== attendu) e.push(`${id} ${t.time}: titre « ${c.titre} » vs « ${attendu} »`);
    }
    if (c.on !== on || c.proposed !== prop) e.push(`${id} ${t.time}: choisi=${c.on}/${on} propose=${c.proposed}/${prop}`);
    const mot = on ? (multi ? `partie ${rangQa(parts, t.time)}` : 'choisi') : prop ? 'proposé' : motAttendu(etat, t, w, multi, parts, id);
    if (c.mot !== mot) e.push(`${id} ${t.time}: mot « ${c.mot} » vs « ${mot} »`);
    if (etat === 'shift' && c.conflit !== ((v.conflict && v.conflict.activityId) || '')) e.push(`${id} ${t.time}: conflit ${c.conflit}`);
    if (c.periode !== periodeDe(t.time)) e.push(`${id} ${t.time}: rangee en ${c.periode}`);
  });
  const parPeriode = new Map();
  a.times.forEach((t) => { const nom = periodeDe(t.time); if (!parPeriode.has(nom)) parPeriode.set(nom, []); parPeriode.get(nom).push(t); });
  const noms = [...parPeriode.keys()];
  if (p.periodes.map((x) => x.nom).join(',') !== noms.join(',')) e.push(`${id}: menus ${p.periodes.map((x) => x.nom).join(',')} vs ${noms.join(',')}`);
  noms.forEach((nom) => {
    const liste = parPeriode.get(nom);
    // Le compte d une plage : ce qui se PREND. Ni un refus, ni un depart que
    // le moteur refuse ; l heure d un groupe suivant, elle, se prend (la
    // partie y part).
    const n = liste.filter(prenableDe).length;
    const choisis = liste.filter((t) => actifs.indexOf(t.time) >= 0).map((t) => t.time);
    const prop = actifs.length ? null : liste.find((t) => t.time === propose);
    // L heure d un groupe suivant qui tombe dans cette plage, quand aucune
    // heure n y est choisie : le menu la dit, meme replie, par son nom.
    const vaguesIci = liste.filter((t) => etatDe(t) === 'wave').map((t) => `${motAttendu('wave', t, emportees[t.time], multi, parts, id)} à ${t.time}`);
    // Le vocabulaire du client, pas celui du planning : « 3 au choix », « une
    // seule possible ».
    let resume = n > 1 ? `${n} au choix` : n === 1 ? 'une seule possible' : 'rien de possible';
    if (choisis.length) resume = `choisi ${choisis.join(' et ')} · ${resume}`;
    else if (vaguesIci.length) resume = `${vaguesIci.join(', ')} · ${resume}`;
    else if (prop) resume = `proposé ${prop.time} · ${resume}`;
    const x = p.periodes.find((y) => y.nom === nom) || {};
    if (x.resume !== resume) e.push(`${id} ${nom}: resume « ${x.resume} » vs « ${resume} »`);
    if (String(x.ouverte) !== x.expanded) e.push(`${id} ${nom}: aria-expanded ${x.expanded} pour ouvert=${x.ouverte}`);
  });
  e.push(...ecartsRaisons(p, a, actifs, propose, d, etatDe, parPeriode, multi, parts));
  const note = toutSerre;
  if (Boolean(p.note) !== note) e.push(`${id}: note « serre a toute heure » ${p.note ? 'affichee' : 'absente'}, attendue ${note}`);
  // La note des groupes : la piste la montre SSI le plan scinde son activite.
  const scinde = blocsDu(d, id).some((b) => Number(b.groupWaveCount) > 1);
  if (Boolean(p.vagues) !== scinde) e.push(`${id}: note des groupes ${p.vagues ? `« ${p.vagues} »` : 'absente'} pour un plan ${scinde ? '' : 'non '}scinde`);
  e.push(...ecartsParties(p, a, d, parts));
  return e;
}
// LE CADRE DES PARTIES (Movsar, 2026-09-24 : « faut que ca montre qu ils ont
// selectionne x heures sur x parties ») : sur la piste d un laser de
// plusieurs parties, « Vos N parties », le compte des heures choisies sur N,
// puis une ligne par partie : son heure et la fin de son dernier groupe (le
// plan), « proposee » tant qu aucune heure n est choisie, ou « sur place avec
// l equipe » quand rien ne la pose. Le bandeau dit « N parties de X ».
function ecartsParties(p, a, d, laserParts) {
  const id = a.activityId;
  const total = Math.max(1, Number(a.count) || 1);
  if (!(id === 'laser_game' && total > 1)) return p.parts ? [`${id}: cadre des parties pour ${total} partie`] : [];
  if (!p.parts) return [`${id}: cadre des parties absent pour ${total} parties`];
  const e = [];
  const bandeau = `${a.participants} joueur${a.participants > 1 ? 's' : ''} · ${total} parties de ${minutesLabelQa(jeuLaserQa() || a.durationMinutes)}`;
  if (p.detail !== bandeau) e.push(`${id}: bandeau « ${p.detail} » vs « ${bandeau} »`);
  const n = laserParts.length;
  // Le plan ne pose que les parties choisies : une partie sans heure passe
  // bien sur place (sinon « sur place avec l equipe » serait faux).
  const posees = debutsQa(d, id);
  if (n && JSON.stringify(posees) !== JSON.stringify(laserParts.slice().sort())) e.push(`${id}: le plan pose ${posees.join(', ') || 'rien'} pour les parties choisies ${laserParts.join(', ')}`);
  const heures = n ? laserParts.slice() : posees;
  const compte = n ? `${n} heure${n > 1 ? 's' : ''} choisie${n > 1 ? 's' : ''} sur ${total}` : 'aucune heure choisie';
  if (p.parts.tete !== `Vos ${total} parties` || p.parts.compte !== compte) e.push(`${id}: cadre « ${p.parts.tete} / ${p.parts.compte} » vs « Vos ${total} parties / ${compte} »`);
  const attendus = [];
  for (let k = 0; k < total; k += 1) {
    const h = heures[k] || '';
    const plage = h ? plageQa(d, id, h) : '';
    const fin = plage ? plage.split(' à ').pop() : '';
    attendus.push({ texte: `Partie ${k + 1} : ${h ? `${h}${fin ? ` → ${heureAffichee(fin)}` : ''}${n ? '' : ' proposée'}` : 'dans la foulée'}`, classe: h ? (n ? 'is-set' : 'is-proposed') : 'is-free' });
  }
  if (JSON.stringify(p.parts.items) !== JSON.stringify(attendus)) e.push(`${id}: parties ${JSON.stringify(p.parts.items)} vs ${JSON.stringify(attendus)}`);
  return e;
}
// LES RAISONS SOUS CHAQUE PLAGE (Movsar, 2026-09-23 : « pour les choix des
// heures faut tout expliquer, quand ya des decale faut expliquer pq, quand c
// complet aussi » ; 2026-09-24 : « trop long, mal explique »). Les regles :
// chaque heure qui n est ni libre, ni choisie, ni proposee, ni l heure d une
// de SES parties (nommee sur la case) s explique UNE fois, et aucune autre ;
// chaque ligne dit la VERITE de la reponse : la raison du moteur mot pour mot
// (refus, avertissement), l activite, la plage reelle et le sort de ce qui se
// deplacerait (decalage) ; sa cle porte le mot de la case, ses heures sont en
// gras.
function ecartsRaisons(p, a, actifs, propose, d, etatDe, parPeriode, multi, parts) {
  const e = [];
  const id = a.activityId;
  const ancres = (d.anchors && d.anchors.activities) || [];
  parPeriode.forEach((liste, nom) => {
    const x = p.periodes.find((y) => y.nom === nom);
    if (!x) return;
    const attendues = liste
      .filter((t) => actifs.indexOf(t.time) < 0 && propose !== t.time && etatDe(t) !== 'ok' && etatDe(t) !== 'wave')
      .map((t) => t.time);
    const vues = x.raisons.reduce((acc, r) => acc.concat(r.heures), []);
    attendues.forEach((h) => { const n = vues.filter((v) => v === h).length; if (n !== 1) e.push(`${id} ${h}: expliquee ${n} fois sous « ${nom} »`); });
    // Chaque heure expliquee POINTE sa ligne (un lecteur d ecran la lit en
    // arrivant sur l heure) ; les autres ne pointent rien.
    liste.forEach((t) => {
      const c = p.chips.find((y) => y.t === t.time) || {};
      const doit = attendues.indexOf(t.time) >= 0;
      const pointe = String(c.decrit || '').replace(/^#/, '').split(' ').filter(Boolean);
      if (doit && pointe.indexOf(t.time) < 0) e.push(`${id} ${t.time}: pointe « ${c.decrit || 'rien'} » au lieu de sa ligne`);
      if (!doit && c.decrit) e.push(`${id} ${t.time}: pointe « ${c.decrit} » sans rien a expliquer`);
    });
    vues.filter((h) => attendues.indexOf(h) < 0).forEach((h) => e.push(`${id} ${h}: expliquee sous « ${nom} » sans rien qui coince`));
    if (x.listeCachee !== (x.raisons.length === 0)) e.push(`${id} ${nom}: liste des raisons ${x.listeCachee ? 'cachee' : 'visible'} avec ${x.raisons.length} ligne(s)`);
    x.raisons.forEach((r) => {
      const enGras = r.gras.match(/\d{1,2}:\d{2}/g) || [];
      if (enGras.length !== r.heures.length || r.heures.some((h) => enGras.indexOf(h) < 0)) e.push(`${id} ${nom}: la ligne « ${r.texte} » met en gras « ${r.gras} » pour ${r.heures.join(' ')}`);
      const basse = r.texte.toLowerCase();
      r.heures.forEach((h) => {
        const t = liste.find((y) => y.time === h);
        if (!t) return;
        const etat = etatDe(t);
        const v = verdictQa(t);
        if (r.etat !== etat) e.push(`${id} ${h}: ligne « ${r.etat} » pour une heure « ${etat} »`);
        if (etat === 'ok' || etat === 'wave') return;
        if (r.cle !== motAttendu(etat, t, null, multi, parts, id)) e.push(`${id} ${h}: cle « ${r.cle} » vs « ${motAttendu(etat, t, null, multi, parts, id)} »`);
        if (etat === 'hard' && v.code === 'anchor_overlap' && v.conflict && v.conflict.time) {
          // UNE AUTRE DE SES PARTIES : la ligne dit laquelle et quand elle
          // joue (la plage du plan, groupes compris).
          const k = rangQa(parts, v.conflict.time);
          const plage = plageQa(d, v.conflict.activityId, v.conflict.time);
          const phrase = `Votre partie${k ? ` ${k}` : ''} de ${String(a.label || id).toLowerCase()} joue ${plage ? `de ${plage}` : `à ${v.conflict.time}`}.`;
          if (r.texte.indexOf(phrase) < 0) e.push(`${id} ${h}: « ${r.texte} » sans « ${phrase} »`);
        } else if (etat === 'hard' || etat === 'soft') {
          const raison = etat === 'soft' ? (v.warning.reason || 'Peu de temps pour le reste de la visite') : (v.reason || 'Indisponible');
          if (basse.indexOf(String(raison).toLowerCase()) < 0) e.push(`${id} ${h}: « ${r.texte} » sans la raison du moteur « ${raison} »`);
        }
        if (etat === 'shift') {
          // L activite qui bougerait, sa plage reelle, et son SORT : une
          // partie de laser parmi d autres posees passe dans la foulee, sans
          // heure fixe, le reste se decale avant ou apres.
          const autre = ancres.find((y) => y.activityId === v.conflict.activityId);
          const nomAutre = String((autre && autre.label) || v.conflict.activityId).toLowerCase();
          const plage = plageQa(d, v.conflict.activityId, v.conflict.time);
          const quand = plage ? `(${plage})` : `de ${v.conflict.time}`;
          const sort = v.conflict.activityId === 'laser_game' && parts.length > 1 && rangQa(parts, v.conflict.time) ? 'qui passe dans la foulée, sans heure fixe.' : 'qui se décale avant ou après.';
          if (basse.indexOf(nomAutre) < 0 || r.texte.indexOf(quand) < 0 || !r.texte.endsWith(sort)) e.push(`${id} ${h}: « ${r.texte} » ne dit pas « ${nomAutre} », « ${quand} » et « ${sort} »`);
        }
      });
    });
  });
  return e;
}
// Le menu qui doit etre ouvert sur une piste que le client n a pas touchee :
// celui de l heure choisie, sinon proposee, sinon le premier possible.
function menuUtile(a, actifs, propose) {
  const cible = a.times.find((t) => actifs.indexOf(t.time) >= 0) || a.times.find((t) => !actifs.length && t.time === propose)
    || a.times.find((t) => t.ok !== false) || a.times[0];
  return cible ? periodeDe(cible.time) : '';
}
function ecartsMenus(p, a, actifs, propose) {
  const ouverts = p.periodes.filter((x) => x.ouverte).map((x) => x.nom);
  const attendu = menuUtile(a, actifs, propose);
  return ouverts.length === 1 && ouverts[0] === attendu ? [] : [`${a.activityId}: menus ouverts ${ouverts.join('+') || 'aucun'} vs ${attendu}`];
}
// Poser une heure : ouvrir son menu s il est ferme, puis toucher la case.
async function toucherHeure(page, id, t) {
  const sel = `#hourZone .fg-track[data-activity="${id}"] .fg-chip[data-time="${t}"]`;
  const periode = await page.evaluate((s) => { const c = document.querySelector(s); const sec = c && c.closest('.fg-period'); return sec && !sec.classList.contains('is-open') ? sec.dataset.period : ''; }, sel);
  if (periode) await page.click(`#hourZone .fg-track[data-activity="${id}"] .fg-period[data-period="${periode}"] .fg-period__btn`);
  await attendre(page, (s) => { const c = document.querySelector(s); if (!c) return false; const r = c.getBoundingClientRect(); const ul = c.closest('.fg-chips'); return r.height > 30 && ul.getBoundingClientRect().height >= r.height && getComputedStyle(ul).opacity === '1'; }, 4000, sel);
  await page.click(sel);
}
// Une pose recalcule la piste : on attend LA reponse de la route, puis la fin
// du voile.
async function poserEtAttendre(page, id, t) {
  const reponse = page.waitForResponse((r) => r.url().indexOf('/api/public-availability?') >= 0, { timeout: 25000 }).catch(() => null);
  await toucherHeure(page, id, t);
  const r = await reponse;
  const fini = await attendre(page, () => !document.querySelector('#hourZone').classList.contains('is-busy') && document.querySelector('#planZone .fg-visit, #planZone .fg-notice'), 25000);
  return Boolean(r) && fini;
}
// UN RECAPITULATIF LU A L ECRAN : ses rangees, ses activites, son total, son
// paiement, logos compris. Le meme lecteur pour la carte de l ecran des
// coordonnees et pour le dernier ecran : ils doivent dire la meme chose.
async function lireRecap(page, racine) {
  return page.evaluate((sel) => {
    const r = document.querySelector(sel);
    if (!r) return null;
    const txt = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
    return {
      lignes: Array.from(r.querySelectorAll('.fg-recap__row')).map(txt),
      items: Array.from(r.querySelectorAll('.fg-recap__item')).map((n) => ({ nom: txt(n.querySelector('.fg-recap__name')), detail: txt(n.querySelector('.fg-recap__detail')), aside: txt(n.querySelector('.fg-recap__aside')) })),
      libelle: txt(r.querySelector('.fg-total__label')),
      total: Number((r.querySelector('.fg-total__amount') || { dataset: {} }).dataset.total),
      montant: txt(r.querySelector('.fg-total__amount')),
      paiement: txt(r.querySelector('.fg-total__pay')),
      logos: Array.from(r.querySelectorAll('.fg-total__pay use')).map((u) => u.getAttribute('href')),
    };
  }, racine);
}
async function centrages(page) {
  await attendre(page, () => Array.from(document.querySelectorAll('#hourZone .fg-chip')).every((c) => c.getAnimations().length === 0), 4000);
  return page.evaluate(() => Array.from(document.querySelectorAll('#hourZone .fg-period.is-open .fg-chip')).map((c) => {
    const r = c.getBoundingClientRect();
    const b = c.querySelector('b').getBoundingClientRect();
    const s = c.querySelector('small');
    const vide = getComputedStyle(s).display === 'none';
    const bas = vide ? b.bottom : s.getBoundingClientRect().bottom;
    return { t: c.dataset.time, mot: s.textContent, ecart: Math.abs((b.top + bas) / 2 - (r.top + r.bottom) / 2) };
  }));
}
// La barre des etapes, lue segment par segment : « 1 » plein, « 0 » vide. Une
// attente bornee : le remplissage est anime, on lit l etat d arrivee.
async function barreEst(page, motif) {
  return attendre(page, (m) => Array.from(document.querySelectorAll('.fg-scene.is-active .fg-steps__item'))
    .map((li) => (/^matrix\(1, /.test(getComputedStyle(li.querySelector('.fg-steps__seg'), '::after').transform) ? '1' : '0')).join('') === m, 4000, motif);
}
// Une capture PNG decodee en Node (8 bits, sans entrelacement : ce que rend
// Playwright), sans bibliotheque : pixel(x, y) -> [r, g, b].
function decoderPng(buf) {
  let i = 8, w = 0, h = 0, type = 0;
  const morceaux = [];
  while (i < buf.length) {
    const n = buf.readUInt32BE(i);
    const t = buf.toString('ascii', i + 4, i + 8);
    if (t === 'IHDR') { w = buf.readUInt32BE(i + 8); h = buf.readUInt32BE(i + 12); type = buf[i + 17]; }
    if (t === 'IDAT') morceaux.push(buf.slice(i + 8, i + 8 + n));
    i += 12 + n;
  }
  const brut = zlib.inflateSync(Buffer.concat(morceaux));
  const bpp = type === 6 ? 4 : 3;
  const ligne = w * bpp;
  const px = Buffer.alloc(ligne * h);
  for (let y = 0; y < h; y += 1) {
    const f = brut[y * (ligne + 1)];
    for (let x = 0; x < ligne; x += 1) {
      const v = brut[y * (ligne + 1) + 1 + x];
      const a = x >= bpp ? px[y * ligne + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * ligne + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * ligne + x - bpp] : 0;
      let r = v;
      if (f === 1) r = v + a;
      else if (f === 2) r = v + b;
      else if (f === 3) r = v + ((a + b) >> 1);
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      px[y * ligne + x] = r & 255;
    }
  }
  return { w, h, pixel: (x, y) => { const k = y * ligne + x * bpp; return [px[k], px[k + 1], px[k + 2]]; } };
}
function linQa(v) { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }
function lumQa(p) { return 0.2126 * linQa(p[0]) + 0.7152 * linQa(p[1]) + 0.0722 * linQa(p[2]); }
// LA PHOTO LA PLUS CLAIRE POSSIBLE. Les photos tournent a chaque visite et
// derivent a l ecran : mesure sur la photo du moment, un texte passait ou
// cassait selon le tirage (« 23:30 » vert a un passage, 4,48:1 au suivant,
// sur le meme code).
// Pendant la mesure, chaque photo devient donc un BLANC PUR, le pire qu une
// photo puisse faire sous son voile, et la photo d une carte d activite est
// montree comme au survol : un texte qui tient ici tient sur n importe quelle
// photo, celles d aujourd hui comme celles qui viendront.
const PHOTOS_BLANCHES = ' .fg-art, .fg-card__photo { background: #fff !important; } .fg-art img, .fg-card__photo img { visibility: hidden !important; } .fg-card:not(.is-on) .fg-card__photo { opacity: 1 !important; }';
// LE CONTRASTE D UN TEXTE, AU PIRE (WCAG 1.4.3 : 4,5:1, et 3:1 pour un grand
// texte). Deux mesures, la plus severe gagne :
//   - LES PIXELS : tout le texte de la page est rendu transparent, chaque
//     photo devient la plus claire possible (PHOTOS_BLANCHES), la vue est
//     capturee (animations figees), et chaque ligne du texte mesure est
//     comparee au pixel le plus defavorable de sa boite : photo, voile, cartes
//     et halos compris, tels qu ils sont peints ;
//   - LES HALOS : ils derivent en boucle, et un texte pose sur la page (hors
//     photo) peut passer sous leur coeur. Son fond est donc aussi pris sous
//     l arret le plus lumineux des halos affiches, puis sous chaque couche
//     semi-transparente entre la page et lui (l arret le plus clair de ses
//     degrades compris).
// La capture est decodee ICI, en Node : un second onglet pour la decoder
// passait l onglet mesure en arriere-plan, et sa capture rendait une image
// perimee. Rend, pour chaque texte visible : son extrait, son rapport, son seuil.
async function contrastesPires(page, selecteur) {
  const out = [];
  await page.bringToFront();
  const n = await page.evaluate((sel) => {
    document.querySelectorAll('[data-qa-contraste]').forEach((el) => el.removeAttribute('data-qa-contraste'));
    const cibles = Array.from(document.querySelectorAll(sel)).filter((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      // Un texte cache a l oeil et garde pour les lecteurs d ecran (boite de
      // 1 px, clip a zero : le mot « Retour » du bouton carre sur telephone)
      // ne se lit pas. Sa case d un pixel posee sur la photo n est pas un
      // texte a mesurer : la regle porte sur ce qui se VOIT.
      let lecteurSeul = false;
      for (let p = el; p && p.nodeType === 1 && !lecteurSeul; p = p.parentElement) {
        const s = getComputedStyle(p);
        const b = p.getBoundingClientRect();
        lecteurSeul = /^rect\((0(px)?[ ,]*){4}\)$/.test(s.clip) || (b.width <= 1 && b.height <= 1 && s.overflow === 'hidden');
      }
      return !lecteurSeul && r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
        && Array.from(el.childNodes).some((t) => t.nodeType === 3 && t.textContent.trim());
    });
    cibles.forEach((el, k) => el.setAttribute('data-qa-contraste', String(k)));
    return cibles.length;
  }, selecteur);
  // LES COULEURS DE TEXTE, LUES UNE FOIS, AVANT TOUT MASQUE : les puces et les
  // lignes font une transition de couleur (0,2 a 0,4 s). Relues juste apres le
  // masque, elles sortaient presque transparentes, et tout mesurait 1:1.
  const couleurs = await page.evaluate((total) => Array.from({ length: total }, (x, i) => getComputedStyle(document.querySelector(`[data-qa-contraste="${i}"]`)).color), n);
  const faits = new Set();
  for (let k = 0; k < n; k += 1) {
    if (faits.has(k)) continue;
    await page.evaluate((i) => document.querySelector(`[data-qa-contraste="${i}"]`).scrollIntoView({ block: 'center' }), k);
    // Le texte est masque AVANT de lire les lignes : rien ne bouge plus entre
    // la lecture et la capture.
    await page.addStyleTag({ content: '*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; } [data-qa-masque] {}' + PHOTOS_BLANCHES });
    const vus = await page.evaluate((total) => {
      const couleur = (s) => { const m = /rgba?\(([^)]+)\)/.exec(String(s || '')); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
      const arrets = (img) => (String(img || '').match(/rgba?\([^)]+\)/g) || []).map(couleur).filter(Boolean);
      const sur = (h, b) => ({ r: h.r * h.a + b.r * (1 - h.a), g: h.g * h.a + b.g * (1 - h.a), b: h.b * h.a + b.b * (1 - h.a), a: 1 });
      const lin = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
      const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
      const plusClair = (liste) => liste.reduce((m, c) => (!m || lum(c) > lum(m) ? c : m), null);
      const racine = document.querySelector('.fg-page') || document.body;
      const fondPage = couleur(getComputedStyle(racine).backgroundColor) || { r: 0, g: 0, b: 0, a: 1 };
      // LE PIC DE CHAQUE HALO, compose a SON niveau : les halos se peignent
      // au-dessus du fond de la coquille qui les porte, sous ce qui vient
      // apres. Composes sous la racine, ils etaient effaces par le fond opaque
      // du corps de page, et un texte au coeur du halo se mesurait sur le noir.
      const pics = Array.from(document.querySelectorAll('.fg-glow i'))
        .filter((i) => i.getClientRects().length && getComputedStyle(i).display !== 'none')
        .map((i) => arrets(getComputedStyle(i).backgroundImage).reduce((m, c) => (c.a > m.a ? c : m), { r: 0, g: 0, b: 0, a: 0 }));
      const hote = pics.length ? document.querySelector('.fg-glow').parentElement : null;
      const sousHalo = (f) => plusClair([f].concat(pics.map((c) => sur(c, f))));
      const art = document.querySelector('.fg-scene.is-active .fg-art');
      const ra = art && art.getClientRects().length ? art.getBoundingClientRect() : null;
      const res = [];
      for (let i = 0; i < total; i += 1) {
        const el = document.querySelector(`[data-qa-contraste="${i}"]`);
        const lignes = [];
        Array.from(el.childNodes).filter((t) => t.nodeType === 3 && t.textContent.trim()).forEach((t) => {
          const r = document.createRange();
          r.selectNodeContents(t);
          Array.from(r.getClientRects()).forEach((x) => { if (x.width > 0.5 && x.height > 0.5) lignes.push({ x: x.left, y: x.top, w: x.width, h: x.height }); });
        });
        const dansLaVue = lignes.length && lignes.every((x) => x.y >= 0 && x.y + x.h <= innerHeight && x.x >= 0 && x.x + x.w <= innerWidth);
        if (!dansLaVue) continue;
        let opacite = 1;
        for (let p = el; p && p.nodeType === 1; p = p.parentElement) opacite *= Number(getComputedStyle(p).opacity);
        const surPhoto = Boolean(ra) && lignes.some((x) => x.x < ra.right && x.x + x.w > ra.left && x.y < ra.bottom && x.y + x.h > ra.top);
        let pireHalo = null;
        if (!surPhoto) {
          const chaine = [];
          for (let p = el; p && p !== racine && p.nodeType === 1; p = p.parentElement) chaine.unshift(p);
          let fond = fondPage;
          chaine.forEach((p) => {
            const s = getComputedStyle(p);
            const c = couleur(s.backgroundColor);
            if (c && c.a > 0) fond = sur(c, fond);
            const deg = arrets(s.backgroundImage).filter((x) => x.a > 0);
            if (deg.length) fond = plusClair(deg.map((x) => sur(x, fond)));
            if (p === hote) fond = sousHalo(fond);
          });
          pireHalo = [fond.r, fond.g, fond.b];
        }
        const cs = getComputedStyle(el);
        const taille = parseFloat(cs.fontSize) || 16;
        res.push({ i, texte: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 36), opacite, lignes, pireHalo, grand: taille >= 24 || (taille >= 18.66 && Number(cs.fontWeight) >= 700) });
      }
      return { largeur: window.innerWidth, res };
    }, n);
    const png = decoderPng(await page.screenshot({ animations: 'disabled' }));
    await page.evaluate(() => { Array.from(document.querySelectorAll('style')).filter((x) => /\[data-qa-masque\]/.test(x.textContent)).forEach((x) => x.remove()); });
    const echelle = png.w / vus.largeur;
    vus.res.forEach((v) => {
      if (faits.has(v.i)) return;
      const m = /rgba?\(([^)]+)\)/.exec(couleurs[v.i]);
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
      const a = (p.length > 3 ? p[3] : 1) * v.opacite;
      const rapport = (bg) => { const t = [0, 1, 2].map((k2) => p[k2] * a + bg[k2] * (1 - a)); const lt = lumQa(t), lb = lumQa(bg); return (Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05); };
      let pire = 99;
      v.lignes.forEach((l) => {
        const x0 = Math.max(0, Math.floor(l.x * echelle)), y0 = Math.max(0, Math.floor(l.y * echelle));
        const x1 = Math.min(png.w, Math.ceil((l.x + l.w) * echelle)), y1 = Math.min(png.h, Math.ceil((l.y + l.h) * echelle));
        for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) pire = Math.min(pire, rapport(png.pixel(x, y)));
      });
      const halo = v.pireHalo ? rapport(v.pireHalo) : 99;
      faits.add(v.i);
      out.push({ i: v.i, texte: v.texte, pixels: Math.round(pire * 100) / 100, halo: v.pireHalo ? Math.round(halo * 100) / 100 : null, ratio: Math.round(Math.min(pire, halo) * 100) / 100, seuil: v.grand ? 3 : 4.5 });
    });
    if (!faits.has(k)) { faits.add(k); out.push({ i: k, texte: '(jamais entier dans la vue)', pixels: 0, halo: null, ratio: 0, seuil: 4.5 }); }
  }
  await page.evaluate(() => { document.querySelectorAll('[data-qa-contraste]').forEach((el) => el.removeAttribute('data-qa-contraste')); window.scrollTo(0, 0); });
  // Les couleurs reviennent en transition : on les laisse finir.
  await dormir(500);
  return out;
}
async function lireMois(page) {
  return page.evaluate(() => ({
    titre: document.querySelector('#calTitle').textContent.trim(),
    prev: document.querySelector('#calPrev').disabled,
    next: document.querySelector('#calNext').disabled,
    vides: document.querySelectorAll('#calGrid .fg-cal__void').length,
    jours: Array.from(document.querySelectorAll('#calGrid .fg-cal__day')).map((b) => ({ date: b.dataset.date, off: b.disabled, cls: b.className, titre: b.getAttribute('title') || '', point: Boolean(b.querySelector('i')), chargement: b.classList.contains('is-loading') })),
  }));
}
async function allerAuMois(page, dateStr) {
  const [y, mo] = dateStr.split('-').map(Number);
  const cible = `${cap(MOIS[mo - 1])} ${y}`;
  for (let k = 0; k < 16; k += 1) {
    const titre = await page.evaluate(() => document.querySelector('#calTitle').textContent.trim());
    if (titre === cible) break;
    const [nom, an] = titre.split(' ');
    const courant = Number(an) * 12 + MOIS.indexOf(nom.toLowerCase());
    await page.click(y * 12 + (mo - 1) > courant ? '#calNext' : '#calPrev');
    await attendre(page, (t) => document.querySelector('#calTitle').textContent.trim() !== t, 3000, titre);
  }
  return attendre(page, (d) => { const b = document.querySelector(`#calGrid .fg-cal__day[data-date="${d}"]`); return b && !b.classList.contains('is-loading'); }, 8000, dateStr);
}

async function main() {
  const srv = await serveur();
  const browser = await chromium.launch({ executablePath: BROWSER_PATH, headless: true });
  const meta = mock.metaPayload('', 45);
  const calendrier = meta.center.calendar;
  const TODAY = mock.TODAY;
  const HORIZON = plusJours(TODAY, Number(meta.bookingHorizonDays) || 365);
  const PROGRAMME = [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 2 }, { activityId: 'minigolf_blacklight' }, { activityId: 'arcade_time' }];
  const nomDe = (id) => (mock.ACTIVITIES.find((a) => a.id === id) || {}).name || id;
  // L oracle du calendrier : l annee entiere, sur la meme route, par tranches
  // de 90 jours (le plafond de la route).
  const oracleJours = {};
  for (let k = 0; k * 90 <= (Number(meta.bookingHorizonDays) || 365); k += 1) {
    const r = await lireJson(`${BASE_URL}/api/public-booking-meta?centerId=libramont&calendar=90&calendarFrom=${plusJours(TODAY, k * 90)}`);
    ((r.center && r.center.calendar) || []).forEach((j) => { oracleJours[j.date] = j; });
  }
  const erreursPage = [];
  try {
    // =====================================================================
    console.log('[A] MONTAGE, POIDS');
    // =====================================================================
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const demandes = [];
    const reponsesMeta = [];
    page.on('request', (r) => demandes.push(r.url()));
    page.on('response', (r) => { if (r.url().indexOf('/api/public-booking-meta?') >= 0) reponsesMeta.push({ url: r.url(), status: r.status() }); });
    page.on('pageerror', (err) => erreursPage.push(String(err && err.message || err)));
    await page.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    ok(await attendre(page, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000),
      '[A] le catalogue est lu : un jour est propose');
    const jour = await page.evaluate(() => document.querySelector('#dayLabel').textContent.trim());
    const premierOuvert = calendrier.find((d) => d.open);
    ok(Boolean(premierOuvert) && jour === jourLong(premierOuvert.date), '[A] le jour propose est le PREMIER jour ouvert du calendrier servi', `${jour} / ${premierOuvert && premierOuvert.date}`);
    // Le jour pre-choisi peut etre aujourd hui : l indice le dit, en toutes
    // lettres, avant l horaire (meta.today est la date du centre).
    const indice0 = await page.evaluate(() => document.querySelector('#dayHint').textContent.replace(/\s+/g, ' ').trim());
    const rel0 = premierOuvert.date === TODAY ? 'Aujourd’hui · ' : premierOuvert.date === plusJours(TODAY, 1) ? 'Demain · ' : '';
    ok(plat(indice0).indexOf(plat(`${rel0}Ouvert ${horaire(premierOuvert.schedule)}`)) === 0, '[A] sous le jour propose : « Aujourd’hui » ou « Demain » quand c est le cas, puis l horaire', `${premierOuvert.date} « ${indice0} »`);
    const montage = await page.evaluate(() => {
      const scene = document.querySelector('.fg-scene.is-active');
      const img = scene.querySelector('.fg-art img');
      return {
        scene: scene && scene.dataset.scene,
        etapes: scene.querySelectorAll('[data-steps] .fg-steps__item').length,
        active: scene.querySelector('[data-steps] .fg-steps__item.is-active .lbl') ? scene.querySelector('[data-steps] .fg-steps__item.is-active .lbl').textContent.trim() : '',
        photo: Boolean(img && img.complete && img.naturalWidth > 0),
        pax: document.querySelector('#paxOut').textContent.trim(),
        saisie: document.querySelector('#paxInput').value,
        mots: Array.from(scene.querySelectorAll('.fg-title .w > span')).map((s) => s.textContent),
        halos: document.querySelectorAll('.fg-glow i').length,
      };
    });
    ok(montage.scene === 'date' && montage.etapes === 5 && montage.active === 'Date & groupe', '[A] le fil des 5 etapes est rendu, etape 1 active', JSON.stringify({ scene: montage.scene, etapes: montage.etapes, active: montage.active }));
    ok(montage.photo, '[A] la photo de l ecran est decodee');
    // Les six photos tirees au chargement : le parcours doit montrer
    // exactement celles-ci (verifie a l ecran final).
    const photosDepart = await lirePhotosEcrans(page);
    ok(montage.pax === '4 joueurs' && montage.saisie === '4', '[A] le groupe demarre a 4 joueurs, le nombre est dans le champ', `${montage.pax} / « ${montage.saisie} »`);
    const dernierMot = String(montage.mots[montage.mots.length - 1] || '').trim();
    const titrePonctue = /[?!]$/.test(dernierMot);
    ok(montage.mots.length >= 2
      && !montage.mots.some((m) => /^[?!]$/.test(m.trim()))
      && (!titrePonctue || /\u00a0[?!]$/.test(dernierMot)),
      '[A] le titre est decoupe mot a mot, et une ponctuation finale reste collee a son mot (espace insecable)',
      `${JSON.stringify(montage.mots)}${titrePonctue ? '' : ' (titre affirmatif : aucune ponctuation a coller)'}`);
    // LES CINQ TITRES NE SE RESSEMBLENT PAS (Movsar, 2026-09-23 : « trop
    // similaires, faut un truc plus percutant ») : chacun ouvre sur un mot
    // different, et aucune ponctuation finale ne part seule sur sa ligne.
    const titres = await page.evaluate(() => Array.from(document.querySelectorAll('.fg-scene:not([data-scene="fin"]) .fg-title')).map((t) => Array.from(t.querySelectorAll('.w > span')).map((x) => x.textContent)));
    const ouvertures = titres.map((mots) => plat(mots[0] || '').toLowerCase());
    ok(titres.length === 5 && new Set(ouvertures).size === 5
      && titres.every((mots) => mots.length >= 2 && !mots.some((x) => /^[?!]$/.test(x.trim())) && mots.every((x) => !/[?!]$/.test(x) || /\u00a0[?!]$/.test(x))),
      '[A] les cinq titres ouvrent chacun sur un mot different, et une ponctuation finale reste collee a son mot', titres.map((mots) => `« ${mots.join(' ')} »`).join(' '));
    ok(await attendre(page, () => getComputedStyle(document.querySelector('.fg-curtain')).visibility === 'hidden', 3000) && montage.halos === 0, '[A] le rideau d ouverture finit invisible (au plus 3 s), aucun halo (plus de degrade decoratif)', JSON.stringify({ halos: montage.halos }));
    const poids = poidsServi();
    ok(poids.nettoyes && poids.octets < BUDGET_SERVI, `[A] JS + CSS + HTML SERVIS (apres le build) sous ${BUDGET_SERVI / 1024} Ko a analyser`, `${Math.round(poids.octets / 102.4) / 10} Ko, ${poids.sortie}`);
    ok(poids.transfere < BUDGET_TRANSFERE, `[A] et sous ${BUDGET_TRANSFERE / 1024} Ko a telecharger (compresses, comme le serveur les envoie)`, `${Math.round(poids.transfere / 102.4) / 10} Ko`);
    ok(!demandes.some((u) => /-1600\.webp/.test(u)), '[A] aucune photo 1600 px demandee sur un ecran de 1440', demandes.filter((u) => /webp/.test(u)).map((u) => u.split('/').pop()).join(', '));
    ok(demandes.filter((u) => /\.webp/.test(u)).length <= 2, '[A] au plus deux photos chargees au depart (l ecran et le suivant)');
    ok(demandes.some((u) => /public-booking-meta\?.*calendar=45/.test(u)), '[A] le catalogue est demande AVEC le calendrier (calendar=45)');

    // =====================================================================
    console.log('');
    console.log('[U] UN GESTE PENDANT UNE TRANSITION N EST PLUS PERDU');
    // =====================================================================
    // Vu en validant la passe du 2026-09-24 : un geste de navigation fait
    // pendant les 0,42 s de l arrivee d un ecran etait jete par aller(). Un
    // client qui se ravisait aussitot touchait dans le vide ; le gate aussi,
    // sur une machine rapide (« retour a l ecran 4 », « #tabAct »). Joue ici,
    // tot : sans le correctif, les sections suivantes peuvent tomber avant.
    const ctxU = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pU = await ctxU.newPage();
    await pU.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    ok(await attendre(pU, () => document.body.classList.contains('is-ready') && document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000), 'MONTAGE [U] le catalogue est lu');
    const gesteU = await pU.evaluate(() => {
      document.querySelector('#goActivities').click();
      const pendant = Boolean(document.querySelector('.fg-scene[data-scene="activites"].is-active.is-entering'));
      document.querySelector('.fg-scene[data-scene="activites"] .fg-dock [data-back]').click();
      return { pendant };
    });
    gesteU.revenu = await attendre(pU, () => document.querySelector('.fg-scene[data-scene="date"].is-active') && !document.querySelector('.fg-scene.is-entering') && document.body.dataset.step === '1', 4000);
    ok(gesteU.pendant && gesteU.revenu, '[U] « Retour » touche pendant l arrivee des activites ramene a l ecran du jour, une fois la transition finie', JSON.stringify(gesteU));
    await ctxU.close();

    // =====================================================================
    console.log('');
    console.log('[A2] CALENDRIER PAR MOIS, JUSQU A L HORIZON ; GROUPE TAPE');
    // =====================================================================
    ok(calendrier.every((j) => JSON.stringify(j) === JSON.stringify(oracleJours[j.date])), '[A2] (oracle) les 45 jours du catalogue et les tranches calendarFrom disent la meme chose', `${Object.keys(oracleJours).length} jours relus`);
    await page.click('#dayBtn');
    ok(await attendre(page, () => !document.querySelector('#dayPop').hidden && document.querySelectorAll('#calGrid .fg-cal__day').length >= 28 && !document.querySelector('#calGrid .fg-cal__day.is-loading'), 5000), '[A2] le calendrier s ouvre sur le mois en cours, charge');
    ok(await page.evaluate(() => document.querySelector('#dayBtn').getAttribute('aria-expanded') === 'true' && document.querySelector('#dayBtn').closest('.fg-field').classList.contains('is-open')), '[A2] le champ se dit ouvert (aria-expanded) et monte au-dessus de ses voisins');
    // Le sens du glissement de chaque mois, releve a la pose de la classe (un
    // observateur, pas une mesure dans le temps : aucun faux rouge si la
    // machine est chargee).
    await page.evaluate(() => { window.__sens = []; const g = document.querySelector('#calGrid'); new MutationObserver(() => { const m = /is-(next|prev)/.exec(g.className); if (m) window.__sens.push(m[0]); }).observe(g, { attributes: true, attributeFilter: ['class'] }); });
    const [ty, tm] = TODAY.split('-').map(Number);
    const [hy, hm] = HORIZON.split('-').map(Number);
    const moisAttendus = (hy - ty) * 12 + (hm - tm) + 1;
    const ecartsCal = [];
    const vus = [];
    let fleches = { prevAuDebut: null, nextALaFin: null };
    for (let k = 0; k < moisAttendus + 2; k += 1) {
      if (!await attendre(page, () => !document.querySelector('#calGrid .fg-cal__day.is-loading'), 8000)) ecartsCal.push(`mois ${k} : chargement jamais fini`);
      const m = await lireMois(page);
      const y = ty + Math.floor((tm - 1 + k) / 12);
      const mo = ((tm - 1 + k) % 12) + 1;
      const titre = `${cap(MOIS[mo - 1])} ${y}`;
      if (m.titre !== titre) ecartsCal.push(`titre ${m.titre} vs ${titre}`);
      const n = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      if (m.jours.length !== n) ecartsCal.push(`${titre}: ${m.jours.length} jours vs ${n}`);
      const decalage = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7;
      if (m.vides !== decalage) ecartsCal.push(`${titre}: ${m.vides} cases vides vs ${decalage} (lundi en tete)`);
      m.jours.forEach((x) => {
        if (x.chargement) { ecartsCal.push(`${x.date} encore en chargement`); return; }
        if (x.date < TODAY) { if (!x.off || !/is-past/.test(x.cls)) ecartsCal.push(`${x.date} passe et cliquable`); return; }
        if (x.date > HORIZON) { if (!x.off) ecartsCal.push(`${x.date} au-dela de l horizon et cliquable`); return; }
        const j = oracleJours[x.date];
        if (!j) { ecartsCal.push(`${x.date} absent de l oracle`); return; }
        if (x.off !== !j.open) ecartsCal.push(`${x.date}: cliquable=${!x.off}, ouvert=${j.open}`);
        const ferie = Boolean(j.holiday && j.holiday.type === 'public');
        const conge = Boolean(j.holiday && j.holiday.type !== 'public');
        if (/is-ferie/.test(x.cls) !== ferie || /is-vacances/.test(x.cls) !== conge || x.point !== Boolean(j.holiday)) ecartsCal.push(`${x.date}: marque « ${x.cls} » point=${x.point} vs ${JSON.stringify(j.holiday)}`);
        if (plat(x.titre) !== plat(titreJour(j))) ecartsCal.push(`${x.date}: « ${x.titre} » vs « ${titreJour(j)} »`);
        if (/is-today/.test(x.cls) !== (x.date === TODAY)) ecartsCal.push(`${x.date}: marque « aujourd hui » fausse`);
      });
      vus.push({ titre: m.titre, jours: m.jours.length });
      if (k === 0) fleches.prevAuDebut = m.prev;
      if (m.next) { fleches.nextALaFin = true; break; }
      await page.click('#calNext');
      await attendre(page, (t) => document.querySelector('#calTitle').textContent.trim() !== t, 3000, m.titre);
    }
    ok(ecartsCal.length === 0, '[A2] CHAQUE jour de CHAQUE mois = le calendrier servi (ferme grise, horaires ou motif, ferie/conge marque, passe et au-dela de l horizon grises)', ecartsCal.slice(0, 4).join(' ; ') || `${vus.length} mois, ${vus.reduce((s, v) => s + v.jours, 0)} jours conformes`);
    ok(await page.evaluate(() => document.activeElement === document.querySelector('#calPrev')), '[A2] au dernier mois, « suivant » s eteint et le focus passe a « precedent » (il ne tombe pas sur la page)', await page.evaluate(() => (document.activeElement || {}).id || String(document.activeElement && document.activeElement.tagName)));
    const sensMois = await page.evaluate(() => window.__sens);
    ok(sensMois.length > 0 && sensMois.every((s) => s === 'is-next'), '[A2] « mois suivant » fait glisser la grille vers la gauche, jamais a l envers', sensMois.join(','));
    ok(fleches.prevAuDebut === true, '[A2] la fleche « precedent » est inactive sur le mois en cours');
    ok(vus.length === moisAttendus && fleches.nextALaFin === true && vus[vus.length - 1].titre === `${cap(MOIS[hm - 1])} ${hy}`, '[A2] la fleche « suivant » mene jusqu a l horizon de reservation, pas plus loin', `${vus.length} mois de ${vus[0] && vus[0].titre} a ${vus[vus.length - 1] && vus[vus.length - 1].titre}`);
    const tranches = reponsesMeta.filter((r) => /calendarFrom=/.test(r.url));
    const moisCharges = new Set(tranches.map((r) => new URL(r.url).searchParams.get('calendarFrom').slice(0, 7)));
    const moisAuDela = [];
    for (let k = 0; k < moisAttendus; k += 1) {
      const y = ty + Math.floor((tm - 1 + k) / 12); const mo = ((tm - 1 + k) % 12) + 1;
      const cle = `${y}-${String(mo).padStart(2, '0')}`;
      const dernier = `${cle}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`;
      if (dernier > plusJours(TODAY, 44)) moisAuDela.push(cle);
    }
    const moisDemandes = tranches.map((r) => new URL(r.url).searchParams.get('calendarFrom').slice(0, 7));
    ok(tranches.length > 0 && tranches.every((r) => r.status === 200) && moisDemandes.every((c) => moisAuDela.indexOf(c) >= 0) && new Set(moisDemandes).size === moisDemandes.length, '[A2] les mois au-dela des 45 premiers jours se chargent a la demande (calendarFrom), jamais deux fois le meme, tous en 200', `${tranches.length} demandes (${[...moisCharges].join(', ')}) pour ${moisAuDela.length} mois au-dela`);
    const annee = Object.values(oracleJours).filter((j) => j.date >= TODAY && j.date <= HORIZON);
    ok(annee.some((j) => j.holiday && j.holiday.type === 'public') && annee.some((j) => j.holiday && j.holiday.type !== 'public') && annee.some((j) => !j.open), '[A2] (la propriete est exercee) l annee contient des feries, des conges scolaires et des jours fermes');
    // LE CLAVIER : Echap ferme ; a la reouverture, le jour choisi porte le focus,
    // la fleche droite passe au jour OUVERT suivant, Entree le choisit.
    await page.keyboard.press('Escape');
    ok(await attendre(page, () => document.querySelector('#dayPop').hidden && document.activeElement === document.querySelector('#dayBtn'), 2000), '[A2] Echap referme le calendrier et rend le focus au champ');
    const sensAvantReouverture = await page.evaluate(() => window.__sens.length);
    await page.click('#dayBtn');
    await attendre(page, () => !document.querySelector('#dayPop').hidden && !document.querySelector('#calGrid .fg-cal__day.is-loading'), 5000);
    // Rouvert sur le mois du jour choisi, loin du dernier mois vu : la grille
    // ne glisse pas (aucune classe posee, relevee par l observateur).
    const reouverture = await page.evaluate((n) => ({ poses: window.__sens.slice(n), classe: document.querySelector('#calGrid').className }), sensAvantReouverture);
    ok(reouverture.poses.length === 0 && !/is-(next|prev)/.test(reouverture.classe), '[A2] a la reouverture, la grille ne rejoue pas le glissement du mois', JSON.stringify(reouverture));
    const choisi0 = premierOuvert.date;
    ok(await page.evaluate((d) => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.date === d, choisi0), '[A2] a la reouverture, le jour choisi porte le focus', choisi0);
    const suivant = Object.keys(oracleJours).sort().find((d) => d > choisi0 && d <= HORIZON && oracleJours[d].open);
    await page.keyboard.press('ArrowRight');
    ok(await attendre(page, (d) => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.date === d, 3000, suivant), '[A2] la fleche droite passe au jour OUVERT suivant (les fermes sont sautes)', suivant);
    await page.keyboard.press('Enter');
    ok(await attendre(page, (l) => document.querySelector('#dayPop').hidden && document.querySelector('#dayLabel').textContent.trim() === l, 3000, jourLong(suivant)), '[A2] Entree choisit ce jour et referme le calendrier', jourLong(suivant));
    // UN LUNDI DE CONGE SCOLAIRE : ouvert, avec l horaire de vacances et sa periode.
    const lundiConge = annee.find((d) => deIso(d.date).getUTCDay() === 1 && d.open && d.holiday && d.holiday.type !== 'public');
    if (lundiConge) {
      await page.click('#dayBtn');
      ok(await allerAuMois(page, lundiConge.date), '[A2] le mois du lundi de conge s affiche', lundiConge.date);
      await page.click(`#calGrid .fg-cal__day[data-date="${lundiConge.date}"]`);
      const indice = await page.evaluate(() => document.querySelector('#dayHint').textContent.replace(/\s+/g, ' ').trim());
      ok(plat(indice) === plat(`${lundiConge.date === TODAY ? 'Aujourd’hui · ' : lundiConge.date === plusJours(TODAY, 1) ? 'Demain · ' : ''}Ouvert ${horaire(lundiConge.schedule)} · ${lundiConge.holiday.label}`), '[A2] un LUNDI de conge scolaire est ouvert ; sous le champ, l horaire et la periode du jour', `${lundiConge.date} « ${indice} »`);
    } else {
      ok(false, '[A2] un lundi de conge scolaire existe dans l annee (sinon la propriete n est pas exercee)');
    }
    // Le samedi du mock : le jour que l oracle des heures interroge plus bas.
    await page.click('#dayBtn');
    ok(await allerAuMois(page, mock.DATE), '[A2] retour au mois du samedi du mock', mock.DATE);
    await page.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
    ok(await attendre(page, (l) => document.querySelector('#dayPop').hidden && document.querySelector('#dayLabel').textContent.trim() === l, 3000, jourLong(mock.DATE)), '[A2] le samedi du mock est retenu et le calendrier se referme', jourLong(mock.DATE));
    // LE GROUPE SE TAPE.
    await page.fill('#paxInput', '999');
    await page.press('#paxInput', 'Enter');
    ok(await attendre(page, () => document.querySelector('#paxInput').value === '240' && document.querySelector('#paxOut').textContent.trim() === '240 joueurs' && document.querySelector('#paxPlus').disabled, 3000), '[A2] un nombre tape au-dela de 240 est ramene a 240, le « + » se desactive');
    const plafond = await page.evaluate(() => { const h = document.querySelector('#paxHint'); const a = h.querySelector('a[href^="tel:"]'); return { texte: h.textContent.replace(/\s+/g, ' ').trim(), tel: a ? a.getAttribute('href') : '', live: h.getAttribute('aria-live'), vu: getComputedStyle(h).display !== 'none', encart: !document.getElementById('smSeuil').hidden, alerte: h.classList.contains('is-warn') }; });
    // LA DONNEE DU CENTRE DECIDE (2026-09-28). Avec un seuil de demande sur
    // mesure (Libramont : 31), 240 personnes passent par la demande : l encart
    // le dit et la phrase du plafond y renvoie. Sans seuil, « En ligne, 240
    // personnes au maximum » et le numero du centre (verifie par
    // sur-mesure-check, sur un catalogue sans seuil).
    const seuilServi = await page.evaluate(async () => { const j = await (await fetch('/api/public-booking-meta?centerId=libramont')).json(); return j.center && j.center.customRequest ? j.center.customRequest.fromPax : null; });
    if (seuilServi && seuilServi <= 240) {
      ok(plafond.vu && plafond.live === 'polite' && plafond.encart && !plafond.alerte && plat(plafond.texte) === plat('Plus de 240 ? Vous préciserez le nombre exact dans la demande.'),
        `[A2] au plafond, un centre qui prepare les groupes des ${seuilServi} : l encart de la demande, et sous le compteur « Plus de 240 ? » renvoie a la demande`, `« ${plafond.texte} » encart=${plafond.encart}`);
    } else {
      ok(plafond.vu && plafond.live === 'polite' && plat(plafond.texte).startsWith('Grand groupe') && plat(plafond.texte).includes('En ligne, 240 personnes au maximum.') && /^tel:\+?\d{8,}$/.test(plafond.tel),
        '[A2] au plafond, sous le compteur : le grand groupe reste dit, puis « En ligne, 240 personnes au maximum. » et le numero du centre a toucher', `« ${plafond.texte} » ${plafond.tel}`);
    }
    await page.fill('#paxInput', '6');
    await page.press('#paxInput', 'Enter');
    ok(await attendre(page, () => document.querySelector('#paxInput').value === '6' && document.querySelector('#paxOut').textContent.trim() === '6 joueurs', 3000), '[A2] taper 6 donne 6 joueurs');
    ok(await attendre(page, () => { const h = document.querySelector('#paxHint'); return !/240/.test(h.textContent) && !h.classList.contains('is-warn'); }, 3000), '[A2] redescendu a 6, la phrase du plafond s efface');
    await page.click('#paxMinus');
    ok(await attendre(page, () => document.querySelector('#paxInput').value === '5' && document.querySelector('#paxOut').textContent.trim() === '5 joueurs', 3000), '[A2] le « - » suit le nombre tape : 5');
    await page.click('#paxPlus');
    ok(await attendre(page, () => document.querySelector('#paxInput').value === '6' && document.querySelector('#paxOut').textContent.trim() === '6 joueurs', 3000), '[A2] le « + » aussi : 6 joueurs');

    // =====================================================================
    console.log('');
    console.log('[A3] EMPILEMENT DU CALENDRIER, LIBELLES DES ETAPES (colonne etroite)');
    // =====================================================================
    const etroit = await browser.newContext({ viewport: { width: 1000, height: 900 } });
    const pageEtroite = await etroit.newPage();
    await pageEtroite.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    ok(await attendre(pageEtroite, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour' && !document.querySelector('.fg-scene.is-entering'), 15000), '[A3] page chargee a 1000 px');
    await dormir(900);
    const colonne = await pageEtroite.evaluate(() => {
      const day = document.querySelector('#dayBtn').getBoundingClientRect();
      const pax = document.querySelector('#paxValue').getBoundingClientRect();
      const lbls = Array.from(document.querySelectorAll('.fg-scene.is-active .fg-steps__item')).map((li) => ({ active: li.classList.contains('is-active'), visible: getComputedStyle(li.querySelector('.lbl')).display !== 'none' }));
      return { empiles: pax.top > day.bottom, ecart: Math.round(pax.top - day.bottom), largeurSteps: Math.round(document.querySelector('.fg-scene.is-active .fg-steps').getBoundingClientRect().width), lbls };
    });
    ok(colonne.empiles, '[A3] a 1000 px, le compteur est SOUS le champ du jour (la configuration du defaut)', JSON.stringify({ ecart: colonne.ecart, largeurSteps: colonne.largeurSteps }));
    ok(colonne.largeurSteps <= 500 && colonne.lbls.filter((l) => l.active).every((l) => l.visible) && colonne.lbls.filter((l) => !l.active).every((l) => !l.visible), '[A3] fil des etapes sous 500 px : seul le libelle de l etape en cours reste', JSON.stringify(colonne.lbls));
    await pageEtroite.click('#dayBtn');
    ok(await attendre(pageEtroite, () => !document.querySelector('#dayPop').hidden, 2000), '[A3] le calendrier s ouvre');
    await dormir(400);
    const dessus = await pageEtroite.evaluate(() => {
      const pop = document.querySelector('#dayPop').getBoundingClientRect();
      const au = (r) => {
        const x = (Math.max(r.left, pop.left) + Math.min(r.right, pop.right)) / 2;
        const y = (Math.max(r.top, pop.top) + Math.min(r.bottom, pop.bottom)) / 2;
        if (Math.max(r.left, pop.left) >= Math.min(r.right, pop.right) || Math.max(r.top, pop.top) >= Math.min(r.bottom, pop.bottom)) return 'pas de recouvrement';
        const el = document.elementFromPoint(x, y);
        return el ? (el.closest('#dayPop') ? 'calendrier' : (el.id || el.className || el.tagName)) : 'rien';
      };
      return { surPax: au(document.querySelector('#paxValue').getBoundingClientRect()), surBouton: au(document.querySelector('#goActivities').getBoundingClientRect()) };
    });
    ok(dessus.surPax === 'calendrier' && (dessus.surBouton === 'calendrier' || dessus.surBouton === 'pas de recouvrement'), '[A3] le calendrier ouvert est DEVANT le compteur et le bouton', JSON.stringify(dessus));
    // Le clavier qui sort du calendrier le referme : ouvert, il couvrait le
    // compteur, et le focus y tombait sous lui.
    ok(await pageEtroite.evaluate(() => Boolean(document.activeElement && document.activeElement.closest('#dayPop'))), 'MONTAGE [A3] a l ouverture, le focus est dans le calendrier');
    await pageEtroite.keyboard.press('Tab');
    await dormir(300);
    const sortie = await pageEtroite.evaluate(() => { const f = document.activeElement; const r = f.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); const cs = getComputedStyle(f); return { ferme: document.querySelector('#dayPop').hidden, focus: f.id, touche: Boolean(el) && (el === f || f.contains(el)), anneau: cs.outlineStyle === 'solid' && cs.outlineOffset === '-4px' }; });
    ok(sortie.ferme && sortie.focus === 'paxMinus' && sortie.touche, '[A3] Tab depuis le calendrier le referme : le focus arrive sur le « - », devant', JSON.stringify(sortie));
    ok(sortie.anneau, '[A3] et l anneau du « - » est entier, dedans (le compteur coupait celui du dehors)', JSON.stringify(sortie));
    // Rouvert seulement s il est ferme : sous la contre-preuve sortieclavier,
    // Tab l a laisse ouvert, un clic le refermerait et Maj+Tab passerait par
    // hasard.
    if (await pageEtroite.evaluate(() => document.querySelector('#dayPop').hidden)) await pageEtroite.click('#dayBtn');
    ok(await attendre(pageEtroite, () => !document.querySelector('#dayPop').hidden, 2000), 'MONTAGE [A3] le calendrier est ouvert avant Maj+Tab');
    await pageEtroite.focus('#dayBtn');
    await pageEtroite.keyboard.press('Shift+Tab');
    ok(await attendre(pageEtroite, () => document.querySelector('#dayPop').hidden && !document.querySelector('.fg-day').contains(document.activeElement), 2000), '[A3] Maj+Tab depuis le champ du jour, calendrier ouvert, le referme aussi');
    await etroit.close();

    // =====================================================================
    console.log('');
    console.log('[B] ACTIVITES : CARTES ET TIROIRS D OPTIONS');
    // =====================================================================
    await page.click('#goActivities');
    ok(await attendre(page, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 5000), '[B] l ecran des activites est actif, transition finie');
    // PAS DE DEGRADE DECORATIF (Movsar, 2026-09-29 : l encart du grand groupe
    // en degrade « fait trop IA »). La regle : un degrade n existe que comme
    // voile d une photo, sur le ::before ou le ::after d un hote qui porte son
    // <img> (le texte pose dessus reste lisible). Un motif (repeating-, les
    // hachures du groupe suivant) n est pas un degrade. Lue sur les REGLES de
    // la feuille, pas sur les seuls elements a l ecran : une piste, un
    // squelette ou un encart pas encore affiches sont couverts aussi.
    const degrades = await page.evaluate(() => {
      const lire = (feuilles) => {
        const fautes = [], voiles = [];
        const parcourir = (liste) => Array.from(liste).forEach((r) => {
          if (r.cssRules && !r.style) { parcourir(r.cssRules); return; }
          if (!r.style || !r.selectorText) return;
          if (!/(^|[^-])(linear|radial|conic)-gradient\(/.test(r.style.getPropertyValue('background-image') || '')) return;
          r.selectorText.split(',').map((s) => s.trim()).forEach((sel) => {
            const m = /^(.*[^:])::?(before|after)$/.exec(sel);
            const hotes = m ? Array.from(document.querySelectorAll(m[1])) : [];
            if (m && hotes.length && hotes.every((h) => h.querySelector('img'))) voiles.push(sel); else fautes.push(sel);
          });
        });
        feuilles.forEach((f) => { try { parcourir(f.cssRules); } catch (e) { fautes.push(`feuille illisible ${f.href || ''}`); } });
        return { fautes, voiles };
      };
      const feuilles = Array.from(document.styleSheets).filter((f) => /\/assets\/fungalaxy-booking\.css/.test(f.href || ''));
      const essai = new CSSStyleSheet();
      essai.replaceSync('.fg-btn { background-image: linear-gradient(red, blue); } .fg-art::after { background: linear-gradient(90deg, #000, transparent); } .fg-chip { background: repeating-linear-gradient(135deg, red 0 6px, blue 6px 12px); } .fg-sm-seuil::before { background: linear-gradient(red, blue); }');
      return { feuilles: feuilles.length, ...lire(feuilles), preuve: lire([essai]) };
    });
    ok(degrades.preuve.fautes.join(' ') === '.fg-btn .fg-sm-seuil::before' && degrades.preuve.voiles.join(' ') === '.fg-art::after',
      '[B] contre-preuve : le lecteur refuse un degrade sur un bouton et sur un ::before sans photo, laisse passer le voile d une photo et un motif hachure', JSON.stringify(degrades.preuve));
    ok(degrades.feuilles === 1 && degrades.voiles.length >= 5 && degrades.fautes.length === 0,
      '[B] aucun degrade decoratif : chaque degrade de la feuille est le voile d une photo', JSON.stringify({ feuilles: degrades.feuilles, voiles: degrades.voiles.length, fautes: degrades.fautes }));
    const fil = await page.evaluate(() => ({ largeur: Math.round(document.querySelector('.fg-scene.is-active .fg-steps').getBoundingClientRect().width), visibles: Array.from(document.querySelectorAll('.fg-scene.is-active .fg-steps__item .lbl')).filter((l) => getComputedStyle(l).display !== 'none').length }));
    ok(fil.largeur > 500 && fil.visibles === 5, '[B] sur une scene pleine largeur a 1440 px, le fil est large et ses cinq libelles sont visibles', JSON.stringify(fil));
    const lireCartes = () => page.evaluate(() => Array.from(document.querySelectorAll('#gridAct li.fg-grid__item')).map((li) => {
      const c = li.querySelector('.fg-card');
      const tiroir = li.querySelector('.fg-card__optin');
      return {
        id: li.dataset.activity,
        prix: c.querySelector('.fg-card__price').textContent.trim(),
        off: c.classList.contains('is-off') && c.getAttribute('aria-disabled') === 'true',
        pastilles: Array.from(li.querySelectorAll('.fg-pill')).map((p) => ({ valeur: p.dataset.valeur, label: p.querySelector('b').textContent.trim(), prix: p.querySelector('small').textContent.trim(), on: p.getAttribute('aria-checked') === 'true' })),
        tiroir: tiroir ? Math.round(tiroir.getBoundingClientRect().height) : null,
        titre: li.querySelector('.fg-card__optlabel') ? li.querySelector('.fg-card__optlabel').textContent.trim() : '',
      };
    }));
    const cartes = await lireCartes();
    ok(cartes.length === mock.ACTIVITIES.length, '[B] une carte par activite vendable', `${cartes.length}/${mock.ACTIVITIES.length}`);
    const minPiste = Math.min(...meta.durationOptions.map((o) => Number(o.price)));
    const minLaser = Math.min(...meta.laserOptions.map((o) => Number(o.price)));
    const minFunRun = Math.min(...meta.funRunOptions.map((o) => Number(o.price)));
    ok(minPiste === Math.min(...Object.values(meta.bowlingPrices).map(Number)), '[B] la grille des durees et la grille des prix piste disent le meme minimum');
    const carte = (id, liste) => (liste || cartes).find((c) => c.id === id) || {};
    ok(carte('bowling').prix === `Dès ${euros(minPiste)} / piste`, '[B] bowling : « des » = minimum de la grille servie', carte('bowling').prix);
    // Le minimum de joueurs voyage a cote du prix (catalogue : minPax 2), comme
    // la capacite d une session du Fun Run.
    ok(carte('laser_game').prix === `Dès ${euros(minLaser)} / personne · 2\u00a0joueurs minimum`, '[B] laser : « des » = minimum des parties servies, et le minimum de joueurs', carte('laser_game').prix);
    ok(carte('fun_run').prix === `Dès ${euros(minFunRun)} / session · 5 joueurs par session`, '[B] fun run : « des » = minimum des sessions servies, et la capacite D UNE session', carte('fun_run').prix);
    ok(carte('minigolf_blacklight').prix === 'Dès 10 € / personne · 12 trous', '[B] minigolf : tarif saisi par le centre, avec sa note', carte('minigolf_blacklight').prix);
    ok(carte('arcade_time').prix === 'Prix à l’accueil', '[B] arcades : sans tarif saisi, « Prix à l’accueil », jamais un chiffre (tout se regle sur place : « sur place » ne distinguait rien)', carte('arcade_time').prix);
    // A SIX JOUEURS, LE FUN RUN NE DISPARAIT PLUS : IL TOURNE (demande de
    // Movsar, 2026-09-23). Le catalogue declare une installation de 5 places,
    // pas un maximum de groupe : six personnes font deux passages. Cette
    // ligne disait l inverse jusqu au 2026-09-23 ; la regle a change, pas le
    // gate qui la lisait. Le detail est prouve par funrun-rotation-check.
    ok(carte('fun_run').off === false && carte('bowling').off === false, '[B] a 6 joueurs, le Fun Run reste choisissable (il tourne en 2 sessions), le bowling aussi');
    const grille = (liste, cle) => liste.map((o) => `${o.label}=${euros(o.price)}`).join(' | ');
    const pastillesDe = (c) => c.pastilles.map((p) => `${p.label}=${p.prix}`).join(' | ');
    ok(pastillesDe(carte('bowling')) === grille(meta.durationOptions) && pastillesDe(carte('laser_game')) === grille(meta.laserOptions) && pastillesDe(carte('fun_run')) === grille(meta.funRunOptions) && carte('minigolf_blacklight').pastilles.length === 0,
      '[B] chaque tiroir porte TOUTES les options de la grille servie avec leur prix ; rien pour un tarif simple', pastillesDe(carte('laser_game')));
    ok(carte('bowling').titre === 'Durée de piste' && carte('laser_game').titre === 'Parties', '[B] chaque tiroir dit ce qu on choisit (duree, parties)', `${carte('bowling').titre} / ${carte('laser_game').titre}`);
    ok(cartes.every((c) => c.tiroir === null || c.tiroir === 0), '[B] les tiroirs restent fermes tant que la carte n est pas cochee', cartes.map((c) => `${c.id}:${c.tiroir}`).join(' '));
    ok(await page.evaluate(() => document.querySelector('#goHours').disabled), '[B] sans selection, « Continuer » est inactif');
    const hauteurAvant = await page.evaluate(() => Math.round(document.querySelector('#gridAct .fg-card[data-activity="bowling"]').getBoundingClientRect().height));
    for (const id of ['bowling', 'laser_game', 'minigolf_blacklight', 'arcade_time']) await page.click(`#gridAct .fg-card[data-activity="${id}"]`);
    ok(await attendre(page, () => document.querySelector('#actCount').textContent.replace(/\s+/g, ' ').trim() === '4 activités sélectionnées', 3000), '[B] le compteur dit « 4 activites selectionnees »');
    ok(await attendre(page, () => ['bowling', 'laser_game'].every((id) => { const t = document.querySelector(`#gridAct li[data-activity="${id}"] .fg-card__optin`); return t.getBoundingClientRect().height > 40 && getComputedStyle(t).opacity === '1'; }), 3000), '[B] cochees, les cartes bowling et laser ouvrent leur tiroir');
    // Le Fun Run n est pas coche : sa pastille retenue (tabindex 0) vit dans
    // un tiroir ferme, qui doit sortir du parcours clavier.
    const tab = await page.evaluate(() => ['bowling', 'fun_run'].map((id) => { const p = document.querySelector(`#gridAct li[data-activity="${id}"] .fg-pill[tabindex="0"]`); return p ? getComputedStyle(p).visibility : 'absent'; }));
    ok(tab[0] === 'visible' && tab[1] === 'hidden', '[B] un tiroir ferme sort du parcours clavier, un tiroir ouvert y est', tab.join(' / '));
    const uneHeure = meta.durationOptions.find((o) => Number(o.value) === 1);
    let apres = await lireCartes();
    ok((carte('bowling', apres).pastilles.find((p) => p.on) || {}).valeur === '1' && carte('bowling', apres).prix === `${euros(uneHeure.price)} / piste`, '[B] bowling : « 1 heure » retenue d office, la carte dit son prix exact', `${carte('bowling', apres).prix}`);
    const geometrie = await page.evaluate(() => {
      const li = document.querySelector('#gridAct li[data-activity="bowling"]');
      const c = li.querySelector('.fg-card').getBoundingClientRect();
      const t = li.querySelector('.fg-card__optbox').getBoundingClientRect();
      const parRangee = {};
      document.querySelectorAll('#gridAct .fg-card').forEach((x) => { const r = x.getBoundingClientRect(); const k = Math.round(r.top); (parRangee[k] = parRangee[k] || []).push(Math.round(r.height)); });
      return { colle: Math.abs(t.top - c.bottom), parRangee, hauteur: Math.round(c.height) };
    });
    ok(geometrie.colle <= 2, '[B] le tiroir s ouvre juste SOUS la carte', `${Math.round(geometrie.colle)} px`);
    ok(Object.values(geometrie.parRangee).every((h) => Math.max(...h) - Math.min(...h) <= 1) && Math.abs(geometrie.hauteur - hauteurAvant) <= 1, '[B] un tiroir ouvert n etire aucune carte : chaque rangee garde des cartes de meme hauteur', JSON.stringify(geometrie.parRangee));
    const deuxParties = meta.laserOptions.find((o) => Number(o.games) === 2);
    const troisParties = meta.laserOptions.find((o) => Number(o.games) === 3);
    await page.click('#gridAct li[data-activity="laser_game"] .fg-pill[data-valeur="2"]');
    const participantsLaser = Number(await page.locator('#gridAct li[data-activity="laser_game"] [data-compteur="participants"] input').inputValue());
    const prixLaserSelection = option => `${euros(Number(option.price) * participantsLaser)} · ${participantsLaser}\u00a0joueurs · 2\u00a0joueurs minimum`;
    ok(await attendre(page, (attendu) => document.querySelector('#gridAct li[data-activity="laser_game"] .fg-card__price').textContent.trim() === attendu && document.querySelector('#gridAct li[data-activity="laser_game"] .fg-pill[data-valeur="2"]').getAttribute('aria-checked') === 'true', 3000, prixLaserSelection(deuxParties)), '[B] toucher « 2 parties » la retient et met son prix sur la carte', prixLaserSelection(deuxParties));
    await page.keyboard.press('ArrowRight');
    ok(await attendre(page, (attendu) => { const p = document.querySelector('#gridAct li[data-activity="laser_game"] .fg-pill[data-valeur="3"]'); return p.getAttribute('aria-checked') === 'true' && document.activeElement === p && document.querySelector('#gridAct li[data-activity="laser_game"] .fg-card__price').textContent.trim() === attendu; }, 3000, prixLaserSelection(troisParties)), '[B] au clavier, la fleche droite passe a « 3 parties » (focus et prix suivent)');
    await page.keyboard.press('ArrowLeft');
    ok(await attendre(page, (attendu) => document.querySelector('#gridAct li[data-activity="laser_game"] .fg-pill[data-valeur="2"]').getAttribute('aria-checked') === 'true' && document.querySelector('#gridAct li[data-activity="laser_game"] .fg-card__price').textContent.trim() === attendu, 3000, prixLaserSelection(deuxParties)), '[B] la fleche gauche revient a « 2 parties »');
    ok(await page.evaluate(() => document.querySelectorAll('#gridAct .fg-card.is-on[aria-checked="true"]').length === 4 && !document.querySelector('#goHours').disabled), '[B] quatre cartes cochees, « Continuer » actif');

    // =====================================================================
    console.log('');
    console.log('[C] HEURES : PISTES, MENUS, ETATS, PLAN ADAPTE');
    // =====================================================================
    const avantHeures = demandes.length;
    await page.click('#goHours');
    ok(await attendre(page, () => document.querySelector('.fg-scene[data-scene="heures"].is-active'), 5000), '[C] l ecran des heures est actif');
    ok(await attendre(page, () => document.querySelectorAll('#hourZone .fg-track .fg-chip').length > 0 && document.querySelector('#planZone .fg-visit') && !document.querySelector('#hourZone').classList.contains('is-busy'), 25000), '[C] les pistes et le bloc « votre visite » sont rendus');
    const demandeHeures = demandes.slice(avantHeures).find((u) => u.indexOf('/api/public-availability?') >= 0) || '';
    const pd = demandeHeures ? new URL(demandeHeures).searchParams : new URLSearchParams();
    let programmeEnvoye = null;
    try { programmeEnvoye = JSON.parse(pd.get('program') || 'null'); } catch (error) { programmeEnvoye = null; }
    ok(JSON.stringify(programmeEnvoye) === JSON.stringify(PROGRAMME) && pd.get('softReserve') === '1' && pd.get('pax') === '6' && pd.get('date') === mock.DATE, '[C] la demande porte le programme choisi (2 parties de laser comprises), le groupe, le jour et le mode souple', `${JSON.stringify(programmeEnvoye)} softReserve=${pd.get('softReserve')}`);
    const sousTitre = await page.evaluate(() => document.querySelector('#hourSub').textContent.replace(/\s+/g, ' ').trim());
    const jourMock = oracleJours[mock.DATE];
    ok(/6 personnes · Bowling \+ Laser Game \+ Minigolf Blacklight \+ Arcades/.test(sousTitre) && (!jourMock || plat(sousTitre).indexOf(plat(`Ouvert ${horaire(jourMock.schedule)}`)) >= 0), '[C] le sous-titre reprend groupe, activites et horaire du jour', sousTitre);
    ok(await page.evaluate(() => { const l = document.querySelector('.fg-legend'); return Boolean(l) && /Serré/.test(l.textContent) && /Décale/.test(l.textContent) && /Complet/.test(l.textContent); }), '[C] une legende dit ce que veulent « serre », « decale » et « complet »');
    const base = { centerId: 'libramont', date: mock.DATE, type: 'visite', pax: '6', program: JSON.stringify(PROGRAMME), softReserve: '1' };
    const route = async (extra) => {
      const q = new URLSearchParams(base);
      Object.entries(extra || {}).forEach(([k, v]) => q.set(k, typeof v === 'string' ? v : JSON.stringify(v)));
      return lireJson(`${BASE_URL}/api/public-availability?${q}`);
    };
    const ancresDe = (d) => (d.anchors && d.anchors.activities) || [];
    const verifierPistes = async (d, pins, laserParts, label, pg = page) => {
      const pistes = await lirePistes(pg);
      const defauts = (d.anchors && d.anchors.defaultTimes) || {};
      const e = [];
      if (pistes.map((p) => p.id).join(',') !== ancresDe(d).map((a) => a.activityId).join(',')) e.push(`pistes ${pistes.map((p) => p.id).join(',')} vs ${ancresDe(d).map((a) => a.activityId).join(',')}`);
      ancresDe(d).forEach((a) => {
        const actifs = a.activityId === 'laser_game' && laserParts.length ? laserParts : (pins[a.activityId] ? [pins[a.activityId]] : []);
        const propose = actifs.length ? '' : (defauts[a.activityId] || '');
        e.push(...ecartsPiste(pistes.find((p) => p.id === a.activityId), a, actifs, propose, d, laserParts));
        const p = pistes.find((x) => x.id === a.activityId);
        if (p && p.reset !== actifs.length > 0) e.push(`${a.activityId}: « laisser l equipe placer » ${p.reset ? 'visible' : 'cache'} avec ${actifs.length} heure(s) posee(s)`);
        if (p && !p.touchee) e.push(...ecartsMenus(p, a, actifs, propose));
      });
      ok(e.length === 0, label, e.slice(0, 4).join(' ; ') || ancresDe(d).map((a) => `${a.activityId} ${a.times.length} h`).join(', '));
      return pistes;
    };
    // Combien de plans verifies laissaient une partie a l equipe (l etape
    // « sur place ») : la propriete doit etre exercee sur un vrai plan.
    let vuSurPlace = 0;
    const verifierPlan = async (d, label) => {
      const ecran = await lireEcranPlan(page);
      const o = lignePlan(d);
      const e = ecartsPlan(ecran, o);
      ok(e.length === 0 && ecran && ecran.garder, label, e.slice(0, 3).join(' ; ') || `${o && o.blocs.map((b) => `${b.id}@${b.t}`).join(', ')}, fin ${o && o.fin}${o && o.fermeture ? ' (fermeture, manque ' + o.manque + ' min)' : ''}`);
      // LA VOIX DIT LA MEME VISITE que le bloc : l arrivee, chaque activite a
      // son heure, la fin, le prix, ce qui se regle sur place, ce qui manque.
      // Elle est videe dans la meme tache que le retrait du voile : ce qu on lit
      // ici est la phrase de CETTE reponse.
      if (o) {
        await attendre(page, () => ((document.querySelector('#fgLive') || {}).textContent || '').indexOf('Votre visite') === 0, 5000);
        // Les durees « environ 30 min » sont insecables a l ecran : la voix
        // se compare espaces ordinaires.
        const voix = (await page.evaluate(() => document.querySelector('#fgLive').textContent)).replace(/\u00a0/g, ' ');
        const va = visiteAttendue(o);
        if (va.surPlace.length) vuSurPlace += 1;
        const absents = [o.arrivee, ...va.etapes.map((x) => x.voix), ...va.surPlace.map((x) => x.voix), o.fin ? (o.fermeture ? 'Jusqu’à la fermeture à ' : 'Fin vers ') + heureAffichee(o.fin) : '', o.prix > 0 ? euros(o.prix) : '', o.fermeture && o.manque > 0 ? phraseManqueQa(o) : ''].filter((x) => x && voix.indexOf(x) < 0);
        ok(absents.length === 0 && (voix.indexOf(`, plus ${sansPrixQa(o)}, prix à l’accueil`) >= 0) === (o.prix > 0 && !o.complet), `${label} : la voix (#fgLive) dit la meme visite`, absents.join(' | ') || voix);
      }
      return { ecran, o };
    };
    // 0. SANS HEURE POSEE : les pistes et le plan du serveur.
    const d0 = await route();
    let pistes = await verifierPistes(d0, {}, [], '[C] SANS POSE : une piste par activite, TOUTES les heures dans l etat du moteur (raison, mot, titre), rangees en menus matin/apres-midi/soiree, le menu de l heure proposee ouvert');
    ok(ancresDe(d0).some((a) => a.times.some((t) => t.ok === false && t.code !== 'anchor_overlap')), '[C] (la propriete est exercee) une heure impossible existe ce jour-la');
    await verifierPlan(d0, '[C] SANS POSE : « votre visite » = la reponse (arrivee et son avance, chaque partie a son heure, minigolf et arcades en libre, fin, prix et son detail, paiement) et « Garder » est actif');
    // LE PRIX SE LIT PAREIL EN TETE ET AU TOTAL (capture de prod du lot visite) :
    // en chiffres proportionnels, l espace fine des milliers disparaissait
    // (« 1273 € » en tete, « 1 273 € » au total).
    const chiffres0 = await page.evaluate(() => {
      const v = document.querySelector('#planZone .fg-visit');
      const a = v && v.querySelector('.fg-visit__price');
      const b = v && v.querySelector('.fg-visit__total dd');
      return { entete: a ? getComputedStyle(a).fontVariantNumeric : '', total: b ? getComputedStyle(b).fontVariantNumeric : '' };
    });
    ok(/tabular-nums/.test(chiffres0.entete) && chiffres0.entete === chiffres0.total,
      '[C] le prix d en-tete et le total se lisent pareil, en chiffres tabulaires (« 1 273 € », jamais « 1273 € »)', JSON.stringify(chiffres0));
    const o0 = lignePlan(d0);
    const va0 = o0 ? visiteAttendue(o0) : null;
    ok(Boolean(va0 && va0.prix), 'MONTAGE [C] sans pose, la somme des montants connus EST le prix : le detail du prix est exerce sur un vrai plan', va0 ? `${va0.connus} connus pour ${o0.prix}` : 'aucun plan');
    // LES MENUS REPLIES SORTENT DU PARCOURS CLAVIER : plus d arret sur une
    // heure invisible (le repli dure 0,4 s, on le laisse finir).
    await dormir(500);
    const menus = await page.evaluate(() => { const vis = (s) => Array.from(document.querySelectorAll(s)).map((c) => getComputedStyle(c).visibility); return { fermees: vis('#hourZone .fg-period:not(.is-open) .fg-chip'), ouvertes: vis('#hourZone .fg-period.is-open .fg-chip') }; });
    ok(menus.fermees.length > 0 && menus.fermees.every((v) => v === 'hidden') && menus.ouvertes.length > 0 && menus.ouvertes.every((v) => v === 'visible'), '[C] les heures d un menu replie sortent du parcours clavier, celles du menu ouvert y sont', `${menus.fermees.length} repliees, ${menus.ouvertes.length} ouvertes`);
    ok(await page.evaluate(() => !document.querySelector('#hourZone').hasAttribute('aria-live') && document.querySelector('#fgLive').getAttribute('role') === 'status' && !document.querySelector('#fgLive').closest('.fg-scene')), '[C] une seule voix : la zone des heures se tait, #fgLive (hors des scenes) parle');
    ok(await page.evaluate(() => document.querySelector('#keepLabel').textContent.trim() === 'Ces horaires me vont'), '[C] le bouton dit « Ces horaires me vont »');
    const centres = await centrages(page);
    ok(centres.length > 0 && centres.every((c) => c.ecart <= 1), '[C] dans chaque case, l heure (et son mot s il y en a un) est centree verticalement', centres.filter((c) => c.ecart > 1).map((c) => `${c.t} « ${c.mot} » ${c.ecart.toFixed(1)} px`).join(', ') || `${centres.length} cases, ecart max ${Math.max(...centres.map((c) => c.ecart)).toFixed(1)} px`);
    // 1. POSER UNE HEURE DE BOWLING : mise a jour sur place, la piste du laser
    //    se recalcule, son menu suit la nouvelle proposition.
    const bowling0 = ancresDe(d0).find((a) => a.activityId === 'bowling');
    const okBowling = bowling0.times.filter((t) => t.ok !== false && !t.warning).map((t) => t.time);
    const B = okBowling.find((t) => t !== d0.anchors.defaultTimes.bowling && okBowling.indexOf(t) >= 2) || okBowling[okBowling.length - 1];
    const selB = `#hourZone .fg-track[data-activity="bowling"] .fg-chip[data-time="${B}"]`;
    await page.evaluate((s) => { window.__qaCase = document.querySelector(s); window.__qaHaut = window.__qaCase.getBoundingClientRect().top + window.scrollY; }, selB);
    // L ANNEAU ET L ONDE, relevees sans minuterie : un observateur note chaque
    // classe que la case porte, du toucher a la fin de la reponse.
    const observerPose = (s) => page.evaluate((sel) => { const c = document.querySelector(sel); window.__qaPose = { attente: false, onde: false }; new MutationObserver(() => { if (c.classList.contains('is-pending')) window.__qaPose.attente = true; if (c.classList.contains('is-pose')) window.__qaPose.onde = true; }).observe(c, { attributes: true, attributeFilter: ['class'] }); }, s);
    await observerPose(selB);
    ok(await poserEtAttendre(page, 'bowling', B), '[C] poser une heure de bowling recalcule (une demande, puis fin du voile)', B);
    const suivi = await page.evaluate((s) => { const c = document.querySelector(s); return { meme: c === window.__qaCase, on: c.classList.contains('is-on'), transform: getComputedStyle(c).transform, saut: Math.abs(c.getBoundingClientRect().top + window.scrollY - window.__qaHaut), focus: document.activeElement === c }; }, selB);
    ok(suivi.meme && suivi.on && suivi.transform === 'none' && suivi.saut <= 1, '[C] la case posee est LA MEME (mise a jour sur place), sans transformation ni deplacement : aucun tremblement', JSON.stringify(suivi));
    ok(suivi.focus, '[C] la case posee garde le focus (clavier)');
    const poseB = await page.evaluate(() => window.__qaPose);
    ok(poseB.attente && poseB.onde, '[C] la case touchee s entoure des le toucher, puis une onde part d elle quand le plan du serveur la retient', JSON.stringify(poseB));
    const d1 = await route({ preferredTimes: { bowling: B } });
    pistes = await verifierPistes(d1, { bowling: B }, [], '[C] BOWLING POSE : les deux pistes = la route preferredTimes={bowling} (le laser recalcule, son menu suit sa nouvelle proposition)');
    await verifierPlan(d1, '[C] BOWLING POSE : « votre visite » = la route preferredTimes={bowling}');
    const aDecaler = (pistes.find((p) => p.id === 'laser_game') || { chips: [] }).chips.filter((c) => c.etat === 'shift');
    ok(aDecaler.length > 0 && aDecaler.every((c) => c.conflit === 'bowling' && c.mot === 'décale' && c.ok), '[C] les heures du laser qui chevauchent le bowling sont « a decaler », choisissables, avec le bowling en cause', aDecaler.map((c) => `${c.t} « ${c.titre} »`).join(', '));
    // 2. UNE HEURE IMPOSSIBLE S EXPLIQUE DEJA SOUS SA PLAGE : la toucher
    //    eclaire SA ligne, sans rien demander ni rien changer.
    const dure = ancresDe(d1).flatMap((a) => a.times.filter((t) => t.ok === false && t.code !== 'anchor_overlap').map((t) => ({ id: a.activityId, t }))).pop();
    if (dure) {
      const avantDure = demandes.length;
      await toucherHeure(page, dure.id, dure.t.time);
      const lu = await page.evaluate(({ id, h }) => {
        const chip = document.querySelector(`#hourZone .fg-track[data-activity="${id}"] .fg-chip[data-time="${h}"]`);
        const lit = Array.from(document.querySelectorAll('#hourZone .fg-why-list__item.is-lit'));
        const l = lit[0];
        return {
          asked: Array.from(document.querySelectorAll('#hourZone .fg-chip.is-asked')).map((c) => c.dataset.time),
          eclairees: lit.length,
          memePlage: Boolean(l) && l.closest('.fg-period') === chip.closest('.fg-period'),
          heures: l ? String(l.dataset.heures || '').split(' ') : [],
          texte: l ? l.textContent.replace(/\s+/g, ' ').trim() : '',
          visible: Boolean(l) && l.getBoundingClientRect().height > 0,
        };
      }, { id: dure.id, h: dure.t.time });
      const raisonDure = String(dure.t.reason || 'Indisponible').toLowerCase();
      ok(lu.asked.length === 1 && lu.asked[0] === dure.t.time && lu.eclairees === 1 && lu.memePlage && lu.heures.indexOf(dure.t.time) >= 0
        && lu.texte.toLowerCase().indexOf(raisonDure) >= 0 && lu.visible,
        '[C] toucher une heure impossible eclaire SA ligne sous sa plage : l heure y est, la raison du moteur aussi, mot pour mot', `${dure.t.time} « ${lu.texte} »`);
      await dormir(300);
      ok(lecturesNeuves(demandes, avantDure).length === 0 && await page.evaluate((s) => document.querySelector(s).classList.contains('is-on'), selB), '[C] et ne demande rien, ne change rien a l heure posee');
    } else {
      ok(false, '[C] une heure impossible existe apres la pose (sinon la lecture de la raison n est pas exercee)');
    }
    // 3. CHOISIR UNE HEURE « A DECALER » : c est l AUTRE activite qui bouge.
    const L0 = aDecaler.length ? aDecaler[0].t : '';
    ok(Boolean(L0) && await poserEtAttendre(page, 'laser_game', L0), '[C] toucher une heure « a decaler » du laser la pose', L0);
    const d2 = await route({ preferredTimes: { laser_game: L0 }, laserGameTimes: [L0] });
    await verifierPistes(d2, { laser_game: L0 }, [L0], '[C] APRES LE DECALAGE : la pose du bowling est levee, les pistes = la route preferredTimes={laser} + laserGameTimes');
    const v2 = await verifierPlan(d2, '[C] APRES LE DECALAGE : « votre visite » = la route (le bowling replace par le moteur)');
    const deplace = v2.ecran ? v2.ecran.etapes.find((x) => x.bouge) : null;
    ok(Boolean(deplace) && deplace.nom.indexOf(`${nomDe('bowling')} · `) === 0 && deplace.detail.indexOf(`déplacé pour votre ${nomDe('laser_game')} à ${L0}`) >= 0, '[C] le bloc dit que le bowling a ete deplace, pour quoi et a quelle heure', deplace ? `${deplace.t} ${deplace.nom} « ${deplace.detail} »` : 'aucune etape marquee');
    // 4. DEUX PARTIES DE LASER SUR DEUX HEURES.
    const laser2 = ancresDe(d2).find((a) => a.activityId === 'laser_game');
    const candidats = laser2.times.filter((t) => t.ok !== false && !t.warning && t.time > L0).map((t) => t.time);
    const L2 = candidats[Math.min(5, candidats.length - 1)];
    ok(Boolean(L2) && await poserEtAttendre(page, 'laser_game', L2), '[C] deuxieme partie de laser posee', L2);
    const parts = [L0, L2].sort();
    const d3 = await route({ preferredTimes: { laser_game: parts[0] }, laserGameTimes: parts });
    await verifierPistes(d3, { laser_game: parts[0] }, parts, '[C] DEUX PARTIES : deux cases choisies sur la piste du laser, pistes = la route laserGameTimes');
    const v3 = await verifierPlan(d3, '[C] DEUX PARTIES : « votre visite » = la route, avec DEUX blocs de laser');
    ok(v3.o && v3.o.blocs.filter((b) => b.id === 'laser_game').length === 2, '[C] (la route compose bien deux blocs de laser)');
    // 5. LAISSER L EQUIPE PLACER : les poses s effacent, la proposition revient.
    const reponseReset = page.waitForResponse((r) => r.url().indexOf('/api/public-availability?') >= 0, { timeout: 25000 }).catch(() => null);
    await page.click('#hourZone [data-reset="laser_game"]');
    ok(Boolean(await reponseReset) && await attendre(page, () => !document.querySelector('#hourZone').classList.contains('is-busy') && document.querySelector('#planZone .fg-visit'), 25000), '[C] « laisser l equipe placer » recalcule');
    // Le bouton touche se masque (plus rien a rendre) : le focus passe au plus
    // proche, le menu ouvert de la meme piste, jamais a la page.
    ok(await attendre(page, () => document.activeElement === document.querySelector('#hourZone .fg-track[data-activity="laser_game"] .fg-period.is-open .fg-period__btn'), 5000), '[C] apres « revenir a l heure proposee » (bouton masque), le focus passe au menu ouvert de la meme piste, jamais a la page',
      await page.evaluate(() => { const f = document.activeElement; return f === document.body ? 'body' : `${f.tagName.toLowerCase()}.${f.className} « ${f.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)} » piste ${(f.closest('.fg-track') || { dataset: {} }).dataset.activity || 'aucune'}`; }));
    const d4 = await route();
    await verifierPistes(d4, {}, [], '[C] RENDU A L EQUIPE : plus aucune pose, la proposition revient, le menu du laser la suit de nouveau');
    await verifierPlan(d4, '[C] RENDU A L EQUIPE : « votre visite » = la route sans pose');
    // 6. UNE HEURE SERREE SE CHOISIT, ET LE PLAN S ADAPTE.
    const laser4 = ancresDe(d4).find((a) => a.activityId === 'laser_game');
    const LT = laser4.times.filter((t) => t.ok !== false && !t.warning).map((t) => t.time).pop();
    ok(Boolean(LT) && await poserEtAttendre(page, 'laser_game', LT), '[C] une partie de laser posee tard', LT);
    const d5 = await route({ preferredTimes: { laser_game: LT }, laserGameTimes: [LT] });
    pistes = await verifierPistes(d5, { laser_game: LT }, [LT], '[C] LASER TARD : les pistes = la route');
    const serrees = (pistes.find((p) => p.id === 'bowling') || { chips: [] }).chips.filter((c) => c.etat === 'soft');
    ok(serrees.length > 0 && serrees.every((c) => c.ok && c.mot === 'serré' && c.reason.length > 0 && c.titre === c.reason), '[C] les heures de bowling ou tout ne tient plus sont « serrees » : choisissables, avec leur raison', serrees.map((c) => `${c.t} « ${c.reason} »`).join(', '));
    const S = serrees.length ? serrees[serrees.length - 1].t : '';
    ok(Boolean(S) && await poserEtAttendre(page, 'bowling', S), '[C] toucher une heure « serree » la pose', S);
    const d6 = await route({ preferredTimes: { laser_game: LT, bowling: S }, laserGameTimes: [LT] });
    await verifierPistes(d6, { laser_game: LT, bowling: S }, [LT], '[C] HEURE SERREE POSEE : les pistes = la route (la case reste « serree » et « choisie »)');
    const v6 = await verifierPlan(d6, '[C] HEURE SERREE POSEE : « votre visite » = la route : fin a la fermeture, ce qui manque est dit, « Garder » reste actif');
    ok(v6.o && v6.o.fermeture && v6.o.manque > 0, '[C] (la propriete est exercee) la route annonce une fin a la fermeture avec un manque', v6.o ? `fin ${v6.o.fin}, manque ${v6.o.manque} min` : 'aucun plan');
    ok(await page.evaluate((s) => { const c = document.querySelector(s); return c.classList.contains('is-on') && c.classList.contains('is-soft') && c.dataset.ok === 'true'; }, `#hourZone .fg-track[data-activity="bowling"] .fg-chip[data-time="${S}"]`), '[C] la case serree choisie porte les deux marques (choisie, serree)');
    // 7. UN PLAN REFUSE NE SE CELEBRE PAS : la case s entoure et reste choisie,
    //    l ecran dit que ca ne tient pas, aucune onde. La reponse de la route
    //    est relue, puis rendue SANS plan (slots vides), une seule fois. On ne
    //    prend ni une case « decale » ni une case de groupe suivant : la toucher
    //    deplacerait le laser pose a LT.
    const R = await page.evaluate(() => { const c = Array.from(document.querySelectorAll('#hourZone .fg-track[data-activity="bowling"] .fg-chip')).find((x) => !x.classList.contains('is-on') && (x.dataset.state === 'ok' || x.dataset.state === 'soft')); return c ? c.dataset.time : ''; });
    let refusPlan = null;
    if (R) {
      const selR = `#hourZone .fg-track[data-activity="bowling"] .fg-chip[data-time="${R}"]`;
      await observerPose(selR);
      // La reponse refusee est celle de LA POSE (l heure R dans la demande),
      // jamais celle de la relecture des horaires toutes les 15 s, qui part
      // avec les poses d avant et prendrait le refus a sa place.
      const demandeR = (u) => { try { return JSON.parse(u.searchParams.get('preferredTimes') || '{}').bowling === R; } catch (e) { return false; } };
      await page.route((u) => u.pathname === '/api/public-availability' && demandeR(u), async (r) => { const rep = await r.fetch(); const j = await rep.json(); j.slots = []; await r.fulfill({ response: rep, json: j }); }, { times: 1 });
      const vu = await poserEtAttendre(page, 'bowling', R);
      refusPlan = Object.assign({ vu }, await page.evaluate((s) => Object.assign({ on: document.querySelector(s).classList.contains('is-on'), notice: Boolean(document.querySelector('#planZone .fg-notice--warn')), garder: !document.querySelector('#goContact').disabled }, window.__qaPose), selR));
    }
    ok(Boolean(refusPlan) && refusPlan.vu && refusPlan.on && refusPlan.notice && !refusPlan.garder && refusPlan.attente && !refusPlan.onde, '[C] plan refuse par le serveur : la case s entoure et reste choisie, l ecran dit que ca ne tient pas, AUCUNE onde', JSON.stringify(Object.assign({ R }, refusPlan)));
    ok(await poserEtAttendre(page, 'bowling', S) && await page.evaluate(() => Boolean(document.querySelector('#planZone .fg-visit')) && !document.querySelector('#goContact').disabled), '[C] reposer l heure serree rend le plan d avant (etat d6 pour [D])', S);
    ok(vuSurPlace > 0, 'MONTAGE [C] au moins un plan verifie laisse une partie de laser a l equipe : l etape « sur place » est exercee', `${vuSurPlace} plan(s)`);

    // =====================================================================
    console.log('');
    console.log('[D] CONTACT');
    // =====================================================================
    const o6 = lignePlan(d6);
    await page.click('#goContact');
    ok(await attendre(page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active'), 5000), '[D] l ecran du contact est actif');
    const rappel = await page.evaluate(() => document.querySelector('#recallLine').textContent.replace(/\s+/g, ' ').trim());
    ok(rappel.indexOf('6 personnes') >= 0 && rappel.indexOf(`arrivée ${o6.arrivee}`) >= 0, '[D] le rappel porte groupe et heure d arrivee du plan', rappel);
    // LE RECAPITULATIF ENTIER A COTE DU FORMULAIRE (Movsar, 2026-09-23 :
    // « pourquoi y a pas le recap ici, y a juste un mini recap »). Sur
    // ordinateur : ouvert, sans bouton ni ligne de resume, pose sur la photo
    // A COTE de la colonne du formulaire, et la scene le contient entier.
    await attendre(page, () => !document.querySelector('.fg-scene.is-entering') && document.querySelector('#recall').getAnimations().every((a) => a.playState === 'finished'), 4000);
    const recapContact = await lireRecap(page, '#recallBody');
    const geo = await page.evaluate(() => {
      const aside = document.querySelector('#recall').getBoundingClientRect();
      const form = document.querySelector('#contactForm');
      const colonneFin = form.getBoundingClientRect().right - parseFloat(getComputedStyle(form).paddingRight);
      const art = document.querySelector('.fg-scene[data-scene="contact"] .fg-art').getBoundingClientRect();
      const scene = document.querySelector('.fg-scene[data-scene="contact"]').getBoundingClientRect();
      const corps = document.querySelector('#recallBody');
      return {
        gauche: Math.round(aside.left), droite: Math.round(aside.right), bas: Math.round(aside.bottom), colonneFin: Math.round(colonneFin),
        artGauche: Math.round(art.left), artDroite: Math.round(art.right), sceneBas: Math.round(scene.bottom),
        ouvert: getComputedStyle(corps).display !== 'none' && corps.getBoundingClientRect().height > 0,
        bouton: getComputedStyle(document.querySelector('#recallToggle')).display,
        ligne: getComputedStyle(document.querySelector('#recallLine')).display,
      };
    });
    ok(Boolean(recapContact) && recapContact.items.length === PROGRAMME.length && recapContact.total === o6.prix && recapContact.logos.join(',') === '#i-card,#i-cash',
      '[D] l ecran des coordonnees porte le recapitulatif ENTIER : chaque activite, le total de la route, le paiement et ses deux logos',
      recapContact ? `${recapContact.items.map((i) => i.nom).join(' + ')} · ${recapContact.montant} · ${recapContact.paiement}` : 'absent');
    ok(geo.ouvert && geo.bouton === 'none' && geo.ligne === 'none' && geo.gauche >= geo.colonneFin && geo.gauche >= geo.artGauche && geo.droite <= geo.artDroite && geo.bas <= geo.sceneBas,
      '[D] sur ordinateur, il est ouvert, pose sur la photo a cote de la colonne du formulaire, et la scene le contient entier', JSON.stringify(geo));
    // ENTREE FAIT AVANCER D UN CHAMP (le clavier du telephone dit « suivant ») :
    // jamais un envoi a moitie rempli, ni l erreur de la case avant qu on ait
    // pu la cocher.
    await page.focus('#cPrenom'); await page.keyboard.press('Enter');
    ok(await page.evaluate(() => document.activeElement.id === 'cNom' && Boolean(document.querySelector('.fg-scene[data-scene="contact"].is-active')) && !document.querySelector('#contactForm .is-invalid')),
      '[D] Entree dans le prenom passe au nom, sans envoyer', await page.evaluate(() => document.activeElement.id || document.activeElement.tagName));
    await page.focus('#cTel'); await page.keyboard.press('Enter');
    ok(await page.evaluate(() => document.activeElement.dataset.occasion === 'anniversaire' && !document.querySelector('#contactForm .is-invalid')),
      '[D] Entree dans le telephone, aucune occasion choisie, passe a l occasion sans afficher d erreur', await page.evaluate(() => document.activeElement.dataset.occasion || document.activeElement.id || document.activeElement.tagName));
    // Chaque animation qui demarre dans le formulaire, notee : l envoi vide
    // doit faire glisser chaque erreur et secouer le SEUL premier champ.
    await page.evaluate(() => { window.__qaAnims = []; document.querySelector('#contactForm').addEventListener('animationstart', (e) => window.__qaAnims.push(`${e.animationName}:${e.target.id || e.target.className}`)); });
    await page.click('#goRecap');
    ok(await attendre(page, () => document.querySelectorAll('.fg-field.is-invalid').length === 5 && document.querySelector('#occasionWrap').classList.contains('is-invalid') && document.querySelector('#consentWrap').classList.contains('is-invalid'), 3000), '[D] un envoi vide marque les 4 champs, l occasion et la case');
    ok(await page.evaluate(() => Boolean(document.querySelector('.fg-scene[data-scene="contact"].is-active'))), '[D] et reste sur l ecran du contact');
    const liees = await page.evaluate(() => ({
      champs: ['cPrenom', 'cNom', 'cEmail', 'cTel'].map((id) => { const i = document.getElementById(id); const d = document.getElementById(i.getAttribute('aria-describedby') || ''); return { id, invalide: i.getAttribute('aria-invalid'), message: d ? d.textContent.trim() : '' }; }),
      caseInvalide: document.querySelector('#cConsent').getAttribute('aria-invalid'),
      caseMessage: document.querySelector('#eConsent').textContent,
      occasion: (() => { const g = document.querySelector('#occasions'); const d = document.getElementById(g.getAttribute('aria-describedby') || ''); return { invalide: g.getAttribute('aria-invalid'), message: d ? d.textContent.trim() : '' }; })(),
      focus: document.activeElement.id,
    }));
    ok(liees.champs.every((c) => c.invalide === 'true' && c.message.length > 0) && liees.caseInvalide === 'true' && liees.caseMessage === 'Cochez cette case pour continuer.'
      && liees.occasion.invalide === 'true' && liees.occasion.message === 'Choisissez l’occasion de votre visite.' && liees.focus === 'cPrenom',
      '[D] chaque erreur est liee a son champ, la case dit quoi faire, le focus va au premier champ', JSON.stringify(liees));
    ok(await attendre(page, () => { const a = window.__qaAnims || []; return a.filter((x) => x.indexOf('fg-err:') === 0).length === 6 && a.filter((x) => x.indexOf('fg-nudge:') === 0).join() === 'fg-nudge:cPrenom'; }, 2000),
      '[D] a l envoi, chaque erreur (la case comprise) glisse en place, et seul le premier champ a corriger fait son petit « non »', JSON.stringify(await page.evaluate(() => window.__qaAnims)));
    ok(await attendre(page, () => !document.querySelector('.is-nudge') && document.activeElement && document.activeElement.id === 'cPrenom', 2000), '[D] le premier champ a corriger prend le focus et son petit « non » ne reste pas pose');
    // UNE FAUTE DE FRAPPE DANS LE DOMAINE : une question, que le clavier
    // atteint (la proposition ne se redessine pas sous le geste) et qu un
    // toucher accepte ; jamais pour l adresse d un vrai pays different.
    const suggestion = () => page.evaluate(() => { const s = document.querySelector('#emailSuggest'); const b = s.querySelector('[data-mail]'); return { texte: s.textContent.replace(/\s+/g, ' ').trim(), mail: b ? b.dataset.mail : '' }; });
    await page.fill('#cEmail', 'camille@gmial.com'); await page.focus('#cTel');
    ok(await attendre(page, () => { const b = document.querySelector('#emailSuggest [data-mail]'); return b && b.dataset.mail === 'camille@gmail.com' && document.querySelector('#emailSuggest').textContent.replace(/\s+/g, ' ').trim() === 'Vouliez-vous dire camille@gmail.com ?'; }, 3000),
      '[D] « camille@gmial.com » : l adresse probable est proposee, en question', JSON.stringify(await suggestion()));
    await page.focus('#cEmail'); await page.keyboard.press('Tab');
    ok(await page.evaluate(() => document.activeElement.dataset.mail === 'camille@gmail.com'), '[D] au clavier, Tab atteint la proposition (elle ne se redessine pas sous le geste)', await page.evaluate(() => document.activeElement.id || document.activeElement.tagName));
    await page.keyboard.press('Enter');
    ok(await page.evaluate(() => document.querySelector('#cEmail').value === 'camille@gmail.com' && document.activeElement.id === 'cTel' && document.querySelector('#emailSuggest').innerHTML === ''),
      '[D] l accepter remplace l adresse, passe au telephone et efface la question', await page.evaluate(() => `${document.querySelector('#cEmail').value} / ${document.activeElement.id}`));
    await page.fill('#cEmail', 'luca@hotmail.it'); await page.focus('#cTel');
    const italie = await suggestion();
    await page.fill('#cEmail', 'anna@ymail.com'); await page.focus('#cTel');
    const ymail = await suggestion();
    ok(italie.texte === '' && ymail.texte === '', '[D] une adresse correcte d un autre pays (hotmail.it) ou d un domaine connu (ymail.com) ne recoit aucune proposition', JSON.stringify({ italie, ymail }));
    // UN NUMERO FAUX, ENTREE DANS LE CHAMP (case cochee, donc envoi) : on reste
    // sur le champ, qui REPREND le focus pour que son erreur soit lue.
    await page.fill('#cPrenom', 'Test'); await page.fill('#cNom', 'Pinlane'); await page.fill('#cEmail', 'qa@example.com'); await page.fill('#cTel', '12');
    ok(await page.evaluate(() => document.querySelector('#emailSuggest').innerHTML === ''), '[D] une adresse loin de la liste (qa@example.com) ne recoit aucune proposition');
    await page.check('#cConsent');
    ok(await page.evaluate(() => document.querySelector('#eConsent').textContent === '' && !document.querySelector('#cConsent').hasAttribute('aria-invalid')), '[D] cocher la case efface son erreur');
    // L OCCASION (Movsar, 2026-09-24 : « faut remettre l occasion de leur
    // venue, pour avoir les stats de qui vient et pourquoi »). Ses valeurs sont
    // celles que le serveur GARDE, relues dans sa source : une valeur qu il ne
    // connait pas partirait en « non precise ».
    const srcOccasions = fs.readFileSync(path.join(ROOT, 'lib', 'reservation-request.js'), 'utf8');
    const valeursServeur = ((/const OCCASION_VALUES = new Set\(\[([^\]]*)\]\)/.exec(srcOccasions) || [])[1] || '').match(/'([a-z]+)'/g) || [];
    const radios = await page.evaluate(() => {
      const g = document.querySelector('#occasions');
      const b = Array.from(g.querySelectorAll('.fg-occasion'));
      return { role: g.getAttribute('role'), requis: g.getAttribute('aria-required'), nom: ((document.getElementById(g.getAttribute('aria-labelledby') || '') || {}).textContent || '').trim(), valeurs: b.map((x) => x.dataset.occasion), roles: b.map((x) => x.getAttribute('role')), arrets: b.filter((x) => x.tabIndex === 0).length };
    });
    ok(radios.role === 'radiogroup' && radios.requis === 'true' && radios.nom === 'L’occasion de votre visite' && valeursServeur.length === 7
      && JSON.stringify(radios.valeurs) === JSON.stringify(valeursServeur.map((x) => x.slice(1, -1))) && radios.roles.every((r) => r === 'radio') && radios.arrets === 1,
      '[D] l occasion est un groupe radio nomme et requis, avec EXACTEMENT les valeurs que le serveur garde (OCCASION_VALUES), un seul arret de tabulation', JSON.stringify({ radios, serveur: valeursServeur }));
    // Tout rempli sauf elle : on reste, elle seule est a corriger, le focus y va.
    await page.fill('#cTel', '0491301667');
    await page.click('#goRecap');
    const sansOccasion = await page.evaluate(() => ({
      contact: Boolean(document.querySelector('.fg-scene[data-scene="contact"].is-active')), invalides: document.querySelectorAll('.fg-field.is-invalid').length,
      occasion: document.querySelector('#occasionWrap').classList.contains('is-invalid'), focus: document.activeElement.dataset.occasion || document.activeElement.id, message: document.querySelector('#eOccasion').textContent,
    }));
    ok(sansOccasion.contact && sansOccasion.invalides === 1 && sansOccasion.occasion && sansOccasion.focus === 'anniversaire' && sansOccasion.message === 'Choisissez l’occasion de votre visite.',
      '[D] tout rempli sauf l occasion : on reste, elle seule est a corriger, et le focus y va', JSON.stringify(sansOccasion));
    // Les fleches passent d une occasion a l autre et la choisissent (motif
    // APG) ; l erreur s efface ; « Autre » ouvre sa precision.
    await page.keyboard.press('ArrowRight');
    const fleche = await page.evaluate(() => ({
      focus: document.activeElement.dataset.occasion || document.activeElement.id,
      coche: Array.from(document.querySelectorAll('#occasions .fg-occasion[aria-checked="true"]')).map((b) => b.dataset.occasion).join(),
      arrets: Array.from(document.querySelectorAll('#occasions .fg-occasion')).filter((b) => b.tabIndex === 0).map((b) => b.dataset.occasion).join(),
      erreur: document.querySelector('#eOccasion').textContent, invalide: document.querySelector('#occasions').getAttribute('aria-invalid'), wrap: document.querySelector('#occasionWrap').classList.contains('is-invalid'),
    }));
    ok(fleche.focus === 'amis' && fleche.coche === 'amis' && fleche.arrets === 'amis' && fleche.erreur === '' && fleche.invalide === null && !fleche.wrap,
      '[D] la fleche passe a l occasion suivante et la choisit, et son erreur s efface', JSON.stringify(fleche));
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
    ok(await page.evaluate(() => document.activeElement.dataset.occasion === 'autre' && document.querySelector('#occasions .fg-occasion[aria-checked="true"]').dataset.occasion === 'autre'),
      '[D] depuis la premiere, la fleche arriere boucle sur la derniere (« Autre »)', await page.evaluate(() => document.activeElement.dataset.occasion || document.activeElement.id));
    ok(await attendre(page, () => { const w = document.querySelector('#occasionAutreWrap'); return !w.hidden && w.getBoundingClientRect().height > 0; }, 2000), '[D] « Autre » ouvre sa precision facultative');
    await page.click('#occasions .fg-occasion[data-occasion="famille"]');
    ok(await page.evaluate(() => document.querySelector('#occasionAutreWrap').hidden && Array.from(document.querySelectorAll('#occasions .fg-occasion[aria-checked="true"]')).map((b) => b.dataset.occasion).join() === 'famille'),
      '[D] un toucher choisit « En famille », et la precision d « Autre » se referme');
    // Le numero faux d avant revient : c est lui que la suite verifie.
    await page.fill('#cTel', '12');
    await page.focus('#cTel');
    await page.evaluate(() => { window.__focusTel = 0; document.querySelector('#cTel').addEventListener('focus', () => { window.__focusTel += 1; }); });
    await page.keyboard.press('Enter');
    const numeroFaux = await page.evaluate(() => ({
      contact: Boolean(document.querySelector('.fg-scene[data-scene="contact"].is-active')), focus: document.activeElement.id,
      invalide: document.querySelector('#cTel').getAttribute('aria-invalid'), message: document.querySelector('#eTel').textContent,
      repris: window.__focusTel, autres: document.querySelectorAll('.fg-field.is-invalid').length,
    }));
    ok(numeroFaux.contact && numeroFaux.focus === 'cTel' && numeroFaux.invalide === 'true' && numeroFaux.message === 'Vérifiez ce numéro (exemple : 0471 23 45 67).' && numeroFaux.repris >= 1 && numeroFaux.autres === 1,
      '[D] Entree sur un numero faux : on reste sur le champ, qui reprend le focus pour que l erreur soit lue', JSON.stringify(numeroFaux));
    await page.fill('#cTel', '+32 (0)491 30 16 67');
    ok(await page.evaluate(() => !document.querySelector('#contactForm [aria-invalid="true"]')), '[D] la notation +32 (0) est acceptee');
    await page.click('#goRecap');
    ok(await attendre(page, () => document.querySelector('.fg-scene[data-scene="recap"].is-active'), 5000), '[D] rempli, il passe au recapitulatif');
    await passerLaVitrine(page);

    // =====================================================================
    console.log('');
    console.log('[E] RECAP ET ENVOI');
    // =====================================================================
    // Le dernier ecran, lu dans SON conteneur : l ecran des coordonnees porte
    // desormais les memes classes.
    const recap = Object.assign(await lireRecap(page, '#recap'), await page.evaluate(() => ({
      tag: (document.querySelector('#recap .fg-tag') || {}).textContent || '',
      etoiles: document.querySelectorAll('#t-ok .spark, #i-spark, .fg-title--spark').length,
    })));
    ok(recap.total === o6.prix, '[E] le total du recap EST le prix de la reponse de disponibilite', `${recap.total} vs ${o6.prix}`);
    // LE TOTAL NE PASSE PAR AUCUN AUTRE MONTANT (audit du 2026-09-28 : 25 EUR
    // lus pour 39, 466 pour 780). Il montait de 0 a sa valeur en 700 ms ; releve
    // toutes les 50 ms pendant une seconde, il doit dire le montant a chaque
    // releve, le premier compris.
    const relevesTotal = [];
    for (let i = 0; i < 20; i += 1) {
      relevesTotal.push(await page.evaluate(() => ((document.querySelector('#totalAmount') || {}).textContent || '').trim()));
      await dormir(50);
    }
    const autresMontants = relevesTotal.filter((t) => t !== euros(o6.prix));
    ok(autresMontants.length === 0, '[E] le total affiche son montant des le premier releve, jamais un autre chiffre (20 releves sur une seconde)',
      autresMontants.length ? `${autresMontants.length} releve(s) faux : ${autresMontants.slice(0, 4).join(' | ')}` : euros(o6.prix));
    ok(recap.libelle === totalQa(o6), '[E] le total dit ce qu il couvre (les arcades, prix a l accueil)', recap.libelle);
    ok(/Paiement sur place/.test(recap.paiement) && /Carte ou espèces/.test(recap.paiement) && recap.logos.join(',') === '#i-card,#i-cash',
      '[E] le paiement sur place dit ses deux moyens, carte et especes, avec leurs deux logos', `${recap.paiement} ${recap.logos.join(',')}`);
    // UNE SEULE SOURCE : la carte de l ecran des coordonnees dit exactement ce
    // que dit ce recapitulatif (le compteur a fini sa course, verifie plus haut).
    const recapFinal = await lireRecap(page, '#recap');
    const ecartsRecap = ['lignes', 'items', 'libelle', 'total', 'montant', 'paiement', 'logos'].filter((k) => JSON.stringify(recapFinal[k]) !== JSON.stringify((recapContact || {})[k]));
    ok(ecartsRecap.length === 0, '[E] le recapitulatif de l ecran des coordonnees est EXACTEMENT celui-ci (une seule fonction de rendu)',
      ecartsRecap.map((k) => `${k}: ${JSON.stringify((recapContact || {})[k])} vs ${JSON.stringify(recapFinal[k])}`).join(' ; ').slice(0, 300) || `${recapFinal.items.length} activites, ${recapFinal.montant}`);
    ok(recap.items.map((i) => i.nom).join(' + ') === PROGRAMME.map((p) => nomDe(p.activityId)).join(' + ') && /2 parties/.test((recap.items[1] || {}).detail || ''), '[E] les quatre activites sont listees dans l ordre choisi, le laser avec ses 2 parties', recap.items.map((i) => `${i.nom} (${i.detail})`).join(' | '));
    const partiesO6 = new Set(o6.blocs.filter((b) => b.id === 'laser_game').map((b) => b.partie)).size;
    ok(/dans la foulée/.test((recap.items[1] || {}).detail || '') === (partiesO6 < 2), '[E] la partie de laser que le plan ne pose pas est annoncee « dans la foulee »', `${partiesO6}/2 posee(s) : « ${(recap.items[1] || {}).detail} »`);
    const debutDe = (id) => (o6.blocs.find((b) => b.id === id) || {}).t;
    ok((recap.items[0] || {}).aside === `Début${debutDe('bowling')}` && (recap.items[1] || {}).aside === `Début${debutDe('laser_game')}` && recap.items.slice(2).every((i) => i.aside === 'à votre rythme'), '[E] chaque activite a creneau porte l heure du plan, les libres « a votre rythme »', recap.items.map((i) => i.aside).join(' | '));
    const ligneArrivee = recap.lignes.find((l) => /^Arrivée conseillée/.test(l)) || '';
    ok(ligneArrivee === `Arrivée conseillée à ${o6.arrivee}${o6.fermeture ? `, jusqu’à la fermeture (${heureAffichee(o6.fin)})` : `, fin vers ${heureAffichee(o6.fin)}`}${surPlaceAttendu(o6.arrivee, o6.fin)}`, '[E] l arrivee, la fin (ici : jusqu a la fermeture) et la duree sur place sont celles de la reponse', ligneArrivee);
    ok(recap.lignes[0] && recap.lignes[0].indexOf(jourLong(mock.DATE)) === 0 && recap.lignes[1] === '6 personnes', '[E] date et groupe en tete', recap.lignes.slice(0, 2).join(' | '));
    ok(plat(recap.tag) === plat(jourMock && jourMock.holiday ? jourMock.holiday.label : ''), '[E] l etiquette ferie/conge du jour n apparait que si le calendrier la porte', recap.tag || 'aucune, comme le calendrier');
    ok(recap.etoiles === 0, '[E] plus aucune etoile au-dessus du titre final');
    // LES COORDONNEES RELUES telles qu elles partiront (le « (0) » retire), et
    // aucune heure redite : chaque activite porte deja la sienne.
    const qui = await page.evaluate(() => (Array.from(document.querySelectorAll('#recap p.fg-recap__detail')).map((n) => n.textContent.replace(/\s+/g, ' ').trim()).find((t) => /Au nom de/.test(t)) || ''));
    ok(qui === 'Au nom de Test Pinlane · qa@example.com · +32 491 30 16 67', '[E] le recapitulatif relit les coordonnees qui partiront, sans heure redite (chaque activite porte la sienne)', qui);
    const occasionRecap = await page.evaluate(() => ((document.querySelector('#recap .fg-recap__occasion') || {}).textContent || '').replace(/\s+/g, ' ').trim());
    ok(occasionRecap === 'Occasion : En famille', '[E] le recapitulatif relit l occasion choisie', occasionRecap || 'absente');
    const fermeture = await page.evaluate(() => ({ bouton: document.querySelector('#confirmBtn').textContent.trim(), note: document.querySelector('.fg-scene.is-active .fg-confirm__note').textContent.replace(/\s+/g, ' ').trim(), partira: /confirmation partira/.test(document.querySelector('#recap').textContent) }));
    ok(fermeture.bouton === 'Valider ma réservation' && fermeture.note === 'Aucun paiement en ligne : vous réglez sur place, par carte ou en espèces.' && !fermeture.partira, '[E] le bouton valide, aucun paiement en ligne, aucun envoi promis', JSON.stringify(fermeture));
    // CHAQUE ETAPE SE MODIFIE D UN TOUCHER, et l aller-retour ne perd rien.
    // Le bouton se touche par son TEXTE : une cible cassee (FG_QA_CASSE=modifier)
    // rougit ce controle au lieu d un clic qui attend un bouton introuvable.
    await page.click('.fg-scene.is-active .fg-edit__btn:has-text("le jour ou le groupe")');
    ok(await attendre(page, () => document.querySelector('.fg-scene[data-scene="date"].is-active') && !document.querySelector('.fg-scene.is-entering'), 5000), '[E] Modifier le jour ou le groupe ramene a l ecran 1');
    await page.click('#goActivities');
    await attendre(page, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 5000);
    await page.click('#goHours');
    await attendre(page, () => document.querySelector('.fg-scene[data-scene="heures"].is-active') && !document.querySelector('.fg-scene.is-entering') && !document.querySelector('#goContact').disabled, 8000);
    await page.click('#goContact');
    await attendre(page, () => document.querySelector('.fg-scene[data-scene="contact"].is-active') && !document.querySelector('.fg-scene.is-entering'), 5000);
    const garde = await page.evaluate(() => [document.querySelector('#cPrenom').value, document.querySelector('#cEmail').value, document.querySelector('#cConsent').checked]);
    ok(JSON.stringify(garde) === JSON.stringify(['Test', 'qa@example.com', true]), '[E] revenir modifier ne vide pas les coordonnees', JSON.stringify(garde));
    await page.click('#goRecap');
    ok(await attendre(page, () => document.querySelector('.fg-scene[data-scene="recap"].is-active') && !document.querySelector('.fg-scene.is-entering'), 5000) && ((await lireRecap(page, '#recap')) || {}).total === o6.prix, '[E] et le recapitulatif revient identique (meme total)');
    await passerLaVitrine(page);
    // Capture avant le POST : le hold peut enrichir le devis de disponibilite
    // avec les ressources canoniques. L envoi doit conserver ce snapshot entier.
    const devisRetenusE = new Map([...mock.blocagesDev.entries()]
      .filter(([, b]) => b.etat === 'actif')
      .map(([jeton, b]) => [jeton, JSON.parse(JSON.stringify(b.dossier))]));
    const reponsePose =page.waitForResponse((r) => r.url().indexOf('/api/public-reservations') >= 0 && r.request().method() === 'POST', { timeout: 15000 }).catch(() => null);
    await page.click('#confirmBtn');
    ok(await attendre(page, () => document.querySelector('.fg-scene[data-scene="fin"].is-active'), 10000), '[E] la confirmation mene a l ecran final');
    const corps = mock.dernierePose.body || {};
    // LES OFFRES PAR E-MAIL (2026-09-30) : la case, laissee vide, part avec la
    // reservation comme un booleen faux, jamais absente (sans elle, le serveur
    // ne decide rien).
    ok(corps.sansOffres === false, '[E] la case des offres, laissee vide, part avec la reservation (sansOffres : false)', JSON.stringify(corps.sansOffres));
    const fin = await page.evaluate(() => document.querySelector('#finBody').textContent.replace(/\s+/g, ' ').trim());
    ok(!/n°\s*\d+/.test(fin) && !/numéro de réservation/i.test(fin) && fin.indexOf('qa@example.com') >= 0, '[E] l ecran final cite l adresse, et aucun numero de reservation (le SaaS ne s en sert pas)', fin.slice(0, 120));
    // L ECRAN FINAL EST UN RECU : l e-mail n est annonce que parce que la
    // reponse l a mis en file ; l arrivee est celle du plan rendu ; le
    // programme nomme chaque activite choisie.
    ok(/La confirmation part à qa@example\.com\./.test(fin), '[E] l ecran final ne promet l e-mail que parce que la reponse le met en file', fin.slice(0, 200));
    const arriveeFin = (corps.opsPlan || {}).arrivalTime;
    ok(Boolean(arriveeFin) && fin.indexOf(`Arrivée conseillée à ${arriveeFin}.`) >= 0, '[E] l ecran final donne l heure d arrivee du plan rendu', arriveeFin || 'plan sans arrivee');
    const iProg = fin.indexOf('Au programme : ');
    ok(iProg >= 0 && PROGRAMME.every((p) => fin.indexOf(nomDe(p.activityId), iProg) > iProg), '[E] l ecran final nomme chaque activite choisie', fin.slice(iProg, iProg + 120));
    // LES PHOTOS NE CHANGENT PAS PENDANT LA RESERVATION (« pour chaque
    // nouvelle reservation, pas que ca change pendant la resa ») : chaque
    // ecran traverse a montre la photo tiree pour lui au chargement.
    const photosFin = await lirePhotosEcrans(page);
    const bougees = photosFin.filter((x, k) => !x.charge || x.photo !== (photosDepart[k] || {}).photo);
    ok(photosDepart.length === 6 && photosDepart.every((x) => x.photo) && bougees.length === 0,
      '[E] les six photos tirees au chargement sont celles que le parcours a montrees, sans changer en route',
      bougees.map((x) => `${x.scene} : ${x.photo || 'rien'}${x.charge ? '' : ' (jamais chargee)'} au lieu de ${(photosDepart.find((y) => y.scene === x.scene) || {}).photo}`).join(', ') || photosFin.map((x) => x.photo).join(' > '));
    ok(/Montant indicatif/.test(fin) && /à régler sur place, par carte ou en espèces\./.test(fin), '[E] l ecran final dit le montant et les deux moyens de paiement', (fin.match(/Montant indicatif[^.]*\./) || [''])[0]);
    ok(!o6.complet, 'MONTAGE [E] le prix du parcours est incomplet (les arcades se reglent sur place) : ce que couvre le montant est prouve sur un vrai cas');
    ok((fin.indexOf(`sans ${sansPrixQa(o6)} (prix à l’accueil)`) >= 0) === !o6.complet, '[E] l ecran final dit ce que le montant couvre, comme le recapitulatif', (fin.match(/Montant indicatif[^.]*\./) || [''])[0]);
    // LE TITRE DIT CE QUI S EST PASSE, lu dans la reponse du serveur : une
    // reservation confirmee d office, ou une demande que l equipe verifiera.
    const rp = await reponsePose;
    let rendu = {};
    try { rendu = rp ? await rp.json() : {}; } catch (error) { rendu = {}; }
    const confirmeQa = (rendu.reservation || {}).validationStatus === 'confirmed' || (rendu.ops || {}).autoDecision === 'auto_confirmed';
    const titreFin = await page.evaluate(() => document.querySelector('#t-fin').innerText.replace(/\s+/g, ' ').trim());
    // innerText suit la mise en capitales de la feuille : on compare les MOTS.
    ok(Boolean(rp) && titreFin.toLowerCase() === (confirmeQa ? 'réservation confirmée' : 'demande envoyée'),
      `[E] le titre final dit ce que le serveur a repondu (ici : ${confirmeQa ? 'reservation confirmee' : 'demande a verifier'})`, `« ${titreFin} »`);
    const anneauE = await page.evaluate(() => ({ confettis: document.querySelectorAll('#finBurst i').length, icone: (document.querySelector('.fg-done__ring svg use') || { getAttribute: () => 'aucune' }).getAttribute('href') }));
    ok(anneauE.confettis === (confirmeQa ? 14 : 0) && anneauE.icone === (confirmeQa ? '#i-check' : '#i-mail'), `[E] l anneau suit le verdict du serveur (ici : ${confirmeQa ? 'coche et 14 confettis' : 'enveloppe, aucun confetti'})`, JSON.stringify(anneauE));
    ok(await barreEst(page, '11111') && await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.fg-scene.is-active .fg-steps__item'));
      return items.length === 5
        && items.every((li) => li.classList.contains('is-sweep') && getComputedStyle(li.querySelector('.fg-steps__seg'), '::after').animationName === 'fg-seg-fill')
        && !document.querySelector('.fg-scene.is-active .fg-steps [aria-current]');
    }), '[E] a la fin, la barre est pleine (cinq segments balayes une fois) et plus aucune etape n est « en cours »');
    ok(corps.centerId === 'libramont' && corps.type === 'visite' && corps.date === mock.DATE && corps.pax === 6, '[E] le POST porte centre, type visite, date, groupe', JSON.stringify({ centerId: corps.centerId, type: corps.type, date: corps.date, pax: corps.pax }));
    ok(JSON.stringify(corps.program) === JSON.stringify(PROGRAMME), '[E] le programme envoye est celui choisi (bowling 1 h, laser 2 parties, minigolf, arcades)', JSON.stringify(corps.program));
    const pt = (corps.preference && corps.preference.preferredTimes) || {};
    ok(corps.startTime === o6.time && pt.bowling === S && pt.laser_game === LT && JSON.stringify(corps.preference.laserGameTimes) === JSON.stringify([LT]), '[E] l heure du creneau, les heures posees (dont la serree) et la partie de laser voyagent avec la demande', `${corps.startTime} / ${JSON.stringify(pt)} / parties ${JSON.stringify(corps.preference && corps.preference.laserGameTimes)}`);
    const devisRetenuE = devisRetenusE.get(corps.holdToken);
    ok(Boolean(devisRetenuE) && isDeepStrictEqual(corps.opsPlan, devisRetenuE.opsPlan),
      '[E] le plan envoye est exactement le snapshot canonique retenu par le blocage',
      devisRetenuE && isDeepStrictEqual(corps.opsPlan, devisRetenuE.opsPlan) ? `${corps.opsPlan.resourceBlocks.length} blocs, plan entier identique` : JSON.stringify({ envoye: corps.opsPlan, retenu: devisRetenuE && devisRetenuE.opsPlan }));
    // Le hold fixe les pistes deja attribuees comme preferences de relecture.
    // Cette seule addition est attendue et doit designer EXACTEMENT ces pistes.
    const ressourcesAttenduesE = o6.opsPlan.resourceBlocks.map((b) => b.activityId === 'bowling' && b.preferredLanes == null
      ? { ...b, preferredLanes: b.lanes } : b);
    ok(Boolean(devisRetenuE) && isDeepStrictEqual(devisRetenuE.opsPlan.resourceBlocks, ressourcesAttenduesE),
      '[E] le blocage conserve toutes les ressources, heures, durees et effectifs de la disponibilite retenue',
      devisRetenuE && isDeepStrictEqual(devisRetenuE.opsPlan.resourceBlocks, ressourcesAttenduesE) ? 'seule addition : preferredLanes egale les pistes deja retenues' : JSON.stringify({ disponibilite: ressourcesAttenduesE, blocage: devisRetenuE && devisRetenuE.opsPlan.resourceBlocks }));
    const choixCanoniquesE = (prog) => ((prog && prog.items) || []).map((i) => ({
      activityId: i.activityId, participants: i.participants, duration: i.duration,
      games: i.games, minutes: i.minutes, sessions: i.sessions, price: i.price, priceKnown: i.priceKnown,
    }));
    ok(Boolean(devisRetenuE) && isDeepStrictEqual(choixCanoniquesE(devisRetenuE.program), choixCanoniquesE(d6.program))
      && devisRetenuE.price === o6.prix && corps.quotedPrice === o6.prix,
      '[E] le devis bloque conserve les quatre activites, leurs joueurs, durees, parties et montants',
      JSON.stringify({ retenu: devisRetenuE && choixCanoniquesE(devisRetenuE.program), attendu: choixCanoniquesE(d6.program), prix: corps.quotedPrice }));
    ok(Boolean(devisRetenuE) && isDeepStrictEqual((rendu.reservation || {}).program, devisRetenuE.program)
      && isDeepStrictEqual((rendu.reservation || {}).opsPlan, devisRetenuE.opsPlan)
      && (rendu.reservation || {}).price === devisRetenuE.price,
      '[E] la reservation rendue garde le programme canonique complet, le plan et le montant bloques');
    ok(corps.name === 'Test Pinlane' && corps.email === 'qa@example.com' && corps.phone === '+32 491 30 16 67', '[E] le contact part tel que saisi, sans le (0) qui fausserait le numero', JSON.stringify(corps.phone));
    ok(!('consent' in corps) && !('cConsent' in corps), '[E] la case « j accepte » ne cree aucun champ d API inexistant');
    ok(corps.notes === '', '[E] sans mot pour l equipe, notes part vide', JSON.stringify(corps.notes));
    ok(corps.occasion === 'famille', '[E] l occasion part au serveur, la cle qu il garde', JSON.stringify(corps.occasion));
    ok(erreursPage.length === 0, '[E] aucune erreur JavaScript de tout le parcours', erreursPage.slice(0, 3).join(' | '));
    await ctx.close();

    // =====================================================================
    console.log('');
    console.log('[F] EMBARQUE PAR embed.js');
    // =====================================================================
    const hote = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pageHote = await hote.newPage();
    await pageHote.goto(`${BASE_URL}/host.html`, { waitUntil: 'networkidle', timeout: 45000 });
    ok(await attendre(pageHote, () => document.querySelector('.bloc iframe[title="Reservation en ligne"]'), 5000), '[F] embed.js monte un cadre dans le bloc du site');
    const src = await pageHote.evaluate(() => document.querySelector('.bloc iframe').src);
    ok(src.indexOf(`${BASE_URL}/fungalaxy/libramont?embed=1`) === 0, '[F] le cadre vise /fungalaxy/libramont?embed=1', src);
    ok(/[?&]fond=/.test(src), '[F] la couleur du site voyage dans l adresse (fond=)');
    const cadre = () => pageHote.frames().find((fr) => fr.url().indexOf('/fungalaxy/libramont?embed=1') >= 0);
    ok(await attendre(pageHote, () => window.__hauteurs.length > 0 && parseInt(document.querySelector('.bloc iframe').style.height, 10) > 300, 8000), '[F] le cadre recoit sa hauteur (pinlane:height)');
    const f = cadre();
    ok(Boolean(f) && await f.evaluate(() => document.body.classList.contains('is-embed')), '[F] dans le cadre, le formulaire se sait embarque');
    const bandeau = await f.evaluate(() => { const t = document.querySelector('.fg-top'); const r = t.getBoundingClientRect(); return { h: Math.round(r.height), d: getComputedStyle(t).display, rideau: getComputedStyle(document.querySelector('.fg-curtain')).display }; });
    ok(bandeau.h === 0 && bandeau.d === 'none' && bandeau.rideau === 'none', '[F] notre bandeau (logo, « Reserver ») et le rideau sont absents chez le client', JSON.stringify(bandeau));
    const fondu = await f.evaluate(() => {
      const fond = new URLSearchParams(location.search).get('fond') || '';
      const art = document.querySelector('.fg-scene.is-active .fg-art');
      return { fond, ref: getComputedStyle(document.documentElement).getPropertyValue('--fg-bg').trim(), halos: document.querySelectorAll('.fg-glow i').length, bords: art ? getComputedStyle(art, '::before').backgroundImage : '' };
    });
    ok(Boolean(fondu.fond) && fondu.ref === fondu.fond && fondu.halos === 0 && fondu.bords.indexOf(fondu.fond) >= 0, '[F] le cadre se fond dans le site : fond de reference = fond du site, halos absents, bords de la photo fondus vers cette couleur (plus de rectangle)', JSON.stringify({ fond: fondu.fond, ref: fondu.ref, halos: fondu.halos, bords: fondu.bords.slice(0, 60) }));
    const accord = async () => {
      const dedans = await f.evaluate(() => Math.max(document.body.scrollHeight, document.body.offsetHeight));
      const dehors = await pageHote.evaluate(() => parseInt(document.querySelector('.bloc iframe').style.height, 10));
      return { dedans, dehors, ecart: Math.abs(dedans - dehors) };
    };
    let a = await accord();
    ok(a.ecart <= 8, '[F] la hauteur du cadre suit le corps du formulaire (ecart <= 8 px)', JSON.stringify(a));
    // Le cadre reserve le samedi du mock, pas « aujourd hui » : le soir, les
    // heures du jour sont passees, la piste du bowling arrive sans case
    // ouverte et « Garder » reste gris (rouge vu a 21:25 le 2026-09-22 sur le
    // code qui etait vert a 19:50). Un gate ne depend pas de l heure qu il est.
    await f.click('#dayBtn');
    ok(await allerAuMois(f, mock.DATE), '[F] le mois du samedi du mock s affiche dans le cadre');
    await f.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
    ok(await attendre(f, (l) => document.querySelector('#dayPop').hidden && document.querySelector('#dayLabel').textContent.trim() === l, 3000, jourLong(mock.DATE)), '[F] le samedi du mock est retenu dans le cadre', mock.DATE);
    await f.click('#goActivities');
    ok(await attendre(pageHote, () => window.__ecrans > 0, 5000), '[F] changer d ecran previent l hote (pinlane:screen)');
    ok(await (async () => {
      const butoir = Date.now() + 4000;
      while (Date.now() < butoir) { a = await accord(); if (a.ecart <= 8 && await f.evaluate(() => !document.querySelector('.fg-scene.is-entering'))) return true; await dormir(120); }
      return false;
    })(), '[F] apres le changement d ecran, le cadre a la hauteur du nouvel ecran', JSON.stringify(a));
    await f.click('#gridAct .fg-card[data-activity="bowling"]');
    await f.click('#goHours');
    ok(await attendre(f, () => document.querySelectorAll('#hourZone .fg-track').length === 1 && document.querySelectorAll('#hourZone .fg-chip:not(.is-off)').length > 0, 25000), '[F] une seule piste (bowling seul) se charge dans le cadre');
    ok(await attendre(f, () => !document.querySelector('#goContact').disabled, 25000), '[F] le plan par defaut du serveur active « Garder » sans rien poser');
    await f.click('#goContact');
    await f.fill('#cPrenom', 'Test'); await f.fill('#cNom', 'Cadre'); await f.fill('#cEmail', 'cadre@example.com'); await f.fill('#cTel', '0491301667');
    await f.fill('#cNote', 'Anniversaire');
    await f.click('#occasions .fg-occasion[data-occasion="anniversaire"]');
    await f.check('#cConsent');
    await f.click('#goRecap');
    ok(await attendre(f, () => document.querySelector('.fg-scene[data-scene="recap"].is-active'), 5000), '[F] recap atteint dans le cadre');
    await passerLaVitrine(f);
    const motRecap = await f.evaluate(() => ((document.querySelector('#recap .fg-recap__note') || {}).textContent || '').replace(/\s+/g, ' ').trim());
    ok(motRecap === 'Votre mot pour l’équipe : « Anniversaire »', '[F] le recapitulatif reprend le mot pour l equipe, tel qu il partira', `« ${motRecap} »`);
    await f.click('#confirmBtn');
    ok(await attendre(pageHote, () => Array.isArray(window.dataLayer) && window.dataLayer.some((e) => e.event === 'pinlane_booking'), 10000), '[F] la reservation pousse pinlane_booking dans le dataLayer de l hote');
    ok((mock.dernierePose.body || {}).notes === 'Anniversaire' && (mock.dernierePose.body || {}).occasion === 'anniversaire', '[F] le mot pour l equipe part au serveur dans notes, l occasion dans occasion', JSON.stringify({ notes: (mock.dernierePose.body || {}).notes, occasion: (mock.dernierePose.body || {}).occasion }));
    const signal = await pageHote.evaluate(() => (window.dataLayer.find((e) => e.event === 'pinlane_booking') || {}).pinlane || {});
    ok(Number(signal.reservationId) > 0 && signal.center === 'libramont' && signal.currency === 'EUR' && signal.status === 'confirmed', '[F] le signal porte numero, centre, devise, statut', JSON.stringify(signal));
    ok(!('email' in signal) && !('name' in signal) && !('phone' in signal) && JSON.stringify(signal).indexOf('example.com') < 0, '[F] et aucune donnee personnelle');
    await hote.close();

    // =====================================================================
    console.log('');
    console.log('[G] TELEPHONE 390 px');
    // =====================================================================
    const tel = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const pageTel = await tel.newPage();
    const erreursTel = []; pageTel.on('pageerror', (e) => erreursTel.push(e.message));
    await pageTel.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    ok(await attendre(pageTel, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000), '[G] le catalogue est lu');
    const mesure = () => pageTel.evaluate(() => {
      const b = document.querySelector('.fg-scene.is-active .fg-btn:not(.fg-btn--ghost)');
      const r = b ? b.getBoundingClientRect() : { left: -1, right: 9999 };
      const deborde = (sel) => Array.from(document.querySelectorAll(sel)).filter((x) => x.getBoundingClientRect().height > 0 && x.scrollWidth > x.clientWidth + 1).map((x) => x.textContent.trim());
      return { deborde: document.documentElement.scrollWidth - document.documentElement.clientWidth, btnDedans: r.left >= 0 && r.right <= document.documentElement.clientWidth, art: Math.round((document.querySelector('.fg-scene.is-active .fg-art') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height), cases: deborde('.fg-pill, .fg-chip, .fg-period__btn') };
    });
    let m = await mesure();
    ok(m.deborde <= 1 && m.btnDedans, '[G] ecran 1 : aucun defilement horizontal, bouton dans l ecran', JSON.stringify({ deborde: m.deborde, btnDedans: m.btnDedans }));
    ok(m.art > 0 && m.art <= 260, '[G] ecran 1 : la photo devient un bandeau (<= 260 px)', `${m.art}px`);
    await pageTel.click('#dayBtn');
    ok(await attendre(pageTel, () => { const p = document.querySelector('#dayPop'); const r = p.getBoundingClientRect(); return !p.hidden && r.left >= 0 && r.right <= document.documentElement.clientWidth; }, 3000), '[G] ecran 1 : le calendrier tient dans l ecran');
    ok(await allerAuMois(pageTel, mock.DATE), '[G] le mois du samedi du mock s affiche');
    // Taille de mise en page (offsetWidth) : la fenetre du milieu s ouvre en
    // passant de l echelle 0,96 a 1, une mesure a l ecran pendant l ouverture
    // rendait 42 pour 44.
    ok(await pageTel.evaluate(() => ['#calPrev', '#calNext'].every((s) => { const b = document.querySelector(s); return b.offsetWidth >= 44 && b.offsetHeight >= 44; })), '[G] les fleches du mois font 44 px', await pageTel.evaluate(() => JSON.stringify(['#calPrev', '#calNext'].map((s) => document.querySelector(s).offsetWidth))));
    await pageTel.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
    await pageTel.click('#goActivities');
    ok(await attendre(pageTel, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 5000), '[G] ecran 2 atteint');
    const filTouche = await pageTel.evaluate(() => { const b = document.querySelector('.fg-scene.is-active .fg-steps__item.is-done button'); if (!b) return null; const s = b.querySelector('.fg-steps__seg').getBoundingClientRect(); const el = document.elementFromPoint(s.left + s.width / 2, s.top - 10); return { touche: Boolean(el) && (el === b || b.contains(el)), sur: el ? (el.className || el.tagName) : 'rien' }; });
    ok(Boolean(filTouche) && filTouche.touche, '[G] ecran 2 : l etape faite se touche 10 px au-dessus de son segment', JSON.stringify(filTouche));
    await pageTel.click('#gridAct .fg-card[data-activity="bowling"]');
    await pageTel.click('#gridAct .fg-card[data-activity="laser_game"]');
    await attendre(pageTel, () => ['bowling', 'laser_game'].every((id) => document.querySelector(`#gridAct li[data-activity="${id}"] .fg-card__optin`).getBoundingClientRect().height > 40), 3000);
    m = await mesure();
    ok(m.deborde <= 1 && m.btnDedans && m.cases.length === 0, '[G] ecran 2 : aucun defilement horizontal, chaque pastille tient dans sa case', JSON.stringify({ deborde: m.deborde, cases: m.cases.slice(0, 3) }));
    await pageTel.click('#goHours');
    ok(await attendre(pageTel, () => document.querySelectorAll('#hourZone .fg-track').length === 2 && document.querySelector('#planZone .fg-visit') && !document.querySelector('.fg-scene.is-entering') && !document.querySelector('#hourZone').classList.contains('is-busy'), 25000), '[G] ecran 3 : les deux pistes et le plan se chargent, transition finie');
    await attendre(pageTel, () => Array.from(document.querySelectorAll('#hourZone .fg-chip')).every((c) => c.getAnimations().length === 0), 4000);
    // LE SOUS-TITRE DES HEURES SE COUPE AUX BONS ENDROITS (390 et 360 px) :
    // chaque « · » et « + » reste avec le mot d avant, le dernier mot d un
    // nom avec le precedent (« Laser Game ») ; aucune ligne ne commence par
    // un separateur, aucun mot seul. Lu caractere par caractere, au noeud de
    // texte (une ligne = un meme haut de rectangle).
    const sub390 = await pageTel.evaluate(() => {
      const el = document.querySelector('#hourSub');
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest('.fg-sub__open') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
      let texte = ''; const lignes = []; let cur = null;
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        texte += n.data;
        for (let i = 0; i < n.length; i += 1) {
          const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
          const b = r.getClientRects()[0]; if (!b || !b.width) continue;
          if (!cur || Math.abs(b.top - cur.top) > 4) { cur = { top: b.top, t: '' }; lignes.push(cur); }
          cur.t += n.data[i];
        }
      }
      const l = lignes.map((x) => x.t.replace(/\s+/g, ' ').trim()).filter(Boolean);
      return { colles: !/[^\u00a0][\u00b7+]/.test(texte.replace(/^[\u00b7+]/, '')), nom: texte.indexOf('Laser\u00a0Game') >= 0, lignes: l,
        tete: l.some((x) => /^[\u00b7+]/.test(x)), seul: l.some((x) => x.split(' ').length < 2) };
    });
    ok(sub390.colles && sub390.nom, '[G] le sous-titre des heures colle chaque « · » et « + » au mot d avant, et le dernier mot d un nom au precedent (« Laser Game »)', JSON.stringify(sub390));
    ok(!sub390.tete && !sub390.seul, '[G] a 390 px, aucune ligne du sous-titre ne commence par « · » ou « + », aucun mot seul', JSON.stringify(sub390.lignes));
    await pageTel.setViewportSize({ width: 360, height: 740 });
    await dormir(500);
    const sub360 = await pageTel.evaluate(() => {
      const el = document.querySelector('#hourSub');
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest('.fg-sub__open') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
      let texte = ''; const lignes = []; let cur = null;
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        texte += n.data;
        for (let i = 0; i < n.length; i += 1) {
          const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
          const b = r.getClientRects()[0]; if (!b || !b.width) continue;
          if (!cur || Math.abs(b.top - cur.top) > 4) { cur = { top: b.top, t: '' }; lignes.push(cur); }
          cur.t += n.data[i];
        }
      }
      const l = lignes.map((x) => x.t.replace(/\s+/g, ' ').trim()).filter(Boolean);
      return { colles: !/[^\u00a0][\u00b7+]/.test(texte.replace(/^[\u00b7+]/, '')), nom: texte.indexOf('Laser\u00a0Game') >= 0, lignes: l,
        tete: l.some((x) => /^[\u00b7+]/.test(x)), seul: l.some((x) => x.split(' ').length < 2) };
    });
    ok(!sub360.tete && !sub360.seul, '[G] a 360 px, aucune ligne du sous-titre ne commence par « · » ou « + », aucun mot seul', JSON.stringify(sub360.lignes));
    await pageTel.setViewportSize({ width: 390, height: 844 });
    await dormir(500);
    m = await mesure();
    ok(m.deborde <= 1 && m.btnDedans && m.cases.length === 0, '[G] ecran 3 : aucun defilement horizontal, chaque heure et chaque menu tient dans sa case', JSON.stringify({ deborde: m.deborde, cases: m.cases.slice(0, 3) }));
    const telB = await pageTel.evaluate(() => { const c = document.querySelector('#hourZone .fg-track[data-activity="bowling"] .fg-period.is-open .fg-chip:not(.is-proposed):not(.is-off)'); if (!c) return ''; window.__qaHaut = c.getBoundingClientRect().top + window.scrollY; window.__qaCase = c; return c.dataset.time; });
    const reponseTel = pageTel.waitForResponse((r) => r.url().indexOf('/api/public-availability?') >= 0, { timeout: 25000 }).catch(() => null);
    if (telB) await pageTel.tap(`#hourZone .fg-track[data-activity="bowling"] .fg-chip[data-time="${telB}"]`);
    ok(Boolean(telB) && Boolean(await reponseTel) && await attendre(pageTel, () => !document.querySelector('#hourZone').classList.contains('is-busy'), 25000), '[G] toucher une heure de bowling la pose', telB);
    const sautTel = await pageTel.evaluate(() => ({ meme: document.querySelector('#hourZone .fg-track[data-activity="bowling"] .fg-chip.is-on') === window.__qaCase, saut: window.__qaCase ? Math.abs(window.__qaCase.getBoundingClientRect().top + window.scrollY - window.__qaHaut) : -1 }));
    ok(sautTel.meme && sautTel.saut <= 1, '[G] sur telephone aussi, poser une heure ne fait rien sauter (le lien « laisser l equipe placer » avait deja sa place)', JSON.stringify(sautTel));
    // L ECRAN DES COORDONNEES SUR TELEPHONE : le recapitulatif se replie sous
    // sa ligne de resume (le formulaire reste en tete), le bouton le deplie.
    await pageTel.tap('#goContact');
    ok(await attendre(pageTel, () => document.querySelector('.fg-scene[data-scene="contact"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000), '[G] ecran 4 atteint');
    const lireRappelTel = () => pageTel.evaluate(() => {
      const aside = document.querySelector('#recall').getBoundingClientRect();
      const corps = document.querySelector('#recallBody');
      const bouton = document.querySelector('#recallToggle');
      return {
        ligne: getComputedStyle(document.querySelector('#recallLine')).display !== 'none' && document.querySelector('#recallLine').textContent.trim().length > 0,
        bouton: getComputedStyle(bouton).display !== 'none', hauteurBouton: Math.round(bouton.getBoundingClientRect().height), etendu: bouton.getAttribute('aria-expanded'),
        corps: getComputedStyle(corps).display !== 'none' && corps.getBoundingClientRect().height > 0,
        items: corps.querySelectorAll('.fg-recap__item').length,
        dedans: aside.left >= 0 && aside.right <= document.documentElement.clientWidth,
        deborde: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    const replie = await lireRappelTel();
    ok(replie.ligne && replie.bouton && replie.hauteurBouton >= 44 && replie.etendu === 'false' && !replie.corps && replie.dedans && replie.deborde <= 1,
      '[G] ecran 4 : le recapitulatif est replie sous sa ligne de resume, un bouton de 44 px le deplie, rien ne deborde', JSON.stringify(replie));
    await pageTel.tap('#recallToggle');
    const deplie = await lireRappelTel();
    ok(deplie.etendu === 'true' && deplie.corps && deplie.items === 2 && deplie.dedans && deplie.deborde <= 1,
      '[G] toucher le bouton deplie le recapitulatif entier (les deux activites), dans l ecran', JSON.stringify(deplie));
    // 16 PX : sous cette taille, Safari sur iPhone zoome sur le champ touche.
    const tailles = await pageTel.evaluate(() => ['cPrenom', 'cNom', 'cEmail', 'cTel', 'cNote'].map((id) => parseFloat(getComputedStyle(document.getElementById(id)).fontSize)));
    ok(tailles.every((t) => t >= 16), '[G] ecran 4 : chaque champ ecrit en 16 px au moins (pas de zoom sur iPhone)', JSON.stringify(tailles));
    // UNE ADRESSE PROPOSEE TRES LONGUE se coupe dans la colonne du champ (le
    // corps de la page masque ce qui deborde : rien ne defilerait, le bout
    // de l adresse serait coupe), et reste une cible de 44 px.
    await pageTel.fill('#cEmail', 'marieclaire.vandenberghedupont.famille@hotmial.com'); await pageTel.focus('#cTel');
    await attendre(pageTel, () => { const s = document.querySelector('#emailSuggest'); return s.querySelector('[data-mail]') && s.getAnimations().every((a) => a.playState === 'finished'); }, 3000);
    const propTel = await pageTel.evaluate(() => {
      const b = document.querySelector('#emailSuggest [data-mail]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      const champ = b.closest('.fg-field').getBoundingClientRect();
      // La largeur de l adresse sur UNE ligne, mesuree sur une copie : le
      // cas n est un vrai cas que si elle depasse la colonne.
      const copie = b.cloneNode(true);
      copie.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;white-space:nowrap;max-width:none';
      b.parentNode.appendChild(copie);
      const uneLigne = Math.round(copie.getBoundingClientRect().width);
      copie.remove();
      return { mail: b.dataset.mail, vu: r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== 'hidden', h: Math.round(r.height), droite: Math.round(r.right), colonne: Math.round(champ.right), largeurColonne: Math.round(champ.width), uneLigne, sw: b.scrollWidth, cw: b.clientWidth, deborde: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    ok(Boolean(propTel) && propTel.uneLigne > propTel.largeurColonne, 'MONTAGE [G] l adresse proposee est plus longue que la colonne sur une ligne : la mesure porte sur un vrai cas', JSON.stringify(propTel && { uneLigne: propTel.uneLigne, colonne: propTel.largeurColonne }));
    ok(Boolean(propTel) && propTel.mail === 'marieclaire.vandenberghedupont.famille@hotmail.com' && propTel.vu && propTel.h >= 44 && propTel.droite <= propTel.colonne && propTel.sw <= propTel.cw + 1 && propTel.deborde <= 1,
      '[G] ecran 4 : une adresse proposee tres longue se coupe dans la colonne, et sa cible fait 44 px', JSON.stringify(propTel));
    // L ERREUR D ENVOI SOUS LE DOIGT : sur telephone, le doigt est sur le
    // bouton, en bas ; l alerte du haut serait hors de l ecran.
    await pageTel.fill('#cPrenom', 'Test'); await pageTel.fill('#cNom', 'Pinlane'); await pageTel.fill('#cEmail', 'qa@example.com'); await pageTel.fill('#cTel', '0491 30 16 67');
    await pageTel.tap('#occasions .fg-occasion[data-occasion="amis"]');
    await pageTel.check('#cConsent');
    await pageTel.tap('#goRecap');
    const recapPose = () => attendre(pageTel, () => document.querySelector('.fg-scene[data-scene="recap"].is-active') && !document.querySelector('.fg-scene.is-entering') && document.querySelector('.fg-scene[data-scene="recap"]').getAnimations({ subtree: true }).every((a) => a.playState !== 'running' || a.effect.getComputedTiming().iterations === Infinity), 6000);
    ok(await recapPose(), '[G] ecran 5 atteint');
    await passerLaVitrine(pageTel);
    const autreJour = plusJours(mock.DATE, 7);
    let modeEnvoi = '409';
    await pageTel.route('**/api/public-reservations', (r) => (modeEnvoi === 'coupure' ? r.abort() : r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, message: 'x', alternatives: [{ date: autreJour, startTime: '18:00' }] }) })));
    const ras = await pageTel.evaluate(() => { const btn = document.querySelector('#confirmBtn'); window.scrollTo(0, btn.getBoundingClientRect().bottom + scrollY - innerHeight + 4); return Math.round(innerHeight - btn.getBoundingClientRect().bottom); });
    ok(ras >= 0 && ras < 40, '[G] (prerequis) le bouton de confirmation est au ras du bas de l ecran', `${ras} px sous lui`);
    await pageTel.tap('#confirmBtn');
    ok(await attendre(pageTel, () => {
      const e = document.querySelector('#confirmErr');
      if (!e || e.hidden) return false;
      const r = e.getBoundingClientRect();
      return r.height > 0 && r.top >= document.querySelector('#confirmBtn').getBoundingClientRect().bottom && r.top >= 0 && r.bottom <= innerHeight && e.getAnimations().every((a) => a.playState === 'finished');
    }, 4000), '[G] 409 : l erreur apparait SOUS le bouton, dans l ecran', JSON.stringify(await pageTel.evaluate(() => { const r = document.querySelector('#confirmErr').getBoundingClientRect(); return { haut: Math.round(r.top), bas: Math.round(r.bottom), ecran: innerHeight }; })));
    const err409 = await pageTel.evaluate(() => ({ texte: document.querySelector('#confirmErr').textContent.replace(/\s+/g, ' ').trim(), alerte: document.querySelector('#fgAlert').hidden, recap: Boolean(document.querySelector('.fg-scene[data-scene="recap"].is-active')) }));
    ok(err409.texte.indexOf('Ce créneau ne peut plus être réservé en ligne.') === 0 && err409.texte.indexOf('à 18:00') >= 0 && err409.alerte && err409.recap,
      '[G] 409 : le creneau refuse est dit avec l autre possibilite du serveur ; l alerte du haut reste cachee, on reste au recapitulatif', JSON.stringify(err409));
    await pageTel.tap('.fg-scene[data-scene="recap"] [data-back]');
    ok(await attendre(pageTel, () => document.querySelector('.fg-scene[data-scene="contact"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000), '[G] « vos coordonnees » ramene a l ecran 4');
    await pageTel.tap('#goRecap');
    ok(await recapPose() && await pageTel.evaluate(() => document.querySelector('#confirmErr').hidden), '[G] revenu par « Modifier », l ancienne erreur a disparu');
    await passerLaVitrine(pageTel);
    await pageTel.tap('#confirmBtn');
    ok(await attendre(pageTel, () => !document.querySelector('#confirmErr').hidden && document.querySelector('#confirmErr [data-rechoisir]'), 4000), '[G] (prerequis) le 409 revient, avec « Choisir d autres horaires »');
    const redemande = pageTel.waitForResponse((r) => r.url().indexOf('/api/public-availability?') >= 0, { timeout: 25000 }).catch(() => null);
    await pageTel.tap('#confirmErr [data-rechoisir]');
    ok(Boolean(await redemande) && await attendre(pageTel, () => document.querySelector('.fg-scene[data-scene="heures"].is-active') && !document.querySelector('.fg-scene.is-entering') && !document.querySelector('#goContact').disabled && !document.querySelector('#hourZone').classList.contains('is-busy'), 25000),
      '[G] « Choisir d autres horaires » ramene aux heures et les redemande au serveur');
    await pageTel.tap('#goContact');
    await attendre(pageTel, () => document.querySelector('.fg-scene[data-scene="contact"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000);
    await pageTel.tap('#goRecap');
    await recapPose();
    await passerLaVitrine(pageTel);
    modeEnvoi = 'coupure';
    await pageTel.tap('#confirmBtn');
    const telCentre = ((meta.center || {}).contact || {}).phone;
    ok(await attendre(pageTel, (avecTel) => {
      const e = document.querySelector('#confirmErr');
      return !e.hidden && /^Impossible de savoir si votre demande est partie\. Avant de la renvoyer, /.test(e.textContent.replace(/\s+/g, ' ').trim()) && (!avecTel || Boolean(e.querySelector('a[href^="tel:"]')));
    }, 4000, Boolean(telCentre)), '[G] une coupure ne pousse pas a renvoyer : on ne sait pas si la demande est partie, le centre se joint d un toucher', await pageTel.evaluate(() => document.querySelector('#confirmErr').textContent.replace(/\s+/g, ' ').trim()));
    await pageTel.unroute('**/api/public-reservations');
    ok(erreursTel.length === 0, '[G] aucune erreur JavaScript sur telephone', erreursTel.slice(0, 3).join(' | '));
    await tel.close();

    // =====================================================================
    console.log('');
    console.log('[C] L ATTENTE DU PREMIER CALCUL : UNE CARTE-SQUELETTE DE PISTE');
    // La roue grise tombait a 2,3:1 au bord de la colonne et ne disait rien
    // de ce qui venait. A sa place, la forme d une piste : jamais une piste,
    // une heure ou un plan (rien ne passe pour une reponse), seules ses
    // barres respirent, et rien ne bouge en mouvement reduit. La reponse est
    // RETENUE jusqu a ce que l attente soit lue : aucune course contre la
    // montre, meme sur une machine chargee.
    // =====================================================================
    for (const reduit of [false, true]) {
      const ctxS = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 900 } }, reduit ? { reducedMotion: 'reduce' } : {}));
      const ps = await ctxS.newPage();
      await ps.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
      await attendre(ps, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000);
      await ps.click('#dayBtn');
      await allerAuMois(ps, mock.DATE);
      await ps.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
      await attendre(ps, () => document.querySelector('#dayPop').hidden, 3000);
      await ps.click('#goActivities');
      await attendre(ps, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000);
      await ps.click('#gridAct .fg-card[data-activity="bowling"]');
      let lacher = () => {};
      const tenue = new Promise((r) => { lacher = r; });
      await ps.route((u) => u.pathname === '/api/public-availability', async (r) => { await tenue; await r.continue().catch(() => {}); });
      await ps.click('#goHours');
      const vu = await attendre(ps, () => Boolean(document.querySelector('#hourZone .fg-skel')) && document.querySelector('#hourZone').classList.contains('is-busy'), 5000);
      const pendant = await ps.evaluate(() => {
        const z = document.querySelector('#hourZone');
        const skel = z.querySelector('.fg-skel');
        const txt = z.querySelector('.fg-skel .fg-skel__txt');
        return {
          carte: Boolean(z.querySelector('.fg-skel .fg-skel__card[aria-hidden="true"]')),
          reponses: z.querySelectorAll('.fg-track, #planZone, .fg-chip, .fg-visit').length,
          texte: txt ? txt.textContent.trim().length : 0,
          couleur: txt ? getComputedStyle(txt).color : '',
          animTexte: txt ? getComputedStyle(txt).animationName : '',
          animEntree: skel ? getComputedStyle(skel).animationName : '',
          barres: Array.from(z.querySelectorAll('.fg-skel__card i')).map((i) => `${getComputedStyle(i).animationName}/${getComputedStyle(i).animationIterationCount}`),
        };
      });
      lacher();
      if (!reduit) {
        ok(vu && pendant.carte && pendant.reponses === 0 && pendant.texte > 0 && pendant.couleur === 'rgb(255, 255, 255)' && pendant.animTexte === 'none' && pendant.animEntree === 'fg-skel-in'
          && pendant.barres.length === 4 && pendant.barres.every((b) => b === 'fg-skel/infinite'),
          '[C] pendant le premier calcul : une carte-squelette de piste (ni piste, ni heure, ni plan), son texte blanc immobile, ses quatre barres qui respirent', JSON.stringify(pendant));
        ok(await attendre(ps, () => document.querySelector('#planZone .fg-visit') && !document.querySelector('#hourZone .fg-skel'), 25000), '[C] la reponse arrivee, le squelette laisse la place aux pistes et au plan');
      } else {
        ok(vu && pendant.carte && pendant.animEntree === 'none' && pendant.barres.length === 4 && pendant.barres.every((b) => /^none\//.test(b)),
          '[C] en mouvement reduit, la carte-squelette est la, immobile (ni fondu, ni respiration)', JSON.stringify(pendant));
        await attendre(ps, () => !document.querySelector('#hourZone').classList.contains('is-busy'), 25000);
      }
      await ctxS.close();
    }

    // =====================================================================
    console.log('');
    console.log('[I] FORMULES A L ECRAN, ET LE FUN RUN QUI TOURNE');
    // Movsar, 2026-09-23 : « les formules sont super mal faites, c est moche,
    // pas bien range, et ya pas les contraintes d indisponibilite visibles » ;
    // « pixel game on peut pas le choisir quand ya plus de 5 joueurs, on peut
    // faire plusieurs sessions, tournante ». La REGLE est prouvee sur une
    // grille complete par fungalaxy-formules-check et funrun-rotation-check :
    // ici, c est l ECRAN qui est mesure.
    // =====================================================================
    const vitrine = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pageV = await vitrine.newPage();
    const demandesV = []; pageV.on('request', (r) => { if (r.url().indexOf('/api/public-availability?') >= 0) demandesV.push(r.url()); });
    const demandeApres = async (n, test, ms) => { for (let k = 0; k * 100 < ms; k += 1) { if (demandesV.slice(n).some((u) => test(new URL(u).searchParams))) return true; await dormir(100); } return false; };
    const surEcran2 = () => attendre(pageV, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000);
    const surHeures = () => attendre(pageV, () => document.querySelector('.fg-scene[data-scene="heures"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000);
    await pageV.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    ok(await attendre(pageV, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000), '[I] le catalogue est lu');
    await pageV.click('#dayBtn');
    ok(await allerAuMois(pageV, mock.DATE), '[I] le mois du samedi du mock s affiche');
    await pageV.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
    await pageV.fill('#paxInput', '12');
    await pageV.press('#paxInput', 'Enter');
    await pageV.click('#goActivities');
    ok(await attendre(pageV, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000), '[I] ecran 2 atteint a 12 personnes');

    // --- Le Fun Run tourne au lieu de disparaitre -------------------------
    const funCarte = await pageV.evaluate(() => {
      const c = document.querySelector('#gridAct .fg-card[data-activity="fun_run"]');
      if (!c) return null;
      return { off: c.classList.contains('is-off'), aria: c.getAttribute('aria-disabled'), tab: c.getAttribute('tabindex'), prix: (c.querySelector('.fg-card__price') || {}).textContent.trim() };
    });
    ok(Boolean(funCarte) && funCarte.off === false && !funCarte.aria && funCarte.tab === '0',
      '[I] a 12 personnes, le Fun Run se choisit (avant, la carte etait eteinte)', JSON.stringify(funCarte));
    ok(Boolean(funCarte) && /5 joueurs par session/.test(funCarte.prix), '[I] et la carte dit la capacite d une session', funCarte && funCarte.prix);
    await pageV.click('#gridAct .fg-card[data-activity="fun_run"]');
    ok(await attendre(pageV, () => { const n = document.querySelector('#gridAct li[data-activity="fun_run"] .fg-card__rot'); return n && n.getBoundingClientRect().height > 0; }, 3000),
      '[I] cochee, la carte annonce la rotation sous ses pastilles');
    const rot = await pageV.evaluate(() => (document.querySelector('#gridAct li[data-activity="fun_run"] .fg-card__rot') || {}).textContent || '');
    ok(/3 sessions/.test(rot) && /5 joueurs/.test(rot), '[I] « 3 sessions, 5 joueurs a la fois » pour 12 personnes', rot.trim());
    await pageV.click('#goHours');
    ok(await attendre(pageV, () => document.querySelector('#planZone .fg-visit') && !document.querySelector('#hourZone').classList.contains('is-busy'), 25000), '[I] l ecran des heures repond pour le Fun Run');
    const visite = await pageV.evaluate(() => {
      const v = document.querySelector('#planZone .fg-visit');
      return { prix: (v.querySelector('.fg-visit__price') || {}).textContent || '', detail: Array.from(v.querySelectorAll('.fg-visit__step')).map((n) => n.textContent.replace(/\s+/g, ' ').trim()).join(' | ') };
    });
    // 3 sessions de 15 min a 30 EUR : le montant vient du SERVEUR, jamais du
    // navigateur. 90 EUR est le prix que le comptoir encaisserait.
    ok(/90/.test(visite.prix), '[I] le serveur chiffre les trois sessions : 90 EUR', visite.prix.trim());
    ok(/3 sessions de 15 min/.test(visite.detail), '[I] et la visite dit « 3 sessions de 15 min »', visite.detail);

    // --- Les formules : familles, contraintes, refus explique -------------
    await pageV.click('.fg-scene.is-active [data-back]');
    ok(await attendre(pageV, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000), '[I] retour a l ecran 2');
    // Le groupe reste a 12 : la FORMULE 1 (6 minimum) les accepte, et les
    // cinq formules d un autre jour se refusent pour le JOUR, pas pour le
    // groupe. Le champ du nombre de personnes vit a l ecran 1 : on ne
    // remonte pas le chercher pour rien.
    // Les onglets au clavier (motif APG) et la pastille sous l onglet choisi.
    await pageV.focus('#tabAct');
    await pageV.keyboard.press('ArrowRight');
    await attendre(pageV, () => document.querySelector('#tabBar').getAnimations().length === 0, 2000);
    const ongletsClavier = await pageV.evaluate(() => {
      const a = document.querySelector('#tabAct'), f = document.querySelector('#tabFor');
      const b = document.querySelector('#tabBar').getBoundingClientRect(), r = f.getBoundingClientRect();
      return { choisi: f.getAttribute('aria-selected'), focus: document.activeElement === f, panneau: !document.querySelector('#panelFor').hidden,
        tabulation: [a.tabIndex, f.tabIndex].join(), ecart: [Math.round(b.left - r.left), Math.round(b.width - r.width)] };
    });
    ok(ongletsClavier.choisi === 'true' && ongletsClavier.focus && ongletsClavier.panneau && ongletsClavier.tabulation === '-1,0'
      && Math.abs(ongletsClavier.ecart[0]) <= 1 && Math.abs(ongletsClavier.ecart[1]) <= 1,
      '[I] au clavier, la fleche droite ouvre les formules, le focus suit, un seul onglet tabulable, la pastille couvre l onglet choisi', JSON.stringify(ongletsClavier));
    await pageV.keyboard.press('Home');
    ok(await attendre(pageV, () => document.querySelector('#tabAct').getAttribute('aria-selected') === 'true' && !document.querySelector('#panelAct').hidden && document.activeElement.id === 'tabAct', 2000),
      '[I] la touche Debut revient aux activites, le focus suit');
    await pageV.click('#tabFor');
    ok(await attendre(pageV, () => document.querySelectorAll('#gridFor .fg-fam').length > 0, 4000), '[I] l onglet Formules affiche des familles');
    const vue = await pageV.evaluate(() => ({
      familles: Array.from(document.querySelectorAll('#gridFor .fg-fam')).map((s) => ({
        titre: (s.querySelector('.fg-fam__title') || {}).textContent.trim(),
        cartes: s.querySelectorAll('.fg-card--formule').length,
      })),
      cartes: Array.from(document.querySelectorAll('#gridFor .fg-card--formule')).map((c) => ({
        id: c.dataset.formule,
        refus: c.classList.contains('is-refus'),
        aria: c.getAttribute('aria-disabled'),
        tab: c.getAttribute('tabindex'),
        regles: Array.from(c.querySelectorAll('.fg-for__rules i')).map((n) => n.textContent.trim()),
        contenu: Array.from(c.querySelectorAll('.fg-for__list li')).map((n) => n.textContent.trim()),
        pourquoi: (c.querySelector('.fg-for__off') || {}).textContent ? c.querySelector('.fg-for__off').textContent.trim() : '',
        prix: (c.querySelector('.fg-for__price') || {}).textContent.trim(),
      })),
    }));
    ok(vue.familles.length === 2, '[I] deux familles : les anniversaires et les offres speciales', JSON.stringify(vue.familles.map((f) => f.titre)));
    ok(vue.familles[0].cartes === 8 && vue.familles[1].cartes === 6, '[I] 8 formules d anniversaire, 6 offres speciales', JSON.stringify(vue.familles.map((f) => f.cartes)));
    ok(vue.familles.every((f) => /\d+ formules?$/.test(f.titre)), '[I] chaque famille annonce son compte', JSON.stringify(vue.familles.map((f) => f.titre)));
    ok(vue.cartes.length === 14, '[I] les quatorze formules du catalogue sont a l ecran', String(vue.cartes.length));
    ok(vue.cartes.every((c) => c.contenu.length > 0), '[I] chaque carte liste ce qu elle contient, ligne par ligne');
    const f1 = vue.cartes.find((c) => c.id === 'f1');
    ok(Boolean(f1) && f1.regles.includes('dès 6 personnes') && f1.regles.includes('hors vacances et fériés'),
      '[I] FORMULE 1 affiche ses contraintes (groupe minimum, vacances)', JSON.stringify(f1 && f1.regles));
    const btsV = vue.cartes.find((c) => c.id === 'bts');
    ok(Boolean(btsV) && btsV.regles.includes('de 18h à 22h') && btsV.regles.some((r) => /mardi/.test(r)),
      '[I] BACK TO SCHOOL affiche sa plage horaire et ses jours', JSON.stringify(btsV && btsV.regles));
    // Un SAMEDI : les cinq formules d un autre jour se voient refusees, avec
    // leur raison, et restent atteignables (jamais aria-disabled).
    const refus = vue.cartes.filter((c) => c.refus).map((c) => c.id);
    ok(['bts', 'css', 'kfd', 'hlg', 'ffm'].every((id) => refus.includes(id)),
      '[I] un samedi, les cinq formules d un autre jour sont refusees a l ecran', refus.join(', '));
    ok(vue.cartes.filter((c) => c.refus).every((c) => c.pourquoi.length > 10 && !c.aria && c.tab === '0'),
      '[I] chaque refus dit pourquoi et reste atteignable au clavier (jamais aria-disabled)',
      JSON.stringify(vue.cartes.filter((c) => c.refus).map((c) => c.pourquoi).slice(0, 2)));
    ok(vue.cartes.filter((c) => !c.refus).every((c) => c.pourquoi === ''),
      '[I] et aucune formule disponible ne porte de refus');
    // Toucher un refus ne coche rien, mais fait battre la raison.
    await pageV.click('#gridFor .fg-card--formule[data-formule="ffm"]');
    const apresRefus = await pageV.evaluate(() => {
      const c = document.querySelector('#gridFor .fg-card--formule[data-formule="ffm"]');
      return { coche: c.getAttribute('aria-checked'), pulse: Boolean(c.querySelector('.fg-for__off.is-pulse')), compteur: (document.querySelector('#actCount') || {}).textContent.trim() };
    });
    // Seul le Fun Run est coche, dans l onglet des activites : a zero formule,
    // la barre dit quoi faire et rappelle l activite gardee.
    ok(apresRefus.coche === 'false' && apresRefus.pulse && /^Choisissez une formule, ou revenez à votre activité\.$/.test(apresRefus.compteur),
      '[I] cliquer une formule refusee ne la coche pas, fait battre sa raison, et la barre dit quoi faire', JSON.stringify(apresRefus));
    // Dans une carte role="radio", une region vivante ne parle pas : la raison
    // passe par la seule voix du formulaire, mot pour mot.
    ok(await attendre(pageV, () => { const r = document.querySelector('#gridFor .fg-card--formule[data-formule="ffm"] .fg-for__off'); return Boolean(r) && !r.hasAttribute('role') && document.querySelector('#fgLive').textContent === r.textContent.trim(); }, 5000),
      '[I] toucher une formule refusee dit sa raison, une seule voix', await pageV.evaluate(() => document.querySelector('#fgLive').textContent));
    // Une formule valable se choisit et mene aux heures.
    await pageV.click('#gridFor .fg-card--formule[data-formule="f1"]');
    ok(await attendre(pageV, () => document.querySelector('#gridFor .fg-card--formule[data-formule="f1"]').getAttribute('aria-checked') === 'true' && !document.querySelector('#goHours').disabled, 3000),
      '[I] une formule valable se coche et ouvre la suite');
    const reponseF = pageV.waitForResponse((r) => r.url().indexOf('/api/public-availability?') >= 0, { timeout: 25000 }).catch(() => null);
    await pageV.click('#goHours');
    ok(await attendre(pageV, () => document.querySelectorAll('#hourZone .fg-chip').length > 0 && !document.querySelector('#hourZone').classList.contains('is-busy'), 25000),
      '[I] et la FORMULE 1 trouve des heures ce samedi');
    // UNE FORMULE N A PAS D HEURE PAR LIGNE (« a votre rythme ») : le
    // recapitulatif garde l heure de debut envoyee, sinon aucune heure de
    // debut n y serait plus dite.
    const rF = await reponseF;
    let dF = {};
    try { dF = rF ? await rF.json() : {}; } catch (error) { dF = {}; }
    const heureF = ((dF.slots || [])[0] || {}).time || '';
    ok(Boolean(heureF) && await attendre(pageV, () => !document.querySelector('#goContact').disabled, 25000), '[I] (prerequis) la formule a un creneau retenu', heureF || 'aucun');
    await pageV.click('#goContact');
    await attendre(pageV, () => document.querySelector('.fg-scene[data-scene="contact"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000);
    await pageV.fill('#cPrenom', 'Formule'); await pageV.fill('#cNom', 'Debut'); await pageV.fill('#cEmail', 'qa@example.com'); await pageV.fill('#cTel', '0471234567');
    await pageV.click('#occasions .fg-occasion[data-occasion="entreprise"]');
    await pageV.check('#cConsent');
    await pageV.click('#goRecap');
    ok(await attendre(pageV, () => document.querySelector('.fg-scene[data-scene="recap"].is-active'), 6000), '[I] la formule va jusqu au recapitulatif');
    await passerLaVitrine(pageV);
    const quiF = await pageV.evaluate(() => (Array.from(document.querySelectorAll('#recap p.fg-recap__detail')).map((n) => n.textContent.replace(/\s+/g, ' ').trim()).find((t) => /Au nom de/.test(t)) || ''));
    ok(Boolean(heureF) && quiF.indexOf(`Début de la visite à ${heureF}Au nom de Formule Debut`) === 0, '[I] une formule garde au recapitulatif l heure de debut envoyee', `« ${quiF} » attendait le debut a ${heureF}`);
    // Retour aux heures de la FORMULE 1 par le lien du recapitulatif : la
    // suite part de cet ecran.
    await pageV.click('.fg-scene.is-active .fg-edit [data-goto="heures"]');
    // UNE REPONSE NE SERT QU A LA DEMANDE QUI L A PRODUITE. Changer d onglet ne
    // vide rien : Continuer doit redemander les heures du mode choisi, et une
    // reponse des activites arrivee apres le passage aux formules ne sert
    // jamais la formule (sinon le plan, le prix et le libelle du Fun Run
    // partaient sous le nom de la FORMULE 1).
    await surHeures();
    await pageV.click('.fg-scene.is-active [data-back]'); await surEcran2();
    await pageV.click('#tabAct'); await attendre(pageV, () => !document.querySelector('#panelAct').hidden, 3000);
    let nV = demandesV.length;
    await pageV.click('#goHours');
    ok(await demandeApres(nV, (q) => q.get('type') === 'visite', 10000), '[I] formule chargee, onglet Activites : Continuer redemande les heures des ACTIVITES');
    ok(await attendre(pageV, () => document.querySelector('#planZone .fg-visit') && !document.querySelector('#hourZone').classList.contains('is-busy'), 25000), '[I] et la visite du Fun Run s affiche');
    await surHeures();
    await pageV.click('.fg-scene.is-active [data-back]'); await surEcran2();
    await pageV.click('#tabFor'); await attendre(pageV, () => !document.querySelector('#panelFor').hidden, 3000);
    nV = demandesV.length;
    await pageV.click('#goHours');
    ok(await demandeApres(nV, (q) => q.get('type') === 'formule' && q.get('formuleId') === 'f1', 10000), '[I] retour a la FORMULE 1 : Continuer redemande ses heures, le plan et le prix du Fun Run ne passent jamais sous son nom');
    await attendre(pageV, () => document.querySelectorAll('#hourZone .fg-chip').length > 0 && !document.querySelector('#hourZone').classList.contains('is-busy'), 25000);
    // La reponse des activites retenue en vol pendant le passage aux formules.
    let lacher = null;
    const retenue = (u) => u.pathname === '/api/public-availability' && u.searchParams.get('type') === 'visite';
    await pageV.route(retenue, async (route) => { await new Promise((r) => { lacher = r; setTimeout(r, 15000); }); await route.continue(); });
    await surHeures();
    await pageV.click('.fg-scene.is-active [data-back]'); await surEcran2();
    await pageV.click('#tabAct'); await attendre(pageV, () => !document.querySelector('#panelAct').hidden, 3000);
    await pageV.click('#goHours');
    for (let k = 0; k < 50 && !lacher; k += 1) await dormir(100);
    const retenueVue = Boolean(lacher) && await surHeures();
    await pageV.click('.fg-scene.is-active [data-back]'); await surEcran2();
    await pageV.click('#tabFor'); await attendre(pageV, () => !document.querySelector('#panelFor').hidden, 3000);
    if (lacher) lacher();
    const atterrie = await attendre(pageV, () => !document.querySelector('#hourZone').classList.contains('is-busy'), 10000);
    await pageV.unroute(retenue);
    ok(retenueVue && atterrie, 'MONTAGE [I] la reponse des activites est retenue pendant le passage a l onglet Formules, puis atterrit');
    nV = demandesV.length;
    await pageV.click('#goHours');
    ok(await demandeApres(nV, (q) => q.get('type') === 'formule' && q.get('formuleId') === 'f1', 10000), '[I] une reponse des activites arrivee apres le passage aux formules ne sert jamais la FORMULE 1');

    // --- Un jour sans horaire n est plus une impasse -----------------------
    // La route rend « aucun horaire » (forcee) : c est l ECRAN qui est mesure.
    // Avant : deux avis identiques (celui des pistes, celui du plan) et aucune
    // sortie hors du fil des etapes, loin en haut.
    // L ecran des heures d abord arrive : pendant sa transition (0,42 s),
    // aller() ignore un retour, et le clic se perdait sur une machine rapide.
    await surHeures();
    await pageV.click('.fg-scene.is-active [data-back]');
    ok(await attendre(pageV, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000), '[I] retour aux formules');
    const routeDispo = (u) => u.pathname === '/api/public-availability';
    const MSG_VIDE = 'Aucun horaire disponible ce jour-là.';
    await pageV.route(routeDispo, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, slots: [], message: MSG_VIDE }) }));
    // Decocher puis recocher : la reponse gardee est oubliee (invaliderDispo),
    // sinon l ecran des heures reprendrait l ancienne sans rien demander.
    const retoucherF1 = async () => {
      await pageV.click('#gridFor .fg-card--formule[data-formule="f1"]');
      await pageV.click('#gridFor .fg-card--formule[data-formule="f1"]');
      return attendre(pageV, () => document.querySelector('#gridFor .fg-card--formule[data-formule="f1"]').getAttribute('aria-checked') === 'true' && !document.querySelector('#goHours').disabled, 3000);
    };
    await retoucherF1();
    await pageV.click('#goHours');
    ok(await attendre(pageV, () => document.querySelector('#planZone .fg-notice') && !document.querySelector('#hourZone').classList.contains('is-busy'), 25000), 'MONTAGE [I] un jour sans horaire : l ecran des heures repond');
    const vide = await pageV.evaluate((msg) => {
      const z = document.querySelector('#hourZone');
      return {
        avis: z.querySelectorAll('.fg-notice').length,
        pistes: z.querySelectorAll('.fg-track').length,
        fois: z.textContent.split(msg).length - 1,
        date: Boolean(z.querySelector('[data-goto="date"]')),
        activites: ((z.querySelector('[data-goto="activites"]') || {}).textContent || '').trim(),
        resetTout: Boolean(z.querySelector('[data-reset-tout]')),
        hauteurs: Array.from(z.querySelectorAll('.fg-suggest__btn')).map((b) => Math.round(b.getBoundingClientRect().height * 10) / 10),
      };
    }, MSG_VIDE);
    ok(vide.avis === 1 && vide.pistes === 0 && vide.fois === 1 && vide.date && vide.activites === 'Changer de formule' && !vide.resetTout && vide.hauteurs.length === 2 && vide.hauteurs.every((h) => h >= 44),
      '[I] un jour sans horaire : un seul avis, et deux sorties de 44 px (jour ou groupe, formule)', JSON.stringify(vide));
    ok(await attendre(pageV, (msg) => document.querySelector('#fgLive').textContent.indexOf(msg) === 0, 5000, MSG_VIDE),
      '[I] et la voix (#fgLive) dit cet avis', await pageV.evaluate(() => document.querySelector('#fgLive').textContent));
    const versDate = await pageV.$('#hourZone [data-goto="date"]');
    // Sans cette sortie, le fil des etapes ramene quand meme a l ecran 1 : la
    // suite du parcours reste mesuree.
    if (versDate) await versDate.click(); else await pageV.click('.fg-scene.is-active .fg-steps [data-goto="date"]');
    ok(Boolean(versDate) && await attendre(pageV, () => document.querySelector('.fg-scene[data-scene="date"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000),
      '[I] « Changer de jour ou de groupe » ramene a l ecran 1');
    await attendre(pageV, () => document.querySelector('.fg-scene[data-scene="date"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000);
    // --- Une panne se dit a la voix, avec le texte de son avis -------------
    await pageV.unroute(routeDispo);
    const MSG_PANNE = 'Planning injoignable pour ce test.';
    await pageV.route(routeDispo, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, message: MSG_PANNE }) }));
    await pageV.click('#goActivities');
    await attendre(pageV, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000);
    await retoucherF1();
    await pageV.click('#goHours');
    ok(await attendre(pageV, (msg) => { const n = document.querySelector('#hourZone .fg-notice'); return Boolean(n) && n.textContent.indexOf(msg) >= 0 && document.querySelector('#fgLive').textContent === msg; }, 25000, MSG_PANNE),
      '[I] une panne des disponibilites se dit a la voix (#fgLive), avec le texte de son avis', await pageV.evaluate(() => `${(document.querySelector('#hourZone') || {}).textContent} / voix « ${document.querySelector('#fgLive').textContent} »`));
    await pageV.unroute(routeDispo);
    await vitrine.close();


    // =====================================================================
    console.log('');
    console.log('[J] LE TOUR DU 2026-09-23 : PHOTOS, COMPTEUR, FIL, ETIQUETTES, VAGUES, DUREE');
    // Movsar, 2026-09-23, en six points : « toute image mi-12 est a prohiber
    // prcq la c le centre davant » ; « pour le nombre de personne cest pas
    // aligne dans sa case » ; « le truc qui suit les etapes de 1 a 5, cest
    // moche » ; « le truc dans un rectangle avec bords ondule la ou c ecrit
    // lheure douverture, ca fait trop ia, et ya ce meme truc a plusieurs
    // endroit » ; « quand ya des grands groupes et quil faut scinder, rien
    // nest bien explique » ; « une heure approximatif de la totalite des
    // activites, bien calcule hein pas derreur ».
    // =====================================================================

    // --- Les photos, sur pieces (aucun navigateur) -----------------------
    // Le centre precedent s appelait mi12 : son mur « STRIKE TO SMILE » et ses
    // logos apparaissaient sur `pistes-strike`, servie sur le premier et le
    // dernier ecran. Cette liste est la liste des INTERDITS : une photo qui y
    // entre ne doit plus etre citee NI exister.
    const PHOTOS_INTERDITES = ['pistes-strike'];
    const sourceHtml = fs.readFileSync(path.join(ROOT, 'fungalaxy.html'), 'utf8');
    const sourceCss = fs.readFileSync(path.join(ROOT, 'assets', 'fungalaxy-booking.css'), 'utf8');
    const sourceJs = fs.readFileSync(path.join(ROOT, 'assets', 'fungalaxy-booking.js'), 'utf8');
    const citees = PHOTOS_INTERDITES.filter((nom) => (sourceHtml + sourceCss + sourceJs).indexOf(nom) >= 0);
    ok(citees.length === 0, '[J] aucune photo de l ancien centre n est citee par la page, sa feuille ou son script', citees.join(', ') || `aucune (${PHOTOS_INTERDITES.length} interdite(s) surveillee(s))`);
    const survivantes = PHOTOS_INTERDITES
      .flatMap((nom) => ['800', '1600'].map((w) => `assets/fungalaxy/${nom}-${w}.webp`))
      .filter((rel) => fs.existsSync(path.join(ROOT, rel)));
    ok(survivantes.length === 0, '[J] et ses fichiers ne sont plus dans le depot', survivantes.join(', ') || 'aucun');
    // Les photos de chaque centre, leur preuve et leur cadre : section [K].

    // --- Le compteur, le fil, les etiquettes ------------------------------
    const tour = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pageJ = await tour.newPage();
    suivreJeton(pageJ);
    const demandesJ = [];
    pageJ.on('request', (r) => demandesJ.push(r.url()));
    // Ce tour reserve EN LIGNE un groupe de 40 (le laser s y scinde) : c est
    // le cas d un centre SANS seuil de demande sur mesure. Le catalogue servi a
    // cette page le dit (fromPax null) ; a Libramont, 40 personnes partent vers
    // la demande (sur-mesure-check).
    await pageJ.route('**/api/public-booking-meta*', async (route) => {
      const reponse = await route.fetch();
      const j = await reponse.json();
      if (j && j.center) j.center.customRequest = { fromPax: null };
      await route.fulfill({ response: reponse, json: j });
    });
    await pageJ.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    ok(await attendre(pageJ, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000), '[J] le catalogue est lu');

    // LE COMPTEUR. La regle : le champ prend la largeur de SON nombre, et
    // l encre tombe au milieu de la case. Avant, le champ faisait 3,2 em avec
    // un texte cale a droite : les deux em de vide restaient A GAUCHE du
    // chiffre. Depuis le 2026-09-29 la case ne porte QUE le nombre (Movsar :
    // « met pas personne dans la case laisse juste le chiffre modifiable et le
    // + et - ») : l encre, c est le champ seul, et rien d autre ne s y voit.
    const mesurerPax = () => pageJ.evaluate(() => {
      const val = document.querySelector('#paxValue').getBoundingClientRect();
      const inp = document.querySelector('#paxInput');
      const ri = inp.getBoundingClientRect();
      // Tout ce que la case montre en plus du champ (le texte pour lecteur
      // d ecran reste, il ne se voit pas).
      const enTrop = Array.from(document.querySelectorAll('#paxValue > *')).filter((e) => e !== inp && !e.classList.contains('sr-only') && e.getBoundingClientRect().width > 0).map((e) => e.className || e.tagName);
      // La largeur d un chiffre, mesuree dans la POLICE du champ : c est
      // l unite « ch » que le script utilise. Le raccourci `font` ne sert a
      // RIEN ici : sur un champ dont `font-variant-numeric` n est pas normal,
      // le navigateur le serialise vide, la regle retombait sur la police du
      // corps (16 px au lieu de 20) et mesurait 11,2 px la ou le champ compte
      // 13,6. On copie donc chaque propriete, et on laisse le navigateur
      // resoudre « 1ch » lui-meme.
      const regle = document.createElement('div');
      const cs = getComputedStyle(inp);
      ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariantNumeric', 'letterSpacing'].forEach((k) => { regle.style[k] = cs[k]; });
      regle.style.position = 'absolute';
      regle.style.visibility = 'hidden';
      regle.style.width = '1ch';
      document.body.appendChild(regle);
      const ch = regle.getBoundingClientRect().width;
      regle.remove();
      return {
        chiffres: String(inp.value).length,
        largeur: ri.width,
        ch,
        enTrop,
        etiquette: document.querySelector('label[for="paxInput"]').textContent.trim(),
        ecart: ((ri.left + ri.right) / 2) - ((val.left + val.right) / 2),
        // LA HAUTEUR AUSSI (Movsar, 2026-09-23, capture a l appui : « le truc
        // pour les personnes c est super mal cadre »). Le tour precedent ne
        // mesurait que la largeur : le nombre etait centre de gauche a droite,
        // et COLLE EN HAUT de sa case. Son milieu doit etre celui de la case.
        ecartV: ((ri.top + ri.bottom) / 2) - ((val.top + val.bottom) / 2),
      };
    });
    for (const [n, largeurFenetre] of [[1, 1440], [12, 768], [240, 375]]) {
      await pageJ.setViewportSize({ width: largeurFenetre, height: 900 });
      await pageJ.fill('#paxInput', String(n));
      await attendre(pageJ, () => document.querySelector('#paxInput').getAnimations().length === 0, 2000);
      await dormir(120);
      const m = await mesurerPax();
      ok(m.chiffres === String(n).length && Math.abs(m.largeur - (m.chiffres + 0.3) * m.ch) <= 1.5,
        `[J] a ${n} personne(s) sur ${largeurFenetre} px, le champ fait la largeur de son nombre`,
        `${Math.round(m.largeur * 10) / 10} px pour ${m.chiffres} chiffre(s) de ${Math.round(m.ch * 10) / 10} px`);
      ok(Math.abs(m.ecart) <= 1,
        `[J] et son encre tombe au milieu de la case en largeur (ecart ${Math.round(m.ecart * 10) / 10} px)`);
      ok(Math.abs(m.ecartV) <= 1.5,
        `[J] ET en hauteur : le nombre est centre dans sa case (ecart ${Math.round(m.ecartV * 10) / 10} px)`);
      ok(m.enTrop.length === 0 && m.etiquette === 'Nombre de joueurs',
        `[J] la case ne montre que le nombre, sous « Nombre de joueurs »`, m.enTrop.length ? `en trop : ${m.enTrop.join(', ')}` : m.etiquette);
    }
    await pageJ.setViewportSize({ width: 1440, height: 900 });
    await pageJ.fill('#paxInput', '40');
    await pageJ.press('#paxInput', 'Enter');

    // LA BARRE DES ETAPES (Movsar, 2026-09-23 : « ta barre elle fait trop IA,
    // fais un truc plus anime, plus pro »). Les regles : un segment REMPLI par
    // etape atteinte, la longueur remplie EST la progression ; dans une
    // colonne large, les cinq libelles ; dans une colonne etroite, l etape en
    // cours et son rang « 01/05 », sinon « Creneaux » tout seul ne dit plus ou
    // on en est ; le mouvement suit un changement d ecran, jamais une boucle.
    const lireFil = () => pageJ.evaluate(() => {
      const scene = document.querySelector('.fg-scene.is-active');
      const items = Array.from(scene.querySelectorAll('.fg-steps__item'));
      const actif = scene.querySelector('.fg-steps__item.is-active');
      const vu = (el) => Boolean(el) && getComputedStyle(el).display !== 'none';
      const num = actif && actif.querySelector('.fg-steps__num');
      const of = actif && actif.querySelector('.fg-steps__of');
      const apres = (li) => getComputedStyle(li.querySelector('.fg-steps__seg'), '::after');
      return {
        libelles: items.map((li) => li.querySelector('.lbl')).filter(vu).length,
        rang: of ? { texte: `${num ? num.textContent : ''}${of.textContent}`, vu: vu(of) && vu(num) } : null,
        remplis: items.map((li) => (/^matrix\(1, /.test(apres(li).transform) ? '1' : '0')).join(''),
        boucles: items.filter((li) => apres(li).animationIterationCount === 'infinite').length,
      };
    });
    // Le contraste au pire moment, controle par ensemble de textes.
    const lisibles = async (sel, label) => {
      // AU REPOS, comme en [L] : mesuree pendant une cascade d entree, une
      // heure a moitie arrivee se lit transparente (un menu qui venait de
      // s ouvrir : « 12:00 » a 1,34:1, puis chaque puce plus pale jusqu a
      // 1:1). Seules restent les animations sans fin (photo, halos).
      const repos = await attendre(pageJ, () => document.getAnimations().every((a) => a.playState !== 'running' || a.effect.getComputedTiming().iterations === Infinity), 8000);
      const m = await contrastesPires(pageJ, sel);
      const faibles = m.filter((x) => x.ratio < x.seuil);
      ok(repos && m.length > 0 && faibles.length === 0, label,
        (repos ? '' : 'PAS AU REPOS : ') + (faibles.map((x) => `« ${x.texte} » ${x.ratio}:1 < ${x.seuil} (pixels ${x.pixels}${x.halo === null ? ', sur photo' : `, halo ${x.halo}`})`).join(' ; ')
        || `${m.length} textes, le plus faible a ${Math.min(...m.map((x) => x.ratio)).toFixed(2)}:1 (${m.filter((x) => x.halo !== null).length} hors photo, pris aussi sous le coeur des halos)`));
      return m;
    };
    const filLarge = await lireFil();
    ok(filLarge.libelles === 5 && filLarge.rang && filLarge.rang.vu === false && filLarge.remplis === '10000' && filLarge.boucles === 0,
      '[J] sur 1440 px, a l etape 1 : un segment plein sur cinq, les cinq libelles lisibles, le rang tu, rien ne tourne en boucle', JSON.stringify(filLarge));
    await lisibles('.fg-scene.is-active .fg-steps__num, .fg-scene.is-active .fg-steps__of, .fg-scene.is-active .fg-steps__item .lbl',
      '[J] sur 1440 px, chaque numero et chaque libelle de la barre garde 4,5:1 au pire moment (halo le plus clair compris)');
    await pageJ.setViewportSize({ width: 375, height: 812 });
    await dormir(200);
    const filEtroit = await lireFil();
    ok(filEtroit.libelles === 1 && filEtroit.rang && filEtroit.rang.vu === true && filEtroit.rang.texte === '01/05' && filEtroit.remplis === '10000',
      '[J] sur 375 px, seule l etape en cours reste, avec son rang « 01/05 », et la barre dit toujours 1 sur 5', JSON.stringify(filEtroit));
    await lisibles('.fg-scene.is-active .fg-steps__num, .fg-scene.is-active .fg-steps__of, .fg-scene.is-active .fg-steps__item .lbl',
      '[J] sur 375 px, « 01/05 » et le libelle en cours gardent 4,5:1 au pire moment');
    await pageJ.setViewportSize({ width: 1440, height: 900 });

    // LES ETIQUETTES. La regle : plus aucune capsule teintee. La mesure se
    // prouve par un TEMOIN POSITIF : le bouton du bandeau, lui, EST une
    // capsule, et la meme mesure doit le voir.
    const capsules = await pageJ.evaluate(() => {
      const rayon = (el) => Math.max(...['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius']
        .map((k) => parseFloat(getComputedStyle(el)[k]) || 0));
      const opaque = (el) => { const c = getComputedStyle(el).backgroundColor; return c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)'; };
      const sonde = (classes) => {
        const n = document.createElement('div');
        n.className = classes;
        n.textContent = 'Réservation n° 12345';
        document.querySelector('.fg-scene.is-active .fg-scene__body').appendChild(n);
        const r = { rayon: rayon(n), fond: opaque(n) };
        n.remove();
        return r;
      };
      const cta = document.querySelector('.fg-top__cta');
      return {
        horaire: sonde('fg-sub__open'),
        etiquette: sonde('fg-tag fg-tag--ferie'),
        meilleurPrix: sonde('fg-for__best'),
        temoin: cta ? { rayon: rayon(cta), fond: opaque(cta) } : null,
      };
    });
    ok(capsules.temoin && capsules.temoin.rayon >= 100,
      '[J] TEMOIN POSITIF : la mesure voit bien une capsule (le bouton du bandeau)', capsules.temoin ? `${capsules.temoin.rayon} px de rayon` : 'aucun bouton');
    ['horaire', 'etiquette', 'meilleurPrix'].forEach((cle) => {
      ok(capsules[cle].rayon < 100 && capsules[cle].fond === false,
        `[J] l etiquette « ${cle} » n est plus une capsule teintee`, `rayon ${capsules[cle].rayon} px, fond ${capsules[cle].fond ? 'plein' : 'transparent'}`);
    });

    // --- Les vagues et la duree, sur un grand groupe ----------------------
    await pageJ.click('#dayBtn');
    ok(await allerAuMois(pageJ, mock.DATE), '[J] le mois du samedi du mock s affiche');
    await pageJ.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
    await pageJ.fill('#paxInput', '40');
    await pageJ.press('#paxInput', 'Enter');
    await pageJ.click('#goActivities');
    ok(await attendre(pageJ, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000), '[J] ecran 2 atteint a 40 personnes');
    // AVANCER : le segment atteint se REMPLIT, celui qu on quitte passe au blanc.
    const lireGestes = () => pageJ.evaluate(() => Array.from(document.querySelectorAll('.fg-scene.is-active .fg-steps__item')).map((li) => ({
      geste: ['is-filling', 'is-settling', 'is-draining', 'is-sweep'].filter((c) => li.classList.contains(c)).join('+'),
      anim: getComputedStyle(li.querySelector('.fg-steps__seg'), '::after').animationName,
    })));
    const avance = await lireGestes();
    ok(avance.map((x) => x.geste).join('|') === 'is-settling|is-filling|||' && avance[0].anim === 'fg-seg-settle' && avance[1].anim === 'fg-seg-fill',
      '[J] avancer d un ecran REMPLIT le segment atteint et blanchit celui qu on quitte', JSON.stringify(avance));
    ok(await barreEst(pageJ, '11000'), '[J] et la barre finit a deux segments pleins sur cinq');
    await pageJ.click('#gridAct .fg-card[data-activity="bowling"]');
    await pageJ.click('#gridAct .fg-card[data-activity="laser_game"]');
    // DEUX parties de laser : c est avec deux parties qu une heure peut
    // chevaucher SA PROPRE partie (le refus « pris »).
    await attendre(pageJ, () => { const t = document.querySelector('#gridAct li[data-activity="laser_game"] .fg-card__optin'); return Boolean(t) && t.getBoundingClientRect().height > 40; }, 3000);
    await pageJ.click('#gridAct li[data-activity="laser_game"] .fg-pill[data-valeur="2"]');
    ok(await attendre(pageJ, () => document.querySelector('#gridAct li[data-activity="laser_game"] .fg-pill[data-valeur="2"]').getAttribute('aria-checked') === 'true', 3000), '[J] le laser passe a 2 parties');
    const avantHeuresJ = demandesJ.length;
    await pageJ.click('#goHours');
    ok(await attendre(pageJ, () => document.querySelector('#planZone .fg-visit') && !document.querySelector('#hourZone').classList.contains('is-busy'), 25000), '[J] l ecran des heures repond pour le grand groupe');

    // L ORACLE : le plan que la route rend pour la demande que la page a
    // vraiment faite.
    const PROGRAMME_J = [{ activityId: 'bowling', duration: 1 }, { activityId: 'laser_game', games: 2 }];
    const demandeJ = demandesJ.slice(avantHeuresJ).filter((u) => u.indexOf('/api/public-availability?') >= 0).pop() || '';
    const qJ = demandeJ ? new URL(demandeJ).searchParams : new URLSearchParams();
    ok(qJ.get('program') === JSON.stringify(PROGRAMME_J) && qJ.get('pax') === '40',
      '[J] la page demande bien 40 personnes, bowling 1 h et 2 parties de laser', qJ.get('program') || 'aucune demande');
    const paramsJ = { centerId: 'libramont', date: mock.DATE, type: 'visite', pax: '40', softReserve: '1', program: JSON.stringify(PROGRAMME_J) };
    const dJ = await lireJson(`${BASE_URL}/api/public-availability?${new URLSearchParams(paramsJ)}`, pageJ);
    const planJ = ((dJ.slots || [])[0] || {}).opsPlan || {};
    await verifierPistes(dJ, {}, [], '[J] 40 PERSONNES SANS POSE : les pistes = la route, et l heure PROPOSEE n emporte rien : la demi-heure de son 2e groupe reste a prendre', pageJ);
    const vaguesOracle = (id) => {
      const blocs = (planJ.resourceBlocks || []).filter((b) => b && b.activityId === id && Number(b.groupWaveCount) > 1);
      if (!blocs.length) return null;
      const total = Math.max(...blocs.map((b) => Number(b.groupWaveCount) || 0));
      const tailles = [];
      for (let i = 1; i <= total; i += 1) {
        const bloc = blocs.find((b) => Number(b.groupWaveIndex) === i);
        if (bloc) tailles.push(Number(bloc.players) || 0);
      }
      return { total, tailles };
    };
    const oracleLaser = vaguesOracle('laser_game');
    const oracleBowling = vaguesOracle('bowling');
    ok(Boolean(oracleLaser) && oracleLaser.total > 1,
      '[J] MONTAGE : a 40 personnes, le moteur scinde bien le laser', oracleLaser ? `${oracleLaser.total} groupes de ${oracleLaser.tailles.join(', ')}` : 'aucune scission : le montage ne tient plus');
    ok(!oracleBowling,
      '[J] MONTAGE : et il ne scinde PAS le bowling (le temoin negatif existe)', oracleBowling ? `${oracleBowling.total} services` : 'un seul service');
    const notes = await pageJ.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('#hourZone .fg-track')).map((s) => [
      s.dataset.activity,
      { texte: (s.querySelector('.fg-track__waves') || {}).textContent || '', vu: Boolean(s.querySelector('.fg-track__waves')) && !s.querySelector('.fg-track__waves').hidden, rang: (s.querySelector('.fg-track__num') || {}).textContent || '' },
    ])));
    // LA SCISSION EN UNE PHRASE (Movsar, 2026-09-24 : les groupes, « trop
    // long, mal explique ») : le groupe entier, combien de groupes et leur
    // taille, lus dans le plan. L heure de chacun se lit sur les heures et
    // dans le bloc de la visite.
    const texteNote = ((notes.laser_game || {}).texte || '').replace(/\s+/g, ' ').trim();
    const taillesJ = oracleLaser && oracleLaser.tailles.length === oracleLaser.total ? ` ${taillesQa(oracleLaser.tailles)}` : '';
    const noteAttendueJ = `40 personnes, trop pour jouer tous ensemble : chaque partie se joue en ${oracleLaser ? oracleLaser.total : 0} groupes${taillesJ}, l’un après l’autre.`;
    ok(notes.laser_game && notes.laser_game.vu && Boolean(oracleLaser) && oracleLaser.total > 1 && texteNote === noteAttendueJ,
      '[J] la piste du laser DIT la scission du plan en une phrase : le groupe entier, combien de groupes et leur taille',
      `« ${texteNote} » attendait « ${noteAttendueJ} »`);
    ok(notes.bowling && notes.bowling.vu === false && notes.bowling.texte === '',
      '[J] et la piste du bowling, qui tient en une fois, ne dit rien', `« ${(notes.bowling || {}).texte}» visible=${(notes.bowling || {}).vu}`);
    ok(notes.bowling && notes.bowling.rang === '1' && notes.laser_game && notes.laser_game.rang === '2',
      '[J] chaque section porte son rang (1, 2), pour qu on les distingue', `${(notes.bowling || {}).rang} puis ${(notes.laser_game || {}).rang}`);
    // LE BLOC DE LA VISITE A 40 PERSONNES : chaque partie avec ses groupes
    // (combien, de quelle taille, a quelle heure part chacun), lus dans le plan.
    const oJ = lignePlan(dJ);
    const ecranJ = await lireEcranPlan(pageJ);
    const eJ = ecartsPlan(ecranJ, oJ);
    ok(eJ.length === 0 && Boolean(oJ) && oJ.parties.some((x) => x.groupes.length > 1),
      '[J] 40 PERSONNES : « votre visite » = la route, chaque partie avec ses groupes, leur taille et le depart de chacun',
      eJ.slice(0, 3).join(' ; ') || (ecranJ ? ecranJ.etapes.map((x) => `${x.t} ${x.nom} « ${x.detail} »`).join(' | ') : 'aucun bloc'));

    // LA DUREE TOTALE : l ecart des deux heures du plan, refait en Node.
    const arriveeJ = planJ.arrivalTime || '';
    const finJ = ((dJ.slots || [])[0] || {}).visitEndTime || planJ.endTime || '';
    const attendueDuree = dureeExacteQa(minutesEntreQa(arriveeJ, finJ));
    ok(minutesEntreQa(arriveeJ, finJ) > 0, '[J] MONTAGE : le plan a bien une arrivee et une fin', `${arriveeJ} -> ${finJ}`);
    const spanJ = await pageJ.evaluate(() => (document.querySelector('.fg-visit__span') || {}).textContent.replace(/\s+/g, ' ').trim() || '');
    ok(spanJ.indexOf(`${attendueDuree} sur place`) >= 0,
      '[J] le bloc de visite annonce la duree sur place, egale a fin moins arrivee', `« ${spanJ} » attendait « ${attendueDuree} sur place »`);

    // Et la meme duree au recapitulatif, par le meme chemin que le client.
    await pageJ.click('#goContact');
    ok(await attendre(pageJ, () => document.querySelector('.fg-scene[data-scene="contact"].is-active'), 6000), '[J] ecran 4 atteint');
    await pageJ.fill('#cPrenom', 'Duree');
    await pageJ.fill('#cNom', 'Totale');
    await pageJ.fill('#cEmail', 'qa@example.com');
    await pageJ.fill('#cTel', '0471234567');
    await pageJ.click('#occasions .fg-occasion[data-occasion="ecole"]');
    await pageJ.check('#cConsent');
    await pageJ.click('#goRecap');
    ok(await attendre(pageJ, () => document.querySelector('.fg-scene[data-scene="recap"].is-active'), 6000), '[J] ecran 5 atteint');
    await passerLaVitrine(pageJ);
    const ligneJ = await pageJ.evaluate(() => (Array.from(document.querySelectorAll('#recap .fg-recap__row')).map((n) => n.textContent.replace(/\s+/g, ' ').trim()).find((l) => /^Arrivée conseillée/.test(l)) || ''));
    ok(ligneJ.indexOf(`${attendueDuree} sur place`) >= 0,
      '[J] et le recapitulatif annonce exactement la meme duree', `« ${ligneJ} » attendait « ${attendueDuree} sur place »`);
    // LES GROUPES AU RECAPITULATIF (vu en prod le 2026-09-23 : « Debut 11:00 »,
    // et le 2e groupe tu) : le laser du grand groupe dit combien de groupes et
    // leur taille, par partie, lus dans le plan de la route.
    const grandJ = partiesQa(planJ).find((x) => x.id === 'laser_game' && x.groupes.length > 1);
    const attenduGroupesJ = grandJ ? `${texteGroupesQa(grandJ, false)} par partie` : '';
    const laserRecapJ = (((await lireRecap(pageJ, '#recap')) || {}).items || []).find((i) => i.nom === nomDe('laser_game')) || { detail: '' };
    ok(Boolean(grandJ) && laserRecapJ.detail.indexOf(attenduGroupesJ) >= 0,
      '[J] au recapitulatif, le laser du grand groupe dit combien de groupes et leur taille, par partie', `« ${laserRecapJ.detail} » attendait « ${attenduGroupesJ} »`);

    // --- La legende : moins de texte sur telephone ------------------------
    await pageJ.click('.fg-scene.is-active [data-back]');
    ok(await attendre(pageJ, () => document.querySelector('.fg-scene[data-scene="contact"].is-active'), 6000), '[J] retour a l ecran 4');
    // RECULER : le segment qu on quitte se VIDE.
    const recule = await lireGestes();
    ok(recule.map((x) => x.geste).join('|') === '||||is-draining' && recule[4].anim === 'fg-seg-drain',
      '[J] reculer d un ecran VIDE le segment qu on quitte', JSON.stringify(recule));
    ok(await barreEst(pageJ, '11110'), '[J] et la barre revient a quatre segments pleins sur cinq');
    await pageJ.click('.fg-scene.is-active [data-back]');
    ok(await attendre(pageJ, () => document.querySelector('.fg-scene[data-scene="heures"].is-active') && document.querySelector('.fg-legend'), 8000), '[J] retour a l ecran des heures');
    const lireLegende = () => pageJ.evaluate(() => {
      const l = document.querySelector('.fg-legend');
      const vu = (el) => el && getComputedStyle(el).display !== 'none' && el.offsetParent !== null;
      const cles = Array.from(l.querySelectorAll('.fg-legend__key i')).filter(vu).map((n) => n.textContent.trim());
      const consigne = (l.querySelector('.fg-legend__tip') || {}).textContent || '';
      // Le texte REELLEMENT lu. `innerText` et lui seul : il respecte
      // `display: none` ET il voit le texte NU. Une premiere version
      // assemblait les elements-feuilles ; la contre-epreuve `legende` sort
      // justement une glose de sa balise, le texte devenait un noeud de texte
      // nu dans un `<span>` qui, lui, avait un enfant : la sonde ne le voyait
      // plus et le verdict passait au vert sur un code casse.
      const lu = String(l.innerText || '').replace(/\s+/g, ' ').trim();
      return {
        cles,
        gloses: Array.from(l.querySelectorAll('.fg-legend__key em')).filter(vu).length,
        lu,
        // Ce que le telephone doit lire, et rien d autre : les trois mots
        // (Movsar, 2026-10-01 : « enormement de texte » ; la consigne ne se
        // lit plus qu en large). Ajouter du texte rend le gate rouge.
        attenduCourt: cles.join(' ').replace(/\s+/g, ' ').trim(),
        consigne: consigne.trim(),
        caracteres: lu.length,
      };
    });
    const legLarge = await lireLegende();
    ok(legLarge.cles.join('|') === 'Serré|Décale|Complet' && legLarge.gloses === 3,
      '[J] sur 1440 px, les trois cles portent leur glose', JSON.stringify(legLarge));
    await pageJ.setViewportSize({ width: 375, height: 812 });
    await dormir(250);
    const legEtroit = await lireLegende();
    ok(legEtroit.cles.join('|') === 'Serré|Décale|Complet'
      && legEtroit.gloses === 0
      && legEtroit.lu === legEtroit.attenduCourt
      && legEtroit.caracteres < legLarge.caracteres,
      '[J] sur 375 px, la legende ne porte PLUS QUE les trois mots',
      `« ${legEtroit.lu} » (${legEtroit.caracteres} caracteres contre ${legLarge.caracteres} en large)`);

    // --- L heure RETENUE emporte celle de son 2e groupe -------------------
    // Movsar, 2026-09-23 : « quand ya des groupes a scinder, ca doit montrer
    // que si tu prends une heure, y a l autre qui est reservee pour les autres
    // groupes ; tout doit etre explique ». Une partie de laser est retenue au
    // milieu de la journee : sa demi-heure suivante est au 2e groupe, la
    // demi-heure d avant chevaucherait sa propre partie, et le bowling qui la
    // croiserait devrait se deplacer.
    await pageJ.setViewportSize({ width: 1440, height: 900 });
    const libresJ = (ancresDe(dJ).find((a) => a.activityId === 'laser_game') || { times: [] }).times.filter((t) => t.ok !== false && !t.warning).map((t) => t.time);
    const LJ = libresJ[Math.floor(libresJ.length / 2)];
    ok(Boolean(LJ) && await poserEtAttendre(pageJ, 'laser_game', LJ), '[J] a 40 personnes, une partie de laser est retenue', LJ);
    const dLJ = await lireJson(`${BASE_URL}/api/public-availability?${new URLSearchParams(Object.assign({}, paramsJ, { preferredTimes: JSON.stringify({ laser_game: LJ }), laserGameTimes: JSON.stringify([LJ]) }))}`, pageJ);
    const laserLJ = ancresDe(dLJ).find((a) => a.activityId === 'laser_game') || { times: [] };
    const bowlingLJ = ancresDe(dLJ).find((a) => a.activityId === 'bowling') || { times: [] };
    const empLJ = emporteesQa(dLJ, laserLJ, [LJ]);
    const soiLJ = laserLJ.times.filter((t) => t.ok === false && t.code === 'anchor_overlap' && t.conflict && t.conflict.activityId === 'laser_game' && !empLJ[t.time]).map((t) => t.time);
    const soiPrenables = soiLJ.filter((h) => { const t = laserLJ.times.find((x) => x.time === h); return t && t.move && t.move.ok; });
    const decLJ = bowlingLJ.times.filter((t) => t.ok === false && t.code === 'anchor_overlap' && t.conflict && t.conflict.activityId === 'laser_game').map((t) => t.time);
    const plageLJ = plageQa(dLJ, 'laser_game', LJ);
    ok(Object.keys(empLJ).length > 0 && soiLJ.length > 0 && soiPrenables.length > 0 && decLJ.length > 0 && Boolean(plageLJ),
      '[J] MONTAGE : la route rend une heure de 2e groupe, un chevauchement du laser avec sa propre partie dont le moteur accepte le DEPLACEMENT (`move`), et des heures de bowling qui le croisent',
      JSON.stringify({ laser: LJ, groupe2: Object.keys(empLJ), soi: soiLJ, deplacables: soiPrenables, decale: decLJ, plage: plageLJ }));
    const pistesLJ = await verifierPistes(dLJ, { laser_game: LJ }, [LJ],
      '[J] LASER RETENU : les pistes = la route ; l heure du 2e groupe est a vous, le chevauchement avec sa propre partie la DEPLACE (verdict du moteur), le bowling qui croise « decale », et chaque heure qui coince s explique sous sa plage', pageJ);
    // PLUS AUCUN « PRIS » QUI NE SE PREND PAS (Movsar, 2026-09-24 : « le truc
    // qui dit pris et qui est impossible a prendre, c est con, c est mal
    // fait ») : la case dit quelle partie elle deplace et vers ou, porte le
    // verdict du moteur sur ce deplacement, et se prend quand il le permet.
    const casesSoi = ((pistesLJ.find((p) => p.id === 'laser_game') || { chips: [] }).chips).filter((c) => soiLJ.indexOf(c.t) >= 0);
    ok(casesSoi.length === soiLJ.length && casesSoi.every((c) => c.mot !== 'pris' && c.replaces === LJ && c.titre.indexOf(`votre partie 1 (${LJ}) à ${c.t}`) >= 0)
      && casesSoi.filter((c) => soiPrenables.indexOf(c.t) >= 0).every((c) => c.ok),
      '[J] l heure qui chevaucherait sa propre partie la DEPLACE : la case le dit, porte le verdict du moteur et se prend', casesSoi.map((c) => `${c.t} « ${c.mot} » ${c.ok ? 'prenable' : 'refusee'} « ${c.titre} »`).join(' | '));
    const lignesDecale = (pistesLJ.find((p) => p.id === 'bowling') || { periodes: [] }).periodes.reduce((acc, x) => acc.concat(x.raisons), []).filter((r) => r.etat === 'shift');
    const nomLaser = String(laserLJ.label || 'Laser Game').toLowerCase();
    ok(lignesDecale.length > 0 && lignesDecale.every((r) => r.texte.indexOf(`(${plageLJ})`) >= 0 && r.texte.toLowerCase().indexOf(nomLaser) >= 0),
      '[J] le bowling qui croiserait dit l activite qui bougerait ET la plage reelle qu elle occupe, 2e groupe compris', lignesDecale.map((r) => `« ${r.texte} »`).join(' '));
    // TOUCHER L HEURE DU 2e GROUPE LA CHOISIT (Movsar, 2026-09-23 : « faut
    // qu ils puissent cliquer quand meme pour changer, mais que ca reste
    // marque pour montrer les autres groupes ») : le 1er groupe part a cette
    // heure, le 2e le suit. Une partie posee sur deux : le moteur n a pas juge
    // ce depart (il AJOUTERAIT une partie), l heure se prend.
    const hGroupe2 = Object.keys(empLJ)[0];
    const groupe2 = empLJ[hGroupe2] || {};
    // L heure du 2e groupe porte le nom de SA partie, sans ligne en plus sous
    // la plage (son nom et sa plage suffisent), et se prend.
    const caseGroupe2 = ((pistesLJ.find((p) => p.id === 'laser_game') || { chips: [] }).chips).find((c) => c.t === hGroupe2) || {};
    ok(caseGroupe2.etat === 'wave' && caseGroupe2.mot === 'partie 1' && caseGroupe2.ok && caseGroupe2.decrit === ''
      && caseGroupe2.titre.indexOf(`Votre partie 1 joue de ${plageLJ} (${groupe2.rang}e groupe à ${hGroupe2}).`) === 0 && caseGroupe2.titre.indexOf(`La toucher la fait partir à ${hGroupe2}`) >= 0,
      '[J] l heure du 2e groupe porte le nom de sa partie (« partie 1 »), dit quand elle joue et que la toucher l y fait partir', `${hGroupe2} « ${caseGroupe2.mot} » « ${caseGroupe2.titre} »`);
    // TOUCHER L HEURE QUI CHEVAUCHAIT SA PARTIE LA DEPLACE : la partie part a
    // l heure touchee, rien ne s ajoute.
    const hSoi = soiPrenables[0];
    const avantSoi = demandesJ.length;
    ok(Boolean(hSoi) && await poserEtAttendre(pageJ, 'laser_game', hSoi), '[J] toucher une heure qui chevauchait sa propre partie recalcule', hSoi);
    const qSoi = new URL(demandesJ.slice(avantSoi).filter((u) => u.indexOf('/api/public-availability?') >= 0).pop() || `${BASE_URL}/`).searchParams;
    ok(qSoi.get('laserGameTimes') === JSON.stringify([hSoi]) && JSON.parse(qSoi.get('preferredTimes') || '{}').laser_game === hSoi,
      '[J] la partie PART a l heure touchee : elle se deplace, rien ne s ajoute', `${qSoi.get('laserGameTimes')} / ${qSoi.get('preferredTimes')}`);
    // Retour a l etat d avant : la main rendue a l equipe, puis la partie
    // reposee a son heure.
    const rendueLJ = pageJ.waitForResponse((r) => r.url().indexOf('/api/public-availability?') >= 0, { timeout: 25000 }).catch(() => null);
    await pageJ.click('#hourZone [data-reset="laser_game"]');
    ok(Boolean(await rendueLJ) && await attendre(pageJ, () => !document.querySelector('#hourZone').classList.contains('is-busy'), 25000) && await poserEtAttendre(pageJ, 'laser_game', LJ),
      '[J] la partie est reposee a son heure d avant', LJ);
    const avantGroupe2 = demandesJ.length;
    ok(await poserEtAttendre(pageJ, 'laser_game', hGroupe2), '[J] toucher l heure du 2e groupe recalcule', hGroupe2);
    const qG2 = new URL(demandesJ.slice(avantGroupe2).filter((u) => u.indexOf('/api/public-availability?') >= 0).pop() || `${BASE_URL}/`).searchParams;
    ok(qG2.get('laserGameTimes') === JSON.stringify([hGroupe2]) && JSON.parse(qG2.get('preferredTimes') || '{}').laser_game === hGroupe2,
      '[J] la partie SUIT son 1er groupe : elle part a l heure touchee, rien ne s ajoute', `${qG2.get('laserGameTimes')} / ${qG2.get('preferredTimes')}`);
    const dG2 = await lireJson(`${BASE_URL}/api/public-availability?${new URLSearchParams(Object.assign({}, paramsJ, { preferredTimes: JSON.stringify({ laser_game: hGroupe2 }), laserGameTimes: JSON.stringify([hGroupe2]) }))}`, pageJ);
    await verifierPistes(dG2, { laser_game: hGroupe2 }, [hGroupe2], '[J] 1er GROUPE DEPLACE : les pistes = la route ; l heure touchee est choisie, son 2e groupe se marque a la demi-heure suivante', pageJ);
    // DEUX PARTIES POSEES, la seconde juste apres la premiere. Toucher l heure
    // du 2e groupe de la plus tot la DEPLACERAIT : le moteur juge ce
    // deplacement et le refuse (elle chevaucherait la seconde partie). Celui
    // de la plus tardive, il l accepte.
    const laserG2 = ancresDe(dG2).find((a) => a.activityId === 'laser_game') || { times: [] };
    const P2 = (laserG2.times.find((t) => t.ok !== false && !t.warning && t.time > hGroupe2) || {}).time;
    ok(Boolean(P2) && await poserEtAttendre(pageJ, 'laser_game', P2), '[J] une seconde partie de laser est posee apres la premiere', P2);
    const partsJ = [hGroupe2, P2].sort();
    const dP2 = await lireJson(`${BASE_URL}/api/public-availability?${new URLSearchParams(Object.assign({}, paramsJ, { preferredTimes: JSON.stringify({ laser_game: partsJ[0] }), laserGameTimes: JSON.stringify(partsJ) }))}`, pageJ);
    const laserP2 = ancresDe(dP2).find((a) => a.activityId === 'laser_game') || { times: [] };
    const empP2 = emporteesQa(dP2, laserP2, partsJ);
    const jugees = Object.keys(empP2).filter((h) => empP2[h].depuis === partsJ[0]);
    const tardives = Object.keys(empP2).filter((h) => empP2[h].depuis === partsJ[1]);
    const verdictP2 = (h) => verdictQa(laserP2.times.find((x) => x.time === h) || {});
    const refusee = jugees.find((h) => verdictP2(h).ok === false);
    const tardivesOk = tardives.filter((h) => verdictP2(h).ok !== false);
    ok(Boolean(refusee) && tardivesOk.length > 0,
      '[J] MONTAGE : deux parties posees ; le moteur REFUSE de deplacer la plus tot a l heure de son 2e groupe et ACCEPTE de deplacer la plus tardive a la sienne', JSON.stringify({ parties: partsJ, jugees, tardives, refusee, tardivesOk }));
    await verifierPistes(dP2, { laser_game: partsJ[0] }, partsJ, '[J] DEUX PARTIES : les pistes = la route ; chaque heure de 2e groupe porte le verdict du deplacement de SA partie, le cadre dit « 2 heures choisies sur 2 »', pageJ);
    // Le depart refuse : la toucher ne demande rien ; elle eclaire SA partie
    // dans le cadre des parties, et la voix le dit.
    const avantRefus = demandesJ.length;
    await toucherHeure(pageJ, 'laser_game', refusee);
    const voixRefus = `${refusee} : votre partie 1 joue à cette heure.`;
    await attendre(pageJ, (v) => document.querySelector('#fgLive').textContent === v, 2000, voixRefus);
    const luRefus = await pageJ.evaluate((h) => {
      const c = document.querySelector(`#hourZone .fg-track[data-activity="laser_game"] .fg-chip[data-time="${h}"]`);
      return {
        eclaires: Array.from(document.querySelectorAll('#hourZone .is-lit')).map((l) => `${l.className.split(' ')[0]}#${l.dataset.partie || ''}`),
        mot: c ? c.querySelector('small').textContent : '', ok: c ? c.dataset.ok : '', titre: c ? c.getAttribute('title') || '' : '', voix: document.querySelector('#fgLive').textContent,
      };
    }, refusee);
    ok(lecturesNeuves(demandesJ, avantRefus).length === 0 && luRefus.ok === 'false' && luRefus.mot === 'partie 1'
      && luRefus.eclaires.join() === 'fg-parts__item#1' && luRefus.voix === voixRefus && luRefus.titre.indexOf(`La faire partir à ${refusee} est impossible`) >= 0,
      '[J] l heure du 2e groupe que le moteur refuse de deplacer reste marquee « partie 1 », ne se prend pas ; la toucher eclaire SA partie et le dit', JSON.stringify(luRefus));
    // Celle qu il accepte : la toucher fait partir la partie tardive a cette
    // heure ; la plus tot ne bouge pas.
    const hTardive = tardivesOk[0];
    const avantTardive = demandesJ.length;
    ok(await poserEtAttendre(pageJ, 'laser_game', hTardive), '[J] toucher l heure du 2e groupe de la partie tardive recalcule', hTardive);
    const qTardive = new URL(demandesJ.slice(avantTardive).filter((u) => u.indexOf('/api/public-availability?') >= 0).pop() || `${BASE_URL}/`).searchParams;
    const partsTardive = [partsJ[0], hTardive].sort();
    ok(qTardive.get('laserGameTimes') === JSON.stringify(partsTardive), '[J] seule la partie tardive suit son groupe, la plus tot reste', `${qTardive.get('laserGameTimes')} attendu ${JSON.stringify(partsTardive)}`);
    const dTardive = await lireJson(`${BASE_URL}/api/public-availability?${new URLSearchParams(Object.assign({}, paramsJ, { preferredTimes: JSON.stringify({ laser_game: partsTardive[0] }), laserGameTimes: JSON.stringify(partsTardive) }))}`, pageJ);
    await verifierPistes(dTardive, { laser_game: partsTardive[0] }, partsTardive, '[J] PARTIE TARDIVE DEPLACEE : les pistes = la route', pageJ);
    // LE 2e GROUPE DANS LA PLAGE SUIVANTE (vu en prod le 2026-09-23 : 11:30
    // retenue au laser, le 2e groupe a 12:00 dans l apres-midi repliee,
    // invisible). Retenue a la derniere demi-heure d une plage, la partie
    // emporte la premiere de la suivante : le menu de celle-ci le dit.
    const plus30 = (h) => { const [a, b] = h.split(':').map(Number); const m = a * 60 + b + 30; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
    const bordJ = libresJ.find((h) => periodeDe(h) !== periodeDe(plus30(h)));
    await pageJ.click('#hourZone [data-reset="laser_game"]');
    await attendre(pageJ, () => !document.querySelector('#hourZone').classList.contains('is-busy'), 25000);
    ok(Boolean(bordJ) && await poserEtAttendre(pageJ, 'laser_game', bordJ), '[J] MONTAGE : une partie de laser retenue a la derniere demi-heure d une plage', bordJ || `aucune heure libre en bord de plage (${libresJ.join(' ')})`);
    if (bordJ) {
      const dBord = await lireJson(`${BASE_URL}/api/public-availability?${new URLSearchParams(Object.assign({}, paramsJ, { preferredTimes: JSON.stringify({ laser_game: bordJ }), laserGameTimes: JSON.stringify([bordJ]) }))}`, pageJ);
      const laserBord = ancresDe(dBord).find((a) => a.activityId === 'laser_game') || { times: [] };
      const empBord = emporteesQa(dBord, laserBord, [bordJ]);
      const hBord = Object.keys(empBord).find((h) => periodeDe(h) !== periodeDe(bordJ));
      ok(Boolean(hBord), '[J] MONTAGE : son 2e groupe tombe dans la plage suivante', `${bordJ} emporte ${Object.keys(empBord).join(', ') || 'rien'}`);
      await verifierPistes(dBord, { laser_game: bordJ }, [bordJ], '[J] 2e GROUPE DANS LA PLAGE SUIVANTE : les pistes = la route, menus compris', pageJ);
      const menuBord = await pageJ.evaluate((nom) => {
        const sec = Array.from(document.querySelectorAll('#hourZone .fg-track[data-activity="laser_game"] .fg-period')).find((x) => (x.querySelector('.fg-period__name') || { textContent: '' }).textContent.trim().toLowerCase() === nom.toLowerCase());
        return sec ? { resume: sec.querySelector('.fg-period__sum').textContent.trim(), ouvert: sec.classList.contains('is-open') } : null;
      }, periodeDe(hBord || bordJ));
      ok(Boolean(hBord) && Boolean(menuBord) && menuBord.resume.indexOf(`partie 1 à ${hBord}`) === 0,
        '[J] le menu de cette plage, replie ou non, dit l heure de la partie (son 2e groupe)', JSON.stringify(menuBord));
    }
    await lisibles('.fg-legend__tip, .fg-legend__key i, .fg-legend__key em, #hourZone .fg-period.is-open .fg-why-list__item > span, #hourZone .fg-period.is-open .fg-why-list__item b, #hourZone .fg-period.is-open .fg-key, #hourZone .fg-period.is-open .fg-chip b, #hourZone .fg-period.is-open .fg-chip small, #hourZone .fg-parts__head span, #hourZone .fg-parts__head b, #hourZone .fg-parts__item > span, #hourZone .fg-parts__item > i, #hourZone .fg-track__waves',
      '[J] la legende, les heures ouvertes, leurs raisons, le cadre des parties et la note des groupes gardent 4,5:1 au pire moment (sur la photo la plus claire possible, voile compris)');
    await tour.close();

    // =====================================================================
    console.log('');
    console.log('[K] LES PHOTOS DU CENTRE, QUI TOURNENT');
    // Movsar, 2026-09-23 : « toutes les images que ca montre, hormis le choix
    // des activites, faut que ce soit des images de Fun Galaxy, des images
    // tournantes, pas tout le temps les memes : pour chaque nouvelle
    // reservation, pas que ca change pendant la resa ; que des images de
    // Libramont pour Libramont et de Gembloux pour Gembloux ; pour Gembloux il
    // y a aussi sur internet des images de mi12, fais gaffe de fou ».
    // =====================================================================
    // --- Sur pieces : la table du script ne cite que des photos PROUVEES ---
    const table = photosDuScript(sourceJs);
    const centresTable = Object.keys(table);
    ok(centresTable.join(',') === Object.keys(PROVENANCE).join(','), '[K] le script tient une table de photos pour les centres dont la provenance est prouvee, et pour eux seuls', centresTable.join(', ') || 'aucune table');
    const sansPreuve = centresTable.flatMap((c) => table[c].filter((x) => !(PROVENANCE[c] || {})[x.f]).map((x) => `${c}/${x.f}`));
    ok(sansPreuve.length === 0 && centresTable.every((c) => table[c].length === Object.keys(PROVENANCE[c] || {}).length),
      '[K] chaque photo de chaque centre a sa preuve (image d origine, page du site qui dit le centre), et chaque photo prouvee est servie',
      sansPreuve.join(', ') || centresTable.map((c) => `${c} ${table[c].length}`).join(', '));
    const origines = Object.values(PROVENANCE).flatMap((c) => Object.values(c));
    const avant = origines.filter((d) => { const m = /\/uploads\/(\d{4})\/(\d{2})\//.exec(d.origine); return !m || `${m[1]}-${m[2]}` < '2025-08' || /mi12/i.test(d.origine); });
    ok(avant.length === 0, '[K] chaque photo a ete envoyee apres l annonce du changement d enseigne (27 juillet 2025), aucune ne vient d un fichier mi12', avant.map((d) => d.origine).join(', ') || `${origines.length} photos, envoyees de 2025-08 a 2026-04`);
    const croisees = Object.keys(PROVENANCE.libramont).filter((f) => PROVENANCE.gembloux[f]);
    ok(croisees.length === 0, '[K] aucune photo n est commune a deux centres', croisees.join(', ') || 'aucune');
    const fautives = centresTable.flatMap((c) => table[c].map((x) => {
      const f800 = path.join(ROOT, 'assets', 'fungalaxy', `${x.f}-800.webp`);
      const f1600 = path.join(ROOT, 'assets', 'fungalaxy', `${x.f}-1600.webp`);
      const v = fs.existsSync(f1600) ? tailleWebp(f1600) : null;
      const v8 = fs.existsSync(f800) ? tailleWebp(f800) : null;
      if (!v || !v8) return `${x.f} absente en ${v ? '800' : '1600'}`;
      if (v.w !== 1600 || v.h !== x.h) return `${x.f} declaree 1600x${x.h}, fichier ${v.w}x${v.h}`;
      if (v.w <= v.h) return `${x.f} n est pas en paysage (${v.w}x${v.h})`;
      if (v8.w !== 800 || Math.abs(v8.w / v8.h - v.w / v.h) > 0.01) return `${x.f} en 800 : ${v8.w}x${v8.h}`;
      return '';
    })).filter(Boolean);
    ok(fautives.length === 0, '[K] chaque photo existe en 800 et en 1600, en paysage, et le cadre declare est la forme du fichier', fautives.join(' | ') || 'toutes');
    const nomsMi12 = fs.readdirSync(path.join(ROOT, 'assets', 'fungalaxy')).filter((n) => /mi12|strike/i.test(n));
    ok(nomsMi12.length === 0, '[K] aucun fichier de l ancienne enseigne parmi les photos servies', nomsMi12.join(', ') || 'aucun');

    // --- A l ecran : chaque centre ses photos, dans un ordre tire a chaque visite.
    // Le tirage est FORCE (Math.random constant) : deux visites, deux tirages
    // opposes, deux ordres qui doivent differer.
    for (const centre of ['libramont', 'gembloux']) {
      const ordres = [];
      for (const tirage of [0.01, 0.99]) {
        const ctxK = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        await ctxK.addInitScript((r) => { Math.random = () => r; }, tirage);
        const pk = await ctxK.newPage();
        await pk.goto(`${BASE_URL}/fungalaxy/${centre}`, { waitUntil: 'networkidle', timeout: 45000 });
        await attendre(pk, () => { const i = document.querySelector('.fg-scene.is-active .fg-art img'); return i && i.complete && i.naturalWidth > 0; }, 8000);
        const vus = await lirePhotosEcrans(pk);
        const premiere = await pk.evaluate(() => { const i = document.querySelector('.fg-scene.is-active .fg-art img'); return { charge: Boolean(i && i.complete && i.naturalWidth > 0), priorite: i ? i.getAttribute('fetchpriority') : '' }; });
        await ctxK.close();
        const ecartsK = [];
        if (vus.length !== 6) ecartsK.push(`${vus.length} ecrans`);
        vus.forEach((v, k) => {
          if (!(PROVENANCE[centre] || {})[v.photo]) ecartsK.push(`${v.scene} montre « ${v.photo || 'rien'} », sans preuve pour ${centre}`);
          const t = (table[centre] || []).find((x) => x.f === v.photo);
          if (t && (v.w !== 1600 || v.h !== t.h)) ecartsK.push(`${v.scene} declare ${v.w}x${v.h}`);
          if (k > 0 && vus[k - 1].photo === v.photo) ecartsK.push(`${vus[k - 1].scene} et ${v.scene} montrent la meme photo`);
        });
        const distinctes = new Set(vus.map((v) => v.photo)).size;
        if (distinctes !== Math.min(6, (table[centre] || []).length)) ecartsK.push(`${distinctes} photos distinctes sur 6 ecrans`);
        if (!premiere.charge || premiere.priorite !== 'high') ecartsK.push(`premiere photo ${premiere.charge ? 'chargee' : 'non chargee'}, priorite ${premiere.priorite}`);
        ok(ecartsK.length === 0, `[K] ${centre}, tirage ${tirage} : six ecrans, six photos PROUVEES de ${centre}, jamais la meme d un ecran au voisin, la premiere chargee en priorite`, ecartsK.slice(0, 3).join(' ; ') || vus.map((v) => v.photo).join(' > '));
        ordres.push(vus.map((v) => v.photo).join(' > '));
      }
      ok(ordres.length === 2 && ordres[0] !== ordres[1], `[K] ${centre} : l ordre des photos depend du tirage de la visite (elles tournent)`, ordres.join('  |  '));
    }
    // Un centre sans photo prouvee n en montre aucune, pas meme celles d un autre.
    const ctxC = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pc = await ctxC.newPage();
    const webpCiney = [];
    pc.on('request', (r) => { if (/\.webp/.test(r.url())) webpCiney.push(r.url()); });
    await pc.goto(`${BASE_URL}/fungalaxy/ciney`, { waitUntil: 'networkidle', timeout: 45000 });
    const vusCiney = await lirePhotosEcrans(pc);
    await ctxC.close();
    ok(vusCiney.length === 6 && vusCiney.every((v) => !v.photo) && webpCiney.length === 0, '[K] ciney, sans photo prouvee : aucune photo, ni la sienne ni celle d un autre centre', webpCiney.map((u) => u.split('/').pop()).join(', ') || 'aucune demandee');
    // Une adresse au nom d une propriete que porte tout objet ne fait pas
    // tomber la page, et ne montre aucune photo.
    const ctxP = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pp = await ctxP.newPage();
    const erreursP = [];
    pp.on('pageerror', (err) => erreursP.push(String(err && err.message || err)));
    await pp.goto(`${BASE_URL}/fungalaxy/constructor`, { waitUntil: 'networkidle', timeout: 45000 });
    const vusP = await lirePhotosEcrans(pp);
    await ctxP.close();
    ok(erreursP.length === 0 && vusP.length === 6 && vusP.every((v) => !v.photo), '[K] « /fungalaxy/constructor » (une propriete de tout objet) ne fait pas tomber la page et ne montre aucune photo', erreursP.slice(0, 2).join(' | ') || 'aucune erreur, aucune photo');

    // =====================================================================
    console.log('');
    console.log('[L] LISIBLE SUR N IMPORTE QUELLE PHOTO');
    // Les photos tournent et derivent : un texte pose dessus doit tenir sur la
    // plus claire qui puisse tomber. Mesure du 2026-09-23 avant correction :
    // « départ » a 1,3:1 et « confirmée » a 1,7:1 sur une photo blanche, le
    // bouton Retour a 2,8:1, le prix d une carte survolee a 3,3:1, « 8
    // formules » a 1,1:1. Chaque ecran est mesure en entier a quatre largeurs ;
    // un ecran pleine photo doit avoir des textes SUR la photo, sinon la
    // mesure ne prouve rien.
    // =====================================================================
    const LARGEURS_L = [[1440, 900], [1920, 1080], [1024, 768], [375, 812]];
    const ctxL = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pl = await ctxL.newPage();
    await pl.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    ok(await attendre(pl, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000), '[L] la page se monte, le jour propose est lu');
    let casTitreTotal = 0;
    const lisibleEcran = async (nom, plein) => {
      const faibles = [];
      const vus = [];
      let prerequis = true;
      const fautesTitre = [];
      let casTitre = 0;
      let policeTitre = true;
      for (const [w, h] of LARGEURS_L) {
        await pl.setViewportSize({ width: w, height: h });
        await dormir(300);
        // AU REPOS : les entrees en fondu (fg-rise, 0,55 s, echelonnees jusqu a
        // 0,6 s) finies. Mesure pendant le fondu, un texte a moitie
        // transparent se lisait trop pale (un prix de formule a 4,1:1, la
        // ligne de l e-mail a 4,2:1). Seules restent les animations sans fin
        // (derive de la photo, halos), qui ne touchent pas l opacite d un texte.
        if (!(await attendre(pl, () => document.getAnimations().every((a) => a.playState !== 'running' || a.effect.getComputedTiming().iterations === Infinity), 8000))) prerequis = false;
        const n = await pl.evaluate(() => {
          document.querySelectorAll('[data-qa-lisible]').forEach((el) => el.removeAttribute('data-qa-lisible'));
          let k = 0;
          document.querySelectorAll('.fg-scene.is-active .fg-scene__body *').forEach((el) => {
            let o = 1;
            for (let p = el; p && p.nodeType === 1; p = p.parentElement) o *= Number(getComputedStyle(p).opacity);
            // Invisible (opacite nulle) ou controle inactif : hors mesure.
            if (o < 0.1 || el.closest('button:disabled, [aria-disabled="true"]')) return;
            el.setAttribute('data-qa-lisible', '');
            k += 1;
          });
          return k;
        });
        const m = n ? await contrastesPires(pl, '[data-qa-lisible]') : [];
        const surPhoto = m.filter((x) => x.halo === null).length;
        if (!m.length || (plein && !surPhoto)) prerequis = false;
        vus.push(`${w} px ${m.length} textes, ${surPhoto} sur la photo`);
        m.filter((x) => x.ratio < x.seuil).forEach((x) => faibles.push(`${w} px « ${x.texte} » ${x.ratio}:1 < ${x.seuil}${x.halo === null ? ' sur photo' : ` (halo ${x.halo})`}`));
        // LES ACCENTS DU TITRE (2026-09-23, « CONFIRMEE » plantait son accent
        // dans le O de « RESERVATION ») : sous la premiere ligne, une ligne
        // qui porte une capitale accentuee se tient assez bas pour que
        // l accent, mesure dans la police meme, passe sous la ligne du dessus.
        const tq = await pl.evaluate(() => {
          const t = document.querySelector('.fg-scene.is-active .fg-title');
          if (!t) return { cas: 0, fautes: [], police: false };
          const cs = getComputedStyle(t);
          const fs = parseFloat(cs.fontSize);
          const police = Array.from(document.fonts).some((f) => /anton/i.test(f.family) && f.status === 'loaded');
          const cv = document.createElement('canvas').getContext('2d');
          cv.font = `${cs.fontWeight} 100px ${cs.fontFamily}`;
          const accent = cv.measureText('É').actualBoundingBoxAscent / 100;
          const lignes = [];
          t.querySelectorAll('.w').forEach((w) => {
            const bas = Math.round(w.getBoundingClientRect().bottom);
            let l = lignes.find((x) => Math.abs(x.bas - bas) <= 3);
            if (!l) { l = { bas, mots: [] }; lignes.push(l); }
            l.mots.push(w.textContent.toUpperCase());
          });
          lignes.sort((a, b) => a.bas - b.bas);
          const fautes = [];
          let cas = 0;
          for (let i = 1; i < lignes.length; i += 1) {
            if (!lignes[i].mots.some((x) => /[\u0300-\u030A]/.test(x.normalize('NFD')))) continue;
            cas += 1;
            const ecart = (lignes[i].bas - lignes[i - 1].bas) / fs;
            if (ecart < accent + 0.03) fautes.push(`« ${lignes[i].mots.join(' ')} » a ${ecart.toFixed(2)} em de la ligne du dessus, son accent monte a ${accent.toFixed(2)} em`);
          }
          return { cas, fautes, police };
        });
        if (!tq.police) policeTitre = false;
        casTitre += tq.cas;
        tq.fautes.forEach((f) => fautesTitre.push(`${w} px ${f}`));
      }
      await pl.setViewportSize({ width: 1440, height: 900 });
      await dormir(500);
      ok(prerequis && faibles.length === 0, `[L] ${nom} : chaque texte garde son seuil sur la photo la plus claire, a 1440, 1920, 1024 et 375 px`,
        faibles.slice(0, 4).join(' ; ') || (prerequis ? vus.join(' | ') : `MESURE A VIDE OU PAS AU REPOS : ${vus.join(' | ')}`));
      casTitreTotal += casTitre;
      ok(policeTitre && fautesTitre.length === 0, `[L] ${nom} : l accent d une capitale ne mord jamais la ligne du dessus du titre, a quatre largeurs`,
        fautesTitre.slice(0, 3).join(' ; ') || (policeTitre ? `${casTitre} ligne(s) accentuee(s) sous une autre` : 'POLICE DU TITRE NON CHARGEE : mesure sans objet'));
    };
    await lisibleEcran('date et groupe', false);
    // Le samedi du mock, jamais « aujourd hui » : le soir, les heures du jour
    // sont passees, l ecran des heures n a plus de plan et « Garder » reste
    // gris (rouge vu vers 20 h 45 le 2026-09-23, sur le code vert l apres-midi).
    await pl.click('#dayBtn');
    ok(await allerAuMois(pl, mock.DATE), '[L] le mois du samedi du mock s affiche');
    await pl.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
    ok(await attendre(pl, (l) => document.querySelector('#dayPop').hidden && document.querySelector('#dayLabel').textContent.trim() === l, 3000, jourLong(mock.DATE)), '[L] le samedi du mock est retenu', mock.DATE);
    await pl.click('#goActivities');
    await attendre(pl, () => document.querySelector('.fg-scene[data-scene="activites"].is-active'), 8000);
    await pl.click('#gridAct .fg-card[data-activity="bowling"]');
    await pl.click('#gridAct .fg-card[data-activity="laser_game"]');
    await lisibleEcran('activites (cartes survolees)', true);
    await pl.click('#tabFor');
    ok(await attendre(pl, () => !document.querySelector('#panelFor').hidden && document.querySelectorAll('#gridFor .fg-fam').length > 0, 8000), '[L] l onglet des formules s ouvre sur ses familles');
    await lisibleEcran('formules', true);
    await pl.click('#tabAct');
    await attendre(pl, () => !document.querySelector('#panelAct').hidden, 8000);
    // [R] UNE PANNE DES HORAIRES SE DIT EN FRANCAIS ET SE RATTRAPE : reseau
    // coupe, puis 504 en HTML (le corps n est pas du JSON), puis 429 avec le
    // message du serveur ; « Reessayer » relance le calcul avec le meme etat.
    const dispoR = (u) => u.pathname === '/api/public-availability';
    const REPLI_H = 'Les horaires ne se sont pas chargés. Réessayez dans un instant.';
    const panneR = () => pl.evaluate(() => { const b = document.querySelector('#hourZone .fg-notice b'); const r = document.querySelector('#hourZone [data-retry]'); return { texte: b ? b.textContent : '', haut: r ? Math.round(r.getBoundingClientRect().height) : 0, garder: document.querySelector('#goContact').disabled }; });
    const panneVue = () => attendre(pl, () => !document.querySelector('#hourZone').classList.contains('is-busy') && document.querySelector('#hourZone [data-retry]'), 15000);
    await ctxL.route(dispoR, (r) => r.abort());
    await pl.click('#goHours');
    ok(await panneVue(), '[R] reseau coupe : l ecran des heures dit la panne et propose Reessayer');
    let vuR = await panneR();
    ok(plat(vuR.texte) === plat(REPLI_H) && !ANGLAIS.test(vuR.texte) && vuR.haut >= 44 && vuR.garder, '[R] reseau coupe : le fait constate en francais, bouton de 44 px, Garder inactif', JSON.stringify(vuR));
    await lisibleEcran('heures (panne)', true);
    await ctxL.unroute(dispoR);
    await ctxL.route(dispoR, (r) => r.fulfill({ status: 504, contentType: 'text/html', body: '<html><body>504</body></html>' }));
    await pl.click('#hourZone [data-retry]');
    ok(await pl.evaluate(() => document.activeElement && document.activeElement.id === 't-hour'), '[R] Reessayer rend le focus au titre de l ecran');
    ok(await panneVue(), '[R] 504 en HTML : la panne se redit');
    vuR = await panneR();
    ok(plat(vuR.texte) === plat(REPLI_H) && !ANGLAIS.test(vuR.texte), '[R] 504 en HTML : meme texte francais', vuR.texte);
    await ctxL.unroute(dispoR);
    await ctxL.route(dispoR, (r) => r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ ok: false, message: 'Trop de requêtes. Merci de réessayer dans un instant.' }) }));
    await pl.click('#hourZone [data-retry]');
    ok(await panneVue(), '[R] 429 : la panne se redit');
    vuR = await panneR();
    ok(plat(vuR.texte) === plat('Trop de requêtes. Merci de réessayer dans un instant.'), '[R] 429 : le message du serveur passe tel quel', vuR.texte);
    await ctxL.unroute(dispoR);
    await pl.click('#hourZone [data-retry]');
    ok(await attendre(pl, () => document.querySelector('#planZone .fg-visit') && !document.querySelector('#hourZone').classList.contains('is-busy'), 25000), '[L] l ecran des heures se calcule');
    ok(await attendre(pl, () => !document.querySelector('#goContact').disabled, 5000), '[R] apres Reessayer, le plan revient et Garder redevient actif');
    await lisibleEcran('heures', true);
    await pl.click('#goContact');
    await attendre(pl, () => document.querySelector('.fg-scene[data-scene="contact"].is-active'), 8000);
    await pl.fill('#cPrenom', 'Lisible'); await pl.fill('#cNom', 'Photo'); await pl.fill('#cEmail', 'qa@example.com'); await pl.fill('#cTel', '0471234567');
    await pl.fill('#cNote', 'Gâteau à mettre au frais');
    // « Autre », avec sa precision : les deux voyagent (la cle, et la
    // precision jointe au mot pour l equipe).
    await pl.click('#occasions .fg-occasion[data-occasion="autre"]');
    await pl.fill('#cOccasionAutre', 'Départ à la retraite');
    await pl.check('#cConsent');
    await lisibleEcran('coordonnees', false);
    await pl.click('#goRecap');
    await attendre(pl, () => document.querySelector('.fg-scene[data-scene="recap"].is-active'), 8000);
    await passerLaVitrine(pl);
    await lisibleEcran('recapitulatif', false);
    await pl.click('#confirmBtn');
    ok(await attendre(pl, () => document.querySelector('.fg-scene[data-scene="fin"].is-active'), 15000), '[L] la reservation part, l ecran final s ouvre');
    const corpsL = mock.dernierePose.body || {};
    ok(corpsL.occasion === 'autre' && corpsL.notes === 'Occasion : Départ à la retraite. Gâteau à mettre au frais',
      '[L] « Autre » part en cle, sa precision rejoint le mot pour l equipe (notes)', JSON.stringify({ occasion: corpsL.occasion, notes: corpsL.notes }));
    await lisibleEcran('fin', true);
    ok(casTitreTotal > 0, 'MONTAGE [L] au moins un titre porte une capitale accentuee sous sa premiere ligne : la mesure des accents porte sur un vrai cas', `${casTitreTotal} cas`);
    // Le telephone et l e-mail du centre se TOUCHENT (tel:, mailto:), tires
    // du catalogue servi.
    const metaL = await lireJson(`${BASE_URL}/api/public-booking-meta?centerId=libramont`);
    const contactL = (metaL.center && metaL.center.contact) || {};
    const liensFin = await pl.evaluate(() => Array.from(document.querySelectorAll('#finBody a.fg-done__lien')).map((a) => [a.textContent.trim(), a.getAttribute('href')]));
    ok(Boolean(contactL.phone && contactL.email) && JSON.stringify(liensFin) === JSON.stringify([[contactL.phone, `tel:${String(contactL.phone).replace(/[^\d+]/g, '')}`], [contactL.email, `mailto:${contactL.email}`]]),
      '[L] ecran final : le telephone et l e-mail du centre se touchent (tel:, mailto:)', JSON.stringify({ liens: liensFin, contact: [contactL.phone, contactL.email] }));
    await ctxL.close();

    // =====================================================================
    console.log('');
    console.log('[M] /reserver/libramont : LE FORMULAIRE TEL QU IL SERAIT POSE SUR LE SITE DE FUN GALAXY');
    // Movsar, 2026-09-23 : « je veux que tu le push sur /reserver/libramont
    // aussi, et que les dimensions soient exactement comme si on devait le
    // mettre sur le site de Fun Galaxy, comme c etait en local avec leur
    // page ». La page (fungalaxy-site.html) monte le formulaire par embed.js,
    // la balise meme que l agence posera, dans le bloc de la copie locale de
    // leur page, sous leur en-tete refait a leurs mesures (capture de la
    // copie locale a 1440 px).
    // =====================================================================
    // La route telle que Vercel la lira : la premiere regle qui correspond
    // gagne, celle du centre doit donc passer AVANT la regle generique.
    const configM = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    if (CASSE === 'ordre') {
      const iA = configM.rewrites.findIndex((r) => r.source === '/reserver/libramont');
      const iB = configM.rewrites.findIndex((r) => r.source === '/reserver/:center');
      if (iA >= 0 && iB >= 0) { const t = configM.rewrites[iA]; configM.rewrites[iA] = configM.rewrites[iB]; configM.rewrites[iB] = t; }
    }
    const reglesM = (configM.rewrites || []).map((r) => r.source);
    const iSite = reglesM.indexOf('/reserver/libramont');
    const iGen = reglesM.indexOf('/reserver/:center');
    ok(iSite >= 0 && configM.rewrites[iSite].destination === '/fungalaxy-site.html' && iGen > iSite,
      '[M] vercel.json sert /reserver/libramont par fungalaxy-site.html, AVANT la regle generique /reserver/:center', `regle du centre en ${iSite}, regle generique en ${iGen}`);
    const listeBuild = /const PAGES = \[([^\]]*)\]/.exec(fs.readFileSync(path.join(ROOT, 'tools', 'build-public.js'), 'utf8'));
    const listeFuite = /const PAGES = \[([^\]]*)\]/.exec(fs.readFileSync(path.join(ROOT, 'scripts', 'public-leak-check.js'), 'utf8'));
    ok(Boolean(listeBuild && /'fungalaxy-site\.html'/.test(listeBuild[1]) && listeFuite && /'fungalaxy-site\.html'/.test(listeFuite[1])),
      '[M] la page est dans les listes du build public et du gate de fuite : ses commentaires ne partent pas en ligne');
    const LIENS_FG = [['Activités', 'https://fungalaxy.be/activites/'], ['Événements', 'https://fungalaxy.be/evenements/'], ['Formules', 'https://fungalaxy.be/formules/'], ['Contact', 'https://fungalaxy.be/contact/']];
    const lireSite = (p) => p.evaluate(() => {
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top + scrollY), w: Math.round(b.width), h: Math.round(b.height) }; };
      const vu = (el) => Boolean(el) && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
      const cadre = document.querySelector('#booking .pinlane-slot iframe');
      const centre = document.querySelector('.fgs-top > .fgs-centre');
      const cta = document.querySelector('.fgs-cta');
      const sec = getComputedStyle(document.querySelector('#booking'));
      return {
        entete: r(document.querySelector('.fgs-top')),
        logo: r(document.querySelector('.fgs-logo img')),
        centre: vu(centre) ? centre.textContent.trim() : '',
        liens: Array.from(document.querySelectorAll('.fgs-nav a')).filter(vu).map((a) => [a.textContent.trim(), a.getAttribute('href')]),
        cta: vu(cta) ? [cta.textContent.trim(), cta.getAttribute('href')] : null,
        menu: vu(document.querySelector('.fgs-menu')),
        bloc: r(document.querySelector('#booking > .container')),
        section: [sec.paddingTop, sec.paddingBottom],
        cadre: r(cadre),
        src: cadre ? cadre.getAttribute('src') : '',
        largeur: document.documentElement.clientWidth,
        deborde: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    const ctxM = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pm = await ctxM.newPage();
    const erreursM = [];
    pm.on('pageerror', (err) => erreursM.push(String(err && err.message || err)));
    await pm.goto(`${BASE_URL}/reserver/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    let sm = await lireSite(pm);
    ok(Boolean(sm.entete && Math.abs(sm.entete.h - 162) <= 1 && sm.logo && Math.abs(sm.logo.w - 196) <= 1 && sm.centre === 'Libramont' && JSON.stringify(sm.liens) === JSON.stringify(LIENS_FG) && sm.cta && sm.cta[1] === '#booking' && !sm.menu),
      '[M] 1440 px : leur en-tete a leurs mesures (162 px, logo de 196 px, « Libramont », leurs quatre liens vers leur vrai site, « Réserver » vers le formulaire)',
      JSON.stringify({ entete: sm.entete, logo: sm.logo, centre: sm.centre, liens: sm.liens.map((l) => l[0]), cta: sm.cta }));
    // LEUR EN-TETE AU PIXEL. Releve sur la capture de leur page (copie locale
    // de fungalaxy.be, 1440 px, 2026-09-23) : l encre des quatre mots du menu,
    // la hauteur de leurs capitales, le blanc du bouton, le contour du centre.
    // Leur police vient d un kit Adobe servi a leur seul domaine ; la notre est
    // la plus proche mesuree (Barlow Semi Condensed), et doit etre chargee pour
    // que la mesure dise quelque chose.
    const LEUR_ENTETE = { mots: [[737, 828], [856, 974], [1002, 1095], [1123, 1203]], capitales: [71, 85], bouton: [1247, 1394, 62, 99], centre: [263, 365, 62, 100] };
    const policeM = await pm.evaluate(async () => { await document.fonts.ready; return Array.from(document.fonts).some((f) => f.family.replace(/"/g, '') === 'Barlow Semi Condensed' && f.status === 'loaded'); });
    ok(policeM, 'MONTAGE [M] la police du menu de l en-tete est chargee');
    const imgM = decoderPng(await pm.screenshot({ clip: { x: 0, y: 0, width: 1440, height: 162 } }));
    const clairM = (x, y, s) => { const p = imgM.pixel(x, y); return (p[0] + p[1] + p[2]) / 3 > s; };
    const colonnesM = (x0, x1, y0, y1, s) => { const c = []; for (let x = x0; x < x1; x += 1) for (let y = y0; y < y1; y += 1) if (clairM(x, y, s)) { c.push(x); break; } return c; };
    const lignesM = (x0, x1, y0, y1, s) => { const l = []; for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) if (clairM(x, y, s)) { l.push(y); break; } return l; };
    const bornes = (t) => (t.length ? [t[0], t[t.length - 1]] : []);
    const cm = colonnesM(700, 1225, 60, 95, 140);
    const motsM = [];
    cm.forEach((x, i) => { if (!i || x - cm[i - 1] > 8) motsM.push([x, x]); else motsM[motsM.length - 1][1] = x; });
    const capM = motsM[2] ? bornes(lignesM(motsM[2][0], motsM[2][1] + 1, 40, 120, 140)) : [];
    const boutonM = bornes(colonnesM(1225, 1430, 45, 120, 200)).concat(bornes(lignesM(1225, 1430, 45, 120, 200)));
    const centreM = bornes(colonnesM(250, 390, 45, 120, 60)).concat(bornes(lignesM(250, 390, 45, 120, 60)));
    const aPres = (a, b, t) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= t);
    ok(policeM && motsM.length === 4 && motsM.every((m, i) => aPres(m, LEUR_ENTETE.mots[i], 2)) && aPres(capM, LEUR_ENTETE.capitales, 1) && aPres(boutonM, LEUR_ENTETE.bouton, 1) && aPres(centreM, LEUR_ENTETE.centre, 1),
      '[M] 1440 px : leur en-tete au pixel (encre des quatre mots du menu a 2 px de leur capture, capitales, bouton et centre a 1 px)',
      JSON.stringify({ mots: motsM, capitales: capM, bouton: boutonM, centre: centreM }));
    ok(Boolean(sm.bloc && sm.bloc.w === Math.min(1440, sm.largeur) && sm.section[0] === '32px' && sm.section[1] === '72px' && /^\/fungalaxy\/libramont\?embed=1&fond=/.test(String(sm.src).replace(/^https?:\/\/[^/]+/, '')) && sm.deborde <= 0),
      '[M] 1440 px : le bloc de la copie locale de leur page (1440 px au plus, 32 px au-dessus, 72 en dessous), le formulaire monte par embed.js en mode embarque, rien ne deborde',
      JSON.stringify({ bloc: sm.bloc, section: sm.section, src: sm.src, deborde: sm.deborde }));
    let fm = null;
    for (let k = 0; k < 100 && !fm; k += 1) { fm = pm.frames().find((x) => /\/fungalaxy\/libramont\?embed=1/.test(x.url())); if (!fm) await dormir(100); }
    ok(Boolean(fm) && await attendre(fm, () => document.body.classList.contains('is-embed') && getComputedStyle(document.querySelector('.fg-top')).display === 'none' && !document.querySelector('.fg-glow') && document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000),
      '[M] dans le cadre, le formulaire en mode embarque : sans notre bandeau ni nos halos, catalogue lu');
    if (fm) {
      const fondM = await fm.evaluate(() => ({ fond: new URLSearchParams(location.search).get('fond') || '', ref: getComputedStyle(document.documentElement).getPropertyValue('--fg-bg').trim() }));
      ok(fondM.fond === 'rgb(0, 0, 0)' && fondM.ref === fondM.fond, '[M] le formulaire prend le noir de la page comme fond de reference (les bords de la photo s y fondent)', JSON.stringify(fondM));
      const accordM = async () => {
        const dedans = await fm.evaluate(() => Math.max(document.body.scrollHeight, document.body.offsetHeight));
        const dehors = await pm.evaluate(() => Math.round(document.querySelector('#booking iframe').getBoundingClientRect().height));
        return { dedans, dehors, ecart: Math.abs(dedans - dehors) };
      };
      let am = await accordM();
      for (let k = 0; k < 30 && am.ecart > 8; k += 1) { await dormir(150); am = await accordM(); }
      ok(am.ecart <= 8, '[M] le cadre prend la hauteur du formulaire : la page defile d un seul tenant', JSON.stringify(am));
      // Une reservation jusqu a l ecran final, dans le cadre de la page.
      await fm.click('#dayBtn');
      ok(await allerAuMois(fm, mock.DATE), '[M] le mois du samedi du mock s affiche dans le cadre');
      await fm.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
      await attendre(fm, () => document.querySelector('#dayPop').hidden, 3000);
      await fm.click('#goActivities');
      await attendre(fm, () => document.querySelector('.fg-scene[data-scene="activites"].is-active'), 8000);
      await fm.click('#gridAct .fg-card[data-activity="bowling"]');
      await fm.click('#goHours');
      ok(await attendre(fm, () => !document.querySelector('#goContact').disabled, 25000), '[M] les heures se calculent dans le cadre');
      await fm.click('#goContact');
      await fm.fill('#cPrenom', 'Test'); await fm.fill('#cNom', 'Site'); await fm.fill('#cEmail', 'site@example.com'); await fm.fill('#cTel', '0491301667');
      await fm.click('#occasions .fg-occasion[data-occasion="evg"]');
      await fm.check('#cConsent');
      await fm.click('#goRecap');
      await attendre(fm, () => document.querySelector('.fg-scene[data-scene="recap"].is-active'), 5000);
      await passerLaVitrine(fm);
      // UNE DEMANDE A VERIFIER : la reponse est forcee sur ce que le vrai
      // handler rend quand l equipe doit valider (api/public-reservations.js :
      // validationStatus staff_review, human_review_required), avec l accuse
      // de reception qu il met alors en file au lieu de la confirmation
      // (lib/ops-communications.js). Le mock, lui, confirme toujours.
      await ctxM.route((u) => u.pathname === '/api/public-reservations', async (route) => {
        if (route.request().method() !== 'POST') { await route.continue(); return; }
        const r = await route.fetch();
        const j = await r.json();
        j.reservation = Object.assign({}, j.reservation, { validationStatus: 'staff_review' });
        j.ops = Object.assign({}, j.ops, { validationStatus: 'staff_review', autoDecision: 'human_review_required' });
        j.communications = (j.communications || []).map((c) => Object.assign({}, c, { templateId: c.templateId === 'confirmation' ? 'request_received' : c.templateId }));
        await route.fulfill({ response: r, json: j });
      });
      await fm.click('#confirmBtn');
      ok(await attendre(fm, () => document.querySelector('.fg-scene[data-scene="fin"].is-active') && document.querySelector('#finBody .fg-done__ticket'), 10000),
        '[M] la reservation va jusqu a l ecran final, avec son recu');
      const finM = await fm.evaluate(() => ({
        titre: document.querySelector('#t-fin').innerText.replace(/\s+/g, ' ').trim().toLowerCase(),
        confettis: document.querySelectorAll('#finBurst i').length,
        icone: (document.querySelector('.fg-done__ring svg use') || { getAttribute: () => 'aucune' }).getAttribute('href'),
        texte: document.querySelector('#finBody').textContent.replace(/\s+/g, ' ').trim(),
      }));
      ok(finM.titre === 'demande envoyée', 'MONTAGE [M] la reponse forcee « a verifier » arrive jusqu a l ecran final', JSON.stringify(finM.titre));
      ok(finM.confettis === 0 && finM.icone === '#i-mail', '[M] une demande que l equipe doit verifier ne se fete pas : enveloppe dans l anneau, aucun confetti', JSON.stringify({ confettis: finM.confettis, icone: finM.icone }));
      ok(/Un accusé de réception part à site@example\.com\./.test(finM.texte) && finM.texte.indexOf('La confirmation part') < 0 && /vous répond sous 24 heures ouvrables\./.test(finM.texte),
        '[M] une demande a verifier annonce l accuse de reception que la reponse met en file, et le delai ecrit dans cet accuse', finM.texte.slice(0, 240));
    }
    // A 1920 px : le formulaire garde les 1440 px qu il aurait dans leur page.
    await pm.setViewportSize({ width: 1920, height: 1080 });
    await dormir(500);
    sm = await lireSite(pm);
    ok(Boolean(sm.bloc && sm.bloc.w === 1440 && Math.abs(sm.bloc.x - 240) <= 1 && sm.cadre && sm.cadre.w === 1440 && sm.deborde <= 0),
      '[M] 1920 px : le formulaire garde ses 1440 px, centre, comme dans leur page (pas la pleine largeur de l ecran)', JSON.stringify({ bloc: sm.bloc, cadre: sm.cadre }));
    await pm.setViewportSize({ width: 1024, height: 768 });
    await dormir(500);
    sm = await lireSite(pm);
    ok(Boolean(sm.bloc && sm.bloc.w === sm.largeur && sm.liens.length === 4 && sm.centre === 'Libramont' && sm.deborde <= 0),
      '[M] 1024 px : pleine largeur, l en-tete garde son centre et ses quatre liens, rien ne deborde', JSON.stringify({ bloc: sm.bloc, liens: sm.liens.length, deborde: sm.deborde }));
    const lisEntete = await contrastesPires(pm, '.fgs-top a, .fgs-top .fgs-centre');
    ok(lisEntete.length >= 6 && lisEntete.every((x) => x.ratio >= x.seuil), '[M] chaque texte de l en-tete garde son seuil', lisEntete.filter((x) => x.ratio < x.seuil).map((x) => `« ${x.texte} » ${x.ratio}:1`).join(' ; ') || `${lisEntete.length} textes`);
    ok(erreursM.length === 0 && await pm.evaluate(() => document.querySelector('#reservationRepli').hidden), '[M] aucune erreur de script dans la page, et le repli reste cache tant que le formulaire est monte', erreursM.slice(0, 2).join(' | '));
    await ctxM.close();
    // L interrupteur du centre eteint (reponse d embed-state forcee) : embed.js
    // retire son cadre ; la page ne reste pas vide sous l en-tete.
    const ctxR = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctxR.route((u) => u.pathname === '/api/public-booking-meta' && u.searchParams.get('embedState') === '1',
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, center: 'libramont', actif: false }) }));
    const pr = await ctxR.newPage();
    await pr.goto(`${BASE_URL}/reserver/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    const repliVu = await attendre(pr, () => !document.querySelector('.pinlane-slot iframe') && !document.querySelector('#reservationRepli').hidden, 8000);
    const lienRepli = await pr.evaluate(() => { const a = document.querySelector('#reservationRepli a'); return a ? a.getAttribute('href') : ''; });
    ok(repliVu && lienRepli === '/reserver?center=libramont', '[M] formulaire eteint par l equipe : la page ne reste pas vide, elle renvoie au parcours classique du centre', lienRepli || 'aucun lien');
    // Le lien MENE au tunnel de Libramont : le tunnel qui s ouvre demande le
    // catalogue de CE centre (sans centre, /reserver sert la demonstration).
    let tunnelCentre = '';
    if (repliVu) {
      const [req] = await Promise.all([
        pr.waitForRequest((r) => { const u = new URL(r.url()); return u.pathname === '/api/public-booking-meta' && !u.searchParams.get('embedState'); }, { timeout: 20000 }).catch(() => null),
        pr.click('#reservationRepli a'),
      ]);
      if (req) { const u = new URL(req.url()); tunnelCentre = u.searchParams.get('centerId') || u.searchParams.get('center') || ''; }
    }
    ok(tunnelCentre === 'libramont', '[M] le lien du repli ouvre le tunnel classique de Libramont', tunnelCentre || 'aucun catalogue demande');
    await ctxR.close();
    // Sur telephone : un menu, le formulaire sur toute la largeur.
    const ctxMt = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    const pmt = await ctxMt.newPage();
    await pmt.goto(`${BASE_URL}/reserver/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    await dormir(400);
    const st = await lireSite(pmt);
    ok(Boolean(st.entete && st.entete.h <= 100 && st.menu && st.liens.length === 0 && st.cta && st.cadre && st.cadre.w === st.largeur && st.deborde <= 0),
      '[M] 375 px : un menu a la place des liens, « Réserver » garde, le formulaire sur toute la largeur, rien ne deborde', JSON.stringify({ entete: st.entete, menu: st.menu, cta: st.cta, cadre: st.cadre, deborde: st.deborde }));
    // Sur telephone aussi, le cadre suit la hauteur du formulaire : sinon le
    // bas serait coupe, ou defilerait dans un cadre dans la page. Mesure sur
    // l ecran des activites, BIEN plus haut que les 720 px par defaut du
    // cadre : au premier ecran, le contenu fait justement 720 px a cette
    // largeur, et un cadre qui ne suivrait plus rien y passerait.
    let fmt = null;
    for (let k = 0; k < 100 && !fmt; k += 1) { fmt = pmt.frames().find((x) => /\/fungalaxy\/libramont\?embed=1/.test(x.url())); if (!fmt) await dormir(100); }
    let amt = { dedans: 0, dehors: 0, ecart: Infinity };
    if (fmt && await attendre(fmt, () => document.querySelector('#dayLabel') && document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000)) {
      await fmt.tap('#dayBtn');
      if (await allerAuMois(fmt, mock.DATE)) {
        await fmt.tap(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
        await attendre(fmt, () => document.querySelector('#dayPop').hidden, 3000);
        await fmt.tap('#goActivities');
        await attendre(fmt, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000);
      }
      const accordT = async () => {
        const dedans = await fmt.evaluate(() => Math.max(document.body.scrollHeight, document.body.offsetHeight));
        const dehors = await pmt.evaluate(() => Math.round(document.querySelector('#booking iframe').getBoundingClientRect().height));
        return { dedans, dehors, ecart: Math.abs(dedans - dehors) };
      };
      amt = await accordT();
      for (let k = 0; k < 30 && amt.ecart > 8; k += 1) { await dormir(150); amt = await accordT(); }
    }
    ok(amt.dedans > 900 && amt.ecart <= 8, '[M] 375 px : le cadre grandit avec le formulaire (ecran des activites), la page defile d un seul tenant', JSON.stringify(amt));
    await pmt.tap('.fgs-menu summary');
    const menuM = await pmt.evaluate(() => ({ ouvert: document.querySelector('.fgs-menu').open, centre: (document.querySelector('.fgs-menu__centre') || {}).textContent || '', liens: Array.from(document.querySelectorAll('.fgs-menu__panel a')).filter((a) => a.getClientRects().length).map((a) => [a.textContent.trim(), a.getAttribute('href')]), deborde: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
    ok(menuM.ouvert && /Libramont/.test(menuM.centre) && JSON.stringify(menuM.liens) === JSON.stringify(LIENS_FG) && menuM.deborde <= 0, '[M] 375 px : le menu ouvert dit le centre et donne leurs quatre liens, dans l ecran', JSON.stringify(menuM));
    await ctxMt.close();

    // =====================================================================
    console.log('');
    console.log('[N] LA BARRE DU BAS : A SA PLACE, ELLE NE SUIT JAMAIS');
    // Releve de la passe « plus user friendly » (2026-09-23) : le « Continuer »
    // des activites sous la ligne de flottaison des 1440x900, a 500 px sous le
    // bas de l ecran sur telephone. La barre avait ete collee au bas de ce qui
    // se voit ; Movsar l a jugee genante (2026-09-24 : « meme sur PC il est
    // derangeant quand il nous suit partout, trop gros », puis « en vrai pas
    // besoin de suivre, c inutile »). Elle reste a sa place, en fin d ecran,
    // sur tous les formats, en page autonome comme embarquee.
    // =====================================================================
    const lireBarre = (p) => p.evaluate(() => {
      const bar = document.querySelector('.fg-scene.is-active .fg-dock');
      if (!bar) return null;
      const b = bar.querySelector('.fg-btn:not(.fg-btn--ghost)').getBoundingClientRect();
      return {
        colle: bar.classList.contains('is-stuck'),
        position: getComputedStyle(bar).position,
        haut: Math.round(b.top), bas: Math.round(b.bottom),
        vh: window.innerHeight,
        sy: Math.round(window.scrollY),
        texte: bar.querySelector('.fg-bar__count').textContent.replace(/\s+/g, ' ').trim(),
      };
    });
    // A sa place : ni collee, ni sticky.
    const aSaPlace = (x) => Boolean(x) && !x.colle && x.position !== 'sticky';
    const auRepos = (p) => attendre(p, () => document.getAnimations().every((x) => x.playState !== 'running' || x.effect.getComputedTiming().iterations === Infinity), 8000);
    // Le resume attendu, relu sur la reponse (meme regle que rendreVisite).
    const resumeAttendu = (lp) => {
      const depart = lp.arrivee || lp.time;
      const span = depart && lp.fin ? `${depart} → ${heureAffichee(lp.fin)}${lp.fermeture ? ' (fermeture)' : ' environ'}` : '';
      return (span + (lp.prix > 0 ? `${span ? ' · ' : ''}${euros(lp.prix)}${lp.complet ? ' indicatif' : ' indicatif + prix à l’accueil'}` : '')).replace(/\s+/g, ' ');
    };

    // TELEPHONE, page autonome.
    const ctxN = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const pn = await ctxN.newPage();
    await pn.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    await attendre(pn, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000);
    await pn.tap('#dayBtn');
    await allerAuMois(pn, mock.DATE);
    await pn.tap(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
    await attendre(pn, () => document.querySelector('#dayPop').hidden, 3000);
    await pn.tap('#goActivities');
    ok(await attendre(pn, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000)
      && await pn.evaluate(() => document.querySelectorAll('.fg-dock').length === 2 && Boolean(document.querySelector('.fg-scene.is-active .fg-dock'))),
      'MONTAGE [N] telephone : l ecran des activites est atteint ; une barre du bas sur les activites, une sur les heures');
    // Rien de coche, en haut de page : la barre attend a sa place.
    await pn.evaluate(() => window.scrollTo(0, 0));
    await attendre(pn, () => window.scrollY === 0, 3000);
    await auRepos(pn);
    const videN = await lireBarre(pn);
    ok(aSaPlace(videN) && videN.haut > videN.vh,
      '[N] telephone, activites, rien de coche : la barre ne suit pas, elle attend a sa place en fin d ecran', JSON.stringify(videN));
    // Les gestes comptes a leur depart (animationstart) : le reveil des deux
    // boutons qui avancent, la case qui claque et le prix qui roule.
    await pn.evaluate(() => {
      window.__qaEveil = { hours: 0, contact: 0 };
      [['#goHours', 'hours'], ['#goContact', 'contact']].forEach(([s, k]) => document.querySelector(s).addEventListener('animationstart', (e) => { if (e.animationName === 'fg-wake') window.__qaEveil[k] += 1; }));
      window.__qaGeste = { tick: 0, prix: 0 };
      document.querySelector('#gridAct').addEventListener('animationstart', (e) => { if (e.animationName === 'fg-tick') window.__qaGeste.tick += 1; if (e.animationName === 'fg-maj') window.__qaGeste.prix += 1; });
    });
    await pn.tap('#gridAct .fg-card[data-activity="bowling"]');
    await pn.tap('#gridAct .fg-card[data-activity="laser_game"]');
    await pn.evaluate(() => window.scrollTo(0, 0));
    await attendre(pn, () => window.scrollY === 0, 3000);
    await auRepos(pn);
    await dormir(300);
    let bn = await lireBarre(pn);
    ok(aSaPlace(bn) && bn.sy === 0 && bn.haut > bn.vh && bn.texte === '2 activités sélectionnées',
      '[N] telephone, activites, deux cartes cochees : la barre ne suit toujours pas (« Continuer », actif, attend a sa place), et son compteur dit le choix', JSON.stringify(bn));
    ok(await pn.evaluate(() => window.__qaEveil.hours === 1 && !document.querySelector('#goHours').classList.contains('is-wake')), '[N] « Continuer » s eveille une fois, au premier choix (pas au second), et rend sa classe (sinon il rejouerait a chaque retour sur l ecran)', await pn.evaluate(() => JSON.stringify(window.__qaEveil)));
    ok(await pn.evaluate(() => window.__qaGeste.tick === 2 && window.__qaGeste.prix === 2 && !document.querySelector('#gridAct .is-coche, #gridAct .is-maj')), '[N] cocher deux cartes : chaque case claque une fois, chaque prix qui change roule, et au repos aucune classe de geste ne reste posee', await pn.evaluate(() => JSON.stringify(window.__qaGeste)));
    const reponseN1 = pn.waitForResponse((r) => r.url().indexOf('/api/public-availability?') >= 0, { timeout: 25000 }).catch(() => null);
    await pn.tap('#goHours');
    ok(await attendre(pn, () => document.querySelector('.fg-scene[data-scene="heures"].is-active'), 6000), '[N] telephone : « Continuer », atteint en descendant, mene aux heures');
    const rN1 = await reponseN1;
    const lpN1 = rN1 ? lignePlan(await rN1.json()) : null;
    ok(await attendre(pn, () => document.querySelector('#planZone .fg-visit') && !document.querySelector('#hourZone').classList.contains('is-busy') && !document.querySelector('.fg-scene.is-entering'), 25000), '[N] telephone : les heures et le plan se chargent');
    await pn.evaluate(() => window.scrollTo(0, 0));
    await attendre(pn, () => window.scrollY === 0, 3000);
    await auRepos(pn);
    await dormir(300);
    bn = await lireBarre(pn);
    const attenduN1 = lpN1 ? resumeAttendu(lpN1) : '';
    ok(aSaPlace(bn) && bn.haut > bn.vh && Boolean(attenduN1) && bn.texte === attenduN1,
      '[N] telephone, heures : la barre ne suit pas, et son resume dit les heures et le prix de la visite, ceux de la reponse',
      JSON.stringify({ barre: bn && bn.texte, attendu: attenduN1, position: bn && bn.position, haut: bn && bn.haut, vh: bn && bn.vh }));
    // Une autre heure de bowling : la barre suit la NOUVELLE reponse.
    const autreN = await pn.evaluate(() => { const c = document.querySelector('#hourZone .fg-track[data-activity="bowling"] .fg-period.is-open .fg-chip:not(.is-proposed):not(.is-on):not([data-ok="false"])'); return c ? c.dataset.time : ''; });
    const reponseN2 = pn.waitForResponse((r) => r.url().indexOf('/api/public-availability?') >= 0, { timeout: 25000 }).catch(() => null);
    if (autreN) await pn.tap(`#hourZone .fg-track[data-activity="bowling"] .fg-chip[data-time="${autreN}"]`);
    const rN2 = autreN ? await reponseN2 : null;
    const lpN2 = rN2 ? lignePlan(await rN2.json()) : null;
    await attendre(pn, () => !document.querySelector('#hourZone').classList.contains('is-busy'), 25000);
    await dormir(300);
    const attenduN2 = lpN2 ? resumeAttendu(lpN2) : '';
    const texteN2 = await pn.evaluate(() => document.querySelector('#hourSum').textContent.replace(/\s+/g, ' ').trim());
    ok(Boolean(autreN) && Boolean(attenduN2) && attenduN2 !== attenduN1, 'MONTAGE [N] poser une autre heure de bowling change la visite : la mesure du resume porte sur un vrai changement', `${autreN} : ${attenduN1} / ${attenduN2}`);
    ok(texteN2 === attenduN2, '[N] une heure posee : la barre suit, heures et prix de la NOUVELLE reponse', JSON.stringify({ barre: texteN2, attendu: attenduN2 }));
    ok(await pn.evaluate(() => window.__qaEveil.contact === 1 && !document.querySelector('#goContact').classList.contains('is-wake')), '[N] « Garder » s eveille une fois a l arrivee sur les heures, pas a chaque heure posee', await pn.evaluate(() => JSON.stringify(window.__qaEveil)));
    // SEUL CE QUI A CHANGE ROULE : les chiffres en gras de la barre, dans
    // l ordre de rendreVisite (les heures, puis le prix), compares d une
    // reponse a l autre ; le prix du bloc de visite roule avec celui de la barre.
    const grasDe = (lp) => {
      const depart = lp.arrivee || lp.time;
      return (depart && lp.fin ? [`${depart} → ${heureAffichee(lp.fin)}`] : []).concat(lp.prix > 0 ? [euros(lp.prix)] : []);
    };
    const rouleAttendu = lpN1 && lpN2 ? grasDe(lpN2).map((v, k) => v !== grasDe(lpN1)[k]) : [];
    const rouleN = await pn.evaluate(() => ({
      barre: Array.from(document.querySelectorAll('#hourSum b')).map((b) => b.classList.contains('is-maj')),
      prix: Boolean(document.querySelector('#planZone .fg-visit__price.is-maj')),
    }));
    ok(rouleAttendu.some(Boolean) && JSON.stringify(rouleN.barre) === JSON.stringify(rouleAttendu) && rouleN.prix === Boolean(lpN2 && lpN2.prix > 0 && rouleAttendu[rouleAttendu.length - 1]),
      '[N] une heure posee : dans la barre, seul ce qui a change roule (is-maj), le reste ne bouge pas', JSON.stringify({ rouleN, rouleAttendu }));
    // En bas de page : la barre a sa place, son resume montre, ne couvre rien.
    await pn.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await attendre(pn, () => Math.abs(window.scrollY + window.innerHeight - document.documentElement.scrollHeight) <= 2, 3000);
    await dormir(450);
    const finN = await pn.evaluate(() => {
      const bar = document.querySelector('.fg-scene.is-active .fg-dock');
      const r = bar.getBoundingClientRect();
      const v = document.querySelector('#planZone .fg-visit').getBoundingClientRect();
      return { colle: bar.classList.contains('is-stuck'), resume: getComputedStyle(bar.querySelector('.fg-bar__count')).opacity, visite: Math.round(v.bottom), barre: Math.round(r.top), vh: window.innerHeight };
    });
    ok(!finN.colle && finN.resume === '1' && finN.visite <= finN.barre && finN.barre < finN.vh,
      '[N] en bas de page, la barre est a sa place, son resume montre, sous le bloc de visite qu elle ne couvre pas', JSON.stringify(finN));
    await ctxN.close();

    // 1440x900, page autonome : le releve de l audit, et le clavier.
    const ctxNd = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pnd = await ctxNd.newPage();
    await pnd.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    await attendre(pnd, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000);
    await pnd.click('#goActivities');
    await attendre(pnd, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000);
    await pnd.click('#gridAct .fg-card[data-activity="bowling"]');
    await pnd.click('#gridAct .fg-card[data-activity="laser_game"]');
    await pnd.evaluate(() => window.scrollTo(0, 0));
    await attendre(pnd, () => window.scrollY === 0, 3000);
    await auRepos(pnd);
    await dormir(300);
    const bd = await lireBarre(pnd);
    ok(Boolean(bd) && bd.haut > bd.vh, 'MONTAGE [N] 1440x900 : la place de la barre est sous l ecran (suivre changerait quelque chose)', JSON.stringify(bd));
    ok(aSaPlace(bd), '[N] 1440x900 : la barre ne suit pas l ecran : « Continuer » attend a sa place, en fin d ecran', JSON.stringify(bd));
    await pnd.evaluate(() => { window.scrollTo(0, 0); document.querySelector('#t-act').focus(); });
    const focusD = { vus: 0, fautes: [] };
    for (let k = 0; k < 60; k += 1) {
      await pnd.keyboard.press('Tab');
      await dormir(150);
      const e = await pnd.evaluate(() => {
        const f = document.activeElement;
        const bar = document.querySelector('.fg-scene.is-active .fg-dock');
        if (!f || f === document.body || !bar) return null;
        const r = f.getBoundingClientRect();
        return { nom: f.dataset.activity || f.dataset.valeur || f.id || f.className, dans: bar.contains(f),
          vu: r.top >= -1 && r.bottom <= window.innerHeight + 1,
          // Un arret sur un element INVISIBLE (tiroir ou menu replie : opacite
          // nulle, boite de 0 px). visibility ne le dirait pas : un element
          // cache ainsi ne prend jamais le focus.
          invisible: (() => { let o = 1; for (let p = f; p && p.nodeType === 1; p = p.parentElement) o *= Number(getComputedStyle(p).opacity); const pli = f.closest('.fg-card__optin, .fg-period__inner'); return o < 0.1 || Boolean(pli && pli.getBoundingClientRect().height < 1); })() };
      });
      if (!e) break;
      focusD.vus += 1;
      if (!e.vu || e.invisible) focusD.fautes.push(e.nom);
      if (e.dans) break;
    }
    ok(focusD.vus >= 8 && focusD.fautes.length === 0, '[N] 1440x900, au clavier : ce qui prend le focus est dans l ecran, et visible (WCAG 2.4.11)', JSON.stringify(focusD));
    await ctxNd.close();

    // EMBARQUE, telephone : la page hote defile, le cadre ne defile pas.
    const ctxNe = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const ph = await ctxNe.newPage();
    await ph.goto(`${BASE_URL}/host.html`, { waitUntil: 'networkidle', timeout: 45000 });
    let fe = null;
    for (let k = 0; k < 100 && !fe; k += 1) { fe = ph.frames().find((x) => x.url().indexOf('/fungalaxy/libramont?embed=1') >= 0); if (!fe) await dormir(100); }
    const cadreN = Boolean(fe) && await attendre(fe, () => document.querySelector('#dayLabel') && document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000);
    ok(cadreN, 'MONTAGE [N] embarque, telephone : le cadre est monte, catalogue lu');
    if (cadreN) {
      await fe.tap('#dayBtn');
      await allerAuMois(fe, mock.DATE);
      await fe.tap(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
      await attendre(fe, () => document.querySelector('#dayPop').hidden, 3000);
      await fe.tap('#goActivities');
      await attendre(fe, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000);
      await fe.tap('#gridAct .fg-card[data-activity="bowling"]');
      await fe.tap('#gridAct .fg-card[data-activity="laser_game"]');
      await ph.evaluate(() => window.scrollTo(0, 0));
      await auRepos(fe);
      await dormir(900);
      const be = await lireBarre(fe);
      ok(aSaPlace(be), '[N] embarque, telephone : la barre ne suit pas non plus, elle attend a sa place dans le cadre', JSON.stringify(be));
      // Au clavier : ce qui prend le focus est dans l ecran de l hote.
      await ph.evaluate(() => window.scrollTo(0, 0));
      await dormir(900);
      await fe.evaluate(() => document.querySelector('#t-act').focus());
      const focusE = { vus: 0, fautes: [] };
      for (let k = 0; k < 60; k += 1) {
        await ph.keyboard.press('Tab');
        await dormir(450);
        const c = await ph.evaluate(() => { const r = document.querySelector('.bloc iframe').getBoundingClientRect(); return { top: r.top, vh: window.innerHeight }; });
        const e = await fe.evaluate(() => {
          const f = document.activeElement;
          const bar = document.querySelector('.fg-scene.is-active .fg-dock');
          if (!f || f === document.body || !bar) return null;
          const r = f.getBoundingClientRect();
          return { nom: f.dataset.activity || f.dataset.valeur || f.id || f.className, dans: bar.contains(f), haut: r.top, bas: r.bottom,
            invisible: (() => { let o = 1; for (let p = f; p && p.nodeType === 1; p = p.parentElement) o *= Number(getComputedStyle(p).opacity); const pli = f.closest('.fg-card__optin, .fg-period__inner'); return o < 0.1 || Boolean(pli && pli.getBoundingClientRect().height < 1); })() };
        });
        if (!e) break;
        focusE.vus += 1;
        if (c.top + e.haut < -1 || c.top + e.bas > c.vh + 1 || e.invisible) focusE.fautes.push(e.nom);
        if (e.dans) break;
      }
      ok(focusE.vus >= 8 && focusE.fautes.length === 0, '[N] embarque, au clavier : ce qui prend le focus est dans l ecran de l hote, et visible (WCAG 2.4.11)', JSON.stringify(focusE));
      // L ANNEAU ENTIER. La page hote defile juste assez pour montrer la carte
      // qui prend le focus, a un ou deux pixels pres (arrondis entre le cadre
      // et l hote) : chaque carte sous l ecran de l hote, focalisee depuis le
      // haut de la page, doit y remonter avec son anneau (2 px + 3 px d ecart).
      await ph.evaluate(() => window.scrollTo(0, 0));
      await dormir(900);
      const sousEcran = await fe.evaluate(() => Array.from(document.querySelectorAll('#gridAct .fg-card')).map((c) => ({ id: c.dataset.activity, bas: c.getBoundingClientRect().bottom })));
      const hautCadreE = await ph.evaluate(() => ({ top: document.querySelector('.bloc iframe').getBoundingClientRect().top, vh: window.innerHeight }));
      const cibles = sousEcran.filter((c) => hautCadreE.top + c.bas > hautCadreE.vh).map((c) => c.id);
      const anneaux = [];
      for (const id of cibles) {
        await ph.evaluate(() => window.scrollTo(0, 0));
        await dormir(600);
        await fe.focus(`#gridAct .fg-card[data-activity="${id}"]`);
        await dormir(450);
        const c = await ph.evaluate(() => ({ top: document.querySelector('.bloc iframe').getBoundingClientRect().top, vh: window.innerHeight }));
        const r = await fe.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { haut: b.top, bas: b.bottom }; }, `#gridAct .fg-card[data-activity="${id}"]`);
        anneaux.push({ id, haut: Math.round((c.top + r.haut - 5) * 100) / 100, bas: Math.round((c.top + r.bas + 5) * 100) / 100, vh: c.vh });
      }
      ok(cibles.length > 0, 'MONTAGE [N] embarque : des cartes commencent sous l ecran de l hote (la mesure de l anneau porte sur un vrai defilement)', cibles.join(', '));
      ok(anneaux.every((a) => a.haut >= 0 && a.bas <= a.vh), '[N] embarque, au clavier : une carte qui prend le focus sous l ecran de l hote y remonte avec son anneau entier', JSON.stringify(anneaux));
      // Le cas qui trompait la marge : une carte A CHEVAL sur le bas de
      // l ecran de l hote. Chromium l y alignait au pixel, sans sa marge de
      // defilement, l anneau dehors. La page hote est posee pour que le bas
      // de la carte tombe 20 px sous l ecran, puis la carte prend le focus.
      const idCheval = await fe.evaluate(() => { const c = document.querySelectorAll('#gridAct .fg-card'); return c[Math.min(3, c.length - 1)].dataset.activity; });
      const cheval = await fe.evaluate((i) => document.querySelector(`#gridAct .fg-card[data-activity="${i}"]`).getBoundingClientRect().bottom, idCheval);
      await ph.evaluate((b) => { const t = document.querySelector('.bloc iframe').getBoundingClientRect().top + window.scrollY; window.scrollTo(0, Math.max(0, Math.round(t + b - window.innerHeight - 20))); }, cheval);
      await dormir(700);
      const avantCheval = await ph.evaluate((b) => Math.round(document.querySelector('.bloc iframe').getBoundingClientRect().top + b - window.innerHeight), cheval);
      await fe.focus(`#gridAct .fg-card[data-activity="${idCheval}"]`);
      await dormir(450);
      const cC = await ph.evaluate(() => ({ top: document.querySelector('.bloc iframe').getBoundingClientRect().top, vh: window.innerHeight }));
      const rC = await fe.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { haut: b.top, bas: b.bottom }; }, `#gridAct .fg-card[data-activity="${idCheval}"]`);
      const anneauCheval = { id: idCheval, depasseAvant: avantCheval, haut: Math.round((cC.top + rC.haut - 5) * 100) / 100, bas: Math.round((cC.top + rC.bas + 5) * 100) / 100, vh: cC.vh };
      ok(anneauCheval.depasseAvant > 0 && anneauCheval.depasseAvant < 40 && anneauCheval.haut >= 0 && anneauCheval.bas <= anneauCheval.vh,
        '[N] embarque, au clavier : une carte a cheval sur le bas de l ecran de l hote y remonte avec son anneau entier', JSON.stringify(anneauCheval));
    }
    await ctxNe.close();

    // =====================================================================
    console.log('');
    console.log('[O] ON DESCEND PARTOUT, LE CALENDRIER SE VOIT EN ENTIER');
    // =====================================================================
    // Le vrai geste : un doigt qui glisse (Input.dispatchTouchEvent) sur
    // telephone, la molette sur bureau. Input.synthesizeScrollGesture ne fait
    // rien defiler sans tete, meme une page temoin : il rendrait un faux rouge.
    const glisser = async (cdp, vw, vh) => {
      const x = Math.round(vw / 2), y0 = Math.round(vh * 0.72), y1 = Math.round(vh * 0.28);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
      for (let j = 1; j <= 12; j += 1) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: Math.round(y0 + (y1 - y0) * j / 12) }] }); await dormir(16); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await dormir(450);
    };
    // Du haut jusqu en bas au vrai geste ; un geste qui ne bouge rien avant le
    // bas est un geste PERDU (avale par le cadre).
    const descente = async (p, f, geste) => {
      await p.evaluate(() => window.scrollTo(0, 0));
      await f.evaluate(() => window.scrollTo(0, 0));
      await dormir(400);
      let perdus = 0, gestes = 0;
      for (let k = 0; k < 25 && perdus < 3; k += 1) {
        const avant = await p.evaluate(() => ({ sy: Math.round(scrollY), max: document.documentElement.scrollHeight - innerHeight }));
        if (avant.sy >= avant.max - 1) break;
        await geste();
        gestes += 1;
        if (await p.evaluate(() => Math.round(scrollY)) <= avant.sy) perdus += 1;
      }
      const fin = await p.evaluate(() => ({ sy: Math.round(scrollY), max: document.documentElement.scrollHeight - innerHeight }));
      return { gestes, perdus, sy: fin.sy, max: fin.max, dedans: await f.evaluate(() => Math.round(window.scrollY)) };
    };
    // Le cadre a la hauteur du formulaire : jamais plus court (il deviendrait
    // defilable), plus long de moins de 8 px (il ne redescend qu au-dela).
    const suitLeContenu = async (p, f) => {
      const cadre = await p.evaluate(() => Math.round(document.querySelector('iframe').getBoundingClientRect().height));
      const d = await f.evaluate(() => ({ corps: Math.max(document.body.scrollHeight, document.body.offsetHeight), dedans: Math.round(window.scrollY) }));
      return { cadre, corps: d.corps, dedans: d.dedans, ok: d.corps <= cadre && cadre - d.corps < 8 && d.dedans === 0 };
    };
    // Le calendrier dans l ecran de la page (celui de l hote s il y en a un) :
    // le haut du bouton et le bas du mois ; et le nombre de personnes, dessous
    // ou recouvert.
    const calVu = async (p, f, embarque) => {
      const c = await f.evaluate(() => { const b = document.querySelector('#dayBtn').getBoundingClientRect(); const m = document.querySelector('#dayPop').getBoundingClientRect(); const s = document.querySelector('#paxInput').getBoundingClientRect(); return { bouton: b.top, bas: m.bottom, h: m.height, pax: s.top }; });
      const decal = embarque ? await p.evaluate(() => document.querySelector('iframe').getBoundingClientRect().top) : 0;
      const vh = await p.evaluate(() => innerHeight);
      return { bouton: Math.round(c.bouton + decal), bas: Math.round(c.bas + decal), vh, mois: Math.round(c.h), paxSous: c.pax >= c.bas };
    };
    // La fenetre du calendrier dans l ecran de la page (celui de l hote s il y
    // en a un), le bouton du jour, et ce qui dit la fenetre : fixe, dans body,
    // voile visible.
    const fenetreVue = async (p, f, embarque) => {
      const r = await f.evaluate(() => { const d = document.querySelector('#dayPop'); const m = d.getBoundingClientRect(); const b = document.querySelector('#dayBtn').getBoundingClientRect(); const v = document.querySelector('#dayVoile'); return { haut: m.top, bas: m.bottom, h: m.height, btnHaut: b.top, btnBas: b.bottom, fixe: getComputedStyle(d).position === 'fixed', dansBody: d.parentNode === document.body, voile: Boolean(v) && !v.hidden && getComputedStyle(v).display !== 'none' }; });
      const decal = embarque ? await p.evaluate(() => document.querySelector('iframe').getBoundingClientRect().top) : 0;
      const vh = await p.evaluate(() => innerHeight);
      return { haut: Math.round(r.haut + decal), bas: Math.round(r.bas + decal), milieu: Math.round((r.haut + r.bas) / 2 + decal), h: Math.round(r.h), btnHaut: Math.round(r.btnHaut + decal), btnBas: Math.round(r.btnBas + decal), vh, fixe: r.fixe, dansBody: r.dansBody, voile: r.voile };
    };
    const heuresPretes = () => document.querySelector('#planZone .fg-visit') && !document.querySelector('#hourZone').classList.contains('is-busy') && !document.querySelector('.fg-scene.is-entering');

    // EMBARQUE, TELEPHONE, sur la copie de leur page.
    const ctxO = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const po = await ctxO.newPage();
    const cdpO = await ctxO.newCDPSession(po);
    await po.goto(`${BASE_URL}/reserver/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    let fo = null;
    for (let k = 0; k < 100 && !fo; k += 1) { fo = po.frames().find((x) => x.url().indexOf('/fungalaxy/libramont?embed=1') >= 0); if (!fo) await dormir(100); }
    const cadreO = Boolean(fo) && await attendre(fo, () => document.querySelector('#dayLabel') && document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000);
    ok(cadreO, 'MONTAGE [O] embarque, telephone : le formulaire est monte sur la copie de leur page, catalogue lu');
    if (cadreO) {
      await auRepos(fo);
      await po.evaluate(() => window.scrollTo(0, 0));
      await dormir(300);
      await fo.tap('#dayBtn');
      await attendre(fo, () => !document.querySelector('#dayPop').hidden, 3000);
      await dormir(1400);
      const fo1 = await fenetreVue(po, fo, true);
      ok(fo1.btnBas + 8 + fo1.h > fo1.vh - 90, 'MONTAGE [O] embarque, telephone : ouvert sous le bouton, le mois tomberait dans les 90 px du bas de l ecran de l hote', JSON.stringify(fo1));
      ok(fo1.fixe && fo1.dansBody && fo1.voile && fo1.haut >= 90 && fo1.bas <= fo1.vh - 90 && Math.abs(fo1.milieu - fo1.vh / 2) <= 3,
        '[O] embarque, telephone : le calendrier est une fenetre au MILIEU de l ecran de l hote, 90 px de marge au moins en haut et en bas, sur un voile', JSON.stringify(fo1));
      // Vu en production le 2026-09-23 : le chevron du bouton, place sur le
      // conteneur que le calendrier agrandit, flottait au milieu du mois.
      const icones = await fo.evaluate(() => { const b = document.querySelector('#dayBtn').getBoundingClientRect(); return Array.from(document.querySelectorAll('#dayBtn svg')).map((s) => { const r = s.getBoundingClientRect(); return { dedans: r.top >= b.top - 1 && r.bottom <= b.bottom + 1 && r.left >= b.left - 1 && r.right <= b.right + 1, haut: Math.round(r.top - b.top) }; }); });
      ok(icones.length === 2 && icones.every((x) => x.dedans), '[O] telephone, calendrier ouvert : les deux icones du bouton du jour restent DANS le bouton', JSON.stringify(icones));
      const s1 = await suitLeContenu(po, fo);
      ok(s1.ok, '[O] embarque : calendrier ouvert, le cadre a la hauteur du formulaire et ne defile pas lui-meme', JSON.stringify(s1));
      // Toucher a cote de la fenetre la ferme, et rien d autre : le voile prend
      // le toucher destine au controle qu il recouvre.
      const dessousO = await fo.evaluate(() => { const f = document.querySelector('#dayPop').getBoundingClientRect(); const c = ['#paxPlus', '#paxMinus', '#goActivities'].map((x) => document.querySelector(x)).filter(Boolean).map((b) => { const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, sel: b.id }; }).filter((q) => q.y > 0 && q.y < innerHeight && !(q.x >= f.left && q.x <= f.right && q.y >= f.top && q.y <= f.bottom)); return c[0] || null; });
      ok(Boolean(dessousO), 'MONTAGE [O] embarque, telephone : un vrai controle sous le voile, hors de la fenetre', JSON.stringify(dessousO));
      if (dessousO) {
        const paxO = await fo.evaluate(() => document.querySelector('#paxInput').value);
        const decalO = await po.evaluate(() => document.querySelector('iframe').getBoundingClientRect().top);
        await po.touchscreen.tap(Math.round(dessousO.x), Math.round(dessousO.y + decalO));
        await dormir(500);
        const apresO = await fo.evaluate(() => ({ ferme: document.querySelector('#dayPop').hidden, rentre: Boolean(document.querySelector('#dayPop').closest('.fg-day')), pax: document.querySelector('#paxInput').value, ecran: document.body.dataset.step }));
        ok(apresO.ferme && apresO.rentre && apresO.pax === paxO && apresO.ecran === '1', `[O] embarque, telephone : toucher a cote de la fenetre (au-dessus de ${dessousO.sel}) la ferme, et rien d autre`, JSON.stringify(apresO));
        await fo.tap('#dayBtn');
        await attendre(fo, () => !document.querySelector('#dayPop').hidden, 3000);
        await dormir(600);
      }
      await allerAuMois(fo, mock.DATE);
      await fo.tap(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
      await attendre(fo, () => document.querySelector('#dayPop').hidden, 3000);
      await fo.tap('#goActivities');
      await attendre(fo, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000);
      await fo.tap('#gridAct .fg-card[data-activity="bowling"]');
      await fo.tap('#gridAct .fg-card[data-activity="laser_game"]');
      await auRepos(fo);
      await dormir(400);
      const s2 = await suitLeContenu(po, fo);
      ok(s2.ok, '[O] embarque : activites, le cadre a la hauteur du formulaire au pixel pres (3 px de trop le rendaient defilable)', JSON.stringify(s2));
      const d2 = await descente(po, fo, () => glisser(cdpO, 390, 844));
      ok(d2.gestes >= 1 && d2.perdus === 0 && d2.sy >= d2.max - 1 && d2.dedans === 0, '[O] embarque, telephone, activites : au doigt, chaque geste fait descendre la page jusqu en bas, aucun n est avale par le cadre', JSON.stringify(d2));
      await fo.tap('#goHours');
      await attendre(fo, heuresPretes, 25000);
      await auRepos(fo);
      await dormir(400);
      const s3 = await suitLeContenu(po, fo);
      ok(s3.ok, '[O] embarque : heures, le cadre a la hauteur du formulaire', JSON.stringify(s3));
      const d3 = await descente(po, fo, () => glisser(cdpO, 390, 844));
      ok(d3.gestes >= 2 && d3.perdus === 0 && d3.sy >= d3.max - 1 && d3.dedans === 0, '[O] embarque, telephone, heures : au doigt, on descend jusqu en bas sans geste perdu', JSON.stringify(d3));
      // LE VERROU : meme si le contenu depasse le cadre de 4 px (un arrondi,
      // une image qui finit de charger), le cadre ne prend pas le geste.
      await po.evaluate(() => window.scrollTo(0, 0));
      await po.evaluate(() => { const fr = document.querySelector('iframe'); fr.style.height = (fr.getBoundingClientRect().height - 4) + 'px'; });
      await dormir(300);
      const trop = await suitLeContenu(po, fo);
      ok(trop.corps - trop.cadre >= 3, 'MONTAGE [O] le contenu depasse maintenant le cadre de quelques pixels', JSON.stringify(trop));
      const avantV = await po.evaluate(() => Math.round(scrollY));
      await glisser(cdpO, 390, 844);
      const verrou = { avant: avantV, apres: await po.evaluate(() => Math.round(scrollY)), dedans: await fo.evaluate(() => Math.round(window.scrollY)) };
      ok(verrou.apres > verrou.avant && verrou.dedans === 0, '[O] embarque : meme avec 4 px de trop, le premier geste fait descendre la page, le cadre ne defile pas', JSON.stringify(verrou));
      await attendre(fo, () => !document.querySelector('#goContact').disabled, 25000);
      await fo.tap('#goContact');
      await attendre(fo, () => document.querySelector('.fg-scene[data-scene="contact"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000);
      await auRepos(fo);
      await dormir(400);
      const s4 = await suitLeContenu(po, fo);
      ok(s4.ok, '[O] embarque : aux coordonnees, plus courtes que les heures, le cadre RAPETISSE (plus de vide noir sous le formulaire)', JSON.stringify(s4));
    }
    await ctxO.close();

    // EMBARQUE, 1440x900, a la molette.
    const ctxOb = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pob = await ctxOb.newPage();
    await pob.goto(`${BASE_URL}/reserver/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    let fob = null;
    for (let k = 0; k < 100 && !fob; k += 1) { fob = pob.frames().find((x) => x.url().indexOf('/fungalaxy/libramont?embed=1') >= 0); if (!fob) await dormir(100); }
    const cadreOb = Boolean(fob) && await attendre(fob, () => document.querySelector('#dayLabel') && document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000);
    ok(cadreOb, 'MONTAGE [O] embarque, 1440x900 : le formulaire est monte, catalogue lu');
    if (cadreOb) {
      await auRepos(fob);
      await fob.click('#dayBtn');
      await attendre(fob, () => !document.querySelector('#dayPop').hidden, 3000);
      await dormir(1400);
      const cb = await calVu(pob, fob, true);
      ok(cb.bouton >= 0 && cb.bas <= cb.vh, '[O] embarque, 1440x900 : calendrier ouvert, le bouton et le mois entier dans l ecran de l hote', JSON.stringify(cb));
      const sb1 = await suitLeContenu(pob, fob);
      ok(sb1.ok, '[O] embarque, 1440x900 : le calendrier qui deborde du champ agrandit le cadre (rien de coupe)', JSON.stringify(sb1));
      await allerAuMois(fob, mock.DATE);
      await fob.click(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
      await attendre(fob, () => document.querySelector('#dayPop').hidden, 3000);
      await fob.click('#goActivities');
      await attendre(fob, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000);
      await fob.click('#gridAct .fg-card[data-activity="bowling"]');
      await fob.click('#gridAct .fg-card[data-activity="laser_game"]');
      await fob.click('#goHours');
      await attendre(fob, heuresPretes, 25000);
      await auRepos(fob);
      await dormir(400);
      const sb2 = await suitLeContenu(pob, fob);
      ok(sb2.ok, '[O] embarque, 1440x900 : heures, le cadre a la hauteur du formulaire', JSON.stringify(sb2));
      const db = await descente(pob, fob, async () => { await pob.mouse.move(720, 540); await pob.mouse.wheel(0, 400); await dormir(450); });
      ok(db.gestes >= 2 && db.perdus === 0 && db.sy >= db.max - 1 && db.dedans === 0, '[O] embarque, 1440x900, heures : a la molette, chaque cran fait descendre la page jusqu en bas', JSON.stringify(db));
      await attendre(fob, () => !document.querySelector('#goContact').disabled, 25000);
      await fob.click('#goContact');
      await attendre(fob, () => document.querySelector('.fg-scene[data-scene="contact"].is-active') && !document.querySelector('.fg-scene.is-entering'), 8000);
      await auRepos(fob);
      await dormir(400);
      const sb3 = await suitLeContenu(pob, fob);
      ok(sb3.ok, '[O] embarque, 1440x900 : aux coordonnees, le cadre rapetisse', JSON.stringify(sb3));
    }
    await ctxOb.close();

    // AUTONOME, TELEPHONE : la page elle-meme amene le mois dans l ecran.
    const ctxOa = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const poa = await ctxOa.newPage();
    await poa.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    ok(await attendre(poa, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000), 'MONTAGE [O] autonome, telephone : catalogue lu');
    await auRepos(poa);
    await poa.tap('#dayBtn');
    await attendre(poa, () => !document.querySelector('#dayPop').hidden, 3000);
    await dormir(1400);
    const fa = await fenetreVue(poa, poa, false);
    ok(fa.btnBas + 8 + fa.h > fa.vh - 90, 'MONTAGE [O] autonome, telephone : ouvert sous le bouton, le mois tomberait dans les 90 px du bas de l ecran', JSON.stringify(fa));
    ok(fa.fixe && fa.dansBody && fa.voile && fa.haut >= 90 && fa.bas <= fa.vh - 90 && Math.abs(fa.milieu - fa.vh / 2) <= 3,
      '[O] autonome, telephone : le calendrier est une fenetre au milieu de l ecran, 90 px de marge au moins en haut et en bas, sur un voile', JSON.stringify(fa));
    await ctxOa.close();

    // TABLETTE 768x640, EMBARQUE : au-dessus de 560 px le calendrier s ouvre
    // sous le bouton, et la page du client defile pour le montrer entier.
    const ctxOt = await browser.newContext({ viewport: { width: 768, height: 640 } });
    const pot = await ctxOt.newPage();
    await pot.goto(`${BASE_URL}/reserver/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    let fot = null;
    for (let k = 0; k < 100 && !fot; k += 1) { fot = pot.frames().find((x) => x.url().indexOf('/fungalaxy/libramont?embed=1') >= 0); if (!fot) await dormir(100); }
    const cadreOt = Boolean(fot) && await attendre(fot, () => document.querySelector('#dayLabel') && document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000);
    ok(cadreOt, 'MONTAGE [O] embarque, tablette 768x640 : le formulaire est monte, catalogue lu');
    if (cadreOt) {
      await auRepos(fot);
      await pot.evaluate(() => window.scrollTo(0, 0));
      await dormir(300);
      await fot.click('#dayBtn');
      await attendre(fot, () => !document.querySelector('#dayPop').hidden, 3000);
      await dormir(1600);
      const syT = await pot.evaluate(() => Math.round(scrollY));
      const ct = await fenetreVue(pot, fot, true);
      ok(!ct.fixe && !ct.voile && ct.bas + syT > ct.vh, 'MONTAGE [O] embarque, tablette : le calendrier s ouvre sous le bouton, et le bas du mois tombait sous l ecran de l hote', JSON.stringify(Object.assign({ defile: syT }, ct)));
      ok(ct.btnHaut >= 0 && ct.bas <= ct.vh, '[O] embarque, tablette : a l ouverture, la page du client amene le bouton ET le mois entier dans son ecran', JSON.stringify(ct));
    }
    await ctxOt.close();

    // =====================================================================
    console.log('');
    console.log('[R] PANNES : CATALOGUE COUPE OU EN ROUTE');
    // =====================================================================
    const REPLI_F = 'Le formulaire ne s’est pas chargé. Rechargez la page dans un instant.';
    const alerteR = (p) => p.evaluate(() => { const a = document.querySelector('#fgAlert'); const r = a.getBoundingClientRect(); return { vue: !a.hidden, texte: a.textContent, gauche: Math.round(r.left), droite: Math.round(window.innerWidth - r.right), ecran: document.querySelector('.fg-scene.is-active').dataset.scene }; });
    const ctxR2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctxR2.route((u) => u.pathname === '/api/public-booking-meta', (r) => r.abort());
    const pR2 = await ctxR2.newPage();
    await pR2.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'domcontentloaded' });
    ok(await attendre(pR2, () => document.body.classList.contains('is-ready') && !document.querySelector('#fgAlert').hidden, 10000), '[R] catalogue coupe : l alerte s affiche');
    let aR = await alerteR(pR2);
    ok(plat(aR.texte) === plat(REPLI_F) && !ANGLAIS.test(aR.texte) && aR.gauche >= 20 && aR.droite >= 20, '[R] catalogue coupe : fait constate en francais, alerte hors des bords', JSON.stringify(aR));
    await pR2.click('#goActivities');
    aR = await alerteR(pR2);
    ok(plat(aR.texte) === plat(REPLI_F) && aR.ecran === 'date', '[R] Continuer sans catalogue redit la panne, jamais Choisissez d abord un jour', JSON.stringify(aR));
    await ctxR2.close();
    let lacherMeta = null; const tenu = new Promise((r) => { lacherMeta = r; });
    const ctxR3 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctxR3.route((u) => u.pathname === '/api/public-booking-meta' && u.searchParams.get('calendar') === '45' && !u.searchParams.get('calendarFrom'), async (r) => { await tenu; await r.continue(); });
    const pR3 = await ctxR3.newPage();
    await pR3.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'domcontentloaded' });
    await pR3.click('#goActivities');
    aR = await alerteR(pR3);
    ok(aR.vue && plat(aR.texte) === plat('Le formulaire se charge encore. Réessayez dans un instant.'), '[R] catalogue en route : Continuer dit qu il charge, pas qu il a echoue', JSON.stringify(aR));
    lacherMeta();
    ok(await attendre(pR3, () => document.body.classList.contains('is-ready') && document.querySelector('#fgAlert').hidden, 10000), '[R] catalogue arrive : l alerte d attente s efface');
    await ctxR3.close();

    // =====================================================================
    console.log('');
    console.log('[S] UN TOUCHER N EST PAS UN SURVOL (le double toucher de l iPhone)');
    // =====================================================================
    // Retour de Movsar (2026-09-24) : sur iPhone il fallait toucher DEUX fois
    // une carte d activite pour la cocher. Safari compte un premier toucher
    // comme un survol des qu il devoile quelque chose (la photo, de 0 a 1).
    // Chromium ne rejoue pas cette heuristique : ce qui se prouve ici, c est
    // sa cause. Sur un ecran tactile aucun style de survol ne s applique, et
    // le doigt ne telecharge plus rien en passant.
    const ctxS = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const pS = await ctxS.newPage();
    const photosS = []; pS.on('request', (r) => { if (r.url().indexOf('/assets/fungalaxy/') >= 0) photosS.push(r.url()); });
    await pS.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    ok(await attendre(pS, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000), 'MONTAGE [S] telephone : le catalogue est lu');
    const feuilleS = await pS.evaluate(() => {
      const dedans = []; const hors = [];
      const parcourir = (regles, sousSurvol) => {
        Array.from(regles).forEach((r) => {
          if (r.type === CSSRule.MEDIA_RULE) { parcourir(r.cssRules, sousSurvol || /\(\s*hover\s*:\s*hover\s*\)/.test(r.media.mediaText)); return; }
          if (r.type === CSSRule.STYLE_RULE) { if (/:hover/.test(r.selectorText)) (sousSurvol ? dedans : hors).push(r.selectorText); return; }
          if (r.cssRules) parcourir(r.cssRules, sousSurvol);
        });
      };
      const feuille = Array.from(document.styleSheets).find((s) => (s.href || '').indexOf('/assets/fungalaxy-booking.css') >= 0);
      if (feuille) parcourir(feuille.cssRules, false);
      return { lue: Boolean(feuille), dedans, hors, sansSurvol: matchMedia('(hover: none)').matches && !matchMedia('(hover: hover)').matches };
    });
    ok(feuilleS.lue && feuilleS.dedans.indexOf('.fg-card:hover .fg-card__photo') >= 0 && feuilleS.hors.length === 0,
      '[S] feuille servie : chaque regle :hover est sous @media (hover: hover), celle de la photo des cartes comprise', JSON.stringify({ sous: feuilleS.dedans.length, hors: feuilleS.hors }));
    ok(feuilleS.sansSurvol, 'MONTAGE [S] le telephone emule ne survole pas : (hover: none)');
    await pS.tap('#goActivities');
    ok(await attendre(pS, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000), 'MONTAGE [S] telephone : ecran des activites');
    // Deux cartes avec photo : l une se touche, l autre se fait seulement
    // effleurer par un doigt qui fait defiler.
    const [idTouche, idEffleure] = await pS.evaluate(() => Array.from(document.querySelectorAll('#gridAct .fg-card:not(.is-off)')).filter((c) => c.querySelector('.fg-card__photo img[data-src]')).map((c) => c.dataset.activity));
    const lireCarteS = (id) => pS.evaluate((i) => {
      const c = document.querySelector(`#gridAct .fg-card[data-activity="${i}"]`);
      const ph = c.querySelector('.fg-card__photo');
      const img = ph && ph.querySelector('img');
      return { coche: c.getAttribute('aria-checked'), survolee: c.matches(':hover'), opacite: ph ? getComputedStyle(ph).opacity : null, enAttente: Boolean(img && img.dataset.src) };
    }, id);
    await pS.tap(`#gridAct .fg-card[data-activity="${idTouche}"]`);
    await dormir(700);
    const touche1 = await lireCarteS(idTouche);
    ok(touche1.coche === 'true' && touche1.opacite === '0.55', '[S] telephone : UN toucher coche la carte, et sa photo prend le voile de la carte cochee (0,55), jamais le plein du survol', JSON.stringify(Object.assign({ id: idTouche }, touche1)));
    await pS.tap(`#gridAct .fg-card[data-activity="${idTouche}"]`);
    await dormir(700);
    const touche2 = await lireCarteS(idTouche);
    ok(touche2.coche === 'false' && touche2.opacite === '0', '[S] telephone : decochee au toucher suivant, la photo repart a 0 (le survol ne reste plus colle a la carte touchee)', JSON.stringify(touche2));
    // Un doigt se pose sur une carte et fait defiler, au vrai geste.
    await pS.locator(`#gridAct .fg-card[data-activity="${idEffleure}"]`).scrollIntoViewIfNeeded();
    const boiteS = await pS.locator(`#gridAct .fg-card[data-activity="${idEffleure}"]`).boundingBox();
    const cdpS = await ctxS.newCDPSession(pS);
    const xS = Math.round(boiteS.x + boiteS.width / 2); const yS = Math.round(boiteS.y + boiteS.height / 2);
    const avantEffleure = photosS.length;
    await cdpS.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: xS, y: yS }] });
    for (let k = 1; k <= 6; k += 1) { await cdpS.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: xS, y: yS - k * 12 }] }); await dormir(16); }
    await cdpS.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await dormir(600);
    const effleure = await lireCarteS(idEffleure);
    ok(effleure.coche === 'false' && effleure.enAttente && photosS.length === avantEffleure, '[S] telephone : un doigt qui fait defiler sur une carte ne la coche pas et ne telecharge pas sa photo', JSON.stringify({ id: idEffleure, coche: effleure.coche, enAttente: effleure.enAttente, demandees: photosS.slice(avantEffleure) }));
    await ctxS.close();
    // Bureau, souris : le survol devoile toujours la photo.
    const ctxSb = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pSb = await ctxSb.newPage();
    await pSb.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    await attendre(pSb, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000);
    await pSb.click('#goActivities');
    await attendre(pSb, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000);
    const idSb = await pSb.evaluate(() => { const c = Array.from(document.querySelectorAll('#gridAct .fg-card:not(.is-off)')).find((x) => x.querySelector('.fg-card__photo img[data-src]')); return c && c.dataset.activity; });
    await pSb.hover(`#gridAct .fg-card[data-activity="${idSb}"]`);
    const survolSb = await attendre(pSb, (i) => { const ph = document.querySelector(`#gridAct .fg-card[data-activity="${i}"] .fg-card__photo`); const img = ph.querySelector('img'); return getComputedStyle(ph).opacity === '1' && !img.dataset.src && img.complete && img.naturalWidth > 0; }, 3000, idSb);
    ok(survolSb && await pSb.evaluate(() => matchMedia('(hover: hover)').matches), '[S] bureau : la souris survole toujours, la photo se telecharge et se devoile en plein', idSb);
    await ctxSb.close();

    // =====================================================================
    console.log('');
    console.log('[T] LE TELEPHONE EN DEUX COLONNES, LE BOUTON DE LA BARRE SUR UNE LIGNE, LA QUESTION D ABORD');
    // =====================================================================
    // Retours de Movsar (2026-09-24) sur telephone : « Ces horaires me vont »
    // coupe en deux lignes a 360 px, la carte de la visite posee avant le
    // titre de l ecran des coordonnees ; et les activites, passees en liste
    // d une carte par rangee le matin, reviennent a deux par rangee le soir
    // (« c est moche, c etait bien avant, range de deux »).
    for (const [lT, hT] of [[390, 844], [360, 740], [320, 660]]) {
      const ctxT = await browser.newContext({ viewport: { width: lT, height: hT }, isMobile: true, hasTouch: true });
      const pT = await ctxT.newPage();
      await pT.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
      ok(await attendre(pT, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000), `MONTAGE [T] ${lT} px : le catalogue est lu`);
      // UN JOUR FUTUR EXPLICITE : le jour propose est aujourd hui, et le soir
      // plus rien n y tient avant la fermeture (vu le 2026-09-24 a 20:30 :
      // « Aucune combinaison disponible ce jour-la », le gate rougissait selon
      // l heure). Le samedi du mock, comme [N].
      await pT.tap('#dayBtn');
      await allerAuMois(pT, mock.DATE);
      await pT.tap(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
      await attendre(pT, () => document.querySelector('#dayPop').hidden, 3000);
      await pT.tap('#goActivities');
      await attendre(pT, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000);
      await attendre(pT, () => Array.from(document.querySelectorAll('#gridAct .fg-card')).every((c) => c.getAnimations().length === 0), 4000);
      const grilleT = await pT.evaluate(() => {
        const grille = document.querySelector('#gridAct').getBoundingClientRect();
        return Array.from(document.querySelectorAll('#gridAct .fg-card')).map((c) => {
          const r = c.getBoundingClientRect();
          return { id: c.dataset.activity, gauche: Math.round(r.left - grille.left), droite: Math.round(grille.right - r.right), haut: Math.round(r.top), largeur: Math.round(r.width) };
        });
      });
      // Deux cartes par rangee des 380 px, une seule en dessous : trois
      // cibles de compteur de 44 px doivent rester dans chaque carte.
      const colonnesT = new Set(grilleT.map((c) => c.gauche)).size;
      const attenduesT = lT >= 380 ? 2 : 1;
      const rangeesT = new Map();
      grilleT.forEach((c) => { rangeesT.set(c.haut, (rangeesT.get(c.haut) || 0) + 1); });
      const fautesT = grilleT.filter((c) => c.gauche < 0 || c.droite < 0);
      ok(grilleT.length >= 6 && colonnesT === attenduesT && fautesT.length === 0 && [...rangeesT.values()].every((n) => n <= attenduesT),
        `[T] ${lT} px : ${attenduesT === 2 ? 'deux cartes d activites par rangee' : 'une carte par rangee (sous 380 px, les cibles restent a 44 px)'}, rien hors de la grille`,
        JSON.stringify({ cartes: grilleT.length, colonnes: colonnesT, rangees: [...rangeesT.values()], fautes: fautesT.slice(0, 3), exemple: grilleT.slice(0, 2) }));
      await pT.tap('#gridAct .fg-card[data-activity="bowling"]');
      await pT.tap('#gridAct .fg-card[data-activity="laser_game"]');
      await attendre(pT, () => ['bowling', 'laser_game'].every((id) => document.querySelector(`#gridAct li[data-activity="${id}"] .fg-card__optin`).getBoundingClientRect().height > 40), 3000);
      await dormir(450);
      const tiroirsT = await pT.evaluate(() => ['bowling', 'laser_game'].map((id) => {
        const li = document.querySelector(`#gridAct li[data-activity="${id}"]`);
        const carte = li.querySelector('.fg-card').getBoundingClientRect();
        const boite = li.querySelector('.fg-card__optbox').getBoundingClientRect();
        const hauts = Array.from(li.querySelectorAll('.fg-pill')).map((p) => Math.round(p.getBoundingClientRect().top));
        return { id, pastilles: hauts.length, rangees: new Set(hauts).size, largeur: Math.round(boite.width), carte: Math.round(carte.width), colle: Math.round(boite.top - carte.bottom) };
      }));
      ok(tiroirsT.every((t) => Math.abs(t.largeur - t.carte) <= 1 && t.colle >= -1),
        `[T] ${lT} px : le tiroir prend la largeur de sa carte, sous elle`, JSON.stringify(tiroirsT));
      await pT.tap('#goHours');
      ok(await attendre(pT, () => document.querySelector('.fg-scene[data-scene="heures"].is-active') && !document.querySelector('.fg-scene.is-entering') && !document.querySelector('#hourZone').classList.contains('is-busy') && !document.querySelector('#goContact').disabled, 25000), `MONTAGE [T] ${lT} px : ecran des heures, bouton actif`);
      const boutonT = await pT.evaluate(() => {
        const b = document.querySelector('#goContact');
        const l = document.querySelector('#keepLabel');
        const cs = getComputedStyle(b);
        const rb = b.getBoundingClientRect(); const rl = l.getBoundingClientRect();
        const ln = parseFloat(getComputedStyle(l).lineHeight) || parseFloat(cs.fontSize) * 1.25;
        return { texte: l.textContent, lignes: Math.round(rl.height / ln), dedans: rl.left >= rb.left + parseFloat(cs.paddingLeft) - 1 && rl.right <= rb.right - parseFloat(cs.paddingRight) + 1, police: parseFloat(cs.fontSize), bouton: Math.round(rb.width) };
      });
      ok(boutonT.lignes === 1 && boutonT.dedans && boutonT.police >= 11.5, `[T] ${lT} px : « ${boutonT.texte} » tient sur UNE ligne, dans le bouton, sans police sous 11,5 px`, JSON.stringify(boutonT));
      await pT.tap('#goContact');
      ok(await attendre(pT, () => document.querySelector('.fg-scene[data-scene="contact"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000), `MONTAGE [T] ${lT} px : ecran des coordonnees`);
      const ordreT = await pT.evaluate(() => {
        const s = document.querySelector('.fg-scene[data-scene="contact"]');
        const h = (sel) => { const r = s.querySelector(sel).getBoundingClientRect(); return { haut: Math.round(r.top), bas: Math.round(r.bottom), gauche: Math.round(r.left), droite: Math.round(r.right) }; };
        return { photo: h('.fg-art'), fil: h('.fg-steps'), titre: h('.fg-title'), carte: h('#recall'), champ: h('#cPrenom'), bouton: h('#goRecap'), largeur: document.documentElement.clientWidth };
      });
      const rangeT = ordreT.photo.bas <= ordreT.fil.haut && ordreT.fil.bas <= ordreT.titre.haut && ordreT.titre.bas <= ordreT.carte.haut && ordreT.carte.bas <= ordreT.champ.haut && ordreT.champ.bas <= ordreT.bouton.haut;
      const margesT = [ordreT.fil, ordreT.titre, ordreT.carte, ordreT.champ].every((b) => b.gauche >= 16 && b.droite <= ordreT.largeur - 16);
      ok(rangeT && margesT, `[T] ${lT} px : l ecran des coordonnees s ouvre sur sa question (photo, fil, titre), puis la carte de la visite, puis les champs, dans les marges`, JSON.stringify(ordreT));
      await ctxT.close();
    }
    // Au-dessus du telephone : les activites restent des cartes (deux par
    // rangee a 768), et la barre du bas tient ses deux boutons sur une
    // rangee et son resume sur une ligne, a 768 comme a 600 px. Avant : a
    // 768, « Retour » passait au-dessus de « Ces horaires me vont » ; a 600,
    // le resume des heures tombait sur trois lignes.
    for (const [lTt, hTt] of [[768, 1024], [600, 900]]) {
      const ctxTt = await browser.newContext({ viewport: { width: lTt, height: hTt }, hasTouch: true });
      const pTt = await ctxTt.newPage();
      await pTt.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
      await attendre(pTt, () => document.querySelector('#dayLabel').textContent.trim() !== 'Choisir un jour', 15000);
      await pTt.tap('#dayBtn');
      await allerAuMois(pTt, mock.DATE);
      await pTt.tap(`#calGrid .fg-cal__day[data-date="${mock.DATE}"]`);
      await attendre(pTt, () => document.querySelector('#dayPop').hidden, 3000);
      await pTt.tap('#goActivities');
      await attendre(pTt, () => document.querySelector('.fg-scene[data-scene="activites"].is-active') && !document.querySelector('.fg-scene.is-entering'), 6000);
      if (lTt === 768) {
        const colonnesTt = await pTt.evaluate(() => new Set(Array.from(document.querySelectorAll('#gridAct .fg-card')).map((c) => Math.round(c.getBoundingClientRect().left))).size);
        ok(colonnesTt === 2, '[T] tablette 768 : les activites restent des cartes, deux par rangee', `${colonnesTt} colonne(s)`);
      }
      await pTt.tap('#gridAct .fg-card[data-activity="bowling"]');
      await pTt.tap('#gridAct .fg-card[data-activity="laser_game"]');
      await dormir(500);
      const lireBarreT = () => pTt.evaluate(() => {
        const d = document.querySelector('.fg-scene.is-active .fg-dock');
        const c = d.querySelector('.fg-bar__count');
        const bs = Array.from(d.querySelectorAll('.fg-btn')).map((x) => x.getBoundingClientRect());
        const ln = parseFloat(getComputedStyle(c).lineHeight) || parseFloat(getComputedStyle(c).fontSize) * 1.3;
        const g = d.querySelector('.fg-btn--ghost'), p = d.querySelector('.fg-btn:not(.fg-btn--ghost)');
        return { resume: c.textContent.trim(), lignes: Math.round(c.getBoundingClientRect().height / ln), rangee: bs.length === 2 && Math.abs((bs[0].top + bs[0].bottom) - (bs[1].top + bs[1].bottom)) < 2, dedans: bs.every((r) => r.left >= 0 && r.right <= document.documentElement.clientWidth),
          tailles: [g.offsetWidth, g.offsetHeight, p.offsetHeight], carre: Math.abs(g.offsetHeight - p.offsetHeight) <= 1 && Math.abs(g.offsetWidth - g.offsetHeight) <= 1,
          suit: d.classList.contains('is-stuck') || getComputedStyle(d).position === 'sticky' };
      });
      const barreActT = await lireBarreT();
      await pTt.tap('#goHours');
      await attendre(pTt, () => document.querySelector('.fg-scene[data-scene="heures"].is-active') && !document.querySelector('.fg-scene.is-entering') && !document.querySelector('#hourZone').classList.contains('is-busy') && !document.querySelector('#goContact').disabled, 25000);
      await dormir(400);
      const barreHeuT = await lireBarreT();
      ok([barreActT, barreHeuT].every((x) => x.lignes === 1 && x.rangee && x.dedans),
        `[T] tablette ${lTt} px : la barre du bas tient ses deux boutons sur une rangee et son resume sur une ligne (activites et heures)`, JSON.stringify({ activites: barreActT, heures: barreHeuT }));
      ok([barreActT, barreHeuT].every((x) => !x.suit),
        `[T] tablette ${lTt} px : la barre du bas ne suit pas l ecran, elle reste a sa place (activites et heures)`, JSON.stringify({ activites: barreActT.suit, heures: barreHeuT.suit }));
      ok([barreActT, barreHeuT].every((x) => x.carre),
        `[T] tablette ${lTt} px : le retour de la barre est un carre, de la hauteur du bouton qui avance (largeur, hauteur du retour, hauteur du bouton)`, JSON.stringify({ activites: barreActT.tailles, heures: barreHeuT.tailles }));
      await ctxTt.close();
    }

    // =====================================================================
    console.log('');
    console.log('[H] MOUVEMENT REDUIT');
    // =====================================================================
    const calme = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const pageCalme = await calme.newPage();
    await pageCalme.goto(`${BASE_URL}/fungalaxy/libramont`, { waitUntil: 'networkidle', timeout: 45000 });
    const anims = await pageCalme.evaluate(() => Array.from(document.querySelectorAll('.fg-scene.is-active .fg-title .w > span, .fg-scene.is-active .fg-art img, .fg-scene.is-active .fg-rise, .fg-curtain, .fg-glow i')).map((el) => getComputedStyle(el).animationName).filter((n) => n && n !== 'none'));
    ok(anims.length === 0, '[H] avec prefers-reduced-motion, plus aucune animation (rideau compris)', anims.join(', ') || 'aucune');
    ok(await pageCalme.evaluate(() => getComputedStyle(document.querySelector('.fg-curtain')).visibility === 'hidden'), '[H] sans animation, le rideau n existe pas (invisible par defaut)');
    // L anneau de l ecran final est dans la page des le chargement : son style
    // se lit sans refaire le parcours.
    const cocheCalme = await pageCalme.evaluate(() => { const s = document.querySelector('.fg-done__ring svg'); if (!s) return null; const cs = getComputedStyle(s); return { tirets: cs.strokeDasharray, decalage: cs.strokeDashoffset }; });
    ok(Boolean(cocheCalme) && (cocheCalme.tirets === 'none' || parseFloat(cocheCalme.decalage) === 0), '[H] sans animation, la coche de l ecran final est dessinee d office (plus de trait en attente d un trace qui ne vient pas)', JSON.stringify(cocheCalme));
    await calme.close();
  } finally {
    await browser.close();
    srv.close();
  }
  console.log('');
  if (failures) { console.error(`fungalaxy-form-check: ${failures} verification(s) en echec.`); process.exit(1); }
  console.log('fungalaxy-form-check: ALL OK');
}

main().catch((error) => { console.error(error && error.stack || error); process.exit(1); });
