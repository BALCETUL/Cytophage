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
  this.seasonLength=5400;this.maxFood=1800;this.maxPopulation=maxPopulation;this.birthInterval=birthInterval;this.bacteria=[];this.food=[];this.clans=[];this.events=[];this.history=[];
  this.stats={totalBorn:0,totalDied:0,totalMutations:0,totalKills:0,totalFood:0,totalEggs:0,starved:0,oldAge:0,startedAt:new Date().toISOString()};
  if(state?.version===6){this.restore(state);return;}
  // Deliberate new genesis for old v5 state. Back up persistent data before upgrading.
  this.foundClan(0,7400,12800);this.foundClan(1,18600,13000);
  this.refill(initialFood);this.record();this.log('Начало мира: появились две бактерии-основательницы','genesis');
 }
 random(){let t=this.seed=(this.seed+0x6d2b79f5)>>>0;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;}
 range(a,b){return a+(b-a)*this.random();}
 name(){const count=2+Math.floor(this.random()*2);let n='';for(let i=0;i<count;i++)n+=SYLL[Math.floor(this.random()*SYLL.length)];return n[0].toUpperCase()+n.slice(1)+'-'+Math.floor(this.range(100,999));}
 log(message,type='life'){this.events.push({simulationTime:this.time,message,type});if(this.events.length>100)this.events.shift();}
 foundClan(speciesIndex,x,y,parent=null){const id=this.nextClanId++;const species=SPECIES[speciesIndex%SPECIES.length];const c={id,name:species.name+' · '+id,species:speciesIndex%SPECIES.length,color:species.color,x,y,knowledge:parent?parent.knowledge*.4:0,stores:parent?Math.min(50,parent.stores*.2):65,nestRadius:220,queenId:null,births:0,members:0,kills:0};this.clans.push(c);const queen=this.spawn(c,null,'матка',x,y);c.queenId=queen.id;queen.energy=95;queen.nextBirth=this.time+600;this.log(`Основана колония ${c.name}. Матка ${queen.name}`,'genesis');return c;}
 spawn(c,parent,role,x,y){const genes=parent?{...parent.genes}:{speed:this.range(.91,1.09),vision:this.range(.91,1.09),metabolism:this.range(.91,1.09),fertility:this.range(.91,1.09),defense:this.range(.91,1.09)};
 let mutated=false;if(parent&&this.random()<.16){const key=Object.keys(genes)[Math.floor(this.random()*5)];genes[key]=clamp(genes[key]*this.range(.88,1.12),.6,1.65);this.stats.totalMutations++;mutated=true;}
 const b={id:this.nextId++,name:this.name(),familyId:c.id,species:c.species,role,genes,x:x??c.x,y:y??c.y,heading:this.range(0,Math.PI*2),wanderUntil:0,targetId:null,carry:0,energy:parent?78:95,hp:100,age:0,lifespan:this.range(172800,345600),generation:parent?parent.generation+1:0,parentId:parent?.id??null,experience:parent?parent.experience*.07:0,intelligence:parent?clamp(parent.intelligence+Math.floor(this.range(-3,4)),4,80):Math.floor(this.range(8,17)),childrenCount:0,totalFood:0,action:'осматривается',nextBirth:Infinity,gestationUntil:0,mutated};this.bacteria.push(b);this.stats.totalBorn++;c.births++;return b;}
 season(){const index=Math.floor(this.time/this.seasonLength)%4;return {index,name:['Весна','Лето','Осень','Зима'][index],progress:(this.time%this.seasonLength)/this.seasonLength,growth:[1.5,1.15,.65,0][index]};}
 refill(count){const season=this.season();if(!season.growth)return;for(let i=0;i<count;i++){const nest=this.clans[Math.floor(this.random()*this.clans.length)];const local=nest&&this.random()<.26;const angle=this.range(0,2*Math.PI),radius=this.range(350,2500);const x=clamp(local?nest.x+Math.cos(angle)*radius:this.range(80,this.world.width-80),80,this.world.width-80),y=clamp(local?nest.y+Math.sin(angle)*radius:this.range(80,this.world.height-80),80,this.world.height-80);this.food.push({id:this.nextFoodId++,x,y,nutrition:this.range(13,22),createdAt:this.time});}}
 nearestFood(b,claims){let nearest=null,best=Infinity;const vision=ROLE_STATS[b.role].range*b.genes.vision*(.85+b.intelligence/90);for(const f of this.food){if(claims.has(f.id))continue;const dx=f.x-b.x,dy=f.y-b.y,d=dx*dx+dy*dy;if(d<vision*vision&&d<best){nearest=f;best=d;}}return nearest;}
 move(b,x,y,dt,speedFactor=1){const dx=x-b.x,dy=y-b.y,d=Math.hypot(dx,dy);if(d<.001)return;const sp=27*SPECIES[b.species].speed*ROLE_STATS[b.role].speed*b.genes.speed*speedFactor;const distance=Math.min(d,sp*dt);b.x=clamp(b.x+dx/d*distance,8,this.world.width-8);b.y=clamp(b.y+dy/d*distance,8,this.world.height-8);b.heading=Math.atan2(dy,dx);}
 step(dt=.25){if(!Number.isFinite(dt)||dt<=0||dt>10)throw Error('Invalid time delta');const previous=this.time;this.time+=dt;const clanMap=new Map(this.clans.map(c=>[c.id,c]));const claims=new Set(),eaten=new Set(),dead=new Set();
 for(const b of this.bacteria){const c=clanMap.get(b.familyId);if(!c){dead.add(b.id);continue;}b.age+=dt;b.energy-=dt*(b.role==='матка'?.0035:.0045)*b.genes.metabolism*SPECIES[b.species].metabolism;if(b.energy<15)b.hp-=dt*.022;else if(b.energy>65)b.hp=Math.min(100,b.hp+dt*.011);
 if(b.hp<=0||b.age>b.lifespan){dead.add(b.id);this.stats.totalDied++;if(b.hp<=0)this.stats.starved++;else this.stats.oldAge++;if(c.queenId===b.id)c.queenId=null;continue;}
 if(b.role==='матка'){
  if(b.energy<80&&c.stores>0){const amount=Math.min(c.stores,dt*.09,100-b.energy);b.energy+=amount;c.stores-=amount;}
  // A queen must be alive, mature and supplied. One birth per hour per queen; first child after 10 min.
  if(this.time>=b.nextBirth&&b.age>=600&&b.energy>=62&&c.stores>=23&&this.bacteria.length<this.maxPopulation&&c.members<95){
   const rolls=this.random();const role=rolls<.59?'собиратель':rolls<.77?'разведчик':rolls<.91?'защитник':'воин';const baby=this.spawn(c,b,role,b.x+this.range(-12,12),b.y+this.range(-12,12));b.energy-=17;c.stores-=23;b.childrenCount++;b.nextBirth=this.time+this.birthInterval/clamp(b.genes.fertility,.65,1.65);this.stats.totalEggs++;this.log(`${b.name} породила ${baby.role} ${baby.name} (${c.name})`,'birth');
  }
  // Queens forage only while the colony has no workers.
  if(this.bacteria.some(other=>other.familyId===c.id&&other.role!=='матка')){this.move(b,c.x,c.y,dt,.22);b.action='оберегает гнездо';continue;}
 }
 if(b.carry>0){const queen=this.bacteria.find(q=>q.id===c.queenId);if(queen){this.move(b,c.x,c.y,dt);b.action='несёт пищу матке';if(Math.hypot(b.x-c.x,b.y-c.y)<=24){c.stores+=b.carry;queen.energy=Math.min(100,queen.energy+b.carry*.22);b.carry=0;b.experience+=3;c.knowledge+=.12;}}else{c.stores+=b.carry;b.carry=0;}continue;}
 let target=this.food.find(f=>f.id===b.targetId&&!eaten.has(f.id));if(target&&Math.hypot(target.x-b.x,target.y-b.y)>ROLE_STATS[b.role].range*b.genes.vision*2)target=null;if(!target){target=this.nearestFood(b,claims);b.targetId=target?.id??null;}if(target){claims.add(target.id);this.move(b,target.x,target.y,dt);b.action='идёт к пище';if(Math.hypot(target.x-b.x,target.y-b.y)<=9){eaten.add(target.id);b.targetId=null;b.totalFood++;this.stats.totalFood++;b.experience+=1.8;b.intelligence=Math.min(90,b.intelligence+0.025);c.knowledge+=.05;if(b.role==='матка'){b.energy=Math.min(100,b.energy+target.nutrition);c.stores+=target.nutrition*.5;}else{b.energy=Math.min(100,b.energy+target.nutrition*.34);b.carry=target.nutrition*.66;}b.action='поглощает пищу';}continue;}
 // Intelligence affects exploration range, retained target choice and the ability to track resources.
 if(this.time>b.wanderUntil){b.heading+=this.range(-2.1,2.1);b.wanderUntil=this.time+this.range(5,18)*(1+b.intelligence/100);}
 const distanceFromQueen=Math.hypot(b.x-c.x,b.y-c.y);if(distanceFromQueen>1700+b.intelligence*18){this.move(b,c.x,c.y,dt,.85);b.action='возвращается';}else{this.move(b,b.x+Math.cos(b.heading)*180,b.y+Math.sin(b.heading)*180,dt,.65);b.action='разведывает';}
 }
 if(dead.size){this.bacteria=this.bacteria.filter(b=>!dead.has(b.id));for(const b of this.bacteria)if(b.parentId&&dead.has(b.parentId))b.parentId=null;}
 if(eaten.size)this.food=this.food.filter(f=>!eaten.has(f.id));
 // Combat only on actual physical contact between rival soldiers and enemies.
 for(const a of this.bacteria){if(a.role!=='воин'&&a.role!=='защитник')continue;const enemy=this.bacteria.find(b=>b.familyId!==a.familyId&&Math.hypot(b.x-a.x,b.y-a.y)<14);if(!enemy)continue;enemy.hp-=dt*(a.role==='воин'?2.2:1.1)*a.genes.defense*SPECIES[a.species].defense;a.action='защищает территорию';if(enemy.hp<=0){clanMap.get(a.familyId).kills++;this.stats.totalKills++;}}
 for(const c of this.clans){const living=this.bacteria.filter(b=>b.familyId===c.id);c.members=living.length;const queen=living.find(b=>b.id===c.queenId);if(queen){queen.x=clamp(queen.x,c.x-c.nestRadius*.55,c.x+c.nestRadius*.55);queen.y=clamp(queen.y,c.y-c.nestRadius*.55,c.y+c.nestRadius*.55);}else if(living.length&&living.length>=6){const heir=living.reduce((best,b)=>b.intelligence>best.intelligence?b:best);heir.role='матка';heir.nextBirth=this.time+this.birthInterval;c.queenId=heir.id;this.log(`${heir.name} стала новой маткой ${c.name}`,'life');}}
 if(Math.floor(this.time/20)>Math.floor(previous/20)){const growth=this.season().growth;this.refill(Math.max(0,Math.min(Math.ceil(10*growth),this.maxFood-this.food.length)));if(this.season().index===3) this.food=this.food.filter(f=>this.random()<.96);}
 if(Math.floor(this.time/60)>Math.floor(previous/60)){this.record();this.maybeBud();}
 }
 maybeBud(){// New colonies arise only after substantial growth, resources and maturity.
 if(this.clans.length>=18)return;const candidate=this.clans.find(c=>c.members>=65&&c.stores>=280&&c.knowledge>=70);if(!candidate)return;const species=candidate.species;const angle=this.range(0,Math.PI*2);const x=clamp(candidate.x+Math.cos(angle)*4200,400,this.world.width-400),y=clamp(candidate.y+Math.sin(angle)*4200,400,this.world.height-400);candidate.stores-=110;this.foundClan(species,x,y,candidate);this.log(`${candidate.name} основала дочернюю колонию`,'branch');}
 record(){this.history.push({time:this.time,population:this.bacteria.length,clans:this.clans.filter(c=>c.members).length,food:this.food.length,stores:+this.clans.reduce((a,c)=>a+c.stores,0).toFixed(1),births:this.stats.totalBorn,deaths:this.stats.totalDied,intelligence:+(this.bacteria.reduce((a,b)=>a+b.intelligence,0)/Math.max(1,this.bacteria.length)).toFixed(2)});if(this.history.length>10080)this.history.shift();}
 snapshot(){const alive=this.clans.filter(c=>c.members>0);return{version:6,time:this.time,world:this.world,season:this.season(),stats:{...this.stats,simulationSeconds:this.time,activeClans:alive.length,maxGeneration:Math.max(0,...this.bacteria.map(b=>b.generation)),averageIntelligence:this.bacteria.reduce((sum,b)=>sum+b.intelligence,0)/Math.max(1,this.bacteria.length)},bacteria:this.bacteria.map(b=>({id:b.id,name:b.name,x:+b.x.toFixed(1),y:+b.y.toFixed(1),familyId:b.familyId,familyColor:SPECIES[b.species].color,species:SPECIES[b.species].name,role:b.role,energy:+b.energy.toFixed(1),hp:+b.hp.toFixed(1),ageYears:+(b.age/3600).toFixed(2),generation:b.generation,intelligence:+b.intelligence.toFixed(1),childrenCount:b.childrenCount,totalFood:b.totalFood,genes:b.genes,action:b.action,carry:+b.carry.toFixed(1),heading:b.heading,isLeader:b.role==='матка'})),clans:alive.map(c=>({...c,speciesName:SPECIES[c.species].name})),food:this.food.map(f=>({id:f.id,x:+f.x.toFixed(1),y:+f.y.toFixed(1)})),events:this.events.slice(-35),history:this.history};}
 serialize(){return{version:6,foodDistributionVersion:this.foodDistributionVersion,seed:this.seed,time:this.time,nextId:this.nextId,nextFoodId:this.nextFoodId,nextClanId:this.nextClanId,world:this.world,maxPopulation:this.maxPopulation,birthInterval:this.birthInterval,bacteria:this.bacteria,food:this.food,clans:this.clans,stats:this.stats,events:this.events,history:this.history};}
 restore(s){for(const k of ['seed','time','nextId','nextFoodId','nextClanId','world','maxPopulation','birthInterval','bacteria','food','clans','stats','events','history'])if(s[k]!==undefined)this[k]=s[k];if(!Array.isArray(this.bacteria)||!Array.isArray(this.food)||!Array.isArray(this.clans)||!Number.isFinite(this.time))throw Error('Invalid saved world');for(const c of this.clans)c.nestRadius??=220;for(const f of this.food)f.createdAt??=this.time;if(s.foodDistributionVersion!==2){for(const f of this.food){if(this.random()<.77){f.x=this.range(80,this.world.width-80);f.y=this.range(80,this.world.height-80);}}this.foodDistributionVersion=2;this.log('Ресурсы рассредоточены по миру после обновления','system');}for(const b of this.bacteria)if(!Number.isFinite(b.x)||!Number.isFinite(b.energy)||!this.clans.some(c=>c.id===b.familyId))throw Error('Invalid saved organism');}
}
module.exports={World,SPECIES};
