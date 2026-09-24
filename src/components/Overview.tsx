import React from 'react';
import {
  Sparkles,
  ArrowUpRight,
  ArrowRight,
  Play,
  AudioLines,
  ScanFace,
  Languages,
  Scissors,
  Check,
  Cpu,
  ShieldCheck,
  Clapperboard,
  Plus,
} from 'lucide-react';
import type { Job } from '../../shared/types';
import { ProjectRow } from './ProjectRow';

interface OverviewProps {
  studio: 'podcast' | 'anime';
  jobs: Job[];
  runtimeReady: boolean;
  onOpenProject: (id: string) => void;
  onNewProject: () => void;
  onGoSettings: () => void;
}

export function Overview({
  studio,
  jobs,
  runtimeReady,
  onOpenProject,
  onNewProject,
  onGoSettings,
}: OverviewProps) {
  const isAnime = studio === 'anime';
  const workingJobs = jobs.filter((j) => !['completed', 'expired'].includes(j.stage));
  const finishedJobs = jobs.filter((j) => ['completed', 'expired'].includes(j.stage));

  return (
    <>
      {/* Page Heading */}
      <div className="page-heading">
        <div>
          <div className="eyebrow">{isAnime ? 'ANIME STUDIO' : 'YOUR CREATIVE SPACE'}</div>
          <h1>
            {isAnime ? 'High-energy anime.' : 'Long conversations.'}
            <br />
            <span>{isAnime ? 'Beat-synced AMV edits.' : 'Great little moments.'}</span>
          </h1>
          <p>
            {isAnime
              ? 'Turn 24-minute anime episodes and your favorite music tracks into viral 9:16 AMVs.'
              : 'Turn the best parts of your conversations and podcasts into scroll-stopping vertical Reels.'}
          </p>
        </div>
        <span className="edition">{isAnime ? 'ANIME / 01' : 'REELMIND / 01'}</span>
      </div>

      {/* Hero Showcase Banner */}
      <section className={`hero ${isAnime ? 'anime-hero' : ''}`}>
        <div className="hero-copy">
          <span className="hero-label">
            <Sparkles size={14} /> {isAnime ? 'ANIME AMV STUDIO' : 'YOUR PERSONAL AI EDITOR'}
          </span>
          <h2>
            {isAnime
              ? 'Anime episodes.\nPrecision cuts.'
              : 'Big ideas.\nSmall screen.'}
          </h2>
          <p>
            {isAnime
              ? 'Import an episode and music track. Detect shots and beats.\nLet Anime Studio plan the edit.'
              : 'Drop in a video. Find the moments.\nLet your studio take it from there.'}
          </p>
          <div className="hero-actions">
            <button className="primary" onClick={onNewProject}>
              {isAnime ? 'Start Anime Project' : 'Create Your First Reel'}{' '}
              <ArrowUpRight size={17} />
            </button>
          </div>
          <div className="hero-foot">
            {isAnime
              ? 'BEAT MATCHED · IMPACT SYNCED · GPU ACCELERATED'
              : 'NO TIMELINE. NO HEAVY LIFTING.'}
          </div>
        </div>

        {/* Workflow Artwork */}
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="source-card">
            <div className="video-art">
              <div className="person p-one" />
              <div className="person p-two" />
              <span className="play-circle">
                <Play size={16} fill="currentColor" />
              </span>
            </div>
            <div className="source-footer">
              <AudioLines size={20} />
              <div className="waveform">
                {Array.from({ length: 27 }, (_, i) => (
                  <i key={i} className="waveform-bar" style={{ ['--h' as any]: `${8 + ((i * 17) % 20)}px` }} />
                ))}
              </div>
              <span>01:24:08</span>
            </div>
          </div>

          <div className="reel-card">
            <span className="reel-label">
              <span className="green-dot" /> THE MOMENT
            </span>
            <div className="portrait-art">
              <div className="person p-three" />
            </div>
            <div className="caption-art">
              ONE IDEA.
              <br />
              <em>EVERYTHING</em>
              <br />
              CHANGES.
            </div>
            <div className="reel-bottom">
              <span>9:16</span>
              <Sparkles size={13} />
              <span>00:42</span>
            </div>
          </div>

          <span className="float-tag tag-one">
            <ScanFace size={14} /> Smart Framing
          </span>
          <span className="float-tag tag-two">
            <Check size={14} /> Captions, Handled.
          </span>
          <span className="art-note">ILLUSTRATED WORKFLOW</span>
        </div>
      </section>

      {/* 3 Core Highlights */}
      <div className="features">
        <div>
          <span className="feature-icon">
            <ScanFace size={18} />
          </span>
          <div>
            <h3>Find the Good Stuff</h3>
            <p>Full video intelligence finds the highest-energy moments.</p>
          </div>
        </div>
        <div>
          <span className="feature-icon">
            <Languages size={18} />
          </span>
          <div>
            <h3>Speak Your Language</h3>
            <p>English, Hindi / Hinglish & Japanese Whisper recognition.</p>
          </div>
        </div>
        <div>
          <span className="feature-icon">
            <Scissors size={18} />
          </span>
          <div>
            <h3>Ready for the Feed</h3>
            <p>Vertical 9:16 HD with dynamic typography and beat cuts.</p>
          </div>
        </div>
      </div>

      {/* Engine Setup Banner (if not installed) */}
      {!runtimeReady && (
        <div className="setup-banner">
          <Cpu size={24} />
          <div>
            <strong>Let’s get your local engine ready</strong>
            <p>A one-time download provides speech recognition, face tracking, and fonts.</p>
          </div>
          <button className="secondary" onClick={onGoSettings}>
            Set Up Studio <ArrowRight size={15} />
          </button>
        </div>
      )}

      {/* Working & Active Projects */}
      {workingJobs.length > 0 && (
        <section className="projects working-projects projects-section">
          <div className="section-heading">
            <h2>
              Active Processing & Recovery <span>{workingJobs.length}</span>
            </h2>
          </div>
          <div className="project-list">
            {workingJobs.map((j) => (
              <ProjectRow key={j.id} job={j} onOpen={onOpenProject} />
            ))}
          </div>
        </section>
      )}

      {/* Recent Finished Projects */}
      <section className="projects">
        <div className="section-heading">
          <h2>
            Recent Finished Projects <span>{finishedJobs.length}</span>
          </h2>
          <button className="text-button" onClick={onNewProject}>
            New Project <Plus size={14} />
          </button>
        </div>

        {finishedJobs.length === 0 && workingJobs.length === 0 ? (
          <div className="empty-projects">
            <div className="empty-icon">
              <Clapperboard size={24} />
            </div>
            <h3>Your Next Great Project Starts Here</h3>
            <p>Add your source media and REELMIND will take care of the rest.</p>
            <button className="text-button" onClick={onNewProject}>
              Start a Project <ArrowRight size={15} />
            </button>
          </div>
        ) : finishedJobs.length > 0 ? (
          <div className="project-list">
            {finishedJobs.map((j) => (
              <ProjectRow key={j.id} job={j} onOpen={onOpenProject} />
            ))}
          </div>
        ) : (
          <p className="quiet-list quiet-muted">
            Finished projects will appear here when ready.
          </p>
        )}
      </section>

      <footer>
        <ShieldCheck size={14} />
        Originals stay untouched. Your creativity stays yours.
        <span>CRAFTED FOR THE MOMENT</span>
      </footer>
    </>
  );
}


