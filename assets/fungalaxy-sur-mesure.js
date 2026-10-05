/*
 * LA DEMANDE SUR MESURE DU FORMULAIRE FUN GALAXY, CHARGEE A LA DEMANDE.
 *
 * Movsar, 2026-09-28 : « tout groupe superieur a 30 donc a partir 31 tout
 * groupe sera redirige vers une demande sur mesure ... une reponse max 24h
 * ouvrable et ils peuvent pas reserver le jour meme prcq faut au moins 24h »,
 * puis « il doit avoir son propre truc avec toutes formules dispo, si non
 * pourquoi, choix des activites, un truc super complet ».
 *
 * Cinq ecrans (le groupe, la date et le moment, les envies, les coordonnees,
 * la relecture) puis l ecran final du formulaire. Ce fichier et sa feuille ne
 * partent qu a qui ouvre la demande (assets/fungalaxy-booking.js les charge au
 * seuil ou a la porte) : le parcours de reservation n en paie rien.
 *
 * `window.FGSurMesure(I)` : I porte les outils, l etat et le calendrier du
 * formulaire (voir interne() dans fungalaxy-booking.js). La fabrique entre les
 * ecrans dans la page, puis rend { ouvrir, rafraichir }.
 *
 * Les REGLES (moments du jour, 24 heures, verdicts des formules et des
 * activites) sont celles du serveur, lib/custom-request.js, recopiees ici sous
 * les memes noms : le gate sur-mesure-check les compare sur une grille.
 */
