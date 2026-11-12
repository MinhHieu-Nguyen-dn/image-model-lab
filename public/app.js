/**
 * Image Model Lab frontend entry point: wires the sidebar, main-area router and
 * global drag/drop guards, then loads the catalog + projects and restores the last view.
 */
import { state, on, memory } from './modules/app-state.js';
import { clear } from './modules/dom-helpers.js';
import { reportError } from './modules/toast-notifications.js';
import { flushAutosave } from './modules/task-autosave.js';
import { renderSidebar } from './modules/sidebar-and-task-tabs.js';
import { mountSettingsView, mountProjectView } from './modules/main-views.js';
import { mountHistoryView } from './modules/history-view.js';
import {
  loadCatalog, loadProjects, selectProject, openSettings, openHistory, createProject,
} from './modules/navigation-controller.js';

const projectList = document.getElementById('project-list');
const main = document.getElementById('main');
const settingsButton = document.getElementById('open-settings');
const historyButton = document.getElementById('open-history');
let disposeMain = null;

function renderMain() {
  try { disposeMain?.(); } catch (err) { console.error('Dispose failed', err); }
  disposeMain = null;
  clear(main);
  if (state.view === 'settings') disposeMain = mountSettingsView(main);
  else if (state.view === 'history') disposeMain = mountHistoryView(main);
  else disposeMain = mountProjectView(main);
}

on('projects', () => {
  renderSidebar(projectList);
  settingsButton.classList.toggle('active', state.view === 'settings');
  historyButton.classList.toggle('active', state.view === 'history');
});
on('main', renderMain);

document.getElementById('new-project').addEventListener('click', () => void createProject());
settingsButton.addEventListener('click', () => void openSettings());
historyButton.addEventListener('click', () => void openHistory());

// Dropping a file outside a drop zone must not navigate the page away.
const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', (e) => { if (hasFiles(e)) e.preventDefault(); });

// Best-effort save of pending edits when the tab is hidden or closed.
document.addEventListener('visibilitychange', () => { if (document.hidden) void flushAutosave(); });
window.addEventListener('pagehide', () => void flushAutosave());

async function boot() {
  renderSidebar(projectList);
  renderMain();
  const results = await Promise.allSettled([loadCatalog(), loadProjects()]);
  results.forEach((r, i) => {
    if (r.status === 'rejected') reportError(r.reason, i === 0 ? 'Could not load model catalog' : 'Could not load projects');
  });
  const last = memory.getLastView();
  const remembered = state.projects.find((p) => p.id === last?.projectId);
  if (remembered) state.projectId = remembered.id;
  if (last?.view === 'settings') await openSettings();
  else if (last?.view === 'history') await openHistory();
  else if (remembered) await selectProject(remembered.id);
  else if (state.projects[0]) await selectProject(state.projects[0].id);
  else renderMain();
}

void boot();
