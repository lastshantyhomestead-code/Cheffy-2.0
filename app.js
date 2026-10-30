'use strict';
/* Cheffy 2.0: self-contained recipe matching and planning, with optional household sync. */
const STORAGE='cheffy2_coastal_state_v1', CONFIG='cheffy2_household_sync_v1', QUEUE='cheffy2_pending_v1';
const DAY=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const BREAKFAST=['Cereal + Milk','Toast + Peanut Butter / Jam','Oatmeal + Fruit','Cereal + Milk','English Muffin + Spread','Pancakes','Oatmeal + Fruit'];
const LUNCH=['Simple Lunch / Leftovers','Simple Lunch / Leftovers','Simple Lunch / Leftovers','Simple Lunch / Leftovers','Simple Lunch / Leftovers','Chickpea Salad Sandwiches','Simple Lunch / Leftovers'];
const PREP_STAPLES=['cereal','milk','fruit','bread','oats'];
const OLD_BOX=[{key:'cucumbers',name:'Cucumbers',amount:'2 whole',min:2,unit:'whole'},{key:'red peppers',name:'Sweet bell peppers',amount:'3 whole',min:3,unit:'whole'},{key:'carrots',name:'Baby carrots',amount:'1 small bag',min:1,unit:'bag'},{key:'snap peas',name:'Snap peas (optional)',amount:'1 small bag',min:1,unit:'bag',optional:true},{key:'hummus',name:'Hummus',amount:'1 tub',min:1,unit:'tub'}];
// Stable weekly veggie selection; saved on the plan so opening an old week never reshuffles it.
const VEG_OPTIONS=[
 {key:'carrots',name:'Carrots',amount:'1 small bag',min:1,unit:'bag'},
 {key:'cucumbers',name:'Cucumbers',amount:'2 whole',min:2,unit:'whole'},
 {key:'red peppers',name:'Bell peppers',amount:'2 whole',min:2,unit:'whole'},
 {key:'celery',name:'Celery',amount:'1 bunch',min:1,unit:'bunch'},
 {key:'broccoli',name:'Broccoli',amount:'1 head',min:1,unit:'whole'},
 {key:'tomatoes',name:'Cherry tomatoes',amount:'1 tub',min:1,unit:'tub'},
 {key:'snap peas',name:'Snap peas',amount:'1 bag',min:1,unit:'bag'},
 {key:'cauliflower',name:'Cauliflower',amount:'1 head',min:1,unit:'whole'},
];
const SPREAD_OPTIONS={peanut_butter:['peanut butter','Peanut butter'],jam:['jam','Jam'],cream_cheese:['cream cheese','Cream cheese'],hummus:['hummus','Hummus'],butter:['butter','Butter']};
const PIZZA_TOPPINGS=[['red peppers','Peppers'],['onions','Onions'],['olives','Olives'],['spinach','Spinach'],['mushrooms','Mushrooms']];
const LUNCH_MODES={review:'Choose lunch ingredients',leftovers:'Leftovers (no new shopping)',sandwich:'Sandwich + fillings',hummus_wrap:'Hummus veggie wrap',soup:'Pantry soup / leftovers (check ingredients)'};
const STAPLE_KEYS=new Set(['flour','rice','oats','pasta','olive oil','sugar','salt','pepper spice','vinegar','baking powder','baking soda','cinnamon','paprika','cumin','chili powder','peanut butter','jam','butter','cereal','dry beans','quinoa','yeast','soy sauce','tomato paste']);
function weeklyBox(plan){if(plan?.veggieBox===false)return [];
 if(Array.isArray(plan?.veggieSelection))return [...plan.veggieSelection.map(k=>VEG_OPTIONS.find(v=>v.key===k)).filter(Boolean),{key:'hummus',name:'Hummus',amount:'1 tub',min:1,unit:'tub'}];
 return OLD_BOX; // preserve veggie-box choices in existing saved weeks
}
function shuffleBox(plan){const used=uniq(plan.days.flatMap(d=>[d.dinner,...(d.sides?.dinner||[])].flatMap(n=>getRecipe(n)?.keys||[])));
 const old=plan.veggieSelection||[];const seed=Date.now()%997;
 const ranked=VEG_OPTIONS.map((v,i)=>({key:v.key,score:(used.includes(v.key)?8:0)+(old.includes(v.key)?-7:0)+((i*31+seed*7)%19)/20})).sort((a,b)=>b.score-a.score);
 plan.veggieSelection=ranked.slice(0,3).map(x=>x.key);return plan.veggieSelection;
}
function spreadKey(plan,i){return plan?.breakfastSpreads?.[i]||'peanut_butter';}
function isSpreadMeal(n){return /^(English Muffin \+ Spread|Toast \+ Peanut Butter \/ Jam)$/.test(n||'');}
function groceryReview(g){return g.review||'unreviewed';}
function pantryStatus(p){return p.status|| (p.have?'enough':'missing');}
function isAvailable(k){let p=onHand(k);return !!p.have&&pantryStatus(p)==='enough';}

