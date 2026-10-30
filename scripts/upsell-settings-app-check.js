const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright-core');const {normalizeUpsellOffers}=require('../lib/upsell-offers');
const root=path.resolve(__dirname,'..');let checks=0;function ok(value,label){assert.ok(value,label);checks++;}
async function main(){const ROOT=root,PORT=Number(process.env.PINLANE_UPSELL_SETTINGS_PORT||4596),BASE_URL='http://127.0.0.1:'+PORT;
const BROWSER_PATH=process.env.E2E_BROWSER_PATH||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
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
    window.__QA_SAVED__ = []; window.__QA_PERMISSIONS__ = perms; window.__QA_CENTERS__ = CENTER_CONFIG;
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
        if(body.action==='saveCenterConfig')body.config.upsellOffers=await window.__normalizeUpsell(body.config.upsellOffers); window.__QA_SAVED__.push(body);
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

 const server=await serveStatic();const browser=await chromium.launch({executablePath:BROWSER_PATH,headless:true});const page=await browser.newPage({viewport:{width:390,height:850}}), errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.exposeFunction('__normalizeUpsell',v=>normalizeUpsellOffers(v,{strict:true}));await installMock(page);await openEstablishment(page,'upsell');await page.evaluate(()=>{selectEstablishmentCenter('libramont');startEstablishmentEdit();setEstablishmentTab('offres')});

  const shotDir=path.join(root,'tests/artifacts/upsell-settings');fs.mkdirSync(shotDir,{recursive:true});
  async function captureSettings(mode){if(mode==='edit'){await page.evaluate(()=>document.querySelector('#estab-upsell-settings .ups-photo').open=true);ok(await page.locator('.ups-card-head').isVisible(),'offerheader visible');ok(await page.locator('.ups-card-head [data-ups-key=enabled]').isVisible(),'offer toggle visible');ok(await page.locator('.ups-card-head [data-ups-action=remove]').isVisible(),'offer remove visible');}for(const theme of ['light','dark']){await page.evaluate(t=>setStaffTheme(t),theme);for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(350);const selector=mode==='edit'?'#estab-upsell-settings':'#estabPanel-offres .ups-settings';await page.locator(selector).screenshot({path:path.join(shotDir,mode+'-'+theme+'-'+width+'.png')});}}}
  await page.locator('[data-ups-action=configure]').click();await page.locator('[data-ups-action=add]').click();await page.locator('[data-ups-key=activityId]').selectOption('billards');await page.locator('[data-ups-key=title]').fill('Votre billard');await page.locator('[data-ups-key=title]').blur();await page.locator('[data-ups-key="options.units"]').fill('2');await page.locator('[data-ups-key="options.units"]').blur();await page.locator('[data-ups-key="discount.mode"]').selectOption('fixed_per_participant');await page.locator('[data-ups-key="discount.value"]').fill('1.25');await page.locator('[data-ups-key="discount.value"]').blur();
  await page.locator('[data-ups-key=minParticipants]').fill('10');await page.locator('[data-ups-key=minParticipants]').blur();await page.locator('[data-ups-key=maxParticipants]').fill('5');await page.locator('[data-ups-key=maxParticipants]').blur();await page.evaluate(()=>submitCenterConfig('libramont'));ok(await page.evaluate(()=>__QA_SAVED__.length)===0,'invalid draft blocks every centre write');ok(await page.locator('.ups-error').isVisible(),'bounds error full app');
  await page.locator('[data-ups-key=maxParticipants]').fill('30');await page.locator('[data-ups-key=maxParticipants]').blur();await page.locator('.ups-photo summary').click();await page.locator('[data-ups-photo]').first().click();await captureSettings('edit');await page.locator('#estabSaveBtn').click();await page.waitForFunction(()=>__QA_SAVED__.some(x=>x.action==='saveCenterConfig'));
  let payload=await page.evaluate(()=>__QA_SAVED__.find(x=>x.action==='saveCenterConfig'));ok(payload.centerId==='libramont','save scoped centre');ok(payload.config.upsellOffers.offers[0].discount.value===1.25,'actual save discount');ok(payload.config.upsellOffers.offers[0].options.units===2,'actual save options');ok(payload.config.upsellOffers.offers[0].minParticipants===10,'actual save bounds');ok(payload.config.activityOffers.arcade_time.timeOffers[0].price===15,'other commercial settings preserved');
  await page.waitForFunction(()=>!state.establishmentEditing);await page.evaluate(async()=>{await loadStaffCenterConfig(true);setEstablishmentTab('offres');renderStaffUtilityPage();});ok((await page.locator('#estabPanel-offres').innerText()).includes('Votre billard'),'forcedreload read title');ok((await page.locator('#estabPanel-offres').innerText()).includes('1.25 € / pers.'),'forcedreload read discount');ok(await page.evaluate(()=>staffCenterConfigCache.centers.find(c=>c.id==='gembloux').upsellOffers==null),'other centre unchanged');
  await captureSettings('read');await page.evaluate(()=>startEstablishmentEdit());
  ok(payload.config.upsellOffers.enabled===true&&payload.config.upsellOffers.offers[0].enabled===true,'active configured offer survived globalsave');
  for(const theme of ['light','dark']){
    await page.evaluate(t=>{state.staffTheme=t;document.documentElement.dataset.theme=t;renderStaffUtilityPage();},theme);
    for(const width of [390,320]){await page.setViewportSize({width,height:850});await page.waitForTimeout(350);ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'fullapp settings fit '+theme+' '+width+' '+JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('#estabPanel-offres *')].filter(e=>e.getBoundingClientRect().right>innerWidth+2).map(e=>({tag:e.tagName,cls:e.className,w:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})).slice(0,10))));}
    const contrasts=await page.locator('#estab-upsell-settings').evaluate(el=>{
      const rgb=s=>(s.match(/[\d.]+/g)||[]).slice(0,3).map(Number),lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
      return [...el.querySelectorAll('.ups-field span,.ups-note,.ups-switch span,input:not([type=checkbox]):not([type=range]),select,button')].filter(n=>n.getClientRects().length&&!n.disabled).map(n=>{let b=n;while(b&&getComputedStyle(b).backgroundColor==='rgba(0, 0, 0, 0)')b=b.parentElement;const fg=lum(rgb(getComputedStyle(n).color)),bg=lum(rgb(b?getComputedStyle(b).backgroundColor:'rgb(255,255,255)'));return {text:n.textContent.slice(0,50),ratio:(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)};});
    });ok(contrasts.every(x=>x.ratio>=4.5),'fullapp contrast '+theme+' '+JSON.stringify(contrasts.filter(x=>x.ratio<4.5)));
  }
