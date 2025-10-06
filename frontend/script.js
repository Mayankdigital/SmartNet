let liveStats = { download: 0, upload: 0, latency: 0, efficiency: 0 };

// Connect to the Python WebSocket server
const socket = new WebSocket('ws://localhost:8765');

socket.onopen = function(e) {
    console.log("[open] Connection established to NetScheduler Pro backend.");
};

socket.onmessage = function(event) {
    try {
        const data = JSON.parse(event.data);

        // Handle different message types from the backend
        if (data.type === 'initial_policies') {
            console.log("Received initial policies from backend:", data.payload);
            data.payload.forEach(policy => {
                savedPolicies[policy.name.toLowerCase()] = policy;
            });
            if (socket.readyState === WebSocket.OPEN) {
                socket.send('rescan');
            }

        } else if (data.type === 'live_data') {
            const liveData = data.payload;

            // 1. Update global stats
            liveStats.download = liveData.globalStats.downloadSpeed;
            liveStats.upload = liveData.globalStats.uploadSpeed;
            liveStats.latency = liveData.globalStats.latency;
            liveStats.efficiency = liveData.globalStats.efficiency;

            document.getElementById('downloadSpeed').textContent = `${liveStats.download.toFixed(1)} MB/s`;
            document.getElementById('uploadSpeed').textContent = `${liveStats.upload.toFixed(1)} MB/s`;
            document.getElementById('latency').textContent = `${Math.floor(liveStats.latency)}ms`;
            document.getElementById('efficiency').textContent = `${liveStats.efficiency.toFixed(1)}%`;

            // 2. Update the process list with individual PIDs
            updateProcessList(liveData.processes);

            // 3. Re-render the visible application list
            const activeSection = document.querySelector('.sidebar-item.active').dataset.section;
            if (activeSection === 'monitor' || activeSection === 'dashboard') {
                renderApplications(activeSection);
            }
        }

    } catch (error) {
        console.error("Error processing message from backend:", error);
    }
};

function generateColorFromString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    let color = '#';
    for (let i = 0; i < 3; i++) {
        let value = (hash >> (i * 8)) & 0xFF;
        color += ('00' + value.toString(16)).substr(-2);
    }
    return `linear-gradient(135deg, ${color}, #222)`;
}

function updateProcessList(backendProcesses) {
    const backendPids = new Set(backendProcesses.map(p => p.pid));

    backendProcesses.forEach(proc => {
        const cleanProcName = proc.name.replace(/\.exe$/i, '');
        const existingApp = applications.find(app => app.pid === proc.pid);
        
        const downloadSpeedKB = proc.downloadSpeed;
        const uploadSpeedKB = proc.uploadSpeed;

        if (existingApp) {
            existingApp.speed = formatSpeed(downloadSpeedKB);
            existingApp.uploadSpeed = formatSpeed(uploadSpeedKB);
            existingApp.downloadSpeedNumeric = downloadSpeedKB;
            existingApp.uploadSpeedNumeric = uploadSpeedKB;
            existingApp.protocolPercent = proc.protocol_tcp_percent;
            existingApp.instance_title = proc.instance_title;
            // Prioritize favicon URL from backend for tab logos
            existingApp.logoUrl = proc.favicon || resolveLogoUrl(cleanProcName);
            existingApp.active = true; 
        } else {
            const savedPolicy = savedPolicies[cleanProcName.toLowerCase()];

            const newApp = {
                pid: proc.pid,
                name: cleanProcName.charAt(0).toUpperCase() + cleanProcName.slice(1),
                instance_title: proc.instance_title,
                logo: cleanProcName.charAt(0).toUpperCase(),
                // Prioritize favicon URL from backend for tab logos
                logoUrl: proc.favicon || resolveLogoUrl(cleanProcName),
                category: "System Process",
                protocol: "TCP/UDP",
                protocolPercent: proc.protocol_tcp_percent,
                speed: formatSpeed(downloadSpeedKB),
                uploadSpeed: formatSpeed(uploadSpeedKB),
                downloadSpeedNumeric: downloadSpeedKB,
                uploadSpeedNumeric: uploadSpeedKB,
                active: true,
                color: generateColorFromString(cleanProcName),
                priority: savedPolicy ? savedPolicy.priority : "medium",
                speedLimit: savedPolicy ? `${savedPolicy.downloadCap} MB/s` : "No Limit",
                downloadCap: savedPolicy ? savedPolicy.downloadCap : 100,
                uploadCap: savedPolicy ? savedPolicy.uploadCap : 50,
                appliedModes: savedPolicy ? savedPolicy.appliedModes : [],
                policyApplied: !!savedPolicy
            };
            applications.push(newApp);
        }
    });

    applications.forEach(app => {
        if (!backendPids.has(app.pid)) {
             if (app.category !== 'KILLED PROCESS' && app.category !== 'DEFAULT POLICY') {
                 app.active = false;
                 app.speed = "0 KB/s";
                 app.uploadSpeed = "0 KB/s";
                 app.downloadSpeedNumeric = 0;
                 app.uploadSpeedNumeric = 0;
             }
        }
    });
}

