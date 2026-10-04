(function (global) {
  'use strict';
  const MAX = 6, PHOTO_BYTES = 120 * 1024;
  const PHOTOS = [['billard-800.webp', 'Billard'], ['minigolf-800.webp', 'Minigolf'], ['arcades-800.webp', 'Arcades'], ['laser-joueur-800.webp', 'Laser Game'], ['duckpin-800.webp', 'Duckpin'], ['fun-run-800.webp', 'Fun Run'], ['plaine-800.webp', 'Playground']];
  const DISCOUNTS = [['none', 'Sans remise'], ['percent', 'Pourcentage (%)'], ['fixed_per_participant', 'Euros par participant'], ['fixed_total', 'Euros sur le total']];
  let draft, catalogue = [], centerKey = '', generation = 0, serial = 0, busy = new Set();
  const copy = value => value == null ? null : JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function photoSafe(src) {
    if (/^\/assets\/[a-z0-9_./-]+\.(jpe?g|png|webp)$/i.test(src)) return !src.includes('..') && !src.includes('//');
    if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(src)) return src.length <= Math.ceil(PHOTO_BYTES / 3) * 4 + 40;
    try { const u = new URL(src); return u.protocol === 'https:' && !u.username && !u.password && src.length <= 2048 && !/\.svg$/i.test(u.pathname); } catch (_) { return false; }
  }
  const eligible = () => catalogue.filter(a => a.id === 'laser_game' || (!a.planned && a.id !== 'bowling'));
  const activity = id => catalogue.find(a => a.id === id) || {id, label: id};
  const name = id => activity(id).label || activity(id).name || id;
  function start(center, list) { generation++; busy.clear(); centerKey = String(center?.id || ''); catalogue = list || []; draft = copy(center?.upsellOffers); }
  function cancel() { generation++; busy.clear(); draft = undefined; centerKey = ''; }
  function ensure(center, list) { if (draft === undefined || centerKey !== String(center?.id || '')) start(center, list); else catalogue = list || catalogue; }
  function field(label, key, value, attrs = '') { return `<label class="ups-field"><span>${esc(label)}</span><input data-ups-key="${key}" value="${esc(value)}" ${attrs}></label>`; }
  function select(label, key, value, options) { return `<label class="ups-field"><span>${esc(label)}</span><select data-ups-key="${key}">${options.map(([v,t])=>`<option value="${esc(v)}" ${String(v)===String(value)?'selected':''}>${esc(t)}</option>`).join('')}</select></label>`; }
  function optionFields(o) {
    const a = activity(o.activityId), opts = o.options || {};
    if (o.activityId === 'laser_game') return select('Nombre total de parties après ajout', 'options.games', opts.games || 2, [[2,'2 parties'],[3,'3 parties']]);
    if (o.activityId === 'arcade_time') {
      const arc = a.arcadeOffers || {}, time = arc.timeOffers || [], credit = arc.creditOffers || [];
      const packs = [...time.filter(p=>p.enabled!==false).map(p=>[`time:${p.id}`,`${p.minutes} min · ${p.price} € / carte`]), ...credit.filter(p=>p.enabled!==false).map(p=>[`credit:${p.id}`,`${p.credits} + ${p.bonusCredits||0} crédits · ${p.price} € / carte`])];
      return packs.length ? select('Carte proposée', 'arcadePack', `${opts.arcadeMode || 'time'}:${opts.arcadeOfferId || time[0]?.id || ''}`, packs) : '<p class="ups-note">Configurez et activez une carte Arcades ci-dessous avant de proposer cette activité.</p>';
    }
    if (o.activityId === 'billards' || a.priceType === 'per_unit_hour') return `<div class="ups-fields">${field('Tables', 'options.units', opts.units || 1, 'type="number" min="1" max="240" step="1"')}${field('Durée (heures)', 'options.hours', opts.hours || 1, 'type="number" min="0.5" max="6" step="0.5"')}</div>`;
    if (o.activityId === 'duckpin_bowling') return select('Durée', 'options.duration', opts.duration || 1, [[0.5,'30 minutes'],[1,'1 heure'],[1.5,'1 h 30'],[2,'2 heures']]);
    if (o.activityId === 'fun_run') return select('Durée', 'options.minutes', opts.minutes || 30, [[15,'15 minutes'],[30,'30 minutes']]);
    return '<p class="ups-note">Le tarif et la durée viennent du catalogue de cette activité.</p>';
  }
  function card(o, i) {
    const options = eligible().map(a=>[a.id, a.label || a.name || a.id]);
    if (!options.some(a=>a[0]===o.activityId)) options.unshift([o.activityId,`${name(o.activityId)} · indisponible`]);
    const image = o.image && photoSafe(o.image.src) ? o.image : null;
    return `<article class="ups-card" data-ups-id="${esc(o.id)}"><div class="ups-card-head"><label class="ups-switch"><input type="checkbox" data-ups-key="enabled" ${o.enabled?'checked':''}><span>Suggestion ${i+1}</span></label><div class="ups-actions"><button type="button" data-ups-action="up" aria-label="Monter la suggestion ${i+1}" ${i===0?'disabled':''}>↑</button><button type="button" data-ups-action="down" aria-label="Descendre la suggestion ${i+1}" ${i===draft.offers.length-1?'disabled':''}>↓</button><button type="button" data-ups-action="remove" aria-label="Retirer la suggestion ${i+1}">Retirer</button></div></div>
      <div class="ups-fields">${select('Activité', 'activityId', o.activityId, options)}${field('Titre (facultatif)', 'title', o.title || '', 'type="text" maxlength="100" placeholder="Nom de l’activité"')}</div>
      ${o.kind==='laser_upgrade'?'<p class="ups-note">Une partie supplémentaire pour les participants choisis. Les parties déjà réservées restent inchangées.</p>':''}${optionFields(o)}
      <div class="ups-fields">${field('Minimum de participants','minParticipants',o.minParticipants,'type="number" min="1" max="240" step="1"')}${field('Maximum de participants','maxParticipants',o.maxParticipants,'type="number" min="1" max="240" step="1"')}</div>
      <div class="ups-fields">${select('Remise','discount.mode',o.discount.mode,DISCOUNTS)}${o.discount.mode==='none'?'<p class="ups-note">Prix du catalogue, sans réduction.</p>':field(o.discount.mode==='percent'?'Remise (%)':o.discount.mode==='fixed_per_participant'?'Remise (€ / participant)':'Remise (€ sur le total)','discount.value',o.discount.value,`type="number" min="0" max="${o.discount.mode==='percent'?100:10000}" step="0.01"`)}</div>
      <p class="ups-note">Le client choisit son effectif. Les prix sont recalculés selon les personnes, tables, pistes ou cartes. La remise est plafonnée au prix de l’ajout. Une offre apparaît seulement si l’activité et l’effectif sont disponibles.</p>
      <details class="ups-photo"><summary>Photo et cadrage${image?' · personnalisés':''}</summary><div class="ups-photo-layout"><div class="ups-preview">${image?`<img alt="Aperçu de la suggestion" src="${esc(image.src)}" style="object-position:${Number(image.positionX??50)}% ${Number(image.positionY??50)}%;transform:scale(${Number(image.zoom)||1})">`:'<span>Photo de l’activité par défaut</span>'}</div><div><div class="ups-library">${PHOTOS.map(([file,label])=>`<button type="button" data-ups-photo="/assets/fungalaxy/${file}" aria-label="Choisir la photo ${esc(label)}"><img src="/assets/fungalaxy/${file}" alt=""><span>${esc(label)}</span></button>`).join('')}</div>${field('URL de la photo (HTTPS)', 'imageUrl', image && !image.src.startsWith('data:') ? image.src : '', 'type="url" placeholder="https://…"')}<label class="ups-upload"><span>Importer une photo</span><input data-ups-upload type="file" accept="image/jpeg,image/png,image/webp"></label><p class="ups-note">JPG, PNG ou WebP, 10 Mo au plus. Image optimisée automatiquement, 120 Ko maximum après import.</p><div class="ups-fields ups-crop">${field('Position horizontale','image.positionX',image?.positionX??50,'type="range" min="0" max="100" step="1"')}${field('Position verticale','image.positionY',image?.positionY??50,'type="range" min="0" max="100" step="1"')}${field('Zoom','image.zoom',image?.zoom??1,'type="range" min="1" max="3" step="0.05"')}</div><button type="button" data-ups-action="resetPhoto">Revenir à la photo par défaut</button></div></div></details>
    </article>`;
  }
  function renderEdit(center,list) { ensure(center,list); return `<fieldset class="establishment-card ups-settings" id="estab-upsell-settings"><legend>Envie d’un peu plus</legend><p class="ups-note">Personnalisez les suggestions avant confirmation : activités, participants, remises et photos. Les horaires déjà choisis sont conservés.</p><div class="ups-error" role="alert" tabindex="-1" hidden></div>${draft===null?'<p>Les suggestions habituelles du catalogue sont utilisées.</p><button type="button" data-ups-action="configure">Personnaliser les suggestions</button>':`<label class="ups-switch"><input type="checkbox" data-ups-global ${draft.enabled?'checked':''}><span>Proposer ces suggestions aux clients</span></label><div class="ups-cards">${draft.offers.map(card).join('')}</div><button type="button" data-ups-action="add" ${draft.offers.length>=MAX||!eligible().length?'disabled':''}>Ajouter une suggestion (${draft.offers.length}/${MAX})</button>${!draft.offers.length?'<p class="ups-note">Ajoutez une activité puis choisissez sa remise. Aucune réduction n’est appliquée par défaut.</p>':''}<button type="button" data-ups-action="legacy">Revenir aux suggestions habituelles</button>`}</fieldset>`; }
  function renderRead(center,list) { const cfg = center?.upsellOffers; catalogue = list || catalogue; return `<section class="estab-section ups-settings"><h3>Envie d’un peu plus</h3><p>${cfg==null?'Suggestions habituelles du catalogue.':cfg.enabled?'Suggestions personnalisées activées.':'Suggestions désactivées.'}</p>${cfg?.offers?.length?`<div class="estab-chip-row">${cfg.offers.map(o=>`<span class="estab-tag ${o.enabled?'':'estab-tag-off'}">${esc(o.title || name(o.activityId))} · ${o.minParticipants} à ${o.maxParticipants} pers. · ${esc(o.discount.mode==='none'?'sans remise':`${o.discount.value}${o.discount.mode==='percent'?' %':o.discount.mode==='fixed_per_participant'?' € / pers.':' € total'}`)}${o.enabled?'':' · inactive'}</span>`).join('')}</div>`:''}</section>`; }
  function error(text) { const el=document.querySelector('#estab-upsell-settings .ups-error'); if(el){el.textContent=text;el.hidden=false;el.focus();} }
  function refresh() {
    const host=document.getElementById('estab-upsell-settings'); if(!host)return;
    const opened=new Set([...host.querySelectorAll('.ups-photo[open]')].map(node=>node.closest('[data-ups-id]').dataset.upsId));
    const focused=document.activeElement, id=focused?.closest('[data-ups-id]')?.dataset.upsId, key=focused?.dataset.upsKey;
    host.outerHTML=renderEdit({id:centerKey,upsellOffers:draft},catalogue);
    const next=document.getElementById('estab-upsell-settings');
    for(const node of next.querySelectorAll('[data-ups-id]')){if(opened.has(node.dataset.upsId))node.querySelector('.ups-photo').open=true;if(node.dataset.upsId===id&&key){for(const input of node.querySelectorAll('[data-ups-key]'))if(input.dataset.upsKey===key)input.focus({preventScroll:true});}}
  }
  function validate(value) {
    if(value===null) return;
    if(busy.size) throw Error('Patientez pendant l’import de la photo.');
    if(value.offers.length>MAX) throw Error('Six suggestions maximum.');
    for(const o of value.offers){
      if(o.enabled && !eligible().some(a=>a.id===o.activityId)) throw Error(`Suggestion « ${o.title||name(o.activityId)} » : choisissez une activité disponible ou désactivez cette suggestion.`);
      if(!Number.isInteger(Number(o.minParticipants))||!Number.isInteger(Number(o.maxParticipants))||o.minParticipants<1||o.maxParticipants>240||o.maxParticipants<o.minParticipants) throw Error('Participants : choisissez un minimum et un maximum entre 1 et 240.');
      const d=o.discount, n=Number(d.value); if(!DISCOUNTS.some(x=>x[0]===d.mode)||!Number.isFinite(n)||n<0||n>(d.mode==='percent'?100:10000)) throw Error('Remise : choisissez de 0 à 100 % ou un montant positif.');
      if(o.image&&!photoSafe(o.image.src)) throw Error('Photo invalide : utilisez JPG, PNG, WebP ou une URL HTTPS.');
      for(const [k,v] of Object.entries(o.options||{})) if(!['arcadeMode','arcadeOfferId'].includes(k)&&(!Number.isFinite(Number(v))||Number(v)<=0)) throw Error('Les options de l’activité doivent être positives.');
      if(o.options.units!=null&&(!Number.isInteger(Number(o.options.units))||o.options.units>240))throw Error('Choisissez un nombre entier de tables de 1 à 240.');
      if(o.options.hours!=null&&(o.options.hours<0.5||o.options.hours>6))throw Error('Choisissez une durée de 30 minutes à 6 heures.');
      if(o.options.games!=null&&![2,3].includes(Number(o.options.games)))throw Error('Le laser propose 2 ou 3 parties au total.');
      if(o.activityId==='arcade_time'&&!o.options.arcadeOfferId) throw Error('Choisissez une carte Arcades active.');
    }
    if(new TextEncoder().encode(JSON.stringify(value)).length>1024*1024) throw Error('Les photos sont trop volumineuses. Importez des images plus petites.');
  }
  function collect(center) { ensure(center,catalogue); try { validate(draft); } catch(e){error(e.message);throw e;} return copy(draft); }
  function assign(o,key,value){const parts=key.split('.');if(parts.length===2){o[parts[0]]=o[parts[0]]||{};o[parts[0]][parts[1]]=value;}else o[key]=value;}
  function freshOptions(o){o.options={};if(o.activityId==='laser_game')o.options.games=2;else if(o.activityId==='billards')o.options={units:1,hours:1};else if(o.activityId==='duckpin_bowling')o.options.duration=1;else if(o.activityId==='fun_run')o.options.minutes=30;else if(o.activityId==='arcade_time'){const arc=activity(o.activityId).arcadeOffers||{},p=(arc.timeOffers||[]).find(x=>x.enabled!==false)||(arc.creditOffers||[]).find(x=>x.enabled!==false);if(p)o.options={arcadeMode:p.minutes?'time':'credit',arcadeOfferId:p.id};}}
  async function upload(file,o,input){
    if(!file)return; const ticket=generation,id=o.id; let failure=''; busy.add(id);input.disabled=true;
    try{
      if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)throw Error('Importez une photo JPG, PNG ou WebP de 10 Mo au plus.');
      const bitmap=await createImageBitmap(file);try{if(bitmap.width*bitmap.height>40000000)throw Error('Photo trop grande : 40 millions de pixels au maximum.');const canvas=document.createElement('canvas'),ratio=Math.min(1,1280/Math.max(bitmap.width,bitmap.height));canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);let blob;for(const q of [0.82,0.65,0.45,0.28]){blob=await new Promise(r=>canvas.toBlob(r,'image/webp',q));if(blob&&blob.size<=PHOTO_BYTES)break;}if(!blob||blob.size>PHOTO_BYTES)throw Error('Photo trop détaillée. Choisissez une image plus petite.');const src=await new Promise((r,j)=>{const reader=new FileReader();reader.onload=()=>r(reader.result);reader.onerror=()=>j(Error('Lecture de la photo impossible.'));reader.readAsDataURL(blob);});if(generation===ticket&&draft?.offers.some(x=>x===o))o.image={src,positionX:50,positionY:50,zoom:1};}finally{bitmap.close();}
    }catch(e){failure=e.message;}finally{busy.delete(id);if(generation===ticket){input.disabled=false;refresh();if(failure)error(failure);}}
  }
  document.addEventListener('click',e=>{
    const button=e.target.closest('[data-ups-action],[data-ups-photo]'), host=button?.closest('#estab-upsell-settings');if(!host||draft===undefined)return;
    const id=button.closest('[data-ups-id]')?.dataset.upsId, i=draft?.offers.findIndex(o=>o.id===id), o=draft?.offers[i], action=button.dataset.upsAction;
    if(button.dataset.upsPhoto&&o)o.image={src:button.dataset.upsPhoto,positionX:50,positionY:50,zoom:1};
    else if(action==='configure')draft={enabled:true,offers:[]};
    else if(action==='legacy'){generation++;busy.clear();draft=null;}
    else if(action==='add'&&draft.offers.length<MAX&&eligible().length){const a=eligible()[0];const offer={id:`offer_${Date.now().toString(36)}_${++serial}`,enabled:true,activityId:a.id,kind:a.id==='laser_game'?'laser_upgrade':'add',title:'',minParticipants:Math.max(1,Number(a.minPax)||1),maxParticipants:240,options:{},discount:{mode:'none',value:0},image:null};freshOptions(offer);draft.offers.push(offer);}
    else if(action==='remove'&&o)draft.offers.splice(i,1);
    else if(action==='up'&&i>0)[draft.offers[i-1],draft.offers[i]]=[o,draft.offers[i-1]];
    else if(action==='down'&&o&&i<draft.offers.length-1)[draft.offers[i+1],draft.offers[i]]=[o,draft.offers[i+1]];
    else if(action==='resetPhoto'&&o)o.image=null;refresh();
  });
  document.addEventListener('change',e=>{
    const input=e.target;if(!input.closest('#estab-upsell-settings')||draft===undefined)return;
    if(input.hasAttribute('data-ups-global')){draft.enabled=input.checked;return;}
    const o=draft?.offers.find(o=>o.id===input.closest('[data-ups-id]')?.dataset.upsId);if(!o)return;
    if(input.hasAttribute('data-ups-upload')){upload(input.files[0],o,input);return;}
    const key=input.dataset.upsKey;if(!key)return;
    if(key==='imageUrl'){const src=input.value.trim();o.image=src?{src,positionX:50,positionY:50,zoom:1}:null;if(src&&!photoSafe(src)){error('Photo : utilisez une URL HTTPS de JPG, PNG ou WebP.');return;}refresh();return;}
    if(key==='arcadePack'){const [mode,id]=input.value.split(':');o.options={arcadeMode:mode,arcadeOfferId:id};return;}
    if(key.startsWith('image.')&&!o.image)return;
    assign(o,key,input.type==='checkbox'?input.checked:['number','range'].includes(input.type)?(input.value===''?null:Number(input.value)):input.value);
    if(key==='activityId'){o.kind=o.activityId==='laser_game'?'laser_upgrade':'add';freshOptions(o);refresh();}
    else if(key==='discount.mode'){o.discount.value=0;refresh();}
    else if(key.startsWith('image.')){const image=input.closest('.ups-card').querySelector('.ups-preview img');if(image){image.style.objectPosition=`${o.image.positionX}% ${o.image.positionY}%`;image.style.transform=`scale(${o.image.zoom})`;}}
  });
  global.PinlaneUpsellSettings={start,cancel,renderEdit,renderRead,collect};
})(window);
