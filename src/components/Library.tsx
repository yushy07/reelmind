import React, { useState, useMemo, useDeferredValue } from 'react';
import { Plus, Search, Clapperboard, ArrowRight, ShieldCheck } from 'lucide-react';
import type { Job } from '../../shared/types';
import { stageLabels } from '../lib/stages';
import { ProjectRow } from './ProjectRow';

interface LibraryProps {
  jobs: Job[];
  studio: 'podcast' | 'anime';
  onOpenProject: (id: string) => void;
  onNewProject: () => void;
}

export function Library({ jobs, studio, onOpenProject, onNewProject }: LibraryProps) {
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
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

      // Search filter using deferred query
      if (deferredSearch.trim()) {
        const query = deferredSearch.toLowerCase();
        const titleMatch = (j.name || j.title).toLowerCase().includes(query);
        const stageMatch = (stageLabels[j.stage] || '').toLowerCase().includes(query);
        return titleMatch || stageMatch;
      }

      return true;
    });
  }, [jobs, studioFilter, statusFilter, deferredSearch]);

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
      <div className="library-controls controls-row">
        <div className="search-wrap">
          <Search size={16} className="search-icon" />
          <input
            type="search"
            placeholder="Search by title or status…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-with-search"
            aria-label="Search projects"
          />
        </div>

        {/* Studio Filter */}
        <div className="tabs controls-tabs" role="tablist" aria-label="Studio Filter">
          {(['all', 'podcast', 'anime'] as const).map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={studioFilter === s}
              className={`btn-filter ${studioFilter === s ? 'active' : ''}`}
              onClick={() => setStudioFilter(s)}
            >
              {s === 'all' ? 'All Studios' : s === 'podcast' ? 'Podcast' : 'Anime'}
            </button>
          ))}
        </div>

        {/* Status Filter */}
        <div className="tabs controls-tabs" role="tablist" aria-label="Status Filter">
          {(
            [
              ['all', 'All'],
              ['completed', 'Ready'],
              ['working', 'Working'],
              ['attention', 'Attention'],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val}
              role="tab"
              aria-selected={statusFilter === val}
              className={`btn-filter ${statusFilter === val ? 'active' : ''}`}
              onClick={() => setStatusFilter(val)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Projects List */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
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
          {filtered.map((j) => (
            <ProjectRow key={j.id} job={j} onOpen={onOpenProject} />
          ))}
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
