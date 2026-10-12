'use strict';
// Cytophage v6: deterministic simulation, independent from HTTP / browser / wall clock.
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const SPECIES=[
 {name:'Люминаты',color:'#62edd0',speed:1.16,vision:1.13,defense:.83,metabolism:1.12},
 {name:'Ферроксы',color:'#ffad73',speed:.91,vision:.93,defense:1.32,metabolism:.88},
 {name:'Весперы',color:'#a994ff',speed:1.05,vision:1.26,defense:.93,metabolism:1.06},
 {name:'Мириды',color:'#f1cf76',speed:.98,vision:1.08,defense:1.06,metabolism:.91},
 {name:'Азуриты',color:'#68c5ff',speed:1.22,vision:.95,defense:.82,metabolism:1.17}
];
const SYLL=['ар','ви','но','ми','ра','сен','кал','то','ли','зер','эль','ор','три','фа','ри','кси','мор','си','та','вен','лу','зи','нар','кро'];
const ROLES=['собиратель','разведчик','защитник','воин'];
// Basal metabolic energy loss per minute of simulation (not wall-clock time).
// Preserves historical consumption for existing saves with no custom multiplier.
function specialEnergyPerMinute(kind,level,state='active'){
  const lv=Math.max(1,Math.min(10,Number(level)||1));
  if(kind==='symbiont'&&state==='settled')return .12;
  return 60*(kind==='devourer' ? .19+lv*.025 : .007*(1+lv*.12));
}
const ROLE_METABOLISM_DEFAULTS=Object.freeze({'матка':1.8,'собиратель':1,'разведчик':1.23,'защитник':1.08,'воин':1.33});
const DEFAULT_COLONY_POP_LIMIT=95;
const MAX_COLONY_FOOD_CAPACITY=1000000;
const ROLE_STATS={'матка':{speed:.76,range:120},'собиратель':{speed:1,range:420},'разведчик':{speed:1.32,range:700},'защитник':{speed:.92,range:410},'воин':{speed:1.1,range:500}};
class World {
 constructor({state=null,seed=42,initialFood=1500,maxPopulation=420,birthInterval=3600}={}){
  this.foodDistributionVersion=2;this.version=6;this.seed=seed>>>0;this.time=0;this.world={width:26000,height:26000};this.nextId=1;this.nextFoodId=1;this.nextClanId=1;
  this.seasonLength=5400;this.maxFood=1800;this.maxPopulation=maxPopulation;this.birthInterval=birthInterval;this.bacteria=[];this.food=[];this.clans=[];this.events=[];this.history=[];this.specials=[];this.specialArchive=[];this.nextSpecialId=1;this.lineage=[];this.diplomacy={};this.balance={birthMultiplier:1,metabolismMultiplier:1,mutationMultiplier:1,aggression:1,roleMetabolism:{...ROLE_METABOLISM_DEFAULTS}};
  this.stats={totalBorn:0,totalDied:0,totalMutations:0,totalKills:0,totalFood:0,totalEggs:0,starved:0,oldAge:0,combatDeaths:0,startedAt:new Date().toISOString()};
  if(state?.version===6){this.restore(state);return;}
  // Deliberate new genesis for old v5 state. Back up persistent data before upgrading.
  this.foundClan(0,7400,12800);this.foundClan(1,18600,13000);
  this.refill(initialFood);this.record();this.log('Начало мира: появились две бактерии-основательницы','genesis');
 }
 random(){let t=this.seed=(this.seed+0x6d2b79f5)>>>0;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;}
 range(a,b){return a+(b-a)*this.random();}
 name(){const count=2+Math.floor(this.random()*2);let n='';for(let i=0;i<count;i++)n+=SYLL[Math.floor(this.random()*SYLL.length)];return n[0].toUpperCase()+n.slice(1)+'-'+Math.floor(this.range(100,999));}
 log(message,type='life',specialId=null,relatedSpecialId=null){this.events.push({simulationTime:this.time,message,type,...(specialId===null?{}:{specialId}),...(relatedSpecialId===null?{}:{relatedSpecialId})});if(this.events.length>60)this.events.splice(0,this.events.length-60);}
 foundClan(speciesIndex,x,y,parent=null){const id=this.nextClanId++;const species=SPECIES[speciesIndex%SPECIES.length];const c={id,name:species.name+' · '+id,parentClanId:parent?.id??null,species:speciesIndex%SPECIES.length,color:species.color,x,y,knowledge:parent?parent.knowledge*.4:0,stores:parent?Math.min(50,parent.stores*.2):65,nestRadius:90,nestLevel:1,fortification:0,nestProgress:0,foodMemory:[],dangerMemory:[],dynasty:[],heirId:null,queenId:null,births:0,members:0,kills:0,populationLimit:DEFAULT_COLONY_POP_LIMIT,foodCapacity:null};this.clans.push(c);const queen=this.spawn(c,null,'матка',x,y);c.queenId=queen.id;c.dynasty.push({queenId:queen.id,name:queen.name,from:this.time,to:null,reason:'основательница'});queen.energy=95;queen.nextBirth=this.time+600;this.log(`Основана колония ${c.name}. Геноматра ${queen.name}`,'genesis');return c;}
 // Only positive additions are restricted; lowering a limit never erases supplies.
 addToStores(c,amount){
  if(!Number.isFinite(amount)||amount<=0)return 0;
  const cap=c.foodCapacity==null?Infinity:c.foodCapacity;
  const added=Math.max(0,Math.min(amount,cap-c.stores));
  c.stores+=added;
  return added;
 }
 spawn(c,parent,role,x,y){const genes=parent?{...parent.genes}:{speed:this.range(.91,1.09),vision:this.range(.91,1.09),metabolism:this.range(.91,1.09),fertility:this.range(.91,1.09),defense:this.range(.91,1.09)};
 let mutated=false;if(parent&&this.random()<Math.min(.75,.16*this.balance.mutationMultiplier)){const key=Object.keys(genes)[Math.floor(this.random()*Object.keys(genes).length)];genes[key]=clamp(genes[key]*this.range(.88,1.12),.6,1.65);this.stats.totalMutations++;mutated=true;}
 const b={id:this.nextId++,name:this.name(),familyId:c.id,species:c.species,role,genes,x:x??c.x,y:y??c.y,heading:this.range(0,Math.PI*2),wanderUntil:0,targetId:null,carry:0,energy:parent?78:95,hp:100,age:0,lifespan:this.range(172800,345600),generation:parent?parent.generation+1:0,parentId:parent?.id??null,experience:parent?parent.experience*.07:0,intelligence:parent?clamp(parent.intelligence+Math.floor(this.range(-3,4)),4,80):Math.floor(this.range(8,17)),immunity:role==='матка'?(parent?clamp(parent.immunity+this.range(.08,.18),.65,.95):this.range(.7,.9)):(parent?clamp(parent.immunity+this.range(-.06,.06),.05,.95):this.range(.25,.65)),infection:0,infectionAge:0,childrenCount:0,totalFood:0,action:'осматривается',nextBirth:Infinity,gestationUntil:0,mutated};this.bacteria.push(b);this.lineage.push({id:b.id,name:b.name,parentId:b.parentId,familyId:b.familyId,born:this.time,role:b.role,death:null});if(this.lineage.length>480)this.compactLineage();this.stats.totalBorn++;c.births++;return b;}
 season(){const index=Math.floor(this.time/this.seasonLength)%4;return {index,name:['Весна','Лето','Осень','Зима'][index],progress:(this.time%this.seasonLength)/this.seasonLength,growth:[1.5,1.15,.65,0][index]};}
 refill(count){const season=this.season();if(!season.growth)return;for(let i=0;i<count;i++){const nest=this.clans[Math.floor(this.random()*this.clans.length)];const local=nest&&this.random()<.26;const angle=this.range(0,2*Math.PI),radius=this.range(350,2500);const x=clamp(local?nest.x+Math.cos(angle)*radius:this.range(80,this.world.width-80),80,this.world.width-80),y=clamp(local?nest.y+Math.sin(angle)*radius:this.range(80,this.world.height-80),80,this.world.height-80);this.food.push({id:this.nextFoodId++,x,y,nutrition:this.range(13,22),createdAt:this.time});}}
 nearestFood(b,claims){let nearest=null,best=Infinity;const vision=ROLE_STATS[b.role].range*b.genes.vision*(.85+b.intelligence/90);for(const f of this.food){if(claims.has(f.id))continue;const dx=f.x-b.x,dy=f.y-b.y,d=dx*dx+dy*dy;if(d<vision*vision&&d<best){nearest=f;best=d;}}return nearest;}
 move(b,x,y,dt,speedFactor=1){const dx=x-b.x,dy=y-b.y,d=Math.hypot(dx,dy);if(d<.001)return;const sp=27*SPECIES[b.species].speed*ROLE_STATS[b.role].speed*b.genes.speed*speedFactor*(b.infection>0?.5:1);const distance=Math.min(d,sp*dt);b.x=clamp(b.x+dx/d*distance,8,this.world.width-8);b.y=clamp(b.y+dy/d*distance,8,this.world.height-8);b.heading=Math.atan2(dy,dx);}
 // The dashed nest perimeter on the map is the authoritative feeding boundary.
 insideNest(b,c){return Math.hypot(b.x-c.x,b.y-c.y)<=Math.max(32,c.nestRadius);}
 // A small deterministic variation means no synchronized patrols, without using wall time.
 patrolPhase(b){return ((b.id*0.618033988749895)%1)*Math.PI*2;}
 nestPost(b,c,winter=false){
  const phase=this.patrolPhase(b),radius=Math.max(32,c.nestRadius);
  const band=b.role==='воин'?(winter?.78:.87):b.role==='защитник'?(winter?.37:.32):
   b.role==='разведчик'?(winter?.22:.34):b.role==='собиратель'?(winter?.30:.40):.10;
  const spread=((b.id*37)%11-5)/100;
  const slowTurn=winter?Math.sin(this.time/220+b.id)*.018:this.time/(b.role==='воин'?62+b.id%19:95+b.id%31)*(b.id%2?-1:1);
  const angle=phase+slowTurn;
  return {x:c.x+Math.cos(angle)*radius*(band+spread),y:c.y+Math.sin(angle)*radius*(band+spread)};
 }
 // Danger and food reports are limited, local observations; never omniscient map scans.
 reportFood(c,f){
  if(!f)return;
  c.foodMemory??=[];
  const known=c.foodMemory.find(item=>item.foodId===f.id);
  if(known){known.at=this.time;return;}
  c.foodMemory.push({x:f.x,y:f.y,foodId:f.id,at:this.time});
  if(c.foodMemory.length>12)c.foodMemory.splice(0,c.foodMemory.length-12);
 }
 reportDanger(c,kind,id,x,y){
  c.dangerMemory??=[];
  const known=c.dangerMemory.find(item=>item.kind===kind&&item.id===id);
  if(known){known.x=x;known.y=y;known.at=this.time;return;}
  c.dangerMemory.push({kind,id,x,y,at:this.time});
  if(c.dangerMemory.length>12)c.dangerMemory.splice(0,c.dangerMemory.length-12);
 }
 observeSurroundings(b,c,dt){
  // A single observation at most every 6 simulated seconds per individual.
  if(this.time<(b.nextObserveAt||0))return;
  b.nextObserveAt=this.time+6+(b.id%7);
  const intelligence=clamp(Number(b.intelligence)||10,4,90);
  const vision=(b.role==='разведчик'?680:b.role==='воин'?410:b.role==='защитник'?320:220)
   *b.genes.vision*(.65+intelligence/90);
  if(b.role==='разведчик'){
   let best=null,bestDist=Infinity;
   for(const f of this.food){const d=(f.x-b.x)**2+(f.y-b.y)**2;
    if(d<vision*vision&&d<bestDist){bestDist=d;best=f;}}
   this.reportFood(c,best);
   if(best){b.experience=Math.min(100000,b.experience+0.035);}
  }
  // Only predators, nest parasites and organisms belonging to an enemy at war
  // are reported as danger. An ally or neutral neighbor is not a combat target.
  for(const e of this.specials){if(e.hp<=0||e.state!=='active'||!['predator','titan','parasite','guardian'].includes(e.kind))continue;
   if((e.x-b.x)**2+(e.y-b.y)**2<vision*vision)this.reportDanger(c,'special',e.id,e.x,e.y);
  }
  for(const other of this.bacteria){if(other.hp<=0||other.familyId===b.familyId||this.relation(b.familyId,other.familyId)!=='война')continue;
   if((other.x-b.x)**2+(other.y-b.y)**2<vision*vision){this.reportDanger(c,'bacteria',other.id,other.x,other.y);break;}
  }
 }
 // Reports expire and are discarded when the actual resource/enemy disappears.
 trimColonyMemory(c,foodIds=null){
  const ids=foodIds||new Set(this.food.map(f=>f.id));
  c.foodMemory=(c.foodMemory||[]).filter(m=>m&&this.time-m.at<1800&&ids.has(m.foodId)).slice(-12);
  c.dangerMemory=(c.dangerMemory||[]).filter(m=>m&&this.time-m.at<160&&(
   m.kind==='special'?this.specials.some(e=>e.id===m.id&&e.hp>0&&e.state==='active'):
   m.kind==='bacteria'?this.bacteria.some(b=>b.id===m.id&&b.hp>0&&b.familyId!==c.id&&this.relation(c.id,b.familyId)==='война'):false
  )).slice(-12);
 }
 activeReport(c,report){
  if(report.kind==='special')return this.specials.some(e=>e.id===report.id&&e.hp>0&&e.state==='active'&&['predator','titan','parasite','guardian'].includes(e.kind));
  if(report.kind==='bacteria')return this.bacteria.some(enemy=>enemy.id===report.id&&enemy.hp>0&&enemy.familyId!==c.id&&this.relation(c.id,enemy.familyId)==='война');
  return false;
 }
 knownThreat(c,b,maxDistance){
  let best=null,dist=Infinity;
  for(const report of c.dangerMemory||[]){if(this.time-report.at>160||!this.activeReport(c,report))continue;
   const d=Math.hypot(report.x-b.x,report.y-b.y);
   if(d<Math.min(dist,maxDistance)){dist=d;best=report;}}
  return best;
 }
 // Retreat must start before the bacterium is actually starving; the farther
 // from the nest (or the slower due to illness), the sooner it turns home.
 shouldReturnForFood(b,c){
  if(c.stores<=0)return false;
  const d=Math.hypot(b.x-c.x,b.y-c.y);
  const speed=27*SPECIES[b.species].speed*ROLE_STATS[b.role].speed*b.genes.speed*(b.infection>0?.5:1);
  const baseUse=.0105*(this.balance.roleMetabolism?.[b.role]??ROLE_METABOLISM_DEFAULTS[b.role]??1)
   *b.genes.metabolism*SPECIES[b.species].metabolism*this.balance.metabolismMultiplier*(this.season().index===3?1.55:1)*(b.infection>0?2:1);
  const journeyCost=d/Math.max(4,speed)*baseUse*1.35;
  const start=clamp(57+journeyCost*1.6,57,87);
  if(this.insideNest(b,c))return false;
  // A strong hysteresis avoids switching between work and food each tick.
  return b.returnForFood===true?b.energy<95:b.energy<start;
 }
 // Only a subset may leave as an escort/raiding party. Others hold the perimeter.
 mobileWarriors(c){
  const troops=this.bacteria.filter(b=>b.familyId===c.id&&b.role==='воин'&&b.hp>=55&&b.energy>=60);
  troops.sort((a,b)=>b.intelligence-a.intelligence||b.hp-a.hp||a.id-b.id);
  return troops.slice(0,Math.min(2,Math.floor(troops.length/2)));
 }
 guardTarget(b,c,winter){
  const border=Math.max(32,c.nestRadius),limit=b.role==='защитник'?border*.92:Math.max(750,Math.min(2400,border*3));
  const maxChase=b.role==='защитник'?border*1.05:limit;
  const reserve=b.role==='защитник'||!(this._escortGroups?.get(c.id)||this.mobileWarriors(c)).some(w=>w.id===b.id);
  const reports=(c.dangerMemory||[]).filter(r=>this.time-r.at<75&&Math.hypot(r.x-c.x)<limit&&this.activeReport(c,r));
  let candidate=null,best=Infinity;
  for(const report of reports){const d=Math.hypot(report.x-b.x,report.y-b.y);
   if(d<best&&Math.hypot(report.x-c.x)<maxChase){best=d;candidate=report;}}
  if(!candidate||b.energy<40||b.hp<38)return null;
  // Defenders never desert the queen, while mobile warriors can escort workers.
  if(reserve&&b.role==='воин'&&Math.hypot(candidate.x-c.x)>border*.55)return null;
  return candidate;
 }
 reportFoodForWorkers(c,b,claims,byId){
  let best=null,score=Infinity;
  for(const report of c.foodMemory||[]){const f=byId.get(report.foodId);
   if(!f||claims.has(f.id))continue;
   if((c.dangerMemory||[]).some(threat=>this.time-threat.at<120&&Math.hypot(threat.x-f.x,threat.y-f.y)<230))continue;
   const d=Math.hypot(f.x-b.x,f.y-b.y);
   if(d>6500)continue;
   const risk=d+(this.time-report.at)*.12-(Math.min(b.intelligence,80)/80)*Math.max(1,Number(f.nutrition)||16)*13;
   if(risk<score){best=f;score=risk;}
  }
  return best;
 }
 step(dt=.25){if(!Number.isFinite(dt)||dt<=0||dt>10)throw Error('Invalid time delta');const previous=this.time;this.time+=dt;const clanMap=new Map(this.clans.map(c=>[c.id,c]));const claims=new Set(),eaten=new Set(),dead=new Set(),foodById=new Map(this.food.map(f=>[f.id,f]));
 // One roster per colony per tick; never rescan/sort all warriors for every soldier.
 this._escortGroups=new Map(this.clans.map(c=>[c.id,this.mobileWarriors(c)]));
 for(const b of this.bacteria){const c=clanMap.get(b.familyId);if(!c){b.deathReason='Колония отсутствует';dead.add(b.id);continue;}b.age+=dt;const winter=this.season().index===3;const nestDistance=Math.hypot(b.x-c.x,b.y-c.y);const sheltered=this.insideNest(b,c);const roleUse=this.balance.roleMetabolism?.[b.role]??ROLE_METABOLISM_DEFAULTS[b.role]??1;const moving=['идёт к пище','разведывает','возвращается','несёт пищу Геноматре','ловит','охотится','доставляет','патрулирует','военная вылазка'].some(a=>b.action?.startsWith(a));
 // Winter requires more food, including at rest. Queens consume more year-round.
 const expenditure=dt*.0105*roleUse*b.genes.metabolism*SPECIES[b.species].metabolism*this.balance.metabolismMultiplier*(winter?1.55:(moving?1.16:1))*(b.infection>0?2:1);
 b.energy=Math.max(0,b.energy-expenditure);
 // Everybody inside the ENTIRE visible nest circle shares food; nutrition is drawn
 // from durable clan reserves, never conjured in the client. Higher rate in winter.
 if(sheltered&&c.stores>0&&(b.feeding===true||b.energy<(winter?94:86))){
  const appetite=(b.role==='матка'?1.55:1)*(winter?1.8:1);
  const intake=Math.min(c.stores,dt*.32*appetite,100-b.energy);
  b.energy+=intake;c.stores-=intake;b.feeding=b.energy<99.5;
 }else if(!sheltered||c.stores<=0){b.feeding=false;}
 if(b.energy<18)b.hp-=dt*.025*(1+(18-b.energy)/18);else if(b.energy>72&&b.hp>0)b.hp=Math.min(100,b.hp+dt*.008);
 if(b.infection>0){b.infectionAge+=dt;b.hp-=dt*.004*b.infection*(1-b.immunity);if(b.infectionAge>1200*(.5+b.immunity)){b.infection=0;b.infectionAge=0;b.immunity=Math.min(.95,b.immunity+.035);}}if(b.hp<=0||b.age>b.lifespan){
  dead.add(b.id);this.stats.totalDied++;
  if(b.hp<=0){
   // Persist the factual source of fatal damage, not a guess based on death coordinates.
   if(this.time-(b.lastCombatHit??-Infinity)<30){
    b.deathReason=b.lastAttackReason||'Погиб в бою с другой колонией';
    this.stats.combatDeaths=(this.stats.combatDeaths||0)+1;
    this.log('Военная потеря: '+b.name+' (колония №'+c.id+')','combat');
   }else if(b.lastAttackReason&&this.time-(b.lastAttackAt??-Infinity)<30){
    b.deathReason=b.lastAttackReason;
   }else if(b.energy<18&&b.infection>0){
    b.deathReason='Истощение сытости и инфекция';
    this.stats.starved++;
   }else if(b.energy<18){
    b.deathReason='Истощение сытости (голодание)';
    this.stats.starved++;
   }else if(b.infection>0){
    b.deathReason='Повреждения от инфекции';
   }else{
    b.deathReason='Потеря здоровья (точный источник не установлен)';
   }
  }else{b.deathReason='Старость';this.stats.oldAge++;}
  if(c.queenId===b.id){c.queenId=null;const reign=c.dynasty?.at(-1);if(reign&&!reign.to){reign.to=this.time;reign.reason=b.hp<=0?'гибель':'старость';}}continue;}
 if(b.role==='матка'){
  // A queen must be alive, mature and supplied. One birth per hour per queen; first child after 10 min.
  if(this.time>=b.nextBirth&&b.age>=600&&b.energy>=62&&c.stores>=23&&this.bacteria.length<this.maxPopulation&&c.members<(c.populationLimit??DEFAULT_COLONY_POP_LIMIT)){
   const rolls=this.random();const members=this.bacteria.filter(v=>v.familyId===c.id);const workers=members.filter(v=>v.role==='собиратель').length;const guards=members.filter(v=>v.role==='защитник'||v.role==='воин').length;const scouts=members.filter(v=>v.role==='разведчик').length;const needsWorkers=workers<Math.max(1,Math.ceil(members.length*.42));const needsDefense=guards<Math.max(1,Math.floor(members.length*.16));const role=needsWorkers?'собиратель':needsDefense?'защитник':scouts<Math.max(1,Math.floor(members.length*.14))?'разведчик':rolls<.63?'собиратель':rolls<.79?'разведчик':rolls<.93?'защитник':'воин';const baby=this.spawn(c,b,role,b.x+this.range(-12,12),b.y+this.range(-12,12));b.energy-=17;c.stores-=23;b.childrenCount++;b.nextBirth=this.time+this.birthInterval/this.balance.birthMultiplier/clamp(b.genes.fertility,.65,1.65);this.stats.totalEggs++;this.log(`${b.name} породила ${baby.role} ${baby.name} (${c.name})`,'birth');
  }
  // Queens stay protected whenever there are stored provisions or workers.
  // An isolated founder forages only if her nest has actually run out of food.
  if(c.stores>0||this.bacteria.some(other=>other.familyId===c.id&&other.role!=='матка')){const a=this.time/150+c.id;this.move(b,c.x+Math.cos(a)*Math.min(32,c.nestRadius*.23),c.y+Math.sin(a)*Math.min(32,c.nestRadius*.23),dt,.22);b.action='осматривает гнездо';continue;}
 }
 // Shared observations come only from nearby eyes on the ground, never the browser.
 this.observeSurroundings(b,c,dt);
 // A forager's carried food must still make it home; hungry carriers may
 // consume a small part of their load, as they always could.
 if(!b.preyId&&b.role!=='матка'&&b.carry<=0){
  const low=this.shouldReturnForFood(b,c);
  if(low){b.returnForFood=true;b.targetId=null;this.move(b,c.x,c.y,dt,.97);b.action='возвращается в гнездо поесть';continue;}
  if(b.returnForFood){
   if(b.energy<94&&c.stores>0){const post=this.nestPost(b,c,true);this.move(b,post.x,post.y,dt,.70);b.action='питается запасами гнезда';continue;}
   b.returnForFood=false;
  }
 }
 // A frightened worker/scout reports danger and withdraws; it doesn't run
 // blindly into a stronger enemy. Escorts can be dispatched from the perimeter.
 if(['собиратель','разведчик'].includes(b.role)&&b.carry<=0){
  const threat=this.knownThreat(c,b,Math.max(135,150+b.intelligence*2));
  if(threat){b.targetId=null;const post=this.nestPost(b,c,true);
   this.move(b,post.x,post.y,dt,1.05);b.action='избегает угрозы · возвращается к гнезду';continue;}
 }
 // Guards defend the queen's inner ring; warriors watch the outer perimeter.
 // Tracked threats may briefly pull a limited number away, even during winter.
 if(['защитник','воин'].includes(b.role)&&b.carry<=0&&!b.preyId){
  if(b.energy<43||b.hp<37){const post=this.nestPost(b,c,true);
   this.move(b,post.x,post.y,dt,.88);b.action='отдыхает и восстанавливается у гнезда';continue;}
  const threat=this.guardTarget(b,c,winter);
  if(threat){this.move(b,threat.x,threat.y,dt,1.07);b.action=b.role==='защитник'?'защищает Геноматру':'выступает на защиту колонии';continue;}
  if(b.role==='воин'&&!winter&&(this._escortGroups?.get(c.id)||this.mobileWarriors(c)).some(w=>w.id===b.id)){
   const enemy=this.clans.find(other=>other.id!==c.id&&other.members>=6&&this.relation(c.id,other.id)==='война'&&Math.hypot(other.x-c.x,other.y-c.y)<3500);
   if(enemy&&b.hp>=70&&b.energy>=75){
    // War parties retreat before critical exhaustion and NEVER include the whole garrison.
    this.move(b,enemy.x,enemy.y,dt,.80);b.action='военная вылазка к '+enemy.name;continue;
   }
  }
  const post=this.nestPost(b,c,winter);
  this.move(b,post.x,post.y,dt,winter?.48:.70);
  b.action=winter?(b.role==='защитник'?'зимует · внутренняя охрана':'зимует · охрана границы'):
   (b.role==='защитник'?'патрулирует вокруг Геноматры':'патрулирует границу гнезда');
  continue;
 }
 // In winter, each role occupies a distinct stable post (rather than piling
 // up at the queen); security response has priority over winter rest.
 if(winter&&b.carry===0&&!b.preyId){b.targetId=null;const post=this.nestPost(b,c,true);
  this.move(b,post.x,post.y,dt,.55);b.action=c.stores>0?'зимует · питается запасами':'зимует · пищи в гнезде нет';continue;
 }
 if(b.preyId){const prey=this.specials.find(e=>e.id===b.preyId&&['nutrient','symbiont'].includes(e.kind)&&e.state==='carried');if(!prey){b.preyId=null;}else{this.move(b,c.x,c.y,dt,.72);prey.x=b.x;prey.y=b.y;prey.action='пойман · доставляется';b.action='доставляет '+prey.name+' в гнездо';if(Math.hypot(b.x-c.x,b.y-c.y)<4){const nutrition=50+prey.level*35;if(prey.kind==='symbiont'){prey.state='settled';prey.clanId=c.id;prey.x=c.x+20;prey.y=c.y+20;prey.carrierId=null;this.log(`${c.name} поселили симбионта ${prey.name}`,'special',prey.id);}else{this.addToStores(c,nutrition);prey.state='consumed';}b.preyId=null;b.experience+=8;c.knowledge+=.5;if(prey.kind==='nutrient')this.log(`${c.name} доставили ${prey.name} в гнездо (+${nutrition} пищи)`,'food',prey.id);}}continue;}
 if(b.role==='собиратель'&&b.carry===0){const prey=this.specials.find(e=>['nutrient','symbiont'].includes(e.kind)&&e.state==='active'&&Math.hypot(e.x-b.x,e.y-b.y)<300);if(prey){this.move(b,prey.x,prey.y,dt);b.action='ловит '+prey.name;if(Math.hypot(prey.x-b.x,prey.y-b.y)<8){prey.state='carried';prey.carrierId=b.id;b.preyId=prey.id;b.targetId=null;this.log(b.name+' поймал '+prey.name,'special',prey.id);}continue;}}
 if(b.carry>0){if(b.energy<32){const bite=Math.min(b.carry,Math.max(0,70-b.energy)*.24);b.carry-=bite;b.energy=Math.min(100,b.energy+bite);b.action='подкрепляется частью добычи';}const queen=this.bacteria.find(q=>q.id===c.queenId);if(queen){this.move(b,c.x,c.y,dt);b.action='несёт пищу Геноматре';if(Math.hypot(b.x-c.x,b.y-c.y)<=2){const deposited=this.addToStores(c,b.carry);queen.energy=Math.min(100,queen.energy+deposited*.08);c.nestProgress+=deposited*.12;b.carry=0;b.experience+=3;c.knowledge+=.12;}}else{this.addToStores(c,b.carry);b.carry=0;}continue;}
 // Scouts have independent expeditions and progressively broaden their range.
 if(b.role==='разведчик'){
  b.targetId=null;
  const homeDist=Math.hypot(b.x-c.x,b.y-c.y);
  if(b.scoutReturning){
   const post=this.nestPost(b,c,true);
   this.move(b,post.x,post.y,dt,.92);b.action='возвращается из разведки';
   if(homeDist<c.nestRadius*.55){
    b.scoutReturning=false;b.scoutRestUntil=this.time+45+b.id%45;
    b.scoutRange=Math.min(6200,Math.max(1100,Number(b.scoutRange)||1100)+Math.min(340,170+b.intelligence*3));
    b.experience+=1.5;c.knowledge+=.15;
   }
   continue;
  }
  if(this.time<(b.scoutRestUntil||0)){
   const post=this.nestPost(b,c,true);this.move(b,post.x,post.y,dt,.44);b.action='отдыхает после разведки';continue;
  }
  if(!Number.isFinite(b.scoutTargetX)||!Number.isFinite(b.scoutTargetY)){
   const maxDist=Math.min(6200,Math.max(1100,Number(b.scoutRange)||1100)+b.intelligence*8);
   const bearing=this.patrolPhase(b)+(Number(b.scoutTrips)||0)*2.39996+this.range(-.22,.22);
   b.scoutTargetX=clamp(c.x+Math.cos(bearing)*maxDist,18,this.world.width-18);
   b.scoutTargetY=clamp(c.y+Math.sin(bearing)*maxDist,18,this.world.height-18);
   b.scoutTrips=(Number(b.scoutTrips)||0)+1;
  }
  const tx=b.scoutTargetX,ty=b.scoutTargetY;
  const arrived=Math.hypot(tx-b.x,ty-b.y)<32;
  if(arrived||Math.hypot(b.x-c.x)>6700){
   b.scoutTargetX=null;b.scoutTargetY=null;b.scoutReturning=true;
   b.action='завершает дальнюю разведку';continue;
  }
  this.move(b,tx,ty,dt,.90);b.action='разведывает дальнюю территорию';continue;
 }
 let target=foodById.get(b.targetId);
 if(target&&(eaten.has(target.id)||claims.has(target.id)||Math.hypot(target.x-c.x,target.y-c.y)>7500))target=null;
 if(target&&(c.dangerMemory||[]).some(t=>this.time-t.at<120&&Math.hypot(t.x-target.x,t.y-target.y)<210))target=null;
 if(!target){const nearby=this.nearestFood(b,claims);const reported=b.role==='собиратель'?this.reportFoodForWorkers(c,b,claims,foodById):null;
  target=nearby&&(!reported||Math.hypot(nearby.x-b.x,nearby.y-b.y)<Math.hypot(reported.x-b.x,reported.y-b.y)*.8)?nearby:reported||nearby;
  b.targetId=target?.id??null;}
 if(target){claims.add(target.id);this.move(b,target.x,target.y,dt);b.action='идёт к пище';if(Math.hypot(target.x-b.x,target.y-b.y)<=2){eaten.add(target.id);b.targetId=null;b.totalFood++;this.stats.totalFood++;b.experience+=1.8;b.intelligence=Math.min(90,b.intelligence+0.025);c.knowledge+=.05;c.foodMemory=(c.foodMemory||[]).filter(report=>report.foodId!==target.id);if(b.role==='матка'){b.energy=Math.min(100,b.energy+target.nutrition);}else{b.energy=Math.min(100,b.energy+target.nutrition*.34);b.carry=target.nutrition*.66;}b.action='поглощает пищу';}continue;}
 // Intelligence affects exploration range, retained target choice and the ability to track resources.
 if(this.time>b.wanderUntil){b.heading+=this.range(-2.1,2.1);b.wanderUntil=this.time+this.range(5,18)*(1+b.intelligence/100);}
 const memory=c.foodMemory?.findLast(m=>this.time-m.at<1800&&Math.hypot(m.x-b.x,m.y-b.y)<2200);if(memory&&b.intelligence>18&&this.random()<.12*dt){b.heading=Math.atan2(memory.y-b.y,memory.x-b.x);b.wanderUntil=this.time+this.range(25,60);}const distanceFromQueen=Math.hypot(b.x-c.x,b.y-c.y);if(distanceFromQueen>1700+b.intelligence*18){this.move(b,c.x,c.y,dt,.85);b.action='возвращается';}else{this.move(b,b.x+Math.cos(b.heading)*180,b.y+Math.sin(b.heading)*180,dt,.65);b.action='разведывает';}
 }
 if(dead.size){
  // Lineage is durable; preserve a concise reason once, before dead bodies leave memory.
  const reasons=new Map(this.bacteria.filter(b=>dead.has(b.id)).map(b=>[b.id,b.deathReason||'Причина не установлена']));
  for(const entry of this.lineage)if(dead.has(entry.id)&&entry.death==null){entry.death=this.time;entry.deathReason=reasons.get(entry.id)||'Причина не установлена';}
  this.bacteria=this.bacteria.filter(b=>!dead.has(b.id));
  this.compactLineage();
  for(const clan of this.clans)clan.dangerMemory=(clan.dangerMemory||[]).filter(report=>report.kind!=='bacteria'||!dead.has(report.id));
 }
 if(eaten.size){this.food=this.food.filter(f=>!eaten.has(f.id));
  for(const clan of this.clans)clan.foodMemory=(clan.foodMemory||[]).filter(report=>!eaten.has(report.foodId));
 }
 // Combat only on actual physical contact between rival soldiers and enemies.
 for(const a of this.bacteria){if(a.hp<=0||(a.role!=='воин'&&a.role!=='защитник'))continue;
  const enemy=this.bacteria.find(b=>b.hp>0&&b.familyId!==a.familyId&&this.relation(a.familyId,b.familyId)==='война'&&Math.hypot(b.x-a.x,b.y-a.y)<14);
  if(!enemy)continue;
  enemy.hp-=dt*this.balance.aggression*(a.role==='воин'?2.2:1.1)*a.genes.defense*SPECIES[a.species].defense;enemy.lastCombatHit=this.time;enemy.lastAttackReason='Убит в бою с '+a.role+'ом колонии '+(clanMap.get(a.familyId)?.name||'№'+a.familyId);enemy.lastAttackAt=this.time;
  a.action='обороняется в войне';
  if(enemy.hp<=0){const relation=this.diplomacy[this.relationKey(a.familyId,enemy.familyId)];if(relation)relation.losses=(relation.losses||0)+1;
   clanMap.get(a.familyId).kills++;this.stats.totalKills++;}
 }
 this.stepSpecials(dt);
 for(const c of this.clans){
  const living=this.bacteria.filter(b=>b.familyId===c.id&&b.hp>0);c.members=living.length;
  const queen=living.find(b=>b.id===c.queenId);
  if(queen){
   const current=living.find(b=>b.id===c.heirId&&b.id!==queen.id);
   const safeCurrent=current&&current.hp>=35&&this.heirRemaining(current)>=Math.max(21600,current.lifespan*.08);
   // Re-evaluate appointments from the previous policy once after upgrade.
   if(!safeCurrent||c.heirPolicyVersion!==2){
    const selection=this.heirCandidate(c,queen,living);
    const next=selection?.b;
    if(next?.id!==c.heirId&&next)this.log(c.name+': Геноматра '+queen.name+' выбрала наследницу '+next.name+' (№'+next.id+') — возраст, труд, интеллект','dynasty');
    c.heirId=next?.id??null;
    c.heirReason=selection?.reason??null;
    c.heirPolicyVersion=2;
   }
   queen.x=clamp(queen.x,c.x-c.nestRadius*.55,c.x+c.nestRadius*.55);
   queen.y=clamp(queen.y,c.y-c.nestRadius*.55,c.y+c.nestRadius*.55);
  }else if(living.length){
   const formerQueen={id:c.dynasty?.at(-1)?.queenId??c.queenId};
   const selection=living.some(b=>b.id===c.heirId)?null:this.heirCandidate(c,formerQueen,living,{emergency:true});
   const heir=living.find(b=>b.id===c.heirId)||selection?.b;
   if(!heir)continue;
   heir.role='матка';const lineage=this.lineage.find(entry=>entry.id===heir.id);if(lineage)lineage.role='матка';heir.immunity=clamp(Math.max(.65,heir.immunity+.15),.05,.95);
   heir.queenImmunityInitialized=true;c.heirId=null;c.heirReason=null;c.heirPolicyVersion=2;c.dynasty??=[];
   c.dynasty.push({queenId:heir.id,name:heir.name,from:this.time,to:null,reason:'преемница'});
   if(c.dynasty.length>60)c.dynasty.shift();heir.nextBirth=this.time+this.birthInterval;
   c.queenId=heir.id;this.log(`${heir.name} стала новой Геноматрой ${c.name}`,'dynasty');
  }
 }
 if(Math.floor(this.time/20)>Math.floor(previous/20)){const growth=this.season().growth;this.refill(Math.max(0,Math.min(Math.ceil(10*growth),this.maxFood-this.food.length)));if(this.season().index===3) this.food=this.food.filter(f=>this.random()<.96);}
 if(Math.floor(this.time/20)>Math.floor(previous/20))this.spreadDisease();if(Math.floor(this.time/60)>Math.floor(previous/60)){this.updateCivilization();this.record();this.maybeBud();}
 }
  // A succession is earned: proven work, seniority, then intelligence. The hourly
  // seniority tier keeps a few minutes of age difference from hiding real work.
  heirWork(b){return Math.max(0,Number(b.totalFood)||0)*2+Math.max(0,Number(b.experience)||0);}
  heirRemaining(b){return (Number(b.lifespan)||0)-(Number(b.age)||0);}
  heirCandidate(c,queen,living,{emergency=false}={}){
   let candidates=living.filter(b=>b.id!==queen?.id&&b.role!=='матка'&&(emergency||b.age>=300));
   if(!emergency){
    // Do not appoint a dying or critically weakened successor.
    candidates=candidates.filter(b=>b.hp>=35&&this.heirRemaining(b)>=Math.max(21600,b.lifespan*.08));
   }
   if(!candidates.length)return null;
   // Direct children of the current queen take precedence over distant relatives.
   const direct=candidates.filter(b=>b.parentId===queen?.id);
   if(direct.length)candidates=direct;
   // Prefer a bacterium with proven service, but provide a fallback if nobody has worked yet.
   const proven=candidates.filter(b=>this.heirWork(b)>0.5);
   if(proven.length)candidates=proven;
   candidates.sort((a,b)=>Math.floor(b.age/3600)-Math.floor(a.age/3600)
    ||this.heirWork(b)-this.heirWork(a)
    ||(Number(b.intelligence)||0)-(Number(a.intelligence)||0)
    ||b.age-a.age||a.id-b.id);
   const chosen=candidates[0];
   const relationship=chosen.parentId===queen?.id?'Прямой потомок Геноматры':'Представитель колонии';
   const reason=relationship+'; старшинство: '+Math.floor(chosen.age/3600)+' полных ч; '
    +'собрано частиц пищи: '+Math.round(chosen.totalFood||0)+'; опыт: '+(Number(chosen.experience)||0).toFixed(1)
    +'; интеллект: '+Math.round(chosen.intelligence||0)
    +(emergency?'; экстренное назначение после гибели Геноматры':'');
   return {b:chosen,reason};
  }
 // All diplomatic decisions belong to the authoritative server and are persisted with the world.
 relation(a,b){if(a===b)return 'союз';return this.diplomacy[[a,b].sort((x,y)=>x-y).join(':')]?.status||'нейтралитет';}
 relationKey(a,b){return [a,b].sort((x,y)=>x-y).join(':');}
 setRelation(a,b,status,{source='manual',reason='Решение администратора'}={}){
  if(a===b||!this.clans.some(c=>c.id===a)||!this.clans.some(c=>c.id===b))throw Error('Выбери две разные колонии');
  if(!['нейтралитет','союз','конкуренция','война','перемирие','автоматически'].includes(status))throw Error('Недопустимое отношение');
  const key=this.relationKey(a,b),old=this.diplomacy[key]||{};
  if(status==='автоматически'){
   this.diplomacy[key]={...old,status:old.status||'нейтралитет',source:'auto',manualUntil:0,reason:'Автономная дипломатия включена',updated:this.time};
   this.log(`Колонии №${a} и №${b}: дипломатия передана колониям`,'diplomacy');return;
  }
  const changed=old.status!==status;
  this.diplomacy[key]={...old,status,updated:this.time,source,reason,manualUntil:source==='manual'?this.time+3600:0,
   tension:Math.max(0,Math.min(100,Number(old.tension)||0)),trust:Math.max(0,Math.min(100,Number(old.trust)||0)),
   losses:status==='война'&&changed?0:Number(old.losses)||0};
  if(changed||source==='manual')this.log(`Колонии №${a} и №${b}: ${status} (${reason})`,'diplomacy');
 }
 // Approx. one decision per simulated minute. Moderate changes, minimum phase durations and
 // limits on losses prevent instant all-out war; decisions persist through Render restarts.
 updateDiplomacy(){
  for(let i=0;i<this.clans.length;i++)for(let j=i+1;j<this.clans.length;j++){
   const a=this.clans[i],b=this.clans[j];if(!a.members||!b.members)continue;
   const key=this.relationKey(a.id,b.id),distance=Math.hypot(a.x-b.x,a.y-b.y);
   let d=this.diplomacy[key];if(!d&&distance>6000)continue;
   if(!d){d={status:'нейтралитет',updated:this.time,source:'auto',manualUntil:0,tension:12,trust:25,losses:0,reason:'Первый контакт'};this.diplomacy[key]=d;}
   d.tension=clamp(Number(d.tension)||0,0,100);d.trust=clamp(Number(d.trust)||0,0,100);
   d.losses=Math.max(0,Number(d.losses)||0);
   const near=distance<6000,neighbors=distance<3000;
   const related=a.parentClanId===b.id||b.parentClanId===a.id;
   const kin=related||a.species===b.species;
   // Need is relative to colony population, not the absolute amount of stored food.
   const needA=clamp((a.members*7+30-a.stores)/(a.members*7+30),0,1);
   const needB=clamp((b.members*7+30-b.stores)/(b.members*7+30),0,1);
   const shortage=(needA+needB)/2;
   const stress=neighbors?shortage*(kin?.72:1):0;
   const trustTarget=near?(related?91:kin?69:shortage<.3?53:26):15;
   const tensionTarget=neighbors?clamp(12+stress*76+(d.status==='война'?9:0)-(related?22:kin?8:0),0,100):8;
   d.tension=clamp(d.tension+(tensionTarget-d.tension)*.12,0,100);
   d.trust=clamp(d.trust+(trustTarget-d.trust)*.10,0,100);
   d.distance=Math.round(distance);d.shortage=+shortage.toFixed(2);
   if(d.manualUntil>this.time){d.source='manual';continue;}
   d.manualUntil=0;d.source='auto';
   const age=this.time-(Number(d.updated)||0);
   // A winter scarcity cannot immediately trigger a war. Each stage takes simulated time.
   let target=null,reason='';
   if(d.status==='нейтралитет'&&age>=600){
    if(neighbors&&d.tension>=49&&d.trust<65){target='конкуренция';reason='Соседство и нехватка пищи';}
    else if(near&&d.trust>=59&&shortage<.42){target='союз';reason=related?'Родственные колонии':kin?'Общие интересы вида':'Взаимная безопасность при достатке пищи';}
   }else if(d.status==='конкуренция'&&age>=900){
    if(neighbors&&d.tension>=72&&d.trust<43&&a.members>=8&&b.members>=8&&shortage>.5){target='война';reason='Затяжной спор за ресурсы';}
    else if(d.tension<36||!neighbors){target='перемирие';reason='Снизилась угроза столкновения';}
   }else if(d.status==='война'&&(age>=900||d.losses>=2)){
    if(age>=2400||d.losses>=2||a.members<6||b.members<6||a.stores<10||b.stores<10||distance>4200){target='перемирие';reason='Истощение или потери: '+d.losses;}
   }else if(d.status==='перемирие'&&age>=1800){
    if(d.tension<55||!neighbors){target='нейтралитет';reason='Восстановление спокойствия';}
    else if(d.tension>=73&&shortage>.6){target='конкуренция';reason='Возобновилась борьба за пищу';}
   }else if(d.status==='союз'&&age>=2400){
    if((!near||d.trust<23)&&!related){target='нейтралитет';reason='Ослабли общие интересы';}
   }
   if(target)this.setRelation(a.id,b.id,target,{source:'auto',reason});
  }
 }
 updateCivilization(){for(const c of this.clans){if(!c.members)continue;c.nestProgress??=0;c.fortification??=0;c.nestLevel??=1;c.dynasty??=[];c.foodMemory??=[];c.dangerMemory??=[];const workers=this.bacteria.filter(b=>b.familyId===c.id&&b.role==='собиратель').length;const cost=Math.min(c.stores*.012,workers*.04);c.stores=Math.max(0,c.stores-cost);c.nestProgress+=cost*.7;if(c.nestProgress>=80*c.nestLevel&&c.nestLevel<8){c.nestProgress=0;c.nestLevel++;c.nestRadius=90+35*c.nestLevel;c.fortification=Math.min(.45,c.fortification+.04);this.log(`${c.name}: гнездо выросло до уровня ${c.nestLevel}`,'construction');}this.trimColonyMemory(c);}
  this.updateDiplomacy();
 }
 spreadDisease(){
  // Single authoritative infection model: ordinary bacteria + living laboratory creatures.
  const hosts=[...this.bacteria,...this.specials.filter(e=>e.hp>0&&['active','carried','settled'].includes(e.state))];
  const infected=hosts.filter(b=>b.infection>0);
  if(!infected.length&&hosts.length>12&&this.random()<.003){
   const host=hosts[Math.floor(this.random()*hosts.length)];
   if(host){host.infection=1;host.infectionAge=0;this.log('Обнаружена инфекция у '+host.name,'disease');}
  }
  // The same ID may exist in two distinct namespaces: compare host objects, not IDs.
  for(const sick of infected){if(sick.infectionAge<60)continue;
   for(const healthy of hosts){if(healthy===sick||healthy.infection>0)continue;
    if(Math.abs(healthy.x-sick.x)>35||Math.abs(healthy.y-sick.y)>35)continue;
    if(this.random()<.045*(1-clamp(healthy.immunity??.4,0,.95))){
     healthy.infection=1;healthy.infectionAge=0;
    }
   }
  }
 }
 maybeBud(){// New colonies arise only after substantial growth, resources and maturity.
 if(this.clans.length>=18)return;const candidate=this.clans.find(c=>c.members>=65&&c.stores>=280&&c.knowledge>=70);if(!candidate)return;const species=candidate.species;const angle=this.range(0,Math.PI*2);const x=clamp(candidate.x+Math.cos(angle)*4200,400,this.world.width-400),y=clamp(candidate.y+Math.sin(angle)*4200,400,this.world.height-400);candidate.stores-=110;this.foundClan(species,x,y,candidate);this.log(`${candidate.name} основала дочернюю колонию`,'branch');}
 createSpecial(config){if(this.specials.length>=10)throw Error('Не больше 10 существ одновременно');const kind=['predator','titan','wanderer','guardian','nutrient','symbiont','parasite','devourer'].includes(config.kind)?config.kind:'predator';const name=String(config.name||'Особь '+this.nextSpecialId).trim();if(name.length<2||name.length>48||/[<>\x00-\x1f]/.test(name))throw Error('Неверное имя');const icon=String(config.icon||'👾');if(!["👾","🦠","🧬","🧫","🔬","⚗️","🧪","💉","🩸","🫀","🧠","👁️","👀","🫁","🦴","🦷","🫧","💧","💦","🌀","⚛️","☣️","☢️","🧿","🪬","🐙","🪼","🦑","🦀","🦞","🦐","🦪","🐚","🪸","🐌","🪱","🐛","🦋","🐜","🐝","🪲","🐞","🦗","🪳","🕷️","🕸️","🦂","🦟","🪰","🐍","🦎","🐢","🐸","🐡","🦈","🐟","🐠","🐲","🐉","🦖","🦕","🦇","🦔","🐺","🦊","🐀","👽","👻","👹","👺","💀","☠️","😈","👿","🤖","🤡","🎭","🧟","🧛","🧙","🧚","🧞","🧌","🦄","🦾","🛸","🚀","🌌","🪐","🔮","🪄","🗿","👑","🌱","🌿","🍀","☘️","🍃","🍂","🍁","🌵","🍄","🍄‍🟫","🪷","🌸","🌺","🌻","🌾","🌳","🌲","🌴","🪨","🪵","🌊","🌫️","❄️","🌨️","🌪️","☄️","🌑","🌕","🌙","⭐","🌟","🌠","🌈","🔥","⚡","💥","💫","✨","💢","💯","🌡️","🔋","🪫","💡","🔆","🧲","⚙️","🛡️","⚔️","🗡️","🔱","💎","🪙","🟢","🔴","🟡","🟣","🔵","🧊","🕳️","♻️","🍇","🍒","🍓","🫐","🍏","🍎","🍐","🍑","🥑","🍅","🥕","🌽","🥦","🥬","🫘","🥜","🌰","🍖","🥩","🥚","🧀","🍯","🍬","🍭","🍋","🥝","🍊","🍉","🍍","🥥"].includes(icon))throw Error('Недопустимый значок');const level=Number(config.level);if(!Number.isInteger(level)||level<1||level>10)throw Error('Уровень от 1 до 10');const baseEnergyRate=specialEnergyPerMinute(kind,level);const selectedEnergyRate=config.energyDrainPerMinute===undefined?baseEnergyRate:Number(config.energyDrainPerMinute);if(!Number.isFinite(selectedEnergyRate)||selectedEnergyRate<.1||selectedEnergyRate>60)throw Error('Расход энергии должен быть от 0.1 до 60 единиц за минуту симуляции');const energyDrainMultiplier=selectedEnergyRate/baseEnergyRate;const immunityPercent=config.immunity===undefined?40:Number(config.immunity);if(!Number.isInteger(immunityPercent)||immunityPercent<0||immunityPercent>95)throw Error('Иммунитет от 0 до 95%');const immunity=immunityPercent/100;const id=this.nextSpecialId++;const hp=['nutrient','symbiont'].includes(kind)?35+level*12:100+level*(kind==='titan'?90:35);const foodNest=['nutrient','symbiont','parasite'].includes(kind)?this.clans[Math.floor(this.random()*this.clans.length)]:null;const spawnAngle=this.range(0,Math.PI*2),spawnDistance=kind==='parasite'?(foodNest?.nestRadius||220)+this.range(180,320):this.range(30,220);const foodX=foodNest?foodNest.x+Math.cos(spawnAngle)*spawnDistance:this.world.width/2,foodY=foodNest?foodNest.y+Math.sin(spawnAngle)*spawnDistance:this.world.height/2;const foodStart=kind==='devourer'&&this.food.length?this.food[Math.floor(this.random()*this.food.length)]:null;const entity={id,name,icon,kind,level,x:Math.max(20,Math.min(this.world.width-20,Number(config.x)||(foodStart?.x??foodX))),y:Math.max(20,Math.min(this.world.height-20,Number(config.y)||(foodStart?.y??foodY))),hp,maxHp:hp,energy:100,energyDrainMultiplier,immunity,infection:0,infectionAge:0,age:0,experience:0,kills:0,genes:{speed:1,defense:1},grow:config.grow!==false,canReproduce:kind==='parasite',stolenFood:0,devouredFood:0,biomass:0,offspring:0,parentId:null,lastReproduction:this.time,homeX:null,homeY:null,clanId:null,lastProduce:0,state:'active',action:'исследует',heading:this.range(0,Math.PI*2),cooldown:0};this.specials.push(entity);this.log('Появилось особое существо '+name,'special',id);return entity;}
 specialCommand(action,id,x,y){
  // Archived and active creatures are separate collections. Deletion must find both.
  const activeIndex=this.specials.findIndex(e=>e.id===id);
  const archivedIndex=this.specialArchive.findIndex(e=>e.id===id);
  if(action==='deleteSpecial'){
   if(activeIndex<0&&archivedIndex<0)throw Error('Существо не найдено ни в мире, ни в лаборатории');
   const list=activeIndex>=0?this.specials:this.specialArchive;
   const index=activeIndex>=0?activeIndex:archivedIndex;
   const [entity]=list.splice(index,1);
   for(const clan of this.clans)clan.dangerMemory=(clan.dangerMemory||[]).filter(report=>report.kind!=='special'||report.id!==id);
   if(entity.carrierId){const carrier=this.bacteria.find(b=>b.id===entity.carrierId);if(carrier)carrier.preyId=null;}
   // Permanent deletion removes the creature and its directly associated events.
   // Older saves lacked specialId; match only known message formats to avoid deleting unrelated events.
   const name=entity.name;
   const ambiguousOldName=[...this.specials,...this.specialArchive].some(other=>other.name===name);
   this.events=this.events.filter(event=>{
    if(event.specialId!=null||event.relatedSpecialId!=null)return event.specialId!==id&&event.relatedSpecialId!==id;
    if(ambiguousOldName)return true; // Old events have no ID; do not erase a namesake's history.
    if(typeof event.message!=='string')return true;
    const message=event.message;
    return !(
     message==='Появилось особое существо '+name||
     (message==='Погиб '+name||message.startsWith('Погиб '+name+': '))||
     message.startsWith(name+' погиб:')||message.startsWith(name+' вырос до уровня ')||
     message.startsWith(name+' размножился:')||message.endsWith(' появился '+name)||
     message===name+' удалён администратором'||
     message===name+' перемещён в лабораторию'||message===name+' вернулся в мир'||
     message.endsWith(' поймал '+name)||
     message.endsWith(' поселили симбионта '+name)||
     (message.includes(' доставили '+name+' в гнездо (')&&message.endsWith(' пищи)'))
    );
   });
   // A deleted parent must not leave a dangling reference in surviving offspring.
   for(const other of [...this.specials,...this.specialArchive])if(other.parentId===id)other.parentId=null;
   return;
  }
  if(action==='storeSpecial'){
   if(activeIndex<0)throw Error('Существо не найдено среди активных');
   if(this.specialArchive.filter(item=>item.state!=='dead').length>=100)throw Error('В лаборатории достигнут лимит 100 существ');
   const [entity]=this.specials.splice(activeIndex,1);
   for(const clan of this.clans)clan.dangerMemory=(clan.dangerMemory||[]).filter(report=>report.kind!=='special'||report.id!==id);
   entity.state='stored';if(entity.carrierId){const carrier=this.bacteria.find(b=>b.id===entity.carrierId);if(carrier)carrier.preyId=null;entity.carrierId=null;}this.specialArchive.push(entity);this.compactStorage();
   this.log(entity.name+' перемещён в лабораторию','special',id);return;
  }
  if(action==='releaseSpecial'){
   if(archivedIndex<0)throw Error('Существо не найдено в лаборатории');
   if(this.specials.length>=10)throw Error('Лимит — 10 активных существ');
   const entity=this.specialArchive[archivedIndex];
   if(entity.state==='dead')throw Error('Погибшее существо нельзя выпустить');
   this.specialArchive.splice(archivedIndex,1);
   entity.x=Math.max(20,Math.min(this.world.width-20,Number(x)||entity.x));
   entity.y=Math.max(20,Math.min(this.world.height-20,Number(y)||entity.y));
   entity.state='active';entity.carrierId=null;this.specials.push(entity);
   this.log(entity.name+' вернулся в мир','special',id);return;
  }
  throw Error('Неизвестное действие');
 }
 stepSpecials(dt){for(const e of this.specials){
  e.immunity=clamp(Number.isFinite(e.immunity)?e.immunity:.4,0,.95);
  e.infection??=0;e.infectionAge??=0;
  if(e.hp>0&&e.state!=='dead'&&e.state!=='consumed'&&e.infection>0){
   e.infectionAge+=dt;e.hp-=dt*.004*(1-e.immunity);
   if(e.infectionAge>1200*(.5+e.immunity)){
    e.infection=0;e.infectionAge=0;e.immunity=Math.min(.95,e.immunity+.035);
    this.log(e.name+' выздоровел','disease',e.id);
   }
   if(e.hp<=0)e.deathReason??='Повреждения от инфекции';
  }
  const moveDt=e.infection>0?dt*.5:dt;
  if(e.hp<=0){e.state='dead';e.deathReason??='Повреждения от инфекции';continue;}

  if(e.kind==='symbiont'&&e.state==='settled'){
   const home=this.clans.find(c=>c.id===e.clanId&&c.members>0);
   if(!home){e.state='active';e.clanId=null;}else{e.age+=dt;e.energy=Math.min(100,Math.max(0,e.energy-dt*specialEnergyPerMinute(e.kind,e.level,'settled')*(Number.isFinite(e.energyDrainMultiplier)?e.energyDrainMultiplier:1)*(e.infection>0?2:1)/60)+(this.season().index!==3?dt*.003:0));e.x=home.x+22+Math.sin(this.time/180+e.id)*8;e.y=home.y+22+Math.cos(this.time/180+e.id)*8;e.action='живёт в гнезде · производит пищу';if(this.time-(e.lastProduce||0)>=90&&e.energy>=18){const produced=Math.min(4+e.level*2,18);this.addToStores(home,produced);e.lastProduce=this.time;e.energy-=Math.min(12,produced*.5);}continue;}
  }
  if(['nutrient','symbiont'].includes(e.kind)&&e.state==='carried'){
   const carrier=this.bacteria.find(b=>b.id===e.carrierId&&b.hp>0);
   if(!carrier){e.state='active';e.carrierId=null;e.action='освободился';}else{e.x=carrier.x;e.y=carrier.y;continue;}
  }
  if(e.state==='consumed'||e.state==='dead')continue;
  if(e.hp<=0){e.state='dead';e.deathReason??='Причина не установлена';continue;}
  e.age+=dt;e.energy=Math.max(0,e.energy-dt*specialEnergyPerMinute(e.kind,e.level)*(Number.isFinite(e.energyDrainMultiplier)?e.energyDrainMultiplier:1)*(e.infection>0?2:1)/60);
  if(!['nutrient','symbiont'].includes(e.kind)){if(e.energy===0){e.hp-=dt*.06;if(e.hp<=0)e.deathReason='Истощение сытости';}else if(e.infection<=0)e.hp=Math.min(e.maxHp,e.hp+dt*.004);}
  if(e.hp<=0){e.state='dead';e.deathReason??='Причина не установлена';continue;}
  e.cooldown=Math.max(0,e.cooldown-dt);
  const target=this.bacteria.reduce((best,b)=>{if(b.hp<=0)return best;const dist=Math.hypot(b.x-e.x,b.y-e.y);return dist<Math.min(best.dist,420+e.level*32)?{b,dist}:best;},{b:null,dist:Infinity});
  const hostile=e.kind==='predator'||e.kind==='titan';
  if(e.kind==='devourer'){
   // Food consumption and biomass belong to the authoritative server simulation.
   // Consume at most one food particle per step, with a bounded reserve and body size.
   let nearest=null,best=Infinity;
   for(const f of this.food){const d=(f.x-e.x)**2+(f.y-e.y)**2;if(d<best){best=d;nearest=f;}}
   if(nearest){const dist=Math.sqrt(best);e.heading=Math.atan2(nearest.y-e.y,nearest.x-e.x);
    if(dist<=Math.max(10,8+Math.sqrt(Math.max(0,e.biomass||0))*.7)){
     const idx=this.food.findIndex(f=>f.id===nearest.id);
     if(idx!==-1){const f=this.food.splice(idx,1)[0],meal=Math.max(1,Number(f.nutrition)||16);
      e.devouredFood=(e.devouredFood||0)+meal;e.biomass=Math.min(700,(e.biomass||0)+meal*.72);
      e.energy=Math.min(100,e.energy+meal*.78);e.hp=Math.min(e.maxHp,e.hp+meal*.09);
      e.action='поглощает пищу и растёт';}
    }else{const mass=Math.max(0,e.biomass||0);const slowdown=1/(1+mass/175);const step=Math.min(dist,moveDt*(14+e.level*.9)*slowdown);e.x+=Math.cos(e.heading)*step;e.y+=Math.sin(e.heading)*step;e.action=mass>=175?'тяжёлый · медленно ищет пищу':'ищет пищу';}
   }else{e.action='голодает · пищи нет';}
   // Even after feeding, constant metabolism gradually consumes stored biomass.
   e.biomass=Math.max(0,(e.biomass||0)-dt*.022);
   if(e.energy<=0){e.hp-=dt*(.24+e.level*.018);if(e.hp<=0)e.deathReason='Голодание: сытость упала до нуля';}
  }
  else if(e.kind==='parasite'){
   const home=this.clans.filter(c=>c.members>0).reduce((best,c)=>{const d=Math.hypot(c.x-e.x,c.y-e.y);return d<(best?.d??Infinity)?{c,d}:best;},null);
   if(home){const c=home.c;if(home.d>Math.max(30,c.nestRadius*.5)){const d=Math.max(.001,home.d),speed=Math.min(d,moveDt*(7+e.level*.7));e.x+=(c.x-e.x)/d*speed;e.y+=(c.y-e.y)/d*speed;e.heading=Math.atan2(c.y-e.y,c.x-e.x);e.action='ищет гнездо';}else{const drain=Math.min(c.stores,dt*(.018+e.level*.009));c.stores-=drain;e.stolenFood=(e.stolenFood||0)+drain;e.energy=Math.min(100,e.energy+drain*.5);e.action='истощает запасы '+c.name;}}
  }
  else 
  if(hostile&&target.b){const b=target.b,dx=b.x-e.x,dy=b.y-e.y,d=Math.max(.01,target.dist),move=Math.min(d,moveDt*(e.kind==='titan'?5+e.level*.65:14+e.level*1.5));e.x+=dx/d*move;e.y+=dy/d*move;e.heading=Math.atan2(dy,dx);e.action='охотится';if(d<19+e.level*2&&e.cooldown===0){b.hp-=4+e.level*1.8;b.lastAttackAt=this.time;b.lastAttackReason='Атака '+e.name+' (лабораторное существо №'+e.id+')';e.cooldown=2.5;e.experience+=2;if(b.hp<=0){e.kills++;e.energy=Math.min(100,e.energy+25);}}}
  else if(e.kind==='guardian'){
   e.homeX??=e.x;e.homeY??=e.y;
   const intruder=target.b&&Math.hypot(target.b.x-e.homeX,target.b.y-e.homeY)<180?target.b:null;
   const tx=intruder?intruder.x:e.homeX,ty=intruder?intruder.y:e.homeY,d=Math.hypot(tx-e.x,ty-e.y);
   if(d>3){const distance=Math.min(d,moveDt*(intruder?18+e.level:12));e.x+=(tx-e.x)/d*distance;e.y+=(ty-e.y)/d*distance;e.heading=Math.atan2(ty-e.y,tx-e.x);}
   e.action=intruder?'защищает территорию':'охраняет пост';
   if(intruder&&d<25&&e.cooldown===0){intruder.hp-=2+e.level*.9;intruder.lastAttackAt=this.time;intruder.lastAttackReason='Атака стража '+e.name+' (лабораторное существо №'+e.id+')';e.cooldown=4;}
  }else{
   if(e.kind==='nutrient'&&target.b&&target.dist<95){e.heading=Math.atan2(e.y-target.b.y,e.x-target.b.x);e.action='убегает от опасности';}
   else if(e.kind==='wanderer'&&target.b&&target.dist<110){e.heading=Math.atan2(e.y-target.b.y,e.x-target.b.x);e.action='избегает колонию';}
   else if(e.cooldown===0){e.heading+=this.range(-1.8,1.8);e.cooldown=['nutrient','symbiont'].includes(e.kind)?8:4;}
   const speed=e.kind==='nutrient'?(target.b&&target.dist<95?9:5):e.kind==='symbiont'?4:11;
   e.x=Math.max(20,Math.min(this.world.width-20,e.x+Math.cos(e.heading)*moveDt*speed));e.y=Math.max(20,Math.min(this.world.height-20,e.y+Math.sin(e.heading)*moveDt*speed));if(!['убегает от опасности','избегает колонию'].includes(e.action))e.action=['nutrient','symbiont'].includes(e.kind)?'мирно пасётся':'странствует';
  }
  if(!['nutrient','symbiont'].includes(e.kind))for(const b of this.bacteria){if(b.hp<=0||!['воин','защитник'].includes(b.role))continue;const d=Math.hypot(b.x-e.x,b.y-e.y);if(d<(e.kind==='devourer'?Math.max(55,Math.min(100,42+Math.sqrt(e.biomass||0)*2)):55)){e.hp-=dt*(b.role==='воин'?2.5:1.5)*b.genes.defense*this.balance.aggression;if(e.hp<=0)e.deathReason='Убит '+(b.role==='воин'?'воином':'защитником')+' колонии '+(this.clans.find(c=>c.id===b.familyId)?.name||'№'+b.familyId);e.action='отбивается';b.action='атакует '+e.name;}}
  // Reproduction consumes stolen food; strict limits protect Render Free and existing boss slots.
  if(e.kind==='parasite'&&e.canReproduce!==false&&e.state==='active'&&e.hp>0&&
     (e.stolenFood||0)>=25&&this.time-(e.lastReproduction||0)>=900&&
     this.specials.length<10&&this.specials.filter(v=>v.kind==='parasite'&&v.state==='active').length<4){
    const child={...e,id:this.nextSpecialId++,name:e.name+' · потомок '+((e.offspring||0)+1),level:Math.max(1,e.level-1),
      x:Math.max(20,Math.min(this.world.width-20,e.x+this.range(-55,55))),
      y:Math.max(20,Math.min(this.world.height-20,e.y+this.range(-55,55))),
      hp:Math.max(35,e.maxHp*.55),maxHp:Math.max(35,e.maxHp*.55),energy:65,age:0,experience:0,kills:0,
      stolenFood:0,offspring:0,parentId:e.id,lastReproduction:this.time,action:'ищет гнездо',cooldown:0};
    e.stolenFood-=25;e.offspring=(e.offspring||0)+1;e.lastReproduction=this.time;
    this.specials.push(child);this.log(e.name+' размножился: появился '+child.name,'special',e.id,child.id);
  }
  if(e.grow&&!['nutrient','symbiont'].includes(e.kind)&&e.experience>=e.level*30&&e.level<10){e.level++;e.experience=0;e.maxHp+=30;e.hp+=30;this.log(e.name+' вырос до уровня '+e.level,'special',e.id);}
 }
 const removed=this.specials.filter(e=>['dead','consumed'].includes(e.state)||e.hp<=0);
 if(removed.length){const removedIds=new Set(removed.map(e=>e.id));
  for(const clan of this.clans)clan.dangerMemory=(clan.dangerMemory||[]).filter(report=>report.kind!=='special'||!removedIds.has(report.id));
  for(const e of removed){if(e.state==='consumed'){/* delivered prey is a resource, not a dead boss in the lab archive */continue;}e.state='dead';e.deathReason??=e.energy<=0?'Истощение сытости':'Полученные повреждения';e.deathAt??=this.time;
    if(e.kind==='devourer'){
     // A single death returns only the remaining biomass, never all food eaten.
     // Bound number and amount of particles, preserve global food cap and ids.
     const available=Math.min(36,this.maxFood-this.food.length,Math.floor(Math.max(0,e.biomass||0)/14));
     const radius=Math.min(160,25+Math.sqrt(Math.max(0,e.biomass||0))*4);
     for(let k=0;k<available;k++){const angle=this.range(0,Math.PI*2),dist=this.range(5,radius);
      this.food.push({id:this.nextFoodId++,x:clamp(e.x+Math.cos(angle)*dist,20,this.world.width-20),y:clamp(e.y+Math.sin(angle)*dist,20,this.world.height-20),nutrition:14,createdAt:this.time});}
     this.log(e.name+' погиб: рассыпалось '+available+' частиц пищи','food',e.id);
    }
    this.specialArchive.push(e);this.log('Погиб '+e.name+': '+e.deathReason,'special',e.id);}this.specials=this.specials.filter(e=>['active','carried','settled'].includes(e.state));this.compactStorage();}
 }
 // Bounded histories: retain high-resolution recent samples and thin older data.
 compactHistory(){
  if(!Array.isArray(this.history)){this.history=[];return;}
  while(this.history.length>5000){
   const recent=this.history.slice(-1000),older=this.history.slice(0,-1000);
   // Sample old records evenly, preserving earliest observation and timeline order.
   const kept=[];const count=Math.min(4000,Math.ceil(older.length/2));
   for(let i=0;i<count;i++)kept.push(older[Math.min(older.length-1,Math.floor(i*older.length/count))]);
   this.history=kept.concat(recent);
  }
 }
 compactLineage(){
  // Retain every currently living bacterium and only the 30 most recent deaths.
  // Deaths are ordered by actual death time, not birth ID. Orphaned historical
  // entries are discarded, while lifetime statistics stay cumulative.
  const aliveIds=new Set(this.bacteria.map(b=>b.id));
  const all=Array.isArray(this.lineage)?this.lineage:[];
  const living=all.filter(e=>e&&e.death==null&&aliveIds.has(e.id));
  const knownIds=new Set(living.map(e=>e.id));
  for(const b of this.bacteria)if(!knownIds.has(b.id)){
   living.push({id:b.id,name:b.name,parentId:b.parentId??null,familyId:b.familyId,born:Math.max(0,this.time-(b.age||0)),role:b.role,death:null});
  }
  const dead=all.filter(e=>e&&Number.isFinite(e.death))
   .sort((a,b)=>a.death-b.death||a.id-b.id).slice(-30);
  this.lineage=dead.concat(living);
 }
 compactStorage(){
  this.events=Array.isArray(this.events)?this.events.slice(-60):[];
  this.compactLineage();
  this.compactHistory();
  this.specialArchive=Array.isArray(this.specialArchive)?this.specialArchive:[];
  // Never silently destroy stored, potentially recoverable creatures.
  const stored=this.specialArchive.filter(e=>e.state!=='dead');
  const dead=this.specialArchive.filter(e=>e.state==='dead');
  this.specialArchive=stored.concat(dead.slice(-Math.max(0,100-stored.length)));
  for(const c of this.clans){
   c.dynasty=Array.isArray(c.dynasty)?c.dynasty.slice(-60):[];
   this.trimColonyMemory(c);
  }
 }
 storageCounts(){return {events:this.events.length,auditLimit:200,history:this.history.length,lineage:this.lineage.length,specialArchive:this.specialArchive.length,storedSpecials:this.specialArchive.filter(e=>e.state!=='dead').length,dynasties:this.clans.reduce((n,c)=>n+(c.dynasty?.length||0),0)};}
 record(){this.history.push({time:this.time,population:this.bacteria.length,clans:this.clans.filter(c=>c.members).length,food:this.food.length,stores:+this.clans.reduce((a,c)=>a+c.stores,0).toFixed(1),births:this.stats.totalBorn,deaths:this.stats.totalDied,intelligence:+(this.bacteria.reduce((a,b)=>a+b.intelligence,0)/Math.max(1,this.bacteria.length)).toFixed(2)});if(this.history.length>5000)this.compactHistory();}
 snapshot(){const alive=this.clans.filter(c=>c.members>0);return{version:6,time:this.time,world:this.world,season:this.season(),stats:{...this.stats,simulationSeconds:this.time,activeClans:alive.length,maxGeneration:Math.max(0,...this.bacteria.map(b=>b.generation)),averageIntelligence:this.bacteria.reduce((sum,b)=>sum+b.intelligence,0)/Math.max(1,this.bacteria.length)},bacteria:this.bacteria.map(b=>({id:b.id,name:b.name,x:+b.x.toFixed(1),y:+b.y.toFixed(1),familyId:b.familyId,familyColor:SPECIES[b.species].color,species:SPECIES[b.species].name,role:b.role,energy:+b.energy.toFixed(1),hp:+b.hp.toFixed(1),ageYears:+(b.age/3600).toFixed(2),generation:b.generation,intelligence:+b.intelligence.toFixed(1),childrenCount:b.childrenCount,totalFood:b.totalFood,genes:b.genes,action:b.action,infected:b.infection>0,immunity:+b.immunity.toFixed(2),carry:+b.carry.toFixed(1),heading:b.heading,isLeader:b.role==='матка'})),clans:alive.map(c=>({...c,speciesName:SPECIES[c.species].name})),food:this.food.map(f=>({id:f.id,x:+f.x.toFixed(1),y:+f.y.toFixed(1)})),events:this.events.slice(-35),history:this.history,specials:this.specials.map(e=>({...e})),diplomacy:this.diplomacy};}
 serialize(){this.compactStorage();return{version:6,foodDistributionVersion:this.foodDistributionVersion,seed:this.seed,time:this.time,nextId:this.nextId,nextFoodId:this.nextFoodId,nextClanId:this.nextClanId,world:this.world,maxPopulation:this.maxPopulation,birthInterval:this.birthInterval,bacteria:this.bacteria,food:this.food,clans:this.clans,stats:this.stats,events:this.events,history:this.history,specials:this.specials,specialArchive:this.specialArchive,nextSpecialId:this.nextSpecialId,lineage:this.lineage,diplomacy:this.diplomacy,balance:this.balance};}
 restore(s){for(const k of ['seed','time','nextId','nextFoodId','nextClanId','world','maxPopulation','birthInterval','bacteria','food','clans','stats','events','history','specials','specialArchive','nextSpecialId','lineage','diplomacy','balance'])if(s[k]!==undefined)this[k]=s[k];if(!Array.isArray(this.bacteria)||!Array.isArray(this.food)||!Array.isArray(this.clans)||!Number.isFinite(this.time))throw Error('Invalid saved world');this.specials??=[];this.specialArchive??=[];for(const e of this.specials){if(['nutrient','symbiont'].includes(e.kind)&&e.state==='carried'&&!this.bacteria.some(b=>b.id===e.carrierId&&b.preyId===e.id)){e.state='active';e.carrierId=null;}}this.lineage??=[];this.events=Array.isArray(this.events)?this.events.slice(-60):[];if(!this.lineage.length)this.lineage=this.bacteria.map(b=>({id:b.id,name:b.name,parentId:b.parentId??null,familyId:b.familyId,born:Math.max(0,this.time-(b.age||0)),role:b.role,death:null}));this.diplomacy??={};this.stats.combatDeaths??=0;for(const c of this.clans){c.nestLevel??=1;c.nestProgress??=0;c.fortification??=0;c.foodMemory??=[];c.dangerMemory??=[];c.dynasty??=[{queenId:c.queenId,name:this.bacteria.find(b=>b.id===c.queenId)?.name||'Неизвестна',from:0,to:null,reason:'восстановленная династия'}];c.heirId??=null;
   // Old saves have no colony overrides; preserve their historical behavior.
   if(!Number.isSafeInteger(c.populationLimit)||c.populationLimit<1||c.populationLimit>this.maxPopulation)c.populationLimit=DEFAULT_COLONY_POP_LIMIT;
   if(c.foodCapacity!==null&&(!Number.isSafeInteger(c.foodCapacity)||c.foodCapacity<0||c.foodCapacity>MAX_COLONY_FOOD_CAPACITY))c.foodCapacity=null;
   if(c.foodCapacity===undefined)c.foodCapacity=null;
  }for(const b of this.bacteria){b.immunity??=.4;b.infection??=0;b.infectionAge??=0;
  if(b.role==='матка'&&!b.queenImmunityInitialized){b.immunity=Math.max(.7,b.immunity);b.queenImmunityInitialized=true;}
 }for(const e of [...this.specials,...this.specialArchive]){
  e.immunity=clamp(Number.isFinite(e.immunity)?e.immunity:.4,0,.95);e.infection??=0;e.infectionAge??=0;
 }this.nextSpecialId??=1;this.balance={birthMultiplier:1,metabolismMultiplier:1,mutationMultiplier:1,aggression:1,...this.balance,roleMetabolism:{...ROLE_METABOLISM_DEFAULTS}};for(const [role,standard] of Object.entries(ROLE_METABOLISM_DEFAULTS)){const restored=s.balance?.roleMetabolism?.[role];if(typeof restored==='number'&&Number.isFinite(restored)&&restored>=.25&&restored<=4)this.balance.roleMetabolism[role]=restored;}for(const c of this.clans)c.nestRadius??=220;for(const f of this.food)f.createdAt??=this.time;this.compactStorage();if(s.foodDistributionVersion!==2){for(const f of this.food){if(this.random()<.77){f.x=this.range(80,this.world.width-80);f.y=this.range(80,this.world.height-80);}}this.foodDistributionVersion=2;this.log('Ресурсы рассредоточены по миру после обновления','system');}for(const b of this.bacteria)if(!Number.isFinite(b.x)||!Number.isFinite(b.energy)||!this.clans.some(c=>c.id===b.familyId))throw Error('Invalid saved organism');}
}
module.exports={World,SPECIES};
