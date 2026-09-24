import React, { useState, useEffect } from 'react';
import { ChevronRight, Cpu, Sparkles, Mic, Layers, Moon, Sun } from 'lucide-react';

interface HeaderProps {
  page: 'home' | 'new' | 'library' | 'settings';
  studio: 'podcast' | 'anime';
  jobName: string | null;
  hasActiveJob: boolean;
}

export function Header({ page, studio, jobName, hasActiveJob }: HeaderProps) {
  const isAnime = studio === 'anime';
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('reelmind-theme') as 'light' | 'dark') ||
      (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('theme-dark');
    } else {
      document.documentElement.classList.remove('theme-dark');
    }
    localStorage.setItem('reelmind-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  return (
    <header>
      <div className="header-breadcrumbs">
        <span className="breadcrumb-chip">
          <Layers size={13} className="muted-icon-muted" />
          <span>Workspace</span>
        </span>
        <ChevronRight size={12} className="muted-icon-subtle" />
        <span className="breadcrumb-chip">
          {isAnime ? (
            <Sparkles size={12} className="anime-icon" />
          ) : (
            <Mic size={12} className="podcast-icon" />
          )}
          <span>{isAnime ? 'Anime Studio' : 'Podcast Studio'}</span>
        </span>
        <ChevronRight size={12} className="muted-icon-subtle" />
        <span className="breadcrumb-chip current">
          {jobName
            ? jobName
            : page === 'home'
            ? 'Overview'
            : page === 'new'
            ? 'New Project'
            : page === 'library'
            ? 'Projects Library'
            : 'Settings'}
        </span>
      </div>

      <div className="header-actions">
        <button
          type="button"
          className="theme-toggle-btn"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to Canvas Light Room' : 'Switch to Cinema Dark Room'}
          aria-label="Toggle studio theme"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <span className={`header-status ${hasActiveJob ? 'working' : ''}`}>
          <span className="status-radar">
            <span className="radar-ping" />
            <span className="radar-dot" />
          </span>
          {hasActiveJob
            ? 'Active Rendering & Analysis…'
            : isAnime
            ? 'Local GPU Beat-Sync Engine'
            : 'Local-First Processing Studio'}
        </span>
      </div>
    </header>
  );
}
