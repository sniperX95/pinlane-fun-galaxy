# Market playbook : cerveau marketing Pinlane (FEC)

Connaissance distillée de 4 recherches sourcées (2026-07-13, détail : vault Projects/pinlane/research/).
Niveaux : [solide] = sourcé/audité · [plausible] = recoupé faible · [local] = à établir avec NOS données.
Règle d'or : ce fichier donne des STRATÉGIES ; les CHIFFRES du centre viennent toujours de la base (facts SQL), jamais d'ici.

## 1. Les leviers qui rapportent (classés par preuve)

1. **Anniversaires** : le moteur n°1. [solide, ROLLER 2025 : données transactionnelles réelles] Un invité d'anniversaire dépense +44 % vs visiteur normal, et 46-48 % reviennent ensuite (vs 21,8 %). Chaque fête = une machine à recruter des familles. → Relancer AVANT la date anniversaire de l'enfant : séquence J-60 / J-30 / J-15 / J-0 [plausible, convergent]. Post-fête : merci sous 48 h + offre retour limitée.
2. **Réservation en ligne** : panier 3-4× plus gros en ligne qu'au guichet ; l'EMEA fait déjà 64 % du CA en ligne [solide, ROLLER]. Tout ce qui pousse vers la résa en ligne paie.
3. **Fidélité/pass** : les membres viennent +261 % plus souvent [solide, ROLLER].
4. **Parrainage** : un parrainé convertit 4× mieux, LTV +16 % [solide générique] : « amène un copain, ses parents repartent avec 10 € ».
5. **Heures creuses** : en Belgique : les vrais creux sont **mardi/jeudi en journée hors vacances**. Le **mercredi après-midi n'est PAS un creux** (les enfants n'ont pas cours). Formats qui marchent : ladies night ciblée FB Ads femmes 25-55 sans jargon bowling (cas documenté : 80 % des inscriptions via FB Ads) [solide, cas nommé], seniors mardi/jeudi 14-17 h, afterwork « team building sans PowerPoint » [plausible].
6. **Simplicité de l'offre** : cas Atomic Golf : 8-9 formules réduites à 3 → réservations ×10 [solide, biais vendeur]. Moins de choix = plus de ventes.

## 2. Météo (spécifique Libramont : IRM normales officielles)

- Seuils LOCAUX : « chaud » ≥23 °C, « très chaud » ≥25 °C (18 j/an), ≥30 °C quasi inexistant (1,5 j/an, ne pas attendre ce seuil). « Pluie marquante » ≥10 mm (39 j/an ; ≥1 mm = 43 % des jours, trop banal).
- **Le sens de l'effet météo sur NOTRE fréquentation est à établir localement** : la littérature se contredit (étude peer-reviewed cinéma : chaleur ET pluie forte = négatif, la mobilité domine ; cas Mini World Lyon canicule 2026 : +900 % de recherches « climatisé »). → Ne JAMAIS présumer : lire les facts SQL. [local]
- **Anticiper, pas réagir** : agir sur la PRÉVISION J+2/J+3 (post jeudi pour un weekend pluvieux annoncé) [solide comme pattern].
- Angle message chaleur : confort (« 21° chez nous »), pas l'activité. Angle pluie : refuge + offre à durée limitée le jour même.

## 3. Calendrier (leviers datés, Belgique)

- Congés FWB = pics familles : Toussaint, Noël, Carnaval, Pâques/printemps, été (dates exactes en base, `isSchoolHolidayFWB`). Poster l'offre vacances ~10-14 j avant chaque congé.
- **Foire de Libramont 24-27/07/2026** (100ᵉ édition, plus grande foire agricole plein air d'Europe, à 5 min) + Demo Forest 28-29/07 Bertrix : afflux massif, post dédié « pause fraîcheur à 5 min de la Foire ».
- Mercredi = jour des enfants (pas cours) : programmation famille récurrente.

## 4. Canaux (Belgique francophone, CIM 2025 [solide])

- **Facebook = pilier local** : 1 Event par soirée/animation (visibilité amis + recherche locale) ; les groupes « bons plans » provinciaux battent souvent une semaine de posts. Instagram : 51,7 % de pénétration, Stories = canal de conversion (lien résa + urgence) ; Reels 3-4×/sem. TikTok : 52,4 % des jeunes francophones, engagement fort mais second. Google Business Profile : 1-3 posts/sem (un post expire à 7 j), meilleur engagement mardi/mercredi.
- Email : piloter au CLIC, pas à l'ouverture (Apple MPP rend l'ouverture peu fiable). Dormants : séquence 3-5 emails espacés 7-14 j, réactivation 10-15 % si segmentée [plausible]. Segmentation minimale : fréquents / dormants / familles anniversaire.

## 5. Garde-fous de l'agent (non négociables)

- **Insight-only** : l'agent PROPOSE, l'humain applique. Jamais d'action irréversible autonome. [pattern dominant des déploiements 2025-2026]
- **Zéro chiffre inventé** : tout chiffre affiché vient d'un fact SQL du run courant, avec sa taille d'échantillon (« sur 34 samedis pluvieux »). <90 jours de données = tout est « exploratoire », le dire.
- **Mesurer ses idées** : chaque idée appliquée → avant/après contrôlé (même jour de semaine, vacances comparables) à J+14 → validée/réfutée/incertaine. Les leçons s'accumulent en base. (Cas d'échec de référence : agent qui a gaspillé 47 k$ en répétant 8 semaines une reco fondée sur une donnée fausse.)
- **Max 3 idées à la fois** : mieux vaut 1 idée appliquée que 10 ignorées. Pas de re-proposition <7 j d'une idée ignorée.
- Prudence sources : la plupart des « stats FEC » du web sont du contenu-ferme IA, seules références fiables : ROLLER benchmark, SEC 10-K, IRM, CIM, études peer-reviewed.

## 6. Posts de référence (à adapter, jamais copier tel quel)

1. Canicule (jour J, Story) : « 33° dehors, 21° chez nous. Portes ouvertes jusqu'à 22h. »
2. Pluie (jour J) : « Pluie toute la journée ? -20 % sur la 2ᵉ partie avant 17h, zéro goutte chez nous. »
3. Anniversaire J-30 (email/SMS) : « L'anniversaire de [prénom] approche ? Réserve avant le [date], le gâteau est offert. »
4. Parrainage fête : « Amène un copain à l'anniversaire, ses parents repartent avec 10 € pour leur prochaine visite. »
5. Ladies night : visuel copines/bulles, zéro jargon bowling, FB Ads femmes 25-55.
6. Seniors : « Mardi et jeudi 14h-17h : bowling tranquille + café offert. »
7. Afterwork B2B : « Team building sans PowerPoint : laser + bowling dès 10 personnes. »
8. Event FB par soirée à thème (minigolf blacklight) avec RSVP.
9. Reel coulisses (« mise en place du matin »).
10. Foire de Libramont : « Trop de monde à la Foire ? Pause fraîcheur à 5 min, on est climatisés. »
