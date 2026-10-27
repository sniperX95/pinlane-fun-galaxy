const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'assets/app-main.js'),'utf8');
const activity={id:'arcade_time',name:'Arcades',priceType:'per_card',defaultMinutes:30,arcadeOffers:{enabled:true,timeOffers:[{id:'time-30',minutes:30,price:15,enabled:true},{id:'time-60',minutes:60,price:30,enabled:true}],creditOffers:[{id:'credits-10',price:10,credits:10,bonusCredits:0,enabled:true},{id:'credits-25',price:25,credits:25,bonusCredits:10,enabled:true},{id:'credits-35',price:35,credits:35,bonusCredits:15,enabled:true},{id:'credits-50',price:50,credits:50,bonusCredits:25,enabled:true}],creditGameCostMin:1.2,creditGameCostMax:2.4,timedDescription:'Jeux à volonté',creditDescription:'Jeux à lots inclus'}};
const nodes={};let asserts=0;
function equal(a,b,msg){assert.equal(a,b,msg);asserts++}function match(a,b,msg){assert.match(a,b,msg);asserts++}
const c=vm.createContext({console,state:{booking:{pax:18,activities:{},date:'2026-10-06'},editState:null},quickBookState:null,document:{getElementById:id=>nodes[id]},escapeHtml:s=>String(s),formatMoney:n=>`${Number(n).toFixed(2)} €`,formatMoneyCentimes:n=>`${Number(n).toFixed(2)} €`,formatDurationLabel:n=>`${n}h`,renderPos:()=>{},renderQuickBook:()=>{},save:()=>{},clearCurrentBookingChoice:()=>{},syncBookingTypeUi:()=>{},getRuntimeBowlingConfig:()=>null,getFreeCount:()=>12});
vm.runInContext(fs.readFileSync(path.join(root,'assets/booking-core.js'),'utf8'),c);c.catalog=[activity];vm.runInContext('setCenterActivities(catalog)',c);
for(const name of ['getStaffArcadeOfferDetail','editArcadeTimingChanged','editProgramAChange','editionChangeLePrix','getEditPriceValue','getEditPrixEstime','getEditPrixActivites','estimerFormuleEdition','extrasCourantsEdition','editExtrasAChange','extrasDepuisLignes','setEditActivityParticipants','bowlingCapacityMessage','activityCountsChildren','activityParticipantsBounds','getBookingActivityParticipants','participantsLigneProgramme','nomActivite','catalogueDeLigne','ligneALaJournee','detailLigneProgramme','detailLigneProgrammeSansEffectif','detailUnitesLigne','ensureQuickVisit','getQuickVisitOptions','getQuickVisitParticipants','getQuickVisitMinutes','getQuickVisitUnits','getQuickVisitHours','ligneProgrammeQuick','syncQuickBookDuration','renderStaffArcadeOptions','setStaffArcadeOption','buildEditProgramFromReservation','getEditProgramItems','estimerPrixProgramme','quickExtrasEtat','quickHasPaidArcades','quickExtrasLignes','renderEstablishmentArcadeOffers','collectEstablishmentArcadeOffers','getChosenActivities','normalizeBookingMode','deriveBookingType','buildBookingProgramPayload']){
 const start=app.indexOf(`function ${name}(`);assert.ok(start>=0,name);const end=app.indexOf('\nfunction ',start+1);vm.runInContext(app.slice(start,end<0?undefined:end),c);
}
function run(s){return vm.runInContext(s,c)}
for (const id of ['time-30','time-60','credits-10','credits-25','credits-35','credits-50']) {
 const detail=run(`getStaffArcadeOfferDetail({cards:2,arcadeOffer:getArcadeOfferQuote(getCenterActivity('arcade_time'),{arcadeMode:'${id.startsWith('time')?'time':'credit'}',arcadeOfferId:'${id}',cards:2},3).offer})`);
 assert.doesNotMatch(detail,/cadeaux|lots|volont|jeux|1[.,]2|2[.,]4/i);asserts++;
 match(detail,id.startsWith('time')?/min par carte/:/offerts = .* par carte/);
}
for(const [id,price] of [['time-30',15],['time-60',30]]) equal(run(`getFreeActivityPrice(getCenterActivity('arcade_time'),{pax:3,arcadeMode:'time',arcadeOfferId:'${id}',cards:1})`),price*3);
for(const [id,price,bonus] of [['credits-10',10,0],['credits-25',25,10],['credits-35',35,15],['credits-50',50,25]]){ equal(run(`getFreeActivityPrice(getCenterActivity('arcade_time'),{pax:18,arcadeMode:'credit',arcadeOfferId:'${id}',cards:2})`),price*2);const q=run(`getArcadeOfferQuote(getCenterActivity('arcade_time'),{arcadeMode:'credit',arcadeOfferId:'${id}',cards:2},18)`);equal(q.offer.bonusCredits,bonus);match(run(`getArcadeOfferDetail({cards:2,arcadeOffer:getArcadeOfferQuote(getCenterActivity('arcade_time'),{arcadeMode:'credit',arcadeOfferId:'${id}',cards:2},18).offer})`),/2 cartes/);}
equal(run("getFreeActivityPrice(getCenterActivity('arcade_time'),{pax:18})"),null,'legacy unknown preserved');
c.quickBookState={pax:18,type:'activity',activityId:'arcade_time',visit:{bowling:{on:false},laser_game:{on:false},others:{},options:{arcade_time:{participants:3,arcadeMode:'credit',arcadeOfferId:'credits-25',cards:2}}},surMesure:true};
c.quickActiviteRetenue=id=>c.quickBookState.activityId===id;
equal(run("ligneProgrammeQuick('arcade_time').cards"),2);equal(run("ligneProgrammeQuick('arcade_time').participants"),3);
equal(run("estimerPrixProgramme([ligneProgrammeQuick('arcade_time')],18).total"),50);
match(run("renderStaffArcadeOptions(getCenterActivity('arcade_time'),getQuickVisitOptions('arcade_time'),3,'quick')"),/Nombre de cartes Arcades/);
match(run("detailLigneProgramme(ligneProgrammeQuick('arcade_time'),{pax:18})"),/3 joueurs.*2 cartes.*25.*10.*35/);
assert.doesNotMatch(run("detailLigneProgramme(ligneProgrammeQuick('arcade_time'),{pax:18})"),/30 min|0.5h/);asserts++;
run("setStaffArcadeOption('quick','cards',5)");equal(run("ligneProgrammeQuick('arcade_time').cards"),5);
run("setStaffArcadeOption('quick','arcadeMode','time','time-60')");equal(run("ligneProgrammeQuick('arcade_time').cards"),3);equal(run('quickBookState.totalDuration'),1);
run("getQuickVisitOptions('arcade_time').participants=2");equal(run("ligneProgrammeQuick('arcade_time').cards"),2);
run("quickExtrasEtat().arcades={mode:'argent',prix:25}");equal(run('quickExtrasLignes().length'),0,'no duplicate paid cards extra');
run("delete getQuickVisitOptions('arcade_time').arcadeMode;delete getQuickVisitOptions('arcade_time').arcadeOfferId");equal(run('quickExtrasLignes()[0].price'),450,'legacy extras preserved');
const snapshot={id:'credits-25',mode:'credit',price:25,credits:25,bonusCredits:10,totalCredits:35,gameCostMin:1.2,gameCostMax:2.4};c.res={pax:18,program:{items:[{activityId:'arcade_time',participants:3,cards:2,arcadeMode:'credit',arcadeOfferId:'credits-25',arcadeOffer:snapshot,minutes:30,durationEstimated:true,price:50,priceKnown:true}]}};
run('state.editState={pax:18,programmeEdite:buildEditProgramFromReservation(res)}');equal(run('getEditProgramItems()[0].cards'),2);equal(run('getEditProgramItems()[0].arcadeOffer.bonusCredits'),10);equal(run('estimerPrixProgramme(getEditProgramItems(),18).total'),50);
activity.arcadeOffers.creditOffers[1].price=27.35;equal(run('estimerPrixProgramme(getEditProgramItems(),18).total'),50,'persisted snapshot quotation kept');
run("setStaffArcadeOption('edit','cards',3)");equal(run('estimerPrixProgramme(getEditProgramItems(),18).total'),82.05,'new choice repriced cents');
activity.arcadeOffers.creditOffers[1].price=0;equal(run('estimerPrixProgramme(getEditProgramItems(),18).total'),0);equal(run('estimerPrixProgramme(getEditProgramItems(),18).complet'),true);
c.state.booking.activities={arcade_time:{participants:4,arcadeMode:'credit',arcadeOfferId:'credits-10',cards:2}};equal(run('buildBookingProgramPayload()[0].cards'),2);equal(run('buildBookingProgramPayload()[0].participants'),4);
const centre={activityOffers:{arcade_time:activity.arcadeOffers,other:{enabled:true}}};c.centre=centre;
const html=run('renderEstablishmentArcadeOffers(centre)');match(html,/estab-arc-time-0-price/);match(html,/estab-arc-credit-3-bonusCredits/);match(html,/step="0.01"/);
nodes['estab-arc-enabled']={checked:true};for(const [mode,list] of [['time',activity.arcadeOffers.timeOffers],['credit',activity.arcadeOffers.creditOffers]])list.forEach((o,i)=>{nodes[`estab-arc-${mode}-${i}-enabled`]={checked:o.enabled};for(const k of ['price',...(mode==='time'?['minutes']:['credits','bonusCredits'])])nodes[`estab-arc-${mode}-${i}-${k}`]={value:String(o[k])};});
for(const [key,val] of [['gameMin','1.20'],['gameMax','2.40'],['timeDescription','Temps'],['creditDescription','Crédits']]) nodes[`estab-arc-${key}`]={value:val};
nodes['estab-arc-time-0-price'].value='15.35';const saved=run('collectEstablishmentArcadeOffers(centre)');equal(saved.arcade_time.timeOffers[0].price,15.35);equal(saved.arcade_time.creditOffers[3].bonusCredits,25);equal(saved.other.enabled,true);equal(saved.arcade_time.creditGameCostMin,1.2);
console.log(`Arcades staff: ALL OK (${asserts} assertions, isolated VM, no network/database writes)`);

