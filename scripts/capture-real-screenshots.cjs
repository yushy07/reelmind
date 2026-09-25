const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve('.test-data/app');
app.setPath('userData', root);
app.setAppPath(path.resolve('.'));
process.env.REELMIND_SMOKE = '1';

// Synchronously pre-seed SQLite database with realistic projects so UI renders completely
fs.mkdirSync(root, { recursive: true });
const db = new DatabaseSync(path.join(root, 'reelmind.sqlite'));
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS preferences(id TEXT PRIMARY KEY, data TEXT NOT NULL);');

const animeJob = {
  id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  name: 'Demon Slayer Ep 19 - Hinokami Kagura',
  title: 'Demon Slayer Ep 19 - Hinokami Kagura',
  stage: 'completed',
  progress: 100,
  message: '3 AMV edits synchronized to beat grid and rendered with NVENC',
  studio: 'anime',
  createdAt: Date.now() - 3600000,
  updatedAt: Date.now() - 1800000,
  language: 'ja',
  fallbacks: [],
  outputs: [
    {
      id: '01',
      title: 'Hinokami Sun Dance (Climax)',
      duration: 32.4,
      file: 'output_01.mp4',
      conceptId: 1,
      style: 'hard_beat_drop',
      bpm: 142,
      musicOffset: 45.2,
      vibe: 'Action',
      sourceAudioMix: 0.65,
      musicMix: 0.85
    },
    {
      id: '02',
      title: 'Nezuko Blood Demon Art',
      duration: 28.1,
      file: 'output_02.mp4',
      conceptId: 2,
      style: 'velocity_ramp',
      bpm: 142,
      musicOffset: 77.6,
      vibe: 'Emotional',
      sourceAudioMix: 0.70,
      musicMix: 0.80
    },
    {
      id: '03',
      title: 'Breathing of Fire: First Form',
      duration: 25.8,
      file: 'output_03.mp4',
      conceptId: 3,
      style: 'slow_burn',
      bpm: 142,
      musicOffset: 12.0,
      vibe: 'Cinematic',
      sourceAudioMix: 0.50,
      musicMix: 0.90
    }
  ],
  input: {
    kind: 'local',
    value: 'demon_slayer_ep19.mkv'
  }
};

const podcastJob = {
  id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
  name: 'Lex Fridman & Sam Altman - AI Future',
  title: 'Lex Fridman & Sam Altman - AI Future',
  stage: 'completed',
  progress: 100,
  message: '4 captioned Reels generated with 9:16 speaker framing',
  studio: 'podcast',
  createdAt: Date.now() - 7200000,
  updatedAt: Date.now() - 3600000,
  fallbacks: [],
  outputs: [
    {
      id: '01',
      title: 'The Breakthrough in Reasoning Models',
      duration: 44.5,
      file: 'reel_01.mp4'
    },
    {
      id: '02',
      title: 'Compute Scaling Laws & Energy Limits',
      duration: 52.1,
      file: 'reel_02.mp4'
    }
  ],
  input: {
    kind: 'local',
    value: 'lex_sam_altman.mp4'
  }
};

db.prepare('INSERT OR REPLACE INTO jobs VALUES (?,?)').run(animeJob.id, JSON.stringify(animeJob));
db.prepare('INSERT OR REPLACE INTO jobs VALUES (?,?)').run(podcastJob.id, JSON.stringify(podcastJob));
db.close();

// Require synchronously so protocol registration happens before app is ready
require('../dist-electron/main.cjs');

