'use strict';
// Deterministic, time-based ecology. No I/O: the same engine runs in tests and on Render.
const COLORS = ['#67e8a5','#64c8ff','#ffbd69','#bc9cff','#ff819a','#4dd8ce','#e3dd72','#87adff','#ef9fe5','#9dd574','#eaa17b','#62bbc5','#becefc','#d9ab68','#a9dfca'];
const NAMES = ['Альфа','Бета','Гамма','Дельта','Эхо','Омега','Титаны','Стражи','Стая','Легион','Искры','Пламя','Луна','Солнце','Тени'];
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
class World  {
  constructor({ seed=42, state=null, initialClans=10, founders=10, foodCount=6000, maxPopulation=900 } = {}) {
    this.seed=seed>>>0;
    this.time=0;
    this.nextId=1;
    this.nextFoodId=1;
    this.world= {
      width:15000,
      height:15000
    };
    this.maxPopulation=maxPopulation;
    this.foodCount=foodCount;
    this.bacteria=[];
    this.clans=[];
    this.food=[];
    this.events=[];
    this.history=[];
    this.grid=new Map();
    this.stats= {
      startedAt:new Date().toISOString(),
      totalBorn:0,
      totalDied:0,
      totalKills:0,
      totalWars:0,
      totalMutations:0,
      tickCount:0,
      starved:0,
      oldAge:0,
      totalFood:0
    };
    if(state?.version===5) this.restore(state);
    else  {
      // Old worlds are migrated without counting restored organisms as new births.
      const old=state?.bacteria?.filter(b=>Number.isFinite(b.x)&&Number.isFinite(b.y)&&b.hp>0)||[];
      if(old.length)  {
        const ids=[...new Set(old.map(b=>b.familyId||1))].slice(0,15);
        for(const id of ids)  {
          const members=old.filter(b=>(b.familyId||1)===id);
          const leader=members.find(b=>b.isLeader)||members[0];
          const c=this.addClan(leader.x,leader.y);
          for(const b of members.slice(0,65)) {
            const n=this.spawn(c,b);
            n.x=clamp(b.x,20,14980);
            n.y=clamp(b.y,20,14980);
            n.energy=clamp(b.hunger??80,30,100);
            n.age=clamp((b.ageTicks||0)/45000*60,0,3000);
            n.generation=b.generation||0;
          }
        }
        this.stats= {
          ...this.stats,
          ...state.stats,
          totalBorn:Math.max(state.stats?.totalBorn||0,this.bacteria.length)
        };
        this.log('Старый мир перенесён в новую экологию','system');
      }
      else  {
        for(let i=0;i<initialClans;i++) {
          const a=i/initialClans*Math.PI*2;
          const c=this.addClan(7500+Math.cos(a)*2700,7500+Math.sin(a)*2700);
          for(let j=0;j<founders;j++)this.spawn(c);
        }
        this.log('Основаны колонии: начинается самостоятельная эволюция','system');
      }
      this.refill(this.foodCount);
      this.elect();
      this.sample();
      this.lastReportBorn=this.stats.totalBorn;
      this.lastReportDied=this.stats.totalDied;
    }
  }
  random() {
    let t=this.seed=(this.seed+0x6D2B79F5)>>>0;
    t=Math.imul(t^t>>>15,t|1);
    t^=t+Math.imul(t^t>>>7,t|61);
    return((t^t>>>14)>>>0)/4294967296;
  }
  range(a,b) {
    return a+(b-a)*this.random();
  }
  addClan(x,y) {
    const used=new Set(this.clans.map(c=>c.id));
    let id=1;
    while(used.has(id))id++;
    const c= {
      id,
      name:NAMES[id-1]||`Клан ${id}`,
      color:COLORS[(id-1)%15],
      x:clamp(x,600,14400),
      y:clamp(y,600,14400),
      knowledge:0,
      foodMemory:null,
      births:0
    };
    this.clans.push(c);
    return c;
  }
  spawn(c,parent=null) {
    const genes= {
      speed:1,
      metabolism:1,
      vision:1,
      fertility:1
    };
    if(parent)for(const k of Object.keys(genes))genes[k]=parent.genes?.[k]||1;
    let mutated=false;
    if(parent&&this.random()<.22) {
      const k=Object.keys(genes)[Math.floor(this.random()*4)];
      genes[k]=clamp(genes[k]*this.range(.92,1.08),.65,1.5);
      mutated=true;
      this.stats.totalMutations++;
    }
    const b= {
      id:this.nextId++,
      name:`${c.name} · ${this.nextId-1}`,
      familyId:c.id,
      x:clamp((parent?.x??c.x)+this.range(-80,80),20,14980),
      y:clamp((parent?.y??c.y)+this.range(-80,80),20,14980),
      age:parent?0:this.range(20,120),
      lifespan:this.range(3300,5400),
      energy:parent?65:90,
      hp:100,
      generation:parent?(parent.generation||0)+1:0,
      parentId:parent?.id??null,
      genes,
      experience:(parent?.experience||0)*.12,
      childrenCount:0,
      totalFood:0,
      lastBirth:this.time+this.range(0,25),
      heading:this.range(0,Math.PI*2),
      targetId:null,
      action:'исследует',
      isLeader:false,
      mutated
    };
    this.bacteria.push(b);
    this.stats.totalBorn++;
    c.births++;
    return b;
  }
  log(message,type='info') {
    this.events.push( {
      tick:this.stats.tickCount,timestamp:new Date().toISOString(),simulationTime:this.time,message,type
    });
    if(this.events.length>120)this.events.shift();
  }
  refill(count) {
    const active=this.clans.filter(c=>this.bacteria.some(b=>b.familyId===c.id));
    for(let i=0;i<count;i++) {
      let x,
      y;
      if(active.length&&this.random()<.94) {
        const c=active[Math.floor(this.random()*active.length)];
        const a=this.range(0,Math.PI*2),
        r=Math.sqrt(this.random())*750;
        x=c.x+Math.cos(a)*r;
        y=c.y+Math.sin(a)*r;
      }
      else {
        x=this.range(20,14980);
        y=this.range(20,14980);
      }
      this.food.push( {
        id:this.nextFoodId++,createdAt:this.time,x:clamp(x,20,14980),y:clamp(y,20,14980)
      });
    }
    this.reindex();
  }
  reindex() {
    this.grid.clear();
    this.foodById=new Map();
    for(const f of this.food) {
      this.foodById.set(f.id,f);
      const key=`${Math.floor(f.x/150)},${Math.floor(f.y/150)}`;
      if(!this.grid.has(key))this.grid.set(key,[]);
      this.grid.get(key).push(f);
    }
  }
  nearest(b,claims) {
    let best=null,
    dist=Infinity;
    const radius=260*b.genes.vision+Math.min(160,b.experience*.03),
    r=Math.ceil(radius/150),
    gx=Math.floor(b.x/150),
    gy=Math.floor(b.y/150);
    for(let x=gx-r;x<=gx+r;x++)for(let y=gy-r;y<=gy+r;y++)for(const f of this.grid.get(`${x},${y}`)||[]) {
      if(f.eaten)continue;
      const d=(f.x-b.x)**2+(f.y-b.y)**2;
      if(d>radius*radius)continue;
      const score=d*(claims.has(f.id)?2.5:1);
      if(score<dist) {
        dist=score;
        best=f;
      }
    }
    return best;
  }
  elect() {
    for(const c of this.clans) {
      const members=this.bacteria.filter(b=>b.familyId===c.id);
      let leader=null;
      for(const b of members) {
        b.isLeader=false;
        if(!leader||b.experience+b.age*.02>leader.experience+leader.age*.02)leader=b;
      }
      if(leader)leader.isLeader=true;
      c.members=members.length;
    }
  }
  step(dt=.25) {
    if(!Number.isFinite(dt)||dt<=0||dt>5)throw new Error('Step must be in (0, 5] seconds');
    const before=this.time;
    this.time+=dt;
    this.stats.tickCount++;
    const clans=new Map(this.clans.map(c=>[c.id,c])),
    counts=new Map();
    for(const b of this.bacteria)counts.set(b.familyId,(counts.get(b.familyId)||0)+1);
    const claims=new Set(),
    children=[],
    dead=new Set();
    for(const b of this.bacteria.slice()) {
      const c=clans.get(b.familyId);
      b.age+=dt;
      b.energy-=.38*b.genes.metabolism*dt;
      b.experience+=dt*.015;
      if(b.energy<=0)b.hp-=dt*2;
      else if(b.energy>35)b.hp=Math.min(100,b.hp+dt*.8);
      if(b.hp<=0||b.age>b.lifespan) {
        dead.add(b.id);
        this.stats.totalDied++;
        if(b.hp<=0)this.stats.starved++;
        else this.stats.oldAge++;
        continue;
      }
      let target=this.foodById.get(b.targetId);
      if(!target||target.eaten) {
        target=this.nearest(b,claims);
        b.targetId=target?.id??null;
      }
      if(target)claims.add(target.id);
      let tx,
      ty;
      if(target) {
        tx=target.x;
        ty=target.y;
        b.action=b.energy<40?'ищет еду':'собирает ресурсы';
      }
      else  {
        const memory=c.foodMemory;
        const outside=Math.hypot(b.x-c.x,b.y-c.y)>850;
        if(outside||b.energy<45) {
          tx=memory?.x??c.x;
          ty=memory?.y??c.y;
          b.action='использует память клана';
        }
        else {
          b.heading+=this.range(-.3,.3)*dt;
          tx=b.x+Math.cos(b.heading)*100;
          ty=b.y+Math.sin(b.heading)*100;
          b.action='исследует';
        }
      }
      const dx=tx-b.x,
      dy=ty-b.y,
      d=Math.hypot(dx,dy);
      const speed=38*b.genes.speed*(1+Math.min(.25,c.knowledge/800));
      const move=Math.min(d,speed*dt);
      if(d>0) {
        b.x=clamp(b.x+dx/d*move,20,14980);
        b.y=clamp(b.y+dy/d*move,20,14980);
      }
      if(target&&!target.eaten&&Math.hypot(target.x-b.x,target.y-b.y)<14) {
        target.eaten=true;
        b.energy=Math.min(100,b.energy+22);
        b.experience+=1;
        b.totalFood++;
        this.stats.totalFood++;
        c.knowledge+=.018;
        c.foodMemory= {
          x:target.x,
          y:target.y
        };
        b.targetId=null;
      }
      // All mature cells divide. Density and nutrient supply regulate growth.
      const count=counts.get(c.id);
      const cooldown=28/b.genes.fertility*(1+Math.pow(count/48,3));
      if(b.age>=18&&b.age<b.lifespan*.8&&b.energy>=78&&this.time-b.lastBirth>=cooldown&&count<65&&this.bacteria.length-dead.size<this.maxPopulation) {
        b.energy-=24;
        b.lastBirth=this.time;
        b.childrenCount++;
        b.experience+=3;
        const child=this.spawn(c,b);
        children.push(child);
        counts.set(c.id,count+1);
      }
    }
    // spawn appends to the live array: children must not run until the next step.
    if(dead.size)this.bacteria=this.bacteria.filter(b=>!dead.has(b.id));
    if(Math.floor(this.time)!==Math.floor(before)) {
      this.food=this.food.filter(f=>!f.eaten&&this.time-(f.createdAt??0)<180);
      this.refill(Math.min(this.foodCount-this.food.length,90*(Math.floor(this.time)-Math.floor(before))));
      this.elect();
      if(Math.floor(this.time/60)!==Math.floor(before/60)) {
        const births=this.stats.totalBorn-(this.lastReportBorn??this.stats.totalBorn),
        deaths=this.stats.totalDied-(this.lastReportDied??0);
        this.lastReportBorn=this.stats.totalBorn;
        this.lastReportDied=this.stats.totalDied;
        this.log(`За минуту: +${births} рождений, −${deaths} смертей. Живых: ${this.bacteria.length}`,'ecology');
        this.sample();
        this.branch();
      }
    }
  }
  branch() {
    const active=this.clans.filter(c=>c.members>0);
    if(active.length>=15)return;
    const source=active.find(c=>c.members>=55&&c.knowledge>15);
    if(!source)return;
    const a=this.range(0,Math.PI*2);
    const c=this.addClan(source.x+Math.cos(a)*1600,source.y+Math.sin(a)*1600);
    c.knowledge=source.knowledge*.7;
    const members=this.bacteria.filter(b=>b.familyId===source.id&&!b.isLeader).slice(0,18);
    for(const b of members) {
      b.familyId=c.id;
      b.x=c.x+this.range(-100,100);
      b.y=c.y+this.range(-100,100);
      b.targetId=null;
    }
    this.elect();
    this.log(`${source.name} основал дочернюю колонию ${c.name}: знания унаследованы`,'branch');
    this.refill(Math.min(100,this.foodCount-this.food.length));
  }
  sample() {
    this.history.push( {
      time:this.time,population:this.bacteria.length,clans:this.clans.filter(c=>c.members>0).length
    });
    if(this.history.length>240)this.history.shift();
  }
  snapshot() {
    const alive=this.clans.filter(c=>c.members>0);
    return  {
      version:5,
      world:this.world,
      stats: {
        ...this.stats,
        activeClans:alive.length,
        simulationSeconds:this.time,
        averageIntelligence:this.bacteria.reduce((s,b)=>s+12+b.experience/15+(this.clans.find(c=>c.id===b.familyId)?.knowledge||0)/5,0)/(this.bacteria.length||1),
        maxGeneration:Math.max(0,...this.bacteria.map(b=>b.generation))
      },
      bacteria:this.bacteria.map(b=> {
        const c=this.clans.find(c=>c.id===b.familyId);return  {
          ...b,x:Math.round(b.x*10)/10,y:Math.round(b.y*10)/10,age:Math.round(b.age),lifespan:Math.round(b.lifespan),energy:Math.round(b.energy),hp:Math.round(b.hp),experience:Math.round(b.experience),heading:Math.round(b.heading*100)/100,genes:Object.fromEntries(Object.entries(b.genes).map(([k,v])=>[k,Math.round(v*1000)/1000])),ageYears:Math.round(b.age/6)/10,lifespanYears:Math.round(b.lifespan/6)/10,hunger:Math.round(b.energy),maxHunger:100,maxHp:100,size:Math.round((7+Math.min(4,b.age/600))*10)/10,familyName:c.name,familyColor:c.color,intelligence:Math.floor(12+b.experience/15+c.knowledge/5),clanRadius:750,learnedSkills: {
            hunting:Math.min(10,1+b.totalFood/50),survival:Math.min(10,1+b.experience/100)
          },mutations:Object.fromEntries(Object.entries(b.genes).map(([k,v])=>[k,Math.round(v*1000)/1000]))
        };
      }),
      food:this.food.filter(f=>!f.eaten).map(({id,x,y})=>( {
        id,x:Math.round(x*10)/10,y:Math.round(y*10)/10
      })),
      healthFood:[],
      clans:alive,
      events:this.events.slice(-40),
      history:this.history
    };
  }
  serialize() {
    return  {
      version:5,
      seed:this.seed,
      time:this.time,
      nextId:this.nextId,
      nextFoodId:this.nextFoodId,
      world:this.world,
      maxPopulation:this.maxPopulation,
      foodCount:this.foodCount,
      bacteria:this.bacteria,
      clans:this.clans,
      food:this.food.filter(f=>!f.eaten),
      stats:this.stats,
      events:this.events,
      history:this.history,
      lastReportBorn:this.lastReportBorn,
      lastReportDied:this.lastReportDied
    };
  }
  restore(s) {
    for(const k of ['seed','time','nextId','nextFoodId','world','maxPopulation','foodCount','bacteria','clans','food','stats','events','history','lastReportBorn','lastReportDied'])if(s[k]!==undefined)this[k]=s[k];
    if(!Array.isArray(this.bacteria)||!Array.isArray(this.food)||!Array.isArray(this.clans)||!Number.isFinite(this.time))throw new Error('Invalid saved world');
    for(const b of this.bacteria) {
      if(!Number.isFinite(b.x)||!Number.isFinite(b.energy)||!b.genes||!this.clans.some(c=>c.id===b.familyId))throw new Error('Invalid saved organism');
      b.targetId=null;
    }
    this.reindex();
    this.elect();
  }
}
module.exports= {
  World
};



