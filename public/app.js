const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => Number(n).toLocaleString();
const date = v => new Date(v).toLocaleDateString(undefined,{month:'short',day:'numeric',...(String(v).length===10?{timeZone:'UTC'}:{})});
const ago = v => { const m=Math.max(0,Math.floor((Date.now()-new Date(v))/60000)); return m<1?'Just now':m<60?`${m}m ago`:m<1440?`${Math.floor(m/60)}h ago`:date(v); };
const empty = (title,copy) => `<div class="empty"><strong>${esc(title)}</strong>${esc(copy)}</div>`;
const state={view:'overview',user:null,widgets:[],page:1,register:false,editing:null,fields:[],events:null};
let toastTimer,searchTimer,refreshTimer,refreshPromise,refreshAgain=false;
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4000);}
async function api(url,options={}){
  const r=await fetch(url,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
  if(r.status===204)return null;
  const data=await r.json();
  if(!r.ok){if(r.status===401&&state.user)showAuth();throw new Error(data.error||'Request failed.');}
  return data;
}
function showAuth(){state.events?.close();state.user=null;$('#workspace').hidden=true;$('#auth').hidden=false;}
async function enter(user){
  state.user=user;$('#auth').hidden=true;$('#workspace').hidden=false;
  state.demoUrl=(await api('/api/settings')).demo_url;
  $('#toast').hidden=true;
  $('#workspace-name').textContent=user.name;$('#user-name').textContent=user.name;$('#user-email').textContent=user.email;
  $$('.avatar,.workspace-icon').forEach(el=>el.textContent=user.name[0].toUpperCase());
  $('#today-label').textContent='◷ '+new Date().toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  await refresh(); state.events?.close();state.events=new EventSource('/api/events');
  state.events.addEventListener('ready',()=>{$('#live-label').textContent='Live updates on';});
  state.events.onerror=()=>{$('#live-label').textContent='Reconnecting…';};
  state.events.addEventListener('change',()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>refresh().catch(e=>toast(e.message)),250);});
}
$('#auth-form').onsubmit=async e=>{
  e.preventDefault();const f=e.target,button=$('#auth-submit');button.disabled=true;$('#auth-error').textContent='';
  try{const body={email:f.email.value,password:f.password.value};if(state.register)body.name=f.elements.namedItem('name').value;await enter(await api('/api/auth/'+(state.register?'register':'login'),{method:'POST',body:JSON.stringify(body)}));}
  catch(error){$('#auth-error').textContent=error.message;}finally{button.disabled=false;}
};
$('#auth-toggle').onclick=()=>{
  state.register=!state.register;$('#workspace-label').hidden=!state.register;$('#workspace-label input').required=state.register;
  $('#auth-title').textContent=state.register?'Make room to grow.':'Welcome back.';
  $('#auth-description').textContent=state.register?'Create a free workspace for your next great connection.':'Sign in to your workspace and pick up where you left off.';
  $('#auth-submit').textContent=state.register?'Create workspace ↗':'Sign in to workspace ↗';
  $('#switch-copy').textContent=state.register?'Already have a workspace?':'New to Relay?';
  $('#auth-toggle').textContent=state.register?'Sign in':'Create a workspace';$('#auth-error').textContent='';
};
$('#demo-login').onclick=()=>{if(state.register)$('#auth-toggle').click();$('#auth-form').email.value='demo@relay.local';$('#auth-form').password.value='RelayDemo!2026';toast('Demo credentials filled. Sign in to explore.');};
$('#logout').onclick=async()=>{try{await api('/api/auth/logout',{method:'POST'});showAuth();}catch(e){toast(e.message);}};
const titles={overview:['YOUR WORKSPACE AT A GLANCE','A good day to grow.','Every connection starts somewhere. Here’s how yours are doing.'],widgets:['SMALL FORMS. BIG POSSIBILITIES.','Your connection points.','Create, customize, and share a little piece of your brand.'],leads:['YOUR AUDIENCE, COMING TOGETHER','Meet your connections.','Every hello deserves a thoughtful follow-up.'],activity:['A LITTLE PEACE OF MIND','Behind the connections.','Keep an eye on deliveries and everything happening in your workspace.']};
function view(name){state.view=name;for(const key of Object.keys(titles))$(`#view-${key}`).hidden=key!==name;$$('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===name));const [eyebrow,title,description]=titles[name];$('#page-eyebrow').textContent=eyebrow;$('#page-title').textContent=title;$('#page-description').textContent=description;$('#breadcrumb-view').textContent=name==='activity'?'Activity & jobs':name[0].toUpperCase()+name.slice(1);refresh().catch(e=>toast(e.message));}
$$('[data-view]').forEach(el=>el.onclick=()=>view(el.dataset.view));
$('#view-all-leads').onclick=()=>view('leads');
async function refresh(){
  if(refreshPromise){refreshAgain=true;return refreshPromise;}
  refreshPromise=(async()=>{
    const [stats,widgets]=await Promise.all([api('/api/dashboard'),api('/api/widgets')]);
    state.widgets=widgets.items;$('#widget-count').textContent=state.widgets.length;$('#lead-count').textContent=fmt(stats.total);
    if(state.view==='overview'){renderOverview(stats);const leads=await api('/api/leads?limit=5');$('#recent-count').textContent=fmt(leads.total);$('#recent-leads').innerHTML=leadTable(leads.items,false);}
    if(state.view==='widgets')renderWidgets();
    if(state.view==='leads'){const old=$('#lead-widget').value;$('#lead-widget').innerHTML='<option value="">All widgets</option>'+state.widgets.map(w=>`<option value="${esc(w.id)}">${esc(w.name)}</option>`).join('');$('#lead-widget').value=old;await loadLeads();}
    if(state.view==='activity')await loadActivity();
  })();
  try{await refreshPromise;}finally{refreshPromise=null;if(refreshAgain){refreshAgain=false;queueMicrotask(()=>refresh().catch(e=>toast(e.message)));}}
}
function renderOverview(s){
  const enriched=s.total?Math.round(s.enriched/s.total*100):0;
  const metrics=[['Total connections',fmt(s.total),'♧','Captured across all widgets','All time'],['New today',fmt(s.today),'↗','Fresh starts, since midnight','UTC'],['Active widgets',fmt(s.active),'◫',`${state.widgets.length} widgets in your workspace`,'Live'],['Enriched leads',`${enriched}%`,'◎',`${fmt(s.enriched)} with location data`,s.geo_mode==='mock'?'Demo geo':'Geo lookup']];
  $('#metrics').innerHTML=metrics.map(([label,value,icon,foot,badge])=>`<article class="metric"><div class="metric-top"><span>${label}</span><span class="metric-icon">${icon}</span></div><div class="metric-value">${value}</div><div class="metric-foot"><span class="positive">${badge}</span>${esc(foot)}</div></article>`).join('');
  const points=[];for(let i=29;i>=0;i--){const d=new Date();d.setUTCDate(d.getUTCDate()-i);const day=d.toISOString().slice(0,10);points.push({day,count:s.timeseries.find(x=>x.day===day)?.count||0});}
  const max=Math.max(4,...points.map(p=>p.count)),W=610,H=160,L=30,R=12,T=10,B=27;
  const coords=points.map((p,i)=>[L+i*(W-L-R)/29,T+(1-p.count/max)*(H-T-B)]);
  const line=coords.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  $('#chart').innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Leads captured daily over the last 30 days"><defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#bb9ce5" stop-opacity=".3"/><stop offset="100%" stop-color="#bb9ce5" stop-opacity=".01"/></linearGradient></defs>${[0,1,2,3,4].map(i=>{const y=T+i*(H-T-B)/4;return `<line x1="${L}" y1="${y}" x2="${W-R}" y2="${y}" stroke="#f0edf5" stroke-dasharray="3 4"/><text x="4" y="${y+3}" fill="#beb3c8" font-size="8">${Math.round(max*(1-i/4))}</text>`;}).join('')}<path d="${line} L${W-R},${H-B} L${L},${H-B} Z" fill="url(#fill)"/><path d="${line}" fill="none" stroke="#b18bdc" stroke-width="2.2" stroke-linejoin="round"/>${points.map((p,i)=>i%6===0||i===29?`<text x="${coords[i][0]}" y="${H-6}" text-anchor="middle" fill="#b4a7c1" font-size="8">${date(p.day)}</text>`:'').join('')}</svg>`;
  $('#countries').innerHTML=s.countries.length?s.countries.slice(0,3).map(c=>`<div class="country-row"><strong>${esc(c.country)}</strong><span>${fmt(c.count)} leads <span class="subtle">${Math.round(c.count/s.total*100)}%</span></span></div>`).join(''):empty('The world is waiting.','Locations appear with your first lead.');
}
function leadTable(rows,full){
  if(!rows.length)return empty('Your next hello is on its way.','Share a widget to capture your first connection.');
  return `<table><thead><tr><th>Name / email</th><th>Widget</th><th>Location</th><th>Status</th><th>Received</th>${full?'<th></th>':''}</tr></thead><tbody>${rows.map((r,i)=>`<tr><td><button class="link person" data-lead="${esc(r.id)}"><span class="initial tone${i%4}">${esc((r.data.name||r.data.email||'?').slice(0,2).toUpperCase())}</span><span><strong>${esc(r.data.name||r.data.email||'New connection')}</strong><small>${esc(r.data.email||'No email field')}</small></span></button></td><td><span class="widget-tag">◫ ${esc(r.widget_name)}</span></td><td>${esc(r.geo?.country||'Unknown')} ${r.geo?.city?`<span class="subtle">${esc(r.geo.city)}</span>`:''}</td><td><span class="status-badge ${esc(r.status)}">● ${esc(r.status)}</span></td><td title="${esc(r.created_at)}">${ago(r.created_at)}</td>${full?`<td><button class="link" data-lead="${esc(r.id)}">Open ↗</button></td>`:''}</tr>`).join('')}</tbody></table>`;
}
function renderWidgets(){
  $('#widgets-summary').textContent=`${state.widgets.length} widgets`;
  $('#widgets-grid').innerHTML=state.widgets.length?state.widgets.map(w=>`<article class="widget-card"><div class="widget-card-top"><div class="widget-card-preview"><h3>${esc(w.title)}</h3><p>${esc(w.description)}</p><div class="fake-input"></div><div class="fake-button">${esc(w.button_text)}</div></div></div><div class="widget-card-body"><div class="widget-card-title"><h3>${esc(w.name)}</h3><span class="status-badge ${w.active?'':'archived'}">● ${w.active?'Active':'Paused'}</span></div><p>${esc(w.type)} <span class="subtle">·</span> ${fmt(w.leads)} connections</p><div class="card-actions"><button class="link" data-edit="${esc(w.id)}">Customize</button><button class="link" data-snippet="${esc(w.id)}">Get snippet ⧉</button><button class="icon-button" data-pause="${esc(w.id)}" title="${w.active?'Pause':'Resume'} widget" aria-label="${w.active?'Pause':'Resume'} widget">${w.active?'Ⅱ':'▷'}</button><button class="icon-button danger" data-delete-widget="${esc(w.id)}" title="Delete widget" aria-label="Delete widget">×</button></div></div></article>`).join(''):empty('Make your first connection point.','Create a widget, customize your form, and paste one line into your website.');
}
function leadQuery(){const q=new URLSearchParams({page:state.page,limit:20});for(const [key,id]of[['q','#lead-search'],['status','#lead-status'],['widget_id','#lead-widget']])if($(id).value)q.set(key,$(id).value);return q;}
async function loadLeads(){const r=await api('/api/leads?'+leadQuery());$('#all-leads').innerHTML=leadTable(r.items,true);$('#pagination-label').textContent=`${r.total?((state.page-1)*20+1):0}–${Math.min(state.page*20,r.total)} of ${fmt(r.total)} connections`;$('#prev-page').disabled=state.page<=1;$('#next-page').disabled=state.page*20>=r.total;}
$('#prev-page').onclick=()=>{state.page--;loadLeads().catch(e=>toast(e.message));};$('#next-page').onclick=()=>{state.page++;loadLeads().catch(e=>toast(e.message));};
$('#lead-search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.page=1;loadLeads().catch(e=>toast(e.message));},250);};
for(const id of ['#lead-status','#lead-widget'])$(id).onchange=()=>{state.page=1;loadLeads().catch(e=>toast(e.message));};
$('#export').onclick=()=>{location.href='/api/leads/export?'+leadQuery();toast('Preparing your CSV export (up to 10,000 leads).');};
async function loadActivity(){
  const [jobs,audit]=await Promise.all([api('/api/jobs'),api('/api/audit')]);
  $('#jobs').innerHTML=jobs.items.length?`<table><thead><tr><th>Job</th><th>Status</th><th>Attempts</th><th>Last update</th><th></th></tr></thead><tbody>${jobs.items.map(j=>`<tr><td>Notification · ${esc(j.id.slice(0,8))}</td><td><span class="status-badge ${j.status}">${esc(j.status)}</span></td><td>${j.attempts}</td><td>${ago(j.updated_at)}</td><td>${j.status==='dead'?`<button class="link" data-retry="${j.id}">Retry delivery ↻</button>`:esc(j.last_error||'—')}</td></tr>`).join('')}</tbody></table>`:empty('All quiet in the queue.','Notification jobs will appear after a new submission.');
  $('#audit').innerHTML=audit.items.length?audit.items.map(a=>`<div class="audit-event"><span>◈</span><span>${esc(a.action.replaceAll('.',' ').replaceAll('_',' '))}</span><small>${ago(a.created_at)}</small></div>`).join(''):empty('A fresh start.','Your workspace actions will appear here.');
}
$('#refresh-jobs').onclick=()=>loadActivity().catch(e=>toast(e.message));
function openBuilder(id){
  const w=state.widgets.find(w=>w.id===id);state.editing=w?.id||null;
  const f=$('#widget-form');f.reset();$('#widget-error').textContent='';$('#widget-dialog-title').textContent=w?'Customize your widget':'Create a widget';
  if(w){for(const key of ['name','type','title','description','button_text','color'])f.elements.namedItem(key).value=w[key];f.elements.namedItem('path').value=w.targeting.path;f.elements.namedItem('delay').value=w.targeting.delay;f.elements.namedItem('once').checked=w.targeting.once;f.elements.namedItem('active').checked=w.active;}
  state.fields=structuredClone(w?.fields||[{name:'name',label:'Your name',type:'text',required:true},{name:'email',label:'Email address',type:'email',required:true}]);renderFields();preview();$('#widget-dialog').showModal();
}
for(const id of ['#new-widget','#banner-create','#sidebar-create'])$(id).onclick=()=>openBuilder();
function renderFields(){
  $('#field-editor').innerHTML=state.fields.map((f,i)=>`<div class="field-row" data-index="${i}"><input data-field="name" aria-label="Field identifier" value="${esc(f.name)}" placeholder="name" required pattern="[a-z][a-z0-9_]{0,29}"><input data-field="label" aria-label="Field label" value="${esc(f.label)}" placeholder="Label" required maxlength="60"><select data-field="type" aria-label="Field type">${['text','email','textarea','tel'].map(t=>`<option ${f.type===t?'selected':''}>${t}</option>`).join('')}</select><input type="checkbox" data-field="required" aria-label="Required" title="Required" ${f.required?'checked':''}><button type="button" class="icon-button" data-remove-field="${i}" aria-label="Remove field">×</button></div>`).join('');$('#add-field').disabled=state.fields.length>=8;
}
$('#field-editor').oninput=e=>{const row=e.target.closest('[data-index]');if(!row||!e.target.dataset.field)return;state.fields[Number(row.dataset.index)][e.target.dataset.field]=e.target.type==='checkbox'?e.target.checked:e.target.value;preview();};
$('#add-field').onclick=()=>{if(state.fields.length>=8)return;let n=1;while(state.fields.some(f=>f.name===`field_${n}`))n++;state.fields.push({name:`field_${n}`,label:'New field',type:'text',required:false});renderFields();preview();};
$('#widget-form').addEventListener('input',preview);
function preview(){const f=$('#widget-form');$('#widget-preview').innerHTML=`<div class="preview-card"><h3>${esc(f.title.value||'Good things, in your inbox.')}</h3><p>${esc(f.description.value||'A little inspiration. The occasional update. Always worth opening.')}</p>${state.fields.map(x=>`<label>${esc(x.label)}${x.required?' *':''}<div class="fake-input"></div></label>`).join('')}<div class="button primary" id="preview-button">${esc(f.button_text.value)}</div><small>Securely captured with ◇ Relay</small></div>`;$('#preview-button').style.backgroundColor=f.color.value;}
$('#widget-form').onsubmit=async e=>{
  e.preventDefault();const f=e.target;const b=Object.fromEntries(['name','type','title','description','button_text','color'].map(k=>[k,f.elements.namedItem(k).value]));b.fields=state.fields;b.active=f.active.checked;b.targeting={path:f.path.value,delay:Number(f.delay.value),once:f.once.checked};
  const button=f.querySelector('[type=submit]');button.disabled=true;
  try{const w=await api('/api/widgets'+(state.editing?'/'+state.editing:''),{method:state.editing?'PATCH':'POST',body:JSON.stringify(b)});$('#widget-dialog').close();toast(state.editing?'Widget updated. Public config refreshes within 30 seconds.':'Your new widget is ready.');await refresh();if(!state.editing)await snippet(w.id);}
  catch(error){$('#widget-error').textContent=error.message;}finally{button.disabled=false;}
};
async function snippet(id){const r=await api(`/api/widgets/${id}/snippet`);$('#snippet-code').textContent=r.snippet;const url=new URL(state.demoUrl||'http://localhost:5500');url.searchParams.set('widget',id);url.searchParams.set('api',location.origin);$('#demo-link').href=url.href;$('#demo-link').textContent=url.host+' ↗';$('#snippet-dialog').showModal();}
$('#copy-snippet').onclick=async()=>{try{await navigator.clipboard.writeText($('#snippet-code').textContent);toast('Snippet copied. Your website is ready for new connections.');}catch{toast('Select the snippet and copy it manually.');}};
async function openLead(id){
  const r=await api('/api/leads/'+id);
  const rows=[...Object.entries(r.data),['Widget',state.widgets.find(w=>w.id===r.widget_id)?.name||r.widget_id],['Location',r.geo?`${r.geo.city}, ${r.geo.country}`:'Unavailable'],['Geo provider',r.geo?.provider||'None'],['Source',r.source||'Not supplied'],['Consent',r.consent_text],['Received',new Date(r.created_at).toLocaleString()]];
  $('#lead-detail').innerHTML=rows.map(([k,v])=>`<div class="detail-row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')+`<div class="detail-controls"><select id="detail-status" aria-label="Lead status">${['new','contacted','qualified','archived'].map(s=>`<option ${r.status===s?'selected':''}>${s}</option>`).join('')}</select><button class="button primary" data-save-lead="${r.id}">Update status</button><button class="button secondary danger" data-delete-lead="${r.id}">Delete data</button></div>`;
  $('#lead-dialog').showModal();
}
document.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  try{
    if(b.classList.contains('close-dialog'))b.closest('dialog').close();
    if(b.dataset.edit)openBuilder(b.dataset.edit);
    if(b.dataset.snippet)await snippet(b.dataset.snippet);
    if(b.dataset.lead)await openLead(b.dataset.lead);
    if(b.dataset.pause){const w=state.widgets.find(w=>w.id===b.dataset.pause);await api('/api/widgets/'+w.id,{method:'PATCH',body:JSON.stringify({active:!w.active})});toast(w.active?'Widget paused.':'Widget resumed.');await refresh();}
    if(b.dataset.deleteWidget&&confirm('Delete this widget and all of its leads? This cannot be undone.')){await api('/api/widgets/'+b.dataset.deleteWidget,{method:'DELETE'});toast('Widget and associated data deleted.');await refresh();}
    if(b.dataset.removeField!==undefined){state.fields.splice(Number(b.dataset.removeField),1);renderFields();preview();}
    if(b.dataset.saveLead){await api('/api/leads/'+b.dataset.saveLead,{method:'PATCH',body:JSON.stringify({status:$('#detail-status').value})});$('#lead-dialog').close();toast('Connection updated.');await refresh();}
    if(b.dataset.deleteLead&&confirm('Permanently delete this lead and its notification record?')){await api('/api/leads/'+b.dataset.deleteLead,{method:'DELETE'});$('#lead-dialog').close();toast('Personal data deleted.');await refresh();}
    if(b.dataset.retry){await api('/api/jobs/'+b.dataset.retry+'/retry',{method:'POST'});toast('Delivery queued for another attempt.');await loadActivity();}
  }catch(error){toast(error.message);}
});
api('/api/auth/me').then(enter).catch(showAuth);
