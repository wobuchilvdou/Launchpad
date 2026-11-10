const state = {
  apps: [], wallpapers: [], recent: [], pinned: [], folders: {}, wallpaperId: '', wallpaperIds: [], diagnostics: null,
  settings: { opacity: 92, iconSize: 72, columns: 10, wallpaperBrightness: 100, wallpaperMode: 'desktop', launchAtLogin: false },
  edit: false, selected: new Set(), dragId: '', query: '', filter: 'all', page: 0, saveTimer: null, orderQueue: Promise.resolve(), wallpaperRequest: 0, loginItemAvailable: null,
};

const $ = (id) => document.getElementById(id);
const grid = $('grid');
function normalize(value) { return String(value || '').trim().toLocaleLowerCase('en-US'); }
function showToast(message, isError = false) { const toast = $('toast'); toast.textContent = message; toast.classList.toggle('error', isError); toast.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 3200); }
function folderApps(name) { return (state.folders[name] || []).map((id) => state.apps.find((appItem) => normalize(appItem.id) === normalize(id))).filter(Boolean); }
function containedIds() { return new Set(Object.values(state.folders).flat().map(normalize)); }
function visibleApps() {
  const contained = containedIds(); let apps = state.apps.filter((appItem) => !contained.has(normalize(appItem.id)));
  if (state.filter === 'recent') apps = state.recent.map((id) => state.apps.find((appItem) => normalize(appItem.id) === normalize(id))).filter(Boolean).filter((appItem) => !contained.has(normalize(appItem.id)));
  if (state.filter === 'work') apps = apps.filter((appItem) => /office|excel|word|powerpoint|钉钉|企业微信|微信|qq|会议|飞书/i.test(`${appItem.name} ${appItem.target}`));
  if (state.filter === 'creative') apps = apps.filter((appItem) => /photoshop|剪映|premiere|obs|wallpaper|vscode|visual|python|figma/i.test(`${appItem.name} ${appItem.target}`));
  const query = state.query.toLocaleLowerCase('zh-CN');
  return apps.filter((appItem) => !query || `${appItem.name} ${appItem.target}`.toLocaleLowerCase('zh-CN').includes(query));
}
function createFallback() { const fallback = document.createElement('span'); fallback.className = 'fallback'; fallback.textContent = '✦'; return fallback; }
function togglePinned(id) { const key = normalize(id); state.pinned = state.pinned.some((item) => normalize(item) === key) ? state.pinned.filter((item) => normalize(item) !== key) : [id, ...state.pinned].slice(0, 64); scheduleStateSave(); render(); }
function createAppCard(appItem, index) {
  const card = document.createElement('article'); card.className = 'card'; card.style.setProperty('--index', index); card.dataset.id = appItem.id; card.draggable = state.edit; card.tabIndex = 0; card.title = appItem.target;
  const icon = appItem.icon ? new Image() : createFallback();
  if (appItem.icon) { icon.src = appItem.icon; icon.alt = ''; icon.addEventListener('error', () => icon.replaceWith(createFallback()), { once: true }); }
  const pin = document.createElement('button'); pin.className = 'pin-action'; pin.type = 'button'; pin.textContent = state.pinned.some((id) => normalize(id) === normalize(appItem.id)) ? '★' : '☆'; pin.title = pin.textContent === '★' ? '取消固定' : '固定到常用应用'; pin.setAttribute('aria-label', pin.title); pin.addEventListener('click', (event) => { event.stopPropagation(); togglePinned(appItem.id); });
  const label = document.createElement('label'); label.textContent = appItem.name; card.append(pin, icon, label);
  card.addEventListener('click', (event) => { if (state.edit) toggleSelection(appItem.id, card, event.ctrlKey || event.metaKey); else launchApp(appItem); });
  card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (state.edit) toggleSelection(appItem.id, card, event.ctrlKey || event.metaKey); else launchApp(appItem); } });
  card.addEventListener('dragstart', (event) => { if (!state.edit) return event.preventDefault(); state.dragId = appItem.id; card.classList.add('dragging'); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', appItem.id); });
  card.addEventListener('dragend', () => { state.dragId = ''; card.classList.remove('dragging'); $('trash').classList.remove('hot'); });
  card.addEventListener('dragover', (event) => { if (state.edit) event.preventDefault(); });
  card.addEventListener('drop', (event) => { if (!state.edit) return; event.preventDefault(); moveBefore(state.dragId, appItem.id); });
  return card;
}
function createFolderCard(name, index) {
  const card = document.createElement('article'); card.className = 'card folder-card'; card.style.setProperty('--index', index);
  const icon = document.createElement('div'); icon.className = 'folder-icon';
  folderApps(name).slice(0, 4).forEach((appItem) => { const image = appItem.icon ? new Image() : createFallback(); if (appItem.icon) image.src = appItem.icon; icon.append(image); });
  const label = document.createElement('label'); label.textContent = name; card.append(icon, label); card.addEventListener('click', () => openFolder(name)); return card;
}
function toggleSelection(id, card, additive) { if (!additive) state.selected.clear(); if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id); card.classList.toggle('selected', state.selected.has(id)); if (!additive) render(); }
function pageMetrics(total) { const width = grid.clientWidth || window.innerWidth; const height = Math.max(280, grid.clientHeight || window.innerHeight - 240); const columns = Math.max(1, Math.min(state.settings.columns, Math.floor((width + 10) / 82))); const rows = Math.max(1, Math.min(8, Math.floor((height + 13) / 131))); const perPage = columns * rows; return { perPage, pages: Math.max(1, Math.ceil(total / perPage)) }; }
function render() {
  const apps = visibleApps(); const folders = Object.keys(state.folders).filter((name) => !state.query || name.toLocaleLowerCase('zh-CN').includes(state.query.toLocaleLowerCase('zh-CN'))).map((name) => ({ folder: name }));
  const list = [...folders, ...apps]; const metrics = pageMetrics(list.length); state.page = Math.min(state.page, metrics.pages - 1);
  grid.replaceChildren(); list.slice(state.page * metrics.perPage, (state.page + 1) * metrics.perPage).forEach((item, index) => grid.append(item.folder ? createFolderCard(item.folder, index) : createAppCard(item, index)));
  $('empty').hidden = list.length > 0; $('count').textContent = `${list.length} 项`; $('pageLabel').textContent = `第 ${state.page + 1} / ${metrics.pages} 页`; $('prevPage').disabled = state.page === 0; $('nextPage').disabled = state.page >= metrics.pages - 1;
  const dots = $('dots'); dots.replaceChildren(); for (let index = 0; index < metrics.pages; index += 1) { const dot = document.createElement('button'); dot.type = 'button'; dot.className = index === state.page ? 'active' : ''; dot.setAttribute('aria-label', `第 ${index + 1} 页`); dot.addEventListener('click', () => { state.page = index; render(); }); dots.append(dot); }
  renderFavorites();
}
function renderFavorites() { const ids = [...state.pinned, ...state.recent].filter((id, index, all) => all.findIndex((candidate) => normalize(candidate) === normalize(id)) === index).slice(0, 8); const favorites = ids.map((id) => state.apps.find((appItem) => normalize(appItem.id) === normalize(id))).filter(Boolean); $('favorites').hidden = !favorites.length; $('favorites').querySelector('small').textContent = state.pinned.length ? '固定与最近使用' : '最近使用'; const wrap = $('favoriteGrid'); wrap.replaceChildren(); favorites.forEach((appItem, index) => wrap.append(createAppCard(appItem, index))); }
function scheduleStateSave() { clearTimeout(state.saveTimer); state.saveTimer = setTimeout(() => window.launchpad.saveState({ settings: state.settings, recent: state.recent, pinned: state.pinned, folders: state.folders, wallpaperId: state.wallpaperId, wallpaperIds: state.wallpaperIds }).catch((error) => showToast(error.message, true)), 240); }
async function launchApp(appItem) { try { await window.launchpad.launchApp(appItem.id); state.recent = [appItem.id, ...state.recent.filter((id) => normalize(id) !== normalize(appItem.id))].slice(0, 8); scheduleStateSave(); renderFavorites(); } catch (error) { showToast(`无法启动 ${appItem.name}：${error.message}`, true); } }
async function moveBefore(from, to) { if (!from || from === to) return; const fromIndex = state.apps.findIndex((item) => normalize(item.id) === normalize(from)); const toIndex = state.apps.findIndex((item) => normalize(item.id) === normalize(to)); if (fromIndex < 0 || toIndex < 0) return; const [item] = state.apps.splice(fromIndex, 1); state.apps.splice(state.apps.findIndex((candidate) => normalize(candidate.id) === normalize(to)), 0, item); render(); const ids = state.apps.map((appItem) => appItem.id); state.orderQueue = state.orderQueue.then(() => window.launchpad.saveOrder(ids)).catch((error) => showToast(`保存排序失败：${error.message}`, true)); await state.orderQueue; }
function openFolder(name) { $('folderTitle').textContent = name; $('folderPanel').dataset.folder = name; const content = $('folderGrid'); content.replaceChildren(); folderApps(name).forEach((appItem, index) => content.append(createAppCard(appItem, index))); $('folderPanel').hidden = false; }
const folderNameError = '文件夹名称不能为空，且不能超过 40 个字符或包含 Windows 保留符号。';
function validFolderName(value, silent = false) { const clean = String(value || '').trim(); if (!clean || clean.length > 40 || /[\\/:*?"<>|]/.test(clean)) { if (!silent) showToast(folderNameError, true); return null; } return clean; }
let nameDialogResolve = null; let nameDialogOpener = null;
function closeNameDialog(result) { if (!nameDialogResolve) return; const resolve = nameDialogResolve; nameDialogResolve = null; $('nameDialog').hidden = true; const opener = nameDialogOpener; nameDialogOpener = null; if (opener && document.contains(opener)) opener.focus(); resolve(result); }
function submitNameDialog() { if (!nameDialogResolve) return; const clean = validFolderName($('nameInput').value, true); if (!clean) { $('nameError').textContent = folderNameError; $('nameInput').focus(); return; } closeNameDialog(clean); }
async function askFolderName(initialValue = '') {
  if (nameDialogResolve) return null;
  const dialog = $('nameDialog'); const input = $('nameInput');
  nameDialogOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  $('nameError').textContent = '';
  input.value = String(initialValue ?? '');
  dialog.hidden = false;
  input.focus(); input.select();
  return new Promise((resolve) => { nameDialogResolve = resolve; });
}
$('nameConfirm').addEventListener('click', submitNameDialog);
$('nameCancel').addEventListener('click', () => closeNameDialog(null));
$('nameDialog').addEventListener('click', (event) => { if (event.target === $('nameDialog')) closeNameDialog(null); });
$('nameDialog').addEventListener('keydown', (event) => { if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); submitNameDialog(); } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeNameDialog(null); } });
async function createFolder() { if (!state.edit || state.selected.size < 2) return showToast('请先点击“整理”，再选择至少两个应用。', true); const clean = await askFolderName('新文件夹'); if (!clean) return; if (Object.keys(state.folders).some((existing) => normalize(existing) === normalize(clean))) return showToast('已存在同名文件夹。', true); state.folders[clean] = [...state.selected]; state.selected.clear(); scheduleStateSave(); render(); }
async function renameFolder() { const oldName = $('folderPanel').dataset.folder; const clean = await askFolderName(oldName); if (!clean || clean === oldName) return; if (Object.keys(state.folders).some((name) => normalize(name) === normalize(clean) && name !== oldName)) return showToast('已存在同名文件夹。', true); state.folders[clean] = state.folders[oldName]; delete state.folders[oldName]; $('folderPanel').hidden = true; scheduleStateSave(); render(); }
function deleteFolder() { const name = $('folderPanel').dataset.folder; if (!name) return; delete state.folders[name]; $('folderPanel').hidden = true; scheduleStateSave(); render(); }
function setEdit(enabled) { state.edit = enabled; state.selected.clear(); document.body.classList.toggle('editing', enabled); $('edit').textContent = enabled ? '完成' : '整理'; $('folder').disabled = !enabled; $('mode').textContent = enabled ? 'EDIT MODE / 整理' : 'APPLICATIONS / 应用'; $('title').textContent = enabled ? '整理应用' : '所有应用'; render(); }

