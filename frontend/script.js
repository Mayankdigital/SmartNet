const initialApplications = [ 
    {
        name: "Zoom Meeting",
        logo: "Z",
        category: "Video Conference",
        protocol: "TCP/UDP",
        speed: "4.2 MB/s",
        priority: "high",
        speedLimit: "10 MB/s",
        active: true,
        color: 'linear-gradient(135deg, #4285f4, #5a95f5)',
        uploadSpeed: "1.5 MB/s",
        downloadCap: 50, // Mbps
        uploadCap: 10,
        appliedModes: ['work', 'gaming'],
        policyApplied: false 
    },
    {
        name: "Spotify",
        logo: "♪",
        category: "Music Streaming",
        protocol: "TCP",
        speed: "320 KB/s",
        priority: "medium",
        speedLimit: "1 MB/s",
        active: true,
        color: 'linear-gradient(135deg, #1ed760, #1fdf64)',
        uploadSpeed: "10 KB/s",
        downloadCap: 5,
        uploadCap: 1,
        appliedModes: ['entertainment'],
        policyApplied: false 
    },
    {
        name: "Steam",
        logo: "S",
        category: "Game Download",
        protocol: "Scheduled",
        speed: "0 KB/s",
        priority: "low",
        speedLimit: "50 MB/s",
        active: false,
        color: 'linear-gradient(135deg, #1b2838, #2a475e)',
        uploadSpeed: "0 KB/s",
        downloadCap: 100,
        uploadCap: 1,
        appliedModes: ['night'],
        policyApplied: false 
    },
    {
        name: "Chrome",
        logo: "C",
        category: "Web Browser",
        protocol: "HTTP/2",
        speed: "2.1 MB/s",
        priority: "medium",
        speedLimit: "10 MB/s",
        active: true,
        color: 'linear-gradient(135deg, #4285f4, #ea4335)',
        uploadSpeed: "0.5 MB/s",
        downloadCap: 20,
        uploadCap: 5,
        appliedModes: ['work', 'custom'],
        policyApplied: false 
    },
    {
        name: "Teams",
        logo: "T",
        category: "Video Conference",
        protocol: "UDP",
        speed: "1.8 MB/s",
        priority: "high",
        speedLimit: "5 MB/s",
        active: true,
        color: 'linear-gradient(135deg, #5b5fc7, #6264a7)',
        uploadSpeed: "0.8 MB/s",
        downloadCap: 5,
        uploadCap: 5,
        appliedModes: ['work'],
        policyApplied: false 
    }
];

let applications = JSON.parse(JSON.stringify(initialApplications));

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
let downloadData = [42, 45, 43, 47, 45, 48, 45, 46, 44, 45];
let uploadData = [12, 13, 12, 14, 13, 12, 13, 12, 13, 13];
let latencyData = [25, 23, 26, 22, 24, 21, 23, 25, 22, 23];
let efficiencyData = [92, 94, 93, 95, 94, 96, 94, 96, 93, 94];
let bandwidthTimeData = [];
let bandwidthDownloadData = [];
let bandwidthUploadData = [];

let protocolData = [55, 30, 15];
let packetLossData = [0.5, 1.2, 0.8, 1.5, 0.9, 0.4, 1.1];

let currentEditingAppIndex = -1;
let nextPID = 1000;


function initDashboard() {
    applications.forEach((app, index) => app.pid = nextPID + index);
    nextPID += applications.length;

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
        bandwidthDownloadData.push(Math.random() * 30 + 20);
        bandwidthUploadData.push(Math.random() * 15 + 5);
    }
}


/**
 * Renders application list based on the requested view (dashboard or monitor).
 */
