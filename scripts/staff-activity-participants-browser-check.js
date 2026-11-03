// Reuse the existing offline staff auth/network fixture; every API is mocked.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const harness = fs.readFileSync(path.join(__dirname, 'edit-price-options-check.js'), 'utf8').replace(/\r\n/g, '\n');
const prefix = harness.slice(0, harness.indexOf('// Contre-epreuve historique')).replace('4503','4517');
let mount = harness.slice(harness.indexOf('async function mesurer(b)'), harness.indexOf('  const resultats = {};', harness.indexOf('async function mesurer(b)')));
const activities = [
 ['bowling','Bowling','grid_bowling',null,true], ['laser_game','Laser Game','grid_laser',null,true],
 ['minigolf_blacklight','Minigolf Blacklight','per_pax',10,false], ['billards','Billard','per_unit_hour',10,false],
 ['arcade_time','Arcades','per_pax',null,false], ['playground','Playground','per_pax',12,false],
 ['duckpin_bowling','Duckpin Bowling','grid_bowling',null,false], ['fun_run','Fun Run','grid_fun_run',null,false],
].map(([id,name,priceType,priceValue,planned],order)=>({id,name,priceType,priceValue,planned,order,bookable:true,defaultMinutes:30,...(id==='playground'?{unitLabel:'par enfant',dayAccess:true}:{}),...(id==='billards'?{unitLabel:'par table',units:5,minMinutes:60,maxMinutes:180,stepMinutes:60}:{}),...(id==='duckpin_bowling'?{resourceType:'duckpin_lane',units:2,capacityPerUnit:6}:{}),...(id==='fun_run'?{capacityPerUnit:5}:{}),...(id==='laser_game'?{minPax:2}: {})}));
mount = mount.replace('    const ACTIVITIES = [','    const ACTIVITIES_OLD = [');
mount = mount.replace('    const J = (payload)', `    const ACTIVITIES = ${JSON.stringify(activities)};
    const counts = [6,4,3,8,5,2,6,4];
    const items = ACTIVITIES.map((a,index)=>({...a,activityId:a.id,participants:counts[index],priceKnown:a.id!=='arcade_time',price:[39,72,30,40,0,24,39,55][index],duration:1,games:2,units:a.id==='billards'?2:1,hours:2,minutes:a.id==='fun_run'?30:60,sessions:1}));
    R.push({id:9900,name:'TOUS LES EFFECTIFS',pax:18,date:today,startTime:'14:00',duration:1,totalDuration:4,lanes:[1],price:299,basePrice:299,type:'bowling',status:'pending',centerId:'libramont',extras:[],program:{items,price:299,priceComplete:false},opsPlan:{resourceBlocks:[{activityId:'bowling',resourceType:'bowling_lane',start:840,end:900,startTime:'14:00',endTime:'15:00',players:6,lanes:[1],durationMinutes:60},{activityId:'laser_game',resourceType:'laser_arena',start:930,end:955,startTime:'15:30',endTime:'15:55',players:4,countIndex:1,groupPlayers:4,durationMinutes:25}]}});
    const J = (payload)`);
