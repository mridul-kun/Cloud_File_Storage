const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

const PORT = 4300;

// Your real project folder, so files show up in its data/ and storage/ folders
const PROJECT_DIR = 'C:\\Users\\MRIDUL BANSAL\\Presonal\\Cloud File Storage - Safe Haven';
const baseDir = fs.existsSync(PROJECT_DIR) ? PROJECT_DIR : app.getPath('userData');

process.env.PORT = String(PORT);
process.env.DATA_DIR = path.join(baseDir, 'data');
process.env.STORAGE_DIR = path.join(baseDir, 'storage');

let mainWindow;

function waitForServer(retries = 50) {
    return new Promise((resolve, reject) => {
        const attempt = (n) => {
            http.get(`http://127.0.0.1:${PORT}`, (res) => {
                res.resume();
                resolve();
            }).on('error', () => {
                if (n <= 0) return reject(new Error('Server did not start'));
                setTimeout(() => attempt(n - 1), 200);
            });
        };
        attempt(retries);
    });
}

async function createWindow() {
    require('./server.js'); // starts Express inside Electron
    await waitForServer();

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: path.join(__dirname, 'build', 'icon.ico'),
        autoHideMenuBar: true,
        webPreferences: { contextIsolation: true, nodeIntegration: false }
    });

    mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
    app.whenReady().then(createWindow);
}

app.on('window-all-closed', () => app.quit());