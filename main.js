const { app, BrowserWindow, Tray, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');

let mainWindow;
let splashWindow;
let djangoProcess;
let tray;

const DJANGO_PORT = 8000;
const DJANGO_URL = `http://127.0.0.1:${DJANGO_PORT}`;

function createSplashScreen() {
    splashWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        frame: false,
        transparent: false,
        alwaysOnTop: true,
        resizable: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    splashWindow.loadFile(path.join(__dirname, 'splash.html'));
    splashWindow.center();
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1200,
        minHeight: 700,
        show: false,
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false
        }
    });

    // Hide menu bar
    mainWindow.setMenuBarVisibility(false);

    // Load Django URL
    mainWindow.loadURL(DJANGO_URL);

    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        setTimeout(() => {
            if (splashWindow) {
                splashWindow.close();
                splashWindow = null;
            }
            mainWindow.show();
            mainWindow.maximize();
        }, 2000);
    });

    // Handle window close
    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function createTray() {
    tray = new Tray(path.join(__dirname, 'assets', 'tray-icon.png'));
    
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show App',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                }
            }
        },
        {
            label: 'Quit',
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setToolTip('WiFi Hotspot Manager');
    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
        if (mainWindow) {
            mainWindow.show();
        }
    });
}

async function startDjango() {
    return new Promise((resolve, reject) => {
        // Determine Python path
        const pythonPath = process.platform === 'win32' ? 
            path.join(__dirname, 'venv', 'Scripts', 'python.exe') : 
            path.join(__dirname, 'venv', 'bin', 'python');

        const managePath = path.join(__dirname, 'bandwidth_dashboard', 'manage.py');

        console.log('Starting Django server...');
        
        // Start Django server
        djangoProcess = spawn(pythonPath, [
            managePath,
            'runserver',
            `127.0.0.1:${DJANGO_PORT}`,
            '--noreload'
        ], {
            cwd: path.join(__dirname, 'bandwidth_dashboard')
        });

        djangoProcess.stdout.on('data', (data) => {
            console.log(`Django: ${data}`);
            if (data.toString().includes('Starting development server')) {
                resolve();
            }
        });

        djangoProcess.stderr.on('data', (data) => {
            console.error(`Django Error: ${data}`);
        });

        djangoProcess.on('close', (code) => {
            console.log(`Django process exited with code ${code}`);
        });

        // Fallback timeout
        setTimeout(() => {
            checkDjangoServer().then(resolve).catch(reject);
        }, 5000);
    });
}

async function checkDjangoServer() {
    for (let i = 0; i < 30; i++) {
        try {
            await axios.get(DJANGO_URL, { timeout: 1000 });
            console.log('Django server is ready!');
            return true;
        } catch (error) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    throw new Error('Django server failed to start');
}

async function startWebDaemon() {
    return new Promise((resolve, reject) => {
        const pythonPath = process.platform === 'win32' ? 
            path.join(__dirname, 'venv', 'Scripts', 'python.exe') : 
            path.join(__dirname, 'venv', 'bin', 'python');

        const daemonPath = path.join(__dirname, 'web_daemon.py');

        console.log('Starting web daemon with sudo...');
        
        // Use sudo directly (passwordless sudo configured)
        let daemonProcess = spawn('sudo', [pythonPath, daemonPath], {
            cwd: __dirname,
            detached: false
        });

        let hasStarted = false;

        daemonProcess.stdout.on('data', (data) => {
            console.log(`Daemon: ${data}`);
            if (data.toString().includes('Command listener started') || 
                data.toString().includes('Data daemon running')) {
                hasStarted = true;
                resolve();
            }
        });

        daemonProcess.stderr.on('data', (data) => {
            const errMsg = data.toString();
            console.error(`Daemon Error: ${errMsg}`);
            
            // Check for permission errors
            if (errMsg.includes('sudo privileges') || errMsg.includes('permission denied')) {
                console.error('⚠️  Web daemon requires sudo privileges');
            }
        });

        daemonProcess.on('close', (code) => {
            console.log(`Daemon process exited with code ${code}`);
        });

        daemonProcess.on('error', (error) => {
            console.error(`Failed to start daemon: ${error.message}`);
            reject(error);
        });

        // Fallback timeout - resolve even if we don't see the startup message
        setTimeout(() => {
            if (!hasStarted) {
                console.log('Daemon timeout - assuming started');
                resolve();
            }
        }, 5000);
    });
}

app.whenReady().then(async () => {
    createSplashScreen();
    createTray();

    try {
        await startDjango();
        await startWebDaemon();
        createWindow();
    } catch (error) {
        console.error('Failed to start application:', error);
        app.quit();
    }
});

app.on('window-all-closed', () => {
    // Don't quit on macOS
    if (process.platform !== 'darwin') {
        // Keep running in system tray
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    } else {
        mainWindow.show();
    }
});

app.on('before-quit', () => {
    app.isQuitting = true;
});

app.on('quit', () => {
    // Kill Django process
    if (djangoProcess) {
        djangoProcess.kill();
    }
});