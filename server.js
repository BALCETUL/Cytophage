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
  const STATE_FILE=process.env.STATE_FILE||path.join(__dirname,'world_state.json'); const SERVER_URL=process.env.RENDER_EXTERNAL_URL||'https://cytophage.onrender.com'; const storage=new Storage( {
    file:STATE_FILE
  }); const startedAt=new Date().toISOString(), bootId=crypto.randomUUID(); let lifecycle= {
    boots:[],lastHeartbeat:null,lastShutdown:null
  },world,saveError=null,saving=null,cache=null,cacheAt=0; let ping= {
    attempts:0,successes:0,lastAttempt:null,lastSuccess:null,lastError:null
  }; try  {
    const saved=await storage.load();world=new World( {
      state:saved
    });lifecycle= {
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
      },performance: {
        tickMs:lastTickMs
      },simulationSeconds:world.time
    };
  }
  function save() {
    if(saving)return saving;const savedAt=new Date().toISOString();lifecycle.lastHeartbeat=savedAt;const data= {
      ...world.serialize(),stats: {
        ...world.stats,lastSavedAt:savedAt
      },lifecycle
    };saving=(async()=> {
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
      let remaining=dt*Math.max(0.1,Math.min(60,Number(process.env.SIM_SPEED)||1));while(remaining>0){const slice=Math.min(2,remaining);world.step(slice);remaining-=slice;}lastTickMs=performance.now()-now;
    }
    catch(e) {
      console.error('Simulation error:',e);
    }
  },250); const saveTimer=setInterval(save,30000);save(); const pingTimer=setInterval(selfPing,Number(process.env.PING_INTERVAL_MS)||10*60*1000);const pingStart=setTimeout(selfPing,Number(process.env.PING_START_MS)||2*60*1000); const server=http.createServer((req,res)=> {
    res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Cache-Control','no-store'); if(req.method==='OPTIONS') {
      res.writeHead(204);return res.end();
    }
    if(req.method!=='GET') {
      res.writeHead(405);return res.end();
    }
    let url;try {
      url=new URL(req.url,'http://localhost');
    }
    catch {
      res.writeHead(400);return res.end('Bad request');
    }
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
      }; if(url.searchParams.get('food')==='0')data= {
        ...data,food:undefined
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
  }); server.listen(process.env.PORT||3000,()=>console.log(`Cytophage v6 on port ${server.address().port}; ${world.bacteria.length} cells; boot ${bootId}`)); let stopping=false; async function stop() {
    if(stopping)return;stopping=true;clearInterval(tickTimer);clearInterval(saveTimer);clearInterval(pingTimer);clearTimeout(pingStart);server.close();if(saving)await saving;lifecycle.lastShutdown=new Date().toISOString();await save();process.exit(0);
  }
  process.on('SIGTERM',stop);process.on('SIGINT',stop); process.on('message',message=> {
    if(message==='shutdown')stop();
  });
})().catch(error=> {
  console.error('Startup failed:',error.message);process.exitCode=1;
});
