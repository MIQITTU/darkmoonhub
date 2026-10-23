/* Darkmoon Hub — shared client: config, session, API, live events, page chrome */
(function(){
/* ===== Site settings: edit before deploying ===== */
const CONFIG={
  DISCORD_URL:'https://discord.gg/EjBhMZPYzN',   // your Discord invite link
  SITE:'Darkmoon Hub'
};

const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/* Escape, then turn http(s) links into anchors and keep line breaks */
/* Escape, link tagged members (@Name → their profile), turn http(s) links into anchors, and keep line breaks.
   `tags` is the list of members the server found tagged in this post: [{uid,name}]. */
const reEsc=x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function rich(s,tags){let h=esc(s);
  const ts=(tags||[]).filter(t=>t&&t.uid&&t.name&&t.name!=='deleted').sort((a,b)=>b.name.length-a.name.length);
  if(ts.length){const by={};ts.forEach(t=>by[esc(t.name).toLowerCase()]=t);
    h=h.replace(new RegExp(`(^|[^\\p{L}\\p{N}_/])@(${ts.map(t=>reEsc(esc(t.name))).join('|')})(?![\\p{L}\\p{N}_])`,'giu'),(m,pre,n)=>{const t=by[n.toLowerCase()];return t?`${pre}<a class="tag" href="profile.html#${esc(t.uid)}">@${n}</a>`:m})}
  return h.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g,u=>`<a href="${u}" target="_blank" rel="noopener nofollow ugc">${u}</a>`).replace(/\n/g,'<br>')}
function ago(t){const s=(Date.now()-t)/1000;if(s<45)return'just now';if(s<3600)return Math.round(s/60)+' min ago';if(s<86400)return Math.round(s/3600)+' h ago';if(s<604800)return Math.round(s/86400)+' d ago';return new Date(t).toLocaleDateString()}
const who=a=>a?`<a class="who-link" href="profile.html#${esc(a.uid)}">${esc(a.name)}</a>${a.role==='admin'?' <span class="pill c" title="Administrator">admin</span>':''}`:'';

/* ---------- storage ---------- */
const ls={get(k,d){try{const v=localStorage.getItem('up:'+k);return v==null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem('up:'+k,JSON.stringify(v))}catch(e){}},del(k){try{localStorage.removeItem('up:'+k)}catch(e){}}};
const ss={get(k){try{return JSON.parse(sessionStorage.getItem('up:'+k))}catch(e){return null}},set(k,v){try{sessionStorage.setItem('up:'+k,JSON.stringify(v))}catch(e){}},del(k){try{sessionStorage.removeItem('up:'+k)}catch(e){}}};

/* ---------- server ---------- */
let health=null;
async function connect(){
  if(health!==null)return !!health;
  try{const c=new AbortController();const t=setTimeout(()=>c.abort(),3000);const r=await fetch('api/health',{signal:c.signal,cache:'no-store'});clearTimeout(t);const j=await r.json();health=r.ok&&j.ok?j:false}catch(e){health=false}
  return !!health;
}
const info=()=>health||{};
const user=()=>ls.get('user',null);
async function api(method,path,body){
  const u=user();const r=await fetch('api/'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(u&&u.token?{Authorization:'Bearer '+u.token}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store'});
  let j={};try{j=await r.json()}catch(e){}
  if(r.status===401&&u){ls.del('user')}
  if(!r.ok){const e=new Error(j.error||'The server did not respond. Try again in a moment.');e.status=r.status;throw e}
  return j;
}
function setSession(j){const u={...j.user,token:j.token};ls.set('user',u);return u}
async function refreshMe(){const u=user();if(!u)return null;try{const j=await api('GET','me');const n={...j.user,token:u.token};ls.set('user',n);badge(j.unread);return n}catch(e){if(e.status===401||e.status===403){ls.del('user');return null}return u}}
async function signOut(){try{await api('POST','auth/logout')}catch(e){}ls.del('user')}
function afterSignIn(){const back=ss.get('return');ss.del('return');location.href=back||'index.html'}
function goSignIn(){ss.set('return',location.pathname.split('/').pop()+location.hash);location.href='signin.html'}

/* ---------- live events ---------- */
const handlers={};let es=null;
function on(ev,fn){(handlers[ev]||(handlers[ev]=[])).push(fn)}
function startStream(){const u=user();if(!u||!u.token||es||!window.EventSource)return;
  es=new EventSource('api/stream?token='+encodeURIComponent(u.token));
  ['hello','notif','msg','msg-del','rooms','dm','dm-del','pin'].forEach(ev=>es.addEventListener(ev,e=>{let d={};try{d=JSON.parse(e.data)}catch(x){}
    if(ev==='hello'||ev==='notif')badge(d.unread);(handlers[ev]||[]).forEach(f=>f(d))}));
}

/* ---------- page chrome ---------- */
function seal(){return`<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14.5" fill="none" stroke="#00f0ff" stroke-width="1.3"/><path d="M20 6.83A10 10 0 1 0 20 25.17A9.5 9.5 0 0 1 20 6.83Z" fill="rgba(255,43,214,.18)" stroke="#ff2bd6" stroke-width="1.3" stroke-linejoin="round"/><circle cx="23.5" cy="12" r="1.3" fill="#00f0ff"/><circle cx="25.5" cy="19" r=".8" fill="#eaf0ff"/></svg>`}
const NAV=[['index.html','Home'],['chat.html','Chat'],['forum.html','Forum'],['map.html','Map'],['market.html','Market'],['dms.html','Messages']];
function badge(n){const b=$('#bell-n');if(!b||n==null)return;b.textContent=n>99?'99+':n;b.hidden=!n;const bell=$('#bell');if(bell)bell.setAttribute('aria-label',n?`Inbox, ${n} unread`:'Inbox')}
function chrome(){
  const here=(location.pathname.split('/').pop()||'index.html'),u=user();
  const page=document.body.dataset.page||here;
  const links=NAV.map(([f,l])=>`<a href="${f}"${page===f||(f==='forum.html'&&page==='thread.html')?' aria-current="page"':''}>${l}</a>`).join('')+(u&&u.role==='admin'?`<a href="admin.html"${page==='admin.html'?' aria-current="page"':''} class="adm">Admin</a>`:'');
  const top=$('#top');if(top)top.outerHTML=`<header class="top"><div class="in">
    <a class="brand" href="index.html">${seal()}<span>${CONFIG.SITE}</span></a>
    <nav id="nav" aria-label="Main">${links}</nav>
    <div class="hdr">${u?`<a id="bell" class="bell" href="inbox.html" aria-label="Inbox"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zM10 19a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg><span id="bell-n" class="count" hidden>0</span></a>`:''}
      <a class="acct ${u?'on':''}" href="${u?'profile.html#'+esc(u.uid):'signin.html'}">${u?esc(u.name):'Sign in'}</a>
      <button class="menu" id="menu" type="button" aria-label="Menu" aria-expanded="false" aria-controls="nav"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2"/></svg></button></div></div></header>`;
  const f=$('#foot');if(f)f.outerHTML=`<footer class="foot"><div class="in"><span>${CONFIG.SITE}</span><span class="row" style="gap:18px"><a href="contact.html">Contact the administrator</a></span></div></footer>`;
  $('#menu')?.addEventListener('click',e=>{const n=$('#nav');n.classList.toggle('open');e.currentTarget.setAttribute('aria-expanded',n.classList.contains('open'))});
  if(u)connect().then(ok=>{if(ok){refreshMe().then(n=>{if(!n&&!ss.get('reloaded')){ss.set('reloaded',1);location.reload()}else if(n)ss.del('reloaded')});startStream()}});
}
function toast(m){let t=$('#toast');if(!t){t=document.createElement('div');t.id='toast';t.className='toast';t.setAttribute('role','status');document.body.appendChild(t)}t.textContent=m;t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(()=>t.hidden=true,2400)}
/* Renders a gate in `el` when the user must sign in or the server is missing. Returns the user if allowed. */
async function gate(el,what){
  if(!(await connect())){el.innerHTML=`<div class="panel"><p class="notice">${esc(what)} needs the Darkmoon Hub server, which isn't running here.</p></div>`;return null}
  const u=user();if(u)return u;
  el.innerHTML=`<div class="panel" style="justify-items:start"><h2>Sign in to continue</h2><p class="muted">${esc(what)} is open to signed-in members. Sign in with your Google account; it takes a few seconds.</p><button class="btn mag big" type="button">Sign in with Google</button></div>`;
  el.querySelector('button').onclick=goSignIn;return null;
}
/* Wraps an async handler so repeat taps are ignored until it finishes; disables the button (or the form's buttons) meanwhile */
function guard(fn){let running=false;return function(e){if(e&&e.type==='submit'&&e.preventDefault)e.preventDefault();if(running)return;running=true;
  const el=e&&e.currentTarget,bs=el&&el.tagName?(el.tagName==='FORM'?[...el.querySelectorAll('button')]:[el]):[],prev=bs.map(b=>b.disabled);bs.forEach(b=>b.disabled=true);
  Promise.resolve().then(()=>fn.call(this,e)).catch(x=>toast((x&&x.message)||String(x))).finally(()=>{running=false;bs.forEach((b,i)=>{if(b.isConnected)b.disabled=prev[i]})})}}
/* Two-step inline confirm for destructive buttons (dialogs are avoided) */
function confirmBtn(btn,label,fn){btn.addEventListener('click',async()=>{if(!btn.dataset.armed){btn.dataset.armed='1';const old=btn.textContent;btn.textContent=label;btn.classList.add('danger');
  setTimeout(()=>{delete btn.dataset.armed;btn.textContent=old;btn.classList.remove('danger')},3500);return}delete btn.dataset.armed;btn.disabled=true;try{await fn()}catch(e){toast(e.message);btn.disabled=false}})}

/* Tag picker: typing "@" in a text box offers matching member names; Enter/Tab or a tap inserts "@Name ". */
function tagger(ta){if(!ta||ta._tagger)return;ta._tagger=1;
  const box=document.createElement('div');box.className='tagbox';box.hidden=true;box.setAttribute('role','listbox');box.setAttribute('aria-label','Tag a member');document.body.appendChild(box);
  let items=[],idx=0,start=-1,seq=0,timer=null;const me=()=>user();
  const hide=()=>{box.hidden=true;items=[];start=-1};
  function place(){const r=ta.getBoundingClientRect(),w=Math.min(Math.max(r.width,220),340);box.style.left=Math.max(8,Math.min(r.left,innerWidth-w-8))+'px';box.style.width=w+'px';
    if(r.top>220){box.style.top='';box.style.bottom=(innerHeight-r.top+6)+'px'}else{box.style.bottom='';box.style.top=(r.bottom+6)+'px'}}
  function draw(){if(!items.length){hide();return}
    box.innerHTML=items.map((u,i)=>`<button type="button" role="option" aria-selected="${i===idx}" class="${i===idx?'on':''}" data-i="${i}">@${esc(u.name)}${u.role==='admin'?' <small>admin</small>':''}</button>`).join('');
    box.querySelectorAll('[data-i]').forEach(b=>{b.onmousedown=e=>e.preventDefault();b.onclick=()=>pick(items[+b.dataset.i])});place();box.hidden=false}
  function pick(u){if(!u||start<0)return;const pos=ta.selectionStart,v=ta.value,ins='@'+u.name+' ';
    ta.value=v.slice(0,start)+ins+v.slice(pos).replace(/^\s+/,'');const c=start+ins.length;ta.setSelectionRange(c,c);hide();ta.focus();ta.dispatchEvent(new Event('input',{bubbles:true}))}
  ta.addEventListener('input',()=>{const pos=ta.selectionStart,m=/(^|[^\p{L}\p{N}_])@([\p{L}\p{N}._\- ]{0,24})$/u.exec(ta.value.slice(0,pos));
    if(!m||/^\s|\s\s/.test(m[2])){hide();return}const q=m[2];start=pos-q.length-1;clearTimeout(timer);
    timer=setTimeout(async()=>{const my=++seq;let r=[];try{r=(await api('GET','users?q='+encodeURIComponent(q))).users}catch(e){}
      if(my!==seq||start<0)return;const lq=q.toLowerCase();items=r.filter(u=>u.uid!==(me()||{}).uid&&u.name.toLowerCase().includes(lq)).slice(0,6);idx=0;draw()},120)});
  (ta.form||ta.parentNode).addEventListener('keydown',e=>{if(e.target!==ta||box.hidden||!items.length)return;
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){idx=(idx+(e.key==='ArrowDown'?1:items.length-1))%items.length;draw()}
    else if(e.key==='Enter'||e.key==='Tab')pick(items[idx]);else if(e.key==='Escape')hide();else return;
    e.preventDefault();e.stopPropagation()},true);
  ta.addEventListener('blur',()=>setTimeout(hide,150));addEventListener('resize',hide);addEventListener('scroll',()=>{if(!box.hidden)place()},true)}

window.UP={CONFIG,$,esc,rich,tagger,ago,who,ls,ss,connect,info,user,api,setSession,refreshMe,signOut,afterSignIn,goSignIn,on,startStream,toast,gate,confirmBtn,badge,guard};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',chrome);else chrome();
})();