app.on('browser-window-created', (_event, window) => {
  window.webContents.on('console-message', (_e, _level, message) => {
    if (/error/i.test(message)) console.log('Renderer console:', message);
  });

  window.webContents.once('did-finish-load', async () => {
    try {
      await new Promise(r => setTimeout(r, 2000));
      await fsp.mkdir('docs/screenshots', { recursive: true });

      // 1. Home / Overview Screen
      console.log('Capturing Home screen...');
      const homeImg = await window.webContents.capturePage();
      await fsp.writeFile('docs/screenshots/home.png', homeImg.toPNG());

      // 2. Open Anime Studio Project Detail
      console.log('Capturing Anime Studio Screen...');
      await window.webContents.executeJavaScript(`(() => {
        const animeTab = document.querySelector('.anime-mode');
        if (animeTab) animeTab.click();
      })()`);
      await new Promise(r => setTimeout(r, 800));
      await window.webContents.executeJavaScript(`(() => {
        const rows = Array.from(document.querySelectorAll('.project-row'));
        const anime = rows.find(r => r.innerText && r.innerText.includes('Demon Slayer'));
        if (anime) anime.click();
      })()`);
      await window.webContents.executeJavaScript(`(() => {
        const controls = document.querySelector('.anime-studio-controls');
        if (controls) controls.scrollIntoView({ behavior: 'instant', block: 'center' });
      })()`);
      await new Promise(r => setTimeout(r, 600));
      const animeImg = await window.webContents.capturePage();
      await fsp.writeFile('docs/screenshots/anime-studio.png', animeImg.toPNG());

      // Go back to home and switch back to podcast mode
      await window.webContents.executeJavaScript(`(() => {
        const back = document.querySelector('.back-button');
        if (back) back.click();
        const podTab = document.querySelector('.podcast-mode');
        if (podTab) podTab.click();
      })()`);
      await new Promise(r => setTimeout(r, 800));

      // 3. Open Podcast Studio Project Detail
      console.log('Capturing Podcast Studio Screen...');
      await window.webContents.executeJavaScript(`(() => {
        const rows = Array.from(document.querySelectorAll('.project-row'));
        const pod = rows.find(r => r.innerText && r.innerText.includes('Lex Fridman'));
        if (pod) pod.click();
      })()`);
      await new Promise(r => setTimeout(r, 1200));
      const podImg = await window.webContents.capturePage();
      await fsp.writeFile('docs/screenshots/podcast-studio.png', podImg.toPNG());

      // Go back to home
      await window.webContents.executeJavaScript(`(() => {
        const back = document.querySelector('.back-button');
        if (back) back.click();
      })()`);
      await new Promise(r => setTimeout(r, 600));

      // 4. New Project Screen
      console.log('Capturing New Project Screen...');
      await window.webContents.executeJavaScript(`(() => {
        const newBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && b.innerText.toLowerCase().includes('new project'));
        if (newBtn) newBtn.click();
      })()`);
      await new Promise(r => setTimeout(r, 800));
      const newImg = await window.webContents.capturePage();
      await fsp.writeFile('docs/screenshots/new-project.png', newImg.toPNG());

      // 5. Settings Screen with Real-Time GPU Diagnostics Panel
      console.log('Capturing Settings Screen with GPU Diagnostics...');
      await window.webContents.executeJavaScript(`(() => {
        const settingsNav = Array.from(document.querySelectorAll('nav button, aside button')).find(b => b.innerText && b.innerText.toLowerCase().includes('settings'));
        if (settingsNav) settingsNav.click();
      })()`);
      await new Promise(r => setTimeout(r, 800));

      // Click "Inspect GPU Diagnostics" button to open the live diagnostics panel
      await window.webContents.executeJavaScript(`(() => {
        const diagBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && b.innerText.includes('Inspect GPU Diagnostics'));
        if (diagBtn) diagBtn.click();
      })()`);
      // Wait for IPC diagnostics probe and telemetry query to resolve
      await new Promise(r => setTimeout(r, 3000));
      const settingsImg = await window.webContents.capturePage();
      await fsp.writeFile('docs/screenshots/settings.png', settingsImg.toPNG());

      // 6. Transcription Settings (scroll to Transcription section)
      console.log('Capturing Transcription Settings Screen...');
      await window.webContents.executeJavaScript(`(() => {
        const heading = Array.from(document.querySelectorAll('h2')).find(h => h.innerText.includes('Local Speech Recognition'));
        if (heading) heading.scrollIntoView({ block: 'center', behavior: 'instant' });
      })()`);
      await new Promise(r => setTimeout(r, 600));
      const transImg = await window.webContents.capturePage();
      await fsp.writeFile('docs/screenshots/transcription-settings.png', transImg.toPNG());

      console.log('ALL_REAL_SCREENSHOTS_CAPTURED');
      app.quit();
    } catch (err) {
      console.error('Screenshot capture failed:', err);
      app.exit(1);
    }
  });
});

setTimeout(() => {
  console.error('Screenshot capture timed out');
  app.exit(1);
}, 60000).unref();
