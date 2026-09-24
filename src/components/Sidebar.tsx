import React from 'react';
import { Mic, Sparkles, Plus, House, Film, Settings2, Cpu, ShieldCheck } from 'lucide-react';
import brandMark from '../../assets/logo.svg';

interface SidebarProps {
  studio: 'podcast' | 'anime';
  setStudio: (s: 'podcast' | 'anime') => void;
  page: 'home' | 'new' | 'library' | 'settings';
  go: (p: 'home' | 'new' | 'library' | 'settings') => void;
  completed: number;
  hardware: string;
  runtimeReady: boolean;
  selectedJob: boolean;
}

export function Sidebar({
  studio,
  setStudio,
  page,
  go,
  completed,
  hardware,
  runtimeReady,
  selectedJob,
}: SidebarProps) {
  const isAnime = studio === 'anime';

  return (
    <aside>
      <a className="brand" onClick={() => go('home')} title="Return to Overview">
        <span className="brand-icon">
          <img src={brandMark} width={28} height={28} alt="" />
        </span>
        reelmind
        <span className="brand-dot">.</span>
        <span className="brand-badge">STUDIO</span>
      </a>

      {/* Segmented Studio Switcher with Specular Glass */}
      <div className="studio-switcher" role="tablist" aria-label="Studio mode">
        <button
          type="button"
          role="tab"
          aria-selected={!isAnime}
          className={`studio-pill podcast-mode ${!isAnime ? 'active' : ''}`}
          onClick={() => {
            setStudio('podcast');
            go('home');
          }}
        >
          <Mic size={14} />
          Podcast
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={isAnime}
          className={`studio-pill anime-mode ${isAnime ? 'active' : ''}`}
          onClick={() => {
            setStudio('anime');
            go('home');
          }}
        >
          <Sparkles size={14} />
          Anime AMV
        </button>
      </div>

      {/* New Project Action Button */}
      <button
        className={`new-button ${isAnime ? 'anime-cta' : ''}`}
        onClick={() => go('new')}
      >
        <Plus size={18} />
        {isAnime ? 'New Anime AMV' : 'New Project'}
        <kbd>＋</kbd>
      </button>

      {/* Studio Navigation Links */}
      <div className="nav-label">{isAnime ? 'ANIME WORKSPACE' : 'STUDIO WORKSPACE'}</div>
      <nav aria-label="Main Navigation">
        <button
          className={`${page === 'home' && !selectedJob ? 'active' : ''} ${isAnime ? 'anime-scope' : ''}`.trim()}
          onClick={() => go('home')}
        >
          <House size={18} />
          Overview
        </button>
        <button
          className={`${page === 'library' && !selectedJob ? 'active' : ''} ${isAnime ? 'anime-scope' : ''}`.trim()}
          onClick={() => go('library')}
        >
          <Film size={18} />
          Projects
          {completed > 0 && <span className="count">{completed}</span>}
        </button>
        <button
          className={`${page === 'settings' && !selectedJob ? 'active' : ''} ${isAnime ? 'anime-scope' : ''}`.trim()}
          onClick={() => go('settings')}
        >
          <Settings2 size={18} />
          Settings
        </button>
      </nav>

      {/* Sidebar Footer with Glass Engine & Hardware Status Card */}
      <div className="sidebar-bottom">
        <div className="local-card">
          <div className="local-card-header">
            <span className={`status-radar ${runtimeReady ? 'status-ready-icon' : 'status-needs-icon'}`}>
              <span className="radar-ping" />
              <span className="radar-dot" />
            </span>
            <span>{runtimeReady ? 'Engine Ready' : 'Setup Needed'}</span>
          </div>
          <p>{hardware || 'Local-first processing. Your videos stay private.'}</p>
          <span className="mini-tag">WINDOWS DESKTOP · LOCAL GPU</span>
        </div>

        <div className="profile">
          <span>A</span>
          <div>
            Personal Studio
            <small>{isAnime ? 'Anime AMV Studio' : 'ReelMind Video Suite'}</small>
          </div>
        </div>
      </div>
    </aside>
  );
}
