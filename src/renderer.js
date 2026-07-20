const itemsEl = document.getElementById('items');
const statusEl = document.getElementById('status');
const errorBox = document.getElementById('errorBox');
const dialog = document.getElementById('settingsDialog');
let allItems = [];
let activeFilter = 'all';
let refreshTimer;
let settings;

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function dayLabel(date) {
  const now = new Date();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (date.toDateString() === now.toDateString()) return 'Today';
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return date.toLocaleDateString(undefined, { weekday:'long', month:'short', day:'numeric' });
}

function filteredItems() {
  const now = new Date();
  if (activeFilter === 'today') return allItems.filter(x => new Date(x.dueAt).toDateString() === now.toDateString());
  if (activeFilter === 'week') {
    const end = new Date(now.getTime() + 7 * 86400000);
    return allItems.filter(x => new Date(x.dueAt) <= end);
  }
  return allItems;
}

function render() {
  const items = filteredItems();
  if (!items.length) {
    itemsEl.innerHTML = '<div class="empty">No upcoming items found.<br>Open ⚙ to connect Google Calendar and Canvas.</div>';
    return;
  }
  let currentDay = '';
  itemsEl.innerHTML = items.map(item => {
    const date = new Date(item.dueAt);
    const key = date.toDateString();
    const heading = key !== currentDay ? `<div class="day-title">${escapeHtml(dayLabel(date))}</div>` : '';
    currentDay = key;
    const time = item.allDay ? 'All day' : date.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
    return `${heading}<article class="card ${item.source.toLowerCase()}" data-url="${escapeHtml(item.url)}">
      <div class="top"><div class="title">${escapeHtml(item.title)}</div><span class="badge">${escapeHtml(item.source)}</span></div>
      <div class="meta"><span>${escapeHtml(item.course)}</span><span>${escapeHtml(time)}</span></div>
    </article>`;
  }).join('');
  document.querySelectorAll('.card').forEach(card => card.addEventListener('click', () => {
    if (card.dataset.url) window.desktopAPI.openExternal(card.dataset.url);
  }));
}

async function refresh() {
  statusEl.textContent = 'Refreshing…';
  try {
    const data = await window.desktopAPI.refresh();
    allItems = data.items;
    errorBox.classList.toggle('hidden', !data.errors.length);
    errorBox.textContent = data.errors.join(' • ');
    statusEl.textContent = `Updated ${new Date(data.refreshedAt).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}`;
    render();
  } catch (e) {
    statusEl.textContent = 'Refresh failed';
    errorBox.textContent = e.message;
    errorBox.classList.remove('hidden');
  }
}

function scheduleRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(refresh, Math.max(5, Number(settings.refreshMinutes)) * 60000);
}

async function openSettings() {
  settings = await window.desktopAPI.getSettings();
  canvasBaseUrl.value = settings.canvasBaseUrl;
  canvasToken.value = '';
  googleCredentials.value = '';
  launchAtLogin.checked = settings.launchAtLogin;
  alwaysOnTop.checked = settings.alwaysOnTop;
  refreshMinutes.value = settings.refreshMinutes;
  daysAhead.value = settings.daysAhead;
  dialog.showModal();
}

document.getElementById('settingsBtn').onclick = openSettings;
document.getElementById('refreshBtn').onclick = refresh;
document.getElementById('minBtn').onclick = () => window.desktopAPI.minimize();
document.getElementById('closeBtn').onclick = () => window.desktopAPI.close();
document.getElementById('pin').onclick = async () => {
  const pinned = await window.desktopAPI.togglePin();
  document.getElementById('pin').style.opacity = pinned ? '1' : '.5';
};

document.querySelectorAll('.filter').forEach(btn => btn.onclick = () => {
  document.querySelectorAll('.filter').forEach(x => x.classList.remove('active'));
  btn.classList.add('active');
  activeFilter = btn.dataset.filter;
  render();
});

document.getElementById('connectGoogle').onclick = async () => {
  try {
    const text = googleCredentials.value.trim();
    if (text) await window.desktopAPI.setGoogleCredentials(text);
    await window.desktopAPI.connectGoogle();
    alert('Google Calendar connected.');
  } catch (e) { alert(e.message); }
};

document.getElementById('disconnectGoogle').onclick = async () => {
  await window.desktopAPI.disconnectGoogle();
  alert('Google Calendar disconnected.');
};

document.getElementById('saveSettings').onclick = async event => {
  event.preventDefault();
  const payload = {
    canvasBaseUrl: canvasBaseUrl.value.trim(),
    launchAtLogin: launchAtLogin.checked,
    alwaysOnTop: alwaysOnTop.checked,
    refreshMinutes: Number(refreshMinutes.value),
    daysAhead: Number(daysAhead.value)
  };
  if (canvasToken.value.trim()) payload.canvasToken = canvasToken.value.trim();
  settings = await window.desktopAPI.saveSettings(payload);
  dialog.close();
  scheduleRefresh();
  refresh();
};

(async () => {
  settings = await window.desktopAPI.getSettings();
  document.getElementById('pin').style.opacity = settings.alwaysOnTop ? '1' : '.5';
  scheduleRefresh();
  refresh();
})();