function stopWallpaperMedia() { const video = $('wallpaperVideo'); video.pause(); video.removeAttribute('src'); video.load(); video.classList.remove('wallpaper-cover'); video.hidden = true; const web = $('wallpaperWeb'); web.src = 'about:blank'; web.hidden = true; $('wallpaperImage').classList.remove('wallpaper-cover'); }
async function applyWallpaper() {
  const request = ++state.wallpaperRequest;
  const mode = state.settings.wallpaperMode; let item = null; let source = null; let mediaType = 'image';
  if (mode === 'desktop') source = await window.launchpad.getDesktopWallpaper(); else { item = state.wallpapers.find((wallpaper) => normalize(wallpaper.id) === normalize(state.wallpaperId)); source = item?.source || null; mediaType = item?.mediaType || 'image'; }
  if (request !== state.wallpaperRequest) return;
  const wallpaper = $('wallpaper'); const image = $('wallpaperImage'); stopWallpaperMedia(); image.style.removeProperty('background-image');
  if (!source) { wallpaper.hidden = true; $('wallpaperStatus').textContent = mode === 'desktop' ? '未读取到当前桌面壁纸，将使用默认背景。' : '请选择一张可用的本地壁纸。'; return; }
  wallpaper.hidden = false;
  if (mediaType === 'video') { const video = $('wallpaperVideo'); video.classList.add('wallpaper-cover'); video.src = source; video.hidden = false; await video.play().catch(() => { if (request === state.wallpaperRequest) showToast('视频壁纸无法自动播放。', true); }); }
  else if (mediaType === 'web') { const web = $('wallpaperWeb'); web.src = source; web.hidden = false; }
  else { image.classList.toggle('wallpaper-cover', Boolean(item?.cover)); image.style.backgroundImage = `url("${source.replace(/"/g, '%22')}")`; }
  $('wallpaperStatus').textContent = mode === 'desktop' ? '正在使用当前 Windows 桌面壁纸。点击“刷新当前桌面壁纸”可手动更新。' : `正在使用：${item.name}${mediaType === 'web' ? '（Web 壁纸）' : mediaType === 'video' ? '（视频壁纸）' : ''}`;
}
function selectedWallpapers() { return state.wallpapers.filter((wallpaper) => wallpaper.available && state.wallpaperIds.some((id) => normalize(id) === normalize(wallpaper.id))); }
function renderWallpapers() {
  const available = selectedWallpapers(); const select = $('wallpaperSelect'); select.replaceChildren();
  if (!available.length) select.append(new Option('请先在下方管理列表中勾选壁纸', '')); else { for (const item of available) select.append(new Option(item.name, item.id)); if (!available.some((item) => normalize(item.id) === normalize(state.wallpaperId))) state.wallpaperId = available[0].id; select.value = state.wallpaperId; }
  $('wallpaperMode').value = state.settings.wallpaperMode; $('wallpaperPicker').hidden = state.settings.wallpaperMode !== 'custom';
  const manager = $('wallpaperLibraryPicker'); manager.replaceChildren();
  for (const item of state.wallpapers) { const row = document.createElement('label'); row.className = `wallpaper-library-item${item.available ? '' : ' unavailable'}`; const input = document.createElement('input'); input.type = 'checkbox'; input.value = item.id; input.checked = state.wallpaperIds.some((id) => normalize(id) === normalize(item.id)); input.disabled = !item.available; const text = document.createElement('span'); text.textContent = item.available ? `${item.name} · ${item.mediaType === 'image' ? '图片' : item.mediaType === 'video' ? '视频' : 'Web'}` : `${item.name} · ${item.reason}`; row.append(input, text); manager.append(row); }
}
async function scanWallpapers() {
  $('wallpaperStatus').textContent = '正在扫描 Steam Wallpaper Engine 本地库…';
  try { state.wallpapers = await window.launchpad.listWallpapers(true); const availableIds = new Set(state.wallpapers.filter((item) => item.available).map((item) => normalize(item.id))); const before = state.wallpaperIds.length; state.wallpaperIds = state.wallpaperIds.filter((id) => availableIds.has(normalize(id))); if (state.wallpaperIds.length !== before) scheduleStateSave(); renderWallpapers(); await applyWallpaper(); } catch (error) { $('wallpaperStatus').textContent = `扫描失败：${error.message}`; }
}
function applySettings() { const root = document.documentElement; root.style.setProperty('--icon-size', `${state.settings.iconSize}px`); root.style.setProperty('--columns', state.settings.columns); root.style.setProperty('--window-opacity', state.settings.opacity / 100); root.style.setProperty('--wallpaper-brightness', state.settings.wallpaperBrightness / 100); for (const [id, key, suffix] of [['opacity', 'opacity', '%'], ['iconSize', 'iconSize', 'px'], ['columns', 'columns', ''], ['wallpaperBrightness', 'wallpaperBrightness', '%']]) { $(id).value = state.settings[key]; $(`${id}Value`).textContent = `${state.settings[key]}${suffix}`; } applyLoginItemSetting().catch(() => {}); }
let loginItemReady = false;
function reflectLoginItem() {
  const checkbox = $('launchAtLogin');
  const available = state.loginItemAvailable === true;
  state.settings.launchAtLogin = available ? Boolean(state.settings.launchAtLogin) : false;
  checkbox.checked = state.settings.launchAtLogin;
  checkbox.disabled = !available;
  checkbox.title = state.loginItemAvailable === false ? '打包版可用' : '';
}
async function applyLoginItemSetting() {
  const checkbox = $('launchAtLogin');
  if (!loginItemReady) {
    loginItemReady = true;
    try { state.loginItemAvailable = Boolean((await window.launchpad.getLoginItem())?.available); }
    catch { state.loginItemAvailable = false; }
  }
  reflectLoginItem();
}
async function load() { $('loading').hidden = false; $('empty').hidden = true; try { const result = await window.launchpad.listApps(); state.apps = result.apps; Object.assign(state, { recent: result.state.recent, pinned: result.state.pinned || [], folders: result.state.folders, wallpaperId: result.state.wallpaperId, wallpaperIds: result.state.wallpaperIds, settings: result.state.settings, diagnostics: result.diagnostics }); applySettings(); render(); updateDiagnostics(); await scanWallpapers(); } finally { $('loading').hidden = true; } }