function renderApplications(view) {
    const containerId = view === 'monitor' ? 'monitorAppsContainer' : 'appsContainer';
    const container = document.getElementById(containerId);
    if (!container) return; 

    container.innerHTML = '';
    
    let listToRender = applications; 
    
    // Apply Filter Logic for Monitor View
    if (view === 'monitor') {
        const filterValue = document.getElementById('policyStatusFilter').value;
        if (filterValue === 'applied') {
            listToRender = listToRender.filter(app => app.policyApplied === true && app.category !== 'KILLED PROCESS' && app.category !== 'DEFAULT POLICY');
        } else if (filterValue === 'default') {
            listToRender = listToRender.filter(app => app.policyApplied === false || app.category === 'KILLED PROCESS' || app.category === 'DEFAULT POLICY');
        }
    }


    listToRender.forEach((app) => {
        
        // Skip rendering the permanent KILLED/DEFAULT POLICY log entries on the DASHBOARD
        if (view === 'dashboard' && (app.category === 'KILLED PROCESS' || app.category === 'DEFAULT POLICY')) {
            return;
        }

        const originalIndex = applications.findIndex(a => a.pid === app.pid);
        
        const appElement = document.createElement('div');
        const statusClass = (view === 'monitor' && !app.active) ? 'inactive' : (app.active ? 'active' : '');
        appElement.className = `app-item ${statusClass}`;

        let appInfoContent;

        const modesDisplay = app.appliedModes && app.appliedModes.length > 0
            ? `<span class="app-mode-badge">${app.appliedModes.map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(', ')}</span>`
            : '';
        
        // Policy Checkmark for Monitor
        const policyCheckMarkMonitor = app.policyApplied 
            ? `<span style="color: #00c864; font-size: 16px; margin-left: 8px;">✅</span>`
            : '';

        if (view === 'monitor') {
            // Monitor View - NO CAPS
            const speedDisplayDown = `⬇️ ${app.speed}`;
            const speedDisplayUp = `⬆️ ${app.uploadSpeed}`;
            const protocolDisplay = app.active ? app.protocol.split('/')[0] : app.protocol;
            
            // FIX: Color logic for Monitor
            // Set colors based on status, but use fixed theme colors for app details.
            let downloadColor, uploadColor;
            
            if (app.category === 'KILLED PROCESS') {
                downloadColor = '#ff3b30'; // Red for true termination
                uploadColor = '#ff3b30'; 
            } else if (app.active) {
                downloadColor = '#00c864'; // Green when Active
                uploadColor = '#ff9500';  // Orange when Active
            } else {
                // Paused or Default Policy: Use Dark text color for speeds
                // We keep the original colors here, so it doesn't look muted/black.
                // The visual distinction is the 0 KB/s reading.
                downloadColor = '#00c864'; 
                uploadColor = '#ff9500';
            }


            appInfoContent = `
                <div class="app-details">
                    <div class="app-name-text" style="color: #1a2332;">${app.name} ${policyCheckMarkMonitor}</div>
                    <div class="app-category">
                        <span style="color: #7a8a99;">PID: ${app.pid}</span>
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
            // Dashboard View (Original)
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


function refreshApplications() {
    const refreshBtn = document.querySelector('.refresh-btn');
    refreshBtn.style.transform = 'rotate(360deg)';
    setTimeout(() => {
        const activeSection = document.querySelector('.sidebar-item.active').dataset.section;
        if (activeSection === 'monitor') {
            renderApplications('monitor');
        } else {
            renderApplications('dashboard');
        }
        refreshBtn.style.transform = 'rotate(0deg)';
        showNotification('Applications refreshed', 'success');
    }, 500);
}

function toggleApp(index) {
    const app = applications[index];
    
    app.active = !app.active;

    if (!app.active) {
        // If toggled OFF (paused): Policy suspended, revert to default speed logic
        app.speed = "0 KB/s";
        app.uploadSpeed = "0 KB/s";
    } 
    // If toggled ON, the next call to updateApplicationSpeeds() will resume the speed based on saved policies.

    renderApplications('dashboard');
    renderApplications('monitor');
    showNotification(`${app.name} ${app.active ? 'resumed' : 'paused'}`, app.active ? 'success' : 'error');
}

/**
 * Policy Wipe/Reset Action. Removes custom policy and reverts to simulated OS defaults.
 */
function killApp(index) {
    let appToKill = applications[index];

    // 1. Policy Wipe/Policy Reset
    appToKill.active = false;
    appToKill.priority = 'low'; 
    appToKill.speedLimit = 'DEFAULT'; // Dashboard display status
    appToKill.policyApplied = false;
    appToKill.appliedModes = [];
    appToKill.protocol = 'DEFAULT';
    appToKill.category = 'DEFAULT POLICY'; // Mark as policy reset/default

    // FIX: Remove the temporary speed zeroing so updateApplicationSpeeds() can apply default rate immediately.
    // The next updateApplicationSpeeds() call will calculate the non-zero default speed.
    
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
    currentEditingAppIndex = index;

    document.getElementById('modalAppName').textContent = `Policy Editor for ${app.name}`;

    renderModeCheckboxes(app.appliedModes || []);

    let currentPriority = app.active === false ? 'block' : app.priority;
    document.getElementById('prioritySelect').value = currentPriority || 'medium'; 

    const dlSlider = document.getElementById('downloadLimitSlider');
    const maxDownload = 100;
    dlSlider.max = maxDownload;
    dlSlider.value = app.downloadCap;
    document.getElementById('downloadLimitValue').textContent = `${app.downloadCap} Mbps`;

    const ulSlider = document.getElementById('uploadLimitSlider');
    const maxUpload = 50;
    ulSlider.max = maxUpload;
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
    
    const newPriority = document.getElementById('prioritySelect').value;
    const newDownloadCap = parseInt(document.getElementById('downloadLimitSlider').value);
    const newUploadCap = parseInt(document.getElementById('uploadLimitSlider').value);
    
    const selectedModes = Array.from(document.querySelectorAll('#policyModeCheckboxes input[name="policyMode"]:checked'))
                               .map(cb => cb.value);

    
    // If the app is currently a permanent KILLED log entry, we must spawn a new active version
    if (app.category === 'KILLED PROCESS') {
        if (newPriority !== 'block') {
            const indexToReplace = applications.findIndex(a => a.pid === app.pid);
            const initialApp = getInitialApplicationState(app.name);
            const pidToPreserve = app.pid;
            
            if (initialApp && indexToReplace !== -1) {
                applications.splice(indexToReplace, 1);
                const newActiveApp = JSON.parse(JSON.stringify(initialApp));
                newActiveApp.pid = pidToPreserve;
                applications.push(newActiveApp);
                app = newActiveApp;
            }
        } else {
            closeModal();
            return;
        }
    }


    // --- APPLY POLICIES ---
    
    if (newPriority === 'block') {
         // Policy Wipe/Reset Action
        app.active = false;
        app.priority = 'low'; 
        app.speedLimit = 'DEFAULT'; 
        app.policyApplied = false;
        app.appliedModes = [];
        app.protocol = 'DEFAULT';
        app.category = 'DEFAULT POLICY';
        showNotification(`Policy for ${app.name} reset to system default.`, 'error');
    } else {
        // Active Policy Applied
        app.active = true;
        app.priority = newPriority;
        app.downloadCap = newDownloadCap;
        app.uploadCap = newUploadCap;
        app.appliedModes = selectedModes;
        app.protocol = initialApplications.find(i => i.name === app.name).protocol; // Restore native protocol
        app.category = initialApplications.find(i => i.name === app.name).category; // Restore native category
        
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
            
            if (sectionName === 'monitor') {
                renderApplications('monitor');
            } else if (sectionName === 'dashboard') {
                renderApplications('dashboard');
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

function updateModeSettings(mode) {
    applications.forEach(app => {
        if (app.active) {
            if (mode === 'work' && ['Zoom Meeting', 'Teams'].includes(app.name)) {
                app.priority = 'high';
            } else if (mode === 'gaming' && app.name === 'Steam') {
                app.priority = 'high';
            } else if (mode === 'night') {
                app.active = false;
                app.speed = "0 KB/s";
                app.uploadSpeed = "0 KB/s";
            }
        }
    });
    renderApplications('dashboard');
    renderApplications('monitor');
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
        updateStats();
        updateApplicationSpeeds();
        updateCharts();
        updateBandwidthChart();
        updateMonitorCharts(); 
    }, 2000);
}

function updateCharts() {
    downloadData.shift();
    downloadData.push(45.2 + (Math.random() - 0.5) * 10);
    downloadChart.data.datasets[0].data = downloadData;
    downloadChart.update('none');

    uploadData.shift();
    uploadData.push(12.8 + (Math.random() - 0.5) * 3);
    uploadChart.data.datasets[0].data = uploadData;
    uploadChart.update('none');

    latencyData.shift();
    latencyData.push(23 + (Math.random() - 0.5) * 10);
    latencyChart.data.datasets[0].data = latencyData;
    latencyChart.update('none');

    efficiencyData.shift();
    efficiencyData.push(94.2 + (Math.random() - 0.5) * 4);
    efficiencyChart.data.datasets[0].data = efficiencyData;
    efficiencyChart.update('none');
}

function updateBandwidthChart() {
    const now = new Date();
    bandwidthTimeData.push(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    bandwidthDownloadData.push(Math.random() * 30 + 20);
    bandwidthUploadData.push(Math.random() * 15 + 5);
    
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

function updateStats() {
    document.getElementById('downloadSpeed').textContent = `${downloadData[downloadData.length - 1].toFixed(1)} MB/s`;
    document.getElementById('uploadSpeed').textContent = `${uploadData[uploadData.length - 1].toFixed(1)} MB/s`;
    document.getElementById('latency').textContent = `${Math.floor(latencyData[latencyData.length - 1])}ms`;
    document.getElementById('efficiency').textContent = `${efficiencyData[efficiencyData.length - 1].toFixed(1)}%`;
}

function updateApplicationSpeeds() {
    applications.forEach((app) => {
        if (app.active) {
            // Active: Apply Policy Caps (if applicable, otherwise default to full speed)
            const maxDownloadMbps = app.downloadCap;
            const maxUploadMbps = app.uploadCap;
            
            let newSpeedDownMBs = Math.min(maxDownloadMbps, maxDownloadMbps * 0.5 + (Math.random() * maxDownloadMbps * 0.4)) / 8;
            let newSpeedUpMBs = Math.min(maxUploadMbps, maxUploadMbps * 0.5 + (Math.random() * maxUploadMbps * 0.4)) / 8;

            let unitDown = 'MB/s';
            let unitUp = 'MB/s';
            
            if (newSpeedDownMBs < 1) { newSpeedDownMBs *= 1024; unitDown = 'KB/s'; }
            if (newSpeedUpMBs < 1) { newSpeedUpMBs *= 1024; unitUp = 'KB/s'; }

            app.speed = `${newSpeedDownMBs.toFixed(newSpeedDownMBs < 10 ? 1 : 0)} ${unitDown}`;
            app.uploadSpeed = `${newSpeedUpMBs.toFixed(newSpeedUpMBs < 10 ? 1 : 0)} ${unitUp}`;
            
        } else if (app.category === 'KILLED PROCESS') {
            // Killed Process: Truly zero traffic
            app.speed = "0 KB/s";
            app.uploadSpeed = "0 KB/s";
        } else {
            // Paused or Default Policy (Policy removed/disabled but app is running)
            // Revert to simulated default speeds.
            const DEFAULT_DL_RATE = Math.random() * 0.5 + 0.1; 
            const DEFAULT_UL_RATE = Math.random() * 0.1 + 0.05; 
            
            let newSpeedDownMBs = DEFAULT_DL_RATE;
            let newSpeedUpMBs = DEFAULT_UL_RATE;

            let unitDown = 'MB/s';
            let unitUp = 'MB/s';
            
            if (newSpeedDownMBs < 1) { newSpeedDownMBs *= 1024; unitDown = 'KB/s'; }
            if (newSpeedUpMBs < 1) { newSpeedUpMBs *= 1024; unitUp = 'KB/s'; }

            app.speed = `${newSpeedDownMBs.toFixed(newSpeedDownMBs < 10 ? 1 : 0)} ${unitDown}`;
            app.uploadSpeed = `${newSpeedUpMBs.toFixed(newSpeedUpMBs < 10 ? 1 : 0)} ${unitUp}`;
        }
    });
    renderApplications('dashboard');
    renderApplications('monitor');
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