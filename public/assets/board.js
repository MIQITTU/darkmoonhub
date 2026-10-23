/* Test definitions and leaderboard ranking. Shared by the browser and the server (server.js requires this file). */
(function(root){
const TESTS=[
  {id:'esp',      name:'Zener ESP',          tag:'Clairvoyance', file:'esp.html',     n:25,   p:0.2,  unit:'hits', glyph:'◯', desc:'Twenty-five hidden cards, five symbols. Name each before it is revealed. Chance is 5.'},
  {id:'precog',   name:'Zener Precognition', tag:'Precognition', file:'esp.html#precog', n:25, p:0.2, unit:'hits', glyph:'⧗', desc:'Name the card before it exists. Each target is drawn after you choose.'},
  {id:'pkline',   name:'Move the Line',      tag:'Psychokinesis',file:'pk-line.html', n:2000, p:0.5,  unit:'ones', glyph:'∿', desc:'A live random walk of 2,000 bits. Push the line upward.'},
  {id:'compass',  name:'Compass Spin',       tag:'Micro-PK',     file:'compass.html', n:2001, p:0.5,  unit:'pushes',glyph:'◎', desc:'One 20-second spin: 2,001 random pushes. Choose clockwise or counter-clockwise and will the needle your way.'},
  {id:'ball',     name:'Ball Machine',       tag:'PK gamble',    file:'ball.html',    n:20,   p:0.5,  unit:'wins', glyph:'●', desc:'Bet left or right, drop the ball through nine rows of pegs. 100 credits, 20 balls.'},
  {id:'remote',   name:'Remote Viewing',     tag:'Experimenter', file:'remote.html',  n:1,    p:0.25, unit:'direct hits', glyph:'◈', total:true, minN:3, desc:'A target is sealed. Describe it, sketch it, then judge it blind against three decoys.'}
];
function z(h,n,p){const sd=Math.sqrt(n*p*(1-p));return sd?(h-n*p)/sd:0}
/* scores: [{uid,test,hits,n,at}], users: {uid:{name}} → ranked rows */
function rank(test,scores,users,limit){
  const t=TESTS.find(x=>x.id===test);if(!t)return[];
  const by={};
  scores.filter(s=>s.test===test).forEach(s=>{
    const u=by[s.uid]||(by[s.uid]={uid:s.uid,runs:0,hits:0,n:0,best:null});
    u.runs++;u.hits+=s.hits;u.n+=s.n;
    if(!u.best||s.hits>u.best.hits||(s.hits===u.best.hits&&s.at<u.best.at))u.best=s;
  });
  let rows=Object.values(by).map(u=>{
    if(t.total)return{uid:u.uid,name:(users[u.uid]||{}).name||'unknown',runs:u.runs,score:u.hits,of:u.n,z:z(u.hits,u.n,t.p),at:u.best.at,qualified:u.n>=t.minN};
    return{uid:u.uid,name:(users[u.uid]||{}).name||'unknown',runs:u.runs,score:u.best.hits,of:u.best.n,z:z(u.best.hits,u.best.n,t.p),at:u.best.at,qualified:true};
  }).filter(r=>r.qualified);
  rows.sort((a,b)=>b.z-a.z||a.at-b.at);
  return rows.slice(0,limit||25);
}
/* Achievements: computed from a user's scores plus a few community actions */
const ACH=[
  ['first','First Contact','Complete any test.'],
  ['all','Full Spectrum','Complete every one of the six tests.'],
  ['sig1','Above the Noise','Score a run at z ≥ 1.65, the top 5% of chance.'],
  ['sig2','Two Sigma','Score a run at z ≥ 2.'],
  ['sig3','Three Sigma','Score a run at z ≥ 3, about 1 in 740 by chance.'],
  ['miss','The Other Side','Score a run at z ≤ −1.65. Psi-missing counts too.'],
  ['series','Consistent Signal','Reach a combined z ≥ 2 across at least 5 runs of one test.'],
  ['ten','Initiate','Log 10 runs.'],
  ['fifty','Adept','Log 50 runs.'],
  ['hundred','Centurion','Log 100 runs.'],
  ['rv3','Remote Eye','Score 3 direct hits in Remote Viewing.'],
  ['voice','Witness','Start a forum thread.'],
  ['pin','Cartographer','Place a pin on the map.']
];
function stats(scores){ // per-test track record for one user's scores
  const out={};
  TESTS.forEach(t=>{const s=scores.filter(x=>x.test===t.id).sort((a,b)=>a.at-b.at);if(!s.length)return;
    const H=s.reduce((a,x)=>a+x.hits,0),N=s.reduce((a,x)=>a+x.n,0),best=s.reduce((m,x)=>x.hits>m.hits?x:m,s[0]);
    out[t.id]={runs:s.length,hits:H,n:N,z:z(H,N,t.p),best:best.hits,bestOf:best.n,bestZ:t.total?null:z(best.hits,best.n,t.p),last:s[s.length-1].at,
      series:t.total?[]:s.slice(-40).map(x=>+z(x.hits,x.n,t.p).toFixed(2))}});
  return out;
}
function achievements(scores,extra={}){
  const st=stats(scores),runZ=scores.filter(s=>s.test!=='remote').map(s=>{const t=TESTS.find(x=>x.id===s.test);return t?z(s.hits,s.n,t.p):0});
  const n=scores.length,mx=Math.max(-99,...runZ),mn=Math.min(99,...runZ);
  const got={first:n>0,all:TESTS.every(t=>st[t.id]),sig1:mx>=1.645,sig2:mx>=2,sig3:mx>=3,miss:mn<=-1.645,
    series:TESTS.some(t=>!t.total&&st[t.id]&&st[t.id].runs>=5&&st[t.id].z>=2),ten:n>=10,fifty:n>=50,hundred:n>=100,
    rv3:!!(st.remote&&st.remote.hits>=3),voice:(extra.threads||0)>0,pin:(extra.pins||0)>0};
  return ACH.map(([id,name,desc])=>({id,name,desc,earned:!!got[id]}));
}
const api={TESTS,rank,z,stats,achievements,ACH};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Board=api;
})(this);
