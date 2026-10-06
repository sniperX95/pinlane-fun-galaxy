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
const checks = `
  const data = await pg.evaluate(() => {
    const row=state.reservations.find(r=>r.id===9900);
    const holder=document.createElement('section');document.body.append(holder);
    holder.innerHTML=renderReservationRow(row);
    const summary=holder.textContent;
    const timeline=getGroupeProgramme(row).map(step=>step.nom+' '+step.quoi).join(' | ');
    renderPlanning();renderLaserPlanning();
    const bowling=[...document.querySelectorAll('.booking[data-booking-res-id="9900"] .bk-pax')].map(el=>el.title);
    const laser=[...document.querySelectorAll('.laser-group-card[data-laser-res-id="9900"] .laser-group-count')].map(el=>el.title);
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
  ok(data.laser.length>0&&data.laser.every(count=>count==='4 joueurs'),'actual laser planning cards show4 players: '+JSON.stringify(data.laser));
  for(const [name,count] of [['Bowling',6],['Laser Game',4],['Minigolf Blacklight',3],['Billard',8],['Arcades',5],['Playground',2],['Duckpin Bowling',6],['Fun Run',4]]) {
    ok(data.timeline.includes(name+' '+count+' joueurs')||data.timeline.includes(name+' '+count+' enfants'),'all activities timeline '+name+' count'+count);
    const compact=data.summary.split(/\\s+/).join('');
    ok(compact.includes(name.split(' ').join('')+count+'joueurs')||compact.includes(name.split(' ').join('')+count+'enfants'),'all activities reservation card '+name+' count'+count);
  }
  ok(data.terrain.includes('Bowling · 6 joueurs')&&data.terrain.includes('Laser Game · 4 joueurs'),'terrain program own bowling6 laser4');
  ok(data.summary.includes('18 personnes présentes'),'mixed participants group header describes18 visitors');
  ok(data.freeCard.startsWith('0')&&data.freeCard.includes('€')&&data.freeText.includes('À encaisser · 0')&&!data.freeText.toLowerCase().includes('prix sur place')&&!data.freeText.toLowerCase().includes('prix au comptoir'),'actual card+detail known free price stays0');
  ok(data.unknownText.includes('Prix sur place')&&data.unknownText.includes('prix au comptoir'),'actual card+detail unknown price stays payable onsite');
  const info=await pg.locator('#posOverlay').innerText();
  ok(/Minigolf Blacklight/.test(info)&&/3 joueurs/.test(info)&&/Arcades/.test(info)&&/5 joueurs/.test(info),'live staff detail shows activity counts');
  await pg.evaluate(()=>{closePos();openQuickBook({pax:18,date:state.currentDate,startTime:'14:00'});quickBookState.type='visite';quickBookState.visit={bowling:{on:true,duration:1},laser_game:{on:true,games:2},others:{minigolf_blacklight:true,billards:true,arcade_time:true,playground:true,duckpin_bowling:true,fun_run:true},options:{bowling:{participants:6},laser_game:{participants:4},minigolf_blacklight:{participants:3},billards:{participants:8,units:2,hours:2},arcade_time:{participants:5},playground:{participants:2},duckpin_bowling:{participants:6},fun_run:{participants:4,minutes:30}}};syncQuickBookDuration();renderQuickBook();});
  const counters=await pg.locator('.qb-liste .qb-visit-compteur .qb-step-valeur').allTextContents();
  ok(JSON.stringify(counters)===JSON.stringify(['4 / 18','3 / 18','8 / 18','5 / 18','2 / 18','6 / 18','4 / 18','6 / 18']),'live quickbook all8 counters retain distinct counts');
  for(const width of [1440,390]) {
    await pg.setViewportSize({width,height:900});
    const min=await pg.evaluate(()=>Math.min(...Array.from(document.querySelectorAll('.qb-liste .qb-step-btn')).flatMap(b=>[b.getBoundingClientRect().width,b.getBoundingClientRect().height])));
    ok(min>=44,'counter targets at '+width+'px: '+min+'px');
    const clipped=await pg.evaluate(()=>[...document.querySelectorAll('.qb-liste .qb-visit-compteur')].some(el=>el.getBoundingClientRect().right>innerWidth));
    ok(!clipped,'participant controls fit '+width+'px viewport');
    await pg.screenshot({path:p.join(REPO,'tmp','staff-participants-'+width+'.png')});
  }
  await pg.evaluate(()=>{setQuickVisitParticipants('arcade_time',7);setQuickVisitParticipants('minigolf_blacklight',2);});
  const values=await pg.evaluate(()=>({arcade:getQuickVisitParticipants('arcade_time'),golf:getQuickVisitParticipants('minigolf_blacklight'),bowling:getQuickVisitParticipants('bowling'),laser:getQuickVisitParticipants('laser_game'),pax:quickBookState.pax}));
  ok(JSON.stringify(values)===JSON.stringify({arcade:7,golf:2,bowling:6,laser:4,pax:18}),'live counter changes preserve every other activity and visitors');
  await pg.evaluate(()=>{closeQuickBook();openStaffReservationDetail(9900);});
  await pg.evaluate(()=>{const button=[...document.querySelectorAll('#posOverlay button')].find(b=>b.textContent.trim()==='Modifier');if(button)button.click();});
  await pg.waitForTimeout(250);
  await pg.evaluate(()=>{const button=[...document.querySelectorAll('.edit-adapter-btn')].find(b=>/Adapter pour ce dossier/.test(b.textContent));if(button)button.click();});
  // The direct Laser editor is a separate control above the eight-activity list.
  const edit=await pg.locator('#posOverlay .qb-visit-compteur .qb-step-valeur:not(.dossier-laser-editor .qb-step-valeur)').allTextContents();
  ok(JSON.stringify(edit)===JSON.stringify(['4 / 18','3 / 18','8 / 18','5 / 18','2 / 18','6 / 18','4 / 18','6 / 18']),'live edit all8 counters roundtrip unchanged');
  const transfer=await pg.evaluate(()=>{
    closePos();
    const demande={date:state.currentDate,participants:18,formulas:[],activities:[{id:'bowling',name:'Bowling',participants:6,duration:1.5},{id:'laser_game',name:'Laser Game',participants:4,games:3},{id:'minigolf_blacklight',name:'Minigolf Blacklight',participants:3},{id:'billards',name:'Billard',participants:8,units:2,hours:2},{id:'arcade_time',name:'Arcades',participants:5},{id:'playground',name:'Playground',participants:2},{id:'duckpin_bowling',name:'Duckpin Bowling',participants:6,duration:0.5},{id:'fun_run',name:'Fun Run',participants:6,minutes:30}]};
    const item={id:'sm-all8',contactName:'Demande test',email:'',phone:'',payload:{demande}};
    staffCustomRequestsCache.key=String(getActiveOpsCenterId());staffCustomRequestsCache.items=[item];
    staffRequestToBooking(item.id);
    return {type:quickBookState.type,pax:quickBookState.pax,source:quickBookState.sourceRequestId,bowling:quickBookState.visit.bowling,laser:quickBookState.visit.laser_game,duckpin:ligneProgrammeQuick('duckpin_bowling'),billard:ligneProgrammeQuick('billards'),fun:ligneProgrammeQuick('fun_run'),labels:crActivites(demande).join(' | '),display:document.querySelector('#quickBookOverlay').textContent};
  });
  ok(transfer.type==='visite'&&transfer.pax===18&&transfer.source==='sm-all8','actual custom request becomes visit preserving source and18 visitors');
  ok(transfer.bowling.duration===1.5&&transfer.laser.games===3&&transfer.duckpin.duration===0.5&&transfer.billard.units===2&&transfer.billard.hours===2&&transfer.fun.minutes===30&&transfer.fun.participants===6,'actual custom transfer retains all durations/parts/tables/sessions/counts');
  const smCounters=await pg.locator('.qb-liste .qb-visit-compteur .qb-step-valeur').allTextContents();
  ok(JSON.stringify(smCounters)===JSON.stringify(['4 / 18','3 / 18','8 / 18','5 / 18','2 / 18','6 / 18','6 / 18','6 / 18']),'actual custom request all8 visible counters retain distinct counts');
  ok(transfer.labels.includes('Billard : 8 joueurs · 2 tables · 2h')&&transfer.labels.includes('Laser Game : 4 joueurs · 3 parties'),'actual request labels show players+full choices');
  const emergency=await pg.evaluate(()=>{
    const savedReservations=state.reservations;const savedStatuses=state.laneStatuses;const savedQuick=quickBookState;const savedSelected=state.selectedRes;const savedEdit=state.editState;const savedDate=state.currentDate;
    try {
      state.reservations=[];
      // Un jour FUTUR ouvert a 14:00 : le jour meme, les heures passees ne
      // sont plus proposees et le creneau de 14:00 disparaissait le soir.
      const jour=k=>{const d=new Date(todayStr()+'T12:00:00');d.setDate(d.getDate()+k);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
      const jourOuvert=[...Array(14)].map((_,k)=>jour(k+1)).find(d=>{const s=getSchedule(d,state.isHolidayMode);return s&&s.open<=14&&s.close>=15;});
      if(!jourOuvert)throw Error('aucun jour ouvert a 14:00 dans les 14 prochains jours');
      state.currentDate=jourOuvert;
      const configureStock=n=>{state.laneStatuses={};for(let i=n+1;i<=getAvailabilityLaneCount();i++)state.laneStatuses[i]='maintenance';};
      quickBookState={...savedQuick,date:jourOuvert,startTime:'14:00',pax:18,type:'visite',duration:1,totalDuration:1,visit:{bowling:{on:true,duration:1},laser_game:{on:false},others:{},options:{bowling:{participants:7}}}};
      configureStock(1);renderQuickBook();
      const one=getQuickBookLaneNeed();const slot=getQuickBookAvailableSlots().find(s=>s.time===quickBookState.startTime);const price=getQuickBookSummaryActivites().total;const visible=document.querySelector('#quickBookOverlay').textContent;
      quickBookState.visit.options.bowling.participants=6;patchQuickBookStatusLine(document.querySelector('#quickBookOverlay'));const warningCleared=document.querySelector('[data-bowling-capacity-warning]').hidden;quickBookState.visit.options.bowling.participants=7;patchQuickBookStatusLine(document.querySelector('#quickBookOverlay'));const warningRestored=!document.querySelector('[data-bowling-capacity-warning]').hidden;
      const item={...ligneProgrammeQuick('bowling'),duration:1};const detail=detailLigneProgramme(item,{pax:18});
      const r={id:9977,name:'SECOURS7',pax:18,date:quickBookState.date,startTime:quickBookState.startTime,duration:1,lanes:[1],type:'bowling',status:'pending',program:{items:[item]},opsPlan:{resourceBlocks:[{activityId:'bowling',resourceType:'bowling_lane',start:840,end:900,startTime:'14:00',endTime:'15:00',durationMinutes:60,players:7,lanes:[1],bowlingCapacity:one.bowlingCapacity}]}};
      state.reservations=[r];state.selectedRes=r;state.editState={pax:18,startTime:r.startTime,duration:1,programmeEdite:buildEditProgramFromReservation(r)};
      const editNeed=getEditBowlingCapacityNeed(r,state.editState);const editPrice=getEditPrixEstime().total;const advice=editLaneAdvice(r,{...state.editState,lanesStr:'1'});
      renderPlanning();const card=[...document.querySelectorAll('.booking[data-booking-res-id="9977"] .bk-pax')].map(el=>el.title).join(' | ');const timeline=getGroupeProgramme(r).map(step=>step.quoi).join(' | ');
      state.reservations=[];quickBookState.visit.options.bowling.participants=13;configureStock(2);renderQuickBook();const two=getQuickBookLaneNeed();const twoPrice=getQuickBookSummaryActivites().total;const twoVisible=document.querySelector('#quickBookOverlay').textContent;
      configureStock(3);const normal=getQuickBookLaneNeed();
      return {one,slot,price,visible,detail,card,timeline,two,twoPrice,twoVisible,normal,editNeed,editPrice,advice,warningCleared,warningRestored};
    } finally {state.reservations=savedReservations;state.laneStatuses=savedStatuses;quickBookState=savedQuick;state.selectedRes=savedSelected;state.editState=savedEdit;state.currentDate=savedDate;renderQuickBook();}
  });
  ok(emergency.one.requiredCount===1&&emergency.slot?.lanes.length===1&&emergency.price===39,'actual stock1 own7 of group18 offers one lane at39');
  ok(emergency.visible.includes('70 min')&&emergency.visible.includes('pas garanti')&&emergency.detail.includes('7 joueurs')&&emergency.detail.includes('70 min'),'actual quick dialog and detail show own7 emergency70min warning');
  ok(emergency.card.includes('7 joueurs')&&emergency.card.includes('70 min')&&emergency.timeline.includes('70 min'),'persisted emergency planning card and timeline warning');
  ok(emergency.two.requiredCount===2&&JSON.stringify(emergency.two.bowlingCapacity.lanePlayers)==='[6,7]'&&emergency.twoPrice===78&&emergency.twoVisible.includes('6 + 7'),'actual stock2 own13 uses6+7 at78 with visible partition');
  ok(emergency.warningCleared&&emergency.warningRestored,'live counter status removes stale emergency warning at6 and restores at7');
  ok(emergency.editNeed.requiredCount===1&&emergency.editPrice===39&&emergency.advice.includes('70 min'),'editing own7 of group18 ignores own lane and retains39 emergency estimate');
  ok(emergency.normal.requiredCount===3&&!emergency.normal.bowlingCapacity.emergency,'actual stock3 own13 retains normal comfort6');
  const refused=await pg.evaluate(async()=>{
    let posts=0;const previous=window.fetch;window.fetch=async(input,init)=>{if(String(init?.method||'').toUpperCase()==='POST')posts++;return previous(input,init);};
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
