/* Relay embed v1.0.0. Immutable URL: publish a new filename when changing this file. */
(() => {
  'use strict';
  const script = document.currentScript;
  if (!script) return;
  const url = new URL(script.src), id = url.searchParams.get('id'), base = url.origin;
  if (!id) return;
  const anchor = document.createElement('div');
  script.after(anchor);
  async function run() {
    const response = await fetch(`${base}/api/widgets/${encodeURIComponent(id)}/config`, { credentials: 'omit' });
    if (!response.ok) return;
    const c = await response.json(), storageKey = `relay-submitted:${id}`;
    if (c.targeting.path && !location.pathname.startsWith(c.targeting.path)) return;
    try { if (c.targeting.once && localStorage.getItem(storageKey)) return; } catch { /* Storage may be disabled. */ }
    await new Promise(resolve => setTimeout(resolve, c.targeting.delay * 1000));
    const shadow = anchor.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `:host{display:block;font-family:Inter,system-ui,sans-serif;color:#232039}*{box-sizing:border-box}.card{background:#fff;border:1px solid #e8e5f0;border-radius:20px;padding:30px;max-width:420px;box-shadow:0 16px 50px #25203910}.popover{position:fixed;right:24px;bottom:24px;z-index:2147483646;width:calc(100vw - 48px)}h2{font-size:24px;letter-spacing:-.8px;margin:0 0 10px}p{color:#797387;line-height:1.6;font-size:14px}label{display:block;font-size:12px;font-weight:600;margin:17px 0 7px}input,textarea{font:inherit;width:100%;padding:12px 13px;border:1px solid #ddd8e7;border-radius:8px;background:#fcfbfe;color:#232039}input:focus,textarea:focus{outline:2px solid ${c.color};outline-offset:2px}button{font:inherit;font-weight:600;width:100%;border:0;border-radius:9px;padding:14px;color:#fff;background:${c.color};cursor:pointer;margin-top:18px}button:disabled{opacity:.6;cursor:wait}.consent{display:flex;align-items:flex-start;gap:8px;font-size:11px;font-weight:400;color:#797387;line-height:1.5}.consent input{width:auto;flex-shrink:0;margin-top:2px}.hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}.foot{text-align:center;font-size:10px;color:#a09aaa;margin:18px 0 0}.status{font-size:13px;line-height:1.5}.close{position:absolute;right:12px;top:4px;width:30px;background:none;color:#797387;padding:5px;margin:0;font-size:22px}.success{text-align:center;padding:24px 0}.success span{font-size:36px;color:${c.color}}`;
    shadow.append(style);
    const card = document.createElement('section'); card.className = 'card' + (c.type === 'popover' ? ' popover' : '');
    card.setAttribute('aria-label', c.title);
    if (c.type === 'popover') {
      const close = document.createElement('button'); close.className='close'; close.textContent='×'; close.setAttribute('aria-label','Close form'); close.onclick=()=>anchor.remove(); card.append(close);
    }
    const heading = document.createElement('h2'); heading.textContent = c.title;
    const description = document.createElement('p'); description.textContent = c.description;
    const form = document.createElement('form');
    for (const f of c.fields) {
      const label = document.createElement('label'); label.textContent=f.label + (f.required ? ' *' : ''); label.htmlFor=`relay-${id}-${f.name}`;
      const input = document.createElement(f.type === 'textarea' ? 'textarea' : 'input');
      input.id=label.htmlFor; input.name=f.name; if (f.type!=='textarea') input.type=f.type;
      input.required=f.required; input.maxLength=f.type==='textarea'?2000:250;
      if (f.type==='email') input.autocomplete='email'; if (f.name==='name') input.autocomplete='name';
      form.append(label,input);
    }
    const trap = document.createElement('div'); trap.className='hp'; trap.setAttribute('aria-hidden','true');
    const hp = document.createElement('input'); hp.name='website'; hp.tabIndex=-1; hp.autocomplete='off'; hp.setAttribute('aria-label','Leave this field empty'); trap.append(hp); form.append(trap);
    const consent = document.createElement('label'); consent.className='consent';
    const checkbox=document.createElement('input'); checkbox.type='checkbox'; checkbox.required=true;
    consent.append(checkbox,document.createTextNode(c.consent_text));
    const button=document.createElement('button'); button.type='submit'; button.textContent=c.button_text;
    const status=document.createElement('p'); status.className='status'; status.setAttribute('role','status');
    form.append(consent,button,status); card.append(heading,description,form);
    const foot=document.createElement('p'); foot.className='foot'; foot.textContent='Securely captured with ◇ Relay'; card.append(foot); shadow.append(card);
    let pendingKey=null, pendingBody=null;
    form.addEventListener('submit',async e=>{
      e.preventDefault(); button.disabled=true; status.textContent='Sending…';
      const data=Object.fromEntries(c.fields.map(f=>[f.name,form.elements.namedItem(f.name).value]));
      const body=JSON.stringify({widget_id:id,data,website:hp.value,consent:checkbox.checked,source:location.origin+location.pathname});
      if (body!==pendingBody) { pendingKey=crypto.randomUUID(); pendingBody=body; }
      try {
        const r=await fetch(`${base}/api/submissions`,{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json','Idempotency-Key':pendingKey},body});
        const result=await r.json(); if(!r.ok) throw new Error(result.error || 'Unable to send. Please try again.');
        form.replaceChildren(); const success=document.createElement('div'); success.className='success';
        const mark=document.createElement('span'); mark.textContent='✓'; const title=document.createElement('h2'); title.textContent='You’re on the list.';
        const message=document.createElement('p'); message.textContent='Thanks for reaching out. We’ll be in touch soon.'; success.append(mark,title,message); form.append(success);
        try { localStorage.setItem(storageKey,'1'); } catch { /* Optional storage only. */ }
      } catch(error) { status.textContent=error.message; button.disabled=false; }
    });
  }
  run().catch(()=>{ anchor.textContent='This form is temporarily unavailable. Please try again later.'; });
})();
