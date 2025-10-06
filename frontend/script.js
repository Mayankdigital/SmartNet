// No changes from the previous version. The new dashboard logic is already implemented.
// This is the full, correct file.
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
            existingApp.logoUrl = proc.favicon || resolveLogoUrl(cleanProcName);
            existingApp.active = true; 
        } else {
            const savedPolicy = savedPolicies[String(proc.pid).toLowerCase()] || savedPolicies[cleanProcName.toLowerCase()];

            const newApp = {
                pid: proc.pid,
                name: cleanProcName.charAt(0).toUpperCase() + cleanProcName.slice(1),
                instance_title: proc.instance_title,
                logo: cleanProcName.charAt(0).toUpperCase(),
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
    'chrome': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/chrome/chrome-original.svg',
    'firefox': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/firefox/firefox-original.svg',
    'edge': 'https://img.icons8.com/color/512/ms-edge-new.png',
    'msedge': 'https://img.icons8.com/color/512/ms-edge-new.png',
    'opera': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/opera/opera-original.svg',
    'brave': 'https://img.icons8.com/color/512/brave-web-browser.png',
    'safari': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/safari/safari-original.svg',
    'code': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/vscode/vscode-original.svg',
    'terminal': 'https://img.icons8.com/fluency/512/console.png',
    'powershell': 'https://img.icons8.com/color/512/powershell.png',
    'explorer': 'https://img.icons8.com/color/512/folder-invoices--v1.png',
    'node': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/nodejs/nodejs-original.svg',
    'python': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/python/python-original.svg',
    'docker': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/docker/docker-original.svg',
    'discord': 'https://img.icons8.com/color/512/discord--v2.png',
    'slack': 'https://img.icons8.com/color/512/slack-new.png',
    'zoom': 'https://img.icons8.com/color/512/zoom.png',
    'teams': 'https://img.icons8.com/color/512/microsoft-teams-2019.png',
    'spotify': 'https://img.icons8.com/color/512/spotify--v1.png',
    'steam': 'https://img.icons8.com/fluency/512/steam.png',
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
let bandwidthSortEnabled = false; 

const POLICY_MODES = [
    { value: 'work', label: 'Work Mode' },
    { value: 'gaming', label: 'Gaming Mode' },
    { value: 'entertainment', label: 'Entertainment' },
    { value: 'night', label: 'Night Mode' },
    { value: 'custom', label: 'Custom' }
];

let downloadChart, uploadChart, latencyChart, efficiencyChart, bandwidthChart, protocolDistributionChart, packetLossChart;
let downloadData = Array(10).fill(0), uploadData = Array(10).fill(0), latencyData = Array(10).fill(0), efficiencyData = Array(10).fill(0);
let bandwidthTimeData = [], bandwidthDownloadData = [], bandwidthUploadData = [];
let protocolData = [34, 33, 33], packetLossData = Array(7).fill(0);
let currentEditingTarget = null;
let expandedGroupState = {}; 

function initDashboard() {
    initializeCharts();
    generateInitialBandwidthData();
    renderApplications('dashboard');
    setupEventListeners();
    startRealTimeUpdates();
}

function initializeCharts() {
    const miniChartOptions = {
        responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { x: { display: false }, y: { display: false } },
        elements: { line: { tension: 0.4, borderWidth: 2 }, point: { radius: 0 } }
    };
    downloadChart = new Chart(document.getElementById('downloadChart'), { type: 'line', data: { labels: Array(10).fill(''), datasets: [{ data: downloadData, borderColor: '#0066ff', backgroundColor: 'rgba(0, 102, 255, 0.1)', fill: true }] }, options: miniChartOptions });
    uploadChart = new Chart(document.getElementById('uploadChart'), { type: 'line', data: { labels: Array(10).fill(''), datasets: [{ data: uploadData, borderColor: '#00c864', backgroundColor: 'rgba(0, 200, 100, 0.1)', fill: true }] }, options: miniChartOptions });
    latencyChart = new Chart(document.getElementById('latencyChart'), { type: 'line', data: { labels: Array(10).fill(''), datasets: [{ data: latencyData, borderColor: '#ff9500', backgroundColor: 'rgba(255, 149, 0, 0.1)', fill: true }] }, options: miniChartOptions });
    efficiencyChart = new Chart(document.getElementById('efficiencyChart'), { type: 'line', data: { labels: Array(10).fill(''), datasets: [{ data: efficiencyData, borderColor: '#5e5ce6', backgroundColor: 'rgba(94, 92, 230, 0.1)', fill: true }] }, options: miniChartOptions });
    bandwidthChart = new Chart(document.getElementById('bandwidthChart'), {
        type: 'line',
        data: { labels: bandwidthTimeData, datasets: [
                { label: 'Download', data: bandwidthDownloadData, borderColor: '#0066ff', backgroundColor: 'rgba(0, 102, 255, 0.1)', fill: true, tension: 0.4 },
                { label: 'Upload', data: bandwidthUploadData, borderColor: '#00c864', backgroundColor: 'rgba(0, 200, 100, 0.1)', fill: true, tension: 0.4 }
        ]},
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'top' }}, scales: { x: { grid: { color: 'rgba(0, 100, 255, 0.1)' }}, y: { grid: { color: 'rgba(0, 100, 255, 0.1)' }}}}
    });
    protocolDistributionChart = new Chart(document.getElementById('protocolDistributionChart'), {
        type: 'doughnut', data: { labels: ['TCP', 'UDP', 'Other'], datasets: [{ data: protocolData, backgroundColor: ['#0066ff', '#ff9500', '#5e5ce6'], hoverOffset: 4 }]},
        options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: true, text: 'Protocol Distribution (%)'}, legend: { position: 'bottom' }}}
    });
    packetLossChart = new Chart(document.getElementById('packetLossChart'), {
        type: 'bar', data: { labels: ['-10s', '-20s', '-30s', '-40s', '-50s', '-60s'], datasets: [{ label: 'Packet Loss (%)', data: packetLossData, backgroundColor: '#ff3b30' }]},
        options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: true, text: 'Packet Loss Rate (%)' }, legend: { display: false } }, scales: { y: { beginAtZero: true, max: 2.0 } } }
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
        const searchTerm = document.getElementById('processSearchInput').value.toLowerCase().trim();
        if (searchTerm) {
            listToRender = listToRender.filter(app => app.name.toLowerCase().includes(searchTerm) || (app.instance_title && app.instance_title.toLowerCase().includes(searchTerm)));
        }

        const filterValue = document.getElementById('policyStatusFilter').value;
        if (filterValue === 'applied') listToRender = listToRender.filter(app => app.policyApplied);
        else if (filterValue === 'default') listToRender = listToRender.filter(app => !app.policyApplied);

        const groupedApps = listToRender.reduce((acc, app) => {
            if (!acc[app.name]) acc[app.name] = { processes: [], totalDownloadKB: 0, totalUploadKB: 0, logoUrl: resolveLogoUrl(app.name), color: app.color, policyApplied: false, appliedModes: new Set() };
            acc[app.name].processes.push(app);
            acc[app.name].totalDownloadKB += app.downloadSpeedNumeric || 0;
            acc[app.name].totalUploadKB += app.uploadSpeedNumeric || 0;
            if (app.policyApplied) acc[app.name].policyApplied = true;
            if(app.appliedModes) app.appliedModes.forEach(mode => acc[app.name].appliedModes.add(mode));
            return acc;
        }, {});

        let sortedGroupKeys = Object.keys(groupedApps);
        const sortBtn = document.getElementById('bandwidthSortBtn');
        if (bandwidthSortEnabled) {
            sortedGroupKeys.sort((a, b) => (groupedApps[b].totalDownloadKB + groupedApps[b].totalUploadKB) - (groupedApps[a].totalDownloadKB + groupedApps[a].totalUploadKB));
            if (sortBtn) { sortBtn.classList.add('active'); sortBtn.title = "Bandwidth Sort (Active)"; }
        } else {
            sortedGroupKeys.sort();
            if (sortBtn) { sortBtn.classList.remove('active'); sortBtn.title = "Sort by Bandwidth"; }
        }
        
        sortedGroupKeys.forEach(appName => {
            const group = groupedApps[appName];
            const isGroupActive = group.processes.some(p => p.active);
            const policyCheckMark = group.policyApplied ? `<span style="color: #00c864;">✅</span>` : '';
            const modesDisplay = Array.from(group.appliedModes).map(mode => `<span class="app-mode-badge">${mode.charAt(0).toUpperCase() + mode.slice(1)}</span>`).join('');
            const instanceCount = group.processes.length;
            const countDisplay = instanceCount > 1 ? `(${instanceCount})` : '';
            const pidDisplay = instanceCount === 1 ? `<div class="app-pid">PID: ${group.processes[0].pid}</div>` : '';
            const isExpandable = instanceCount > 1;
            const isCurrentlyExpanded = expandedGroupState[appName] === true;
            const avgTcpPercent = isGroupActive ? Math.round(group.processes.reduce((sum, p) => sum + p.protocolPercent, 0) / instanceCount) : 0;

            const groupElement = document.createElement('div');
            groupElement.className = 'app-group';
            groupElement.innerHTML = `
                <div class="app-item app-group-header ${isGroupActive ? '' : 'inactive'}">
                    <div class="app-logo-container">
                        <div class="app-logo-small" style="${group.logoUrl ? `background-image: url('${group.logoUrl}');` : `background: ${group.color};`}">${group.logoUrl ? '' : appName.charAt(0)}</div>
                        ${pidDisplay}
                    </div>
                    <div class="app-info">
                        <div class="app-details">
                            <div class="app-name-text">${appName} ${countDisplay} ${policyCheckMark} ${modesDisplay}</div>
                            ${isGroupActive ? `<div class="protocol-display"><div class="protocol-labels"><span>TCP:${avgTcpPercent}%</span><span>UDP:${100-avgTcpPercent}%</span></div><div class="protocol-bar-container"><div class="protocol-bar-inner" style="width:${avgTcpPercent}%;"></div></div></div>` : ''}
                        </div>
                        <div class="app-speeds-monitor">
                            <div class="app-download-speed">⬇️ ${formatSpeed(group.totalDownloadKB)}</div>
                            <div class="app-upload-speed">⬆️ ${formatSpeed(group.totalUploadKB)}</div>
                        </div>
                        <div class="app-controls">
                            <button class="policy-btn" onclick="openPolicyEditorForApp('${appName}')">POLICY</button>
                            ${isExpandable ? `<span class="expand-icon" style="transform:rotate(${isCurrentlyExpanded ? 90 : 0}deg);">▶</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="app-group-children" style="display:${isCurrentlyExpanded ? 'block' : 'none'};">
                    ${group.processes.map(proc => {
                        const isChrome = appName.toLowerCase() === 'chrome';
                        let instanceControls = `<button class="kill-app-btn instance-kill" onclick="resetInstancePolicy('${proc.pid}')">RESET</button>`;
                        if (isChrome) {
                            instanceControls = `<button class="policy-btn instance-policy" onclick="openPolicyEditorForInstance('${proc.pid}')">POLICY</button>` + instanceControls;
                        }

                        return `
                        <div class="app-item app-instance-item ${proc.active ? '' : 'inactive'}">
                            <div class="app-logo-container">
                                <div class="app-logo-small instance-logo" style="${proc.logoUrl ? `background-image:url('${proc.logoUrl}');` : `background:${proc.color};`}">${proc.logoUrl ? '' : proc.name.charAt(0)}</div>
                                <div class="app-pid">${String(proc.pid).startsWith('tab_') ? 'Tab ID':'PID'}: ${String(proc.pid).replace('tab_','')}</div>
                            </div>
                            <div class="app-info">
                                <div class="instance-details">
                                    <div class="instance-title" title="${proc.instance_title}">${proc.instance_title || proc.name}</div>
                                    <div class="protocol-display"><div class="protocol-labels"><span>TCP:${proc.protocolPercent}%</span><span>UDP:${100-proc.protocolPercent}%</span></div><div class="protocol-bar-container"><div class="protocol-bar-inner" style="width:${proc.protocolPercent}%;"></div></div></div>
                                </div>
                                <div class="app-speeds-monitor">
                                    <div class="app-download-speed">⬇️ ${proc.speed}</div>
                                    <div class="app-upload-speed">⬆️ ${proc.uploadSpeed}</div>
                                </div>
                                <div class="app-controls">${instanceControls}</div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>`;
            container.appendChild(groupElement);

            if (isExpandable) {
                groupElement.querySelector('.app-group-header').addEventListener('click', (e) => {
                    if (e.target.classList.contains('policy-btn')) return;
                    expandedGroupState[appName] = !isCurrentlyExpanded;
                    renderApplications('monitor');
                });
            }
        });
        return;
    }

    // --- MODIFIED: Dashboard View Logic ---
    const listWithPolicies = applications.filter(app => app.policyApplied && app.category !== 'KILLED PROCESS' && app.category !== 'DEFAULT POLICY');
    
    if (listWithPolicies.length === 0) {
        container.innerHTML = `<div class="empty-state-message"><div class="empty-state-icon">🛡️</div><h3>No Policies Applied</h3><p>Go to the <b>Real-time Monitor</b> tab to apply a policy to an application. It will then appear here.</p></div>`;
        return;
    }

    const groupedForDashboard = listWithPolicies.reduce((acc, app) => {
        const key = app.name.toLowerCase() === 'chrome' ? app.pid : app.name;
        if (!acc[key]) {
            acc[key] = {
                isGroup: app.name.toLowerCase() !== 'chrome',
                displayName: app.name.toLowerCase() === 'chrome' ? app.instance_title : app.name,
                name: app.name,
                instances: [],
                totalDownload: 0,
                totalUpload: 0,
                ...app 
            };
        }
        acc[key].instances.push(app);
        acc[key].totalDownload += app.downloadSpeedNumeric;
        acc[key].totalUpload += app.uploadSpeedNumeric;
        return acc;
    }, {});

    const priorityOrder = { 'critical': 4, 'high': 3, 'medium': 2, 'low': 1, 'block': 0 };
    const sortedGroups = Object.values(groupedForDashboard).sort((a, b) => {
        return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
    });

    sortedGroups.forEach(group => {
        const appElement = document.createElement('div');
        appElement.className = `app-item`;

        const modesDisplay = (group.appliedModes || []).map(mode => `<span class="app-mode-badge">${mode.charAt(0).toUpperCase() + mode.slice(1)} Mode</span>`).join('');
        const nameDisplay = group.isGroup && group.instances.length > 1 
            ? `${group.displayName} (${group.instances.length})` 
            : group.displayName;

        const combinedSpeed = formatSpeed(group.totalDownload);

        appElement.innerHTML = `
            <div class="app-logo-small" style="${group.logoUrl ? `background-image: url('${group.logoUrl}'); background-color: #fff;` : `background: ${group.color}; color: #fff;`}">${group.logoUrl ? '' : group.logo}</div>
            <div class="app-info">
                 <div class="app-details">
                    <div class="app-name-text">${nameDisplay} ${modesDisplay}</div>
                    <div class="app-category">
                        <span>${group.category}</span>
                        <span class="app-protocol-badge">${group.protocol}</span>
                    </div>
                </div>
                <div class="app-performance">
                    <div class="app-speed">${combinedSpeed}</div>
                    <div class="app-limit">Limit: ${group.speedLimit}</div>
                </div>
                <div class="priority-badge priority-${group.priority}">${group.priority.toUpperCase()}</div>
                <div class="app-controls">
                    <div class="toggle-switch ${group.instances.some(i => i.active) ? 'active' : ''}" onclick="toggleAppGroup('${group.name}')">
                        <div class="toggle-slider"></div>
                    </div>
                    <button class="kill-app-btn" onclick="resetAppPolicyGroup('${group.name}')">KILL</button>
                </div>
            </div>`;
        container.appendChild(appElement);
    });
}

function toggleAppGroup(appName) {
    const appsToToggle = applications.filter(app => app.name === appName);
    const shouldBecomeActive = !appsToToggle.some(app => app.active);

    appsToToggle.forEach(app => {
        app.active = shouldBecomeActive;
        if (!app.active) {
            app.speed = "0 KB/s";
            app.uploadSpeed = "0 KB/s";
        }
    });
    
    renderApplications('dashboard');
    renderApplications('monitor');
    showNotification(`${appName} group ${shouldBecomeActive ? 'resumed' : 'paused'}`, shouldBecomeActive ? 'success' : 'error');
}

function resetAppPolicyGroup(appName) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ action: 'delete_policy', payload: { name: appName } }));
    }
    
    applications.forEach(app => {
        if (app.name === appName) {
            Object.assign(app, {
                active: false, priority: 'low', speedLimit: 'DEFAULT', policyApplied: false,
                appliedModes: [], protocol: 'DEFAULT', category: 'DEFAULT POLICY'
            });
        }
    });

    renderApplications('dashboard');
    renderApplications('monitor');
    showNotification(`Policy for ${appName} has been reset.`, 'error');
}

function resetInstancePolicy(pid) {
    const app = applications.find(a => a.pid === pid);
    if (!app) return;

    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ action: 'delete_policy', payload: { name: pid } }));
    }
    
    const globalPolicy = savedPolicies[app.name.toLowerCase()];
    if (globalPolicy) {
        Object.assign(app, globalPolicy, { policyApplied: true, speedLimit: `${globalPolicy.downloadCap} MB/s` });
    } else {
        Object.assign(app, { priority: 'medium', speedLimit: 'No Limit', downloadCap: 100, uploadCap: 50, appliedModes: [], policyApplied: false });
    }
    
    renderApplications('monitor');
    showNotification(`Policy for instance ${pid} has been reset.`, 'info');
}

function emergencyKill() {
    applications.forEach(app => { app.active = false; app.policyApplied = false; });
    renderApplications('dashboard');
    renderApplications('monitor'); 
    showNotification('Emergency kill activated. All policies reset.', 'error');
}

function renderModeCheckboxes(appliedModes) {
    document.getElementById('policyModeCheckboxes').innerHTML = POLICY_MODES.map(mode => `
        <label>
            <input type="checkbox" name="policyMode" value="${mode.value}" ${appliedModes.includes(mode.value) ? 'checked' : ''}>
            <span>${mode.label}</span>
        </label>
    `).join('');
}

function openPolicyEditorForApp(appName) {
    const app = applications.find(a => a.name === appName);
    if (!app) return;
    currentEditingTarget = { type: 'app', name: appName };
    document.getElementById('modalAppName').textContent = `Policy Editor for ${appName}`;
    renderModeCheckboxes(app.appliedModes || []);
    document.getElementById('prioritySelect').value = app.priority || 'medium';
    document.getElementById('downloadLimitSlider').value = app.downloadCap;
    document.getElementById('downloadLimitValue').textContent = `${app.downloadCap} Mbps`;
    document.getElementById('uploadLimitSlider').value = app.uploadCap;
    document.getElementById('uploadLimitValue').textContent = `${app.uploadCap} Mbps`;
    document.getElementById('policyModal').style.display = 'block';
}

function openPolicyEditorForInstance(pid) {
    const app = applications.find(a => a.pid === pid);
    if (!app) return;
    currentEditingTarget = { type: 'instance', pid: pid };
    document.getElementById('modalAppName').textContent = `Policy for ${app.instance_title || `Instance ${pid}`}`;
    renderModeCheckboxes(app.appliedModes || []);
    document.getElementById('prioritySelect').value = app.priority || 'medium';
    document.getElementById('downloadLimitSlider').value = app.downloadCap;
    document.getElementById('downloadLimitValue').textContent = `${app.downloadCap} Mbps`;
    document.getElementById('uploadLimitSlider').value = app.uploadCap;
    document.getElementById('uploadLimitValue').textContent = `${app.uploadCap} Mbps`;
    document.getElementById('policyModal').style.display = 'block';
}

function updateLimitValue(type) {
    const slider = document.getElementById(`${type}LimitSlider`);
    document.getElementById(`${type}LimitValue`).textContent = `${slider.value} Mbps`;
}

function savePolicyChanges() {
    if (!currentEditingTarget) return;

    const newPolicy = {
        priority: document.getElementById('prioritySelect').value,
        downloadCap: parseInt(document.getElementById('downloadLimitSlider').value),
        uploadCap: parseInt(document.getElementById('uploadLimitSlider').value),
        appliedModes: Array.from(document.querySelectorAll('#policyModeCheckboxes input:checked')).map(cb => cb.value)
    };
    newPolicy.speedLimit = `${newPolicy.downloadCap} MB/s`;
    newPolicy.policyApplied = true;

    let policyPayload;
    let targetName;

    if (currentEditingTarget.type === 'app') {
        targetName = currentEditingTarget.name;
        applications.forEach(app => {
            if (app.name === targetName) Object.assign(app, newPolicy);
        });
        policyPayload = { ...newPolicy, name: targetName };
    } else { // type is 'instance'
        targetName = currentEditingTarget.pid;
        const app = applications.find(a => a.pid === targetName);
        if (app) Object.assign(app, newPolicy);
        policyPayload = { ...newPolicy, name: targetName };
    }
    
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ action: 'save_policy', payload: policyPayload }));
    }

    renderApplications('monitor');
    renderApplications('dashboard');
    closeModal();
    showNotification(`Policy for ${targetName} saved successfully!`, 'success');
}

function closeModal() {
    document.getElementById('policyModal').style.display = 'none';
    currentEditingTarget = null;
}

window.onclick = e => { if (e.target == document.getElementById('policyModal')) closeModal(); }

function setupEventListeners() {
    document.querySelectorAll('.sidebar-item').forEach(item => item.addEventListener('click', () => {
        const sectionName = item.dataset.section;
        document.querySelector('.sidebar-item.active').classList.remove('active');
        item.classList.add('active');
        document.querySelector('.dashboard-content.active-section').classList.remove('active-section');
        document.getElementById(sectionName).classList.add('active-section');
        if (['monitor', 'dashboard'].includes(sectionName)) renderApplications(sectionName);
    }));
    document.getElementById('bandwidthSortBtn').addEventListener('click', () => {
        bandwidthSortEnabled = !bandwidthSortEnabled; 
        renderApplications('monitor'); 
    });
}

function startRealTimeUpdates() {
    setInterval(() => {
        updateCharts();
        updateBandwidthChart();
    }, 2000);
}

function updateCharts() {
    downloadData.push(liveStats.download); uploadData.push(liveStats.upload); latencyData.push(liveStats.latency); efficiencyData.push(liveStats.efficiency);
    if(downloadData.length > 10) { downloadData.shift(); uploadData.shift(); latencyData.shift(); efficiencyData.shift(); }
    if(downloadChart) {
        downloadChart.update('none'); uploadChart.update('none'); latencyChart.update('none'); efficiencyChart.update('none');
    }
}

function updateBandwidthChart() {
    bandwidthTimeData.push(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    bandwidthDownloadData.push(liveStats.download);
    bandwidthUploadData.push(liveStats.upload);
    if (bandwidthTimeData.length > 30) { bandwidthTimeData.shift(); bandwidthDownloadData.shift(); bandwidthUploadData.shift(); }
    if(bandwidthChart) bandwidthChart.update('none');
}

document.addEventListener('DOMContentLoaded', initDashboard);