await page.locator('.ups-photo summary').click();
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=16;c.height=16;return c.toDataURL('image/png').split(',')[1]});
  await page.evaluate(()=>{window.__originalBitmap=createImageBitmap;window.createImageBitmap=async(...args)=>{const image=await __originalBitmap(...args);await new Promise(r=>window.__finishBitmap=r);return image;}});
  await page.locator('[data-ups-upload]').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await page.waitForFunction(()=>typeof __finishBitmap==='function');const count=await page.evaluate(()=>__QA_SAVED__.length);await page.evaluate(()=>submitCenterConfig('libramont'));ok(await page.evaluate(()=>__QA_SAVED__.length)===count,'pending upload blocks global save');
  await page.evaluate(()=>{selectEstablishmentCenter('gembloux');startEstablishmentEdit();setEstablishmentTab('offres');__finishBitmap();createImageBitmap=__originalBitmap;});await page.waitForTimeout(150);ok(await page.locator('[data-ups-action=configure]').count()===1,'old image cannot enter new centre draft');ok(await page.evaluate(()=>PinlaneUpsellSettings.collect(getEstablishmentCenter()))===null,'new centre remains legacy');

  await page.evaluate(()=>{const c=staffCenterConfigCache.centers.find(c=>c.id==='gembloux');c.activityOffers.arcade_time.timeOffers[0].price=17.35;cancelEstablishmentEdit();startEstablishmentEdit();setEstablishmentTab('offres');});
  await page.locator('[data-ups-action=configure]').click();await page.locator('[data-ups-action=add]').click();await page.locator('[data-ups-key=activityId]').selectOption('arcade_time');
  ok((await page.locator('[data-ups-key=arcadePack]').innerText()).includes('17.35'),'Arcades selector follows establishment centre catalogue');
  await page.locator('[data-ups-key=arcadePack]').selectOption('credit:credit-25');ok(await page.evaluate(()=>PinlaneUpsellSettings.collect(getEstablishmentCenter()).offers[0].options.arcadeOfferId)==='credit-25','actual establishment card options preserve catalogue ID');
  await page.evaluate(()=>{cancelEstablishmentEdit();__QA_PERMISSIONS__.splice(__QA_PERMISSIONS__.indexOf('settings.manage'),1);state.staffAuthSession.permissions=state.staffAuthSession.permissions.filter(p=>p!=='settings.manage');state.staffAuthSession.role={...state.staffAuthSession.role,locked:false};localStorage.setItem('funGalaxy_auth_v1',JSON.stringify(state.staffAuthSession));});const previous=await page.evaluate(()=>__QA_SAVED__.length);await page.evaluate(async()=>{startEstablishmentEdit();await submitCenterConfig('gembloux');});ok(await page.evaluate(()=>!state.establishmentEditing),'no permission cannot enter editing');ok(await page.evaluate(()=>__QA_SAVED__.length)===previous,'no permission cannot save');
  ok(errors.length===0,'runtime errors '+errors.join(';'));
  console.log(`Upsell settings full app: ALL OK (${checks} assertions, actual global save and cache reload, mocked API writes only)`);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exit(1)});
