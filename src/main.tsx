import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Monitor, LoaderCircle, AlertCircle, X } from 'lucide-react';
import type { API, Status, Job } from '../shared/types';
import './styles/theme.css';
import './styles/components.css';

import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { Overview } from './components/Overview';
import { NewProjectPodcast } from './components/NewProjectPodcast';
import { NewProjectAnime } from './components/NewProjectAnime';
import { ProjectDetail } from './components/ProjectDetail';
import { Library } from './components/Library';
import { SettingsView } from './components/SettingsView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { StatusProvider, useStatus } from './context/StatusContext';
import { podcastStages, animeStages } from './lib/stages';

declare global {
  interface Window {
    reelmind?: API;
  }
}

const api = window.reelmind;

function App() {
  const { data, refresh, busy, act, error, setError, toast, setToast } = useStatus();
  const [studio, setStudio] = useState<'podcast' | 'anime'>('podcast');
  const [page, setPage] = useState<'home' | 'new' | 'library' | 'settings'>('home');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(
    () =>
      api?.onReady((id) => {
        setSelected(id);
        void refresh();
        setToast('Your Reels are ready. Choose Save Reels to keep them in your own folder.');
      }),
    [refresh, setToast]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName || '');
      if (e.key === 'Escape') {
        if (selected) {
          setSelected(null);
        } else if (page !== 'home') {
          go('home');
        }
      } else if (!isInput && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        go('new');
      } else if (!isInput && (e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        go('settings');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected, page]);

  const go = (p: typeof page) => {
    setPage(p);
    setSelected(null);
    setError('');
  };

  const job = data?.jobs.find((j) => j.id === selected);
  const studioJobs = data?.jobs.filter((j) => (studio === 'anime' ? j.studio === 'anime' : j.studio !== 'anime')) || [];
  const completed = studioJobs.filter((j) => j.stage === 'completed').length;
  const activeJob = data?.jobs.find((j) =>
    (j.studio === 'anime' ? animeStages : podcastStages).slice(0, -1).includes(j.stage as never)
  );

  return (
    <div className="app">
      {/* Professional Sidebar Navigation */}
      <Sidebar
        studio={studio}
        setStudio={(s) => {
          setStudio(s);
          go('home');
        }}
        page={page}
        go={go}
        completed={completed}
        hardware={data?.hardware || ''}
        runtimeReady={Boolean(data?.runtime.ready)}
        selectedJob={Boolean(job)}
      />

      <main>
        {/* Studio Header Bar */}
        <Header
          page={page}
          studio={studio}
          jobName={job?.name || job?.title || null}
          hasActiveJob={Boolean(activeJob)}
        />

        {/* Global Error Banner */}
        {error && (
          <div className="alert alert-banner" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
            <button
              onClick={() => setError('')}
              aria-label="Dismiss error"
              className="btn-ghost-dismiss"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Floating Toast Notification */}
        {toast && (
          <div className="toast" role="status">
            <span>{toast}</span>
            <button
              onClick={() => setToast('')}
              aria-label="Dismiss message"
              className="btn-ghost-white"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Main Content Area */}
        <div className="page">
          {!api ? (
            <div className="empty">
              <Monitor size={48} />
              <h2>Launch REELMIND Desktop App</h2>
              <p>This is the studio frontend. Run within Electron desktop runtime to process media.</p>
            </div>
          ) : !data ? (
            <div className="empty">
              <LoaderCircle className="spin" size={32} />
              <p>Initializing your creative studio…</p>
            </div>
          ) : job ? (
            <ProjectDetail
              job={job}
              busy={busy}
              onAction={(action) => act(() => api.action(job.id, action))}
              onSave={(reelId) =>
                act(async () => {
                  const dest = await api.save(job.id, reelId);
                  if (dest) setToast(reelId ? `Reel saved in ${dest}` : `Your Reels are saved in ${dest}`);
                })
              }
              onRerender={async (conceptId, opts) => {
                await act(async () => {
                  if (api?.rerenderAnime) await api.rerenderAnime(job.id, conceptId, opts);
                  setToast('AMV edit re-rendered successfully.');
                });
              }}
              back={() => setSelected(null)}
            />
          ) : page === 'new' ? (
            studio === 'anime' ? (
              <NewProjectAnime
                ready={data.runtime.ready}
                busy={busy}
                settings={() => go('settings')}
                onCreate={(input) =>
                  act(async () => {
                    if (api.createAnime) setSelected(await api.createAnime(input));
                  })
                }
                pickVideo={() => api.pickVideo()}
                pickAudio={() => (api.pickAudio ? api.pickAudio() : Promise.resolve(null))}
              />
            ) : (
              <NewProjectPodcast
                ready={data.runtime.ready}
                busy={busy}
                settings={() => go('settings')}
                onCreate={(input) =>
                  act(async () => {
                    setSelected(await api.create(input));
                  })
                }
                pick={() => api.pickVideo()}
              />
            )
          ) : page === 'library' ? (
            <Library
              jobs={data.jobs}
              studio={studio}
              onOpenProject={(id) => setSelected(id)}
              onNewProject={() => go('new')}
            />
          ) : page === 'settings' ? (
            <SettingsView
              data={data}
              busy={busy}
              save={(s, k) =>
                act(async () => {
                  await api.settings(s, k);
                  setToast('Settings saved securely to Windows Credential Manager.');
                })
              }
              setup={() => act(() => api.setup())}
            />
          ) : (
            <Overview
              studio={studio}
              jobs={studioJobs}
              runtimeReady={data.runtime.ready}
              onOpenProject={(id) => setSelected(id)}
              onNewProject={() => go('new')}
              onGoSettings={() => go('settings')}
            />
          )}
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <StatusProvider>
      <App />
    </StatusProvider>
  </ErrorBoundary>
);
