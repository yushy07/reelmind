import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const OWNER = 'yushy07';
const REPO = 'reelmind';
const TAG = `v${pkg.version}`;
const RELEASE_NAME = `REELMIND v${pkg.version}`;
const ASSET_PATH = path.resolve('release', `REELMIND Setup ${pkg.version}.exe`);
const ASSET_NAME = `REELMIND.Setup.${pkg.version}.exe`;

async function computeSha256(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex').toUpperCase();
}

function getGitHubToken() {
  const credOutput = execSync('git credential fill', {
    input: 'protocol=https\nhost=github.com\n',
    encoding: 'utf8',
  });
  const match = credOutput.match(/password=(.*)/);
  if (!match || !match[1].trim()) {
    throw new Error('Unable to retrieve GitHub token from git credentials');
  }
  return match[1].trim();
}

async function githubRequest(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Reelmind-Release-Publisher',
      ...options.headers,
    },
  });
  return res;
}

async function main() {
  console.log(`Checking installer file at ${ASSET_PATH}...`);
  if (!fs.existsSync(ASSET_PATH)) {
    throw new Error(`Asset file not found: ${ASSET_PATH}`);
  }
  const stat = fs.statSync(ASSET_PATH);
  const sha256 = await computeSha256(ASSET_PATH);
  if(execSync('git status --porcelain',{encoding:'utf8'}).trim())throw new Error('Commit and push changes before publishing.');
  const commit=execSync('git rev-parse HEAD',{encoding:'utf8'}).trim();
  const remote=execSync('git ls-remote origin refs/heads/main',{encoding:'utf8'}).split(/\s/)[0];
  if(commit!==remote)throw new Error('Push the verified commit before publishing.');
  console.log(`Asset size: ${(stat.size / 1024 / 1024).toFixed(2)} MB (${stat.size} bytes)`);
  console.log(`SHA-256: ${sha256}`);

  const body = `Windows x64 installer update for REELMIND ${TAG}.

- **Dedicated Anime Studio Workspace:** Completely separate engine for full 24-minute Japanese/English anime episodes and AMV creation, keeping Podcast Studio completely intact.
- **Deep Preprocessing Engine:** Scene/shot detection with PySceneDetect & FFmpeg, audio extraction, frame indexing, and Librosa music rhythm analysis (BPM, beats, downbeats, onset energy curves).
- **Multi-Signal Visual & Audio Intelligence:** OpenCV motion deltas, Laplacian sharpness, anime face detection/prominence scoring, audio transients, and dialogue mapping.
- **Impact Frame Detection:** Pinpoints the exact climax hit moment within each shot to align with musical beat drops.
- **3–5 Diverse AMV Concepts:** Gemini Free tier evaluation + local diversity optimizer with automatic offline/quota fallback.
- **AMV Edit Planner & Smart 9:16 Reframing:** Beat-synchronized cut sequencing (Intro/Build → Climax Hit → Payoff) and dynamic character-centered camera reframing with smooth pan & zoom.
- **Advanced Neural Effects & NVENC Rendering:** Velocity ramping with temporal smoothing, dual-stream character isolation & depth-of-field background blur, flash on impact, and hardware-accelerated NVENC 1080×1920 MP4 rendering.
- **Interactive Studio Controls:** Video player previews, live style switcher (Hard Beat, Velocity, Slow Burn, Dialogue), dual-track audio mixer sliders, and 1-click instant re-rendering.
- **RTX 3050 VRAM Management:** Strict two-pass memory lifecycle with immediate CUDA cache and model disposal preventing VRAM OOM.
- **Crash Recovery & Checkpointing:** Comprehensive SHA-256 checkpoints and automated recovery across scene, music, analysis, and render stages.

Source commit: ${commit}

Installer SHA-256: ${sha256}

The installer is unsigned, so Windows SmartScreen may display a warning.
`;

  const token = getGitHubToken();
  console.log('Retrieved GitHub authorization token.');

  console.log(`Checking if release ${TAG} exists...`);
  let releaseRes = await githubRequest(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  let release;
  if (releaseRes.status === 404) {
    console.log(`Creating release ${TAG}...`);
    const createRes = await githubRequest(`https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tag_name: TAG,
        target_commitish: commit,
        name: RELEASE_NAME,
        body,
        draft: false,
        prerelease: true,
      }),
    });
    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`Failed to create release: ${createRes.status} ${errText}`);
    }
    release = await createRes.json();
    console.log(`Release created: ${release.html_url} (ID: ${release.id})`);
  } else if (releaseRes.ok) {
    release = await releaseRes.json();
    console.log(`Found existing release: ${release.html_url} (ID: ${release.id})`);
  } else {
    const errText = await releaseRes.text();
    throw new Error(`Failed to query release: ${releaseRes.status} ${errText}`);
  }

  const existingAsset = (release.assets || []).find((a) => a.name === ASSET_NAME);
  if (existingAsset) {
    throw new Error(`Asset ${ASSET_NAME} already exists. Existing release downloads are never replaced; choose a new version.`);
  }

  console.log(`Uploading ${ASSET_NAME} (${(stat.size / 1024 / 1024).toFixed(2)} MB)...`);
  const uploadUrl = `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(ASSET_NAME)}`;

  await new Promise((resolve, reject) => {
    const parsedUrl = new URL(uploadUrl);
    const req = https.request(
      {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Reelmind-Release-Publisher',
          'Content-Type': 'application/octet-stream',
          'Content-Length': stat.size,
        },
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const uploaded = JSON.parse(responseBody);
              console.log(`\nAsset uploaded successfully!`);
              console.log(`Download URL: ${uploaded.browser_download_url}`);
              resolve(uploaded);
            } catch (err) {
              resolve(responseBody);
            }
          } else {
            reject(new Error(`Upload failed: ${res.statusCode} ${responseBody}`));
          }
        });
      }
    );

    req.on('error', (err) => {
      reject(err);
    });

    const fileStream = fs.createReadStream(ASSET_PATH, { highWaterMark: 1024 * 1024 });
    let uploadedBytes = 0;
    let lastPercent = 0;

    fileStream.on('data', (chunk) => {
      uploadedBytes += chunk.length;
      const percent = Math.floor((uploadedBytes / stat.size) * 100);
      if (percent >= lastPercent + 5 || uploadedBytes === stat.size) {
        lastPercent = percent;
        process.stdout.write(
          `\rProgress: ${percent}% (${(uploadedBytes / 1024 / 1024).toFixed(1)} / ${(stat.size / 1024 / 1024).toFixed(1)} MB)`
        );
      }
    });

    fileStream.on('error', (err) => {
      req.destroy(err);
      reject(err);
    });

    fileStream.pipe(req);
  });

  console.log('\nRelease publication complete!');
}

main().catch((err) => {
  console.error('\nError:', err);
  process.exit(1);
});
