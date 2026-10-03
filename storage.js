'use strict';
const fs = require('node:fs');
const path = require('node:path');
// Optional durable storage for Render Free. Credentials stay on the server.
class Storage  {
  constructor({ file, url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY } = {}) {
    this.file=file;
    if(Boolean(url)!==Boolean(key)) throw new Error('Set both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    this.remote=Boolean(url&&key);
    if(this.remote)  {
      const base=new URL(url);
      if(base.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(base.hostname)) throw new Error('Storage requires HTTPS');
      this.endpoint=new URL('/rest/v1/cytophage_world',base).toString();
      this.headers= {
        apikey:key,
        Authorization:`Bearer ${key}`,
        'Content-Type':'application/json'
      };
    }
  }
  async request(url,options= {
  })  {
    const response=await fetch(url, {
      ...options,headers: {
        ...this.headers,...options.headers
      },signal:AbortSignal.timeout(10000)
    });
    if(!response.ok) throw new Error(`Durable storage HTTP ${response.status}`);
    return response;
  }
  async load()  {
    // Never replace a remote world with a fresh local world when the database is unavailable.
    if(this.remote)  {
      const response=await this.request(this.endpoint+'?id=eq.main&select=payload');
      const rows=await response.json();
      if(!Array.isArray(rows)) throw new Error('Invalid durable storage response');
      if(rows.length) return rows[0].payload;
    }
    try  {
      return JSON.parse(await fs.promises.readFile(this.file,'utf8'));
    }
    catch(e)  {
      if(e.code==='ENOENT')return null;
      throw e;
    }
  }
  async save(data)  {
    await fs.promises.mkdir(path.dirname(this.file), {
      recursive:true
    });
    await fs.promises.writeFile(this.file+'.tmp',JSON.stringify(data),'utf8');
    await fs.promises.rename(this.file+'.tmp',this.file);
    if(this.remote) await this.request(this.endpoint+'?on_conflict=id', {
      method:'POST',headers: {
        Prefer:'resolution=merge-duplicates,return=minimal'
      }, body:JSON.stringify( {
        id:'main',payload:data,updated_at:new Date().toISOString()
      })
    });
  }
}
module.exports= {
  Storage
};