async function checkDom() {
 const http=require('node:http'),{chromium}=require('playwright-core');
 const ROOT=root,PORT=Number(process.env.PINLANE_ARCADE_STAFF_PORT || 4558),BASE_URL=`http://127.0.0.1:${PORT}`;
 const BROWSER_PATH=process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
 const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};
const centerConfig = (() => {
  const cc = require(path.join(ROOT, 'lib', 'center-config'));
  const baseline = require(path.join(ROOT, 'ops-knowledge', 'centers.json'));
  const knowledge = require(path.join(ROOT, 'ops-knowledge', 'activities.json'));
  return {
    ok: true,
    centers: (baseline.centers || []).map(center => ({ id: center.id, name: center.name, clientId: 'fungalaxy', clientName: 'Fun Galaxy', ...cc.toEditableConfig(center) })),
    activities: (knowledge.activities || []).map(activity => ({ id: activity.id, label: activity.label || activity.name || activity.id })),
  };
})();

function serveStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE_URL);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') filePath = path.join(ROOT, 'index.html');
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(content);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)); });
}

async function installMock(page) {
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await page.addInitScript(({ expiresAt, CENTER_CONFIG }) => {
    const perms = ['dashboard.view', 'planning.view', 'reservations.view', 'clients.view', 'settings.manage', 'direction.view', 'centers.switch'];
    const qaSession = { token: 'qa', cookieBacked: false, centerId: 'libramont', expiresAt, member: { id: 'qa', name: 'Rachel', roleId: 'direction' }, role: { id: 'direction', name: 'Direction', locked: true }, permissions: perms };
    // UN SERVEUR NE CHANGE PAS D ETAG QUAND RIEN N A BOUGE. La console lit
    // l ETag avant payload.revision et re-rend des qu il change : un etag
    // horodate faisait re-rendre la console A CHAQUE SONDAGE, et un re-rendu qui
    // tombe pendant un geste detruit la carte tiree ou remet le defilement a
    // zero. Le vrai /api/staff-state pose ETag = snapshot.revision : ici l etag
    // est l empreinte du contenu servi, meme contenu donc meme etag.
    const J = (p) => {
      const corps = JSON.stringify(p);
      let h = 0;
      for (let i = 0; i < corps.length; i += 1) h = (h * 31 + corps.charCodeAt(i)) | 0;
      return new Response(corps, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', etag: `qa-${(h >>> 0).toString(36)}` } });
    };
    const nativeFetch = window.fetch.bind(window);
    window.__QA_SAVED__ = [];
    window.fetch = async (input, init = {}) => {
      const raw = typeof input === 'string' ? input : input?.url || '';
      const u = new URL(raw, window.location.origin);
      const method = String(init.method || 'GET').toUpperCase();
      if (u.pathname === '/api/staff-auth') return J({ ok: true, authenticated: true, session: qaSession, accessControl: { selectedRoleId: 'direction', selectedMemberId: 'qa', roles: [{ id: 'direction', name: 'Direction', code: 'DI', tone: 'admin', accessCode: 'X', updatedAt: new Date().toISOString(), locked: true, permissions: perms }], members: [{ id: 'qa', name: 'Rachel', contact: 'q@x', roleId: 'direction', status: 'active', code: 'X', lastSeen: new Date().toISOString() }], events: [], permissions: perms } });
      if (u.pathname === '/api/staff-state') return J({ ok: true, revision: 'qa', reservations: [], laneStatuses: {}, centerId: 'libramont' });
      if (u.pathname === '/api/public-booking-meta') return J({ ok: true, today: '2026-07-18', durationOptions: [], formules: [/* forme prod reelle : depuis le durcissement anti-fuite, une liste vide = ce centre ne vend AUCUNE formule (plus de repli constante) */ { id: 'f1', name: 'FORMULE 1', family: 'Formules anniversaires', desc: ['1h de Bowling', '1 partie Laser Game', '30 min arcades', '2 cruches boissons'], price: 26, type: 'per_pax', minPax: 6, oldPrice: 34, noHolidays: false, hasBowling: true, bowlingDur: 1, notes: [] }], center: { id: 'libramont', status: 'active' } });
      if (u.pathname === '/api/admin-range') return J({ ok: true, reservations: [], emails: [], agentEvents: [], centerId: 'libramont' });
      if (u.pathname === '/api/ops' && method === 'POST') {
        const body = JSON.parse(init.body || '{}');
        window.__QA_SAVED__.push(body);
        if(body.action==='saveCenterConfig') {const index=CENTER_CONFIG.centers.findIndex(c=>c.id===body.centerId);if(index>=0) CENTER_CONFIG.centers[index]={...CENTER_CONFIG.centers[index],...body.config};}
        return J({ ok: true });
      }
      if (u.pathname === '/api/ops' && u.searchParams.get('action') === 'centerConfig') return J(CENTER_CONFIG);
      if (u.pathname === '/api/ops') return J({ ok: true, communications: [], samples: [], suggestions: [], events: [], ecosystem: null, agents: [], activations: [], orchestration: {}, blocks: [] });
      return nativeFetch(input, init);
    };
    window.localStorage.setItem('funGalaxy_auth_v1', JSON.stringify(qaSession));
  }, { expiresAt, CENTER_CONFIG: centerConfig });
}

async function openEstablishment(page, cacheKey) {
  // domcontentloaded + attentes explicites : le polling staff empeche le
  // networkidle de se produire une fois l'app demarree.
  await page.goto(`${BASE_URL}/?v=estabtabs-${cacheKey}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.renderStaffUtilityPage === 'function', null, { timeout: 15000 });
  await page.evaluate(() => {
    state.currentDate = '2026-07-18';
    state.staffMenuPage = 'establishment';
    state.establishmentTab = 'centre';
    state.establishmentEditing = false;
    state.staffTheme = 'dark';
    save();
    setView('staff');
  });
  await page.waitForSelector('.estab-tabs button', { state: 'visible', timeout: 15000 });
}


 const server=await serveStatic();const browser=await chromium.launch({executablePath:BROWSER_PATH,headless:true});const page=await browser.newPage({viewport:{width:390,height:850}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try {
  await installMock(page);await openEstablishment(page,'arcades');await page.evaluate(()=>startEstablishmentEdit());await page.waitForSelector('#estab-arc-time-0-price',{state:'attached'});
  const changed=await page.evaluate(()=>{setEstablishmentTab('offres');document.getElementById('estab-arc-time-0-price').value='15.35';document.getElementById('estab-arc-credit-1-bonusCredits').value='11';setEstablishmentTab('horaires');return document.getElementById('estab-arc-time-0-price').value;});equal(changed,'15.35','DOM tab preserves Arcades price');
  const config=await page.evaluate(async()=>{await submitCenterConfig('libramont');return window.__QA_SAVED__.find(b=>b.action==='saveCenterConfig')?.config;});equal(config.activityOffers.arcade_time.timeOffers[0].price,15.35,'real submit captured cents');equal(config.activityOffers.arcade_time.creditOffers[1].bonusCredits,11,'real submit captured bonus');
  const centreIsolation=await page.evaluate(()=>{const other=staffCenterConfigCache.centers.find(c=>c.id==='gembloux');return other.activityOffers.arcade_time.timeOffers[0].price;});equal(centreIsolation,15,'editing Libramont leaves Gembloux intact');
  await page.evaluate(()=>{state.establishmentTab='offres';renderStaffUtilityPage();});
  await page.waitForTimeout(100);match(await page.locator('#estabPanel-offres').innerText(),/15[,.]35/,'read view exposes saved offers');
  await page.evaluate(()=>startEstablishmentEdit());await page.evaluate(()=>setEstablishmentTab('offres'));
  for(const width of [390,320]){await page.setViewportSize({width,height:850});await page.waitForTimeout(350);const fit=await page.evaluate(()=>({ok:document.documentElement.scrollWidth<=window.innerWidth+2,bad:[...document.querySelectorAll("#estabPanel-offres *")].map(e=>({tag:e.tagName,cl:e.className,id:e.id,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width})).filter(e=>e.right>innerWidth+2).slice(0,10)}));equal(fit.ok,true,`settings fits ${width}px ${JSON.stringify(fit.bad)}`);}
  equal(await page.evaluate(()=>[...document.querySelectorAll('.estab-arcade-offers .estab-arcade-toggle')].every(e=>e.getBoundingClientRect().height>=44)),true,'Arcades checkbox labels44px');
  const editPayloads=await page.evaluate(async()=>{
    window.__EDIT_CAPTURE=[];
    apiRequest=async(url,init)=>{const body=JSON.parse(init.body);window.__EDIT_CAPTURE.push(body);return {ok:true,reservation:{...body,updatedAt:'2026-10-03T12:00:01Z'}};};
    validateSlotWindow=()=>({ok:true});parseLaneInput=()=>[];lanesConflict=()=>[];applyOptimisticReservation=()=>{};renderPos=()=>{};closePos=()=>{};toast=()=>{};peutAdapterFormule=()=>true;getReservationPriceGap=()=>0;
    const offers=structuredClone(staffCenterConfigCache.centers.find(c=>c.id==='libramont').activityOffers.arcade_time);offers.timeOffers[0].price=20;
    setCenterActivities([{id:'arcade_time',name:'Arcades',priceType:'per_card',defaultMinutes:30,arcadeOffers:offers}]);
    const snapshot={id:'time-30',mode:'time',price:15,minutes:30,description:'Sans cadeaux',unlimited:true,prizeGamesIncluded:false};
    const original={id:99,centerId:'libramont',channel:'staff',pax:18,date:'2026-10-06',startTime:'15:00',duration:0.5,totalDuration:0.5,type:'activity',activityId:'arcade_time',status:'confirmed',name:'Alice',phone:'',email:'',lanes:[],laneCount:0,requiresLanes:false,price:60,basePrice:60,updatedAt:'2026-10-03T12:00:00Z',program:{items:[{activityId:'arcade_time',participants:4,cards:4,arcadeMode:'time',arcadeOfferId:'time-30',arcadeOffer:snapshot,minutes:30,duration:0.5,price:60,priceKnown:true}]}};
    const reset=()=>{state.selectedRes=structuredClone(original);state.editState=etatEditionDepuis(state.selectedRes);state.editState.price='60';state.editState.programmeEdite=buildEditProgramFromReservation(state.selectedRes);state.editState.programmeEditeInitial=JSON.stringify(state.editState.programmeEdite);};
    reset();state.editState.name='Bob';offers.timeOffers[0].enabled=false;await saveEdit({preventDefault(){}});
    reset();offers.timeOffers[0].enabled=true;setEditActivityParticipants('arcade_time',3);await saveEdit({preventDefault(){}});
    reset();setEditActivityParticipants('arcade_time',3);state.editState.prixFige=true;state.editState.price='0';await saveEdit({preventDefault(){}});
    reset();state.editState.startTime='16:00';await saveEdit({preventDefault(){}});
    reset();state.editState.pax=20;state.editState.name='Visitors';await saveEdit({preventDefault(){}});
    return window.__EDIT_CAPTURE;
  });
  equal(editPayloads.length,5,'actual saveEdit captured five PATCHes');
  equal(editPayloads[0].price,60,'contact-only keeps charged price with disabled offer');equal(editPayloads[0].basePrice,60,'contact-only keeps reference');equal(editPayloads[0].program.items[0].arcadeOffer.price,15,'contact-only keeps purchased snapshot');
  equal(editPayloads[1].program.items[0].participants,3);equal(editPayloads[1].program.items[0].cards,3,'time cards follows changed ownplayers');equal(editPayloads[1].price,60,'three cards at current20');equal(editPayloads[1].program.items[0].arcadeOffer,undefined,'new choice never sends historical snapshot');
  equal(editPayloads[2].price,0,'explicit zero manual price preserved');equal(editPayloads[2].basePrice,60,'manual zero retains current reference');
  equal(editPayloads[3].price,80,'changing time uses current unit price');
  equal(editPayloads[4].program.items[0].cards,4,'globalvisitors20 leaves owncards4');equal(editPayloads[4].price,60,'globalvisitor-only change keeps identical card contract');
  const exactMoney=await page.evaluate(()=>{
    const r={id:901,name:'Prix Arcades',centerId:'libramont',channel:'staff',date:'2026-10-06',startTime:'15:00',duration:0.5,totalDuration:0.5,type:'activity',activityId:'arcade_time',pax:18,status:'arrived',lanes:[],price:35.35,basePrice:35.35,extras:[],program:{priceComplete:true,items:[{activityId:'arcade_time',name:'Arcades',participants:3,cards:2,price:35.35,priceKnown:true,planned:false,arcadeMode:'credit',arcadeOfferId:'credit-25',arcadeOffer:{id:'credit-25',mode:'credit',price:17.675,credits:25,bonusCredits:10,totalCredits:35,gameCostMin:1.2,gameCostMax:2.4}}]}};
    // Isolate peripheral scheduling data while executing the real monetary renderers and formatters.
    getGroupeProgramme=()=>[{cle:'libre-0',activityId:'arcade_time'}];getStaffReservationMoments=()=>new Map();getLateArrivalMinutes=()=>0;renderGroupeAlerte=()=>'';renderGroupeEncadres=()=>'';renderGroupeNotes=()=>'';renderGroupeTerminer=()=>'';renderGroupeEtapes=()=>'';
    const surfaces={card:renderGroupePrix(r,{etat:'closing'}),payment:renderGroupeActions(r,{etat:'closing'}),line:[...getGroupePrixParActivite(r).values()].join(' '),pos:renderPosDetails(r),dashboard:renderStaffDashboardReservationRows([r])};
    surfaces.badge=renderReservationPriceMark({...r,basePrice:40.45},{forme:'encadre'});
    getStaffTerrainStatus=()=>({label:'Présent',className:''});getStaffTerrainTiming=()=>({label:'15:00'});getStaffTerrainResources=()=>'';getReservationOccasion=()=>'';
    surfaces.terrain=renderStaffTerrainCard({reservation:r},'now',{});
    const div=document.createElement('div');div.id='arcade-money-surfaces';div.innerHTML=Object.entries(surfaces).map(([name,html])=>`<section data-money="${name}">${html}</section>`).join('');document.body.appendChild(div);
    return Object.fromEntries([...div.querySelectorAll('[data-money]')].map(e=>[e.dataset.money,e.textContent]));
  });
  for(const [surface,text] of Object.entries(exactMoney)) match(text,/35,35/,`actual DOM ${surface} price retains cents`);
  match(exactMoney.badge,/40,45/,'actual DOM adjustment reference retains cents');
  const artifacts=path.join(root,'tests/artifacts/arcade-offers-staff');fs.mkdirSync(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,'settings-320.png'),fullPage:true});
  const html=await page.evaluate(()=>{setCenterActivities([{id:'arcade_time',name:'Arcades',priceType:'per_card',arcadeOffers:staffCenterConfigCache.centers.find(c=>c.id==='libramont').activityOffers.arcade_time}]);return renderStaffArcadeOptions(getCenterActivity('arcade_time'),{arcadeMode:'credit',arcadeOfferId:'credit-25',cards:2},3,'quick');});
  // Real DOM layout for the shared quick/edit card controls within the existing modal styles.
  await page.evaluate(html=>{const pane=document.createElement('div');pane.id='arcade-dom-preview';pane.className='qb-modal';pane.innerHTML=html;document.body.replaceChildren(pane);},html);
  equal(await page.evaluate(()=>[...document.querySelectorAll('[onclick^="setStaffArcadeOption"]')].every(e=>e.getBoundingClientRect().height>=44)),true,'all six card offers44px');
  equal(await page.evaluate(()=>[...document.querySelectorAll('[onclick^="setStaffArcadeOption"] small')].every(e=>parseFloat(getComputedStyle(e).fontSize)>=12)),true,'card prices minimum12px');
  match(await page.locator('#arcade-dom-preview').innerText(),/2 cartes/);assert.doesNotMatch(await page.locator('#arcade-dom-preview').innerText(),/30 min par carte.*crédits/);asserts++;
  for(const width of [390,320]){await page.setViewportSize({width,height:850});await page.waitForTimeout(350);equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),true,`card controls fit ${width}px`);}
  await page.screenshot({path:path.join(artifacts,'cards-320.png'),fullPage:true});
  equal(errors.length,0,`DOM runtime errors: ${errors.join('; ')}`);
  console.log(`Arcades staff DOM: ALL OK (${asserts} total assertions, mocked fetch only)`);
 } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
checkDom().catch(error=>{console.error(error);process.exitCode=1});
