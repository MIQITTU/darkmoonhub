/* Darkmoon Hub — shared client: config, session, API, live events, page chrome, test helpers */
(function(){
/* ===== Site settings: edit before deploying ===== */
const CONFIG={
  DISCORD_URL:'https://discord.gg/YOUR-INVITE',   // your Discord invite link
  SITE:'Darkmoon Hub'
};

const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/* Escape, then turn http(s) links into anchors and keep line breaks */
const rich=s=>esc(s).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g,u=>`<a href="${u}" target="_blank" rel="noopener nofollow ugc">${u}</a>`).replace(/\n/g,'<br>');
function ago(t){const s=(Date.now()-t)/1000;if(s<45)return'just now';if(s<3600)return Math.round(s/60)+' min ago';if(s<86400)return Math.round(s/3600)+' h ago';if(s<604800)return Math.round(s/86400)+' d ago';return new Date(t).toLocaleDateString()}
const who=a=>a?`<a class="who-link" href="profile.html#${esc(a.uid)}">${esc(a.name)}</a>${a.role==='admin'?' <span class="pill c" title="Administrator">admin</span>':''}`:'';

/* ---------- randomness (cryptographic, unbiased) ---------- */
const u32=new Uint32Array(1);
function rint(n){if(n<=1)return 0;const lim=Math.floor(4294967296/n)*n;let x;do{crypto.getRandomValues(u32);x=u32[0]}while(x>=lim);return x%n}
function bit(){return rint(2)}
function shuffle(a){a=[...a];for(let i=a.length-1;i>0;i--){const j=rint(i+1);[a[i],a[j]]=[a[j],a[i]]}return a}

/* ---------- statistics ---------- */
function lgamma(z){const c=[0.99999999999980993,676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61503916999185,12.507343278686905,-0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
  if(z<0.5)return Math.log(Math.PI/Math.sin(Math.PI*z))-lgamma(1-z);z-=1;let x=c[0];for(let i=1;i<9;i++)x+=c[i]/(z+i);const t=z+7.5;return 0.5*Math.log(2*Math.PI)+(z+0.5)*Math.log(t)-t+Math.log(x)}
function pmf(k,n,p){return Math.exp(lgamma(n+1)-lgamma(k+1)-lgamma(n-k+1)+k*Math.log(p)+(n-k)*Math.log(1-p))}
function upper(k,n,p){if(n>3000){const z=(k-.5-n*p)/Math.sqrt(n*p*(1-p));return 1-normCdf(z)}let s=0;for(let i=k;i<=n;i++)s+=pmf(i,n,p);return Math.min(1,s)}
function normCdf(z){const t=1/(1+0.2316419*Math.abs(z)),d=0.3989422804014327*Math.exp(-z*z/2);const p=d*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));return z>0?1-p:p}
function fmtP(p){return p<0.0001?'< 0.0001':p.toFixed(4)}
function stats(hits,n,p){const exp=n*p,z=Board.z(hits,n,p),pu=upper(hits,n,p),pl=hits>=n?1:1-upper(hits+1,n,p);
  const below=hits<exp,tail=below?pl:pu;return{hits,n,p,exp,z,pu,pl,below,tail,two:Math.min(1,2*Math.min(pu,pl))}}
function verdict(s){
  const pct=x=>x<0.001?'under 0.1%':(x*100).toFixed(x<0.1?1:0)+'%';
  if(!s.below){
    if(s.pu<=0.001)return`Extraordinary. Odds of about ${Math.round(1/s.pu).toLocaleString()} to 1 against scoring this high by chance.`;
    if(s.pu<=0.01)return`Strong result. Only ${pct(s.pu)} of chance runs score this high.`;
    if(s.pu<=0.05)return`Above chance. Only ${pct(s.pu)} of chance runs score this high. Repeat it and see if it holds.`;
    return`Within the range of chance: ${pct(s.pu)} of random runs score this high or higher. Most runs land here. Keep going.`}
  if(s.pl<=0.05)return`Below chance. Only ${pct(s.pl)} of chance runs score this low. Missing the target this consistently is called psi-missing, and it is as unusual as hitting it.`;
  return`Within the range of chance: ${pct(s.pl)} of random runs score this low or lower. Most runs land here. Keep going.`;
}

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
  ['hello','notif','msg','msg-del','rooms','dm','pin'].forEach(ev=>es.addEventListener(ev,e=>{let d={};try{d=JSON.parse(e.data)}catch(x){}
    if(ev==='hello'||ev==='notif')badge(d.unread);(handlers[ev]||[]).forEach(f=>f(d))}));
}

