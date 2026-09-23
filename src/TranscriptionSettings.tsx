import React,{useState} from 'react';
import type {Settings,Status} from '../shared/types';
export function TranscriptionSettings({data,settings,onChange}:{data:Status;settings:Settings;onChange:(s:Settings)=>void}){
  const [error,setError]=useState('');
  const model=data.turbo;
  const act=async(action:'download'|'cancel')=>{setError('');try{await window.reelmind!.turbo(action);}catch{setError('Unable to start the model download. Please retry.');}};
  return <section className="panel"><h2>Local transcription</h2>
    <label>ACCURACY MODE<select value={settings.transcriptionMode||'standard'} onChange={e=>onChange({...settings,transcriptionMode:e.target.value as 'standard'|'turbo'})}>
      <option value="standard">Standard — Whisper small</option>
      <option value="turbo" disabled={!model.ready}>Higher accuracy — Whisper turbo{!model.ready?' (download first)':''}</option>
    </select></label>
    <p>Standard stays fast and lightweight. Turbo is an optional accuracy choice, runs locally on CPU, and may take longer. New projects use the saved choice; existing projects keep theirs.</p>
    <p role="status">{model.message}</p>
    {!model.ready&&<><small className="block">Download: {(model.total/1e9).toFixed(2)} GB · Free space: {(model.freeBytes/1e9).toFixed(1)} GB. Allow an extra 512 MB. Installed models do not expire with projects.</small>
      {model.running?<><progress aria-label="Turbo download" value={model.downloaded} max={model.total}/><p>{Math.floor(model.downloaded/model.total*100)}% downloaded</p><button className="secondary" onClick={()=>act('cancel')}>Pause download</button></>:<button className="secondary" onClick={()=>act('download')}>Download / resume Turbo</button>}</>}
    {(error||model.error)&&<div className="alert" role="alert">{error||model.error}</div>}
    <small className="block">If Turbo fails, Whisper small takes over automatically. No paid API is required.</small>
  </section>;
}
