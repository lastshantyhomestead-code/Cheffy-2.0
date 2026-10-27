'use strict';
/* Cheffy 2.0: self-contained recipe matching and planning, with optional household sync. */
const STORAGE='cheffy2_coastal_state_v1', CONFIG='cheffy2_household_sync_v1', QUEUE='cheffy2_pending_v1';
const DAY=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const BREAKFAST=['Cereal + Milk','Toast + Peanut Butter / Jam','Oatmeal + Fruit','Cereal + Milk','English Muffin + Spread','Pancakes','Oatmeal + Fruit'];
const LUNCH=['Simple Lunch / Leftovers','Simple Lunch / Leftovers','Simple Lunch / Leftovers','Simple Lunch / Leftovers','Simple Lunch / Leftovers','Chickpea Salad Sandwiches','Simple Lunch / Leftovers'];
const PREP_STAPLES=['cereal','milk','fruit','bread','oats'];
const BOX=[{key:'cucumbers',name:'Cucumbers',amount:'2 whole',min:2,unit:'whole'},{key:'red peppers',name:'Sweet bell peppers',amount:'3 whole',min:3,unit:'whole'},{key:'carrots',name:'Baby carrots',amount:'1 small bag',min:1,unit:'bag'},{key:'snap peas',name:'Snap peas (optional)',amount:'1 small bag',min:1,unit:'bag',optional:true},{key:'hummus',name:'Hummus',amount:'1 tub',min:1,unit:'tub'}];
const PRODUCE=new Set(['cucumbers','red peppers','carrots','snap peas','celery','kale','spinach','lettuce','broccoli','zucchini','tomatoes','cabbage','potatoes','sweet potatoes','onions','green onions','avocado','lemons','limes','apples','bananas','peas','corn','butternut squash','garlic']);
const PANTRY_DEFAULT=new Set(['tomato sauce','olive oil','salt','pepper spice','flour','rice','pasta','oats','sugar','vinegar','cumin','paprika','cinnamon','baking powder','baking soda','garlic','chili powder']);
const CAT_DINNER=new Set(['Main Dishes','Soups & Stews','Lunch / Simple Meals','Dinner']);
let catalog={recipes:{},rotations:{}},recipeNames=[],activePage='week',state=load(STORAGE,{version:2,revision:0,weeks:[],currentWeekId:'',pantry:[],extras:[]});
let config=load(CONFIG,{url:'',code:''}),queue=load(QUEUE,[]),processing=false,lastCloud=0,cloudIssue='',weekDraft=null,anchor1='',anchor2='',draftDate='',recipeSearch='',haveSearch='',pantrySearch='',haveFilter='safe',timeFilter='any',extraPicker='',editDetail=false,browseCategory='All',groceryFilter='all',currentModal='';
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
function onHand(key){return state.pantry.find(x=>x.key===key)||{key,have:PANTRY_DEFAULT.has(key),extra:false,notes:''};}
function currentWeek(){return state.weeks.find(w=>w.id===state.currentWeekId)||null;}
function stateApply(op){const p=op.payload||{};
 if(op.action==='saveWeek'){
  const old=state.weeks.find(w=>w.id===p.week.id);
  let copy=structuredClone(p.week);
  if(old){const check=new Map(old.grocery.map(x=>[x.id,x.checked]));copy.grocery.forEach(g=>{if(check.has(g.id))g.checked=check.get(g.id);});}
  state.weeks=state.weeks.filter(w=>w.id!==copy.id).concat(copy).sort((a,b)=>a.weekStart.localeCompare(b.weekStart));
  if(p.setCurrent!==false)state.currentWeekId=copy.id;
 }else if(op.action==='checkGrocery'){
  const w=state.weeks.find(w=>w.id===p.weekId),g=w?.grocery?.find(x=>x.id===p.itemId);if(g)g.checked=!!p.checked;
 }else if(op.action==='prepToggle'){
  const w=state.weeks.find(w=>w.id===p.weekId);if(w){w.plan.prepDone=w.plan.prepDone||{};w.plan.prepDone[p.itemId]=!!p.checked;}
 }else if(op.action==='setPantry'){
  state.pantry=state.pantry.filter(x=>x.key!==p.key).concat({key:p.key,have:!!p.have,extra:!!p.extra,notes:p.notes||''});
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
 state=out.state;persist();lastCloud=Date.now();cloudIssue='';render();updateSync();
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
 <section class="card veggie"><div class="cardhead"><h3>🥕 Weekly Veggie Box</h3><span class="pill green">Snack prep</span></div><p class="small">Wash and cut cucumbers, peppers and carrots; add optional snap peas and hummus. Refill the box midweek as needed.</p><p class="soft">Snack portions are included alongside dinner needs in one consolidated grocery line per ingredient.</p></section>
 <div class="cardhead"><h3>Your daily meals</h3><button class="smallbtn secondary" data-go="grocery">Grocery list →</button></div>
 <div class="days">${p.days.map((d,i)=>`<article class="day-card"><div class="day-top"><span>${DAY[i]}</span><small>${niceDate(plusDays(w.weekStart,i))}</small></div><div class="meals">${['breakfast','lunch','dinner'].map(meal=>`<div class="meal ${meal}"><span class="meal-label">${meal}</span><div class="meal-links">${mealLinks(d,meal)}</div></div>`).join('')}</div></article>`).join('')}</div>
 <div class="card"><div class="row between"><b>Weekly salad</b><button class="text-link" data-recipe="${safe(p.salad)}">${safe(p.salad)}</button></div><div class="row between"><b>Weekly baking</b><button class="text-link" data-recipe="${safe(p.bake)}">${safe(p.bake)}</button></div></div>`;
}
function mealLinks(d,meal){const refs=[d[meal],...(d.sides?.[meal]||[])].filter(Boolean);if(!refs.length)return '<span>Not planned</span>';return refs.map((name,i)=>`<button class="meal-name" data-recipe="${safe(name)}">${i?'+ ':''}${safe(name)}</button>`).join('');}
function prepItems(p){const a=[{id:'vegbox',text:'Prepare veggie snack box: wash and cut cucumber, peppers, carrots; add hummus. Refill midweek.'},{id:'salad',text:'Prepare weekly salad: '+(p.salad||'select a salad')},{id:'bake',text:'Make weekly baked snack: '+(p.bake||'select a snack')},{id:'pizza',text:'Check Wednesday pizza dough ingredients and homemade red sauce'}];
 if(p.advancePrep)a.push({id:'advance',text:p.advancePrep});
 const recipeKeys=uniq(p.days.flatMap(d=>[d.dinner,...(d.sides?.dinner||[])].flatMap(n=>getRecipe(n)?.keys||[])));
 if(recipeKeys.includes('rice'))a.push({id:'rice',text:'Cook a batch of rice for the meals using rice'});
 if(recipeKeys.includes('black beans')||recipeKeys.includes('chickpeas'))a.push({id:'beans',text:'Drain or prepare beans/chickpeas for multiple recipes'});
 if(recipeKeys.includes('carrots')||recipeKeys.includes('red peppers')||recipeKeys.includes('onions'))a.push({id:'chop',text:'Prep shared vegetables for dinners as practical'});
 return a;}
function recipeOptions(names,selected,blank='Select a meal…'){return `<option value="">${safe(blank)}</option>`+names.map(n=>`<option value="${safe(n)}" ${n===selected?'selected':''}>${safe(n)}</option>`).join('');}
function makeBasePlan(){return {days:DAY.map((day,i)=>({day,breakfast:BREAKFAST[i],lunch:LUNCH[i],dinner:i===2?'Homemade Pizza':i===5?'Leftovers':''})),salad:salads()[0]||'',bake:bakes()[0]||'',prepDone:{},veggieBox:true,advancePrep:''};}
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
 weekDraft=p;toast('Proposed a week using shared ingredients');render();}
function fromClassic(value){const [r,index]=value.split('|');const source=catalog.rotations[r]?.weeks?.[Number(index)];if(!source)return;
 const plan=makeBasePlan();plan.days=source.days.map((d,i)=>{const refs=meal=>d.meals[meal]?.refs?.filter(Boolean)||[];
 const first=meal=>refs(meal)[0]||d.meals[meal]?.label||({breakfast:BREAKFAST[i],lunch:LUNCH[i],dinner:'Leftovers'}[meal]);
 const sides={};['breakfast','lunch','dinner'].forEach(meal=>{if(refs(meal).length>1)sides[meal]=refs(meal).slice(1);});
 return {day:DAY[i],breakfast:first('breakfast'),lunch:first('lunch'),dinner:first('dinner'),sides};});
 plan.salad=source.salad||salads()[Number(index)%salads().length];plan.bake=source.bake||bakes()[Number(index)%bakes().length];plan.advancePrep=source.prepNote||'';
 weekDraft=plan;toast('Loaded Classic '+r+' Week '+(Number(index)+1)+' as an editable draft');render();}
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
 <details class="spaced"><summary><b>Optional: customize breakfasts and lunches</b></summary>${p.days.map((day,i)=>`<div class="fields"><div><label class="field">${DAY[i]} breakfast</label><select data-draft-day="${i}" data-draft-meal="breakfast">${recipeOptions(sortedNames(r=>r.category==='Breakfast'),day.breakfast)}</select></div><div><label class="field">${DAY[i]} lunch</label><select data-draft-day="${i}" data-draft-meal="lunch">${recipeOptions(sortedNames(r=>r.category==='Lunch / Simple Meals'||r.category==='Lunch'),day.lunch)}</select></div></div>`).join('')}</details>
 ${draftSummary(p)}<section class="veggie card"><div class="cardhead"><h3>🥕 Weekly Veggie Box</h3><span class="pill green">Included automatically</span></div><p class="small">2 cucumbers · 3 peppers · 1 small bag baby carrots · optional snap peas · 1 tub hummus. Included with dinner ingredients on one grocery line; confirm family portions.</p></section>
 <div class="btnrow"><button class="btn block" data-action="saveDraft">Save My Week & Generate Groceries</button></div></div>`:`<div class="notice">Choose anchor meals and tap “Suggest a Week,” or start with a Classic rotation. Your current saved week won't change until you tap Save.</div>`}`;
}
function selectFirstQuantity(txt){let x=String(txt).trim().replace(/[¼]/g,'1/4').replace(/[½]/g,'1/2').replace(/[¾]/g,'3/4');
 const m=x.match(/^(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)/);
 if(!m)return null;const n=m[1].split(/\s+/).reduce((sum,part)=>{let [a,b]=part.split('/');return sum+(b?+a/+b:+a);},0);
 const tail=x.slice(m[0].length).trim();const um=tail.match(/^(cups?|tbsp|tablespoons?|tsp|teaspoons?|grams?|g|kg|oz|lbs?|cans?|bunch(?:es)?|packs?|packets?|bags?|tubs?|slices?|cloves?|whole|medium|small|large|wraps?|buns?|potatoes?|onions?|peppers?|cucumbers?|carrots?|apples?)/i);
 let unit=um?um[1].toLowerCase().replace(/s$/,''):'whole';unit={'tablespoon':'tbsp','teaspoon':'tsp','gram':'g','can':'can','bunches':'bunch','packet':'packet','wrap':'wrap','bun':'bun','potatoe':'whole','onion':'whole','pepper':'whole','cucumber':'whole','carrot':'whole','apple':'whole','medium':'whole','small':'whole','large':'whole'}[unit]||unit;
 return {n,unit};}
// Correct common broad-regex false matches from imported hand-written recipe cards.
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
function grocerySection(key){if(PRODUCE.has(key)||key==='snap peas')return 'Produce';if(['cheese','milk','eggs','yogurt','butter','sour cream','hummus','tofu'].includes(key))return 'Refrigerated';if(['kaiser buns','bread','whole wheat wraps','pie crust'].includes(key))return 'Bread & Wraps';if(['chicken','tuna','gnocchi','peas','corn'].includes(key))return 'Protein / Frozen';return 'Pantry & Baking';}
function aggregateGrocery(plan){const map=new Map();
 function add(key,source,line,isBox=false){if(!key)return;let obj=map.get(key);if(!obj){obj={id:'item-'+slug(key),key,name:keyLabel(key),quantity:'',section:grocerySection(key),source:[],raw:[],checked:false,note:''};map.set(key,obj);}if(!obj.source.includes(source))obj.source.push(source);if(line)obj.raw.push({line,source,isBox});}
 const dinnerMeals=plan.days.flatMap(d=>[d.dinner,...(d.sides?.dinner||[])]).filter(n=>n&&n!=='Leftovers');let recipes=uniq([...dinnerMeals,plan.salad,plan.bake,...plan.days.flatMap(d=>[d.breakfast,...(d.sides?.breakfast||[])]),...plan.days.flatMap(d=>[d.lunch,...(d.sides?.lunch||[])]).filter(n=>n!=='Simple Lunch / Leftovers')]);
 // Non-repeat recipe names are counted once; intentionally reused dinners are counted for every scheduled occurrence.
 const counts={};[...dinnerMeals,plan.salad,plan.bake].forEach(n=>counts[n]=(counts[n]||0)+1);
 for(const name of recipes){const r=getRecipe(name);if(!r)continue;
  const repeat=Math.max(1,counts[name]||1);
  for(const line of r.ingredients){if(!line||/^(DOUGH|TOPPINGS|FILLING|SAUCE|OPTIONAL):?$/i.test(line.trim()))continue;
   for(const key of r.keys||[]){if(matchingLine(key,line)){for(let i=0;i<repeat;i++)add(key,name,line);}}
  }
 }
 // A small standing breakfast / snack checklist does not add duplicates when ingredients were also in recipes.
 for(const [k,label] of [['cereal','Weekday breakfasts'],['milk','Weekday breakfasts'],['bananas','Fruit for breakfasts/snacks'],['oats','Weekday breakfasts'],['bread','Weekday breakfasts']]) add(k,label,'Check weekly use');
 // Veggie box snack portions are added to recipe amounts, while each ingredient appears once.
 BOX.forEach(v=>add(v.key,'Veggie box',v.amount,true));
 return [...map.values()].map(x=>{
  const box=BOX.find(z=>z.key===x.key),recipeRows=x.raw.filter(r=>!r.isBox),q={};let unspecified=0;
  for(const obj of recipeRows){const n=selectFirstQuantity(obj.line);if(n){q[n.unit]=(q[n.unit]||0)+n.n;}else unspecified++;}
  let chunks=Object.entries(q).map(([unit,n])=>`${Math.round(n*10)/10} ${unit}${n>1&&unit!=='g'&&unit!=='kg'?'s':''}`);
  if(box){let matched=(q[box.unit]||0);const target=matched+box.min;const others=chunks.filter(z=>!z.endsWith(' '+box.unit)&&!z.endsWith(' '+box.unit+'s'));
   chunks=[`at least ${target} ${box.unit}${target>1?'s':''}`,...others];
   x.note=`Veggie box included (${box.amount}). ${matched>0?'Dedicated snack portions added to meal amounts; adjust for your household.':'Weekly snack minimum.'}${box.optional?' Optional item.':''}`;
  }
  if(unspecified)chunks.push('check unmeasured recipe amounts');
  x.quantity=chunks.length?chunks.join(' + '):'Check recipe / usual stock';
  x.source=x.source.slice(0,5).join(' · ');delete x.raw;
  return x;
 }).sort((a,b)=>a.section.localeCompare(b.section)||a.name.localeCompare(b.name));}
function reservedKeys(){const w=currentWeek();if(!w||!w.plan||!w.weekStart)return new Set();const t=todayDate(),end=plusDays(w.weekStart,6);if(t>end)return new Set();const a=[];
 w.plan.days.forEach((d,i)=>{if(plusDays(w.weekStart,i)>=t) a.push(d.dinner);});
 if(w.plan.salad)a.push(w.plan.salad);if(w.plan.bake)a.push(w.plan.bake);
 w.plan.days.forEach((d,i)=>{if(plusDays(w.weekStart,i)>=t)(d.sides?.dinner||[]).forEach(n=>a.push(n));});
 const keys=new Set(uniq(a).flatMap(n=>getRecipe(n)?.keys||[]));BOX.forEach(x=>keys.add(x.key));return keys;}
function safeInventory(recipe,reserved){const keys=recipe.keys||[],missing=keys.filter(k=>!onHand(k).have),protectedKeys=keys.filter(k=>reserved.has(k)&&!onHand(k).extra);return {missing,protectedKeys,matched:keys.length-missing.length,available:keys.length-missing.length-protectedKeys.filter(k=>!missing.includes(k)).length};}
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
 <div class="card"><div class="notice success"><b>✓ Protect My Planned Meals is on.</b> Ingredients needed for upcoming dinners, salad and veggie box are reserved until you confirm you have extra.</div>
 <label class="field">Recipe or ingredient</label><input type="search" id="haveSearch" value="${safe(haveSearch)}" placeholder="Try spinach, beans, potatoes…">
 <div class="fields"><div><label class="field">Ingredient filter</label><select id="haveFilter"><option value="safe" ${haveFilter==='safe'?'selected':''}>Make with what I have now</option><option value="one" ${haveFilter==='one'?'selected':''}>Missing up to 1</option><option value="two" ${haveFilter==='two'?'selected':''}>Missing up to 2</option><option value="all" ${haveFilter==='all'?'selected':''}>Show everything</option></select></div><div><label class="field">Time (estimated)</label><select id="timeFilter">${timeOptions(timeFilter)}</select></div></div>
 <div class="btnrow spaced"><button class="smallbtn secondary" data-go="pantry">Update what's in the pantry</button><button class="smallbtn outline" data-go="grocery">Extras shopping list</button><button class="smallbtn outline" data-go="build">Plan a week using pantry</button></div></div>
 <div class="row between"><h3>${matches.length} recipe ideas</h3><span class="soft">${reserved.size} ingredient types reserved</span></div>
 ${matches.length?`<div class="recipe-grid">${matches.slice(0,65).map(x=>`<button class="recipe-tile" data-recipe="${safe(x.n)}"><b>${safe(x.n)}</b><small>~${x.r.timeEstimate} min estimated · ${safe(x.r.category)}</small><div class="tagline"><span class="pill ${x.missing.length||x.protectedKeys.length?'peach':'green'}">${x.missing.length} missing · ${x.protectedKeys.length} reserved</span></div>${x.protectedKeys.length?`<small>Protect: ${safe(x.protectedKeys.slice(0,3).map(keyLabel).join(', '))}</small>`:''}</button>`).join('')}</div>`:`<div class="notice">No confirmed matches yet. Add pantry items, select “missing up to 1–2,” or check whether some reserved ingredients are actually extra.</div>`}
 <div class="notice warn">Pantry checkmarks track whether an ingredient is present, not exact amounts. A recipe marked “make now” still requires a quick quantity check, particularly after other cooking.</div>`;
}
function renderPantry(){const reserved=reservedKeys();const keys=uniq([...recipeNames.flatMap(n=>getRecipe(n)?.keys||[]),...BOX.map(x=>x.key),'cereal','fruit']).sort(),matches=keys.filter(k=>k.includes(pantrySearch.toLowerCase()));const stocked=keys.filter(k=>onHand(k).have).length;
 return `<div class="page-header"><div class="eyebrow">Shared household inventory</div><h2>Pantry & fridge check</h2><p class="sub">Update these while reviewing your grocery list. Mark “Extra” only when you have enough beyond this week's planned meals.</p></div>
 <div class="card"><div class="row between"><b>${stocked} ingredients marked on hand</b><button class="smallbtn outline" data-go="have">Find recipes →</button></div><label class="field">Search ingredients</label><input id="pantrySearch" type="search" value="${safe(pantrySearch)}" placeholder="Find a pantry item…"></div>
 <div class="card">${matches.slice(0,150).map(k=>{const p=onHand(k),isRes=reserved.has(k);return `<div class="checkrow"><input aria-label="On hand: ${safe(k)}" type="checkbox" data-pantry-key="${safe(k)}" ${p.have?'checked':''}><div style="flex:1"><b>${safe(keyLabel(k))}</b>${isRes?'<small>Reserved for upcoming planned meals / veggie box</small>':''}</div><label class="row mini"><input type="checkbox" aria-label="Extra quantity for ${safe(k)}" data-extra-key="${safe(k)}" ${p.extra?'checked':''}> Extra</label></div>`;}).join('')}</div>
 <div class="notice">Checking off purchased groceries also marks their ingredient as on hand. Cheffy doesn't infer that you still have extra after cooking—use the Extra checkbox for that.</div>`;
}
function renderGrocery(){const w=currentWeek(),items=w?.grocery||[],filtered=items.filter(i=>groceryFilter==='all'||(groceryFilter==='done'?i.checked:!i.checked&&!onHand(i.key).have)),sections=uniq(filtered.map(i=>i.section)),done=items.filter(i=>i.checked).length,extraDone=state.extras.filter(x=>x.checked).length;
 return `<div class="page-header"><div class="eyebrow">Household shopping</div><h2>Grocery List</h2><p class="sub">${w?safe(w.title)+' · '+niceDate(w.weekStart):'Plan and save a week first'} · Synced with household devices when connected</p></div>
 <div class="card"><div class="cardhead"><h3>Weekly groceries</h3><span class="pill">${done}/${items.length} checked</span></div><p class="soft">Quantities are consolidated planning estimates from recipe cards. Confirm packages and servings before shopping. Veggie box snack portions are added to dinner needs; each ingredient appears only once.</p><div class="chipset"><button class="chip ${groceryFilter==='all'?'on':''}" data-grocery-filter="all">All</button><button class="chip ${groceryFilter==='need'?'on':''}" data-grocery-filter="need">To buy (not on hand)</button><button class="chip ${groceryFilter==='done'?'on':''}" data-grocery-filter="done">Checked</button></div>
 ${sections.map(s=>`<div class="section-label">${safe(s)}</div>${filtered.filter(i=>i.section===s).map(i=>`<label class="checkrow"><input type="checkbox" data-grocery-item="${safe(i.id)}" ${i.checked?'checked':''}><span style="flex:1" class="${i.checked?'done':''}"><b>${safe(i.name)}</b><small>${safe(i.quantity)} ${onHand(i.key).have?'· <span style="color:#3d746b">Pantry on hand</span>':''}</small>${i.note?`<small>${safe(i.note)}</small>`:''}<small>For: ${safe(i.source)}</small></span></label>`).join('')}`).join('')}
 ${!items.length?'<p class="notice">No weekly groceries yet. Save a week to generate them.</p>':!filtered.length?'<p class="notice">Nothing in this filter. Select All to review the complete grocery list.</p>':''}
 <div class="btnrow spaced"><button class="smallbtn secondary" data-go="pantry">✓ Check the pantry</button></div></div>
 <div class="card"><div class="cardhead"><h3>Extras / Pick Up Later</h3><span class="pill peach">${extraDone}/${state.extras.length} done</span></div><p class="sub">For spontaneous cooking; these do not change the planned weekly grocery calculations.</p>
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
function syncPantry(key,patch){const p=onHand(key);commit('setPantry',{key,have:patch.have??p.have,extra:patch.extra??p.extra,notes:p.notes});}
function addExtra(name){name=String(name||'').trim();if(!name)return;commit('addExtra',{id:'ex'+Date.now().toString(36)+Math.random().toString(36).slice(2,8),name});}
function writeBlob(filename,obj){const b=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),4000);}
function handleAction(action,button){const w=currentWeek();
 if(action==='propose')propose();
 else if(action==='emptyDraft'){weekDraft=makeBasePlan();render();}
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
   else{state=remote;persist();}
  }else{state=remote;persist();}
  cloudIssue='';toast('Household Sheet connected');render();
 }catch(e){cloudIssue=e.message;toast('Connection failed: '+e.message);updateSync();}
}
async function uploadLocalWeeks(){if(!config.url||!config.code)return toast('Connect to your shared Sheet first');if(!confirm('Upload the weeks currently saved on this device? A week with the same Monday date in Google Sheets will be replaced.'))return;
 const weeks=structuredClone(state.weeks);for(const w of weeks)commit('saveWeek',{week:w,setCurrent:w.id===state.currentWeekId});toast(weeks.length+' weeks queued for upload');}
function eventHandler(e){const btn=e.target.closest('[data-go],[data-action],[data-recipe],[data-recipe-extra],[data-use-anchor],[data-remove-extra],[data-close-modal],[data-grocery-filter]');if(!btn)return;
 if(btn.dataset.go){choose(btn.dataset.go);return;}if(btn.dataset.groceryFilter){groceryFilter=btn.dataset.groceryFilter;render();return;}if(btn.dataset.useAnchor){anchor1=btn.dataset.useAnchor;anchor2='';weekDraft=null;closeModal();choose('build');propose();return;}if(btn.dataset.recipe){showRecipe(btn.dataset.recipe);return;}
 if(btn.dataset.recipeExtra){const r=getRecipe(btn.dataset.recipeExtra);if(!r)return;
  const v=safeInventory(r,reservedKeys()),names=uniq([...v.missing,...v.protectedKeys]).map(keyLabel);
  if(!names.length)return toast('All ingredient types are already listed as available; check quantities before cooking');
  if(confirm('Add these to Extras / Pick Up Later?\n'+names.join(', ')+'\nThis will NOT change the weekly shopping plan.')){names.forEach(addExtra);toast('Added '+names.length+' items to Extras');}
  return;
 }
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
 else if(t.dataset.groceryItem){const w=currentWeek();if(!w)return;let item=w.grocery.find(x=>x.id===t.dataset.groceryItem);commit('checkGrocery',{weekId:w.id,itemId:t.dataset.groceryItem,checked:t.checked});if(t.checked&&item?.key)syncPantry(item.key,{have:true});render();}
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
async function importFile(file){if(!file)return;try{let obj=JSON.parse(await file.text());if(obj.cheffy!==2||!obj.state||!Array.isArray(obj.state.weeks))throw Error('Not a valid Cheffy 2.0 backup');if(!confirm('Replace your local saved weeks, pantry and extras with this backup?'))return;state=obj.state;persist();toast('Backup imported on this device');render();}catch(e){toast('Import failed: '+e.message);}}
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