const PRODUCE=new Set(['cucumbers','red peppers','carrots','snap peas','cauliflower','celery','kale','spinach','lettuce','broccoli','zucchini','tomatoes','cabbage','potatoes','sweet potatoes','onions','green onions','avocado','lemons','limes','apples','bananas','peas','corn','butternut squash','garlic']);
const PANTRY_DEFAULT=new Set(['tomato sauce','olive oil','salt','pepper spice','flour','rice','pasta','oats','sugar','vinegar','cumin','paprika','cinnamon','baking powder','baking soda','garlic','chili powder']);
const CAT_DINNER=new Set(['Main Dishes','Soups & Stews','Lunch / Simple Meals','Dinner']);
let catalog={recipes:{},rotations:{}},recipeNames=[],activePage='week',state=load(STORAGE,{version:2,revision:0,weeks:[],currentWeekId:'',pantry:[],extras:[]});
let config=load(CONFIG,{url:'',code:''}),queue=load(QUEUE,[]),processing=false,lastCloud=0,cloudIssue='',weekDraft=null,anchor1='',anchor2='',draftDate='',recipeSearch='',haveSearch='',pantrySearch='',haveFilter='safe',timeFilter='any',extraPicker='',editDetail=false,browseCategory='All',groceryFilter='all',currentModal='',weekEndDraft={};
const main=document.getElementById('main'),toastEl=document.getElementById('toast');
function load(k,def){try{return JSON.parse(localStorage.getItem(k)||'null')||def;}catch(e){return def;}}
function persist(){localStorage.setItem(STORAGE,JSON.stringify(state));}
function safe(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function slug(s){return String(s||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}
function keyLabel(k){return k.replace(/\b\w/g,c=>c.toUpperCase()).replace('Red Peppers','Bell Peppers');}
function uniq(a){return [...new Set(a.filter(Boolean))];}
function todayDate(){let d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function monday(iso){const d=new Date((iso||todayDate())+'T12:00:00'); if(Number.isNaN(+d))return monday(todayDate());const x=(d.getDay()+6)%7;d.setDate(d.getDate()-x);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function plusDays(iso,n){const d=new Date(iso+'T12:00:00');d.setDate(d.getDate()+n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function niceDate(iso){if(!iso)return '';return new Date(iso+'T12:00:00').toLocaleDateString('en-CA',{month:'short',day:'numeric',year:'numeric'});}
function toast(t){toastEl.textContent=t;toastEl.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>toastEl.classList.remove('show'),3300);}
function getRecipe(n){return catalog.recipes[n]||null;}
function sortedNames(fn){return recipeNames.filter(n=>{const r=getRecipe(n);return r&&r.cardComplete&&fn(r);}).sort((a,b)=>a.localeCompare(b));}
function dinners(){return sortedNames(r=>CAT_DINNER.has(r.category)&&r.name!=='Homemade Pizza');}
function salads(){return sortedNames(r=>r.category==='Salads / Sides');}
function bakes(){return ['Oatmeal Breakfast Muffins','Banana Bread / Muffins',"Susan's Chocolate Chip Cookies",'Brownies – Helen','Rice Crispy Squares','Chocolate Chip Drop Cookies','Chocolate Chip Cookies',"Hershey's Chocolate Chip Cookies"].filter(n=>getRecipe(n)?.cardComplete);}
function has(name){return Boolean(getRecipe(name));}
function onHand(key){return state.pantry.find(x=>x.key===key)||{key,have:false,extra:false,notes:'',status:'unconfirmed'};}
// Prefer the saved current-week pointer, but recover from spreadsheet Date formatting
// or an absent pointer without changing any saved meals or cloud records.
function canonicalWeekId(value){
 if(value==null)return '';
 const raw=String(value).trim();
 const match=raw.match(/^(\d{4}-\d{2}-\d{2})(?:T|\s|$)/);
 return match?match[1]:raw;
}
function reconcileCurrentWeek(){
 if(!Array.isArray(state.weeks)||!state.weeks.length)return;
 const desired=canonicalWeekId(state.currentWeekId);
 const match=state.weeks.find(w=>canonicalWeekId(w.id)===desired||canonicalWeekId(w.weekStart)===desired);
 if(match){state.currentWeekId=match.id;return;}
 // On a missing pointer, show the active calendar week when available.
 const today=todayDate(),active=state.weeks.find(w=>{
  const start=canonicalWeekId(w.weekStart||w.id);
  return /^\d{4}-\d{2}-\d{2}$/.test(start)&&start<=today&&today<=plusDays(start,6);
 });
 const fallback=active||[...state.weeks].sort((a,b)=>canonicalWeekId(b.weekStart).localeCompare(canonicalWeekId(a.weekStart)))[0];
 if(fallback)state.currentWeekId=fallback.id;
}
function currentWeek(){reconcileCurrentWeek();return state.weeks.find(w=>w.id===state.currentWeekId)||null;}
function stateApply(op){const p=op.payload||{};
 if(op.action==='saveWeek'){
  const old=state.weeks.find(w=>w.id===p.week.id);
  let copy=structuredClone(p.week);
  if(old){const check=new Map(old.grocery.map(x=>[x.id,x.checked]));copy.grocery.forEach(g=>{if(check.has(g.id))g.checked=check.get(g.id);});}
  state.weeks=state.weeks.filter(w=>w.id!==copy.id).concat(copy).sort((a,b)=>a.weekStart.localeCompare(b.weekStart));
  if(p.setCurrent!==false)state.currentWeekId=copy.id;
 }else if(op.action==='checkGrocery'){
  const w=state.weeks.find(w=>w.id===p.weekId),g=w?.grocery?.find(x=>x.id===p.itemId);if(g)g.checked=!!p.checked;
 }else if(op.action==='reviewGrocery'){
  const g=state.weeks.find(w=>w.id===p.weekId)?.grocery?.find(g=>g.id===p.itemId);
  if(g)g.review=['have','some','buy','unreviewed'].includes(p.review)?p.review:'unreviewed';
 }else if(op.action==='refreshGrocery'){
  const w=state.weeks.find(w=>w.id===p.weekId);
  if(w){const prior=new Map(w.grocery.map(g=>[g.id,g]));w.grocery=p.grocery.map(g=>({...g,checked:prior.get(g.id)?.checked??g.checked,review:prior.get(g.id)?.review??g.review}));for(const old of prior.values())if(!w.grocery.some(g=>g.id===old.id))w.grocery.push({...old,note:uniq([old.note,'Carried over from original grocery list; verify before removing.']).filter(Boolean).join(' ')});}
 }else if(op.action==='removeGrocery'){
  const w=state.weeks.find(w=>w.id===p.weekId);if(w)w.grocery=w.grocery.filter(g=>g.id!==p.itemId);
 }else if(op.action==='bulkPantry'){
  for(const row of p.items||[]){state.pantry=state.pantry.filter(x=>x.key!==row.key).concat({...onHand(row.key),key:row.key,have:!!row.have,extra:!!row.extra,status:row.status||'missing',notes:row.notes||''});}
 }else if(op.action==='finishWeek'){
  for(const row of p.items||[]){state.pantry=state.pantry.filter(x=>x.key!==row.key).concat({key:row.key,have:!!row.have,extra:!!row.extra,status:row.status||'missing',notes:row.notes||''});}
  const w=state.weeks.find(w=>w.id===p.weekId);if(w)w.plan.finishedAt=p.finishedAt;
 }else if(op.action==='prepToggle'){
  const w=state.weeks.find(w=>w.id===p.weekId);if(w){w.plan.prepDone=w.plan.prepDone||{};w.plan.prepDone[p.itemId]=!!p.checked;}
 }else if(op.action==='setPantry'){
  state.pantry=state.pantry.filter(x=>x.key!==p.key).concat({key:p.key,have:!!p.have,extra:!!p.extra,notes:p.notes||'',status:p.status||(p.have?'enough':'missing')});
 }else if(op.action==='addExtra'){
  if(!state.extras.some(x=>x.id===p.id))state.extras.push({id:p.id,name:p.name,checked:false});
 }else if(op.action==='checkExtra'){
  const x=state.extras.find(x=>x.id===p.id);if(x)x.checked=!!p.checked;
 }else if(op.action==='removeExtra')state.extras=state.extras.filter(x=>x.id!==p.id);
 else if(op.action==='setCurrent')state.currentWeekId=p.id;
 else if(op.action==='deleteWeek'){state.weeks=state.weeks.filter(x=>x.id!==p.id);if(state.currentWeekId===p.id)state.currentWeekId='';}
 state.revision=(state.revision||0)+1;persist();
}
function commit(action,payload){let op={id:'ch'+Date.now().toString(36)+Math.random().toString(36).slice(2,10),action,payload};stateApply(op);
 if(config.url&&config.code){queue.push(op);localStorage.setItem(QUEUE,JSON.stringify(queue));processQueue();} updateSync();return op;
}
function syncUrl(url){try{const u=new URL(url);if(u.protocol!=='https:'||!['script.google.com','script.googleusercontent.com'].includes(u.hostname)||!u.pathname.includes('/macros/'))return '';return u.href;}catch(e){return '';}}
function jsonp(action,args={}){return new Promise((resolve,reject)=>{
 if(!syncUrl(config.url))return reject(Error('Connect a valid Apps Script /exec URL first'));
 const cb='_cheffyCB'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
 const u=new URL(config.url);u.searchParams.set('action',action);u.searchParams.set('code',config.code);u.searchParams.set('callback',cb);Object.entries(args).forEach(([k,v])=>u.searchParams.set(k,String(v)));
 let script=document.createElement('script'),ended=false;
 const tidy=()=>{if(ended)return;ended=true;clearTimeout(timeout);delete window[cb];script.remove();};
 window[cb]=v=>{tidy();v?.ok?resolve(v):reject(Error(v?.error||'Sync server returned an error'));};
 script.onerror=()=>{tidy();reject(Error('Cannot reach Google Apps Script'));};
 const timeout=setTimeout(()=>{tidy();reject(Error('Sync request timed out'));},12500);script.src=u.toString();document.head.appendChild(script);
});}
function updateSync(){const t=document.getElementById('syncStatus');if(!t)return;
 t.textContent=!config.url?'○ Local only':processing?'↻ Syncing':queue.length?'◌ Pending '+queue.length:cloudIssue?'! Offline / issue':'● Shared';
 t.style.color=cloudIssue?'#a45e49':'var(--blue)';}
async function reloadRemote(force=false){if(!config.url||!config.code||queue.length&&!force)return;
 try{const out=await jsonp('snapshot');if(queue.length)return;
 state=out.state;reconcileCurrentWeek();persist();lastCloud=Date.now();cloudIssue='';render();updateSync();
 }catch(err){cloudIssue=err.message;updateSync();}}
function wait(ms){return new Promise(r=>setTimeout(r,ms));}
async function processQueue(){if(processing||!config.url||!config.code||!navigator.onLine)return;
 processing=true;updateSync();try{
  while(queue.length){const op=queue[0];
   await fetch(config.url,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain'},body:JSON.stringify({code:config.code,op}),redirect:'follow'});
   let found=false;
   for(let i=0;i<4;i++){await wait(750+i*650);const result=await jsonp('receipt',{id:op.id});if(result.found){found=true;break;}}
   if(!found)throw Error('Changes not confirmed by Google Sheets. Check setup and deployment.');
   queue.shift();localStorage.setItem(QUEUE,JSON.stringify(queue));
  }
  cloudIssue='';
 }catch(err){cloudIssue=err.message||String(err);}
 finally{processing=false;updateSync();if(!queue.length&&config.url)await reloadRemote(true);}
}
function choose(page){activePage=page;recipeSearch='';document.querySelectorAll('[data-go]').forEach(b=>b.classList.toggle('active',b.dataset.go===page));render();main.focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});}
function render(){updateSync();let html='';try{
 switch(activePage){case'week':html=renderWeek();break;case'build':html=renderBuild();break;case'have':html=renderHave();break;case'grocery':html=renderGrocery();break;case'recipes':html=renderRecipes();break;case'pantry':html=renderPantry();break;case'settings':html=renderSettings();break;default:html=renderWeek();}
 }catch(e){console.error(e);html=`<div class="notice danger">Couldn't display this screen: ${safe(e.message)}</div>`;}
 main.innerHTML=html;
}
function weekOptions(){return [...state.weeks].sort((a,b)=>b.weekStart.localeCompare(a.weekStart)).map(w=>`<option value="${safe(w.id)}" ${state.currentWeekId===w.id?'selected':''}>${safe(w.title||niceDate(w.weekStart))} · ${niceDate(w.weekStart)}</option>`).join('');}
function renderWeek(){const w=currentWeek();if(!w)return `<div class="page-header"><div class="eyebrow">Your family kitchen</div><h2>Plan meals your way.</h2><p class="sub">Create a week, or start with one of your 16 Classic rotations. Each saved week can be shared with the household.</p></div><div class="grid2"><button class="tile" data-go="build"><span class="emoji">✦</span><b>Build My Week</b><span>Make a new ingredient-smart menu</span></button><button class="tile" data-go="have"><span class="emoji">🥕</span><b>Use What We Have</b><span>Find a recipe without changing the menu</span></button></div><div class="notice">Connect your household Google Sheet in <button class="text-link" data-go="settings">Settings</button> to sync between phones. Local menus work before setup.</div>`;
 const p=w.plan,prep=prepItems(p),done=prep.filter(x=>p.prepDone?.[x.id]).length;
 return `<div class="page-header"><div class="eyebrow">Our kitchen · Saved week</div><h2>${safe(w.title||'My Week')}</h2><p class="sub">${niceDate(w.weekStart)} – ${niceDate(plusDays(w.weekStart,6))}</p></div>
 <div class="card"><div class="row between"><div style="flex:1"><label class="field" for="pickWeek">Open saved week</label><select id="pickWeek">${weekOptions()}</select></div><button class="smallbtn secondary" data-go="build">New week +</button></div><div class="btnrow spaced"><button class="smallbtn outline" data-action="editWeek">Edit or swap meals</button><button class="smallbtn outline" data-action="deleteWeek">Delete saved week</button></div></div>
 <section class="card prep"><div class="cardhead"><h3>☀ Sunday & Weekly Prep</h3><span class="pill peach">${done} / ${prep.length} done</span></div>${prep.map(x=>`<label class="checkrow"><input type="checkbox" data-prep-id="${safe(x.id)}" ${p.prepDone?.[x.id]?'checked':''}><span class="${p.prepDone?.[x.id]?'done':''}">${safe(x.text)}</span></label>`).join('')}</section>
 <section class="card veggie"><div class="cardhead"><h3>🥕 Weekly Veggie Box</h3><span class="pill green">Snack prep</span></div><p class="small">Wash and cut ${safe(weeklyBox(p).map(v=>v.name).join(', '))}. Refill midweek as needed.</p><p class="soft">Snack portions are included alongside dinner needs in one consolidated grocery line per ingredient.</p></section>
 <div class="cardhead"><h3>Your daily meals</h3><button class="smallbtn secondary" data-go="grocery">Grocery list →</button></div>
 <div class="days">${p.days.map((d,i)=>`<article class="day-card"><div class="day-top"><span>${DAY[i]}</span><small>${niceDate(plusDays(w.weekStart,i))}</small></div><div class="meals">${['breakfast','lunch','dinner'].map(meal=>`<div class="meal ${meal}"><span class="meal-label">${meal}</span><div class="meal-links">${mealLinks(d,meal)}</div></div>`).join('')}</div></article>`).join('')}</div>
 <div class="card"><div class="row between"><b>Weekly salad</b><button class="text-link" data-recipe="${safe(p.salad)}">${safe(p.salad)}</button></div><div class="row between"><b>Weekly baking</b><button class="text-link" data-recipe="${safe(p.bake)}">${safe(p.bake)}</button></div></div>`;
}
function mealLinks(d,meal){const refs=[d[meal],...(d.sides?.[meal]||[])].filter(Boolean);if(!refs.length)return '<span>Not planned</span>';return refs.map((name,i)=>`<button class="meal-name" data-recipe="${safe(name)}">${i?'+ ':''}${safe(name)}</button>`).join('');}
function prepItems(p){const a=[{id:'vegbox',text:'Prepare veggie snack box: '+weeklyBox(p).map(v=>v.name).join(', ')+'. Refill midweek.'},{id:'salad',text:'Prepare weekly salad: '+(p.salad||'select a salad')},{id:'bake',text:'Make weekly baked snack: '+(p.bake||'select a snack')},{id:'pizza',text:'Check Wednesday pizza dough ingredients and homemade red sauce'}];
 if(p.advancePrep)a.push({id:'advance',text:p.advancePrep});
 const recipeKeys=uniq(p.days.flatMap(d=>[d.dinner,...(d.sides?.dinner||[])].flatMap(n=>getRecipe(n)?.keys||[])));
 if(recipeKeys.includes('rice'))a.push({id:'rice',text:'Cook a batch of rice for the meals using rice'});
 if(recipeKeys.includes('black beans')||recipeKeys.includes('chickpeas'))a.push({id:'beans',text:'Drain or prepare beans/chickpeas for multiple recipes'});
 if(recipeKeys.includes('carrots')||recipeKeys.includes('red peppers')||recipeKeys.includes('onions'))a.push({id:'chop',text:'Prep shared vegetables for dinners as practical'});
 return a;}
function recipeOptions(names,selected,blank='Select a meal…'){return `<option value="">${safe(blank)}</option>`+names.map(n=>`<option value="${safe(n)}" ${n===selected?'selected':''}>${safe(n)}</option>`).join('');}
function makeBasePlan(){return {days:DAY.map((day,i)=>({day,breakfast:BREAKFAST[i],lunch:LUNCH[i],dinner:i===2?'Homemade Pizza':i===5?'Leftovers':''})),salad:salads()[0]||'',bake:bakes()[0]||'',prepDone:{},veggieBox:true,veggieSelection:[],breakfastSpreads:{},lunchModes:{},pizzaToppings:[],simpleServings:3,advancePrep:''};}
function sharedScore(recipe,seedKeys,used,pantryKeys){let score=0;for(const k of recipe.keys||[]){if(seedKeys.has(k))score+=PRODUCE.has(k)?6:3;else if(pantryKeys.has(k))score+=1.1;else if(PRODUCE.has(k))score-=1.5;}
 const first=recipe.name.toLowerCase().split(' ')[0];if(used.some(x=>x.toLowerCase().startsWith(first)))score-=7;
 const fast=(recipe.timeEstimate||40)<=20;if(fast&&used.filter(n=>(getRecipe(n)?.timeEstimate||40)<=20).length<2)score+=6;
 if(recipe.name.includes('Pizza'))score-=20;
 return score;}
function propose(){const p=makeBasePlan(),selected=uniq([anchor1,anchor2].filter(n=>getRecipe(n)?.cardComplete));
 const slots=[0,1,3,4,6];const target=slots.map(i=>null);
 selected.slice(0,2).forEach((n,i)=>target[i]=n);
 let picked=[...selected],seedKeys=new Set(selected.flatMap(n=>getRecipe(n)?.keys||[])),pantryKeys=new Set([...PANTRY_DEFAULT,...state.pantry.filter(p=>p.have).map(p=>p.key)].filter(k=>onHand(k).have));
 const candidates=dinners().filter(n=>!selected.includes(n)),fresh=new Set(seedKeys);
 for(let i=0;i<slots.length;i++){
  if(target[i])continue;
  const scored=candidates.filter(n=>!picked.includes(n)).map(n=>({n,score:sharedScore(getRecipe(n),fresh,picked,pantryKeys)+ (i===4&&(getRecipe(n)?.timeEstimate||40)>=35?1:0)})).sort((a,b)=>b.score-a.score||a.n.localeCompare(b.n));
  const choice=scored[0]?.n;if(!choice)continue;target[i]=choice;picked.push(choice);getRecipe(choice)?.keys.forEach(k=>fresh.add(k));
 }
 slots.forEach((day,i)=>p.days[day].dinner=target[i]||'Simple Lunch / Leftovers');
 // Salads and baking use overlap with selected groceries; weekends remain fixed.
 const choice=(names)=>names.slice().sort((a,b)=>sharedScore(getRecipe(b),fresh,[],pantryKeys)-sharedScore(getRecipe(a),fresh,[],pantryKeys))[0];
 p.salad=choice(salads())||p.salad;p.bake=choice(bakes())||p.bake;
 shuffleBox(p);weekDraft=p;toast('Proposed a week using shared ingredients');render();}
function fromClassic(value){const [r,index]=value.split('|');const source=catalog.rotations[r]?.weeks?.[Number(index)];if(!source)return;
 const plan=makeBasePlan();plan.days=source.days.map((d,i)=>{const refs=meal=>d.meals[meal]?.refs?.filter(Boolean)||[];
 const first=meal=>refs(meal)[0]||d.meals[meal]?.label||({breakfast:BREAKFAST[i],lunch:LUNCH[i],dinner:'Leftovers'}[meal]);
 const sides={};['breakfast','lunch','dinner'].forEach(meal=>{if(refs(meal).length>1)sides[meal]=refs(meal).slice(1);});
 return {day:DAY[i],breakfast:first('breakfast'),lunch:first('lunch'),dinner:first('dinner'),sides};});
 plan.salad=source.salad||salads()[Number(index)%salads().length];plan.bake=source.bake||bakes()[Number(index)%bakes().length];plan.advancePrep=source.prepNote||'';
 shuffleBox(plan);weekDraft=plan;toast('Loaded Classic '+r+' Week '+(Number(index)+1)+' as an editable draft');render();}
function draftSummary(p){const vals=p.days.flatMap(d=>getRecipe(d.dinner)?.keys||[]);let repeats=[...new Set(vals)].filter(k=>vals.filter(x=>x===k).length>1);
 return `<div class="notice"><b>Shopping overlap:</b> ${repeats.length} shared ingredients (${safe(repeats.slice(0,7).map(keyLabel).join(', ')||'choose some dinners')}).<br><span class="mini">This measures ingredient reuse, not live grocery prices.</span></div>`;}
function dinnerOptions(p,dayIndex){const cur=p.days[dayIndex].dinner,other=p.days.filter((_,i)=>i!==dayIndex).map(d=>d.dinner).filter(n=>getRecipe(n));
 const pantryKeys=new Set([...PANTRY_DEFAULT,...state.pantry.filter(x=>x.have).map(x=>x.key)].filter(k=>onHand(k).have)),shared=new Set(other.flatMap(n=>getRecipe(n)?.keys||[]));
 const all=dinners().filter(n=>n===cur||!other.includes(n));
 const top=all.slice().sort((a,b)=>sharedScore(getRecipe(b),shared,other,pantryKeys)-sharedScore(getRecipe(a),shared,other,pantryKeys)||a.localeCompare(b)).slice(0,5);
 // A dropdown option appears once, even if it is both a recommended and current dinner.
 const option=n=>`<option value="${safe(n)}" ${n===cur?'selected':''}>${safe(n)}</option>`;
 return '<option value="">Choose a dinner…</option><optgroup label="Best ingredient matches">'+top.map(option).join('')+'</optgroup><optgroup label="All other dinners">'+all.filter(n=>!top.includes(n)).sort((a,b)=>a.localeCompare(b)).map(option).join('')+'</optgroup>';
}
function renderBuild(){const d=draftDate||monday(todayDate()),p=weekDraft,classicOpts=Object.entries(catalog.rotations).flatMap(([r,x])=>x.weeks.map((w,i)=>`<option value="${r}|${i}">Rotation ${r} · Week ${i+1}</option>`)).join('');
 return `<div class="page-header"><div class="eyebrow">Plan for savings</div><h2>Build My Week</h2><p class="sub">Pick one or two meals you're craving. Cheffy fills the other nights based on shared ingredients, cooking time and pantry staples.</p></div>
 <div class="card"><div class="fields"><div><label class="field">Week starting Monday</label><input id="draftDate" type="date" value="${safe(d)}"></div><div><label class="field">Use a saved Classic week</label><select id="classicSelect"><option value="">Start from a Classic rotation…</option>${classicOpts}</select></div></div>
 <div class="fields"><div><label class="field">Anchor meal 1</label><select id="anchor1"><option value="">Choose any dinner…</option>${recipeOptions(dinners(),anchor1,'Choose…').replace('<option value="">Choose…</option>','')}</select></div><div><label class="field">Anchor meal 2 (optional)</label><select id="anchor2">${recipeOptions(dinners().filter(n=>n!==anchor1),anchor2,'Optional…')}</select></div></div>
 <div class="btnrow spaced"><button class="btn" data-action="propose">✦ Suggest a Week</button><button class="btn secondary" data-action="emptyDraft">Customize from scratch</button></div></div>
 ${p?`<div class="card"><div class="cardhead"><h3>Your proposed dinners</h3><span class="pill">Editable</span></div>${p.days.map((day,i)=>`<div class="stacked-field"><div class="row between"><b>${DAY[i]}</b>${i===2?'<span class="pill peach">Pizza night</span>':i===5?'<span class="pill">Leftovers</span>':''}</div><select data-draft-day="${i}" data-draft-meal="dinner" ${i===2||i===5?'disabled':''}>${dinnerOptions(p,i)}</select>${day.sides?.dinner?.length?`<small class="soft">Classic sides: ${safe(day.sides.dinner.join(' + '))} (included in grocery list; changing dinner removes sides)</small>`:''}</div>`).join('')}
 <div class="divider"></div><div class="fields"><div><label class="field">Weekly salad prep</label><select data-draft-special="salad">${recipeOptions(salads(),p.salad)}</select></div><div><label class="field">Weekly baking</label><select data-draft-special="bake">${recipeOptions(bakes(),p.bake)}</select></div></div>
 <details class="spaced" open><summary><b>Breakfasts, spreads and simple lunches</b></summary><label class="field">Portions to plan for each simple breakfast / lunch</label><select id="simpleServings">${[1,2,3,4,5,6,7,8].map(n=>`<option value="${n}" ${(p.simpleServings||3)===n?'selected':''}>${n} portion${n===1?'':'s'}</option>`).join('')}</select><p class="soft">Choose one spread when needed. For a generic lunch, tell Cheffy whether to buy sandwich ingredients, wrap ingredients or rely on leftovers.</p>${p.days.map((day,i)=>`<div class="fields"><div><label class="field">${DAY[i]} breakfast</label><select data-draft-day="${i}" data-draft-meal="breakfast">${recipeOptions(sortedNames(r=>r.category==='Breakfast'),day.breakfast)}</select>${isSpreadMeal(day.breakfast)?`<label class="field">Choose spread</label><select data-draft-spread="${i}">${Object.entries(SPREAD_OPTIONS).map(([k,v])=>`<option value="${k}" ${spreadKey(p,i)===k?'selected':''}>${safe(v[1])}</option>`).join('')}</select>`:''}</div><div><label class="field">${DAY[i]} lunch</label><select data-draft-day="${i}" data-draft-meal="lunch">${recipeOptions(sortedNames(r=>r.category==='Lunch / Simple Meals'||r.category==='Lunch'),day.lunch)}</select>${day.lunch==='Simple Lunch / Leftovers'?`<label class="field">Simple lunch plan</label><select data-draft-lunch="${i}">${Object.entries(LUNCH_MODES).map(([k,v])=>`<option value="${k}" ${(p.lunchModes?.[i]||'review')===k?'selected':''}>${safe(v)}</option>`).join('')}</select>`:''}</div></div>`).join('')}</details>
 <div class="card"><h3>🍕 Wednesday pizza toppings</h3><p class="soft">Pizza dough, sauce and cheese are included. Select only the extra toppings you want.</p><div class="choice-grid">${PIZZA_TOPPINGS.map(([key,name])=>`<label class="option-check"><input type="checkbox" data-draft-pizza="1" value="${safe(key)}" ${(p.pizzaToppings||[]).includes(key)?'checked':''}> ${safe(name)}</label>`).join('')}</div></div>
 ${draftSummary(p)}<section class="veggie card"><div class="cardhead"><h3>🥕 Weekly Veggie Box</h3><button class="smallbtn secondary" data-action="shuffleBox">Shuffle vegetables ↻</button></div><p class="small">${safe(weeklyBox(p).map(x=>x.name).join(' · '))}. Chooses 3 vegetables, favouring overlap with dinners, plus hummus.</p></section>
 <div class="btnrow"><button class="btn block" data-action="saveDraft">Save My Week & Generate Groceries</button></div></div>`:`<div class="notice">Choose anchor meals and tap “Suggest a Week,” or start with a Classic rotation. Your current saved week won't change until you tap Save.</div>`}`;
}
function numberValue(s){let val=0;for(const part of String(s).trim().split(/\s+/)){let t=part.split('/');val+=(t.length===2?Number(t[0])/Number(t[1]):Number(part));}return val;}
function selectFirstQuantity(txt){let s=String(txt).trim().replace(/¼/g,'1/4').replace(/½/g,'1/2').replace(/¾/g,'3/4');
 const m=s.match(/^(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)(?:\s*[–-]\s*(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+))?/);
 if(!m)return null;const n=numberValue(m[2]||m[1]);if(!Number.isFinite(n))return null;
 const tail=s.slice(m[0].length).trim();const unitMatch=tail.match(/^(cups?|c\b|tbsp|tablespoons?|tsp|teaspoons?|grams?|g\b|kg\b|oz\b|lbs?\b|cans?|bunch(?:es)?|packs?|packets?|bags?|tubs?|heads?|slices?|cloves?|whole|medium|small|large|wraps?|buns?)\b/i);
 const u=unitMatch?.[1]?.toLowerCase()||'whole';const names={'cups':'cup','c':'cup','tablespoon':'tbsp','tablespoons':'tbsp','teaspoon':'tsp','teaspoons':'tsp','grams':'g','bunches':'bunch','packets':'packet','heads':'head','slices':'slice','cloves':'clove','wraps':'wrap','buns':'bun','cans':'can','bags':'bag','tubs':'tub','packs':'pack','medium':'whole','small':'whole','large':'whole'};
 return {n,unit:names[u]||u.replace(/s$/,'')||'whole',approx:!!m[2]};
}
function matchingLine(key,line){const s=line.toLowerCase();const pats={
 'olives':/\bolives?\b/, 'yeast':/\b(?:instant|active|dry|baker.s)\s+yeast\b|\byeast\b(?!\s+extract)/,
 'onions':/\bonions?\b(?!\s+powder)/,'garlic':/\bgarlic\b(?!\s+powder)/,
 'rice':/\brice\b(?!\s+(?:crispy|krispies?))/, 'pasta':/\b(?:pasta|penne|noodles?|spaghetti|orzo|macaroni|rotini|linguine)\b/,
 'tomato sauce':/\b(?:tomato sauce|red sauce|pizza sauce|marinara|passata|crushed tomatoes|diced tomatoes)\b/,
 'potatoes':/\bpotatoes?\b(?!.*sweet)/,'milk':/(?<!coconut )\bmilk\b/,'carrots':/\bcarrots?\b/, 'red peppers':/\b(?:red (?:bell )?peppers?|bell peppers?|sweet peppers?)\b/,
 'cheese':/\b(?:cheese|cheddar|mozzarella|parmesan|feta)\b/,'flour':/\bflour\b/,'butter':/\b(?:butter|margarine)\b/,'cucumbers':/\bcucumbers?\b/, 'peas':/\b(?:green peas|peas)\b/,
 'snap peas':/\bsnap peas?\b/,'hummus':/\bhummus\b/,'whole wheat wraps':/\b(?:wraps?|tortillas?)\b/
 };
 if(pats[key])return pats[key].test(s) && !(key==='yeast'&&s.includes('nutritional yeast')) && !(key==='butter'&&s.includes('peanut butter')) && !(key==='olives'&&s.includes('olive oil')) && !(key==='onions'&&s.includes('green onion'));
 const singular=key.replace(/s$/,'');return new RegExp('\\b'+singular.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'s?\\b','i').test(s);
}
function grocerySection(key){if(PRODUCE.has(key))return 'Produce';if(['cheese','milk','eggs','yogurt','butter','sour cream','hummus','tofu','cream cheese'].includes(key))return 'Refrigerated';if(['english muffins','kaiser buns','bread','whole wheat wraps','pie crust'].includes(key))return 'Bread & Wraps';if(['chicken','tuna','gnocchi','peas','corn'].includes(key))return 'Protein / Frozen';return 'Pantry & Baking';}
function everydayIngredients(name,plan,day){
 const servings=Math.min(12,Math.max(1,Number(plan.simpleServings)||3));
 const basic={
 'Cereal + Milk':[['cereal',1,'bowl'],['milk',1,'serving']],
 'Oatmeal + Fruit':[['oats',0.5,'cup'],['bananas',1,'whole']],
 'Toast + Peanut Butter / Jam':[['bread',2,'slice'],[SPREAD_OPTIONS[spreadKey(plan,day)]?.[0]||'peanut butter',1,'serving']],
 'English Muffin + Spread':[['english muffins',1,'whole'],[SPREAD_OPTIONS[spreadKey(plan,day)]?.[0]||'peanut butter',1,'serving']]
 };
 if(basic[name])return basic[name].map(([key,n,u])=>[key,n*servings,u]);
 if(name==='Simple Lunch / Leftovers'){
  const mode=plan.lunchModes?.[day]||'review';
  if(mode==='sandwich')return [['bread',2,'slice'],['hummus',1,'serving'],['lettuce',1,'serving']].map(([k,n,u])=>[k,n*servings,u]);
  if(mode==='hummus_wrap')return [['whole wheat wraps',1,'wrap'],['hummus',1,'serving'],['carrots',1,'serving'],['cucumbers',1,'serving']].map(([k,n,u])=>[k,n*servings,u]);
  return [];
 }
 return null;
}
function groceryWarnings(plan){let warnings=[];
 plan.days.forEach((d,i)=>{
  if(d.lunch==='Simple Lunch / Leftovers'&&(!plan.lunchModes?.[i]||plan.lunchModes[i]==='review'))warnings.push(DAY[i]+' lunch: select leftovers or a simple lunch option');
  else if(d.lunch==='Simple Lunch / Leftovers'&&plan.lunchModes?.[i]==='soup')warnings.push(DAY[i]+' lunch: soup ingredients must be checked manually');
  for(const part of ['breakfast','lunch','dinner']){const name=d[part];if(name&&name!=='Leftovers'&&name!=='Simple Lunch / Leftovers'&&!getRecipe(name)&&!everydayIngredients(name,plan,i))warnings.push(DAY[i]+' '+part+': no ingredient mapping for '+name);}
 });return uniq(warnings);
}
function aggregateGrocery(plan){const map=new Map();
 function add(key,source,quantity,unit,extraNote=''){
  if(!key)return;let item=map.get(key);if(!item){item={id:'item-'+slug(key),key,name:keyLabel(key),quantity:'',section:grocerySection(key),source:[],amounts:{},checked:false,review:'unreviewed',note:'',unknown:0};map.set(key,item);}
  if(!item.source.includes(source))item.source.push(source);
  if(quantity!=null&&Number.isFinite(Number(quantity))){item.amounts[unit||'whole']=(item.amounts[unit||'whole']||0)+Number(quantity);}else item.unknown++;
  if(extraNote)item.note=uniq([item.note,extraNote]).filter(Boolean).join(' ');
 }
 function addRecipe(name,source){
  const r=getRecipe(name);if(!r)return;
  const special=name==='Homemade Pizza';let matched=false;
  for(const line of r.ingredients||[]){if(!line||/^(DOUGH|TOPPINGS|FILLING|SAUCE|OPTIONAL):?$/i.test(line.trim()))continue;
   if(special&&/^(optional|shredded cheese|homemade pizza sauce)/i.test(line.trim()))continue;
   const matches=(r.keys||[]).filter(k=>matchingLine(k,line)&&!(special&&['cheese','tomato sauce','onions','olives','spinach','red peppers'].includes(k)&&/optional/i.test(line)));
   if(!matches.length)continue; matched=true;
   let qty=selectFirstQuantity(line);
   for(const key of matches)add(key,source,qty?.n??null,qty?.unit||'whole',qty?.approx?'Recipe amount is a range; upper value used.':'');
  }
  if(special){add('tomato sauce',source,null,'whole','Pizza sauce: check amount.');add('cheese',source,null,'whole','Pizza cheese: choose dairy or plant-based.');
   for(const key of plan.pizzaToppings||[])if(PIZZA_TOPPINGS.some(v=>v[0]===key))add(key,source,null,'whole','Selected pizza topping: check amount.');
  }
  if(!matched&&!special)add('recipe check: '+slug(name),source,null,'whole','Recipe has no recognized ingredient amounts; review recipe card.');
 }
 plan.days.forEach((d,i)=>{for(const meal of ['breakfast','lunch','dinner']){
  const names=[d[meal],...(d.sides?.[meal]||[])];
  for(const n of names){if(!n||n==='Leftovers')continue;
   let simple=everydayIngredients(n,plan,i);
   if(simple!==null){for(const [key,qty,unit] of simple)add(key,DAY[i]+' '+meal,qty,unit,'Portion estimate: adjust for household size.');}
   else addRecipe(n,DAY[i]+' '+meal+': '+n);
  }
 }});
 for(const [key,name] of [['salad',plan.salad],['bake',plan.bake]])if(name)addRecipe(name,'Weekly '+key+': '+name);
 for(const v of weeklyBox(plan))add(v.key,'Veggie box',v.min,v.unit,'Includes veggie-box snack portions.');
 return [...map.values()].map(item=>{
  const parts=Object.entries(item.amounts).map(([unit,n])=>{
   const round=Math.round(n*100)/100;return `${round} ${unit}${round>1&&!['g','kg','tbsp','tsp','oz','whole'].includes(unit)?'s':''}`;
  });
  if(item.unknown)parts.push('check recipe / usual amount');
  item.quantity=parts.join(' + ')||'Check recipe / usual amount';
  item.source=item.source.slice(0,7).join(' · ');
  delete item.amounts;delete item.unknown;return item;
 }).sort((a,b)=>a.section.localeCompare(b.section)||a.name.localeCompare(b.name));
}
function plannedIngredientKeys(plan,upcomingOnly=false,weekStart=''){
 const set=new Set(),now=todayDate();
 plan.days.forEach((d,i)=>{if(upcomingOnly&&weekStart&&plusDays(weekStart,i)<now)return;
  for(const meal of ['breakfast','lunch','dinner'])for(const n of [d[meal],...(d.sides?.[meal]||[])]){
   const simple=everydayIngredients(n,plan,i);if(simple!==null)simple.forEach(x=>set.add(x[0]));
   else (getRecipe(n)?.keys||[]).forEach(k=>set.add(k));
  }
 });
 for(const x of [plan.salad,plan.bake])getRecipe(x)?.keys?.forEach(k=>set.add(k));
 weeklyBox(plan).forEach(v=>set.add(v.key));
 (plan.pizzaToppings||[]).forEach(k=>set.add(k));
 return set;
}
function reservedKeys(){const w=currentWeek();if(!w?.plan||!w.weekStart)return new Set();if(todayDate()>plusDays(w.weekStart,6))return new Set();return plannedIngredientKeys(w.plan,true,w.weekStart);}
function safeInventory(recipe,reserved){const keys=recipe.keys||[],missing=keys.filter(k=>!isAvailable(k)),protectedKeys=keys.filter(k=>reserved.has(k)&&!onHand(k).extra);return {missing,protectedKeys,matched:keys.length-missing.length,available:keys.length-missing.length-protectedKeys.filter(k=>!missing.includes(k)).length};}
function timeOptions(selected){return [['any','Any time'],['15','15 min or less'],['30','30 min or less'],['60','60 min or less']].map(([v,label])=>`<option value="${v}" ${selected===v?'selected':''}>${label}</option>`).join('');}
function renderHave(){const reserved=reservedKeys(),query=haveSearch.trim().toLowerCase();let matches=recipeNames.filter(n=>getRecipe(n)?.cardComplete&&(!query||n.toLowerCase().includes(query)||(getRecipe(n).keys||[]).some(k=>k.includes(query)))).map(n=>({n,r:getRecipe(n),...safeInventory(getRecipe(n),reserved)}));
 matches=matches.filter(x=>{
  if(timeFilter!=='any'&&x.r.timeEstimate>+timeFilter)return false;
  if(haveFilter==='safe')return x.r.keys.length>0&&x.missing.length===0&&x.protectedKeys.length===0;
  if(haveFilter==='one')return uniq([...x.missing,...x.protectedKeys]).length<=1;
  if(haveFilter==='two')return uniq([...x.missing,...x.protectedKeys]).length<=2;
  return true;
 });
 matches.sort((a,b)=>uniq([...a.missing,...a.protectedKeys]).length-uniq([...b.missing,...b.protectedKeys]).length||b.matched-a.matched||a.r.timeEstimate-b.r.timeEstimate||a.n.localeCompare(b.n));
 return `<div class="page-header"><div class="eyebrow">Anytime recipe finder</div><h2>Use What We Have</h2><p class="sub">Search your kitchen for inspiration. This screen never changes your saved menu or weekly grocery quantities.</p></div>
 <div class="card"><div class="notice success"><b>✓ Protect My Planned Meals is on.</b> Ingredients needed for upcoming breakfasts, lunches, dinners, salad, baking and veggie box are reserved until you confirm you have extra.</div>
 <label class="field">Recipe or ingredient</label><input type="search" id="haveSearch" value="${safe(haveSearch)}" placeholder="Try spinach, beans, potatoes…">
 <div class="fields"><div><label class="field">Ingredient filter</label><select id="haveFilter"><option value="safe" ${haveFilter==='safe'?'selected':''}>Make with what I have now</option><option value="one" ${haveFilter==='one'?'selected':''}>Missing up to 1</option><option value="two" ${haveFilter==='two'?'selected':''}>Missing up to 2</option><option value="all" ${haveFilter==='all'?'selected':''}>Show everything</option></select></div><div><label class="field">Time (estimated)</label><select id="timeFilter">${timeOptions(timeFilter)}</select></div></div>
 <div class="btnrow spaced"><button class="smallbtn secondary" data-go="pantry">Update what's in the pantry</button><button class="smallbtn outline" data-go="grocery">Extras shopping list</button><button class="smallbtn outline" data-go="build">Plan a week using pantry</button></div></div>
 <div class="row between"><h3>${matches.length} recipe ideas</h3><span class="soft">${reserved.size} ingredient types reserved</span></div>
 ${matches.length?`<div class="recipe-grid">${matches.slice(0,65).map(x=>`<button class="recipe-tile" data-recipe="${safe(x.n)}"><b>${safe(x.n)}</b><small>~${x.r.timeEstimate} min estimated · ${safe(x.r.category)}</small><div class="tagline"><span class="pill ${x.missing.length||x.protectedKeys.length?'peach':'green'}">${x.missing.length} missing · ${x.protectedKeys.length} reserved</span></div>${x.protectedKeys.length?`<small>Protect: ${safe(x.protectedKeys.slice(0,3).map(keyLabel).join(', '))}</small>`:''}</button>`).join('')}</div>`:`<div class="notice">No confirmed matches yet. Add pantry items, select “missing up to 1–2,” or check whether some reserved ingredients are actually extra.</div>`}
 <div class="notice warn">Pantry checkmarks track whether an ingredient is present, not exact amounts. A recipe marked “make now” still requires a quick quantity check, particularly after other cooking.</div>`;
}
function renderPantry(){const reserved=reservedKeys();const keys=uniq([...recipeNames.flatMap(n=>getRecipe(n)?.keys||[]),...VEG_OPTIONS.map(x=>x.key),'hummus','cereal','english muffins','jam','cream cheese','fruit']).sort(),matches=keys.filter(k=>k.includes(pantrySearch.toLowerCase()));const stocked=keys.filter(k=>onHand(k).have).length;
 return `<div class="page-header"><div class="eyebrow">Shared household inventory</div><h2>Pantry & fridge check</h2><p class="sub">Update these while reviewing your grocery list. Mark “Extra” only when you have enough beyond this week's planned meals.</p></div>
 <div class="card"><div class="row between"><b>${stocked} ingredients marked on hand</b><button class="smallbtn outline" data-go="have">Find recipes →</button></div><label class="field">Search ingredients</label><input id="pantrySearch" type="search" value="${safe(pantrySearch)}" placeholder="Find a pantry item…"></div>
 <div class="card">${matches.slice(0,150).map(k=>{const p=onHand(k),isRes=reserved.has(k);return `<div class="checkrow"><input aria-label="On hand: ${safe(k)}" type="checkbox" data-pantry-key="${safe(k)}" ${p.have?'checked':''}><div style="flex:1"><b>${safe(keyLabel(k))}</b>${isRes?'<small>Reserved for upcoming planned meals / veggie box</small>':''}</div><label class="row mini"><input type="checkbox" aria-label="Extra quantity for ${safe(k)}" data-extra-key="${safe(k)}" ${p.extra?'checked':''}> Extra</label></div>`;}).join('')}</div>
 <div class="notice">Pantry updates can be done directly from Grocery List after cupboard review and after shopping. Existing pantry items are never cleared automatically. Reconfirm what you have each shopping trip.</div>`;
}
function renderGrocery(){const w=currentWeek(),items=w?.grocery||[];
 const filtered=items.filter(i=>groceryFilter==='all'||(groceryFilter==='done'?i.checked:groceryFilter==='need'?groceryReview(i)!=='have'&&!i.checked:groceryFilter==='review'?groceryReview(i)==='unreviewed':true));
 const sections=uniq(filtered.map(i=>i.section)),done=items.filter(i=>i.checked).length,reviewed=items.filter(i=>groceryReview(i)!=='unreviewed').length,extraDone=state.extras.filter(x=>x.checked).length;
 const warnings=w?groceryWarnings(w.plan):[];
 return `<div class="page-header"><div class="eyebrow">Household shopping</div><h2>Grocery List</h2><p class="sub">${w?safe(w.title)+' · '+niceDate(w.weekStart):'Plan and save a week first'} · Synced with household devices when connected</p></div>
 <div class="card"><div class="cardhead"><h3>1. Check your cupboards</h3><span class="pill">${reviewed}/${items.length} reviewed</span></div>
 <p class="soft">Choose Have enough, Have some, or Need to buy. Nothing changes in the pantry until you tap Update Pantry. Shopping checkboxes are separate.</p>
 ${warnings.length?`<div class="notice warn"><b>${warnings.length} meal details need review:</b><ul>${warnings.slice(0,10).map(x=>`<li>${safe(x)}</li>`).join('')}</ul>${warnings.length>10?'<small>More simple lunches also need choices.</small>':''}<p>To fill them in, tap Edit or swap meals on My Week.</p></div>`:''}
 <div class="chipset"><button class="chip ${groceryFilter==='all'?'on':''}" data-grocery-filter="all">All</button><button class="chip ${groceryFilter==='review'?'on':''}" data-grocery-filter="review">Not reviewed</button><button class="chip ${groceryFilter==='need'?'on':''}" data-grocery-filter="need">Still to buy</button><button class="chip ${groceryFilter==='done'?'on':''}" data-grocery-filter="done">Purchased</button></div>
 ${sections.map(s=>`<div class="section-label">${safe(s)}</div>${filtered.filter(i=>i.section===s).map(i=>`<div class="checkrow grocery-row"><div style="flex:1;min-width:0"><b>${safe(i.name)}</b><small>${safe(i.quantity)}</small>${i.note?`<small>${safe(i.note)}</small>`:''}<small>For: ${safe(i.source)}</small>${i.note?.includes('Carried over from original grocery list')?`<button class="smallbtn outline spaced" data-remove-legacy="${safe(i.id)}">Remove old item</button>`:''}
 <select class="review-select" aria-label="Cupboard status: ${safe(i.name)}" data-grocery-review="${safe(i.id)}"><option value="unreviewed" ${groceryReview(i)==='unreviewed'?'selected':''}>Not reviewed</option><option value="have" ${groceryReview(i)==='have'?'selected':''}>✓ Have enough</option><option value="some" ${groceryReview(i)==='some'?'selected':''}>◐ Have some — check amount</option><option value="buy" ${groceryReview(i)==='buy'?'selected':''}>Need to buy</option></select></div>
 <label class="purchase-check"><input type="checkbox" data-grocery-item="${safe(i.id)}" ${i.checked?'checked':''}> Purchased</label></div>`).join('')}`).join('')}
 ${!items.length?'<p class="notice">No weekly groceries yet. Save a week to generate them.</p>':!filtered.length?'<p class="notice">No groceries in this filter.</p>':''}
 <div class="btnrow spaced"><button class="btn secondary" data-action="updatePantry">✓ Update Pantry (${reviewed} reviewed)</button><button class="smallbtn outline" data-action="refreshGroceries">Recalculate grocery list</button></div>
 <p class="soft">Recalculating adds newly recognized ingredients without replacing meal selections or existing matching checkmarks. Review newly added ingredients before shopping.</p></div>
 <div class="card"><div class="cardhead"><h3>2. After shopping</h3><span class="pill peach">${done}/${items.length} purchased</span></div><p class="small">Tick Purchased beside groceries as you shop. When home, add those purchased items to the pantry with one confirmation.</p><button class="btn secondary" data-action="purchasedToPantry">Add Purchased Items to Pantry</button></div>
 <div class="card"><div class="cardhead"><h3>3. End of week</h3><span class="pill green">Review before clearing</span></div><p class="small">Review ingredients likely used this week and keep any leftovers. No pantry deductions are automatic.</p><button class="btn secondary" data-action="finishWeek">Finish Week & Update Pantry</button></div>
 <div class="card"><div class="cardhead"><h3>Extras / Pick Up Later</h3><span class="pill peach">${extraDone}/${state.extras.length} done</span></div><p class="sub">For spontaneous cooking; these do not change planned groceries.</p>
 ${state.extras.map(x=>`<div class="checkrow"><input type="checkbox" data-extra-check="${safe(x.id)}" ${x.checked?'checked':''}><span style="flex:1" class="${x.checked?'done':''}">${safe(x.name)}</span><button class="smallbtn outline" data-remove-extra="${safe(x.id)}" type="button">Remove</button></div>`).join('')}
 <div class="row spaced"><input id="extraName" type="text" placeholder="Add milk, apples, ingredients…" style="flex:1" value="${safe(extraPicker)}"><button class="smallbtn" data-action="addExtra">Add +</button></div></div>`;
}
function renderRecipes(){const search=recipeSearch.toLowerCase().trim(),cats=['All',...uniq(recipeNames.map(n=>getRecipe(n).category))].sort((a,b)=>a==='All'?-1:b==='All'?1:a.localeCompare(b));
 let results=recipeNames.filter(n=>(browseCategory==='All'||getRecipe(n).category===browseCategory)&&(!search||n.toLowerCase().includes(search)||(getRecipe(n).keys||[]).some(k=>k.includes(search)))).sort((a,b)=>a.localeCompare(b));
 return `<div class="page-header"><div class="eyebrow">Your complete active collection</div><h2>Recipe Browser</h2><p class="sub">${recipeNames.length} recipe cards. Browse by name, ingredient or category. Recipes can be opened without changing the menu.</p></div>
 <div class="card"><label class="field">Search recipes or ingredients</label><input id="recipeSearch" type="search" placeholder="Search your recipe index" value="${safe(recipeSearch)}"><label class="field">Category</label><select id="recipeCategory">${cats.map(c=>`<option ${browseCategory===c?'selected':''}>${safe(c)}</option>`).join('')}</select></div>
 <h3>${results.length} recipes</h3><div class="recipe-grid">${results.map(n=>{const r=getRecipe(n);return `<button class="recipe-tile" data-recipe="${safe(n)}"><b>${safe(n)}</b><small>${safe(r.category)} · ${r.timeIsEstimate?'~':''}${r.timeEstimate} min</small>${!r.cardComplete?'<div><span class="pill peach">Incomplete historical card</span></div>':''}</button>`;}).join('')}</div>`;}
function renderSettings(){return `<div class="page-header"><div class="eyebrow">Household connection</div><h2>Settings & Sync</h2><p class="sub">Your weekly menus and pantry can be stored in a shared Google Sheet using Google Apps Script. Cheffy Classic stays separate.</p></div>
 <div class="card"><h3>Google Sheets household sync</h3><label class="field">Apps Script Web App URL (ends in /exec)</label><input id="scriptUrl" type="text" value="${safe(config.url)}" placeholder="https://script.google.com/macros/s/…/exec"><label class="field">Household access code</label><input id="accessCode" type="password" value="${safe(config.code)}" placeholder="Same code as in your private Code.gs"><div class="btnrow spaced"><button class="btn" data-action="connect">Connect & Test</button><button class="btn secondary" data-action="syncNow">Sync now</button></div><p class="soft">${safe(cloudIssue||(!config.url?'Not yet connected: menus are saved locally on this device.':queue.length+' changes waiting · last successful '+(lastCloud?new Date(lastCloud).toLocaleTimeString():'not yet')))}</p></div>
 <div class="card"><h3>Backup & restore</h3><p class="small">Export a backup of all saved weeks, shopping progress, pantry selections and extras. Importing replaces the data on this device; when connected, you can send restored weeks to the shared Sheet.</p><div class="btnrow"><button class="smallbtn secondary" data-action="export">Export backup</button><button class="smallbtn outline" data-action="import">Import backup</button><input type="file" id="importFile" accept="application/json,.json" class="hide"></div><button class="smallbtn outline spaced" data-action="uploadLocal">Upload saved local weeks to Google Sheets</button></div>
 <div class="notice warn">Security: the household code is stored on your device and included in requests to the Apps Script endpoint. It is suitable for a low-sensitivity family menu app, not private or financial information. Anyone who knows your web app address and code could access the shared data.</div>
 <div class="card"><h3>App details</h3><p class="small">Coastal Kitchen · Cheffy 2.0 · Recipe data bundled for offline viewing. Sync needs internet. Offline edits are queued and retried when connected.</p><button class="smallbtn outline" data-action="retry">Retry pending changes (${queue.length})</button></div>`;}
function showRecipe(name){let r=getRecipe(name);if(!r){showModal(name,`<p class="notice warn">This historical item is not in the active recipe master. It may be a retired recipe in Cheffy Classic.</p>`);return;}
 const res=safeInventory(r,reservedKeys()),blocked=uniq([...res.missing,...res.protectedKeys]);
 const ing=r.ingredients.length?`<ul class="ingredient-list">${r.ingredients.map(i=>`<li>${safe(i)}</li>`).join('')}</ul>`:'<p class="notice warn">Ingredients not yet digitized.</p>';
 const instructions=r.instructions.length?`<ol class="ingredient-list">${r.instructions.map(i=>`<li>${safe(i)}</li>`).join('')}</ol>`:'<p class="notice warn">Full instructions were not available in the master; refer to the original recipe source.</p>';
 const protectedHTML=res.protectedKeys.length?`<div class="notice warn"><b>Reserved for planned meals:</b> ${safe(res.protectedKeys.map(keyLabel).join(', '))}. Don't use these unless you have enough extra. Check actual amounts.</div>`:'';
 const missingHTML=res.missing.length?`<div class="notice"><b>Not marked as on hand:</b> ${safe(res.missing.map(keyLabel).join(', '))}</div>`:'';
 showModal(name,`<div class="tagline"><span class="pill">${safe(r.category)}</span><span class="pill peach">~${r.timeEstimate} min (estimate)</span>${r.yield?`<span class="pill">${safe(r.yield)}</span>`:''}</div>${protectedHTML}${missingHTML}
 <h3>Ingredients</h3>${ing}<h3>Instructions</h3>${instructions}${r.notes?`<p class="sub">${safe(r.notes)}</p>`:''}
 <div class="divider"></div><div class="btnrow"><button class="btn secondary" data-recipe-extra="${safe(name)}">Add missing to Extras list</button><button class="btn outline" data-use-anchor="${safe(name)}">Build a week with this</button><button class="btn outline" data-action="closeModal">Close recipe</button></div>
 <p class="soft">Recipe viewing never changes the planned menu. “Extras” only updates a separate pick-up-later list.</p>`);
}
function showModal(title,body){document.getElementById('modalTitle').textContent=title;document.getElementById('modalBody').innerHTML=body;document.getElementById('modal').classList.remove('hide');currentModal=title;}
function closeModal(){document.getElementById('modal').classList.add('hide');currentModal='';}
function syncPantry(key,patch){const p=onHand(key);commit('setPantry',{key,have:patch.have??p.have,extra:patch.extra??p.extra,notes:p.notes,status:patch.status||(patch.have===false?'missing':patch.have===true?'enough':p.status)});}
function addExtra(name){name=String(name||'').trim();if(!name)return;commit('addExtra',{id:'ex'+Date.now().toString(36)+Math.random().toString(36).slice(2,8),name});}
function reviewToPantry(){const w=currentWeek();if(!w)return toast('Save a week first');const chosen=w.grocery.filter(g=>groceryReview(g)!=='unreviewed');if(!chosen.length)return toast('Review at least one cupboard item first');
 const rows=chosen.map(g=>({key:g.key,have:g.review==='have'||g.review==='some',extra:false,status:g.review==='have'?'enough':g.review==='some'?'some':'missing',notes:g.review==='some'?'Some on hand; amount to check':''}));
 if(!confirm('Update '+rows.length+' pantry ingredients from your cupboard review? Unreviewed groceries will be unchanged.'))return;
 commit('bulkPantry',{items:rows});toast('Pantry updated from your grocery review');render();
}
function purchasedToPantry(){const w=currentWeek();if(!w)return toast('Save a week first');const purchased=w.grocery.filter(g=>g.checked);if(!purchased.length)return toast('Check Purchased beside groceries first');
 if(!confirm('Add '+purchased.length+' purchased items to the pantry? This treats purchased quantities as sufficient for the planned week.'))return;
 commit('bulkPantry',{items:purchased.map(g=>({key:g.key,have:true,extra:false,status:'enough',notes:'Confirmed after shopping'}))});toast('Purchased groceries added to pantry');render();
}
function showFinishWeek(){const w=currentWeek();if(!w)return toast('Save a week first');
 const keys=[...plannedIngredientKeys(w.plan)].filter(k=>!k.startsWith('recipe check:')).sort();weekEndDraft={};
 const rows=keys.map(k=>{const p=onHand(k),defaultChoice=STAPLE_KEYS.has(k)?'keep':'used';weekEndDraft[k]=defaultChoice;
 return `<div class="finish-row"><b>${safe(keyLabel(k))}</b><small>${STAPLE_KEYS.has(k)?'Staple — suggest keeping if still there':'Perishable or meal ingredient — suggest used, check leftovers'}</small><select data-end-status="${safe(k)}" aria-label="Remaining ${safe(k)}"><option value="used" ${defaultChoice==='used'?'selected':''}>Used up</option><option value="some">Some left / amount uncertain</option><option value="keep" ${defaultChoice==='keep'?'selected':''}>Still available</option><option value="skip">Skip — don't change</option></select></div>`;}).join('');
 showModal('Finish Week & Update Pantry',`<p class="notice warn">These are suggestions based on the menu, not measured consumption. Change any selection before applying. Nothing is removed until you confirm.</p><div class="finish-scroll">${rows}</div><div class="btnrow spaced"><button class="btn" data-action="confirmFinish">Apply confirmed changes</button><button class="btn outline" data-action="closeModal">Cancel</button></div>`);
}
function applyFinishWeek(){const w=currentWeek();if(!w)return;const chosen=Object.entries(weekEndDraft).filter(([k,v])=>v!=='skip');if(!chosen.length)return toast('No ingredients selected');
 if(!confirm('Finish this week and update '+chosen.length+' pantry entries? Your saved menu and grocery checkmarks will remain.'))return;
 const items=chosen.map(([key,val])=>({key,have:val!=='used',extra:false,status:val==='used'?'missing':val==='some'?'some':'enough',notes:val==='some'?'Some remains; reconfirm next shop':val==='keep'?'Confirmed at week end':''}));
 commit('finishWeek',{weekId:w.id,finishedAt:new Date().toISOString(),items});closeModal();toast('Week finished; pantry reviewed');render();
}
function refreshGroceries(){const w=currentWeek();if(!w)return toast('Save a week first');
 if(!confirm('Recalculate ingredients for this saved week? Your selected meals stay unchanged. Existing matching shopping checkmarks and cupboard reviews are preserved.'))return;
 commit('refreshGrocery',{weekId:w.id,grocery:aggregateGrocery(w.plan)});toast('Grocery list recalculated; review new items');render();
}
function writeBlob(filename,obj){const b=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),4000);}
function handleAction(action,button){const w=currentWeek();
 if(action==='propose')propose();
 else if(action==='updatePantry')reviewToPantry();
 else if(action==='purchasedToPantry')purchasedToPantry();
 else if(action==='finishWeek')showFinishWeek();
 else if(action==='confirmFinish')applyFinishWeek();
 else if(action==='refreshGroceries')refreshGroceries();
 else if(action==='emptyDraft'){weekDraft=makeBasePlan();shuffleBox(weekDraft);render();}
 else if(action==='shuffleBox'){if(weekDraft){shuffleBox(weekDraft);render();}}
 else if(action==='editWeek'){if(!w)return;weekDraft=structuredClone(w.plan);draftDate=w.weekStart;choose('build');}
 else if(action==='saveDraft'){
  if(!weekDraft)return toast('Please build a menu first');
  const start=monday(draftDate||todayDate()),id=start;
  if(!weekDraft.days.every((d,i)=>d.dinner&&(i===2||i===5||getRecipe(d.dinner))))return toast('Select all five flexible dinners before saving');
  if(state.weeks.some(x=>x.id===id)&&!confirm('Replace the saved menu and recalculate groceries for this week? Checked items with the same name will stay checked.'))return;
  const g=aggregateGrocery(weekDraft),neww={id,weekStart:start,title:'Week of '+niceDate(start),plan:structuredClone(weekDraft),grocery:g,updatedAt:new Date().toISOString()};
  commit('saveWeek',{week:neww,setCurrent:true});toast('Your week and groceries are saved!');weekDraft=null;choose('week');
 }else if(action==='deleteWeek'){
  if(w&&confirm('Delete this saved week from the household? This cannot be undone.')){commit('deleteWeek',{id:w.id});choose('week');}
 }else if(action==='addExtra'){
  const value=document.getElementById('extraName')?.value||'';if(value.trim()){addExtra(value);extraPicker='';render();toast('Added to Extras list');}
 }else if(action==='closeModal')closeModal();
 else if(action==='connect')connectHousehold();
 else if(action==='syncNow'||action==='retry') {if(queue.length)processQueue();else reloadRemote(true);toast('Checking household connection');}
 else if(action==='export')writeBlob('Cheffy_2_Backup_'+todayDate()+'.json',{cheffy:2,state,exportedAt:new Date().toISOString()});
 else if(action==='import')document.getElementById('importFile')?.click();
 else if(action==='uploadLocal')uploadLocalWeeks();
}
async function connectHousehold(){let url=syncUrl(document.getElementById('scriptUrl')?.value.trim()),code=document.getElementById('accessCode')?.value.trim();if(!url||!code)return toast('Enter an /exec URL and household access code');
 config={url,code};localStorage.setItem(CONFIG,JSON.stringify(config));try{
  let response=await jsonp('snapshot');const remote=response.state;
  if(!remote.weeks.length&&state.weeks.length){if(confirm('The shared Sheet is empty. Upload the weeks saved on this phone?')){
    const local=structuredClone(state);state=remote;persist();local.weeks.forEach(w=>commit('saveWeek',{week:w,setCurrent:w.id===local.currentWeekId}));
    local.pantry.forEach(p=>commit('setPantry',p));local.extras.forEach(x=>{commit('addExtra',x);if(x.checked)commit('checkExtra',{id:x.id,checked:true});});
    await processQueue();}
   else{state=remote;reconcileCurrentWeek();persist();}
  }else{state=remote;reconcileCurrentWeek();persist();}
  cloudIssue='';toast('Household Sheet connected');render();
 }catch(e){cloudIssue=e.message;toast('Connection failed: '+e.message);updateSync();}
}
async function uploadLocalWeeks(){if(!config.url||!config.code)return toast('Connect to your shared Sheet first');if(!confirm('Upload the weeks currently saved on this device? A week with the same Monday date in Google Sheets will be replaced.'))return;
 const weeks=structuredClone(state.weeks);for(const w of weeks)commit('saveWeek',{week:w,setCurrent:w.id===state.currentWeekId});toast(weeks.length+' weeks queued for upload');}
function eventHandler(e){const btn=e.target.closest('[data-remove-legacy],[data-go],[data-action],[data-recipe],[data-recipe-extra],[data-use-anchor],[data-remove-extra],[data-close-modal],[data-grocery-filter]');if(!btn)return;
 if(btn.dataset.go){choose(btn.dataset.go);return;}if(btn.dataset.groceryFilter){groceryFilter=btn.dataset.groceryFilter;render();return;}if(btn.dataset.useAnchor){anchor1=btn.dataset.useAnchor;anchor2='';weekDraft=null;closeModal();choose('build');propose();return;}if(btn.dataset.recipe){showRecipe(btn.dataset.recipe);return;}
 if(btn.dataset.recipeExtra){const r=getRecipe(btn.dataset.recipeExtra);if(!r)return;
  const v=safeInventory(r,reservedKeys()),names=uniq([...v.missing,...v.protectedKeys]).map(keyLabel);
  if(!names.length)return toast('All ingredient types are already listed as available; check quantities before cooking');
  if(confirm('Add these to Extras / Pick Up Later?\n'+names.join(', ')+'\nThis will NOT change the weekly shopping plan.')){names.forEach(addExtra);toast('Added '+names.length+' items to Extras');}
  return;
 }
 if(btn.dataset.removeLegacy){const w=currentWeek();if(w&&confirm('Remove this carried-over grocery item? It will not change your planned meals.')){commit('removeGrocery',{weekId:w.id,itemId:btn.dataset.removeLegacy});render();}return;}
 if(btn.dataset.removeExtra){commit('removeExtra',{id:btn.dataset.removeExtra});render();return;}
 if(btn.dataset.closeModal){closeModal();return;}
 if(btn.dataset.action){handleAction(btn.dataset.action,btn);return;}
}
function changeHandler(e){const t=e.target;
 if(t.id==='pickWeek'){commit('setCurrent',{id:t.value});render();}
 else if(t.id==='anchor1'){anchor1=t.value;if(anchor1===anchor2)anchor2='';render();}
 else if(t.id==='anchor2')anchor2=t.value;
 else if(t.id==='draftDate')draftDate=monday(t.value);
 else if(t.id==='classicSelect'){if(t.value)fromClassic(t.value);}
 else if(t.dataset.draftDay!==undefined&&weekDraft){weekDraft.days[Number(t.dataset.draftDay)][t.dataset.draftMeal]=t.value;if(weekDraft.days[Number(t.dataset.draftDay)].sides)delete weekDraft.days[Number(t.dataset.draftDay)].sides[t.dataset.draftMeal];render();}
 else if(t.dataset.draftSpecial&&weekDraft){weekDraft[t.dataset.draftSpecial]=t.value;render();}
 else if(t.dataset.prepId){const w=currentWeek();if(w){commit('prepToggle',{weekId:w.id,itemId:t.dataset.prepId,checked:t.checked});render();}}
 else if(t.dataset.groceryItem){const w=currentWeek();if(!w)return;let item=w.grocery.find(x=>x.id===t.dataset.groceryItem);commit('checkGrocery',{weekId:w.id,itemId:t.dataset.groceryItem,checked:t.checked});render();}
 else if(t.dataset.groceryReview){const w=currentWeek();if(w)commit('reviewGrocery',{weekId:w.id,itemId:t.dataset.groceryReview,review:t.value});render();}
 else if(t.id==='simpleServings'&&weekDraft){weekDraft.simpleServings=Number(t.value)||3;render();}
 else if(t.dataset.draftSpread!==undefined&&weekDraft){weekDraft.breakfastSpreads=weekDraft.breakfastSpreads||{};weekDraft.breakfastSpreads[t.dataset.draftSpread]=t.value;render();}
 else if(t.dataset.draftLunch!==undefined&&weekDraft){weekDraft.lunchModes=weekDraft.lunchModes||{};weekDraft.lunchModes[t.dataset.draftLunch]=t.value;render();}
 else if(t.dataset.draftPizza&&weekDraft){weekDraft.pizzaToppings=weekDraft.pizzaToppings||[];weekDraft.pizzaToppings=t.checked?uniq([...weekDraft.pizzaToppings,t.value]):weekDraft.pizzaToppings.filter(x=>x!==t.value);render();}
 else if(t.dataset.endStatus){weekEndDraft[t.dataset.endStatus]=t.value;}
 else if(t.dataset.extraCheck){commit('checkExtra',{id:t.dataset.extraCheck,checked:t.checked});render();}
 else if(t.dataset.pantryKey){syncPantry(t.dataset.pantryKey,{have:t.checked,extra:t.checked?onHand(t.dataset.pantryKey).extra:false});render();}
 else if(t.dataset.extraKey){syncPantry(t.dataset.extraKey,{extra:t.checked,have:t.checked?true:onHand(t.dataset.extraKey).have});render();}
 else if(t.id==='haveFilter'){haveFilter=t.value;render();}
 else if(t.id==='timeFilter'){timeFilter=t.value;render();}
 else if(t.id==='recipeCategory'){browseCategory=t.value;render();}
 else if(t.id==='importFile')importFile(t.files?.[0]);
}
function inputHandler(e){const t=e.target;if(t.id==='haveSearch'){let pos=t.selectionStart;haveSearch=t.value;render();let field=document.getElementById('haveSearch');field.focus();field.setSelectionRange(pos,pos);}
 if(t.id==='recipeSearch'){let pos=t.selectionStart;recipeSearch=t.value;render();let field=document.getElementById('recipeSearch');field.focus();field.setSelectionRange(pos,pos);}
 if(t.id==='pantrySearch'){let pos=t.selectionStart;pantrySearch=t.value;render();let field=document.getElementById('pantrySearch');field.focus();field.setSelectionRange(pos,pos);}
 if(t.id==='extraName')extraPicker=t.value;
}
async function importFile(file){if(!file)return;try{let obj=JSON.parse(await file.text());if(obj.cheffy!==2||!obj.state||!Array.isArray(obj.state.weeks))throw Error('Not a valid Cheffy 2.0 backup');if(!confirm('Replace your local saved weeks, pantry and extras with this backup?'))return;state=obj.state;reconcileCurrentWeek();persist();toast('Backup imported on this device');render();}catch(e){toast('Import failed: '+e.message);}}
async function init(){try{
 const response=await fetch('catalog.json');if(!response.ok)throw Error('Recipe catalogue unavailable');catalog=await response.json();recipeNames=Object.keys(catalog.recipes);
 // Fix broad auto-generated ingredient labels that would create false reservations and shopping duplicates.
 for(const r of Object.values(catalog.recipes)){r.keys=(r.keys||[]).filter(k=>r.ingredients.some(s=>matchingLine(k,s)));}
 draftDate=monday(todayDate());document.addEventListener('click',eventHandler);document.addEventListener('change',changeHandler);document.addEventListener('input',inputHandler);
 document.getElementById('closeModal').onclick=closeModal;document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
 render();if('serviceWorker'in navigator)navigator.serviceWorker.register('./service-worker.js').catch(console.warn);
 if(config.url&&config.code){if(queue.length)processQueue();else reloadRemote(true);}
 setInterval(()=>{if(config.url&&config.code&&navigator.onLine){if(queue.length)processQueue();else if(document.visibilityState==='visible')reloadRemote();}},30000);
 window.addEventListener('online',()=>{if(queue.length)processQueue();else reloadRemote(true);});
 // Exposed solely for developer smoke tests, not a network interface.
 window.__cheffyTest={catalog,state:()=>state,propose,aggregateGrocery,reservedKeys,makeBasePlan,commit,save:()=>persist()};
 }catch(err){console.error(err);main.innerHTML=`<div class="notice danger">Could not load the Cheffy recipe collection. Please reload while online the first time. ${safe(err.message)}</div>`;}}
init();