function formatSpeed(speedInKB) {
    if (speedInKB > 1024) {
        return `${(speedInKB / 1024).toFixed(1)} MB/s`;
    }
    return `${speedInKB.toFixed(speedInKB > 0 ? 1 : 0)} KB/s`;
}


socket.onclose = function(event) {
    if (event.wasClean) {
        console.log(`[close] Connection closed cleanly, code=${event.code} reason=${event.reason}`);
    } else {
        console.error('[close] Connection died');
        showNotification('Backend connection lost!', 'error');
    }
};

socket.onerror = function(error) {
    console.error(`[error] ${error.message}`);
    showNotification('Could not connect to backend!', 'error');
};

const APP_LOGO_MAP = {
    // Browsers
    'chrome': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/chrome/chrome-original.svg',
    'firefox': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/firefox/firefox-original.svg',
    'edge': 'https://img.icons8.com/color/512/ms-edge-new.png',
    'msedge': 'https://img.icons8.com/color/512/ms-edge-new.png',
    'opera': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/opera/opera-original.svg',
    'brave': 'https://img.icons8.com/color/512/brave-web-browser.png',
    'safari': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/safari/safari-original.svg',

    // Dev Tools & System
    'code': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/vscode/vscode-original.svg',
    'visual studio code': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/vscode/vscode-original.svg',
    'terminal': 'https://img.icons8.com/fluency/512/console.png',
    'powershell': 'https://img.icons8.com/color/512/powershell.png',
    'cmd': 'https://img.icons8.com/fluency/512/console.png',
    'explorer': 'https://img.icons8.com/color/512/folder-invoices--v1.png',
    'file explorer': 'https://img.icons8.com/color/512/folder-invoices--v1.png',
    'node': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/nodejs/nodejs-original.svg',
    'python': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/python/python-original.svg',
    'docker': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/docker/docker-original.svg',
    'postman': 'https://img.icons8.com/color/512/postman-api.png',
    'git': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/git/git-original.svg',
    'github desktop': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/github/github-original.svg',
    'conhost': 'https://img.icons8.com/fluency/512/console.png',
    
    // Communication
    'discord': 'https://img.icons8.com/color/512/discord--v2.png',
    'slack': 'https://img.icons8.com/color/512/slack-new.png',
    'zoom': 'https://img.icons8.com/color/512/zoom.png',
    'teams': 'https://img.icons8.com/color/512/microsoft-teams-2019.png',
    'whatsapp': 'https://img.icons8.com/color/512/whatsapp--v1.png',
    'telegram': 'https://img.icons8.com/color/512/telegram-app.png',

    // Media & Games
    'spotify': 'https://img.icons8.com/color/512/spotify--v1.png',
    'vlc': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/vlc/vlc-original.svg',
    'steam': 'https://img.icons8.com/fluency/512/steam.png',
    'epicgames': 'https://img.icons8.com/fluency/512/epic-games.png',
    'battlenet': 'https://img.icons8.com/color/512/battle-net.png',
    'origin': 'https://img.icons8.com/fluency/512/origin.png',
    'league of legends': 'https://img.icons8.com/color/512/league-of-legends.png',
    'valorant': 'https://img.icons8.com/color/512/valorant.png',
    
    // Office & Productivity
    'word': 'https://img.icons8.com/color/512/microsoft-word-2019--v2.png',
    'excel': 'https://img.icons8.com/color/512/microsoft-excel-2019--v2.png',
    'powerpoint': 'https://img.icons8.com/color/512/microsoft-powerpoint-2019--v2.png',
    'outlook': 'https://img.icons8.com/color/512/microsoft-outlook-2019--v2.png',
    'onedrive': 'https://img.icons8.com/color/512/microsoft-onedrive-2019.png',
    'notion': 'https://img.icons8.com/color/512/notion-app.png',
    'obsidian': 'https://img.icons8.com/color/512/obsidian.png',
    'acrobat': 'https://img.icons8.com/color/512/adobe-acrobat-reader.png',
    
    // Other
    'everything': 'https://img.icons8.com/color/512/search--v1.png',
    'crossdeviceresume': 'https://img.icons8.com/fluency/512/synchronize.png'
};

function sanitizeNameForLookup(name) {
    return name.toLowerCase().replace(/\.exe$/i, '').replace(/[^a-z0-9\s]+/g, '').trim();
}

