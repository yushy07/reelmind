import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { Job, Settings } from '../shared/types';
export const defaults:Settings={providerOrder:['gemini','openrouter'],geminiModel:'gemini-flash-latest',openrouterModel:'openrouter/free',quality:'balanced',cloudEnabled:true,geminiFreeConfirmed:false,transcriptionMode:'standard'};
export class Store {
  db:DatabaseSync;
  constructor(file:string){this.db=new DatabaseSync(file);this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS preferences(id TEXT PRIMARY KEY, data TEXT NOT NULL);');}
  jobs():Job[]{return (this.db.prepare('SELECT data FROM jobs ORDER BY rowid DESC').all() as {data:string}[]).map(r=>JSON.parse(r.data));}
  get(id:string){return this.jobs().find(j=>j.id===id);}
  put(job:Job){this.db.prepare('INSERT OR REPLACE INTO jobs VALUES (?,?)').run(job.id,JSON.stringify(job));}
  remove(id:string){this.db.prepare('DELETE FROM jobs WHERE id=?').run(id);}
  settings():Settings{const row=this.db.prepare("SELECT data FROM preferences WHERE id='settings'").get() as {data:string}|undefined;return row?{...defaults,...JSON.parse(row.data)}:defaults;}
  setSettings(s:Settings){this.db.prepare("INSERT OR REPLACE INTO preferences VALUES ('settings',?)").run(JSON.stringify(s));}
  now(wall=Date.now()){
    const row=this.db.prepare("SELECT data FROM preferences WHERE id='clockHighWater'").get() as {data:string}|undefined;
    const previous=Number(row?.data||0);const effective=Math.max(wall,previous);
    if(wall>previous)this.db.prepare("INSERT OR REPLACE INTO preferences VALUES ('clockHighWater',?)").run(String(wall));
    return effective;
  }
}
export function within(root:string,target:string){const rel=path.relative(path.resolve(root),path.resolve(target));return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));}
export async function removeWorkspace(root:string,target:string){
  const realRoot=await fs.realpath(root);const realTarget=await fs.realpath(target).catch(()=>null);if(!realTarget)return;
  if(realRoot===realTarget||!within(realRoot,realTarget))throw new Error('Refusing cleanup outside a project workspace.');
  const stat=await fs.lstat(target);if(stat.isSymbolicLink())throw new Error('Refusing cleanup of a linked workspace.');
  await fs.rm(realTarget,{recursive:true,force:true});
}
export async function hash(file:string){const h=createHash('sha256');for await(const part of createReadStream(file))h.update(part);return h.digest('hex');}
export async function externalDirectory(dir:string,blocked:string[]){const real=await fs.realpath(dir);for(const root of blocked){const resolved=await fs.realpath(root).catch(()=>path.resolve(root));if(within(resolved,real))throw new Error('Choose a folder outside REELMIND’s installation and internal storage.');}return real;}
export async function atomicJSON(file:string,value:unknown){await fs.writeFile(file+'.tmp',JSON.stringify(value));await fs.rename(file+'.tmp',file);}
