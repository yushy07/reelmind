import React, { useState, useMemo } from 'react';
import {
  Film,
  Sparkles,
  Plus,
  Search,
  ChevronRight,
  Clapperboard,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import type { Job } from '../../shared/types';
import { podcastStages, animeStages, stageLabels } from '../lib/stages';
import { durationFormat } from '../lib/format';

interface LibraryProps {
  jobs: Job[];
  studio: 'podcast' | 'anime';
  onOpenProject: (id: string) => void;
  onNewProject: () => void;
}

export function Library({ jobs, studio, onOpenProject, onNewProject }: LibraryProps) {
  const [search, setSearch] = useState('');
  const [studioFilter, setStudioFilter] = useState<'all' | 'podcast' | 'anime'>(studio);
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'working' | 'attention'>('all');

  const filtered = useMemo(() => {
    return jobs.filter((j) => {
      // Studio filter
      if (studioFilter === 'podcast' && j.studio === 'anime') return false;
      if (studioFilter === 'anime' && j.studio !== 'anime') return false;

      // Status filter
      if (statusFilter === 'completed' && j.stage !== 'completed') return false;
      if (
        statusFilter === 'working' &&
        ['completed', 'expired', 'paused', 'failed'].includes(j.stage)
      )
        return false;
      if (statusFilter === 'attention' && !['paused', 'failed', 'expired'].includes(j.stage))
        return false;

      // Search filter
      if (search.trim()) {
        const query = search.toLowerCase();
        const titleMatch = (j.name || j.title).toLowerCase().includes(query);
        const stageMatch = (stageLabels[j.stage] || '').toLowerCase().includes(query);
        return titleMatch || stageMatch;
      }

      return true;
    });
  }, [jobs, studioFilter, statusFilter, search]);

  return (
    <div className="library-view">
      <div className="page-heading">
        <div>
          <div className="eyebrow">STUDIO REPOSITORY</div>
          <h1>Your Projects.</h1>
          <p>All finished and in-progress video projects processed locally on this workstation.</p>
        </div>
        <button className="primary" onClick={onNewProject}>
          <Plus size={16} /> New Project
        </button>
      </div>

      {/* Search & Filter Bar */}
      <div
        className="library-controls controls-row"
      >
        {/* Search Input */}
        <div className="search-wrap">
          <Search
            size={16}
            className="search-icon"
          />
          <input
            type="text"
            placeholder="Search projects by title or status…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-with-search"
          />
        </div>

        {/* Studio Filter Pills */}
        <div className="tabs controls-tabs">
          <button
            type="button"
            className={`${studioFilter === 'all' ? 'active' : ''} btn-filter`}
            onClick={() => setStudioFilter('all')}
          >
            All Workspaces
          </button>
          <button
            type="button"
            className={`${studioFilter === 'podcast' ? 'active' : ''} btn-filter`}
            onClick={() => setStudioFilter('podcast')}
          >
            Podcast
          </button>
          <button
            type="button"
            className={`${studioFilter === 'anime' ? 'active' : ''} btn-filter`}
            onClick={() => setStudioFilter('anime')}
          >
            Anime AMV
          </button>
        </div>

        {/* Status Filter Pills */}
        <div className="tabs controls-tabs">
          <button
            type="button"
            className={`${statusFilter === 'all' ? 'active' : ''} btn-filter`}
            onClick={() => setStatusFilter('all')}
          >
            All ({jobs.length})
          </button>
          <button
            type="button"
            className={`${statusFilter === 'completed' ? 'active' : ''} btn-filter`}
            onClick={() => setStatusFilter('completed')}
          >
            Completed
          </button>
          <button
            type="button"
            className={`${statusFilter === 'working' ? 'active' : ''} btn-filter`}
            onClick={() => setStatusFilter('working')}
          >
            Active
          </button>
          <button
            type="button"
            className={`${statusFilter === 'attention' ? 'active' : ''} btn-filter`}
            onClick={() => setStatusFilter('attention')}
          >
            Attention
          </button>
        </div>
      </div>

      {/* Project Rows */}
      {filtered.length === 0 ? (
        <div className="empty-projects">
          <div className="empty-icon">
            <Clapperboard size={24} />
          </div>
          <h3>No Projects Match Your Filter</h3>
          <p>
            {search.trim()
              ? `No projects matched "${search}". Try clearing your search term.`
              : 'Start a new project to produce Reels or Anime AMVs.'}
          </p>
          <button className="text-button" onClick={onNewProject}>
            Create a Project <ArrowRight size={15} />
          </button>
        </div>
      ) : (
        <div className="project-list">
          {filtered.map((j) => {
            const isAnime = j.studio === 'anime';
            const activeStages = (isAnime ? animeStages : podcastStages).slice(0, -1) as readonly string[];
            const working = activeStages.includes(j.stage);
            const details = [
              isAnime
                ? `ANIME (${j.input.language?.toUpperCase() || 'JA'})`
                : j.input.kind === 'url'
                ? 'VIDEO LINK'
                : 'LOCAL VIDEO',
              new Date(j.createdAt).toLocaleDateString(),
              j.duration ? durationFormat(j.duration) : null,
              isAnime
                ? j.outputs.length
                  ? `${j.outputs.length} AMV ${j.outputs.length === 1 ? 'Edit' : 'Edits'}`
                  : j.animeAnalysis
                  ? `${j.animeAnalysis.shotCount} shots · ${j.animeAnalysis.bpm} BPM`
                  : 'Analysis DB'
                : j.outputs.length
                ? `${j.outputs.length} ${j.outputs.length === 1 ? 'Reel' : 'Reels'} Ready`
                : null,
            ].filter(Boolean);

            return (
              <button
                className="project-row"
                key={j.id}
                onClick={() => onOpenProject(j.id)}
                aria-label={`Open ${j.name || j.title}, ${stageLabels[j.stage]}`}
              >
                <span className={`project-thumb ${isAnime ? 'anime-thumb' : ''}`}>
                  {isAnime ? <Sparkles size={22} /> : <Film size={22} />}
                </span>
                <span className="project-row-content">
                  <span className="project-row-kicker">{details.join('  ·  ')}</span>
                  <strong>{j.name || j.title}</strong>
                  <small>
                    {working
                      ? j.message
                      : j.stage === 'completed'
                      ? isAnime
                        ? j.outputs.length
                          ? `${j.outputs.length} AMV Edits ready to save`
                          : 'Analysis Database ready'
                        : j.outputs.every((r) => r.savedPath)
                        ? 'Saved to your folder'
                        : 'Ready to review and save'
                      : j.stage === 'paused'
                      ? 'Resume before recovery expires'
                      : j.stage === 'failed'
                      ? 'Open to review and retry'
                      : j.title}
                  </small>
                  {working && (
                    <progress
                      className="row-progress"
                      value={j.progress}
                      max={100}
                      aria-label={`${j.name || j.title} progress`}
                    />
                  )}
                </span>
                <span className={`badge ${j.stage}`}>
                  {stageLabels[j.stage]}
                  {working ? ` · ${Math.floor(j.progress)}%` : ''}
                </span>
                <ChevronRight className="project-row-chevron" size={18} />
              </button>
            );
          })}
        </div>
      )}

      <footer>
        <ShieldCheck size={14} />
        Originals stay untouched. All project states are preserved locally.
        <span>REELMIND WORKSPACE REPOSITORY</span>
      </footer>
    </div>
  );
}