function resolveLogoUrl(appName) {
    const key = sanitizeNameForLookup(appName);
    if (APP_LOGO_MAP[key]) return APP_LOGO_MAP[key];
    const keywords = Object.keys(APP_LOGO_MAP);
    for (const kw of keywords) {
        if (key.includes(kw)) return APP_LOGO_MAP[kw];
    }
    return null;
}

let applications = [];
let savedPolicies = {};

const POLICY_MODES = [
    { value: 'work', label: 'Work Mode' },
    { value: 'gaming', label: 'Gaming Mode' },
    { value: 'entertainment', label: 'Entertainment' },
    { value: 'night', label: 'Night Mode' },
    { value: 'custom', label: 'Custom' }
];

let downloadChart, uploadChart, latencyChart, efficiencyChart, bandwidthChart, protocolDistributionChart, packetLossChart;
let downloadData = Array(10).fill(0);
let uploadData = Array(10).fill(0);
let latencyData = Array(10).fill(0);
let efficiencyData = Array(10).fill(0);
let bandwidthTimeData = [];
let bandwidthDownloadData = [];
let bandwidthUploadData = [];
let protocolData = [34, 33, 33];
let packetLossData = Array(7).fill(0);
let currentEditingAppIndex = -1;
let expandedGroupState = {}; // State to remember which groups are expanded

function initDashboard() {
    initializeCharts();
    generateInitialBandwidthData();
    renderApplications('dashboard');
    setupEventListeners();
    startRealTimeUpdates();
}

