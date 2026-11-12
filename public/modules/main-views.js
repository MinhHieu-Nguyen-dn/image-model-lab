/**
 * Main-area views: Global settings (credentials + catalog) and the project view
 * (header with credentials source badge, override panel, task tabs, task workspace).
 */
import { h, button, emptyState, loadingState } from './dom-helpers.js';
import { state, currentProject } from './app-state.js';
import { api, enc } from './api-client.js';
import { createConnectionSettingsForm, readConnection } from './connection-settings-form.js';
import { createCatalogEditor } from './catalog-editor.js';
import { renderTaskTabs } from './sidebar-and-task-tabs.js';
import { mountTaskWorkspace } from './task-workspace.js';
import { createProject, createTask, renameProject, deleteProject } from './navigation-controller.js';

export function mountSettingsView(main) {
  main.append(
    h('header', { class: 'project-header' }, h('h1', {}, 'Global settings')),
    h('section', { class: 'panel stack' },
      h('h3', { class: 'section-title' }, 'Model Studio credentials (Global)'),
      h('p', { class: 'muted small' }, 'Used by every project without an override. Saving runs a no-cost probe request.'),
      createConnectionSettingsForm({ scope: 'global' })),
    h('section', { class: 'panel stack' },
      h('h3', { class: 'section-title' }, 'Model catalog'),
      createCatalogEditor()));
  return null;
}

/** Project override panel stays open across re-renders of the same project. */
let credsOpenFor = null;

export function mountProjectView(main) {
  const project = currentProject();
  if (!project) {
    main.append(emptyState(
      state.projects.length ? 'Select a project' : 'No projects yet',
      'Projects group generation tasks. Create one to get started.',
      button('New project', createProject, { variant: 'primary' })));
    return null;
  }

  const badge = h('span', { class: 'badge' }, 'Credentials: …');
  async function refreshBadge() {
    try {
      const { source } = readConnection(await api.get(`/api/projects/${enc(project.id)}/credentials`), 'project');
      badge.textContent = source === 'override' ? 'Credentials: Override' : source === 'global' ? 'Credentials: Global' : 'Credentials: not set';
      badge.className = `badge ${source === 'none' ? 'status-error' : 'status-info'}`;
    } catch {
      badge.textContent = 'Credentials: unknown';
    }
  }

  const credsPanel = h('section', { class: 'panel stack', hidden: credsOpenFor !== project.id },
    h('h3', { class: 'section-title' }, 'Project credentials override'));
  if (credsOpenFor === project.id) credsPanel.append(createConnectionSettingsForm({ scope: 'project', projectId: project.id, onChanged: refreshBadge }));
  function toggleCreds() {
    const opening = credsPanel.hidden;
    credsOpenFor = opening ? project.id : null;
    credsPanel.hidden = !opening;
    credsPanel.querySelector('.creds-form')?.remove();
    if (opening) credsPanel.append(createConnectionSettingsForm({ scope: 'project', projectId: project.id, onChanged: refreshBadge }));
  }

  const tabs = h('nav', { class: 'task-tabs', role: 'tablist', 'aria-label': 'Tasks' });
  const taskHost = h('div', { class: 'task-host' });
  main.append(
    h('header', { class: 'project-header row between' },
      h('div', { class: 'row' }, h('h1', {}, project.name), badge),
      h('div', { class: 'row' },
        button('Credentials', toggleCreds, { variant: 'ghost', title: 'Use Global credentials or set a project override' }),
        button('Rename', () => renameProject(project.id), { variant: 'ghost' }),
        button('Delete', () => deleteProject(project.id), { variant: 'ghost danger' }))),
    credsPanel, tabs, taskHost);
  renderTaskTabs(tabs);
  void refreshBadge();

  if (state.task && state.task.id === state.taskId) return mountTaskWorkspace(taskHost, state.task);
  if (state.tasksLoading || state.taskLoading) taskHost.append(loadingState());
  else if (!state.tasks.length) {
    taskHost.append(emptyState('No tasks yet', 'A task holds a prompt, reference images, parameters and its run history.',
      button('New task', createTask, { variant: 'primary' })));
  } else taskHost.append(emptyState('Could not open this task', 'Pick another task tab or try again.'));
  return null;
}