/* ---------- tests: scores & leaderboard (local fallback when no server) ---------- */
async function submit(test,hits,detail){
  const t=Board.TESTS.find(x=>x.id===test),u=user();
  if(await connect()){
    if(!u){ss.set('pending',{test,hits,detail,at:Date.now()});return{ok:false,reason:'signin'}}
    try{const j=await api('POST','scores',{test,hits,n:t.n,detail});return{ok:true,rank:j.rank,total:j.total}}catch(e){if(e.status===401){ss.set('pending',{test,hits,detail,at:Date.now()});return{ok:false,reason:'signin'}}return{ok:false,reason:e.message}}}
  const db=ls.get('local',{users:{me:{name:'You'}},scores:[]});db.scores.push({uid:'me',test,hits,n:t.n,at:Date.now(),detail});ls.set('local',db);
  const rows=Board.rank(test,db.scores,db.users,1000);const i=rows.findIndex(r=>r.uid==='me');return{ok:true,rank:i>=0?i+1:null,total:rows.length,local:true};
}
async function postPending(){const p=ss.get('pending');if(!p||Date.now()-p.at>30*60e3)return null;ss.del('pending');const r=await submit(p.test,p.hits,p.detail);return r.ok?p:null}
async function leaderboard(test){
  if(await connect()){const j=await api('GET','leaderboard?test='+encodeURIComponent(test));return{rows:j.rows,local:false}}
  const db=ls.get('local',{users:{me:{name:'You'}},scores:[]});return{rows:Board.rank(test,db.scores,db.users,25),local:true};
}
async function result(el,test,hits,extra='',detail){
  const t=Board.TESTS.find(x=>x.id===test),s=stats(hits,t.n,t.p);
  el.hidden=false;
  el.innerHTML=`<h2 class="neon-m">Result</h2><div class="stats">
    <div class="stat"><span>Score</span><b>${hits} / ${t.n}</b></div><div class="stat"><span>Chance</span><b>${s.exp.toFixed(1)}</b></div>
    <div class="stat"><span>Z score</span><b>${s.z.toFixed(2)}</b></div><div class="stat"><span>${s.below?'Chance of this low':'Chance of this high'}</span><b>${fmtP(s.tail)}</b></div><div class="stat"><span>Either direction</span><b>${fmtP(s.two)}</b></div>${extra}</div>
    <p class="verdict">${verdict(s)}</p><div id="post" class="row"><span class="muted">Posting to the leaderboard…</span></div>`;
  const r=await submit(test,hits,detail),post=el.querySelector('#post');
  if(r.ok)post.innerHTML=`<span class="pill hit">Posted</span><span class="muted">${r.rank?`You are #${r.rank} of ${r.total} on this board${r.local?' (this browser only)':''}.`:'Recorded.'}</span><a class="btn ghost" href="leaderboard.html#${test}">Leaderboard</a>`;
  else if(r.reason==='signin'){post.innerHTML=`<span class="muted">Sign in with Google to put this score on the leaderboard.</span><button class="btn mag" type="button">Sign in to post this score</button>`;post.querySelector('button').onclick=goSignIn}
  else post.innerHTML=`<span class="err">${esc(r.reason)}</span>`;
}