function initializeCharts() {
    const miniChartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { display: false }, y: { display: false } },
        elements: {
            line: { tension: 0.4, borderWidth: 2 },
            point: { radius: 0 }
        }
    };

    downloadChart = new Chart(document.getElementById('downloadChart'), { type: 'line', data: { labels: Array(10).fill(''), datasets: [{ data: downloadData, borderColor: '#0066ff', backgroundColor: 'rgba(0, 102, 255, 0.1)', fill: true }] }, options: miniChartOptions });
    uploadChart = new Chart(document.getElementById('uploadChart'), { type: 'line', data: { labels: Array(10).fill(''), datasets: [{ data: uploadData, borderColor: '#00c864', backgroundColor: 'rgba(0, 200, 100, 0.1)', fill: true }] }, options: miniChartOptions });
    latencyChart = new Chart(document.getElementById('latencyChart'), { type: 'line', data: { labels: Array(10).fill(''), datasets: [{ data: latencyData, borderColor: '#ff9500', backgroundColor: 'rgba(255, 149, 0, 0.1)', fill: true }] }, options: miniChartOptions });
    efficiencyChart = new Chart(document.getElementById('efficiencyChart'), { type: 'line', data: { labels: Array(10).fill(''), datasets: [{ data: efficiencyData, borderColor: '#5e5ce6', backgroundColor: 'rgba(94, 92, 230, 0.1)', fill: true }] }, options: miniChartOptions });

    bandwidthChart = new Chart(document.getElementById('bandwidthChart'), {
        type: 'line',
        data: {
            labels: bandwidthTimeData,
            datasets: [
                { label: 'Download', data: bandwidthDownloadData, borderColor: '#0066ff', backgroundColor: 'rgba(0, 102, 255, 0.1)', fill: true, tension: 0.4 },
                { label: 'Upload', data: bandwidthUploadData, borderColor: '#00c864', backgroundColor: 'rgba(0, 200, 100, 0.1)', fill: true, tension: 0.4 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: true, position: 'top', labels: { color: '#1a2332', usePointStyle: true } } },
            scales: { x: { grid: { color: 'rgba(0, 100, 255, 0.1)' }, ticks: { color: '#7a8a99' } }, y: { grid: { color: 'rgba(0, 100, 255, 0.1)' }, ticks: { color: '#7a8a99' } } },
            elements: { line: { borderWidth: 3 }, point: { radius: 4, hoverRadius: 6 } }
        }
    });

    protocolDistributionChart = new Chart(document.getElementById('protocolDistributionChart'), {
        type: 'doughnut',
        data: {
            labels: ['TCP', 'UDP', 'HTTP/2 & Other'],
            datasets: [{
                data: protocolData,
                backgroundColor: ['#0066ff', '#ff9500', '#5e5ce6'],
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { title: { display: true, text: 'Protocol Distribution (%)', color: '#1a2332', font: { size: 14 } }, legend: { position: 'bottom', labels: { color: '#7a8a99' } } }
        }
    });

    packetLossChart = new Chart(document.getElementById('packetLossChart'), {
        type: 'bar',
        data: {
            labels: ['0', '-10', '-20', '-30', '-40', '-50', '-60'], 
            datasets: [{
                label: 'Packet Loss (%)',
                data: packetLossData,
                backgroundColor: '#ff3b30',
                borderColor: '#ff3b30',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { title: { display: true, text: 'Packet Loss Rate (%)', color: '#1a2332', font: { size: 14 } }, legend: { display: false } },
            scales: { x: { grid: { display: false } }, y: { beginAtZero: true, max: 2.0 } }
        }
    });
}


function generateInitialBandwidthData() {
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
        const time = new Date(now.getTime() - i * 60000);
        bandwidthTimeData.push(time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        bandwidthDownloadData.push(0);
        bandwidthUploadData.push(0);
    }
}

function renderApplications(view) {
    const containerId = view === 'monitor' ? 'monitorAppsContainer' : 'appsContainer';
    const container = document.getElementById(containerId);
    if (!container) return; 

    container.innerHTML = '';
    
    let listToRender = [...applications];

    if (view === 'monitor') {
        const searchInput = document.getElementById('processSearchInput');
        const searchTerm = searchInput.value.toLowerCase().trim();
        if (searchTerm) {
            listToRender = listToRender.filter(app => app.name.toLowerCase().includes(searchTerm) || (app.instance_title && app.instance_title.toLowerCase().includes(searchTerm)));
        }

        const filterValue = document.getElementById('policyStatusFilter').value;
        if (filterValue === 'applied') {
            listToRender = listToRender.filter(app => app.policyApplied === true);
        } else if (filterValue === 'default') {
            listToRender = listToRender.filter(app => app.policyApplied === false);
        }

        const groupedApps = listToRender.reduce((acc, app) => {
            if (!acc[app.name]) {
                acc[app.name] = {
                    processes: [],
                    totalDownloadKB: 0,
                    totalUploadKB: 0,
                    logo: app.logo,
                    logoUrl: resolveLogoUrl(app.name),
                    color: app.color,
                    policyApplied: false,
                    appliedModes: new Set()
                };
            }
            acc[app.name].processes.push(app);
            acc[app.name].totalDownloadKB += app.downloadSpeedNumeric || 0;
            acc[app.name].totalUploadKB += app.uploadSpeedNumeric || 0;
            if (app.policyApplied) {
                acc[app.name].policyApplied = true;
            }
            if(app.appliedModes) {
                app.appliedModes.forEach(mode => acc[app.name].appliedModes.add(mode));
            }
            return acc;
        }, {});

        Object.keys(groupedApps).sort((a, b) => {
            const groupA = groupedApps[a];
            const groupB = groupedApps[b];
            const totalA = groupA.totalDownloadKB + groupA.totalUploadKB;
            const totalB = groupB.totalDownloadKB + groupB.totalUploadKB;
            return totalB - totalA;
        }).forEach(appName => {
            const group = groupedApps[appName];
            const isGroupActive = group.processes.some(p => p.active);
            const statusClass = isGroupActive ? '' : 'inactive';
            const policyCheckMark = group.policyApplied ? `<span style="color: #00c864; font-size: 16px; margin-left: 8px;">✅</span>` : '';
            
            const modes = Array.from(group.appliedModes);
            const modesDisplay = modes.map(mode => {
                const modeLabel = mode.charAt(0).toUpperCase() + mode.slice(1);
                return `<span class="app-mode-badge">${modeLabel} Mode</span>`;
            }).join('');
            
            const countOrPid = group.processes.length === 1
                ? `<span class="app-pid-badge" style="margin-left: 8px; font-size: 12px; color: #7a8a99; background-color: #f0f4f8; padding: 2px 6px; border-radius: 4px; font-weight: 600;">PID: ${group.processes[0].pid}</span>`
                : `(${group.processes.length})`;
            
            const isExpandable = group.processes.length > 1;
            
            const isCurrentlyExpanded = expandedGroupState[appName] === true;
            const iconHtml = isExpandable ? `<span class="expand-icon" style="transform: ${isCurrentlyExpanded ? 'rotate(90deg)' : 'rotate(0deg)'};">▶</span>` : '';

            const groupElement = document.createElement('div');
            groupElement.className = 'app-group';
            const childrenHtml = `
                <div class="app-item app-group-header ${statusClass}">
                    <div class="app-logo-small" style="${group.logoUrl ? `background-image: url('${group.logoUrl}'); background-color: #fff;` : `background: ${group.color}; color: #fff;`} flex-shrink: 0;">${group.logoUrl ? '' : group.logo}</div>
                    <div class="app-info">
                        <div class="app-details">
                            <div class="app-name-text">${appName} ${countOrPid} ${policyCheckMark} ${modesDisplay}</div>
                        </div>
                        <div class="app-speeds-monitor">
                            <div class="app-download-speed">⬇️ ${formatSpeed(group.totalDownloadKB)}</div>
                            <div class="app-upload-speed">⬆️ ${formatSpeed(group.totalUploadKB)}</div>
                        </div>
                        <div class="app-controls">
                            <button class="policy-btn" onclick="openPolicyEditorByName('${appName}')">POLICY</button>
                            ${iconHtml}
                        </div>
                    </div>
                </div>
                ${isExpandable ? `<div class="app-group-children" style="display: ${isCurrentlyExpanded ? 'block' : 'none'};">
                    ${group.processes.map(proc => {
                        const originalIndex = applications.findIndex(a => a.pid === proc.pid);
                        
                        const idLabel = String(proc.pid).startsWith('tab_') ? 'Tab ID' : 'PID';
                        const displayId = String(proc.pid).replace('tab_', '');
                        
                        const titleDisplay = proc.instance_title 
                          ? `<div class="instance-title" title="${proc.instance_title}">${proc.instance_title}</div>`
                          : `<div class="instance-title">${proc.name}</div>`;
                        
                        const instanceLogoUrl = proc.logoUrl || group.logoUrl;

                        return `
                        <div class="app-item app-instance-item ${!proc.active ? 'inactive' : ''}">
                            <div class="app-logo-container">
                                <div class="app-logo-small instance-logo" style="${instanceLogoUrl ? `background-image: url('${instanceLogoUrl}'); background-color: #fff;` : `background: ${proc.color}; color: #fff;`}"></div>
                                <div class="app-pid">${idLabel}: ${displayId}</div>
                            </div>
                            <div class="app-info">
                                <div class="instance-details">
                                    ${titleDisplay}
                                    <div class="protocol-display">
                                        <div class="protocol-labels">
                                            <span>TCP: ${proc.protocolPercent}%</span>
                                            <span>UDP: ${100 - proc.protocolPercent}%</span>
                                        </div>
                                        <div class="protocol-bar-container">
                                            <div class="protocol-bar-inner" style="width: ${proc.protocolPercent}%;"></div>
                                        </div>
                                    </div>
                                </div>
                                <div class="app-speeds-monitor">
                                    <div class="app-download-speed">⬇️ ${proc.speed}</div>
                                    <div class="app-upload-speed">⬆️ ${proc.uploadSpeed}</div>
                                </div>
                                <div class="app-controls">
                                    <button class="kill-app-btn instance-kill" onclick="killApp(${originalIndex})">KILL</button>
                                </div>
                            </div>
                        </div>
                        `;
                    }).join('')}
                </div>` : ''}`;

            groupElement.innerHTML = childrenHtml;
            container.appendChild(groupElement);

            if (isExpandable) {
                groupElement.querySelector('.app-group-header').addEventListener('click', (e) => {
                    if (e.target.classList.contains('policy-btn')) return;
                    
                    expandedGroupState[appName] = !expandedGroupState[appName];
                    
                    const children = groupElement.querySelector('.app-group-children');
                    const icon = groupElement.querySelector('.expand-icon');
                    
                    if (expandedGroupState[appName]) {
                        children.style.display = 'block';
                        icon.style.transform = 'rotate(90deg)';
                    } else {
                        children.style.display = 'none';
                        icon.style.transform = 'rotate(0deg)';
                    }
                });
            }
        });
        return;
    }

    // --- Dashboard View: Original Logic ---
    listToRender = applications.filter(app => app.policyApplied === true && app.category !== 'KILLED PROCESS' && app.category !== 'DEFAULT POLICY');

    if (listToRender.length === 0) {
        container.innerHTML = `<div class="empty-state-message"><div class="empty-state-icon">🛡️</div><h3>No Policies Applied</h3><p>Go to the <b>Real-time Monitor</b> tab to apply a policy to an application. It will then appear here.</p></div>`;
        return;
    }

    listToRender.sort((a, b) => (b.downloadSpeedNumeric + b.uploadSpeedNumeric) - (a.downloadSpeedNumeric + a.uploadSpeedNumeric)).forEach((app) => {
        const originalIndex = applications.findIndex(a => a.pid === app.pid);
        const appElement = document.createElement('div');
        appElement.className = `app-item`;
        
        const modes = app.appliedModes || [];
        const modesDisplay = modes.map(mode => {
            const modeLabel = mode.charAt(0).toUpperCase() + mode.slice(1);
            return `<span class="app-mode-badge">${modeLabel} Mode</span>`;
        }).join('');
        
        appElement.innerHTML = `
            <div class="app-logo-small" style="${app.logoUrl ? `background-image: url('${app.logoUrl}'); background-color: #fff;` : `background: ${app.color}; color: #fff;`}">${app.logoUrl ? '' : app.logo}</div>
            <div class="app-info">
                 <div class="app-details">
                    <div class="app-name-text">${app.name} ${modesDisplay}</div>
                    <div class="app-category">
                        <span>${app.category}</span>
                        <span class="app-protocol-badge">${app.protocol}</span>
                    </div>
                </div>
                <div class="app-performance">
                    <div class="app-speed">${app.speed}</div>
                    <div class="app-limit">Limit: ${app.speedLimit}</div>
                </div>
                <div class="priority-badge priority-${app.priority}">${app.priority.toUpperCase()}</div>
                <div class="app-controls">
                    <div class="toggle-switch ${app.active ? 'active' : ''}" onclick="toggleApp(${originalIndex})">
                        <div class="toggle-slider"></div>
                    </div>
                    <button class="kill-app-btn" onclick="killApp(${originalIndex})">KILL</button>
                </div>
            </div>`;
        container.appendChild(appElement);
    });
}


function requestProcessRescan() {
    if (socket.readyState === WebSocket.OPEN) {
        console.log("Requesting immediate process rescan from backend...");
        socket.send('rescan'); 
        
        const rescanBtn = document.querySelector('#monitor .refresh-btn');
        if (rescanBtn) {
            rescanBtn.style.transition = 'transform 0.5s ease-out';
            rescanBtn.style.transform = 'rotate(360deg)';
            setTimeout(() => {
                rescanBtn.style.transform = 'rotate(0deg)';
            }, 500);
        }

        showNotification('Rescan request sent...', 'info');
    } else {
        showNotification('Cannot rescan, not connected to backend.', 'error');
    }
}

function refreshApplications() {
    const refreshBtn = document.querySelector('.refresh-btn');
    refreshBtn.style.transform = 'rotate(360deg)';
    setTimeout(() => {
        const activeSection = document.querySelector('.sidebar-item.active').dataset.section;
        if (activeSection === 'monitor' || activeSection === 'dashboard') {
            renderApplications(activeSection);
        }
        refreshBtn.style.transform = 'rotate(0deg)';
        showNotification('Display refreshed', 'success');
    }, 500);
}

function toggleApp(index) {
    const app = applications[index];
    if (!app) return;
    
    app.active = !app.active;

    if (!app.active) {
        app.speed = "0 KB/s";
        app.uploadSpeed = "0 KB/s";
    } 
    
    renderApplications('dashboard');
    renderApplications('monitor');
    showNotification(`${app.name} ${app.active ? 'resumed' : 'paused'}`, app.active ? 'success' : 'error');
}

function killApp(index) {
    let appToKill = applications[index];
    if (!appToKill) return;

    if (socket.readyState === WebSocket.OPEN) {
        const message = {
            action: 'delete_policy',
            payload: { name: appToKill.name }
        };
        socket.send(JSON.stringify(message));
        console.log("Sent delete_policy command for:", appToKill.name);
    }
    
    applications.forEach(app => {
        if (app.name === appToKill.name) {
            app.active = false;
            app.priority = 'low'; 
            app.speedLimit = 'DEFAULT';
            app.policyApplied = false;
            app.appliedModes = [];
            app.protocol = 'DEFAULT';
            app.category = 'DEFAULT POLICY';
        }
    });

    renderApplications('dashboard');
    renderApplications('monitor');

    showNotification(`${appToKill.name} policy has been reset and removed.`, 'error');
}

function emergencyKill() {
    applications.forEach(app => {
        if (app.active === true) {
             app.active = false;
             app.priority = 'low'; 
             app.speedLimit = 'DEFAULT'; 
             app.policyApplied = false;
             app.appliedModes = [];
             app.protocol = 'DEFAULT';
             app.category = 'DEFAULT POLICY';
        }
    });

    renderApplications('dashboard');
    renderApplications('monitor'); 
    showNotification('Emergency kill activated. All policies reset.', 'error');
}

function renderModeCheckboxes(appliedModes) {
    const container = document.getElementById('policyModeCheckboxes');
    container.innerHTML = '';

    POLICY_MODES.forEach(mode => {
        const isChecked = appliedModes.includes(mode.value);
        const label = document.createElement('label');
        label.innerHTML = `
            <input type="checkbox" name="policyMode" value="${mode.value}" ${isChecked ? 'checked' : ''}>
            <span>${mode.label}</span>
        `;
        container.appendChild(label);
    });
}

function openPolicyEditorByName(appName) {
    const app = applications.find(a => a.name === appName);
    if (!app) {
        console.error(`Could not find application "${appName}" to open policy editor for.`);
        return;
    }
    currentEditingAppIndex = applications.findIndex(a => a.name === appName);

    document.getElementById('modalAppName').textContent = `Policy Editor for ${app.name}`;
    renderModeCheckboxes(app.appliedModes || []);

    document.getElementById('prioritySelect').value = app.priority || 'medium'; 

    const dlSlider = document.getElementById('downloadLimitSlider');
    dlSlider.value = app.downloadCap;
    document.getElementById('downloadLimitValue').textContent = `${app.downloadCap} Mbps`;

    const ulSlider = document.getElementById('uploadLimitSlider');
    ulSlider.value = app.uploadCap;
    document.getElementById('uploadLimitValue').textContent = `${app.uploadCap} Mbps`;

    document.getElementById('policyModal').style.display = 'block';
    showNotification(`Editing policy for ${app.name}`, 'info');
}

function updateLimitValue(type) {
    const slider = document.getElementById(`${type}LimitSlider`);
    document.getElementById(`${type}LimitValue`).textContent = `${slider.value} Mbps`;
}

function savePolicyChanges() {
    if (currentEditingAppIndex === -1) {
        closeModal();
        return;
    }

    let representativeApp = applications[currentEditingAppIndex];
    if (!representativeApp) return;

    const appName = representativeApp.name;
    const newPriority = document.getElementById('prioritySelect').value;
    const newDownloadCap = parseInt(document.getElementById('downloadLimitSlider').value);
    const newUploadCap = parseInt(document.getElementById('uploadLimitSlider').value);
    const selectedModes = Array.from(document.querySelectorAll('#policyModeCheckboxes input[name="policyMode"]:checked')).map(cb => cb.value);

    const applyChanges = (app) => {
        if (newPriority === 'block') {
             app.active = false;
             app.priority = 'low'; 
             app.speedLimit = 'DEFAULT'; 
             app.policyApplied = false;
             app.appliedModes = [];
             app.protocol = 'DEFAULT';
             app.category = 'DEFAULT POLICY';
        } else {
            app.active = true;
            app.priority = newPriority;
            app.downloadCap = newDownloadCap;
            app.uploadCap = newUploadCap;
            app.appliedModes = selectedModes;
            app.protocol = "TCP/UDP";
            app.category = "System Process";
            app.speedLimit = `${newDownloadCap} MB/s`; 
            app.policyApplied = true;
        }
    };

    applications.forEach(app => {
        if (app.name === appName) {
            applyChanges(app);
        }
    });

    if (newPriority === 'block') {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ action: 'delete_policy', payload: { name: appName } }));
        }
        showNotification(`Policy for ${appName} has been reset and removed.`, 'error');
    } else {
        if (socket.readyState === WebSocket.OPEN) {
            const policyPayload = {
                name: appName,
                priority: newPriority,
                downloadCap: newDownloadCap,
                uploadCap: newUploadCap,
                appliedModes: selectedModes
            };
            socket.send(JSON.stringify({ action: 'save_policy', payload: policyPayload }));
        }
        showNotification(`Policy for ${appName} saved and applied successfully!`, 'success');
    }

    renderApplications('dashboard');
    renderApplications('monitor');
    closeModal();
}

function closeModal() {
    document.getElementById('policyModal').style.display = 'none';
    currentEditingAppIndex = -1;
}

window.onclick = function(event) {
    const modal = document.getElementById('policyModal');
    if (event.target == modal) {
        closeModal();
    }
}

function setupEventListeners() {
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.addEventListener('click', () => {
            const sectionName = item.dataset.section;

            document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            document.querySelectorAll('.dashboard-content').forEach(content => content.classList.remove('active-section'));
            const targetContent = document.getElementById(sectionName);
            if(targetContent) {
                targetContent.classList.add('active-section');
            }
            
            if (sectionName === 'monitor' || sectionName === 'dashboard') {
                renderApplications(sectionName);
            }

            showNotification(`Switched to ${sectionName.charAt(0).toUpperCase() + sectionName.slice(1)}`);
        });
    });

    document.querySelectorAll('.time-filter').forEach(filter => {
        filter.addEventListener('click', () => {
            document.querySelectorAll('.time-filter').forEach(f => f.classList.remove('active'));
            filter.classList.add('active');
        });
    });

    document.getElementById('modeSelector').addEventListener('change', (e) => {
        const selectedMode = e.target.value;
        
        applications.forEach(app => {
            if (app.category !== 'KILLED PROCESS') { 
                const shouldBeActive = app.appliedModes && app.appliedModes.includes(selectedMode);
                
                if (shouldBeActive) {
                    app.active = true;
                } else if (selectedMode !== 'custom') { 
                    app.active = false;
                    app.speed = "0 KB/s";
                    app.uploadSpeed = "0 KB/s";
                }
            }
        });
        
        renderApplications('dashboard');
        renderApplications('monitor');
        showNotification(`Mode switched to ${selectedMode.toUpperCase()}. Policies applied.`, 'info');
    });

    document.getElementById('statusDot').addEventListener('click', toggleNetworkStatus);
}

function toggleNetworkStatus() {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const statusIndicator = document.querySelector('.status-indicator');
    const isOnline = statusDot.classList.contains('status-online');

    if (isOnline) {
        statusDot.classList.remove('status-online');
        statusDot.classList.add('status-offline');
        statusText.textContent = 'Offline';
        statusText.style.color = '#ff3b30';
        statusIndicator.style.background = 'rgba(255, 59, 48, 0.1)';
        statusIndicator.style.borderColor = 'rgba(255, 59, 48, 0.2)';
        showNotification('Network disconnected', 'error');
    } else {
        statusDot.classList.remove('status-offline');
        statusDot.classList.add('status-online');
        statusText.textContent = 'Online';
        statusText.style.color = '#00c864';
        statusIndicator.style.background = 'rgba(0, 200, 100, 0.1)';
        statusIndicator.style.borderColor = 'rgba(0, 200, 100, 0.2)';
        showNotification('Network connected', 'success');
    }
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    const style = document.createElement('style');

    if (!document.querySelector('style[data-notification-styles]')) {
        style.setAttribute('data-notification-styles', true);
        style.textContent = `
            @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
            @keyframes slideOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(100%); opacity: 0; } }
        `;
        document.head.appendChild(style);
    }
    
    notification.style.cssText = `
        position: fixed; top: 90px; right: 28px;
        background: ${type === 'error' ? '#ff3b30' : type === 'success' ? '#00c864' : '#0066ff'};
        color: white; padding: 14px 22px; border-radius: 12px; z-index: 2000;
        animation: slideIn 0.3s ease-out;
        box-shadow: 0 8px 24px ${type === 'error' ? 'rgba(255, 59, 48, 0.3)' : type === 'success' ? 'rgba(0, 200, 100, 0.3)' : 'rgba(0, 102, 255, 0.3)'};
        font-weight: 600; font-size: 14px;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-in';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

function startRealTimeUpdates() {
    setInterval(() => {
        updateCharts();
        updateBandwidthChart();
        updateMonitorCharts();
    }, 2000);
}

function updateCharts() {
    downloadData.shift();
    downloadData.push(liveStats.download);
    downloadChart.data.datasets[0].data = downloadData;
    downloadChart.update('none');

    uploadData.shift();
    uploadData.push(liveStats.upload);
    uploadChart.data.datasets[0].data = uploadData;
    uploadChart.update('none');

    latencyData.shift();
    latencyData.push(liveStats.latency);
    latencyChart.data.datasets[0].data = latencyData;
    latencyChart.update('none');

    efficiencyData.shift();
    efficiencyData.push(liveStats.efficiency);
    efficiencyChart.data.datasets[0].data = efficiencyData;
    efficiencyChart.update('none');
}

function updateBandwidthChart() {
    const now = new Date();
    bandwidthTimeData.push(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    bandwidthDownloadData.push(liveStats.download);
    bandwidthUploadData.push(liveStats.upload);
    
    if (bandwidthTimeData.length > 30) {
        bandwidthTimeData.shift();
        bandwidthDownloadData.shift();
        bandwidthUploadData.shift();
    }
    
    bandwidthChart.data.labels = bandwidthTimeData;
    bandwidthChart.data.datasets[0].data = bandwidthDownloadData;
    bandwidthChart.data.datasets[1].data = bandwidthUploadData;
    bandwidthChart.update('none');
}

function updateMonitorCharts() {
    const newTcp = Math.max(40, 60 + (Math.random() - 0.5) * 10);
    const newUdp = Math.max(20, 30 + (Math.random() - 0.5) * 5);
    const total = newTcp + newUdp;
    protocolData = [newTcp, newUdp, 100 - total];
    protocolDistributionChart.data.datasets[0].data = protocolData;
    protocolDistributionChart.update('none');

    packetLossData.shift();
    packetLossData.push(Math.random() * 1.5 + 0.3);
    packetLossChart.data.datasets[0].data = packetLossData;
    packetLossChart.update('none');
}

document.addEventListener('DOMContentLoaded', initDashboard);
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
            case '1': e.preventDefault(); document.querySelector('[data-section="dashboard"]').click(); break;
            case '2': e.preventDefault(); document.querySelector('[data-section="monitor"]').click(); break;
            case '3': e.preventDefault(); document.querySelector('[data-section="bandwidth"]').click(); break;
            case 'k': e.preventDefault(); emergencyKill(); break;
        }
    }
});

