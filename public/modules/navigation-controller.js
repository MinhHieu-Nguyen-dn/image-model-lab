/**
 * Navigation + CRUD controller for projects, tasks and the settings view.
 * Mutates app state and emits 'projects' / 'main' so views re-render.
 */
import { state, emit, memory, currentProject } from './app-state.js';
import { api, enc, asArray, sortRefs } from './api-client.js';
import { reportError, showToast } from './toast-notifications.js';
import { flushAutosave } from './task-autosave.js';
import { promptText, confirmAction } from './modal-dialogs.js';

export async function loadCatalog() {
  const data = await api.get('/api/catalog');
  state.catalog = {
    models: Array.isArray(data?.models) ? data.models : [],
    refTemplate: typeof data?.refTemplate === 'string' ? data.refTemplate : 'image {n}',
  };
  emit('catalog');
}

export async function loadProjects() {
  state.projects = asArray(await api.get('/api/projects'), 'projects');
  emit('projects');
}

function resetTaskState() {
  state.taskId = null;
  state.task = null;
  state.runs = [];
  state.runsTaskId = null;
  state.selectedRunId = null;
}

export async function openSettings() {
  await flushAutosave();
  state.view = 'settings';
  memory.setLastView({ view: 'settings', projectId: state.projectId });
  emit('projects');
  emit('main');
}

/** Open a project and restore its last open task (or the first one). */
export async function selectProject(projectId) {
  await flushAutosave();
  state.view = 'project';
  state.projectId = projectId;
  state.tasks = [];
  state.tasksLoading = true;
  resetTaskState();
  memory.setLastView({ view: 'project', projectId });
  emit('projects');
  emit('main');
  try {
    const tasks = asArray(await api.get(`/api/projects/${enc(projectId)}/tasks`), 'tasks');
    if (state.projectId !== projectId) return;
    state.tasks = tasks;
  } catch (err) {
    reportError(err, 'Could not load tasks');
  } finally {
    state.tasksLoading = false;
  }
  const remembered = memory.getLastTask(projectId);
  const target = state.tasks.find((t) => t.id === remembered) ?? state.tasks[0];
  if (target) await selectTask(target.id);
  else emit('main');
}

/** Load a task fully (with refs) and show it in the editor. */
export async function selectTask(taskId) {
  await flushAutosave();
  resetTaskState();
  state.taskId = taskId;
  state.taskLoading = true;
  memory.setLastTask(state.projectId, taskId);
  emit('main');
  try {
    const task = await api.get(`/api/tasks/${enc(taskId)}`);
    if (state.taskId !== taskId) return;
    task.refs = sortRefs(task.refs);
    task.models = Array.isArray(task.models) ? task.models : [];
    state.task = task;
  } catch (err) {
    reportError(err, 'Could not load task');
  } finally {
    if (state.taskId === taskId) state.taskLoading = false;
  }
  if (state.taskId === taskId) emit('main');
}

export async function createProject() {
  const name = await promptText({ title: 'New project', label: 'Project name', initial: 'Untitled project', confirmLabel: 'Create' });
  if (!name) return;
  try {
    const project = await api.post('/api/projects', { name });
    state.projects.push(project);
    await selectProject(project.id);
  } catch (err) { reportError(err, 'Could not create project'); }
}

export async function renameProject(projectId) {
  const project = state.projects.find((p) => p.id === projectId);
  const name = await promptText({ title: 'Rename project', label: 'Project name', initial: project?.name ?? '' });
  if (!name || !project) return;
  try {
    const updated = await api.patch(`/api/projects/${enc(projectId)}`, { name });
    project.name = updated?.name ?? name;
    emit('projects');
    emit('main');
  } catch (err) { reportError(err, 'Could not rename project'); }
}

export async function deleteProject(projectId) {
  const project = state.projects.find((p) => p.id === projectId);
  const ok = await confirmAction({
    title: 'Delete project',
    message: `Delete "${project?.name ?? 'this project'}" with all its tasks, reference images and generated images? This cannot be undone.`,
  });
  if (!ok) return;
  try {
    await flushAutosave();
    await api.del(`/api/projects/${enc(projectId)}`);
    state.projects = state.projects.filter((p) => p.id !== projectId);
    showToast('Project deleted', 'success');
    if (state.projects[0]) await selectProject(state.projects[0].id);
    else { state.projectId = null; state.tasks = []; resetTaskState(); emit('projects'); emit('main'); }
  } catch (err) { reportError(err, 'Could not delete project'); }
}

export async function createTask() {
  const project = currentProject();
  if (!project) return;
  const name = await promptText({ title: 'New task', label: 'Task name', initial: `Task ${state.tasks.length + 1}`, confirmLabel: 'Create' });
  if (!name) return;
  try {
    const task = await api.post(`/api/projects/${enc(project.id)}/tasks`, { name });
    state.tasks.push(task);
    await selectTask(task.id);
  } catch (err) { reportError(err, 'Could not create task'); }
}

export async function renameTask(taskId) {
  const entry = state.tasks.find((t) => t.id === taskId);
  const name = await promptText({ title: 'Rename task', label: 'Task name', initial: entry?.name ?? '' });
  if (!name || !entry) return;
  try {
    await flushAutosave();
    const updated = await api.patch(`/api/tasks/${enc(taskId)}`, { name });
    entry.name = updated?.name ?? name;
    if (state.task?.id === taskId) state.task.name = entry.name;
    emit('main');
  } catch (err) { reportError(err, 'Could not rename task'); }
}

export async function deleteTask(taskId) {
  const entry = state.tasks.find((t) => t.id === taskId);
  const ok = await confirmAction({
    title: 'Delete task',
    message: `Delete "${entry?.name ?? 'this task'}" with its reference images and run history? This cannot be undone.`,
  });
  if (!ok) return;
  try {
    await flushAutosave();
    await api.del(`/api/tasks/${enc(taskId)}`);
    const index = state.tasks.findIndex((t) => t.id === taskId);
    state.tasks = state.tasks.filter((t) => t.id !== taskId);
    showToast('Task deleted', 'success');
    const next = state.tasks[Math.min(index, state.tasks.length - 1)];
    if (next) await selectTask(next.id);
    else { resetTaskState(); emit('main'); }
  } catch (err) { reportError(err, 'Could not delete task'); }
}