// L HORLOGE DE LA PAGE EST FIGEE A 09:00 du jour du centre : le dossier 9900
// joue sa partie laser a 15:30 ce jour-la, et le planning Laser replie les
// departs joues (le soir, sa legende n y serait plus). La fixture lit le jour
// avec new Date() dans la page : elle prend le meme.
const ancreHorloge = "  await pg.goto('http://127.0.0.1:' + PORT + '/?v=' + Date.now(), { waitUntil: 'networkidle' });";
if (mount.split(ancreHorloge).length !== 2) throw new Error('montage : le chargement de la page est introuvable dans le harnais');
mount = mount.replace(ancreHorloge, "  await pg.clock.setFixedTime(new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) + 'T09:00:00'));\n" + ancreHorloge);
const checks = `
  const data = await pg.evaluate(() => {
    const row=state.reservations.find(r=>r.id===9900);
    const holder=document.createElement('section');document.body.append(holder);
    holder.innerHTML=renderReservationRow(row);
    const summary=holder.textContent;
    const timeline=getGroupeProgramme(row).map(step=>step.nom+' '+step.quoi).join(' | ');
    // (un planning cache ne se dessine plus : chacun se lit dans son onglet)
    setStaffResourceView('bowling');
    const bowling=[...document.querySelectorAll('.booking[data-booking-res-id="9900"] .bk-pax')].map(el=>el.title);
    setStaffResourceView('laser');
    const laser=[...document.querySelectorAll('#laserPlanningGridWrap .lp-g[data-laser-res-id="9900"]')].map(el=>({titre:el.title,cases:el.closest('.lp-dep').querySelectorAll('.lp-cases i[data-lp-id="9900"]').length}));
    const terrain=getStaffTerrainSteps(row).map(step=>step.label||step.nom||'').join(' | ');
    const free={...row,price:0,basePrice:0,program:{priceComplete:true,items:[{activityId:'minigolf_blacklight',participants:3,price:0,priceKnown:true}]}};
    const unknown={...free,program:{priceComplete:false,items:[{activityId:'arcade_time',participants:5,price:0,priceKnown:false}]}};
    const freeHolder=document.createElement('div');document.body.append(freeHolder);freeHolder.innerHTML=renderGroupePrix(free)+renderPosDetails(free);
    const freeText=freeHolder.textContent;const freeCard=freeHolder.querySelector('.gc-price b').textContent;freeHolder.remove();
    const unknownHolder=document.createElement('div');document.body.append(unknownHolder);unknownHolder.innerHTML=renderGroupePrix(unknown)+renderPosDetails(unknown);
    const unknownText=unknownHolder.textContent;unknownHolder.remove();
    window.openStaffReservationDetail(9900);
    return {summary,timeline,bowling,laser,terrain,freeText,freeCard,unknownText};
  });
  ok(/Minigolf Blacklight\s*3 joueurs/.test(data.summary)&&/Arcades\s*5 joueurs/.test(data.summary),'actual all activities card says Minigolf3 and Arcades5, total visitors18');
  ok(/Bowling 6 joueurs/.test(data.timeline)&&/Laser Game 4 joueurs/.test(data.timeline)&&/Arcades 5 joueurs/.test(data.timeline),'timeline says own bowling6 laser4 arcade5');
  ok(data.bowling.length>0&&data.bowling.every(count=>count==='6 joueurs'),'actual bowling planning cards show6 players: '+JSON.stringify(data.bowling));
  ok(data.laser.length>0&&data.laser.every(g=>/^TOUS LES EFFECTIFS : 4 joueurs\\b/.test(g.titre)&&g.cases===4),'actual laser planning legend and gauge show4 players: '+JSON.stringify(data.laser));
  for(const [name,count] of [['Bowling',6],['Laser Game',4],['Minigolf Blacklight',3],['Billard',8],['Arcades',5],['Playground',2],['Duckpin Bowling',6],['Fun Run',4]]) {
    ok(data.timeline.includes(name+' '+count+' joueurs')||data.timeline.includes(name+' '+count+' enfants'),'all activities timeline '+name+' count'+count);
    const compact=data.summary.split(/\\s+/).join('');
    ok(compact.includes(name.split(' ').join('')+count+'joueurs')||compact.includes(name.split(' ').join('')+count+'enfants'),'all activities reservation card '+name+' count'+count);
  }
  ok(data.terrain.includes('Bowling · 6 joueurs')&&data.terrain.includes('Laser Game · 4 joueurs'),'terrain program own bowling6 laser4');
  ok(data.summary.includes('18 personnes présentes'),'mixed participants group header describes18 visitors');
  // La fiche sobre (2026-10-12) ecrit « À encaisser : 0 € » ; la regle reste :
  // un prix connu nul se dit 0, jamais « prix au comptoir ». Ce controle vit
  // dans un gabarit evalue par la page : l antislash s y double.
  ok(data.freeCard.startsWith('0')&&data.freeCard.includes('€')&&/À encaisser\\W+0/.test(data.freeText)&&!data.freeText.toLowerCase().includes('prix sur place')&&!data.freeText.toLowerCase().includes('prix au comptoir'),'actual card+detail known free price stays0');
  ok(data.unknownText.includes('Prix sur place')&&data.unknownText.toLowerCase().includes('prix au comptoir'),'actual card+detail unknown price stays payable onsite');
  const info=await pg.locator('#posOverlay').innerText();
  ok(/Minigolf Blacklight/.test(info)&&/3 joueurs/.test(info)&&/Arcades/.test(info)&&/5 joueurs/.test(info),'live staff detail shows activity counts');
  await pg.evaluate(()=>{closePos();openQuickBook({pax:18,date:state.currentDate,startTime:'14:00'});quickBookState.type='visite';quickBookState.visit={bowling:{on:true,duration:1},laser_game:{on:true,games:2},others:{minigolf_blacklight:true,billards:true,arcade_time:true,playground:true,duckpin_bowling:true,fun_run:true},options:{bowling:{participants:6},laser_game:{participants:4},minigolf_blacklight:{participants:3},billards:{participants:8,units:2,hours:2},arcade_time:{participants:5},playground:{participants:2},duckpin_bowling:{participants:6},fun_run:{participants:4,minutes:30}}};syncQuickBookDuration();renderQuickBook();if(!quickBookState.moreOpen)toggleQuickBookMore();});
  // LES SEANCES (2026-11-03) : chaque activite est une ligne du ticket
  // (#rsL-a-<id>) ; son compteur de joueurs (ou d enfants) vit sur SA page, que
  // la ligne ouvre. Au telephone, le ticket s ouvre d abord (#rsResume). Le
  // compteur se lit sur sa page : la valeur ET « sur N personnes » a cote.
  const ouvrirLigne=async(id)=>{
    const visible=await pg.evaluate(i=>{const l=document.getElementById('rsL-a-'+i);return Boolean(l&&l.getClientRects().length&&l.getBoundingClientRect().height>0);},id);
    if(!visible){const resume=pg.locator('#rsResume');if(await resume.isVisible())await resume.click();}
    await pg.click('#rsL-a-'+id);
    await pg.waitForTimeout(120);
  };
  const auTicket=()=>pg.evaluate(()=>[...document.querySelectorAll('#quickBookOverlay #rsLignes .rs-tk-a[data-activite]')].map(e=>e.dataset.activite));
  const compteurDe=sens=>'#rsCorps .rs-pas[aria-label="Joueurs"] [aria-label$="'+sens+'"], #rsCorps .rs-pas[aria-label="Enfants"] [aria-label$="'+sens+'"]';
  const lireCompteurs=async()=>{
    const parLigne={};let total=0;
    for(const id of await auTicket()){
      await ouvrirLigne(id);
      const lu=await pg.evaluate(i=>{
        const pas=document.querySelector('#quickBookOverlay #rsCorps .rs-pas[aria-label="Joueurs"], #quickBookOverlay #rsCorps .rs-pas[aria-label="Enfants"]');
        if(!pas)return null;
        const titre=((document.getElementById('rsQ')||{}).textContent||'').trim();
        const rang=pas.closest('.rs-rang');
        const sur=/sur (\\d+) personne/.exec(rang?rang.textContent:'');
        return titre===rvNomActivite(i)?pas.querySelector('b').textContent.trim()+' / '+(sur?sur[1]:'?'):'page '+titre;
      },id);
      if(lu===null)continue;
      total+=1;parLigne[id]=lu;
    }
    return {parLigne,total};
  };
  const counters=await lireCompteurs();
  ok(counters.total===8&&JSON.stringify(counters.parLigne)===JSON.stringify({bowling:'6 / 18',laser_game:'4 / 18',minigolf_blacklight:'3 / 18',billards:'8 / 18',arcade_time:'5 / 18',playground:'2 / 18',duckpin_bowling:'6 / 18',fun_run:'4 / 18'}),'live quickbook all8 counters retain distinct counts: '+JSON.stringify(counters));
  // Les cibles du compteur, page par page : 44 px au moins, rien hors de l ecran.
  for(const width of [1440,390]) {
    await pg.setViewportSize({width,height:900});
    await pg.waitForTimeout(200);
    const mesures=[];
    for(const id of await auTicket()){
      await ouvrirLigne(id);
      mesures.push(await pg.evaluate(()=>{const boutons=[...document.querySelectorAll('#quickBookOverlay #rsCorps .rs-pas button')];const tailles=boutons.flatMap(b=>[b.getBoundingClientRect().width,b.getBoundingClientRect().height]);return {n:boutons.length,min:tailles.length?Math.min(...tailles):0,coupe:[...document.querySelectorAll('#quickBookOverlay #rsCorps .rs-pas')].some(el=>el.getBoundingClientRect().right>innerWidth||el.getBoundingClientRect().left<0)};}));
    }
    const min=mesures.length?Math.min(...mesures.map(m=>m.min)):0;
    ok(mesures.length===8&&mesures.every(m=>m.n>=2)&&min>=44,'counter targets at '+width+'px: '+min+'px ('+mesures.length+' pages)');
    ok(mesures.length===8&&!mesures.some(m=>m.coupe),'participant controls fit '+width+'px viewport');
    await pg.screenshot({path:p.join(REPO,'tmp','staff-participants-'+width+'.png')});
  }
  // Le geste du comptoir : + sur la page Arcades (5 -> 7), - sur celle du minigolf (3 -> 2).
  await ouvrirLigne('arcade_time');
  for(let i=0;i<2;i++){await pg.click(compteurDe('un de plus'));await pg.waitForTimeout(120);}
  await ouvrirLigne('minigolf_blacklight');
  await pg.click(compteurDe('un de moins'));
  await pg.waitForTimeout(150);
  const values=await pg.evaluate(()=>({arcade:getQuickVisitParticipants('arcade_time'),golf:getQuickVisitParticipants('minigolf_blacklight'),bowling:getQuickVisitParticipants('bowling'),laser:getQuickVisitParticipants('laser_game'),pax:quickBookState.pax}));
  ok(JSON.stringify(values)===JSON.stringify({arcade:7,golf:2,bowling:6,laser:4,pax:18}),'live counter changes preserve every other activity and visitors');
  await pg.evaluate(()=>{closeQuickBook();openStaffReservationDetail(9900);});
  await pg.evaluate(()=>{const button=[...document.querySelectorAll('#posOverlay button')].find(b=>b.textContent.trim()==='Modifier');if(button)button.click();});
  await pg.waitForTimeout(250);
  // The direct Laser editor is a separate control above the eight-activity list.
  const edit=await pg.locator('#posOverlay .qb-visit-compteur .qb-step-valeur:not(.dossier-laser-editor .qb-step-valeur)').allTextContents();
  // (depuis la fiche refaite du 2026-10-10, le compteur de Modifier dit « 4 »
  // et non plus « 4 / 18 » : la regle est le nombre de chaque activite)
  ok(JSON.stringify(edit.map(t=>parseInt(t,10)))===JSON.stringify([4,3,8,5,2,6,4,6]),'live edit all8 counters roundtrip unchanged: '+JSON.stringify(edit));
  const transfer=await pg.evaluate(()=>{
    closePos();
    const demande={date:state.currentDate,participants:18,formulas:[],activities:[{id:'bowling',name:'Bowling',participants:6,duration:1.5},{id:'laser_game',name:'Laser Game',participants:4,games:3},{id:'minigolf_blacklight',name:'Minigolf Blacklight',participants:3},{id:'billards',name:'Billard',participants:8,units:2,hours:2},{id:'arcade_time',name:'Arcades',participants:5},{id:'playground',name:'Playground',participants:2},{id:'duckpin_bowling',name:'Duckpin Bowling',participants:6,duration:0.5},{id:'fun_run',name:'Fun Run',participants:6,minutes:30}]};
    const item={id:'sm-all8',contactName:'Demande test',email:'',phone:'',payload:{demande}};
    staffCustomRequestsCache.key=String(getActiveOpsCenterId());staffCustomRequestsCache.items=[item];
    staffRequestToBooking(item.id);
    if(quickBookState&&!quickBookState.moreOpen)toggleQuickBookMore();
    return {type:quickBookState.type,pax:quickBookState.pax,source:quickBookState.sourceRequestId,bowling:quickBookState.visit.bowling,laser:quickBookState.visit.laser_game,duckpin:ligneProgrammeQuick('duckpin_bowling'),billard:ligneProgrammeQuick('billards'),fun:ligneProgrammeQuick('fun_run'),labels:crActivites(demande).join(' | '),display:document.querySelector('#quickBookOverlay').textContent};
  });
  ok(transfer.type==='visite'&&transfer.pax===18&&transfer.source==='sm-all8','actual custom request becomes visit preserving source and18 visitors');
  ok(transfer.bowling.duration===1.5&&transfer.laser.games===3&&transfer.duckpin.duration===0.5&&transfer.billard.units===2&&transfer.billard.hours===2&&transfer.fun.minutes===30&&transfer.fun.participants===6,'actual custom transfer retains all durations/parts/tables/sessions/counts');
  const smCounters=await lireCompteurs();
  ok(smCounters.total===8&&JSON.stringify(smCounters.parLigne)===JSON.stringify({bowling:'6 / 18',laser_game:'4 / 18',minigolf_blacklight:'3 / 18',billards:'8 / 18',arcade_time:'5 / 18',playground:'2 / 18',duckpin_bowling:'6 / 18',fun_run:'6 / 18'}),'actual custom request all8 visible counters retain distinct counts: '+JSON.stringify(smCounters));
  ok(transfer.labels.includes('Billard : 8 joueurs · 2 tables · 2h')&&transfer.labels.includes('Laser Game : 4 joueurs · 3 parties'),'actual request labels show players+full choices');
  // LA CAPACITE DE SECOURS, DITE PAR LE PLAN DU SERVEUR (2026-11-03). La
  // fenetre « Les seances » ne calcule plus son avertissement de secours : sa
  // ligne d etat (#rvVerdict) dit l avertissement du plan a blanc du serveur,
  // le meme moteur que la creation. Mesure du 2026-11-03 sur le vrai handler
  // (scripts/reserver-banc.js, base en memoire) : 7 joueurs sur la derniere
  // piste, le plan porte avertissement = la phrase de
  // lib/bowling-allocation.js (« ... environ 70 min ... n est pas garantie ») ;
  // a 6, il ne porte rien. Le double du serveur ci-dessous rend ce plan : la
  // phrase vient de la VRAIE allocateBowlingCapacity, sur les pistes libres du
  // jour et les joueurs du bowling que la fenetre envoie a sa simulation.
  const { allocateBowlingCapacity } = require(p.join(REPO, 'lib', 'bowling-allocation.js'));
  await pg.exposeFunction('__secoursDuServeur', ({ joueurs, libres, minutes, normal, secours }) => {
    const plan = allocateBowlingCapacity({ players: joueurs, config: { normalCapacityPerLane: normal, emergencyCapacityPerLane: secours }, requiredLanes: 0, allocate: (n) => (n <= libres ? Array.from({ length: n }, (_, i) => i + 1) : null), durationMinutes: minutes, games: 1 });
    return plan ? plan.emergencyWarning : '';
  });
  await pg.evaluate(()=>{
    window.__secoursGarde={reservations:state.reservations,statuses:state.laneStatuses,quick:quickBookState,selected:state.selectedRes,edit:state.editState,date:state.currentDate,fetch:window.fetch};
    const precedent=window.fetch;
    const J=payload=>new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json; charset=utf-8'}});
    window.fetch=async(input,init)=>{
      const raw=typeof input==='string'?input:(input&&input.url)||'';
      const u=new URL(raw,window.location.origin);
      // La lecture de la journee rend celle que le scenario a posee (son stock de
      // pistes) : une lecture de fond ne remet pas les huit pistes au milieu.
      if(u.pathname==='/api/staff-state'){const jour=u.searchParams.get('date')||state.currentDate;return J({ok:true,revision:'qa-secours',reservations:state.reservations.filter(r=>r.date===jour),laneStatuses:state.laneStatuses,centerId:'libramont'});}
      if(u.pathname==='/api/admin-range')return J({ok:true,reservations:state.reservations,laneStatuses:state.laneStatuses,centerId:'libramont',revision:'qa-secours',syncedAt:new Date().toISOString()});
      const corps=String((init&&init.method)||'GET').toUpperCase()==='POST'?JSON.parse(String((init&&init.body)||'{}')):{};
      if(u.pathname!=='/api/staff-reservations'||!corps.dryRun||corps.candidats)return precedent(input,init);
      const ligne=(Array.isArray(corps.program)?corps.program:[]).find(l=>l&&l.activityId==='bowling');
      const heures=Number((ligne&&ligne.duration)||corps.duration)||1;
      const avertissement=ligne?await window.__secoursDuServeur({joueurs:Number(ligne.participants)||Number(corps.pax)||1,libres:getFreeCount(corps.date,corps.startTime,heures),minutes:heures*60,normal:getMaxPerLane(),secours:Math.max(getMaxPerLane(),getEmergencyMaxPerLane())}):'';
      return J({ok:true,dryRun:true,plan:{disponible:true,debut:corps.startTime||'',fin:'',blocs:[],etapes:[],prix:null,avertissement,aSurveiller:[],conflits:[]}});
    };
  });
  // Le plan de la composition affichee est arrive (sa cle est celle de l ecran).
  const planDuServeur=()=>pg.waitForFunction(()=>{const s=quickBookState;return Boolean(s&&s.plan&&s.plan.etat==='ok'&&s.plan.cle===s.cleCourante&&rvPlanCourant());},null,{timeout:8000});
  const texteFenetre=()=>pg.evaluate(()=>document.querySelector('#quickBookOverlay').textContent);
  const SECOURS=/capacité exceptionnelle/;
  let emergency;
  try {
    const debut=await pg.evaluate(()=>{
      state.reservations=[];
      // Un jour FUTUR ouvert a 14:00 : le jour meme, les heures passees ne
      // sont plus proposees et le creneau de 14:00 disparaissait le soir.
      const jour=k=>{const d=new Date(todayStr()+'T12:00:00');d.setDate(d.getDate()+k);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
      const jourOuvert=[...Array(14)].map((_,k)=>jour(k+1)).find(d=>{const s=getSchedule(d,state.isHolidayMode);return s&&s.open<=14&&s.close>=15;});
      if(!jourOuvert)throw Error('aucun jour ouvert a 14:00 dans les 14 prochains jours');
      state.currentDate=jourOuvert;
      window.__configureStock=n=>{state.laneStatuses={};for(let i=n+1;i<=getAvailabilityLaneCount();i++)state.laneStatuses[i]='maintenance';};
      // L ecran de la fenetre repart de l accueil (rs), sans plan ni heure proposee : 14:00 est choisie.
      quickBookState={...window.__secoursGarde.quick,rs:null,plan:null,candidats:null,heureProposee:false,date:jourOuvert,startTime:'14:00',pax:18,type:'visite',duration:1,totalDuration:1,visit:{bowling:{on:true,duration:1},laser_game:{on:false},others:{},options:{bowling:{participants:7}}}};
      window.__configureStock(1);renderQuickBook();
      return {one:getQuickBookLaneNeed(),slot:getQuickBookAvailableSlots().find(s=>s.time===quickBookState.startTime),price:getQuickBookSummaryActivites().total};
    });
    await planDuServeur();
    const visible=await texteFenetre();
    // Le compteur redescend a 6 : la fenetre redemande son plan, l avertissement part ; a 7 il revient.
    await pg.evaluate(()=>{quickBookState.visit.options.bowling.participants=6;renderQuickBook();});
    await planDuServeur();
    const warningCleared=!SECOURS.test(await texteFenetre());
    await pg.evaluate(()=>{quickBookState.visit.options.bowling.participants=7;renderQuickBook();});
    await planDuServeur();
    const warningRestored=SECOURS.test(await texteFenetre());
    const suite=await pg.evaluate((one)=>{
      const item={...ligneProgrammeQuick('bowling'),duration:1};const detail=detailLigneProgramme(item,{pax:18});
      const r={id:9977,name:'SECOURS7',pax:18,date:quickBookState.date,startTime:quickBookState.startTime,duration:1,lanes:[1],type:'bowling',status:'pending',program:{items:[item]},opsPlan:{resourceBlocks:[{activityId:'bowling',resourceType:'bowling_lane',start:840,end:900,startTime:'14:00',endTime:'15:00',durationMinutes:60,players:7,lanes:[1],bowlingCapacity:one.bowlingCapacity}]}};
      state.reservations=[r];state.selectedRes=r;state.editState={pax:18,startTime:r.startTime,duration:1,programmeEdite:buildEditProgramFromReservation(r)};
      const editNeed=getEditBowlingCapacityNeed(r,state.editState);const editPrice=getEditPrixEstime().total;const advice=editLaneAdvice(r,{...state.editState,lanesStr:'1'});
      setStaffResourceView('bowling');const card=[...document.querySelectorAll('.booking[data-booking-res-id="9977"] .bk-pax')].map(el=>el.title).join(' | ');const timeline=getGroupeProgramme(r).map(step=>step.quoi).join(' | ');
      state.reservations=[];quickBookState.visit.options.bowling.participants=13;window.__configureStock(2);renderQuickBook();const two=getQuickBookLaneNeed();const twoPrice=getQuickBookSummaryActivites().total;
      return {detail,card,timeline,two,twoPrice,editNeed,editPrice,advice};
    },debut.one);
    await planDuServeur();
    const twoVisible=await texteFenetre();
    const normal=await pg.evaluate(()=>{window.__configureStock(3);return getQuickBookLaneNeed();});
    emergency={...debut,visible,warningCleared,warningRestored,...suite,twoVisible,normal};
  } finally {
    await pg.evaluate(()=>{const g=window.__secoursGarde;state.reservations=g.reservations;state.laneStatuses=g.statuses;quickBookState=g.quick;state.selectedRes=g.selected;state.editState=g.edit;state.currentDate=g.date;window.fetch=g.fetch;renderQuickBook();});
  }
  ok(emergency.one.requiredCount===1&&emergency.slot?.lanes.length===1&&emergency.price===39,'actual stock1 own7 of group18 offers one lane at39');
  ok(emergency.visible.includes('70 min')&&emergency.visible.includes('pas garanti')&&emergency.detail.includes('7 joueurs')&&emergency.detail.includes('70 min'),'actual quick dialog and detail show own7 emergency70min warning');
  ok(emergency.card.includes('7 joueurs')&&emergency.card.includes('70 min')&&emergency.timeline.includes('70 min'),'persisted emergency planning card and timeline warning');
  ok(emergency.two.requiredCount===2&&JSON.stringify(emergency.two.bowlingCapacity.lanePlayers)==='[6,7]'&&emergency.twoPrice===78&&emergency.twoVisible.includes('6 + 7'),'actual stock2 own13 uses6+7 at78 with visible partition');
  ok(emergency.warningCleared&&emergency.warningRestored,'live counter status removes stale emergency warning at6 and restores at7');
  ok(emergency.editNeed.requiredCount===1&&emergency.editPrice===39&&emergency.advice.includes('70 min'),'editing own7 of group18 ignores own lane and retains39 emergency estimate');
  ok(emergency.normal.requiredCount===3&&!emergency.normal.bowlingCapacity.emergency,'actual stock3 own13 retains normal comfort6');
  const refused=await pg.evaluate(async()=>{
    let posts=0;const previous=window.fetch;window.fetch=async(input,init)=>{if(String(init?.method||'').toUpperCase()==='POST'&&!JSON.parse(String(init?.body||'{}')).dryRun)posts++;return previous(input,init);};
    try {quickBookState.pax=1000;renderQuickBook();await saveQuickBook();return {pax:quickBookState.pax,options:quickBookState.visit.options,posts,error:quickBookState.error,visible:document.querySelector('#quickBookOverlay').textContent};}finally{window.fetch=previous;}
  });
  ok(refused.pax===1000&&refused.options.bowling.participants===6&&refused.options.billards.units===2&&refused.posts===0,'group1000 refusal preserves count/options and sends no POST');
  ok(refused.error.includes('240 personnes')&&refused.visible.includes('planifiée manuellement'),'group1000 real dialog clearly explains manual planning');
  ok(erreurs.length===0,'no browser JS errors: '+erreurs.join(' | '));
  await pg.close();
}
srv.listen(PORT,'127.0.0.1',async()=>{const b=await chromium.launch({executablePath:EDGE,headless:true});try{await mesurer(b);}catch(error){console.error(error);failures++;}finally{await b.close();srv.close(()=>{process.exitCode=failures?1:0;});}});
`;
const testModule = new Module(__filename, module);
testModule.filename = __filename;
testModule.paths = module.paths;
testModule._compile(prefix + mount + checks, __filename);
