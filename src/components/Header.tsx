import React from 'react';
import { ChevronRight, Cpu, Sparkles, Mic, Layers } from 'lucide-react';

interface HeaderProps {
  page: 'home' | 'new' | 'library' | 'settings';
  studio: 'podcast' | 'anime';
  jobName: string | null;
  hasActiveJob: boolean;
}

export function Header({ page, studio, jobName, hasActiveJob }: HeaderProps) {
  const isAnime = studio === 'anime';

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
