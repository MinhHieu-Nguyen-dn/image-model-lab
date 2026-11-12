/**
 * Sidebar project list and the task tab strip of the open project.
 */
import { h, clear } from './dom-helpers.js';
import { state } from './app-state.js';
import { selectProject, selectTask, createTask, renameTask } from './navigation-controller.js';

export function renderSidebar(listEl) {
  clear(listEl);
  if (!state.projects.length) {
    listEl.append(h('li', { class: 'muted small sidebar-empty' }, 'No projects yet.'));
    return;
  }
  for (const project of state.projects) {
    const active = state.view === 'project' && project.id === state.projectId;
    listEl.append(h('li', {},
      h('button', {
        type: 'button', class: `nav-item${active ? ' active' : ''}`, title: project.name,
        'aria-current': active ? 'page' : null,
        onClick: () => { if (!active) void selectProject(project.id); },
      }, project.name)));
  }
}

export function renderTaskTabs(nav) {
  clear(nav);
  for (const task of state.tasks) {
    const active = task.id === state.taskId;
    nav.append(h('button', {
      type: 'button', role: 'tab', class: `tab${active ? ' active' : ''}`,
      'aria-selected': String(active), title: 'Double-click to rename',
      onClick: () => { if (!active) void selectTask(task.id); },
      onDblclick: () => renameTask(task.id),
    }, task.name));
  }
  nav.append(h('button', { type: 'button', class: 'tab tab-new', onClick: createTask }, '+ New task'));
}