(function () {
  'use strict';

  // Les icones propres a la demande, ajoutees au jeu d icones de la page.
  var SYMBOLES = '<symbol id="o-association" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4"/><path d="M5 4h12l-2.5 4.5L17 13H5"/></symbol><symbol id="i-journee" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18h18"/><path d="M6 18a6 6 0 0 1 12 0"/><path d="M12 5v3M4.5 9.5l2 2M19.5 9.5l-2 2"/></symbol><symbol id="i-any" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></symbol><symbol id="i-bulb" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z"/></symbol>';

  // Les cinq ecrans.
  var ECRANS = `    <section class="fg-scene fg-scene--split" data-scene="sm-groupe" aria-labelledby="t-smg">
      <div class="fg-art"><img sizes="(max-width: 560px) 260px, (min-width: 900px) 52vw, 100vw" alt="" decoding="async"></div>
      <form class="fg-scene__body" id="smGroupeForm" novalidate>
        <ol class="fg-steps" data-steps></ol>
        <span class="fg-sm-kicker fg-rise" style="--i:0"><svg aria-hidden="true"><use href="#i-users"/></svg>Demande sur mesure</span>
        <h2 class="fg-title" id="t-smg" data-words>Parlez-nous<br><em>de votre groupe</em></h2>
        <p class="fg-sub fg-rise" style="--i:1" id="smGroupeSub">L’équipe compose votre venue et vous répond sous 24&nbsp;heures ouvrables.</p>
        <div class="fg-fields fg-sm-fields">
          <div class="fg-field fg-rise" style="--i:2">
            <span class="fg-field__label" id="lSmType">Vous êtes</span>
            <div class="fg-occasions fg-sm-types" id="smTypes" role="radiogroup" aria-labelledby="lSmType" aria-describedby="eSmType" aria-required="true">
              <button type="button" class="fg-occasion" role="radio" aria-checked="false" tabindex="0" data-type="ecole"><svg aria-hidden="true"><use href="#o-ecole"/></svg>École, jeunesse</button>
              <button type="button" class="fg-occasion" role="radio" aria-checked="false" tabindex="-1" data-type="entreprise"><svg aria-hidden="true"><use href="#o-entreprise"/></svg>Entreprise</button>
              <button type="button" class="fg-occasion" role="radio" aria-checked="false" tabindex="-1" data-type="association"><svg aria-hidden="true"><use href="#o-association"/></svg>Association, club</button>
              <button type="button" class="fg-occasion" role="radio" aria-checked="false" tabindex="-1" data-type="anniversaire"><svg aria-hidden="true"><use href="#o-anniversaire"/></svg>Anniversaire</button>
              <button type="button" class="fg-occasion" role="radio" aria-checked="false" tabindex="-1" data-type="evg"><svg aria-hidden="true"><use href="#o-evg"/></svg>EVG / EVJF</button>
              <button type="button" class="fg-occasion" role="radio" aria-checked="false" tabindex="-1" data-type="amis"><svg aria-hidden="true"><use href="#o-amis"/></svg>Amis, famille</button>
              <button type="button" class="fg-occasion" role="radio" aria-checked="false" tabindex="-1" data-type="autre"><svg aria-hidden="true"><use href="#o-autre"/></svg>Autre groupe</button>
            </div>
            <span class="fg-field__error" id="eSmType"></span>
          </div>
          <div class="fg-field fg-rise" style="--i:3" id="smOrgWrap" hidden>
            <label class="fg-field__label" for="smOrg" id="lSmOrg">Nom de l’organisation</label>
            <input class="fg-input" id="smOrg" name="organisation" maxlength="160" autocomplete="organization" aria-describedby="eSmOrg" enterkeyhint="next">
            <span class="fg-field__error" id="eSmOrg"></span>
          </div>
          <div class="fg-sm-counts">
            <div class="fg-field fg-rise" style="--i:4">
              <label class="fg-field__label" for="smPax">Participants</label>
              <div class="fg-stepper" role="group" aria-label="Nombre de participants">
                <button type="button" class="fg-stepper__btn" id="smPaxMinus" aria-label="Un participant de moins">&minus;</button>
                <div class="fg-stepper__value" id="smPaxValue">
                  <input class="fg-stepper__input" id="smPax" type="number" inputmode="numeric" min="1" max="1000" step="1" value="31" autocomplete="off" aria-describedby="smPaxHint">
                  <span class="fg-stepper__unit" aria-hidden="true">joueurs</span>
                </div>
                <button type="button" class="fg-stepper__btn" id="smPaxPlus" aria-label="Un participant de plus">+</button>
              </div>
              <span class="fg-field__hint" id="smPaxHint">Ceux qui jouent.</span>
            </div>
            <div class="fg-field fg-rise" style="--i:5">
              <label class="fg-field__label" for="smComp">Accompagnateurs <span class="fg-field__opt">(facultatif)</span></label>
              <div class="fg-stepper fg-stepper--compact" role="group" aria-label="Nombre d’accompagnateurs qui ne jouent pas">
                <button type="button" class="fg-stepper__btn" id="smCompMinus" aria-label="Un accompagnateur de moins">&minus;</button>
                <div class="fg-stepper__value" id="smCompValue">
                  <input class="fg-stepper__input" id="smComp" type="number" inputmode="numeric" min="0" max="1000" step="1" value="0" autocomplete="off" aria-describedby="smCompHint">
                </div>
                <button type="button" class="fg-stepper__btn" id="smCompPlus" aria-label="Un accompagnateur de plus">+</button>
              </div>
              <span class="fg-field__hint" id="smCompHint">Enseignants, parents, encadrants qui ne jouent pas.</span>
            </div>
          </div>
          <div class="fg-field fg-rise" style="--i:6">
            <span class="fg-field__label" id="lSmAges">Âge des participants <span class="fg-field__opt">(facultatif, plusieurs choix)</span></span>
            <div class="fg-sm-chips" id="smAges" role="group" aria-labelledby="lSmAges" aria-describedby="smAgesHint">
              <button type="button" class="fg-sm-chip" role="checkbox" aria-checked="false" data-age="moins7">Moins de 7&nbsp;ans</button>
              <button type="button" class="fg-sm-chip" role="checkbox" aria-checked="false" data-age="7-12">7 à 12&nbsp;ans</button>
              <button type="button" class="fg-sm-chip" role="checkbox" aria-checked="false" data-age="13-17">13 à 17&nbsp;ans</button>
              <button type="button" class="fg-sm-chip" role="checkbox" aria-checked="false" data-age="adultes">Adultes</button>
            </div>
            <span class="fg-field__hint" id="smAgesHint">Certaines activités ont un âge minimum&nbsp;: vous le verrez en choisissant vos envies.</span>
          </div>
        </div>
        <div class="fg-actions fg-rise" style="--i:7">
          <button type="button" class="fg-btn fg-btn--ghost" data-back><svg aria-hidden="true"><use href="#i-back"/></svg><span class="fg-btn__txt">Retour</span></button>
          <button type="submit" class="fg-btn" id="smGoDate">Choisir la date<svg aria-hidden="true"><use href="#i-arrow"/></svg></button>
        </div>
      </form>
    </section>

    <section class="fg-scene fg-scene--split fg-scene--art-left" data-scene="sm-date" aria-labelledby="t-smd">
      <div class="fg-art"><img sizes="(max-width: 560px) 260px, (min-width: 900px) 52vw, 100vw" alt="" decoding="async"></div>
      <form class="fg-scene__body" id="smDateForm" novalidate>
        <ol class="fg-steps" data-steps></ol>
        <span class="fg-sm-kicker fg-rise" style="--i:0"><svg aria-hidden="true"><use href="#i-users"/></svg>Demande sur mesure</span>
        <h2 class="fg-title" id="t-smd" data-words>Quand<br><em>venez-vous&nbsp;?</em></h2>
        <p class="fg-sub fg-rise" style="--i:1">Pas le jour même&nbsp;: une demande sur mesure se prépare au moins 24&nbsp;heures à l’avance.</p>
        <div class="fg-fields fg-sm-fields">
          <div class="fg-sm-dates" id="smDates">
            <div class="fg-field fg-rise" style="--i:2" id="smDateWrap">
              <span class="fg-field__label" id="lSmDate">Date souhaitée</span>
              <div class="fg-day">
                <button type="button" class="fg-day__btn" id="smDateBtn" aria-haspopup="dialog" aria-expanded="false" aria-controls="dayPop" aria-labelledby="lSmDate smDateBtn" aria-describedby="eSmDate">
                  <svg aria-hidden="true"><use href="#i-calendar"/></svg>
                  <span id="smDateLabel">Choisir une date</span>
                  <svg class="chev" aria-hidden="true"><use href="#i-chevron"/></svg>
                </button>
              </div>
              <span class="fg-field__hint fg-field__hint--day" id="smDateHint" aria-live="polite"></span>
              <span class="fg-field__error" id="eSmDate"></span>
            </div>
            <div class="fg-field fg-rise" style="--i:3" id="smDate2Wrap">
              <span class="fg-field__label" id="lSmDate2">Une autre date possible&nbsp;? <span class="fg-field__opt">(facultatif)</span></span>
              <div class="fg-day fg-day--alt">
                <button type="button" class="fg-day__btn" id="smDate2Btn" aria-haspopup="dialog" aria-expanded="false" aria-controls="dayPop" aria-labelledby="lSmDate2 smDate2Btn" aria-describedby="eSmDate2">
                  <svg aria-hidden="true"><use href="#i-calendar"/></svg>
                  <span id="smDate2Label">Ajouter une date</span>
                  <svg class="chev" aria-hidden="true"><use href="#i-chevron"/></svg>
                </button>
                <button type="button" class="fg-day__clear" id="smDate2Clear" aria-label="Retirer l’autre date" hidden>&times;</button>
              </div>
              <span class="fg-field__hint fg-field__hint--day" id="smDate2Hint" aria-live="polite"></span>
              <span class="fg-field__error" id="eSmDate2"></span>
            </div>
          </div>
          <label class="fg-check fg-rise" style="--i:4" id="smFlexWrap">
            <input type="checkbox" id="smFlexible">
            <span class="fg-check__box"><svg aria-hidden="true"><use href="#i-check"/></svg></span>
            <span>Notre date n’est pas encore fixée</span>
          </label>
          <div class="fg-field" id="smPeriodWrap" hidden>
            <label class="fg-field__label" for="smPeriod">La période envisagée</label>
            <input class="fg-input" id="smPeriod" name="periode" maxlength="160" placeholder="Ex.&nbsp;: un mercredi après-midi de novembre" aria-describedby="eSmPeriod" autocomplete="off">
            <span class="fg-field__error" id="eSmPeriod"></span>
          </div>
          <div class="fg-field fg-rise" style="--i:5">
            <span class="fg-field__label" id="lSmMoment">Le moment de la journée</span>
            <div class="fg-sm-moments" id="smMoments" role="radiogroup" aria-labelledby="lSmMoment" aria-describedby="eSmMoment smMomentWhy" aria-required="true"></div>
            <p class="fg-sm-why" id="smMomentWhy" role="status"></p>
            <span class="fg-field__error" id="eSmMoment"></span>
          </div>
        </div>
        <div class="fg-actions fg-rise" style="--i:6">
          <button type="button" class="fg-btn fg-btn--ghost" data-back><svg aria-hidden="true"><use href="#i-back"/></svg><span class="fg-btn__txt">Retour</span></button>
          <button type="submit" class="fg-btn" id="smGoEnvies">Choisir vos envies<svg aria-hidden="true"><use href="#i-arrow"/></svg></button>
        </div>
      </form>
    </section>

    <section class="fg-scene fg-scene--full" data-scene="sm-envies" aria-labelledby="t-sme">
      <div class="fg-art"><img sizes="(max-width: 560px) 260px, (min-width: 1440px) 100vw, 800px" alt="" decoding="async"></div>
      <div class="fg-scene__body">
        <ol class="fg-steps" data-steps></ol>
        <span class="fg-sm-kicker fg-rise" style="--i:0"><svg aria-hidden="true"><use href="#i-users"/></svg>Demande sur mesure</span>
        <h2 class="fg-title" id="t-sme" data-words>Vos<br><em>envies</em></h2>
        <p class="fg-sub fg-rise" style="--i:1" id="smEnviesSub"></p>
        <div class="fg-tabs fg-rise" style="--i:2" role="tablist" aria-label="Activités ou formules" id="smTabs">
          <button type="button" class="fg-tab" role="tab" id="smTabAct" aria-selected="true" aria-controls="smPanelAct">Activités<span class="fg-tab__n" id="smTabActN"></span></button>
          <button type="button" class="fg-tab" role="tab" id="smTabFor" aria-selected="false" aria-controls="smPanelFor" tabindex="-1">Formules<span class="fg-tab__n" id="smTabForN"></span></button>
          <span class="fg-tabs__bar" aria-hidden="true"></span>
        </div>
        <div class="fg-panel fg-rise" style="--i:3" id="smPanelAct" role="tabpanel" aria-labelledby="smTabAct">
          <ul class="fg-grid fg-sm-grid" id="smGridAct"></ul>
        </div>
        <div class="fg-panel" id="smPanelFor" role="tabpanel" aria-labelledby="smTabFor" hidden>
          <div class="fg-fams" id="smGridFor"></div>
        </div>
        <div class="fg-sm-plus fg-rise" style="--i:4">
          <div class="fg-sm-advice" id="smAdvice" role="checkbox" aria-checked="false" tabindex="0">
            <span class="fg-card__box" aria-hidden="true"><svg><use href="#i-check"/></svg></span>
            <span class="fg-sm-advice__icon" aria-hidden="true"><svg><use href="#i-bulb"/></svg></span>
            <span class="fg-sm-advice__txt"><b>Conseillez-nous</b><small>L’équipe vous propose un programme pensé pour votre groupe.</small></span>
          </div>
          <div class="fg-field fg-sm-budget">
            <label class="fg-field__label" for="smBudget">Budget indicatif <span class="fg-field__opt">(facultatif)</span></label>
            <div class="fg-sm-unit"><input class="fg-input" id="smBudget" type="number" inputmode="numeric" min="0" max="1000" step="1" placeholder="25" autocomplete="off"><span aria-hidden="true">€ par personne</span></div>
          </div>
        </div>
        <div class="fg-bar fg-dock fg-rise" style="--i:5">
          <p class="fg-bar__count" id="smCount" aria-live="polite"></p>
          <div class="fg-actions" style="margin:0">
            <button type="button" class="fg-btn fg-btn--ghost" data-back><svg aria-hidden="true"><use href="#i-back"/></svg><span class="fg-btn__txt">Retour</span></button>
            <button type="button" class="fg-btn" id="smGoContact">Continuer<svg aria-hidden="true"><use href="#i-arrow"/></svg></button>
          </div>
        </div>
        <p class="fg-alert fg-alert--inline" id="smEnviesErr" role="alert" hidden></p>
      </div>
    </section>

    <section class="fg-scene fg-scene--split" data-scene="sm-contact" aria-labelledby="t-smc">
      <div class="fg-art"><img sizes="(max-width: 560px) 260px, (min-width: 900px) 52vw, 100vw" alt="" decoding="async"></div>
      <form class="fg-scene__body" id="smContactForm" novalidate>
        <ol class="fg-steps" data-steps></ol>
        <span class="fg-sm-kicker fg-rise" style="--i:0"><svg aria-hidden="true"><use href="#i-users"/></svg>Demande sur mesure</span>
        <h2 class="fg-title" id="t-smc" data-words>Vos<br><em>coordonnées</em></h2>
        <div class="fg-fields fg-sm-fields">
          <div class="fg-sm-pair">
            <div class="fg-field fg-rise" style="--i:1">
              <label class="fg-field__label" for="smPrenom">Prénom</label>
              <input class="fg-input" id="smPrenom" name="prenom" autocomplete="given-name" placeholder="Votre prénom" required aria-describedby="eSmPrenom" enterkeyhint="next" autocapitalize="words">
              <span class="fg-field__error" id="eSmPrenom"></span>
            </div>
            <div class="fg-field fg-rise" style="--i:2">
              <label class="fg-field__label" for="smNom">Nom</label>
              <input class="fg-input" id="smNom" name="nom" autocomplete="family-name" placeholder="Votre nom" required aria-describedby="eSmNom" enterkeyhint="next" autocapitalize="words">
              <span class="fg-field__error" id="eSmNom"></span>
            </div>
          </div>
          <div class="fg-field fg-rise" style="--i:3">
            <label class="fg-field__label" for="smRole">Votre fonction <span class="fg-field__opt">(facultatif)</span></label>
            <input class="fg-input" id="smRole" name="fonction" maxlength="80" autocomplete="organization-title" placeholder="Ex.&nbsp;: institutrice, responsable RH" enterkeyhint="next">
          </div>
          <div class="fg-sm-pair">
            <div class="fg-field fg-rise" style="--i:4">
              <label class="fg-field__label" for="smEmail">E-mail</label>
              <input class="fg-input" id="smEmail" name="email" type="email" autocomplete="email" inputmode="email" placeholder="votre@email.be" required aria-describedby="eSmEmail" enterkeyhint="next" autocapitalize="off" spellcheck="false">
              <span class="fg-field__error" id="eSmEmail"></span>
            </div>
            <div class="fg-field fg-rise" style="--i:5">
              <label class="fg-field__label" for="smTel">Téléphone</label>
              <input class="fg-input" id="smTel" name="telephone" type="tel" autocomplete="tel" inputmode="tel" placeholder="04 71 23 45 67" required aria-describedby="eSmTel" enterkeyhint="next">
              <span class="fg-field__error" id="eSmTel"></span>
            </div>
          </div>
          <div class="fg-sm-invoice" id="smInvoiceWrap" hidden>
            <label class="fg-check fg-rise" style="--i:6">
              <input type="checkbox" id="smInvoice">
              <span class="fg-check__box"><svg aria-hidden="true"><use href="#i-check"/></svg></span>
              <span id="smInvoiceLabel">Facture au nom de l’organisation</span>
            </label>
            <div class="fg-field" id="smVatWrap" hidden>
              <label class="fg-field__label" for="smVat">Numéro de TVA <span class="fg-field__opt">(facultatif)</span></label>
              <input class="fg-input" id="smVat" name="tva" maxlength="40" placeholder="BE 0123.456.789" autocomplete="off" autocapitalize="characters" spellcheck="false">
            </div>
          </div>
          <div class="fg-field fg-rise" style="--i:7">
            <label class="fg-field__label" for="smMessage">Un mot pour l’équipe <span class="fg-field__opt">(facultatif)</span></label>
            <textarea class="fg-input fg-input--area" id="smMessage" name="message" rows="3" maxlength="2000" placeholder="Ex.&nbsp;: horaires du bus, pique-nique à prévoir, accès PMR, un anniversaire dans le groupe"></textarea>
          </div>
          <label class="fg-check fg-rise" style="--i:8" id="smConsentWrap">
            <input type="checkbox" id="smConsent" required aria-describedby="eSmConsent">
            <span class="fg-check__box"><svg aria-hidden="true"><use href="#i-check"/></svg></span>
            <span>J’accepte que l’équipe me contacte au sujet de cette demande.</span>
          </label>
          <span class="fg-field__error" id="eSmConsent"></span>
        </div>
        <div class="fg-actions fg-rise" style="--i:9">
          <button type="button" class="fg-btn fg-btn--ghost" data-back><svg aria-hidden="true"><use href="#i-back"/></svg><span class="fg-btn__txt">Retour</span></button>
          <button type="submit" class="fg-btn" id="smGoRecap">Relire ma demande<svg aria-hidden="true"><use href="#i-arrow"/></svg></button>
        </div>
      </form>
    </section>

    <section class="fg-scene fg-scene--split fg-scene--art-left" data-scene="sm-recap" aria-labelledby="t-smr">
      <div class="fg-art"><img sizes="(max-width: 560px) 260px, (min-width: 900px) 52vw, 100vw" alt="" decoding="async"></div>
      <div class="fg-scene__body">
        <ol class="fg-steps" data-steps></ol>
        <span class="fg-sm-kicker fg-rise" style="--i:0"><svg aria-hidden="true"><use href="#i-users"/></svg>Demande sur mesure</span>
        <h2 class="fg-title" id="t-smr"><span data-words>Votre<br><em>demande</em></span></h2>
        <div class="fg-sm-recap" id="smRecap"></div>
        <div class="fg-actions fg-actions--column fg-rise" style="--i:6; max-width:560px">
          <button type="button" class="fg-btn" id="smSend">Envoyer ma demande<svg aria-hidden="true"><use href="#i-arrow"/></svg></button>
          <p class="fg-alert fg-alert--inline" id="smSendErr" role="alert" hidden></p>
          <p class="fg-confirm__note" id="smSendNote">Ce n’est pas encore une réservation&nbsp;: l’équipe vérifie ce qui est possible à votre date et vous répond sous 24&nbsp;heures ouvrables, avec le programme et le montant.</p>
        </div>
      </div>
    </section>`;

  window.FGSurMesure = function (I) {
    var doc = I.doc, $ = I.$, $$ = I.$$, CENTER = I.CENTER, EMBED = I.EMBED, sm = I.sm, state = I.state;
    sm.options = sm.options || {};
    var activite = I.activite, activitesVendables = I.activitesVendables, aller = I.aller, appelCentre = I.appelCentre;
    var champ = I.champ, chargerPhotoCarte = I.chargerPhotoCarte, deIso = I.deIso, dire = I.dire, esc = I.esc;
    var euros = I.euros, eveiller = I.eveiller, finGeste = I.finGeste, heureRonde = I.heureRonde, icone = I.icone;
    var iso = I.iso, jourInfo = I.jourInfo, jourLong = I.jourLong, joursLisibles = I.joursLisibles;
    var libelleFamille = I.libelleFamille, lienContact = I.lienContact, ligneCentre = I.ligneCentre;
    var minuscule = I.minuscule, montrer = I.montrer, motUnite = I.motUnite, ouvrirCalendrier = I.ouvrirCalendrier;
    var photo = I.photo, plageLisible = I.plageLisible, poserErreur = I.poserErreur, poserTitre = I.poserTitre;
    var posterHauteur = I.posterHauteur, prixCarte = I.prixCarte, reglesFormule = I.reglesFormule;
    var rejouer = I.rejouer, secouer = I.secouer, sortieClavier = I.sortieClavier;

    // Les ecrans entrent dans la page apres l ecran final, avec leurs titres
    // decoupes, leur Retour et leurs photos (le tirage du formulaire).
    var fin = $('.fg-scene[data-scene="fin"]');
    var jeu = $('#i-arrow') && $('#i-arrow').parentNode;
    if (jeu) jeu.insertAdjacentHTML('beforeend', SYMBOLES);
    fin.insertAdjacentHTML('afterend', ECRANS);
    var scenes = ['sm-groupe', 'sm-date', 'sm-envies', 'sm-contact', 'sm-recap'].map(function (id) { return $('.fg-scene[data-scene="' + id + '"]'); });
    I.decouperTitres();
    scenes.forEach(function (s) { $$('[data-back]', s).forEach(function (b) { b.addEventListener('click', I.precedent); }); });
    I.photosDesScenes(scenes, $('.fg-scene[data-scene="date"]'), fin);

    var SM_TYPES = {
      ecole: { label: 'École, jeunesse', organisation: 'Nom de l’école ou du mouvement' },
      entreprise: { label: 'Entreprise, team building', organisation: 'Nom de l’entreprise' },
      association: { label: 'Association, club', organisation: 'Nom de l’association ou du club' },
      anniversaire: { label: 'Anniversaire', organisation: '' },
      evg: { label: 'EVG / EVJF', organisation: '' },
      amis: { label: 'Amis, famille', organisation: '' },
      autre: { label: 'Autre groupe', organisation: '' },
    };
    var SM_AGES = {
      moins7: { label: 'Moins de 7 ans', min: 0, max: 6 },
      '7-12': { label: '7 à 12 ans', min: 7, max: 12 },
      '13-17': { label: '13 à 17 ans', min: 13, max: 17 },
      adultes: { label: 'Adultes', min: 18, max: 120 },
    };
    var SM_MOMENTS = [
      { id: 'matin', label: 'Matin', icone: 'i-matin', fenetre: [0, 12] },
      { id: 'apres-midi', label: 'Après-midi', icone: 'i-jour', fenetre: [12, 18] },
      { id: 'soiree', label: 'Soirée', icone: 'i-soir', fenetre: [18, 24] },
      { id: 'journee', label: 'Toute la journée', icone: 'i-journee', fenetre: [0, 24] },
      { id: 'indifferent', label: 'Peu importe', icone: 'i-any', fenetre: [0, 24] },
    ];
    var SM_DELAI = 24;
    function momentDef(id) { return SM_MOMENTS.filter(function (m) { return m.id === id; })[0] || null; }

    // L HEURE DU CENTRE, pas celle de l appareil : un client a l etranger lit
    // l horloge de Bruxelles, comme le serveur qui tranche a l envoi.
    function horlogeCentre() {
      try {
        var parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
        var lire = function (t) { var p = parts.filter(function (x) { return x.type === t; })[0]; return p ? Number(p.value) : 0; };
        return { jour: lire('year') + '-' + String(lire('month')).padStart(2, '0') + '-' + String(lire('day')).padStart(2, '0'), heure: (lire('hour') % 24) + lire('minute') / 60 };
      } catch (e) {
        var d = new Date();
        return { jour: iso(d), heure: d.getHours() + d.getMinutes() / 60 };
      }
    }
    function demainCentre() { var j = deIso(horlogeCentre().jour); return iso(new Date(j.getFullYear(), j.getMonth(), j.getDate() + 1)); }
    function joursEntre(de, a) {
      var x = deIso(de), y = deIso(a);
      return Math.round((Date.UTC(y.getFullYear(), y.getMonth(), y.getDate()) - Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())) / 86400000);
    }

    // LES MOMENTS D UN JOUR, selon ses horaires (miroir de lib/custom-request).
    function momentsDuJour(schedule) {
      var open = Number(schedule && schedule.open), close = Number(schedule && schedule.close);
      if (!isFinite(open) || !isFinite(close) || close <= open) return null;
      var plage = function (s, e) { return { start: s, end: e, ok: e - s >= 1 }; };
      var matin = plage(open, Math.min(close, 12));
      var apresMidi = plage(Math.max(open, 12), Math.min(close, 18));
      var soiree = plage(Math.max(open, 18), close);
      if (!matin.ok) matin.raison = 'Le centre ouvre à ' + heureRonde(open) + ' ce jour-là.';
      if (!apresMidi.ok) apresMidi.raison = close <= 13 ? 'Le centre ferme à ' + heureRonde(close) + ' ce jour-là.' : 'Le centre ouvre à ' + heureRonde(open) + ' ce jour-là.';
      if (!soiree.ok) soiree.raison = 'Le centre ferme à ' + heureRonde(close) + ' ce jour-là.';
      var journee = { start: open, end: close, ok: matin.ok && apresMidi.ok };
      if (!journee.ok) journee.raison = 'Le centre n’est ouvert que de ' + heureRonde(open) + ' à ' + heureRonde(close) + ' ce jour-là.';
      return { matin: matin, 'apres-midi': apresMidi, soiree: soiree, journee: journee, indifferent: { start: open, end: close, ok: true } };
    }
    // LE VERDICT D UN MOMENT, date comprise : il existe ce jour-la et il
    // commence au moins 24 heures apres maintenant (heure du centre).
    function verdictMoment(o) {
      var jour = momentsDuJour(o.schedule);
      if (!jour) return { ok: false, raison: 'Le centre est fermé ce jour-là.' };
      var m = jour[o.moment];
      if (!m) return { ok: false, raison: 'Moment inconnu.' };
      if (!m.ok) return { ok: false, raison: m.raison };
      var ecart = joursEntre(o.today, o.date) * 24 - Number(o.nowHour || 0);
      var avance = function (debut) { return ecart + debut >= SM_DELAI; };
      if (o.moment === 'indifferent') {
        var possibles = ['matin', 'apres-midi', 'soiree'].filter(function (k) { return jour[k].ok && avance(jour[k].start); });
        return possibles.length ? { ok: true, raison: '' } : { ok: false, raison: 'Moins de 24 h d’ici là.' };
      }
      return avance(m.start) ? { ok: true, raison: '' } : { ok: false, raison: 'Moins de 24 h d’ici là.' };
    }
    function agesCroisent(ages, min, max) { return ages.some(function (cle) { return SM_AGES[cle] && SM_AGES[cle].min <= max && SM_AGES[cle].max >= min; }); }
    function agesSousLeMinimum(ages, minAge) { return ages.filter(function (cle) { return SM_AGES[cle] && SM_AGES[cle].max < minAge; }); }
    function plageAges(texte) {
      var m = /(\d{1,2})\s*(?:à|a|-)\s*(\d{1,2})\s*ans/i.exec(String(texte || ''));
      return m && Number(m[1]) < Number(m[2]) ? [Number(m[1]), Number(m[2])] : null;
    }
    // LE VERDICT D UNE FORMULE POUR UNE DEMANDE (miroir de lib/custom-request).
    function verdictFormuleSurMesure(f, o) {
      var jour = o.jour || null, ages = o.ages || [], participants = o.participants || 0;
      if (!f) return { ok: false, raison: 'Formule inconnue.' };
      if (f.offerOff) return { ok: false, raison: 'Cette offre est momentanément suspendue.' };
      if (Array.isArray(f.missingActivityIds) && f.missingActivityIds.length) return { ok: false, raison: 'Cette formule n’est pas proposée dans ce centre.' };
      if (f.minPax && participants > 0 && participants < f.minPax) return { ok: false, raison: 'Cette formule demande au moins ' + f.minPax + ' personnes.' };
      if (jour) {
        if ((jour.unavailableFormulaIds || []).indexOf(f.id) >= 0) return { ok: false, raison: 'Une de ses activités n’est pas disponible ce jour-là.' };
        if (f.noHolidays && jour.formulaHolidayOff) return { ok: false, raison: 'Pas pendant les vacances scolaires ni les jours fériés.' };
        if (Array.isArray(f.validDays) && f.validDays.length && f.validDays.indexOf(jour.weekday) < 0) return { ok: false, raison: 'Seulement ' + joursLisibles(f.validDays) + '.' };
      }
      var m = momentDef(o.moment);
      if (m && o.moment !== 'indifferent' && o.moment !== 'journee' && f.timeLimit) {
        var debut = Math.max(m.fenetre[0], Number(f.timeLimit.min) || 0);
        var fin = Math.min(m.fenetre[1], Number(f.timeLimit.max) || 24);
        if (fin <= debut) return { ok: false, raison: 'Seulement ' + plageLisible(f.timeLimit) + '.' };
      }
      if (f.kidsOnly && ages.length && !agesCroisent(ages, f.kidsOnly.ageMin, f.kidsOnly.ageMax)) {
        return { ok: true, raison: '', note: 'Réservée aux enfants de ' + f.kidsOnly.ageMin + ' à ' + f.kidsOnly.ageMax + ' ans.' };
      }
      return { ok: true, raison: '', note: '' };
    }
    // LE VERDICT D UNE ACTIVITE POUR UNE DEMANDE (miroir de lib/custom-request).
    function verdictActiviteSurMesure(a, o) {
      var jour = o.jour || null, ages = o.ages || [], participants = o.participants || 0;
      if (!a) return { ok: false, raison: 'Activité inconnue.' };
      if (jour && (jour.unavailableActivityIds || []).indexOf(a.id) >= 0) return { ok: false, raison: 'Indisponible ce jour-là.' };
      if (a.minPax && participants > 0 && participants < a.minPax) return { ok: false, raison: 'Il faut être au moins ' + a.minPax + ' joueurs.' };
      if (ages.length && a.minAge) {
        var tropJeunes = agesSousLeMinimum(ages, a.minAge);
        if (tropJeunes.length) {
          var taille = a.minHeightCm ? ' et ' + (a.minHeightCm / 100).toFixed(2).replace('.', ',') + ' m' : '';
          return { ok: true, raison: '', note: tropJeunes.length === ages.length ? 'Dès ' + a.minAge + ' ans' + taille + ' : pas adapté à l’âge de votre groupe.' : 'Dès ' + a.minAge + ' ans' + taille + ' : les plus jeunes ne pourront pas jouer.' };
        }
      }
      var plage = plageAges(a.ageRange);
      if (ages.length && plage && !agesCroisent(ages, plage[0], plage[1])) return { ok: true, raison: '', note: 'Prévu pour les ' + plage[0] + ' à ' + plage[1] + ' ans.' };
      return { ok: true, raison: '', note: '' };
    }

    /* SM1. Le groupe */
    var smTypes = $('#smTypes'), smOrg = $('#smOrg'), smOrgWrap = $('#smOrgWrap');
    function choisirType(btn, focus) {
      if (!btn) return;
      sm.type = btn.dataset.type;
      $$('.fg-occasion', smTypes).forEach(function (b) { var on = b === btn; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
      poserErreur(smTypes, '');
      var def = SM_TYPES[sm.type];
      var avant = smOrgWrap.hidden;
      smOrgWrap.hidden = !def.organisation;
      if (def.organisation) $('#lSmOrg').textContent = def.organisation;
      if (focus) btn.focus({ preventScroll: true });
      if (avant !== smOrgWrap.hidden) posterHauteur();
    }
    smTypes.addEventListener('click', function (e) { choisirType(e.target.closest('.fg-occasion'), false); });
    smTypes.addEventListener('keydown', function (e) {
      var pas = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!pas || !e.target.classList || !e.target.classList.contains('fg-occasion')) return;
      var liste = $$('.fg-occasion', smTypes);
      e.preventDefault();
      choisirType(liste[(liste.indexOf(e.target) + pas + liste.length) % liste.length], true);
    });
    smOrg.addEventListener('input', function () { poserErreur(smOrg, ''); });
    // Deux compteurs : les joueurs (1 a 1000) et ceux qui accompagnent sans
    // jouer (0 a 1000). Le nombre se tape aussi ; il se remet au propre quand
    // le champ est quitte.
    function brancherCompteur(o) {
      var input = $('#' + o.input);
      function poser(n) {
        n = Math.min(o.max, Math.max(o.min, Math.trunc(Number(n) || 0)));
        o.poser(n);
        if (doc.activeElement !== input) input.value = String(n);
        input.style.width = (Math.max(1, String(input.value || n).length) + 0.3) + 'ch';
        $('#' + o.moins).disabled = n <= o.min;
        $('#' + o.plus).disabled = n >= o.max;
      }
      $('#' + o.moins).addEventListener('click', function () { poser(o.lire() - 1); input.value = String(o.lire()); });
      $('#' + o.plus).addEventListener('click', function () { poser(o.lire() + 1); input.value = String(o.lire()); });
      input.addEventListener('input', function () { var v = parseInt(input.value, 10); if (isFinite(v) && v >= o.min) poser(v); });
      input.addEventListener('blur', function () { input.value = String(o.lire()); });
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
      return poser;
    }
    var poserSmPax = brancherCompteur({ input: 'smPax', moins: 'smPaxMinus', plus: 'smPaxPlus', min: 1, max: 1000, lire: function () { return sm.participants; }, poser: function (n) { if (n !== sm.participants) sm.paxTouche = true; sm.participants = n; bornerEffectifsSm(); } });
    var poserSmComp = brancherCompteur({ input: 'smComp', moins: 'smCompMinus', plus: 'smCompPlus', min: 0, max: 1000, lire: function () { return sm.accompagnants; }, poser: function (n) { sm.accompagnants = n; } });
    var smAges = $('#smAges');
    smAges.addEventListener('click', function (e) {
      var chip = e.target.closest('.fg-sm-chip');
      if (!chip) return;
      var cle = chip.dataset.age, i = sm.ages.indexOf(cle);
      if (i >= 0) sm.ages.splice(i, 1); else sm.ages.push(cle);
      chip.classList.toggle('is-on', i < 0);
      chip.setAttribute('aria-checked', String(i < 0));
    });
    function rendreSmGroupe() {
      var btn = sm.type ? $('.fg-occasion[data-type="' + sm.type + '"]', smTypes) : null;
      if (btn) choisirType(btn, false);
      poserSmPax(sm.participants || 1);
      poserSmComp(sm.accompagnants || 0);
      $$('.fg-sm-chip', smAges).forEach(function (c) { var on = sm.ages.indexOf(c.dataset.age) >= 0; c.classList.toggle('is-on', on); c.setAttribute('aria-checked', String(on)); });
    }
    $('#smGroupeForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = true, premier = null;
      if (!sm.type) { poserErreur(smTypes, 'Dites-nous quel type de groupe vous êtes.'); ok = false; premier = premier || $('.fg-occasion[tabindex="0"]', smTypes); }
      var def = SM_TYPES[sm.type];
      sm.organisation = def && def.organisation ? smOrg.value.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
      if (def && def.organisation && !sm.organisation) { poserErreur(smOrg, 'Indiquez le ' + def.organisation.charAt(0).toLowerCase() + def.organisation.slice(1) + '.'); ok = false; premier = premier || smOrg; }
      if (!ok) { secouer(premier.closest('.fg-field')); premier.focus(); posterHauteur(); return; }
      rendreSmDate();
      aller('sm-date');
    });

    /* SM2. La date et le moment */
    var smDateBtn = $('#smDateBtn'), smDate2Btn = $('#smDate2Btn'), smMoments = $('#smMoments'), smWhy = $('#smMomentWhy');
    function hintJour(dateStr) {
      var j = jourInfo(dateStr), morceaux = [];
      if (dateStr === demainCentre()) morceaux.push('Demain');
      if (j) {
        morceaux.push(j.ouvert ? 'Ouvert ' + j.horaire : j.horaire);
        if (j.periode) morceaux.push(j.periode.type === 'public' ? 'Férié : ' + j.periode.label : j.periode.label);
      }
      return morceaux.join(' · ');
    }
    function poserSmDate(d) {
      sm.date = d; sm.dateTouchee = true;
      if (sm.date2 === d) sm.date2 = '';
      poserErreur(smDateBtn, '');
      majSmDates(true);
    }
    function poserSmDate2(d) {
      if (d === sm.date) { $('#smDate2Hint').textContent = 'C’est déjà votre date souhaitée.'; return; }
      sm.date2 = d;
      majSmDates(true);
    }
    var CIBLE_SM1 = { btn: smDateBtn, valeur: function () { return sm.date; }, min: demainCentre, poser: poserSmDate, avantMin: 'Pas le jour même : au plus tôt demain.' };
    var CIBLE_SM2 = { btn: smDate2Btn, valeur: function () { return sm.date2; }, min: demainCentre, poser: poserSmDate2, avantMin: 'Pas le jour même : au plus tôt demain.' };
    smDateBtn.addEventListener('click', function () { ouvrirCalendrier(CIBLE_SM1); });
    smDate2Btn.addEventListener('click', function () { ouvrirCalendrier(CIBLE_SM2); });
    [smDateBtn, smDate2Btn].forEach(function (b) { b.closest('.fg-day').addEventListener('focusout', sortieClavier); });
    $('#smDate2Clear').addEventListener('click', function () { sm.date2 = ''; majSmDates(true); smDate2Btn.focus(); });
    function majSmDates(anime) {
      $('#smDateLabel').textContent = sm.date ? jourLong(sm.date) : 'Choisir une date';
      $('#smDateHint').textContent = sm.date ? hintJour(sm.date) : '';
      $('#smDate2Label').textContent = sm.date2 ? jourLong(sm.date2) : 'Ajouter une date';
      $('#smDate2Hint').textContent = sm.date2 ? hintJour(sm.date2) : '';
      $('#smDate2Clear').hidden = !sm.date2;
      smDateBtn.classList.toggle('is-vide', !sm.date);
      smDate2Btn.classList.toggle('is-vide', !sm.date2);
      if (anime) { rejouer($('#smDateLabel'), 'is-maj'); }
      rendreMoments();
      majAltSm();
    }
    // L AUTRE DATE suit la regle de la premiere, au meme moment (miroir de
    // lib/custom-request) : ouverte, ce moment existe ce jour-la, et il commence
    // au moins 24 heures apres maintenant. Dit des que la date ou le moment
    // change ; bloque seulement a la validation de l ecran.
    function verdictAltSm() {
      if (sm.flexible || !sm.date2 || !sm.moment) return { ok: true, raison: '' };
      var j = jourInfo(sm.date2), h = horlogeCentre();
      if (!j || !j.ouvert) return { ok: false, raison: 'Le centre est fermé ce jour-là.' };
      return verdictMoment({ date: sm.date2, moment: sm.moment, today: h.jour, nowHour: h.heure, schedule: j.schedule });
    }
    function majAltSm() {
      var v = verdictAltSm();
      poserErreur(smDate2Btn, v.ok ? '' : 'Autre date (' + momentDef(sm.moment).label.toLowerCase() + ') : ' + v.raison);
    }
    var smFlexible = $('#smFlexible');
    smFlexible.addEventListener('change', function () {
      sm.flexible = smFlexible.checked;
      $('#smDates').hidden = sm.flexible;
      $('#smPeriodWrap').hidden = !sm.flexible;
      if (sm.flexible) setTimeout(function () { $('#smPeriod').focus(); }, 30);
      rendreMoments();
      majAltSm();
      posterHauteur();
    });
    $('#smPeriod').addEventListener('input', function () { poserErreur($('#smPeriod'), ''); });
    // Le verdict de chaque moment pour la date choisie ; sans date (date a
    // fixer, ou pas encore choisie), tous restent possibles.
    function verdictMomentSm(id) {
      if (sm.flexible || !sm.date) return { ok: true, raison: '' };
      var j = jourInfo(sm.date), h = horlogeCentre();
      if (!j || !j.ouvert) return { ok: false, raison: 'Le centre est fermé ce jour-là.' };
      return verdictMoment({ date: sm.date, moment: id, today: h.jour, nowHour: h.heure, schedule: j.schedule });
    }
    function plageMoment(id) {
      var j = !sm.flexible && sm.date ? jourInfo(sm.date) : null;
      var jour = j ? momentsDuJour(j.schedule) : null;
      if (jour && jour[id] && jour[id].ok) {
        if (id === 'indifferent') return 'Au choix de l’équipe';
        return heureRonde(jour[id].start) + ' à ' + heureRonde(jour[id].end);
      }
      return { matin: 'Avant 12h', 'apres-midi': '12h à 18h', soiree: 'Après 18h', journee: 'La journée', indifferent: 'Au choix de l’équipe' }[id];
    }
    function rendreMoments() {
      if (sm.moment && !verdictMomentSm(sm.moment).ok) {
        var def = momentDef(sm.moment);
        smWhy.textContent = def.label + ' : ' + verdictMomentSm(sm.moment).raison + ' Choisissez un autre moment.';
        sm.moment = '';
      }
      smMoments.innerHTML = SM_MOMENTS.map(function (m, i) {
        var v = verdictMomentSm(m.id), on = sm.moment === m.id;
        var focal = on || (!sm.moment && i === 0);
        return '<button type="button" class="fg-sm-moment' + (on ? ' is-on' : '') + (v.ok ? '' : ' is-refus') + '" role="radio" aria-checked="' + on + '" tabindex="' + (focal ? '0' : '-1') + '" data-moment="' + m.id + '"'
          + (v.ok ? '' : ' title="' + esc(v.raison) + '"') + '>'
          + '<svg aria-hidden="true"><use href="#' + m.icone + '"/></svg>'
          + '<b>' + esc(m.label) + '</b><small>' + esc(v.ok ? plageMoment(m.id) : v.raison) + '</small></button>';
      }).join('');
    }
    function choisirMoment(btn, focus) {
      if (!btn) return;
      var id = btn.dataset.moment, v = verdictMomentSm(id);
      if (!v.ok) {
        // Refuse : on dit pourquoi, on ne coche pas (le bouton reste touchable).
        smWhy.textContent = momentDef(id).label + ' : ' + v.raison;
        rejouer(smWhy, 'is-maj');
        dire(smWhy.textContent);
        return;
      }
      sm.moment = id;
      smWhy.textContent = '';
      poserErreur(smMoments, '');
      $$('.fg-sm-moment', smMoments).forEach(function (b) { var on = b === btn; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
      majAltSm();
      if (focus) btn.focus({ preventScroll: true });
    }
    smMoments.addEventListener('click', function (e) { choisirMoment(e.target.closest('.fg-sm-moment'), false); });
    smMoments.addEventListener('keydown', function (e) {
      var pas = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!pas || !e.target.classList || !e.target.classList.contains('fg-sm-moment')) return;
      var liste = $$('.fg-sm-moment', smMoments);
      e.preventDefault();
      var k = liste.indexOf(e.target);
      for (var n = 1; n <= liste.length; n += 1) {
        var b = liste[(k + pas * n + liste.length * n) % liste.length];
        if (!b.classList.contains('is-refus')) { choisirMoment(b, true); return; }
      }
    });
    function rendreSmDate() {
      smFlexible.checked = sm.flexible;
      $('#smDates').hidden = sm.flexible;
      $('#smPeriodWrap').hidden = !sm.flexible;
      $('#smPeriod').value = sm.periode;
      smWhy.textContent = '';
      majSmDates(false);
    }
    $('#smDateForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = true, premier = null;
      if (sm.flexible) {
        sm.periode = $('#smPeriod').value.replace(/\s+/g, ' ').trim().slice(0, 160);
        if (!sm.periode) { poserErreur($('#smPeriod'), 'Dites-nous la période envisagée.'); ok = false; premier = $('#smPeriod'); }
      } else if (!sm.date) {
        poserErreur(smDateBtn, 'Choisissez la date souhaitée.'); ok = false; premier = smDateBtn;
      }
      if (!sm.moment) { poserErreur(smMoments, 'Choisissez un moment de la journée.'); ok = false; premier = premier || $('.fg-sm-moment[tabindex="0"]', smMoments); }
      if (!verdictAltSm().ok) { majAltSm(); ok = false; premier = premier || smDate2Btn; }
      if (!ok) { if (premier) { secouer(premier.closest('.fg-field')); premier.focus(); } posterHauteur(); return; }
      rendreSmEnvies();
      aller('sm-envies');
    });

    /* SM3. Les envies */
    var smGridAct = $('#smGridAct'), smGridFor = $('#smGridFor'), smCount = $('#smCount'), smGoContact = $('#smGoContact');
    function contexteSm() {
      return { jour: !sm.flexible && sm.date ? jourInfo(sm.date) : null, moment: sm.moment, participants: sm.participants, ages: sm.ages.slice() };
    }
    // Les formules que CE centre peut faire : ni coupees par le staff, ni
    // privees d une activite qu il n a pas (serveur : missingActivityIds).
    function formulesSm() {
      return ((I.meta && I.meta.formules) || []).filter(function (f) { return !f.offerOff && !(Array.isArray(f.missingActivityIds) && f.missingActivityIds.length); });
    }
    // CE QUE L ACTIVITE DONNE POUR CE GROUPE : combien jouent en meme temps
    // (les installations declarees par le centre) et, au-dela, en combien de
    // groupes le leur se relaie. Aucune capacite devinee : sans installation
    // declaree, rien n est dit.
    function bornesEffectifSm(a) {
      var total = Math.max(1, Math.trunc(Number(sm.participants) || 1));
      var max = Number(a.capacityPerUnit) > 0 ? total : Math.min(total, Number(a.maxPax) || total);
      return { min: Math.min(max, Math.max(1, Number(a.minPax) || 1)), max: max };
    }
    function effectifSm(a) {
      var b = bornesEffectifSm(a), n = (sm.options[a.id] || {}).participants;
      return Math.min(b.max, Math.max(b.min, n == null ? b.max : Math.trunc(Number(n) || b.min)));
    }
    function bornerEffectifsSm() {
      Object.keys(sm.options).forEach(function (id) { var a = activite(id); if (a && sm.options[id].participants != null) sm.options[id].participants = effectifSm(a); });
    }
    function reglagesSm(a) {
      var r = I.reglagesSurMesure(a, sm.options[a.id] || {}, sm.participants, sm.flexible ? '' : sm.date, sm.activites.indexOf(a.id) >= 0);
      var extra = [capaciteGroupe(a), verdictActiviteSurMesure(a, contexteSm()).note].filter(Boolean);
      if (extra.length) {
        var bloc = doc.createElement('div'); bloc.innerHTML = r.info;
        var bouton = $('[data-activity-info]', bloc), sections = JSON.parse(bouton.dataset.infoSections);
        sections.unshift({ titre: 'Votre groupe', lignes: extra });
        bouton.dataset.infoSections = JSON.stringify(sections);
        bouton.dataset.infoText = sections.map(function (s) { return s.titre + '\n' + s.lignes.filter(Boolean).join('\n\n'); }).join('\n\n');
        r.info = bloc.innerHTML;
      }
      return r;
    }
    function compteurSm(a) { var r = reglagesSm(a); return r.info + r.html; }
    function changerReglageSm(target, cle, valeur, normaliser) {
      var item = target.closest('[data-sm-activity]'), a = activite(item && item.dataset.smActivity);
      var tile = I.tuileActivite(item);
      item = I.tiroirActivite(item);
      if (!a) return;
      var r = reglagesSm(a), c = r.compteurs.filter(function (x) { return x.cle === cle; })[0];
      var g = r.groupes.filter(function (x) { return x.cle === cle; })[0];
      var n = c ? Number(valeur) : valeur;
      if (c) n = Math.min(c.max, Math.max(c.min, Math.trunc(isFinite(n) ? n : c.n)));
      else { var option = g && g.options.filter(function (o) { return String(o.valeur) === String(n); })[0]; if (!option) return; n = option.valeur; }
      sm.options[a.id] = Object.assign({}, sm.options[a.id] || {});
      if (r.arcade && (cle === 'arcadeMode' || cle === 'arcadeOfferId')) sm.options[a.id] = I.choixArcade(a, sm.options[a.id], cle, n, { mode: r.arcade.arcadeMode, offer: r.arcade.arcadeOffer });
      else sm.options[a.id][cle] = n;
      r = reglagesSm(a);
      if (r.arcade && (cle === 'arcadeMode' || cle === 'arcadeOfferId')) {
        $('.fg-card__opt', item).outerHTML = r.html;
        var focus = $('[data-cle="' + cle + '"][data-valeur="' + n + '"]', item) || $('select[data-cle="' + cle + '"]', item);
        if (focus) focus.focus({ preventScroll: true });
      }
      r.compteurs.forEach(function (count) {
        var box = $('[data-compteur="' + count.cle + '"]', item), value = $('.fg-kids__n', box);
        if (value.tagName !== 'INPUT') value.textContent = count.n;
        else if (normaliser || doc.activeElement !== value) value.value = String(count.n);
        $('[data-pas="-1"]', box).disabled = count.n <= count.min;
        $('[data-pas="1"]', box).disabled = count.n >= count.max;
      });
      r.groupes.forEach(function (group) {
        $$('.fg-pill[data-cle="' + group.cle + '"]', item).forEach(function (pill) {
          var option = group.options.filter(function (o) { return String(o.valeur) === pill.dataset.valeur; })[0];
          var on = pill.dataset.valeur === String(group.choisie);
          pill.classList.toggle('is-on', on); pill.setAttribute('aria-checked', String(on)); pill.tabIndex = on ? 0 : -1;
          $('small', pill).textContent = option.sous != null ? option.sous : option.prix == null ? 'prix à l’accueil' : euros(option.prix);
        });
      });
      $('.fg-card__price', tile).textContent = r.prix + (faitsAge(a) ? ' · ' + faitsAge(a) : '');
      var tmp = doc.createElement('div'); tmp.innerHTML = r.info;
      var note = $('.fg-card__rot', tile), nouvelle = $('.fg-card__rot', tmp);
      if (note && nouvelle) note.textContent = nouvelle.textContent;
      else if (note) note.remove();
      else if (nouvelle) $('.fg-card__optbox', item).appendChild(nouvelle);
      var info = $('[data-activity-info]', tile), nextInfo = $('[data-activity-info]', tmp);
      if (info && nextInfo) { info.dataset.infoText = nextInfo.dataset.infoText; info.dataset.infoSections = nextInfo.dataset.infoSections; }
      var cap = $('.fg-sm-cap', item);
      if (cap) cap.innerHTML = '<svg aria-hidden="true"><use href="#i-users"/></svg>' + esc(capaciteGroupe(a));
      rendreSmCompteur(false);
    }
    function capaciteGroupe(a) {
      var n = effectifSm(a), simul = 0, quoi = '';
      var b = (I.meta && I.meta.center && I.meta.center.booking) || {};
      if (a.id === 'bowling' && b.laneCount && b.normalCapacityPerLane) {
        simul = b.laneCount * b.normalCapacityPerLane;
        quoi = b.laneCount + ' pistes, ' + b.normalCapacityPerLane + ' joueurs par piste';
      } else if (a.priceType === 'grid_laser' && b.laserArenaCapacity) {
        simul = b.laserArenaCapacity;
        quoi = simul + ' joueurs par partie';
      } else if (Number(a.units) > 0 && Number(a.capacityPerUnit) > 0) {
        var mot = motUnite(a) || 'installation';
        simul = a.units * a.capacityPerUnit;
        quoi = a.units > 1 ? a.units + ' ' + mot + 's, ' + a.capacityPerUnit + ' joueurs par ' + mot : a.capacityPerUnit + ' joueurs à la fois';
      } else if (Number(a.units) > 0) {
        var motU = motUnite(a) || 'installation';
        quoi = a.units + ' ' + motU + (a.units > 1 ? 's' : '');
      }
      if (!quoi) return '';
      if (!simul) return quoi;
      var groupes = Math.ceil(n / simul);
      return quoi + (groupes > 1 ? ' : vos ' + n + ' joueurs se relaient en ' + groupes + ' groupes' : ' : tout le groupe en même temps');
    }
    function faitsAge(a) {
      if (a.minAge) return 'Dès ' + a.minAge + ' ans' + (a.minHeightCm ? ' et ' + (a.minHeightCm / 100).toFixed(2).replace('.', ',') + ' m' : '');
      return a.ageRange || '';
    }
    function carteSm(o) {
      return '<li class="fg-grid__item' + (o.on ? ' is-on' : '') + '"' + (o.formule ? '' : ' data-sm-activity="' + esc(o.id) + '"') + '>'
        + '<div class="fg-card' + (o.formule ? ' fg-card--formule' : '') + ' fg-rise' + (o.on ? ' is-on' : '') + (o.v.ok ? '' : ' is-refus') + '" style="--i:' + (o.i % 8) + '" data-sm="' + esc(o.id) + '" data-kind="' + (o.formule ? 'formule' : 'activite') + '" role="checkbox" tabindex="0" aria-checked="' + o.on + '">'
        + o.corps
        + (o.v.ok ? '' : '<span class="fg-for__off"><svg aria-hidden="true"><use href="#i-info"/></svg>' + esc(o.v.raison) + '</span>')
        + (o.formule && o.v.ok && o.v.note ? '<span class="fg-sm-note"><svg aria-hidden="true"><use href="#i-info"/></svg>' + esc(o.v.note) + '</span>' : '')
        + '</div>' + (o.formule ? o.info || '' : I.caseActivite(o.id, activite(o.id).name, o.on) + compteurSm(activite(o.id))) + '</li>';
    }
    function rendreSmActivites() {
      var ctx = contexteSm();
      smGridAct.innerHTML = activitesVendables().map(function (a, i) {
        var v = verdictActiviteSurMesure(a, ctx), p = photo(a.id), cap = capaciteGroupe(a), age = faitsAge(a);
        var on = sm.activites.indexOf(a.id) >= 0;
        return carteSm({ id: a.id, i: i, on: on, v: v, formule: false, corps: (p ? '<span class="fg-card__photo" aria-hidden="true"><img data-src="/assets/fungalaxy/' + p + '-800.webp" alt="" decoding="async"></span>' : '')
          + '<span class="fg-card__icon" aria-hidden="true"><svg><use href="#' + icone(a.id) + '"/></svg></span>'
          + '<span class="fg-card__name">' + esc(a.name) + '</span>'
          + '<span class="fg-card__price">' + esc(on ? reglagesSm(a).prix : prixCarte(a, true)) + (age ? ' · ' + esc(age.replace(/ /g, ' ')) : '') + '</span>'
          });
      }).join('') || '<li class="fg-empty">Aucune activité n’est proposée pour le moment.' + ligneCentre() + '</li>';
      $$('.fg-card.is-on', smGridAct).forEach(chargerPhotoCarte);
      I.rendreEditeurActivites(smGridAct, '', retirerSmActivite);
    }
    function rendreSmFormules() {
      var liste = formulesSm(), ctx = contexteSm();
      if (!liste.length) { smGridFor.innerHTML = '<p class="fg-empty">Aucune formule n’est proposée pour le moment.' + ligneCentre() + '</p>'; return; }
      var familles = [], parFamille = {};
      liste.forEach(function (f) { var cle = f.family || 'Formules'; if (!parFamille[cle]) { parFamille[cle] = []; familles.push(cle); } parFamille[cle].push(f); });
      var n = 0;
      smGridFor.innerHTML = familles.map(function (cle) {
        var possibles = parFamille[cle].filter(function (f) { return verdictFormuleSurMesure(f, ctx).ok; }).length;
        var cartes = parFamille[cle].map(function (f) {
          var v = verdictFormuleSurMesure(f, ctx), regles = reglesFormule(f), on = sm.formules.indexOf(f.id) >= 0;
          n += 1;
          return carteSm({ id: f.id, i: n, on: on, v: v, formule: true, corps: '<span class="fg-card__box" aria-hidden="true"><svg><use href="#i-check"/></svg></span>'
            + '<span class="fg-for__head"><span class="fg-card__name">' + esc(f.name) + '</span>' + (f.best ? '<span class="fg-for__best">Bon plan</span>' : '') + '</span>'
            + '<span class="fg-for__price"><b>' + esc(euros(f.price)) + '</b><small>' + (f.type === 'per_lane' ? 'la piste' : f.kidsOnly ? 'par enfant' : 'par personne') + '</small>' + (f.oldPrice ? '<s>' + esc(euros(f.oldPrice)) + '</s>' : '') + '</span>'
            + '<ul class="fg-for__list">' + (f.desc || []).map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>'
            + (regles.length ? '<span class="fg-for__rules">' + regles.map(function (r) { return '<i>' + esc(r) + '</i>'; }).join('') + '</span>' : ''),
            info: I.htmlInfoFormule(f, { surMesure: true, pax: sm.pax }) });
        }).join('');
        return '<section class="fg-fam"><h3 class="fg-fam__title">' + esc(libelleFamille(cle)) + '<span>' + possibles + ' sur ' + parFamille[cle].length + ' possible' + (possibles > 1 ? 's' : '') + (ctx.jour ? ' ce jour-là' : '') + '</span></h3>'
          + '<ul class="fg-grid fg-grid--for">' + cartes + '</ul></section>';
      }).join('');
    }
    // Ce qui n est plus proposable (catalogue relu, date ou moment changes)
    // sort de la selection : jamais une envie refusee ne part a l equipe.
    function nettoyerEnvies() {
      var ctx = contexteSm();
      Object.keys(sm.options).forEach(function (id) {
        var a = activite(id); if (!a) return;
        var r = reglagesSm(a);
        r.compteurs.forEach(function (c) { if (sm.options[id][c.cle] != null) sm.options[id][c.cle] = c.n; });
        r.groupes.forEach(function (g) { if (sm.options[id][g.cle] != null) sm.options[id][g.cle] = g.choisie; });
      });
      sm.activites = sm.activites.filter(function (id) { return verdictActiviteSurMesure(activite(id), ctx).ok; });
      sm.formules = sm.formules.filter(function (id) { var f = formulesSm().filter(function (x) { return x.id === id; })[0]; return f && verdictFormuleSurMesure(f, ctx).ok; });
    }
    function activitesRecapSm() { return sm.activites.map(function (id) { var a = activite(id); if (!a) return ''; var r = reglagesSm(a), detail = [effectifSm(a) + (/enfant/i.test(a.unitLabel || '') ? ' enfant' : ' joueur') + (effectifSm(a) > 1 ? 's' : '')]; if (r.arcade) detail.push(r.detail); else { r.compteurs.filter(function (c) { return c.cle === 'units'; }).forEach(function (c) { detail.push(c.n + ' ' + c.mot + (c.n > 1 ? 's' : '')); }); r.groupes.forEach(function (g) { var o = g.options.filter(function (o) { return o.valeur === g.choisie; })[0]; if (o) detail.push(o.label); }); } return a.name + ' (' + detail.join(' · ') + ') : ' + (r.montant == null ? 'prix à l’accueil' : euros(r.montant)); }).filter(Boolean); }
    function estimationSm() {
      if (!sm.activites.length) return '';
      var total = 0, connues = 0, inconnues = [];
      sm.activites.forEach(function (id) { var a = activite(id), r = reglagesSm(a); if (r.montant == null) inconnues.push(a.name); else { total += Math.round(r.montant * 100); connues += 1; } });
      return (connues ? 'Estimation des activités : ' + euros(total / 100) + (inconnues.length ? ', sans ' + inconnues.join(', ') + ' (prix à l’accueil)' : '') : 'Prix des activités à l’accueil : ' + inconnues.join(', '))
        + '. Programme et montant à confirmer par l’équipe' + (sm.formules.length ? ' ; formules à composer avec elle' : '') + '.';
    }
    function rendreSmCompteur(bump) {
      var nA = sm.activites.length, nF = sm.formules.length, n = nA + nF + (sm.conseil ? 1 : 0);
      $('#smTabActN').textContent = nA ? String(nA) : '';
      $('#smTabForN').textContent = nF ? String(nF) : '';
      var morceaux = [];
      if (nA) morceaux.push(nA + ' activité' + (nA > 1 ? 's' : ''));
      if (nF) morceaux.push(nF + ' formule' + (nF > 1 ? 's' : ''));
      if (sm.conseil) morceaux.push('le conseil de l’équipe');
      if (n) smCount.innerHTML = '<b>' + esc(morceaux.join(', ').replace(/, ([^,]*)$/, ' et $1')) + '</b>';
      else smCount.textContent = 'Cochez ce qui vous tente, ou demandez conseil à l’équipe.';
      if (nA) smCount.innerHTML += '<small class="fg-sm-estimation">' + esc(estimationSm()) + '</small>';
      var b = $('b', smCount);
      if (bump && b) { b.classList.remove('is-bump'); void b.offsetWidth; b.classList.add('is-bump'); }
      var etaitInactif = smGoContact.disabled;
      smGoContact.disabled = n === 0;
      if (etaitInactif && n) eveiller(smGoContact);
    }
    function rendreSmEnvies() {
      nettoyerEnvies();
      var sub = sm.participants + ' joueur' + (sm.participants > 1 ? 's' : '') + (sm.accompagnants ? ' et ' + sm.accompagnants + ' accompagnateur' + (sm.accompagnants > 1 ? 's' : '') : '')
        + ', ' + (sm.flexible ? 'date à fixer' : minuscule(jourLong(sm.date))) + (sm.moment && sm.moment !== 'indifferent' ? ', ' + minuscule(momentDef(sm.moment).label) : '')
        + '. Cochez tout ce qui vous tente : l’équipe compose le programme et vous dit ce qui est possible.';
      $('#smEnviesSub').textContent = sub;
      rendreSmActivites();
      rendreSmFormules();
      $('#smAdvice').classList.toggle('is-on', sm.conseil);
      $('#smAdvice').setAttribute('aria-checked', String(sm.conseil));
      $('#smBudget').value = sm.budget;
      choisirOngletSm(sm.onglet);
      rendreSmCompteur(false);
      $('#smEnviesErr').hidden = true;
    }
    function retirerSmActivite(id) { var card = $('.fg-card[data-sm="' + id + '"]', smGridAct); basculerSm(card, true); $('.fg-card-select', card.closest('.fg-grid__item')).focus({ preventScroll:true }); }
    function basculerSm(card, cocher) {
      if (!card) return;
      if (card.classList.contains('is-refus')) {
        var pourquoi = card.querySelector('.fg-for__off');
        if (pourquoi) { pourquoi.classList.remove('is-pulse'); void pourquoi.offsetWidth; pourquoi.classList.add('is-pulse'); dire(pourquoi.textContent.trim()); }
        return;
      }
      var liste = card.dataset.kind === 'formule' ? sm.formules : sm.activites;
      var id = card.dataset.sm, i = liste.indexOf(id);
      if (card.dataset.kind === 'activite' && i >= 0 && !cocher) return;
      if (i >= 0) liste.splice(i, 1); else liste.push(id);
      var on = i < 0;
      chargerPhotoCarte(card);
      card.classList.toggle('is-on', on);
      if (on) rejouer(card, 'is-coche'); else card.classList.remove('is-coche');
      card.closest('.fg-grid__item').classList.toggle('is-on', on);
      card.setAttribute('aria-checked', String(on));
      if (card.dataset.kind === 'activite') { var a = activite(id), item = card.closest('.fg-grid__item'); $('.fg-card__price', card).textContent = (on ? reglagesSm(a).prix : prixCarte(a, true)) + (faitsAge(a) ? ' · ' + faitsAge(a) : ''); var info = $('.fg-card__info', item); if (info) info.outerHTML = reglagesSm(a).info; }
      if (card.dataset.kind === 'activite') { var choix = $('.fg-card-select', card.closest('.fg-grid__item')); choix.classList.toggle('is-on', on); choix.setAttribute('aria-checked', String(on)); I.rendreEditeurActivites(smGridAct, on ? id : '', retirerSmActivite, on); }
      rendreSmCompteur(true);
      setTimeout(posterHauteur, 320);
    }
    [smGridAct, smGridFor].forEach(function (grille) {
      grille.addEventListener('click', function (e) { basculerSm(e.target.closest('.fg-card')); });
      grille.addEventListener('keydown', function (e) {
        if ((e.key === ' ' || e.key === 'Enter') && e.target.classList && e.target.classList.contains('fg-card')) { e.preventDefault(); basculerSm(e.target); }
      });
      grille.addEventListener('animationend', finGeste);
    });
    smGridAct.addEventListener('click', function (e) {
      var choix = e.target.closest('[data-activity-toggle]');
      if (choix) { basculerSm($('.fg-card', choix.closest('.fg-grid__item')), true); return; }
      var btn = e.target.closest('[data-pas]'), pill = e.target.closest('.fg-pill');
      if (btn && !btn.disabled) {
        var a = activite(btn.closest('[data-sm-activity]').dataset.smActivity);
        var cle = btn.closest('[data-compteur]').dataset.compteur;
        var c = reglagesSm(a).compteurs.filter(function (x) { return x.cle === cle; })[0];
        changerReglageSm(btn, cle, c.n + Number(btn.dataset.pas), true);
      } else if (pill) changerReglageSm(pill, pill.dataset.cle, pill.dataset.valeur, true);
    });
    smGridAct.addEventListener('input', function (e) {
      if (!e.target.matches('.fg-count__input')) return;
      var n = Number(e.target.value);
      if (e.target.value !== '' && Number.isInteger(n) && n >= Number(e.target.min) && n <= Number(e.target.max)) changerReglageSm(e.target, e.target.closest('[data-compteur]').dataset.compteur, n, false);
    });
    smGridAct.addEventListener('change', function (e) {
      if (e.target.matches('.fg-arcade-select')) { changerReglageSm(e.target, e.target.dataset.cle, e.target.value, true); return; }
      if (!e.target.matches('.fg-count__input')) return;
      var a = activite(e.target.closest('[data-sm-activity]').dataset.smActivity);
      var cle = e.target.closest('[data-compteur]').dataset.compteur;
      var count = reglagesSm(a).compteurs.filter(function (c) { return c.cle === cle; })[0];
      changerReglageSm(e.target, cle, e.target.value.trim() ? Number(e.target.value) : count.n, true);
    });
    smGridAct.addEventListener('keydown', function (e) {
      if (!e.target.matches('.fg-pill') || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      var pills = $$('.fg-pill', e.target.closest('.fg-pills')), i = pills.indexOf(e.target) + (e.key === 'ArrowRight' ? 1 : -1);
      if (i < 0 || i >= pills.length) return;
      e.preventDefault(); changerReglageSm(pills[i], pills[i].dataset.cle, pills[i].dataset.valeur, true); pills[i].focus();
    });
    smGridAct.addEventListener('pointerenter' , function (e) { if (e.pointerType !== 'touch') chargerPhotoCarte(e.target.closest && e.target.closest('.fg-card')); }, true);
    smGridAct.addEventListener('focusin', function (e) { chargerPhotoCarte(e.target.closest && e.target.closest('.fg-card')); });
    function choisirOngletSm(quel) {
      sm.onglet = quel;
      var act = quel === 'activites';
      $('#smTabAct').setAttribute('aria-selected', String(act));
      $('#smTabFor').setAttribute('aria-selected', String(!act));
      $('#smTabAct').tabIndex = act ? 0 : -1;
      $('#smTabFor').tabIndex = act ? -1 : 0;
      $('#smPanelAct').hidden = !act;
      $('#smPanelFor').hidden = act;
      $('#smTabs').classList.toggle('is-for', !act);
      setTimeout(posterHauteur, 50);
    }
    $('#smTabAct').addEventListener('click', function () { choisirOngletSm('activites'); });
    $('#smTabFor').addEventListener('click', function () { choisirOngletSm('formules'); });
    $('#smTabs').addEventListener('keydown', function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      var vers = e.key === 'Home' ? 'activites' : e.key === 'End' ? 'formules'
        : (e.key === 'ArrowLeft' || e.key === 'ArrowRight') ? (sm.onglet === 'activites' ? 'formules' : 'activites') : '';
      if (!vers) return;
      e.preventDefault();
      if (vers !== sm.onglet) choisirOngletSm(vers);
      (vers === 'activites' ? $('#smTabAct') : $('#smTabFor')).focus({ preventScroll: true });
    });
    function basculerConseil() {
      sm.conseil = !sm.conseil;
      $('#smAdvice').classList.toggle('is-on', sm.conseil);
      $('#smAdvice').setAttribute('aria-checked', String(sm.conseil));
      if (sm.conseil) rejouer($('#smAdvice'), 'is-coche');
      rendreSmCompteur(true);
    }
    $('#smAdvice').addEventListener('click', basculerConseil);
    $('#smAdvice').addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); basculerConseil(); } });
    $('#smBudget').addEventListener('input', function () {
      var v = parseInt($('#smBudget').value, 10);
      sm.budget = isFinite(v) && v > 0 ? String(Math.min(1000, v)) : '';
    });
    smGoContact.addEventListener('click', function () {
      if (smGoContact.disabled) return;
      rendreSmContact();
      aller('sm-contact');
    });

    /* SM4. Les coordonnees */
    var smForm = $('#smContactForm');
    function rendreSmContact() {
      var def = SM_TYPES[sm.type] || {};
      var facturable = Boolean(def.organisation);
      $('#smInvoiceWrap').hidden = !facturable;
      if (facturable) $('#smInvoiceLabel').textContent = 'Facture au nom de ' + (sm.organisation || 'l’organisation');
      if (!facturable) { $('#smInvoice').checked = false; $('#smVatWrap').hidden = true; }
    }
    $('#smInvoice').addEventListener('change', function () { $('#smVatWrap').hidden = !$('#smInvoice').checked; posterHauteur(); });
    ['smPrenom', 'smNom', 'smEmail', 'smTel'].forEach(function (id) { champ(id).addEventListener('input', function () { poserErreur(champ(id), ''); }); });
    champ('smConsent').addEventListener('change', function () { $('#smConsentWrap').classList.remove('is-invalid'); $('#eSmConsent').textContent = ''; champ('smConsent').removeAttribute('aria-invalid'); });
    var ordreSm = ['smPrenom', 'smNom', 'smRole', 'smEmail', 'smTel'];
    ordreSm.forEach(function (id, k) {
      champ(id).addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.isComposing) return;
        var suivant = ordreSm[k + 1] ? champ(ordreSm[k + 1]) : champ('smMessage');
        e.preventDefault();
        suivant.focus();
      });
    });
    function validerSmContact() {
      var ok = true;
      [[champ('smPrenom'), 'Indiquez votre prénom.'], [champ('smNom'), 'Indiquez votre nom.']].forEach(function (p) { var v = p[0].value.trim(); poserErreur(p[0], v ? '' : p[1]); if (!v) ok = false; });
      var ev = champ('smEmail').value.trim();
      var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ev);
      poserErreur(champ('smEmail'), ev ? (emailOk ? '' : 'Vérifiez cette adresse (exemple : prenom@email.be).') : 'Indiquez votre adresse e-mail.');
      if (!emailOk) ok = false;
      var tv = champ('smTel').value.replace(/\(0\)/g, '').replace(/[\s.\-\/()]/g, '');
      var telOk = /^\+?\d{8,15}$/.test(tv);
      poserErreur(champ('smTel'), tv ? (telOk ? '' : 'Vérifiez ce numéro (exemple : 0471 23 45 67).') : 'Indiquez un numéro où l’équipe peut vous joindre.');
      if (!telOk) ok = false;
      var consent = champ('smConsent');
      $('#smConsentWrap').classList.toggle('is-invalid', !consent.checked);
      $('#eSmConsent').textContent = consent.checked ? '' : 'Cochez cette case pour continuer.';
      if (consent.checked) consent.removeAttribute('aria-invalid'); else consent.setAttribute('aria-invalid', 'true');
      if (!consent.checked) ok = false;
      return ok;
    }
    smForm.addEventListener('animationend', function (e) {
      if (!e.target.matches('.fg-input, .fg-check__box')) return;
      var w = e.target.closest('.is-nudge');
      if (w) w.classList.remove('is-nudge');
    });
    smForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!validerSmContact()) { var premier = $('.fg-field.is-invalid > .fg-input, .fg-check.is-invalid input', smForm); if (premier) { secouer(premier.closest('.fg-field, .fg-check')); if (premier === doc.activeElement) premier.blur(); premier.focus(); } posterHauteur(); return; }
      var facture = !$('#smInvoiceWrap').hidden && $('#smInvoice').checked;
      sm.contact = {
        prenom: champ('smPrenom').value.trim(), nom: champ('smNom').value.trim(), fonction: champ('smRole').value.replace(/\s+/g, ' ').trim().slice(0, 80),
        email: champ('smEmail').value.trim(), telephone: champ('smTel').value.replace(/\(0\)/g, '').replace(/\s+/g, ' ').trim(),
        facture: facture, tva: facture ? champ('smVat').value.replace(/\s+/g, ' ').trim().slice(0, 40) : '',
        message: champ('smMessage').value.trim().slice(0, 2000),
      };
      rendreSmRecap();
      smErreur('');
      aller('sm-recap');
    });

    /* SM5. La relecture et l envoi */
    function libelleQuandSm() {
      if (sm.flexible) return 'À fixer : ' + sm.periode + (sm.moment && sm.moment !== 'indifferent' ? ', ' + minuscule(momentDef(sm.moment).label) : '');
      return jourLong(sm.date) + (sm.moment && sm.moment !== 'indifferent' ? ', ' + minuscule(momentDef(sm.moment).label) : '');
    }
    function nomsDe(ids, liste) { return ids.map(function (id) { var x = liste.filter(function (y) { return y.id === id; })[0]; return x ? x.name : ''; }).filter(Boolean); }
    function blocRecap(titre, cible, lignes, i) {
      return '<section class="fg-sm-recap__block fg-rise" style="--i:' + i + '"><div class="fg-sm-recap__head"><h3>' + esc(titre) + '</h3>'
        + '<button type="button" class="fg-edit__btn" data-goto="' + cible + '">Modifier<span class="sr-only"> : ' + esc(minuscule(titre)) + '</span></button></div>'
        + lignes.filter(Boolean).map(function (l) { return '<p class="fg-sm-recap__row"><svg aria-hidden="true"><use href="#' + l[0] + '"/></svg><span>' + l[1] + '</span></p>'; }).join('')
        + '</section>';
    }
    function rendreSmRecap() {
      var def = SM_TYPES[sm.type] || { label: '' };
      var groupe = '<b>' + esc(def.label) + '</b>' + (sm.organisation ? ', ' + esc(sm.organisation) : '');
      var effectif = esc(sm.participants + ' joueur' + (sm.participants > 1 ? 's' : '')) + (sm.accompagnants ? ' + ' + esc(sm.accompagnants + ' accompagnateur' + (sm.accompagnants > 1 ? 's' : '')) : '');
      var ages = sm.ages.map(function (a) { return SM_AGES[a] ? SM_AGES[a].label : ''; }).filter(Boolean);
      var acts = activitesRecapSm(), fors = nomsDe(sm.formules, formulesSm());
      var contact = I.meta && I.meta.center && I.meta.center.contact;
      var proche = !sm.flexible && sm.date && joursEntre(horlogeCentre().jour, sm.date) <= 2;
      var c = sm.contact || {};
      var html = blocRecap('Le groupe', 'sm-groupe', [
        ['i-users', groupe],
        ['i-users', effectif + (ages.length ? ' · ' + esc(ages.join(', ')) : '')],
      ], 1)
        + blocRecap('La date', 'sm-date', [
          ['i-calendar', '<b>' + esc(libelleQuandSm()) + '</b>'],
          !sm.flexible && sm.date2 ? ['i-calendar', 'Ou ' + esc(minuscule(jourLong(sm.date2)))] : null,
          proche && contact && contact.phone ? ['i-info', 'Votre date est proche&nbsp;: pour une réponse plus rapide, appelez aussi le centre au ' + lienContact({ phone: contact.phone }) + '.'] : null,
        ], 2)
        + blocRecap('Vos envies', 'sm-envies', [
          acts.length ? ['a-star', '<b>Activités</b>&nbsp;: ' + esc(acts.join(', '))] : null,
          fors.length ? ['a-formule', '<b>Formules</b>&nbsp;: ' + esc(fors.join(', '))] : null,
          sm.conseil ? ['i-bulb', 'L’équipe vous propose un programme'] : null,
          sm.activites.length ? ['i-card', esc(estimationSm())] : null,
          sm.budget ? ['i-card', 'Budget indicatif&nbsp;: ' + esc(euros(Number(sm.budget))) + ' par personne'] : null,
        ], 3)
        + blocRecap('Vos coordonnées', 'sm-contact', [
          ['i-users', '<b>' + esc((c.prenom + ' ' + c.nom).trim()) + '</b>' + (c.fonction ? ', ' + esc(c.fonction) : '')],
          ['i-mail', esc(c.email) + ' · ' + esc(c.telephone)],
          c.facture ? ['i-card', 'Facture au nom de ' + esc(sm.organisation || 'l’organisation') + (c.tva ? ', TVA ' + esc(c.tva) : '')] : null,
          c.message ? ['i-info', '« ' + esc(c.message.length > 160 ? c.message.slice(0, 157) + '…' : c.message) + ' »'] : null,
        ], 4);
      $('#smRecap').innerHTML = html;
    }
    var smSend = $('#smSend'), smSendErr = $('#smSendErr');
    function smErreur(html) {
      smSendErr.innerHTML = html || '';
      smSendErr.hidden = !html;
      if (html) { posterHauteur(); montrer(smSendErr); }
    }
    // Le champ refuse par le serveur ramene a l ecran qui le porte.
    var SM_ECRAN_DU_CHAMP = { groupType: 'sm-groupe', organisation: 'sm-groupe', participants: 'sm-groupe', date: 'sm-date', alternativeDate: 'sm-date', period: 'sm-date', moment: 'sm-date', formulas: 'sm-envies', activities: 'sm-envies' };
    smSendErr.addEventListener('click', function (e) {
      var b = e.target.closest('[data-corriger]');
      if (!b) return;
      var ecran = b.dataset.corriger;
      if (ecran === 'sm-date') rendreSmDate();
      if (ecran === 'sm-envies') rendreSmEnvies();
      if (ecran === 'sm-groupe') rendreSmGroupe();
      aller(ecran, true);
    });
    function corpsDemande() {
      var c = sm.contact || {};
      return {
        kind: 'custom-request',
        centerId: CENTER,
        contactName: (c.prenom + ' ' + c.nom).trim(),
        email: c.email,
        phone: c.telephone,
        company: sm.organisation,
        pax: sm.participants,
        message: c.message || '',
        details: {
          groupType: sm.type,
          organisation: sm.organisation,
          participants: sm.participants,
          companions: sm.accompagnants,
          ages: sm.ages.slice(),
          flexible: sm.flexible,
          date: sm.flexible ? '' : sm.date,
          alternativeDate: sm.flexible ? '' : sm.date2,
          period: sm.flexible ? sm.periode : '',
          moment: sm.moment,
          activities: sm.activites.map(function (id) { var a = activite(id), r = reglagesSm(a), o = { id: id, participants: effectifSm(a) }; r.compteurs.forEach(function (c) { o[c.cle] = c.n; }); r.groupes.forEach(function (g) { o[g.cle] = g.choisie; }); if (r.arcade) o.cards = r.arcade.cards; return o; }),
          formulas: sm.formules.slice(),
          advice: sm.conseil,
          budgetPerPerson: sm.budget ? Number(sm.budget) : 0,
          contactRole: c.fonction || '',
          invoice: Boolean(c.facture),
          vatNumber: c.tva || '',
        },
      };
    }
    smSend.addEventListener('click', function () {
      if (smSend.classList.contains('is-busy')) return;
      smErreur('');
      smSend.classList.add('is-busy'); smSend.setAttribute('aria-busy', 'true');
      fetch('/api/custom-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpsDemande()), credentials: 'omit' })
        .then(function (r) { return r.json().then(function (j) { return { status: r.status, json: j || {} }; }); })
        .then(function (res) {
          smSend.classList.remove('is-busy'); smSend.removeAttribute('aria-busy');
          if (res.status === 201 && res.json.ok !== false) { reussiteSurMesure(res.json); return; }
          var ecran = SM_ECRAN_DU_CHAMP[res.json.field] || '';
          smErreur('<b>' + esc(res.json.message || 'La demande n’a pas pu être enregistrée. Réessayez dans un instant.') + '</b>'
            + (ecran ? '<button type="button" class="fg-alert__btn" data-corriger="' + ecran + '">Corriger</button>' : ''));
        })
        .catch(function () {
          smSend.classList.remove('is-busy'); smSend.removeAttribute('aria-busy');
          var appel = appelCentre();
          smErreur('<b>Impossible de savoir si votre demande est partie.</b> Avant de la renvoyer, ' + (appel ? appel + ' ou regardez vos e-mails.' : 'regardez vos e-mails.'));
        });
    });
    function reussiteSurMesure(reponse) {
      var c = sm.contact || {}, def = SM_TYPES[sm.type] || { label: '' };
      var contact = I.meta && I.meta.center && I.meta.center.contact;
      var nomCentre = I.meta && I.meta.center && I.meta.center.name ? I.meta.center.name : 'du centre';
      function rangee(ico, html) { return '<p class="fg-done__row"><svg aria-hidden="true"><use href="#' + ico + '"/></svg><span>' + html + '</span></p>'; }
      poserTitre($('#t-fin'), 'Demande<br><em>envoyée</em>');
      $('#finBody').innerHTML = '<div class="fg-done__ticket fg-rise" style="--i:2">'
        + rangee('i-users', '<b>' + esc(sm.organisation || def.label) + '</b>, ' + esc(sm.participants + ' joueur' + (sm.participants > 1 ? 's' : '')) + (sm.accompagnants ? ' + ' + esc(sm.accompagnants + ' accompagnateur' + (sm.accompagnants > 1 ? 's' : '')) : '') + '.')
        + rangee('i-calendar', esc(libelleQuandSm()) + '.')
        + (sm.activites.length ? rangee('a-star', esc(activitesRecapSm().join(' ; '))) + rangee('i-card', esc(estimationSm())) : '')
        + (sm.formules.length ? rangee('a-formule', esc(nomsDe(sm.formules, formulesSm()).join(', ')) + ' : à composer avec l’équipe.') : '')
        + rangee('i-clock', 'L’équipe ' + (nomCentre === 'du centre' ? 'du centre' : 'de ' + esc(nomCentre)) + ' étudie votre demande et vous répond sous <b>24 heures ouvrables</b>, avec ce qui est possible à votre date et le montant.')
        + rangee('i-mail', reponse.acknowledgementSent ? 'Un accusé de réception part à <b>' + esc(c.email) + '</b>.' : 'Au nom de <b>' + esc((c.prenom + ' ' + c.nom).trim()) + '</b>, ' + esc(c.email) + '.')
        + rangee('i-info', 'Rien n’est encore réservé à votre nom.' + (contact && contact.phone ? ' Une question&nbsp;? ' + lienContact(contact) : ''))
        + '</div>'
        + (!EMBED && I.meta && I.meta.center && I.meta.center.identity && I.meta.center.identity.siteUrl ? '<div class="fg-actions fg-actions--center fg-rise" style="--i:3"><a class="fg-btn fg-btn--ghost" href="' + esc(I.meta.center.identity.siteUrl) + '">Retour au site</a></div>' : '');
      var anneau = $('.fg-done__ring');
      var icone2 = anneau && $('svg use', anneau);
      if (anneau) anneau.classList.add('is-mail');
      if (icone2) icone2.setAttribute('href', '#i-mail');
      var burst = $('#finBurst');
      if (burst) burst.innerHTML = '';
      aller('fin');
    }

    // L OUVERTURE : le groupe et le jour du premier ecran passent a la demande
    // tant que le client ne les y a pas changes lui-meme ; le jour seulement
    // s il tombe au plus tot demain (pas le jour meme).
    function ouvrir() {
      var panierNormal = JSON.stringify([state.onglet, state.selection, state.formuleId, state.options, state.pax, state.date]);
      if (sm.panierImporte !== panierNormal) {
        if (sm.groupeImporte !== state.pax) { sm.paxTouche = false; sm.participants = Math.max(1, state.pax); }
        if (sm.jourImporte !== state.date) { sm.dateTouchee = false; sm.flexible = false; sm.date = ''; }
        sm.groupeImporte = state.pax; sm.jourImporte = state.date;
        if (state.onglet === 'formules') {
          sm.formules = state.formuleId ? [state.formuleId] : []; sm.activites = [];
        } else {
          sm.activites = state.selection.slice(); sm.formules = [];
          sm.options = {};
          sm.activites.forEach(function (id) { sm.options[id] = Object.assign({}, state.options[id] || {}); });
        }
        sm.panierImporte = panierNormal;
      }
      if (!sm.paxTouche) sm.participants = Math.max(1, state.pax);
      if (!sm.dateTouchee && !sm.flexible) {
        var j = jourInfo(state.date);
        sm.date = state.date && state.date >= demainCentre() && j && j.ouvert ? state.date : (sm.date && sm.date >= demainCentre() ? sm.date : '');
      }
      rendreSmGroupe();
      aller('sm-groupe');
    }
    // Le catalogue relu par le formulaire : l ecran des envies se refait.
    function rafraichir() { if (I.scene() === 'sm-envies') rendreSmEnvies(); }
    return { ouvrir: ouvrir, rafraichir: rafraichir };
  };
})();
