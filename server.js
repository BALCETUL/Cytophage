'use strict';
const http=require('node:http');
const https=require('node:https');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const  {
  World
}
=require('./simulation');
const  {
  Storage
}
=require('./storage');
(async()=> {
  // Server-only authentication. Password hashes never belong in public GitHub.
  const adminHash=process.env.ADMIN_PASSWORD_HASH||'';
  const sessionKey=crypto.randomBytes(32);
  const sessions=new Map(), attempts=new Map();
  function secureEqual(a,b){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);}
  function checkPassword(password){
    if(typeof password!=='string'||password.length>256)return false;
    const parts=adminHash.split(':');
    if(parts.length!==3||parts[0]!=='scrypt')return false;
    try {const salt=Buffer.from(parts[1],'hex'),expected=Buffer.from(parts[2],'hex');return expected.length===64&&crypto.timingSafeEqual(crypto.scryptSync(password,salt,64),expected);}catch{return false;}
  }
  function authorized(req){const token=(req.headers.authorization||'').match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!token)return false;const record=sessions.get(token);if(!record||record<Date.now()){sessions.delete(token);return false;}return true;}
  function reply(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
  async function receive(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>8192)throw new Error('Body too large');}return JSON.parse(raw||'{}');}
  const allowedOrigins=new Set(['https://balcetul.github.io', 'https://cytophage.onrender.com']);
  if(process.env.RENDER_EXTERNAL_URL)allowedOrigins.add(new URL(process.env.RENDER_EXTERNAL_URL).origin);
  if(process.env.NODE_ENV!=='production'){allowedOrigins.add('http://localhost:3000');allowedOrigins.add('http://127.0.0.1:3000');}
  let resetInProgress=false;
  const ADMIN_BALANCE_TECH_MAX=1e9; // Not a recommended value; prevents numeric overflow in combined multipliers.
  let paused=false, speed=Math.max(.1,Math.min(10,Number(process.env.SIM_SPEED)||1));let audit=[];

  const STATE_FILE=process.env.STATE_FILE||path.join(__dirname,'world_state.json'); const SERVER_URL=process.env.RENDER_EXTERNAL_URL||'https://cytophage.onrender.com'; const storage=new Storage( {
    file:STATE_FILE
  }); const startedAt=new Date().toISOString(), bootId=crypto.randomUUID(); let lifecycle= {
    boots:[],lastHeartbeat:null,lastShutdown:null
  },world,saveError=null,saving=null,cache=null,cacheAt=0; let lastSnapshotBytes=0,lastStorageCleanupAt=null; let ping= {
    attempts:0,successes:0,lastAttempt:null,lastSuccess:null,lastError:null
  }; try  {
    const saved=await storage.load();world=new World( {
      state:saved
    });audit=Array.isArray(saved?.adminAudit)?saved.adminAudit.slice(-200):[];paused=!!saved?.adminPaused;speed=Number(saved?.adminSpeed)||speed;lifecycle= {
      ...lifecycle,...saved?.lifecycle
    };
  }
  catch(e) {
    if(storage.remote)throw e;if(e.code!=='ENOENT') {
      console.error('Cannot load state:',e.message);try {
        fs.copyFileSync(STATE_FILE,STATE_FILE+'.invalid-'+Date.now());
      }
      catch {
      }
    }
    world=new World();
  }
  const previousHeartbeat=lifecycle.lastHeartbeat; lifecycle.boots.push( {
    bootId,startedAt,previousHeartbeat,previousShutdown:lifecycle.lastShutdown
  });lifecycle.boots=lifecycle.boots.slice(-20);lifecycle.lastShutdown=null; function status() {
    return  {
      status:'alive',timestamp:new Date().toISOString(),startedAt,bootId,uptime:Math.floor(process.uptime()),selfPingCount:ping.successes,lastSelfPing:ping.lastSuccess,ping,bacteriaCount:world.bacteria.length,foodCount:world.food.length,activeClans:world.clans.filter(c=>c.members>0).length,lifecycle,persistence: {
        lastSavedAt:world.stats.lastSavedAt||null,error:saveError,mode:storage.remote?'durable':process.env.RENDER?'ephemeral':'local'
      },storageHealth:{snapshotBytes:lastSnapshotBytes,lastCleanupAt:lastStorageCleanupAt,counts:{...world.storageCounts(),audit:audit.length},limits:{events:60,audit:200,history:5000,lineageDead:30,lineageLiving:world.bacteria.length,specialArchive:100,dynastyPerClan:60}},performance: {
        tickMs:lastTickMs,memoryMB:Math.round(process.memoryUsage().rss/1048576*10)/10,heapMB:Math.round(process.memoryUsage().heapUsed/1048576*10)/10
      },simulationSeconds:world.time,admin:{enabled:!!adminHash,paused,speed}
    };
  }
  async function save({force=false}={}) {
     if(resetInProgress)return saving||Promise.resolve();
     if(saving){await saving;if(!force)return;}const savedAt=new Date().toISOString();lifecycle.lastHeartbeat=savedAt;const data= {
      ...world.serialize(),adminAudit:audit,adminPaused:paused,adminSpeed:speed,stats: {
        ...world.stats,lastSavedAt:savedAt
      },lifecycle
    };world.compactStorage();lastStorageCleanupAt=new Date().toISOString();lastSnapshotBytes=Buffer.byteLength(JSON.stringify(data));saving=(async()=> {
      try {
        await storage.save(data);world.stats.lastSavedAt=savedAt;saveError=null;
      }
      catch(e) {
        saveError=e.message;console.error('Save failed:',e.message);
      }
      finally {
        saving=null;
      }
    })();return saving;
  }
  function selfPing() {
    ping.attempts++;ping.lastAttempt=new Date().toISOString();let url;try {
      url=new URL('/ping',SERVER_URL);
    }
    catch(e) {
      ping.lastError=e.message;return;
    }
    const client=url.protocol==='https:'?https:http;const req=client.get(url, {
      timeout:15000
    },res=> {
      res.resume();if(res.statusCode===200) {
        ping.successes++;ping.lastSuccess=new Date().toISOString();ping.lastError=null;
      }
      else ping.lastError=`HTTP ${res.statusCode}`;
    });req.on('timeout',()=>req.destroy(new Error('Ping timeout')));req.on('error',e=> {
      ping.lastError=e.message;console.error('Self-ping:',e.message);
    });
  }
  let lastTickMs=0,lastTick=performance.now(); const tickTimer=setInterval(()=> {
    const now=performance.now();const dt=Math.min(1,(now-lastTick)/1000);lastTick=now;try {
      let remaining=paused?0:dt*speed;while(remaining>0){const slice=Math.min(2,remaining);world.step(slice);remaining-=slice;}lastTickMs=performance.now()-now;
    }
    catch(e) {
      console.error('Simulation error:',e);
    }
  },250); const saveTimer=setInterval(save,30000);save(); const pingTimer=setInterval(selfPing,Number(process.env.PING_INTERVAL_MS)||10*60*1000);const pingStart=setTimeout(selfPing,Number(process.env.PING_START_MS)||2*60*1000); const server=http.createServer(async(req,res)=> {
    const origin=req.headers.origin;
    if(origin&&allowedOrigins.has(origin))res.setHeader('Access-Control-Allow-Origin',origin);
    res.setHeader('Vary','Origin');res.setHeader('Cache-Control','no-store');
    if(req.method==='OPTIONS') {res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.writeHead(origin&&!allowedOrigins.has(origin)?403:204);return res.end();}
    if(origin&&!allowedOrigins.has(origin)&&req.method==='POST')return reply(res,403,{error:'Origin not allowed'});
    if(req.method!=='GET'&&req.method!=='POST')return reply(res,405,{error:'Method not allowed'});
    let url;try {
      url=new URL(req.url,'http://localhost');
    }
    catch {
      res.writeHead(400);return res.end('Bad request');
    }
    if(url.pathname.startsWith('/admin/')){
      if(!adminHash)return reply(res,503,{error:'Сначала укажи ADMIN_PASSWORD_HASH в Render'});
      if(url.pathname==='/admin/login'&&req.method==='POST'){
        const ip=req.socket.remoteAddress||'unknown',now=Date.now();const rate=attempts.get(ip)||{since:now,count:0};if(now-rate.since>15*60*1000){rate.since=now;rate.count=0;}
        if(rate.count>=5)return reply(res,429,{error:'Слишком много попыток. Повтори через 15 минут.'});
        try{const body=await receive(req);if(!checkPassword(body.password)){rate.count++;attempts.set(ip,rate);return reply(res,401,{error:'Неверный пароль'});}attempts.delete(ip);const token=crypto.randomBytes(32).toString('hex');sessions.set(token,now+2*60*60*1000);return reply(res,200,{token,expiresIn:7200});}catch{return reply(res,400,{error:'Некорректный запрос'});}
      }
      if(!authorized(req))return reply(res,401,{error:'Необходим вход администратора'});
      if(url.pathname==='/admin/logout'&&req.method==='POST'){const token=(req.headers.authorization||'').slice(7);sessions.delete(token);return reply(res,200,{ok:true});}
      if(url.pathname==='/admin/status'&&req.method==='GET')return reply(res,200,{paused,speed,worldTime:world.time,population:world.bacteria.length,clans:world.clans.length,food:world.food.length,foodLimit:world.maxFood,lastSavedAt:world.stats.lastSavedAt||null,season:world.season(),stats:world.stats,clanList:world.clans.map(c=>({id:c.id,name:c.name,species:c.species,parentClanId:c.parentClanId??null,x:c.x,y:c.y,queenId:c.queenId,members:c.members,populationLimit:c.populationLimit??95,foodCapacity:c.foodCapacity??null,stores:c.stores,knowledge:c.knowledge,nestLevel:c.nestLevel,fortification:c.fortification,heirId:c.heirId,heirReason:c.heirReason??null,dynasty:c.dynasty})) ,diplomacy:world.diplomacy,organisms:world.bacteria.map(b=>({id:b.id,name:b.name,x:b.x,y:b.y,familyId:b.familyId,role:b.role,age:b.age,energy:b.energy,health:b.hp,intelligence:b.intelligence,totalFood:b.totalFood,experience:b.experience,generation:b.generation,genes:b.genes,immunity:b.immunity,infected:b.infection>0,action:b.action,parentId:b.parentId})),history:world.history.slice(-1500),events:world.events.slice(-60),audit:audit.slice(-150),lineage:world.lineage,specials:world.specials,specialArchive:world.specialArchive,balance:world.balance,server:status()});
      if(url.pathname==='/admin/action'&&req.method==='POST'){
        try{const body=await receive(req);const action=body.action;
          // For balance controls a failed save must not leave an unconfirmed value active.
          const previousBalance=(action==='balance'||action==='roleMetabolism')?structuredClone(world.balance):null;
          // Colony limit edits also need rollback if persistent storage fails.
          const priorClan=(action==='setClanPopulationLimit'||action==='setClanFoodCapacity')
            ?world.clans.find(c=>c.id===body.id):null;
          const priorClanValue=priorClan?(action==='setClanPopulationLimit'?priorClan.populationLimit:priorClan.foodCapacity):undefined;
          if(action==='pause'){paused=true;}
          else if(action==='resume'){paused=false;lastTick=performance.now();}
          else if(action==='speed'){if(typeof body.value!=='number'||!Number.isFinite(body.value)||body.value<.1||body.value>10)return reply(res,400,{error:'Скорость должна быть от 0.1 до 10'});speed=body.value;}
          else if(action==='food'){if(!Number.isSafeInteger(body.value)||body.value<1||body.value>world.maxFood)return reply(res,400,{error:'Укажи положительное целое число до '+world.maxFood+' (технический лимит еды на карте). Рекомендуется не более 250 за раз.'});if(world.season().growth===0)return reply(res,409,{error:'Зимой генерация пищи отключена'});world.refill(Math.min(body.value,world.maxFood-world.food.length));}
          else if(action==='save'){/* Saved once at the end, along with all admin commands. */}
          else if(action==='resetWorld'){
            // Destructive reset: require a fresh password check, even with a valid admin session.
            if(body.confirm!=='УДАЛИТЬ МИР'||!checkPassword(body.password))return reply(res,403,{error:'Подтверди сброс фразой и паролем администратора'});
            if(resetInProgress)return reply(res,409,{error:'Сброс уже выполняется'});
            resetInProgress=true;
            const wasPaused=paused;paused=true;
            try {
              if(saving)await saving;
              const replacement=new World({seed:crypto.randomBytes(4).readUInt32LE(0)});
              const savedAt=new Date().toISOString();
              replacement.stats.lastSavedAt=savedAt;
              // Overwrite the live persistent snapshot; never leave an older snapshot waiting to restore.
              const resetAudit=[{time:savedAt,action:'resetWorld',id:null,value:'Новый мир'}];
              await storage.save({...replacement.serialize(),adminAudit:resetAudit,adminPaused:false,adminSpeed:1,stats:{...replacement.stats,lastSavedAt:savedAt},lifecycle:{...lifecycle,lastHeartbeat:savedAt}});
              world=replacement;audit=resetAudit;speed=1;paused=false;lastTick=performance.now();cache=null;saveError=null;
              return reply(res,200,{ok:true,reset:true,message:'Мир сброшен и новое состояние записано в '+(storage.remote?'Supabase':'локальное хранилище')});
            }catch(e){paused=wasPaused;saveError=e.message;return reply(res,503,{error:'Сброс отменён: новая запись не сохранилась. '+e.message});}
            finally{resetInProgress=false;}
          }
          else if(action==='balance'){const key=String(body.key);if(!['birthMultiplier','metabolismMultiplier','mutationMultiplier','aggression'].includes(key)||typeof body.value!=='number'||!Number.isFinite(body.value)||body.value<0||body.value>ADMIN_BALANCE_TECH_MAX||(key==='birthMultiplier'&&body.value<0.000001))return reply(res,400,{error:'Коэффициент: конечное неотрицательное число до 1 000 000 000; для размножения значение должно быть не меньше 0,000001. Рекомендуется 0,25–3.'});world.balance[key]=body.value;}
          else if(action==='roleMetabolism'){
            // Atomic validation before any role value changes. A subset edits one
            // role; all five at once is a single persistent admin command.
            const roles=['матка','собиратель','разведчик','защитник','воин'];
            const changes=body.values;
            if(!changes||typeof changes!=='object'||Array.isArray(changes))return reply(res,400,{error:'Укажи коэффициенты ролей'});
            const keys=Object.keys(changes);
            if(!keys.length||keys.some(role=>!roles.includes(role))||keys.length>5)return reply(res,400,{error:'Недопустимая роль'});
            if(keys.some(role=>typeof changes[role]!=='number'||!Number.isFinite(changes[role])||changes[role]<0||changes[role]>ADMIN_BALANCE_TECH_MAX))return reply(res,400,{error:'Множитель роли: конечное число от 0 до 1 000 000 000. Рекомендуется 0,25–4.'});
            world.balance.roleMetabolism={...world.balance.roleMetabolism,...changes};
            body.value=keys.map(role=>role+'='+changes[role]).join(', ');
          }
          else if(action==='setClanPopulationLimit'||action==='setClanFoodCapacity'){
            if(!Number.isSafeInteger(body.id)||body.id<1)return reply(res,400,{error:'Выбери колонию'});
            const c=world.clans.find(c=>c.id===body.id);
            if(!c)return reply(res,404,{error:'Колония не найдена'});
            if(action==='setClanPopulationLimit'){
              if(!Number.isSafeInteger(body.value)||body.value<1||body.value>world.maxPopulation)return reply(res,400,{error:'Лимит колонии: от 1 до '+world.maxPopulation+' бактерий (общий предел мира)'});
              c.populationLimit=body.value;
            }else{
              if(body.value!==null&&(!Number.isSafeInteger(body.value)||body.value<0))return reply(res,400,{error:'Вместимость гнезда: неотрицательное безопасное целое число либо без ограничения. Для небольшой нагрузки рекомендуется до 1 000 000.'});
              c.foodCapacity=body.value;
            }
            // Explicit ID is logged; name and settings still belong to one colony.
            body.value=(action==='setClanFoodCapacity'&&body.value===null)?'без ограничения':body.value;
          }
          else if(action==='createSpecial'){const created=world.createSpecial(body);body.id=created.id;}
          else if(['storeSpecial','releaseSpecial','deleteSpecial'].includes(action)){if(!Number.isSafeInteger(body.id)||body.id<1)return reply(res,400,{error:'Укажи ID'});world.specialCommand(action,body.id,body.x,body.y);}

          else if(action==='renameOrganism'){const id=body.id;const name=typeof body.name==='string'?body.name.trim().replace(/\s+/g,' '):'';if(!Number.isSafeInteger(id)||id<=0||name.length<2||name.length>48||/[<>\x00-\x1f]/.test(name))return reply(res,400,{error:'Имя: от 2 до 48 символов, без управляющих символов и угловых скобок'});const b=world.bacteria.find(b=>b.id===id);if(!b)return reply(res,404,{error:'Организм не найден'});b.originalName??=b.name;b.name=name;world.log('Организм №'+id+' переименован в «'+name+'»','system');}
          else if(action==='diplomacy'){world.setRelation(Number(body.a),Number(body.b),body.status);}
           else if(['careOrganism','recallOrganism','setOrganismRole'].includes(action)){
             const id=body.id;
             if(!Number.isSafeInteger(id)||id<1)return reply(res,400,{error:'Укажи существующий ID бактерии'});
             const b=world.bacteria.find(x=>x.id===id);if(!b)return reply(res,404,{error:'Бактерия отсутствует в живом мире'});
             const c=world.clans.find(x=>x.id===b.familyId);
             if(action==='careOrganism'){
               if(body.care==='feed'){b.energy=Math.min(100,b.energy+25);b.action='восстанавливает сытость после помощи администратора';}
               else if(body.care==='heal'){b.hp=100;b.infection=0;b.infectionAge=0;b.action='восстанавливается после лечения';}
               else return reply(res,400,{error:'Выбери кормление или лечение'});
             }else if(action==='recallOrganism'){
               if(!c)return reply(res,404,{error:'Колония не найдена'});
               b.x=c.x+((b.id%5)-2)*6;b.y=c.y+((b.id%7)-3)*6;b.targetId=null;b.wanderUntil=world.time;
               b.action='возвращён к гнезду администратором';
             }else{
               if(b.role==='матка')return reply(res,409,{error:'Роль живой Геноматры менять нельзя: нарушится наследование'});
               if(!['собиратель','разведчик','защитник','воин'].includes(body.role))return reply(res,400,{error:'Недопустимая роль'});
               if(b.role==='собиратель'&&body.role!=='собиратель'&&!world.bacteria.some(x=>x.id!==id&&x.familyId===b.familyId&&x.role==='собиратель'))return reply(res,409,{error:'Нельзя убрать последнего собирателя колонии'});
               b.role=body.role;b.targetId=null;b.wanderUntil=world.time;
               const entry=world.lineage.find(x=>x.id===b.id);if(entry)entry.role=b.role;
             }
           }
          else if(action==='renameClan'){const id=body.id;const name=typeof body.name==='string'?body.name.trim().replace(/\s+/g,' '):'';if(!Number.isSafeInteger(id)||id<=0||name.length<2||name.length>48||/[<>\x00-\x1f]/.test(name))return reply(res,400,{error:'Имя: от 2 до 48 символов'});const c=world.clans.find(c=>c.id===id);if(!c)return reply(res,404,{error:'Колония не найдена'});c.originalName??=c.name;c.name=name;world.log('Колония №'+id+' переименована в «'+name+'»','system');}
          else return reply(res,400,{error:'Неизвестная команда'});
          cache=null;
          if(action==='deleteSpecial'){
            // An explicit permanent delete also removes associated administrative records.
            audit=audit.filter(entry=>!(entry.id===body.id&&['createSpecial','storeSpecial','releaseSpecial','deleteSpecial'].includes(entry.action)));
          }else{
            audit.push({time:new Date().toISOString(),action,id:body.id??null,value:action==='renameOrganism'||action==='renameClan'?body.name:body.value??body.key??body.role??body.care??null});audit=audit.slice(-200);
          }
          // Laboratory actions have individually identifiable creature events on the server.
          if(!action.startsWith('rename')&&action!=='save'&&!['createSpecial','deleteSpecial','storeSpecial','releaseSpecial'].includes(action))world.log('Действие администратора: '+action,'system');
           await save({force:true});
           if(saveError){
             if(priorClan){
               if(action==='setClanPopulationLimit')priorClan.populationLimit=priorClanValue;
               else priorClan.foodCapacity=priorClanValue;
             }
             if(previousBalance){
               world.balance=previousBalance;
               if(audit.at(-1)?.action===action)audit.pop();
               if(world.events.at(-1)?.message==='Действие администратора: '+action)world.events.pop();
               cache=null;
             }
             if(priorClan){
               if(audit.at(-1)?.action===action)audit.pop();
               if(world.events.at(-1)?.message==='Действие администратора: '+action)world.events.pop();
               cache=null;
             }
             return reply(res,503,{error:((previousBalance||priorClan)?'Настройка не сохранена, прежнее значение восстановлено. ':'Изменение применено в памяти, но не сохранено. ')+(storage.remote?'Supabase: ':'Файл: ')+saveError});
           }
           return reply(res,200,{ok:true,saved:true,lastSavedAt:world.stats.lastSavedAt,paused,speed,population:world.bacteria.length,food:world.food.length});
        }catch(e){return reply(res,400,{error:e.message||'Некорректная команда'});}
      }
      return reply(res,404,{error:'Not found'});
    }
    if(req.method!=='GET')return reply(res,405,{error:'Method not allowed'});
    let data; if(url.pathname==='/ping'||url.pathname==='/health')data=status(); else if(url.pathname==='/stats')data= {
      ...world.snapshot().stats,...status()
    }; else if(url.pathname==='/events')data= {
      events:world.events,totalEvents:world.events.length
    }; else if(url.pathname==='/state') {
      if(!cache||Date.now()-cacheAt>950) {
        cache=world.snapshot();cacheAt=Date.now();
      }
      data= {
        ...cache,server:status()
      };
    }
    else if(url.pathname==='/'||url.pathname==='/index.html') {
      res.setHeader('Content-Type','text/html; charset=utf-8');const stream=fs.createReadStream(path.join(__dirname,'index.html'));stream.on('error',()=> {
        if(!res.headersSent)res.writeHead(500);res.end('Interface unavailable');
      });return stream.pipe(res);
    }
    else  {
      res.writeHead(404);return res.end('Not found');
    }
    res.setHeader('Content-Type','application/json; charset=utf-8'); const body=JSON.stringify(data);if((req.headers['accept-encoding']||'').includes('gzip')) {
      res.setHeader('Content-Encoding','gzip');require('node:zlib').gzip(body,(err,compressed)=> {
        if(err) {
          res.writeHead(500);return res.end();
        }
        res.end(compressed);
      });
    }
    else res.end(body);
  }); server.listen(process.env.PORT||3000,()=>console.log(`Cytophage v6.3 on port ${server.address().port}; ${world.bacteria.length} cells; boot ${bootId}`)); let stopping=false; async function stop() {
    if(stopping)return;stopping=true;clearInterval(tickTimer);clearInterval(saveTimer);clearInterval(pingTimer);clearTimeout(pingStart);server.close();if(saving)await saving;lifecycle.lastShutdown=new Date().toISOString();await save();process.exit(0);
  }
  process.on('SIGTERM',stop);process.on('SIGINT',stop); process.on('message',message=> {
    if(message==='shutdown')stop();
  });
})().catch(error=> {
  console.error('Startup failed:',error.message);process.exitCode=1;
});
