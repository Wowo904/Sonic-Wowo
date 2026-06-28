const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

let server;

async function startLocalServer() {
  process.env.PORT = process.env.PORT || '4173';
  process.env.SONIC_TOPOGRAPHY_DATA_DIR = path.join(app.getPath('userData'), 'data');
  process.env.SONIC_TOPOGRAPHY_ENV_FILE = path.join(app.getPath('userData'), '.env.local');

  const serverModule = await import(path.join(__dirname, '..', 'local-server.mjs'));
  server = serverModule.startServer(Number(process.env.PORT));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#02040a',
    title: 'Sonic Topography',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(`http://127.0.0.1:${process.env.PORT || '4173'}`);
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  await startLocalServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (server) server.close();
});