function updateDiagnostics() { const diagnostics = state.diagnostics; if (!diagnostics) return; const status = $('appStatus'); if (status) status.textContent = diagnostics.invalid || diagnostics.duplicates ? `已加载 ${diagnostics.valid} 个应用，跳过 ${diagnostics.invalid + diagnostics.duplicates} 个无效或重复项目` : `已加载 ${diagnostics.valid} 个应用`; const pathStatus = $('appPathStatus'); if (pathStatus) pathStatus.textContent = `应用目录：${diagnostics.appDirectory || '默认目录'}`; }

$('search').addEventListener('input', (event) => { state.query = event.target.value; state.page = 0; render(); });
document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.filter').forEach((item) => item.classList.toggle('active', item === button)); state.filter = button.dataset.filter; state.page = 0; render(); }));
$('prevPage').addEventListener('click', () => { state.page = Math.max(0, state.page - 1); render(); }); $('nextPage').addEventListener('click', () => { state.page += 1; render(); });
$('edit').addEventListener('click', () => setEdit(!state.edit)); $('folder').addEventListener('click', createFolder); $('folderClose').addEventListener('click', () => { $('folderPanel').hidden = true; }); $('folderRename').addEventListener('click', renameFolder); $('folderDelete').addEventListener('click', deleteFolder);
$('settings').addEventListener('click', () => { $('settingsPanel').hidden = false; }); $('settingsClose').addEventListener('click', () => { $('settingsPanel').hidden = true; }); $('min').addEventListener('click', () => window.launchpad.minimize()); $('close').addEventListener('click', () => window.launchpad.close());
let syncBusy = false;
$('sync').addEventListener('click', async () => { if (syncBusy) return; if (!window.confirm('同步会将桌面上的快捷方式移动到 Launchpad 应用目录，是否继续？')) return; syncBusy = true; $('sync').disabled = true; try { const result = await window.launchpad.syncDesktop(); const refreshed = await window.launchpad.refreshApps(); state.apps = Array.isArray(refreshed) ? refreshed : refreshed.apps; state.diagnostics = await window.launchpad.getAppDiagnostics(); render(); updateDiagnostics(); showToast(`同步完成：移入 ${result.moved} 个，跳过 ${result.skipped || 0} 个（目标不是程序），失败 ${result.failed} 个。`); } catch (error) { showToast(`同步失败：${error.message}`, true); } finally { syncBusy = false; $('sync').disabled = false; } });
for (const [id, key] of [['opacity', 'opacity'], ['iconSize', 'iconSize'], ['columns', 'columns'], ['wallpaperBrightness', 'wallpaperBrightness']]) $(id).addEventListener('input', (event) => { state.settings[key] = Number(event.target.value); applySettings(); if (key !== 'opacity') render(); scheduleStateSave(); });
$('launchAtLogin').addEventListener('change', async (event) => {
  const checkbox = event.target; const enabled = checkbox.checked; const previous = Boolean(state.settings.launchAtLogin);
  state.settings.launchAtLogin = enabled; scheduleStateSave();
  try {
    const result = await window.launchpad.setLoginItem(enabled);
    if (!result || result.available === false) {
      state.loginItemAvailable = false; state.settings.launchAtLogin = false; reflectLoginItem(); scheduleStateSave();
      showToast('开机自启仅在打包版可用。', true); return;
    }
    state.settings.launchAtLogin = Boolean(result.enabled); reflectLoginItem(); scheduleStateSave();
    showToast(state.settings.launchAtLogin ? '已开启开机自动启动。' : '已关闭开机自动启动。');
  } catch (error) {
    state.settings.launchAtLogin = previous; checkbox.checked = previous; scheduleStateSave(); showToast(`设置开机自启失败：${error.message}`, true);
  }
});
$('wallpaperMode').addEventListener('change', async (event) => { state.settings.wallpaperMode = event.target.value; renderWallpapers(); scheduleStateSave(); await applyWallpaper(); });
$('wallpaperSelect').addEventListener('change', async (event) => { state.wallpaperId = event.target.value; scheduleStateSave(); await applyWallpaper(); }); $('refreshWallpapers').addEventListener('click', scanWallpapers); $('refreshDesktopWallpaper').addEventListener('click', applyWallpaper);
$('saveWallpaperLibrary').addEventListener('click', async () => { state.wallpaperIds = [...document.querySelectorAll('#wallpaperLibraryPicker input:checked')].map((input) => input.value); if (!state.wallpaperIds.some((id) => normalize(id) === normalize(state.wallpaperId))) state.wallpaperId = state.wallpaperIds[0] || ''; renderWallpapers(); scheduleStateSave(); await applyWallpaper(); showToast('我的壁纸库已保存。'); });
$('trash').addEventListener('dragover', (event) => { if (state.edit) { event.preventDefault(); $('trash').classList.add('hot'); } }); $('trash').addEventListener('dragleave', () => $('trash').classList.remove('hot')); $('trash').addEventListener('drop', async (event) => { event.preventDefault(); $('trash').classList.remove('hot'); const id = event.dataTransfer.getData('text/plain'); if (!state.edit || !id) return; try { await window.launchpad.recycleApp(id); state.apps = state.apps.filter((item) => normalize(item.id) !== normalize(id)); render(); } catch (error) { showToast(`移入回收站失败：${error.message}`, true); } });
window.addEventListener('resize', () => render()); document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('search').focus(); return; }
  if (event.key === 'Escape') { $('settingsPanel').hidden = true; $('folderPanel').hidden = true; if (state.edit) setEdit(false); return; }
  if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key) && document.activeElement?.classList.contains('card')) {
    const cards = [...document.querySelectorAll('#grid .card')]; const index = cards.indexOf(document.activeElement); if (index < 0) return; const columns = Math.max(1, Number(getComputedStyle(grid).gridTemplateColumns.split(' ').length)); const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' ? columns : -columns; const next = cards[index + delta]; if (next) { event.preventDefault(); next.focus(); }
  }
});
load().catch((error) => showToast(`启动失败：${error.message}`, true));
