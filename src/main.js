const { app, BrowserWindow, ipcMain, shell, screen } = require('electron');
const path = require('path');
const http = require('http');
const { URL } = require('url');
const Store = require('electron-store');
const { google } = require('googleapis');

const store = new Store({ name: 'settings' });
let win;

function createWindow() {
  const display = screen.getPrimaryDisplay().workArea;
  const width = Math.min(430, display.width);
  const height = Math.min(720, display.height);

  win = new BrowserWindow({
    width,
    height,
    x: display.x + display.width - width - 16,
    y: display.y + 16,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    alwaysOnTop: store.get('alwaysOnTop', false),
    skipTaskbar: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win.show());
}

app.whenReady().then(() => {
  app.setLoginItemSettings({
    openAtLogin: store.get('launchAtLogin', true),
    openAsHidden: false
  });
  createWindow();
});

// On macOS, clicking the Dock icon should reopen the dashboard after its
// window has been closed.
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function getSettings() {
  return {
    canvasBaseUrl: store.get('canvasBaseUrl', 'https://canvas.asu.edu'),
    hasCanvasToken: Boolean(store.get('canvasToken')),
    hasGoogleCredentials: Boolean(store.get('googleCredentials')),
    hasGoogleToken: Boolean(store.get('googleToken')),
    launchAtLogin: store.get('launchAtLogin', true),
    alwaysOnTop: store.get('alwaysOnTop', false),
    refreshMinutes: store.get('refreshMinutes', 15),
    daysAhead: store.get('daysAhead', 30)
  };
}

ipcMain.handle('settings:get', () => getSettings());

ipcMain.handle('settings:save', (_event, settings) => {
  const allowed = ['canvasBaseUrl', 'canvasToken', 'launchAtLogin', 'alwaysOnTop', 'refreshMinutes', 'daysAhead'];
  for (const key of allowed) {
    if (settings[key] !== undefined) store.set(key, settings[key]);
  }
  app.setLoginItemSettings({ openAtLogin: Boolean(settings.launchAtLogin) });
  if (win && settings.alwaysOnTop !== undefined) win.setAlwaysOnTop(Boolean(settings.alwaysOnTop));
  return getSettings();
});

ipcMain.handle('google:set-credentials', (_event, jsonText) => {
  const parsed = JSON.parse(jsonText);
  const cfg = parsed.installed || parsed.web;
  if (!cfg?.client_id || !cfg?.client_secret) throw new Error('Invalid Google OAuth credentials JSON.');
  store.set('googleCredentials', cfg);
  return true;
});

function oauthClient() {
  const cfg = store.get('googleCredentials');
  if (!cfg) throw new Error('Google OAuth credentials are not configured.');
  const redirectUri = 'http://127.0.0.1:42813/oauth2callback';
  const client = new google.auth.OAuth2(cfg.client_id, cfg.client_secret, redirectUri);
  const token = store.get('googleToken');
  if (token) client.setCredentials(token);
  client.on('tokens', tokens => {
    const previous = store.get('googleToken', {});
    store.set('googleToken', { ...previous, ...tokens });
  });
  return client;
}

ipcMain.handle('google:connect', async () => {
  const client = oauthClient();
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.readonly']
  });

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const requestUrl = new URL(req.url, 'http://127.0.0.1:42813');
        if (requestUrl.pathname !== '/oauth2callback') return;
        const error = requestUrl.searchParams.get('error');
        const authCode = requestUrl.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h2>Connected successfully.</h2><p>You may close this browser tab.</p>');
        server.close();
        if (error) reject(new Error(error));
        else resolve(authCode);
      } catch (e) {
        server.close();
        reject(e);
      }
    });
    server.on('error', reject);
    server.listen(42813, '127.0.0.1', () => shell.openExternal(authUrl));
  });

  const { tokens } = await client.getToken(code);
  store.set('googleToken', tokens);
  return true;
});

ipcMain.handle('google:disconnect', () => {
  store.delete('googleToken');
  return true;
});

async function fetchGoogleEvents(daysAhead) {
  if (!store.get('googleToken')) return [];
  const auth = oauthClient();
  const calendar = google.calendar({ version: 'v3', auth });
  const now = new Date();
  const end = new Date(now.getTime() + daysAhead * 86400000);
  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 100
  });

  return (response.data.items || []).map(event => ({
    id: `g-${event.id}`,
    source: 'Google',
    title: event.summary || '(No title)',
    dueAt: event.start?.dateTime || event.start?.date,
    endAt: event.end?.dateTime || event.end?.date,
    url: event.htmlLink || '',
    course: event.organizer?.displayName || 'Google Calendar',
    allDay: Boolean(event.start?.date)
  }));
}

async function fetchCanvasItems(daysAhead) {
  const base = String(store.get('canvasBaseUrl', '')).replace(/\/$/, '');
  const token = store.get('canvasToken');
  if (!base || !token) return [];
  const now = new Date();
  const end = new Date(now.getTime() + daysAhead * 86400000);
  const params = new URLSearchParams({
    start_date: now.toISOString(),
    end_date: end.toISOString(),
    per_page: '100'
  });
  const response = await fetch(`${base}/api/v1/planner/items?${params}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`Canvas returned ${response.status}: ${await response.text()}`);
  const items = await response.json();
  return items.map(item => {
    const obj = item.plannable || {};
    return {
      id: `c-${item.context_type || 'item'}-${item.plannable_id || item.id}`,
      source: 'Canvas',
      title: obj.title || obj.name || item.plannable_type || 'Canvas item',
      dueAt: item.plannable_date || obj.due_at || obj.todo_date,
      url: item.html_url || obj.html_url || base,
      course: item.context_name || 'Canvas',
      submitted: item.submissions?.submitted || false,
      points: obj.points_possible
    };
  }).filter(item => item.dueAt);
}

ipcMain.handle('data:refresh', async () => {
  const daysAhead = Number(store.get('daysAhead', 30));
  const results = await Promise.allSettled([
    fetchGoogleEvents(daysAhead),
    fetchCanvasItems(daysAhead)
  ]);
  const errors = results.filter(r => r.status === 'rejected').map(r => r.reason.message);
  const items = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  items.sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
  return { items, errors, refreshedAt: new Date().toISOString() };
});

ipcMain.handle('window:minimize', () => win?.minimize());
ipcMain.handle('window:close', () => win?.close());
ipcMain.handle('window:toggle-pin', () => {
  const value = !win.isAlwaysOnTop();
  win.setAlwaysOnTop(value);
  store.set('alwaysOnTop', value);
  return value;
});
ipcMain.handle('open:external', (_event, url) => shell.openExternal(url));