/* ---------- page chrome ---------- */
function seal(){return`<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14.5" fill="none" stroke="#00f0ff" stroke-width="1.3"/><path d="M20 6.83A10 10 0 1 0 20 25.17A9.5 9.5 0 0 1 20 6.83Z" fill="rgba(255,43,214,.18)" stroke="#ff2bd6" stroke-width="1.3" stroke-linejoin="round"/><circle cx="23.5" cy="12" r="1.3" fill="#00f0ff"/><circle cx="25.5" cy="19" r=".8" fill="#eaf0ff"/></svg>`}
const NAV=[['index.html','Home'],['chat.html','Chat'],['forum.html','Forum'],['map.html','Map'],['market.html','Market'],['dms.html','Messages'],['tests.html','Tests']];
function badge(n){const b=$('#bell-n');if(!b||n==null)return;b.textContent=n>99?'99+':n;b.hidden=!n;const bell=$('#bell');if(bell)bell.setAttribute('aria-label',n?`Inbox, ${n} unread`:'Inbox')}
function chrome(){
  const here=(location.pathname.split('/').pop()||'index.html'),u=user();
  const page=document.body.dataset.page||here;
  const links=NAV.map(([f,l])=>`<a href="${f}"${page===f||(f==='forum.html'&&page==='thread.html')||(f==='tests.html'&&['leaderboard.html','esp.html','pk-line.html','compass.html','ball.html','remote.html'].includes(page))?' aria-current="page"':''}>${l}</a>`).join('')+(u&&u.role==='admin'?`<a href="admin.html"${page==='admin.html'?' aria-current="page"':''} class="adm">Admin</a>`:'');
  const top=$('#top');if(top)top.outerHTML=`<header class="top"><div class="in">
    <a class="brand" href="index.html">${seal()}<span>${CONFIG.SITE}</span></a>
    <nav id="nav" aria-label="Main">${links}</nav>
    <div class="hdr">${u?`<a id="bell" class="bell" href="inbox.html" aria-label="Inbox"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zM10 19a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg><span id="bell-n" class="count" hidden>0</span></a>`:''}
      <a class="acct ${u?'on':''}" href="${u?'profile.html#'+esc(u.uid):'signin.html'}">${u?esc(u.name):'Sign in'}</a>
      <button class="menu" id="menu" type="button" aria-label="Menu" aria-expanded="false" aria-controls="nav"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2"/></svg></button></div></div></header>`;
  const f=$('#foot');if(f)f.outerHTML=`<footer class="foot"><div class="in"><span>${CONFIG.SITE}</span><span class="row" style="gap:18px"><a href="tests.html">Psi tests</a><a href="leaderboard.html">Leaderboard</a><a href="contact.html">Contact the administrator</a></span></div></footer>`;
  $('#menu')?.addEventListener('click',e=>{const n=$('#nav');n.classList.toggle('open');e.currentTarget.setAttribute('aria-expanded',n.classList.contains('open'))});
  if(u)connect().then(ok=>{if(ok){refreshMe().then(n=>{if(!n&&!ss.get('reloaded')){ss.set('reloaded',1);location.reload()}else if(n)ss.del('reloaded')});startStream()}});
}
function toast(m){let t=$('#toast');if(!t){t=document.createElement('div');t.id='toast';t.className='toast';t.setAttribute('role','status');document.body.appendChild(t)}t.textContent=m;t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(()=>t.hidden=true,2400)}
/* Renders a gate in `el` when the user must sign in or the server is missing. Returns the user if allowed. */
async function gate(el,what){
  if(!(await connect())){el.innerHTML=`<div class="panel"><p class="notice">${esc(what)} needs the Darkmoon Hub server, which isn't running here. The tests and your own scores still work.</p></div>`;return null}
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

window.UP={CONFIG,$,esc,rich,ago,who,rint,bit,shuffle,stats,verdict,fmtP,normCdf,pmf,upper,ls,ss,connect,info,user,api,setSession,refreshMe,signOut,afterSignIn,goSignIn,on,startStream,submit,postPending,leaderboard,toast,result,gate,confirmBtn,badge,guard};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',chrome);else chrome();
})();
