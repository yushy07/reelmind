// Launch the real desktop entry point in an isolated test profile.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const root=path.resolve('.test-data/app');
app.setPath('userData',root);
app.setAppPath(path.resolve('.'));
process.env.REELMIND_SMOKE='1';
require('../dist-electron/main.cjs');
app.on('browser-window-created',(_event,window)=>{
  window.webContents.on('console-message',(_e,_level,message)=>{if(/error/i.test(message))console.log(message);});
  window.webContents.once('did-finish-load',async()=>{
    try {
      await new Promise(r=>setTimeout(r,1500));
      const state=await window.webContents.executeJavaScript('window.reelmind.status()');
      if(!state.settings||!state.runtime)throw new Error('Desktop bridge failed');
      const text=await window.webContents.executeJavaScript('document.body.innerText');
      if(!text.includes('Great little moments.'))throw new Error('Home screen failed to render');
      await fs.mkdir('.test-data',{recursive:true});
      await fs.writeFile('.test-data/home.png',(await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).find(b=>b.innerText.includes('New project')).click()");
      await new Promise(r=>setTimeout(r,200));
      await fs.writeFile('.test-data/import.png',(await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('nav button')).find(b=>b.innerText.includes('Settings')).click()");
      await new Promise(r=>setTimeout(r,200));
      const settingsText=await window.webContents.executeJavaScript('document.body.innerText');
      if(!settingsText.includes('Local transcription')||!settingsText.includes('Whisper small')||!state.turbo)throw new Error('Transcription settings missing');
      await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('h2')).find(h=>h.innerText==='Local transcription').scrollIntoView({block:'center',behavior:'instant'})");
      await new Promise(r=>setTimeout(r,350));
      await fs.writeFile('.test-data/settings.png',(await window.webContents.capturePage()).toPNG());
      console.log(JSON.stringify({desktopBridge:true,home:true,import:true,settings:true,runtimeReady:state.runtime.ready,keysPresent:state.keys,geminiBillingConfirmed:state.settings.geminiFreeConfirmed,hardware:state.hardware}));
      app.quit();
    }catch(e){console.error(e);app.exit(1);}
  });
});
setTimeout(()=>{console.error('Desktop smoke test timed out');app.exit(1);},45000).unref();
