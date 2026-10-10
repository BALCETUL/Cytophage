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
const ROLE_STATS={'матка':{speed:.76,range:120},'собиратель':{speed:1,range:420},'разведчик':{speed:1.32,range:700},'защитник':{speed:.92,range:410},'воин':{speed:1.1,range:500}};
class World {
 constructor({state=null,seed=42,initialFood=1500,maxPopulation=420,birthInterval=3600}={}){
  this.foodDistributionVersion=2;this.version=6;this.seed=seed>>>0;this.time=0;this.world={width:26000,height:26000};this.nextId=1;this.nextFoodId=1;this.nextClanId=1;
  this.seasonLength=5400;this.maxFood=1800;this.maxPopulation=maxPopulation;this.birthInterval=birthInterval;this.bacteria=[];this.food=[];this.clans=[];this.events=[];this.history=[];this.specials=[];this.specialArchive=[];this.nextSpecialId=1;this.lineage=[];this.diplomacy={};this.balance={birthMultiplier:1,metabolismMultiplier:1,mutationMultiplier:1,aggression:1};
  this.stats={totalBorn:0,totalDied:0,totalMutations:0,totalKills:0,totalFood:0,totalEggs:0,starved:0,oldAge:0,startedAt:new Date().toISOString()};
  if(state?.version===6){this.restore(state);return;}
  // Deliberate new genesis for old v5 state. Back up persistent data before upgrading.
  this.foundClan(0,7400,12800);this.foundClan(1,18600,13000);
  this.refill(initialFood);this.record();this.log('Начало мира: появились две бактерии-основательницы','genesis');
 }
 random(){let t=this.seed=(this.seed+0x6d2b79f5)>>>0;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;}
 range(a,b){return a+(b-a)*this.random();}
 name(){const count=2+Math.floor(this.random()*2);let n='';for(let i=0;i<count;i++)n+=SYLL[Math.floor(this.random()*SYLL.length)];return n[0].toUpperCase()+n.slice(1)+'-'+Math.floor(this.range(100,999));}
 log(message,type='life'){this.events.push({simulationTime:this.time,message,type});if(this.events.length>60)this.events.splice(0,this.events.length-60);}
 foundClan(speciesIndex,x,y,parent=null){const id=this.nextClanId++;const species=SPECIES[speciesIndex%SPECIES.length];const c={id,name:species.name+' · '+id,species:speciesIndex%SPECIES.length,color:species.color,x,y,knowledge:parent?parent.knowledge*.4:0,stores:parent?Math.min(50,parent.stores*.2):65,nestRadius:90,nestLevel:1,fortification:0,nestProgress:0,foodMemory:[],dangerMemory:[],dynasty:[],heirId:null,queenId:null,births:0,members:0,kills:0};this.clans.push(c);const queen=this.spawn(c,null,'матка',x,y);c.queenId=queen.id;c.dynasty.push({queenId:queen.id,name:queen.name,from:this.time,to:null,reason:'основательница'});queen.energy=95;queen.nextBirth=this.time+600;this.log(`Основана колония ${c.name}. Геноматра ${queen.name}`,'genesis');return c;}
 spawn(c,parent,role,x,y){const genes=parent?{...parent.genes}:{speed:this.range(.91,1.09),vision:this.range(.91,1.09),metabolism:this.range(.91,1.09),fertility:this.range(.91,1.09),defense:this.range(.91,1.09)};
 let mutated=false;if(parent&&this.random()<Math.min(.75,.16*this.balance.mutationMultiplier)){const key=Object.keys(genes)[Math.floor(this.random()*Object.keys(genes).length)];genes[key]=clamp(genes[key]*this.range(.88,1.12),.6,1.65);this.stats.totalMutations++;mutated=true;}
 const b={id:this.nextId++,name:this.name(),familyId:c.id,species:c.species,role,genes,x:x??c.x,y:y??c.y,heading:this.range(0,Math.PI*2),wanderUntil:0,targetId:null,carry:0,energy:parent?78:95,hp:100,age:0,lifespan:this.range(172800,345600),generation:parent?parent.generation+1:0,parentId:parent?.id??null,experience:parent?parent.experience*.07:0,intelligence:parent?clamp(parent.intelligence+Math.floor(this.range(-3,4)),4,80):Math.floor(this.range(8,17)),immunity:parent?clamp(parent.immunity+this.range(-.06,.06),.05,.95):this.range(.25,.65),infection:0,infectionAge:0,childrenCount:0,totalFood:0,action:'осматривается',nextBirth:Infinity,gestationUntil:0,mutated};this.bacteria.push(b);this.lineage.push({id:b.id,name:b.name,parentId:b.parentId,familyId:b.familyId,born:this.time,role:b.role,death:null});if(this.lineage.length>15000)this.lineage.shift();this.stats.totalBorn++;c.births++;return b;}
 season(){const index=Math.floor(this.time/this.seasonLength)%4;return {index,name:['Весна','Лето','Осень','Зима'][index],progress:(this.time%this.seasonLength)/this.seasonLength,growth:[1.5,1.15,.65,0][index]};}
 refill(count){const season=this.season();if(!season.growth)return;for(let i=0;i<count;i++){const nest=this.clans[Math.floor(this.random()*this.clans.length)];const local=nest&&this.random()<.26;const angle=this.range(0,2*Math.PI),radius=this.range(350,2500);const x=clamp(local?nest.x+Math.cos(angle)*radius:this.range(80,this.world.width-80),80,this.world.width-80),y=clamp(local?nest.y+Math.sin(angle)*radius:this.range(80,this.world.height-80),80,this.world.height-80);this.food.push({id:this.nextFoodId++,x,y,nutrition:this.range(13,22),createdAt:this.time});}}
 nearestFood(b,claims){let nearest=null,best=Infinity;const vision=ROLE_STATS[b.role].range*b.genes.vision*(.85+b.intelligence/90);for(const f of this.food){if(claims.has(f.id))continue;const dx=f.x-b.x,dy=f.y-b.y,d=dx*dx+dy*dy;if(d<vision*vision&&d<best){nearest=f;best=d;}}return nearest;}
 move(b,x,y,dt,speedFactor=1){const dx=x-b.x,dy=y-b.y,d=Math.hypot(dx,dy);if(d<.001)return;const sp=27*SPECIES[b.species].speed*ROLE_STATS[b.role].speed*b.genes.speed*speedFactor;const distance=Math.min(d,sp*dt);b.x=clamp(b.x+dx/d*distance,8,this.world.width-8);b.y=clamp(b.y+dy/d*distance,8,this.world.height-8);b.heading=Math.atan2(dy,dx);}
 step(dt=.25){if(!Number.isFinite(dt)||dt<=0||dt>10)throw Error('Invalid time delta');const previous=this.time;this.time+=dt;const clanMap=new Map(this.clans.map(c=>[c.id,c]));const claims=new Set(),eaten=new Set(),dead=new Set();
 for(const b of this.bacteria){const c=clanMap.get(b.familyId);if(!c){dead.add(b.id);continue;}b.age+=dt;const winter=this.season().index===3;const nestDistance=Math.hypot(b.x-c.x,b.y-c.y);const sheltered=nestDistance<=Math.max(32,c.nestRadius*.6);const roleUse={'матка':.82,'собиратель':1,'разведчик':1.23,'защитник':1.08,'воин':1.33}[b.role]||1;const moving=['идёт к пище','разведывает','возвращается','несёт пищу Геноматре','ловит','охотится','доставляет'].some(a=>b.action?.startsWith(a));const winterShelter=winter&&sheltered;const expenditure=dt*.0105*roleUse*b.genes.metabolism*SPECIES[b.species].metabolism*this.balance.metabolismMultiplier*(winterShelter?.48:(moving?1.16:1));b.energy=Math.max(0,b.energy-expenditure);if(b.energy<18)b.hp-=dt*.025*(1+(18-b.energy)/18);else if(b.energy>72)b.hp=Math.min(100,b.hp+dt*.008);
 // Stored food is accessible to everyone inside the nest, not only to the queen.
 if(sheltered&&b.energy< (winter?92:35)&&c.stores>0){const intake=Math.min(c.stores,dt*(winter?.12:.075),100-b.energy);b.energy+=intake;c.stores-=intake;}
 if(b.infection>0){b.infectionAge+=dt;b.energy-=dt*.0015*b.infection;b.hp-=dt*.004*b.infection*(1-b.immunity);if(b.infectionAge>1200*(.5+b.immunity)){b.infection=0;b.infectionAge=0;b.immunity=Math.min(.95,b.immunity+.035);}}if(b.hp<=0||b.age>b.lifespan){dead.add(b.id);this.stats.totalDied++;if(b.hp<=0)this.stats.starved++;else this.stats.oldAge++;if(c.queenId===b.id){c.queenId=null;const reign=c.dynasty?.at(-1);if(reign&&!reign.to){reign.to=this.time;reign.reason=b.hp<=0?'гибель':'старость';}}continue;}
 if(b.role==='матка'){
  if(b.energy<80&&c.stores>0){const amount=Math.min(c.stores,dt*.09,100-b.energy);b.energy+=amount;c.stores-=amount;}
  // A queen must be alive, mature and supplied. One birth per hour per queen; first child after 10 min.
  if(this.time>=b.nextBirth&&b.age>=600&&b.energy>=62&&c.stores>=23&&this.bacteria.length<this.maxPopulation&&c.members<95){
   const rolls=this.random();const members=this.bacteria.filter(v=>v.familyId===c.id);const workers=members.filter(v=>v.role==='собиратель').length;const guards=members.filter(v=>v.role==='защитник'||v.role==='воин').length;const scouts=members.filter(v=>v.role==='разведчик').length;const needsWorkers=workers<Math.max(1,Math.ceil(members.length*.42));const needsDefense=guards<Math.max(1,Math.floor(members.length*.16));const role=needsWorkers?'собиратель':needsDefense?'защитник':scouts<Math.max(1,Math.floor(members.length*.14))?'разведчик':rolls<.63?'собиратель':rolls<.79?'разведчик':rolls<.93?'защитник':'воин';const baby=this.spawn(c,b,role,b.x+this.range(-12,12),b.y+this.range(-12,12));b.energy-=17;c.stores-=23;b.childrenCount++;b.nextBirth=this.time+this.birthInterval/this.balance.birthMultiplier/clamp(b.genes.fertility,.65,1.65);this.stats.totalEggs++;this.log(`${b.name} породила ${baby.role} ${baby.name} (${c.name})`,'birth');
  }
  // Queens forage only while the colony has no workers.
  if(this.bacteria.some(other=>other.familyId===c.id&&other.role!=='матка')){const a=this.time/150+c.id;this.move(b,c.x+Math.cos(a)*Math.min(32,c.nestRadius*.23),c.y+Math.sin(a)*Math.min(32,c.nestRadius*.23),dt,.22);b.action='осматривает гнездо';continue;}
 }
 // Defenders intercept intruding parasites even in winter; retreat to nest between alerts.
 if(['защитник','воин'].includes(b.role)&&!b.preyId&&b.carry===0){
  const intruder=this.specials.filter(e=>e.kind==='parasite'&&e.state==='active'&&e.hp>0&&
    Math.hypot(e.x-c.x,e.y-c.y)<Math.max(200,c.nestRadius+150))
   .map(e=>({e,d:Math.hypot(e.x-b.x,e.y-b.y)})).sort((a,z)=>a.d-z.d)[0];
  if(intruder&&intruder.d<Math.max(230,c.nestRadius+110)){
   this.move(b,intruder.e.x,intruder.e.y,dt,1.05);b.action='защищает гнездо от '+intruder.e.name;
   // Actual damage is calculated in stepSpecials, never on the client.
   continue;
  }
 }
 if(winter&&b.carry===0&&!b.preyId){b.targetId=null;if(nestDistance>Math.max(22,c.nestRadius*.44)){this.move(b,c.x,c.y,dt,.85);b.action='возвращается на зимовку';}else{b.action=c.stores>0?'зимует · питается запасами':'зимует · запасы закончились';}continue;}
 if(b.preyId){const prey=this.specials.find(e=>e.id===b.preyId&&['nutrient','symbiont'].includes(e.kind)&&e.state==='carried');if(!prey){b.preyId=null;}else{this.move(b,c.x,c.y,dt,.72);prey.x=b.x;prey.y=b.y;prey.action='пойман · доставляется';b.action='доставляет '+prey.name+' в гнездо';if(Math.hypot(b.x-c.x,b.y-c.y)<4){const nutrition=50+prey.level*35;if(prey.kind==='symbiont'){prey.state='settled';prey.clanId=c.id;prey.x=c.x+20;prey.y=c.y+20;prey.carrierId=null;this.log(`${c.name} поселили симбионта ${prey.name}`,'special');}else{c.stores+=nutrition;prey.state='consumed';}b.preyId=null;b.experience+=8;c.knowledge+=.5;if(prey.kind==='nutrient')this.log(`${c.name} доставили ${prey.name} в гнездо (+${nutrition} пищи)`,'food');}}continue;}
 if(b.role==='собиратель'&&b.carry===0){const prey=this.specials.find(e=>['nutrient','symbiont'].includes(e.kind)&&e.state==='active'&&Math.hypot(e.x-b.x,e.y-b.y)<300);if(prey){this.move(b,prey.x,prey.y,dt);b.action='ловит '+prey.name;if(Math.hypot(prey.x-b.x,prey.y-b.y)<8){prey.state='carried';prey.carrierId=b.id;b.preyId=prey.id;b.targetId=null;this.log(b.name+' поймал '+prey.name,'special');}continue;}}
 if(b.carry>0){if(b.energy<32){const bite=Math.min(b.carry,Math.max(0,70-b.energy)*.24);b.carry-=bite;b.energy=Math.min(100,b.energy+bite);b.action='подкрепляется частью добычи';}const queen=this.bacteria.find(q=>q.id===c.queenId);if(queen){this.move(b,c.x,c.y,dt);b.action='несёт пищу Геноматре';if(Math.hypot(b.x-c.x,b.y-c.y)<=2){c.stores+=b.carry;queen.energy=Math.min(100,queen.energy+b.carry*.08);c.nestProgress+=b.carry*.12;b.carry=0;b.experience+=3;c.knowledge+=.12;}}else{c.stores+=b.carry;b.carry=0;}continue;}
 // Only gatherers transport food. Other roles have their own jobs, including
 // individuals restored from older saves (existing cargo was delivered above).
 if(b.role!=='собиратель'&&b.role!=='матка'){
  b.targetId=null;
  if(b.role==='разведчик'){
   if(this.time>b.wanderUntil){b.heading+=this.range(-1.4,1.4);b.wanderUntil=this.time+this.range(8,22);}
   const far=Math.hypot(b.x-c.x,b.y-c.y)>1900+b.intelligence*14;
   if(far){this.move(b,c.x,c.y,dt,.85);b.action='возвращается после разведки';}
   else{this.move(b,b.x+Math.cos(b.heading)*180,b.y+Math.sin(b.heading)*180,dt,.88);b.action='разведывает территорию';}
  }else{
   // Soldiers patrol around the nest; hostile parasites are intercepted above.
   const radius=Math.min(c.nestRadius*.7,b.role==='воин'?110:75);
   if(this.time>b.wanderUntil){b.heading=this.range(-Math.PI,Math.PI);b.wanderUntil=this.time+this.range(7,16);}
   if(nestDistance>radius*1.4)this.move(b,c.x,c.y,dt,.85);
   else this.move(b,c.x+Math.cos(b.heading)*radius,c.y+Math.sin(b.heading)*radius,dt,.45);
   b.action='патрулирует гнездо';
  }
  continue;
 }
 let target=this.food.find(f=>f.id===b.targetId&&!eaten.has(f.id));if(target&&Math.hypot(target.x-b.x,target.y-b.y)>ROLE_STATS[b.role].range*b.genes.vision*2)target=null;if(!target){target=this.nearestFood(b,claims);b.targetId=target?.id??null;}if(target){claims.add(target.id);this.move(b,target.x,target.y,dt);b.action='идёт к пище';if(Math.hypot(target.x-b.x,target.y-b.y)<=2){eaten.add(target.id);b.targetId=null;b.totalFood++;this.stats.totalFood++;b.experience+=1.8;b.intelligence=Math.min(90,b.intelligence+0.025);c.knowledge+=.05;if(b.intelligence>12){c.foodMemory.push({x:target.x,y:target.y,at:this.time});if(c.foodMemory.length>12)c.foodMemory.shift();}if(b.role==='матка'){b.energy=Math.min(100,b.energy+target.nutrition);}else{b.energy=Math.min(100,b.energy+target.nutrition*.34);b.carry=target.nutrition*.66;}b.action='поглощает пищу';}continue;}
 // Intelligence affects exploration range, retained target choice and the ability to track resources.
 if(this.time>b.wanderUntil){b.heading+=this.range(-2.1,2.1);b.wanderUntil=this.time+this.range(5,18)*(1+b.intelligence/100);}
 const memory=c.foodMemory?.findLast(m=>this.time-m.at<2100&&Math.hypot(m.x-b.x,m.y-b.y)<2200);if(memory&&b.intelligence>18&&this.random()<.12*dt){b.heading=Math.atan2(memory.y-b.y,memory.x-b.x);b.wanderUntil=this.time+this.range(25,60);}const distanceFromQueen=Math.hypot(b.x-c.x,b.y-c.y);if(distanceFromQueen>1700+b.intelligence*18){this.move(b,c.x,c.y,dt,.85);b.action='возвращается';}else{this.move(b,b.x+Math.cos(b.heading)*180,b.y+Math.sin(b.heading)*180,dt,.65);b.action='разведывает';}
 }
 if(dead.size){this.bacteria=this.bacteria.filter(b=>!dead.has(b.id));for(const entry of this.lineage)if(dead.has(entry.id))entry.death=this.time;}
 if(eaten.size)this.food=this.food.filter(f=>!eaten.has(f.id));
 // Combat only on actual physical contact between rival soldiers and enemies.
 for(const a of this.bacteria){if(a.role!=='воин'&&a.role!=='защитник')continue;const enemy=this.bacteria.find(b=>b.familyId!==a.familyId&&Math.hypot(b.x-a.x,b.y-a.y)<14);if(!enemy||this.relation(a.familyId,enemy.familyId)==='союз')continue;enemy.hp-=dt*this.balance.aggression*(a.role==='воин'?2.2:1.1)*a.genes.defense*SPECIES[a.species].defense;a.action='защищает территорию';if(enemy.hp<=0){clanMap.get(a.familyId).kills++;this.stats.totalKills++;}}
 this.stepSpecials(dt);
 for(const c of this.clans){const living=this.bacteria.filter(b=>b.familyId===c.id);c.members=living.length;const queen=living.find(b=>b.id===c.queenId);if(queen){if(queen.age>queen.lifespan*.72&&!c.heirId&&living.length>=8){const heirs=living.filter(b=>b.id!==queen.id&&b.role!=='матка');heirs.sort((a,b)=>(b.intelligence+b.immunity*25)-(a.intelligence+a.immunity*25));if(heirs.length){c.heirId=heirs[0].id;this.log(c.name+': определена наследница '+heirs[0].name,'dynasty');}}queen.x=clamp(queen.x,c.x-c.nestRadius*.55,c.x+c.nestRadius*.55);queen.y=clamp(queen.y,c.y-c.nestRadius*.55,c.y+c.nestRadius*.55);}else if(living.length&&living.length>=6){const heir=living.find(b=>b.id===c.heirId)||living.reduce((best,b)=>b.intelligence>best.intelligence?b:best);heir.role='матка';c.heirId=null;c.dynasty??=[];c.dynasty.push({queenId:heir.id,name:heir.name,from:this.time,to:null,reason:'преемница'});if(c.dynasty.length>60)c.dynasty.shift();heir.nextBirth=this.time+this.birthInterval;c.queenId=heir.id;this.log(`${heir.name} стала новой Геноматрой ${c.name}`,'life');}}
 if(Math.floor(this.time/20)>Math.floor(previous/20)){const growth=this.season().growth;this.refill(Math.max(0,Math.min(Math.ceil(10*growth),this.maxFood-this.food.length)));if(this.season().index===3) this.food=this.food.filter(f=>this.random()<.96);}
 if(Math.floor(this.time/20)>Math.floor(previous/20))this.spreadDisease();if(Math.floor(this.time/60)>Math.floor(previous/60)){this.updateCivilization();this.record();this.maybeBud();}
 }
 relation(a,b){if(a===b)return 'союз';return this.diplomacy[[a,b].sort((x,y)=>x-y).join(':')]?.status||'нейтралитет';}
 setRelation(a,b,status){if(a===b||!this.clans.some(c=>c.id===a)||!this.clans.some(c=>c.id===b))throw Error('Выбери две разные колонии');if(!['нейтралитет','союз','конкуренция','война','перемирие'].includes(status))throw Error('Недопустимое отношение');const key=[a,b].sort((x,y)=>x-y).join(':');this.diplomacy[key]={status,updated:this.time};this.log(`Отношения колоний №${a} и №${b}: ${status}`,'diplomacy');}
 updateCivilization(){for(const c of this.clans){if(!c.members)continue;c.nestProgress??=0;c.fortification??=0;c.nestLevel??=1;c.dynasty??=[];c.foodMemory??=[];c.dangerMemory??=[];const workers=this.bacteria.filter(b=>b.familyId===c.id&&b.role==='собиратель').length;const cost=Math.min(c.stores*.012,workers*.04);c.stores=Math.max(0,c.stores-cost);c.nestProgress+=cost*.7;if(c.nestProgress>=80*c.nestLevel&&c.nestLevel<8){c.nestProgress=0;c.nestLevel++;c.nestRadius=90+35*c.nestLevel;c.fortification=Math.min(.45,c.fortification+.04);this.log(`${c.name}: гнездо выросло до уровня ${c.nestLevel}`,'construction');}c.foodMemory=c.foodMemory.filter(m=>this.time-m.at<3600).slice(-12);}
 for(let i=0;i<this.clans.length;i++)for(let j=i+1;j<this.clans.length;j++){const a=this.clans[i],b=this.clans[j];if(!a.members||!b.members)continue;const key=[a.id,b.id].join(':');if(this.diplomacy[key])continue;const dist=Math.hypot(a.x-b.x,a.y-b.y);if(dist<2800&&a.stores<40&&b.stores<40)this.setRelation(a.id,b.id,'конкуренция');}}
 spreadDisease(){const infected=this.bacteria.filter(b=>b.infection>0);if(!infected.length&&this.bacteria.length>12&&this.random()<.003){const b=this.bacteria[Math.floor(this.random()*this.bacteria.length)];if(b){b.infection=1;b.infectionAge=0;this.log('Обнаружена инфекция у '+b.name,'disease');}}for(const sick of infected){if(sick.infectionAge<60)continue;for(const healthy of this.bacteria){if(healthy.infection>0||healthy.id===sick.id)continue;if(Math.abs(healthy.x-sick.x)>35||Math.abs(healthy.y-sick.y)>35)continue;if(this.random()<.045*(1-healthy.immunity)){healthy.infection=1;healthy.infectionAge=0;}}}}
 maybeBud(){// New colonies arise only after substantial growth, resources and maturity.
 if(this.clans.length>=18)return;const candidate=this.clans.find(c=>c.members>=65&&c.stores>=280&&c.knowledge>=70);if(!candidate)return;const species=candidate.species;const angle=this.range(0,Math.PI*2);const x=clamp(candidate.x+Math.cos(angle)*4200,400,this.world.width-400),y=clamp(candidate.y+Math.sin(angle)*4200,400,this.world.height-400);candidate.stores-=110;this.foundClan(species,x,y,candidate);this.log(`${candidate.name} основала дочернюю колонию`,'branch');}
 createSpecial(config){if(this.specials.length>=10)throw Error('Не больше 10 существ одновременно');const kind=['predator','titan','wanderer','guardian','nutrient','symbiont','parasite','devourer'].includes(config.kind)?config.kind:'predator';const name=String(config.name||'Особь '+this.nextSpecialId).trim();if(name.length<2||name.length>48||/[<>\x00-\x1f]/.test(name))throw Error('Неверное имя');const icon=String(config.icon||'👾');if(!["👾","🦠","🧬","🧫","🔬","⚗️","🧪","💉","🩸","🫀","🧠","👁️","👀","🫁","🦴","🦷","🫧","💧","💦","🌀","⚛️","☣️","☢️","🧿","🪬","🐙","🪼","🦑","🦀","🦞","🦐","🦪","🐚","🪸","🐌","🪱","🐛","🦋","🐜","🐝","🪲","🐞","🦗","🪳","🕷️","🕸️","🦂","🦟","🪰","🐍","🦎","🐢","🐸","🐡","🦈","🐟","🐠","🐲","🐉","🦖","🦕","🦇","🦔","🐺","🦊","🐀","👽","👻","👹","👺","💀","☠️","😈","👿","🤖","🤡","🎭","🧟","🧛","🧙","🧚","🧞","🧌","🦄","🦾","🛸","🚀","🌌","🪐","🔮","🪄","🗿","👑","🌱","🌿","🍀","☘️","🍃","🍂","🍁","🌵","🍄","🍄‍🟫","🪷","🌸","🌺","🌻","🌾","🌳","🌲","🌴","🪨","🪵","🌊","🌫️","❄️","🌨️","🌪️","☄️","🌑","🌕","🌙","⭐","🌟","🌠","🌈","🔥","⚡","💥","💫","✨","💢","💯","🌡️","🔋","🪫","💡","🔆","🧲","⚙️","🛡️","⚔️","🗡️","🔱","💎","🪙","🟢","🔴","🟡","🟣","🔵","🧊","🕳️","♻️","🍇","🍒","🍓","🫐","🍏","🍎","🍐","🍑","🥑","🍅","🥕","🌽","🥦","🥬","🫘","🥜","🌰","🍖","🥩","🥚","🧀","🍯","🍬","🍭","🍋","🥝","🍊","🍉","🍍","🥥"].includes(icon))throw Error('Недопустимый значок');const level=Number(config.level);if(!Number.isInteger(level)||level<1||level>10)throw Error('Уровень от 1 до 10');const id=this.nextSpecialId++;const hp=['nutrient','symbiont'].includes(kind)?35+level*12:100+level*(kind==='titan'?90:35);const foodNest=['nutrient','symbiont','parasite'].includes(kind)?this.clans[Math.floor(this.random()*this.clans.length)]:null;const spawnAngle=this.range(0,Math.PI*2),spawnDistance=kind==='parasite'?(foodNest?.nestRadius||220)+this.range(180,320):this.range(30,220);const foodX=foodNest?foodNest.x+Math.cos(spawnAngle)*spawnDistance:this.world.width/2,foodY=foodNest?foodNest.y+Math.sin(spawnAngle)*spawnDistance:this.world.height/2;const foodStart=kind==='devourer'&&this.food.length?this.food[Math.floor(this.random()*this.food.length)]:null;const entity={id,name,icon,kind,level,x:Math.max(20,Math.min(this.world.width-20,Number(config.x)||(foodStart?.x??foodX))),y:Math.max(20,Math.min(this.world.height-20,Number(config.y)||(foodStart?.y??foodY))),hp,maxHp:hp,energy:100,age:0,experience:0,kills:0,genes:{speed:1,defense:1},grow:config.grow!==false,canReproduce:kind==='parasite',stolenFood:0,devouredFood:0,biomass:0,offspring:0,parentId:null,lastReproduction:this.time,homeX:null,homeY:null,clanId:null,lastProduce:0,state:'active',action:'исследует',heading:this.range(0,Math.PI*2),cooldown:0};this.specials.push(entity);this.log('Появилось особое существо '+name,'special');return entity;}
 specialCommand(action,id,x,y){
  // Archived and active creatures are separate collections. Deletion must find both.
  const activeIndex=this.specials.findIndex(e=>e.id===id);
  const archivedIndex=this.specialArchive.findIndex(e=>e.id===id);
  if(action==='deleteSpecial'){
   if(activeIndex<0&&archivedIndex<0)throw Error('Существо не найдено ни в мире, ни в лаборатории');
   const list=activeIndex>=0?this.specials:this.specialArchive;
   const index=activeIndex>=0?activeIndex:archivedIndex;
   const [entity]=list.splice(index,1);
   if(entity.carrierId){const carrier=this.bacteria.find(b=>b.id===entity.carrierId);if(carrier)carrier.preyId=null;}this.log(entity.name+' удалён администратором','special');
   return;
  }
  if(action==='storeSpecial'){
   if(activeIndex<0)throw Error('Существо не найдено среди активных');
   if(this.specialArchive.filter(item=>item.state!=='dead').length>=100)throw Error('В лаборатории достигнут лимит 100 существ');
   const [entity]=this.specials.splice(activeIndex,1);entity.state='stored';if(entity.carrierId){const carrier=this.bacteria.find(b=>b.id===entity.carrierId);if(carrier)carrier.preyId=null;entity.carrierId=null;}this.specialArchive.push(entity);this.compactStorage();
   this.log(entity.name+' перемещён в лабораторию','special');return;
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
   this.log(entity.name+' вернулся в мир','special');return;
  }
  throw Error('Неизвестное действие');
 }
 stepSpecials(dt){for(const e of this.specials){
  if(e.kind==='symbiont'&&e.state==='settled'){
   const home=this.clans.find(c=>c.id===e.clanId&&c.members>0);
   if(!home){e.state='active';e.clanId=null;}else{e.age+=dt;e.energy=Math.min(100,Math.max(0,e.energy-dt*.002)+(this.season().index!==3?dt*.003:0));e.x=home.x+22+Math.sin(this.time/180+e.id)*8;e.y=home.y+22+Math.cos(this.time/180+e.id)*8;e.action='живёт в гнезде · производит пищу';if(this.time-(e.lastProduce||0)>=90&&e.energy>=18){const produced=Math.min(4+e.level*2,18);home.stores+=produced;e.lastProduce=this.time;e.energy-=Math.min(12,produced*.5);}continue;}
  }
  if(['nutrient','symbiont'].includes(e.kind)&&e.state==='carried'){
   const carrier=this.bacteria.find(b=>b.id===e.carrierId&&b.hp>0);
   if(!carrier){e.state='active';e.carrierId=null;e.action='освободился';}else{e.x=carrier.x;e.y=carrier.y;continue;}
  }
  if(e.state==='consumed'||e.state==='dead')continue;
  if(e.hp<=0){e.state='dead';continue;}
  e.age+=dt;e.energy=Math.max(0,e.energy-dt*(e.kind==='devourer'?(0.19+e.level*.025):.007*(1+e.level*.12)));
  if(!['nutrient','symbiont'].includes(e.kind)){if(e.energy===0)e.hp-=dt*.06;else e.hp=Math.min(e.maxHp,e.hp+dt*.004);}
  if(e.hp<=0){e.state='dead';continue;}
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
    }else{const step=Math.min(dist,dt*(14+e.level*.9));e.x+=Math.cos(e.heading)*step;e.y+=Math.sin(e.heading)*step;e.action='ищет пищу';}
   }else{e.action='голодает · пищи нет';}
   // Even after feeding, constant metabolism gradually consumes stored biomass.
   e.biomass=Math.max(0,(e.biomass||0)-dt*.022);
   if(e.energy<=0)e.hp-=dt*(.24+e.level*.018);
  }
  else if(e.kind==='parasite'){
   const home=this.clans.filter(c=>c.members>0).reduce((best,c)=>{const d=Math.hypot(c.x-e.x,c.y-e.y);return d<(best?.d??Infinity)?{c,d}:best;},null);
   if(home){const c=home.c;if(home.d>Math.max(30,c.nestRadius*.5)){const d=Math.max(.001,home.d),speed=Math.min(d,dt*(7+e.level*.7));e.x+=(c.x-e.x)/d*speed;e.y+=(c.y-e.y)/d*speed;e.heading=Math.atan2(c.y-e.y,c.x-e.x);e.action='ищет гнездо';}else{const drain=Math.min(c.stores,dt*(.018+e.level*.009));c.stores-=drain;e.stolenFood=(e.stolenFood||0)+drain;e.energy=Math.min(100,e.energy+drain*.5);e.action='истощает запасы '+c.name;}}
  }
  else 
  if(hostile&&target.b){const b=target.b,dx=b.x-e.x,dy=b.y-e.y,d=Math.max(.01,target.dist),move=Math.min(d,dt*(e.kind==='titan'?5+e.level*.65:14+e.level*1.5));e.x+=dx/d*move;e.y+=dy/d*move;e.heading=Math.atan2(dy,dx);e.action='охотится';if(d<19+e.level*2&&e.cooldown===0){b.hp-=4+e.level*1.8;e.cooldown=2.5;e.experience+=2;if(b.hp<=0){e.kills++;e.energy=Math.min(100,e.energy+25);}}}
  else if(e.kind==='guardian'){
   e.homeX??=e.x;e.homeY??=e.y;
   const intruder=target.b&&Math.hypot(target.b.x-e.homeX,target.b.y-e.homeY)<180?target.b:null;
   const tx=intruder?intruder.x:e.homeX,ty=intruder?intruder.y:e.homeY,d=Math.hypot(tx-e.x,ty-e.y);
   if(d>3){const distance=Math.min(d,dt*(intruder?18+e.level:12));e.x+=(tx-e.x)/d*distance;e.y+=(ty-e.y)/d*distance;e.heading=Math.atan2(ty-e.y,tx-e.x);}
   e.action=intruder?'защищает территорию':'охраняет пост';
   if(intruder&&d<25&&e.cooldown===0){intruder.hp-=2+e.level*.9;e.cooldown=4;}
  }else{
   if(e.kind==='nutrient'&&target.b&&target.dist<95){e.heading=Math.atan2(e.y-target.b.y,e.x-target.b.x);e.action='убегает от опасности';}
   else if(e.kind==='wanderer'&&target.b&&target.dist<110){e.heading=Math.atan2(e.y-target.b.y,e.x-target.b.x);e.action='избегает колонию';}
   else if(e.cooldown===0){e.heading+=this.range(-1.8,1.8);e.cooldown=['nutrient','symbiont'].includes(e.kind)?8:4;}
   const speed=e.kind==='nutrient'?(target.b&&target.dist<95?9:5):e.kind==='symbiont'?4:11;
   e.x=Math.max(20,Math.min(this.world.width-20,e.x+Math.cos(e.heading)*dt*speed));e.y=Math.max(20,Math.min(this.world.height-20,e.y+Math.sin(e.heading)*dt*speed));if(!['убегает от опасности','избегает колонию'].includes(e.action))e.action=['nutrient','symbiont'].includes(e.kind)?'мирно пасётся':'странствует';
  }
  if(!['nutrient','symbiont'].includes(e.kind))for(const b of this.bacteria){if(b.hp<=0||!['воин','защитник'].includes(b.role))continue;const d=Math.hypot(b.x-e.x,b.y-e.y);if(d<(e.kind==='devourer'?Math.max(55,Math.min(100,42+Math.sqrt(e.biomass||0)*2)):55)){e.hp-=dt*(b.role==='воин'?2.5:1.5)*b.genes.defense*this.balance.aggression;e.action='отбивается';b.action='атакует '+e.name;}}
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
    this.specials.push(child);this.log(e.name+' размножился: появился '+child.name,'special');
  }
  if(e.grow&&!['nutrient','symbiont'].includes(e.kind)&&e.experience>=e.level*30&&e.level<10){e.level++;e.experience=0;e.maxHp+=30;e.hp+=30;this.log(e.name+' вырос до уровня '+e.level,'special');}
 }
 const removed=this.specials.filter(e=>['dead','consumed'].includes(e.state)||e.hp<=0);
 if(removed.length){for(const e of removed){if(e.state==='consumed'){/* delivered prey is a resource, not a dead boss in the lab archive */continue;}e.state='dead';
    if(e.kind==='devourer'){
     // A single death returns only the remaining biomass, never all food eaten.
     // Bound number and amount of particles, preserve global food cap and ids.
     const available=Math.min(36,this.maxFood-this.food.length,Math.floor(Math.max(0,e.biomass||0)/14));
     const radius=Math.min(160,25+Math.sqrt(Math.max(0,e.biomass||0))*4);
     for(let k=0;k<available;k++){const angle=this.range(0,Math.PI*2),dist=this.range(5,radius);
      this.food.push({id:this.nextFoodId++,x:clamp(e.x+Math.cos(angle)*dist,20,this.world.width-20),y:clamp(e.y+Math.sin(angle)*dist,20,this.world.height-20),nutrition:14,createdAt:this.time});}
     this.log(e.name+' погиб: рассыпалось '+available+' частиц пищи','food');
    }
    this.specialArchive.push(e);this.log('Погиб '+e.name,'special');}this.specials=this.specials.filter(e=>['active','carried','settled'].includes(e.state));this.compactStorage();}
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
 compactStorage(){
  this.events=Array.isArray(this.events)?this.events.slice(-60):[];
  this.lineage=Array.isArray(this.lineage)?this.lineage.slice(-15000):[];
  this.compactHistory();
  this.specialArchive=Array.isArray(this.specialArchive)?this.specialArchive:[];
  // Never silently destroy stored, potentially recoverable creatures.
  const stored=this.specialArchive.filter(e=>e.state!=='dead');
  const dead=this.specialArchive.filter(e=>e.state==='dead');
  this.specialArchive=stored.concat(dead.slice(-Math.max(0,100-stored.length)));
  for(const c of this.clans){
   c.dynasty=Array.isArray(c.dynasty)?c.dynasty.slice(-60):[];
   c.foodMemory=Array.isArray(c.foodMemory)?c.foodMemory.slice(-12):[];
   c.dangerMemory=Array.isArray(c.dangerMemory)?c.dangerMemory.slice(-12):[];
  }
 }
 storageCounts(){return {events:this.events.length,auditLimit:200,history:this.history.length,lineage:this.lineage.length,specialArchive:this.specialArchive.length,storedSpecials:this.specialArchive.filter(e=>e.state!=='dead').length,dynasties:this.clans.reduce((n,c)=>n+(c.dynasty?.length||0),0)};}
 record(){this.history.push({time:this.time,population:this.bacteria.length,clans:this.clans.filter(c=>c.members).length,food:this.food.length,stores:+this.clans.reduce((a,c)=>a+c.stores,0).toFixed(1),births:this.stats.totalBorn,deaths:this.stats.totalDied,intelligence:+(this.bacteria.reduce((a,b)=>a+b.intelligence,0)/Math.max(1,this.bacteria.length)).toFixed(2)});if(this.history.length>5000)this.compactHistory();}
 snapshot(){const alive=this.clans.filter(c=>c.members>0);return{version:6,time:this.time,world:this.world,season:this.season(),stats:{...this.stats,simulationSeconds:this.time,activeClans:alive.length,maxGeneration:Math.max(0,...this.bacteria.map(b=>b.generation)),averageIntelligence:this.bacteria.reduce((sum,b)=>sum+b.intelligence,0)/Math.max(1,this.bacteria.length)},bacteria:this.bacteria.map(b=>({id:b.id,name:b.name,customName:!!b.originalName,x:+b.x.toFixed(1),y:+b.y.toFixed(1),familyId:b.familyId,familyColor:SPECIES[b.species].color,species:SPECIES[b.species].name,role:b.role,energy:+b.energy.toFixed(1),hp:+b.hp.toFixed(1),ageYears:+(b.age/3600).toFixed(2),generation:b.generation,intelligence:+b.intelligence.toFixed(1),childrenCount:b.childrenCount,totalFood:b.totalFood,genes:b.genes,action:b.action,infected:b.infection>0,immunity:+b.immunity.toFixed(2),carry:+b.carry.toFixed(1),heading:b.heading,isLeader:b.role==='матка'})),clans:alive.map(c=>({...c,speciesName:SPECIES[c.species].name})),food:this.food.map(f=>({id:f.id,x:+f.x.toFixed(1),y:+f.y.toFixed(1)})),events:this.events.slice(-35),history:this.history,specials:this.specials.map(e=>({...e})),diplomacy:this.diplomacy};}
 serialize(){this.compactStorage();return{version:6,foodDistributionVersion:this.foodDistributionVersion,seed:this.seed,time:this.time,nextId:this.nextId,nextFoodId:this.nextFoodId,nextClanId:this.nextClanId,world:this.world,maxPopulation:this.maxPopulation,birthInterval:this.birthInterval,bacteria:this.bacteria,food:this.food,clans:this.clans,stats:this.stats,events:this.events,history:this.history,specials:this.specials,specialArchive:this.specialArchive,nextSpecialId:this.nextSpecialId,lineage:this.lineage,diplomacy:this.diplomacy,balance:this.balance};}
 restore(s){for(const k of ['seed','time','nextId','nextFoodId','nextClanId','world','maxPopulation','birthInterval','bacteria','food','clans','stats','events','history','specials','specialArchive','nextSpecialId','lineage','diplomacy','balance'])if(s[k]!==undefined)this[k]=s[k];if(!Array.isArray(this.bacteria)||!Array.isArray(this.food)||!Array.isArray(this.clans)||!Number.isFinite(this.time))throw Error('Invalid saved world');this.specials??=[];this.specialArchive??=[];for(const e of this.specials){if(['nutrient','symbiont'].includes(e.kind)&&e.state==='carried'&&!this.bacteria.some(b=>b.id===e.carrierId&&b.preyId===e.id)){e.state='active';e.carrierId=null;}}this.lineage??=[];this.events=Array.isArray(this.events)?this.events.slice(-60):[];if(!this.lineage.length)this.lineage=this.bacteria.map(b=>({id:b.id,name:b.name,parentId:b.parentId??null,familyId:b.familyId,born:Math.max(0,this.time-(b.age||0)),role:b.role,death:null}));this.diplomacy??={};for(const c of this.clans){c.nestLevel??=1;c.nestProgress??=0;c.fortification??=0;c.foodMemory??=[];c.dangerMemory??=[];c.dynasty??=[{queenId:c.queenId,name:this.bacteria.find(b=>b.id===c.queenId)?.name||'Неизвестна',from:0,to:null,reason:'восстановленная династия'}];c.heirId??=null;}for(const b of this.bacteria){b.immunity??=.4;b.infection??=0;b.infectionAge??=0;}this.nextSpecialId??=1;this.balance={birthMultiplier:1,metabolismMultiplier:1,mutationMultiplier:1,aggression:1,...this.balance};for(const c of this.clans)c.nestRadius??=220;for(const f of this.food)f.createdAt??=this.time;this.compactStorage();if(s.foodDistributionVersion!==2){for(const f of this.food){if(this.random()<.77){f.x=this.range(80,this.world.width-80);f.y=this.range(80,this.world.height-80);}}this.foodDistributionVersion=2;this.log('Ресурсы рассредоточены по миру после обновления','system');}for(const b of this.bacteria)if(!Number.isFinite(b.x)||!Number.isFinite(b.energy)||!this.clans.some(c=>c.id===b.familyId))throw Error('Invalid saved organism');}
}
module.exports={World,SPECIES};
