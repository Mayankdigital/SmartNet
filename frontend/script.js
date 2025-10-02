let liveStats = { download: 0, upload: 0, latency: 0, efficiency: 0 };

// Connect to the Python WebSocket server
const socket = new WebSocket('ws://localhost:8765');

socket.onopen = function(e) {
    console.log("[open] Connection established to NetScheduler Pro backend.");
};

socket.onmessage = function(event) {
    try {
        const data = JSON.parse(event.data);
        
        // 1. Update global stats
        liveStats.download = data.globalStats.downloadSpeed;
        liveStats.upload = data.globalStats.uploadSpeed;
        liveStats.latency = data.globalStats.latency;
        liveStats.efficiency = data.globalStats.efficiency;

        document.getElementById('downloadSpeed').textContent = `${liveStats.download.toFixed(1)} MB/s`;
        document.getElementById('uploadSpeed').textContent = `${liveStats.upload.toFixed(1)} MB/s`;
        document.getElementById('latency').textContent = `${Math.floor(liveStats.latency)}ms`;
        document.getElementById('efficiency').textContent = `${liveStats.efficiency.toFixed(1)}%`;

        // 2. Update the process list by merging backend data with frontend state
        updateProcessList(data.processes);

        // 3. Re-render the visible application list
        const activeSection = document.querySelector('.sidebar-item.active').dataset.section;
        if (activeSection === 'monitor' || activeSection === 'dashboard') {
            renderApplications(activeSection);
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

// This is the LATEST version of the function with the toggle switch FIX
function updateProcessList(backendProcesses) {
    // --- THE FIX IS ON THIS LINE ---
    // We now convert all incoming names to lowercase to ensure case-insensitive matching.
    const backendNames = new Set(backendProcesses.map(p => p.name.toLowerCase()));

    backendProcesses.forEach(proc => {
        const cleanProcName = proc.name.replace(/\.exe$/i, '');
        const existingApp = applications.find(app => app.name.toLowerCase() === cleanProcName.toLowerCase());
        
        let downSpeed = proc.downloadSpeed;
        let downUnit = 'KB/s';
        if (downSpeed > 1024) { downSpeed /= 1024; downUnit = 'MB/s'; }

        let upSpeed = proc.uploadSpeed;
        let upUnit = 'KB/s';
        if (upSpeed > 1024) { upSpeed /= 1024; upUnit = 'MB/s'; }
        
        const currentSpeedDown = `${downSpeed.toFixed(downSpeed > 0 ? 1 : 0)} ${downUnit}`;
        const currentSpeedUp = `${upSpeed.toFixed(upSpeed > 0 ? 1 : 0)} ${upUnit}`;

        if (existingApp) {
            // Update live data ONLY.
            existingApp.speed = currentSpeedDown;
            existingApp.uploadSpeed = currentSpeedUp;
            existingApp.pid = proc.pid; // This holds the instance count
        } else {
            // Add new process with default settings
            const newApp = {
                pid: proc.pid,
                name: cleanProcName.charAt(0).toUpperCase() + cleanProcName.slice(1),
                logo: cleanProcName.charAt(0).toUpperCase(),
                category: "System Process",
                protocol: "TCP/UDP",
                speed: currentSpeedDown,
                uploadSpeed: currentSpeedUp,
                priority: "medium",
                speedLimit: "No Limit",
                active: true, // New apps are active by default
                color: generateColorFromString(cleanProcName),
                downloadCap: 100,
                uploadCap: 50,
                appliedModes: [],
                policyApplied: false
            };
            applications.push(newApp);
        }
    });

    // This check now works correctly with the case-insensitive backendNames Set
    applications.forEach(app => {
        const exeName = app.name.toLowerCase() + '.exe';
        if (!backendNames.has(exeName) && !backendNames.has(app.name.toLowerCase()) && app.active) {
            if (app.category !== 'KILLED PROCESS' && app.category !== 'DEFAULT POLICY') {
                 app.active = false;
                 app.speed = "0 KB/s";
                 app.uploadSpeed = "0 KB/s";
            }
        }
    });
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

const initialApplications = [];

let applications = [];

const POLICY_MODES = [
    { value: 'work', label: 'Work Mode' },
    { value: 'gaming', label: 'Gaming Mode' },
    { value: 'entertainment', label: 'Entertainment' },
    { value: 'night', label: 'Night Mode' },
    { value: 'custom', label: 'Custom' }
];

function getInitialApplicationState(name) {
    const initial = initialApplications.find(app => app.name === name);
    return initial ? JSON.parse(JSON.stringify(initial)) : null;
}

function createPolicyResetLogEntry(app, pid) {
    return {
        name: app.name,
        logo: app.logo,
        category: 'DEFAULT POLICY', 
        protocol: 'DEFAULT', 
        speed: "0 KB/s", 
        priority: 'low',
        speedLimit: 'DEFAULT',
        active: false,
        color: app.color,
        uploadSpeed: "0 KB/s",
        downloadCap: 0,
        uploadCap: 0,
        pid: pid,
        timestamp: new Date().toLocaleTimeString(),
        appliedModes: [],
        policyApplied: false 
    };
}


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

// REPLACE the entire renderApplications function with this one

function renderApplications(view) {
    const containerId = view === 'monitor' ? 'monitorAppsContainer' : 'appsContainer';
    const container = document.getElementById(containerId);
    if (!container) return; 

    container.innerHTML = '';
    
    let listToRender = applications; 
    
    if (view === 'dashboard') {
        listToRender = applications.filter(app => app.policyApplied === true);

        if (listToRender.length === 0) {
            container.innerHTML = `
                <div class="empty-state-message">
                    <div class="empty-state-icon">🛡️</div>
                    <h3>No Policies Applied</h3>
                    <p>Go to the <b>Real-time Monitor</b> tab to apply a policy to an application. It will then appear here.</p>
                </div>
            `;
            return;
        }
    }
    
    if (view === 'monitor') {
        // --- NEW: Search Filter Logic ---
        const searchInput = document.getElementById('processSearchInput');
        const searchTerm = searchInput.value.toLowerCase().trim();

        if (searchTerm) {
            listToRender = listToRender.filter(app => 
                app.name.toLowerCase().includes(searchTerm)
            );
        }
        // --- End of Search Logic ---


        const filterValue = document.getElementById('policyStatusFilter').value;
        if (filterValue === 'applied') {
            listToRender = listToRender.filter(app => app.policyApplied === true && app.category !== 'KILLED PROCESS' && app.category !== 'DEFAULT POLICY');
        } else if (filterValue === 'default') {
            listToRender = listToRender.filter(app => app.policyApplied === false || app.category === 'KILLED PROCESS' || app.category === 'DEFAULT POLICY');
        }
    }

    listToRender.forEach((app) => {
        if (view === 'dashboard' && (app.category === 'KILLED PROCESS' || app.category === 'DEFAULT POLICY')) {
            return;
        }

        const originalIndex = applications.findIndex(a => a.name.toLowerCase() === app.name.toLowerCase());
        
        const appElement = document.createElement('div');
        const statusClass = (view === 'monitor' && !app.active) ? 'inactive' : (app.active ? 'active' : '');
        appElement.className = `app-item ${statusClass}`;

        let appInfoContent;

        const modesDisplay = app.appliedModes && app.appliedModes.length > 0
            ? `<span class="app-mode-badge">${app.appliedModes.map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(', ')}</span>`
            : '';
        
        const policyCheckMarkMonitor = app.policyApplied 
            ? `<span style="color: #00c864; font-size: 16px; margin-left: 8px;">✅</span>`
            : '';

        if (view === 'monitor') {
            const speedDisplayDown = `⬇️ ${app.speed}`;
            const speedDisplayUp = `⬆️ ${app.uploadSpeed}`;
            const protocolDisplay = app.active ? app.protocol.split('/')[0] : app.protocol;
            
            let downloadColor, uploadColor;
            
            if (app.category === 'KILLED PROCESS') {
                downloadColor = '#ff3b30';
                uploadColor = '#ff3b30'; 
            } else if (app.active) {
                downloadColor = '#00c864';
                uploadColor = '#ff9500';
            } else {
                downloadColor = '#7a8a99';
                uploadColor = '#7a8a99';
            }
            
            appInfoContent = `
                <div class="app-details">
                    <div class="app-name-text" style="color: #1a2332;">${app.name} ${policyCheckMarkMonitor}</div>
                    <div class="app-category">
                        <span style="color: #7a8a99;">${app.pid}</span>
                    </div>
                </div>
                <div class="app-speeds-monitor">
                    <div class="app-download-speed" style="color: ${downloadColor};">
                        <span>${speedDisplayDown}</span>
                    </div>
                    <div class="app-upload-speed" style="color: ${uploadColor};">
                        <span>${speedDisplayUp}</span>
                    </div>
                </div>
                <div class="app-category">
                    Current: <span class="app-protocol-badge">${protocolDisplay}</span>
                </div>
                <div class="app-controls">
                    <button class="policy-btn" onclick="openPolicyEditor(${originalIndex})">POLICY</button>
                </div>
            `;
        } else {
            appInfoContent = `
                <div class="app-details">
                    <div class="app-name-text">${app.name}</div>
                    <div class="app-category">
                        <span>${app.category}</span>
                        <span class="app-protocol-badge">${app.protocol}</span>
                        ${modesDisplay}
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
                    <button class="kill-app-btn" onclick="killApp(${originalIndex}, 'dashboard')">KILL</button>
                </div>
            `;
        }

        appElement.innerHTML = `
            <div class="app-logo-small" style="background: ${app.color}">${app.logo}</div>
            <div class="app-info">${appInfoContent}</div>
        `;
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

    appToKill.active = false;
    appToKill.priority = 'low'; 
    appToKill.speedLimit = 'DEFAULT';
    appToKill.policyApplied = false;
    appToKill.appliedModes = [];
    appToKill.protocol = 'DEFAULT';
    appToKill.category = 'DEFAULT POLICY';
    
    renderApplications('dashboard');
    renderApplications('monitor');

    showNotification(`${appToKill.name} policy reset to system default.`, 'error');
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

function openPolicyEditor(index) {
    const app = applications[index];
    if (!app) {
        console.error("Could not find application to open policy editor for.");
        return;
    }
    currentEditingAppIndex = index;

    document.getElementById('modalAppName').textContent = `Policy Editor for ${app.name}`;
    renderModeCheckboxes(app.appliedModes || []);

    let currentPriority = app.active === false ? 'block' : app.priority;
    document.getElementById('prioritySelect').value = currentPriority || 'medium'; 

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

    let app = applications[currentEditingAppIndex];
    if (!app) return;
    
    const newPriority = document.getElementById('prioritySelect').value;
    const newDownloadCap = parseInt(document.getElementById('downloadLimitSlider').value);
    const newUploadCap = parseInt(document.getElementById('uploadLimitSlider').value);
    const selectedModes = Array.from(document.querySelectorAll('#policyModeCheckboxes input[name="policyMode"]:checked')).map(cb => cb.value);
    
    if (newPriority === 'block') {
        app.active = false;
        app.priority = 'low'; 
        app.speedLimit = 'DEFAULT'; 
        app.policyApplied = false;
        app.appliedModes = [];
        app.protocol = 'DEFAULT';
        app.category = 'DEFAULT POLICY';
        showNotification(`Policy for ${app.name} reset to system default.`, 'error');
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
        
        showNotification(`Policy for ${app.name} saved and applied successfully!`, 'success');
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