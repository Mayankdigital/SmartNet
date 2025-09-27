// Global Application State
const appState = {
    activeProfile: 'work',
    networkHealth: 94,
    activeApps: [
        { name: 'Zoom', icon: '🎥', usage: 60, protocol: 'UDP', pid: 1234, download: 245, upload: 89 },
        { name: 'Chrome', icon: '🌐', usage: 30, protocol: 'TCP', pid: 5678, download: 1200, upload: 156 },
        { name: 'Spotify', icon: '🎵', usage: 15, protocol: 'TCP', pid: 9012, download: 320, upload: 12 },
        { name: 'Discord', icon: '💬', usage: 25, protocol: 'UDP', pid: 3456, download: 180, upload: 45 },
        { name: 'Steam', icon: '🎮', usage: 40, protocol: 'TCP', pid: 7890, download: 850, upload: 23 }
    ],
    processes: [],
    downloadQueue: [
        { name: 'Windows Update KB5028185', size: '1.2 GB', time: '02:00 AM', priority: 'HIGH' },
        { name: 'YouTube - Machine Learning Playlist', size: '3.8 GB', time: '01:30 AM', priority: 'MED' },
        { name: 'Steam Game Update - Cyberpunk 2077', size: '15.6 GB', time: '03:00 AM', priority: 'LOW' }
    ],
    profiles: [
        { name: 'Work Profile', icon: '💼', description: 'Optimized for video calls and productivity', active: true, apps: 8, bandwidth: '80%' },
        { name: 'Gaming Profile', icon: '🎮', description: 'Low latency for competitive gaming', active: false, apps: 12, bandwidth: '95%' },
        { name: 'Sleep Mode', icon: '🌙', description: 'Minimal background activity', active: false, apps: 2, bandwidth: '20%' },
        { name: 'Streaming Profile', icon: '📺', description: 'High bandwidth for media consumption', active: false, apps: 6, bandwidth: '90%' }
    ],
    recommendations: [
        { type: 'optimize', icon: '💡', title: 'Optimize Download Schedule', description: 'Move large downloads to 2-4 AM for 40% faster speeds' },
        { type: 'gaming', icon: '⚡', title: 'Enable Gaming Profile Auto-Switch', description: 'Detected gaming sessions at 8 PM - enable auto-optimization' },
        { type: 'priority', icon: '🔧', title: 'Reduce Spotify Priority', description: 'Lower bandwidth allocation could improve video call quality' }
    ],
    timer: null,
    timerEndTime: null
};

// DOM Elements
const elements = {
    navItems: document.querySelectorAll('.nav-item'),
    sections: document.querySelectorAll('.section'),
    killSwitch: document.getElementById('kill-switch'),
    profileSelector: document.getElementById('profile-selector'),
    healthPercentage: document.getElementById('health-percentage'),
    networkLatency: document.getElementById('network-latency'),
    activeAppsList: document.getElementById('active-apps-list'),
    processList: document.getElementById('process-list'),
    bandwidthAppsGrid: document.getElementById('bandwidth-apps-grid'),
    weeklySchedule: document.getElementById('weekly-schedule'),
    downloadQueue: document.getElementById('download-queue'),
    profilesContainer: document.getElementById('profiles-container'),
    protocolMatrix: document.querySelector('#protocol-matrix tbody'),
    switchHistory: document.getElementById('switch-history'),
    aiRecommendations: document.getElementById('ai-recommendations'),
    activeTimer: document.getElementById('active-timer'),
    timerCountdown: document.getElementById('timer-countdown'),
    appPerformanceList: document.getElementById('app-performance-list')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', function() {
    initializeNavigation();
    initializeComponents();
    startRealTimeUpdates();
    setupEventListeners();
    
    console.log('🚀 Adaptive Network Scheduler initialized successfully!');
});

// Navigation System
function initializeNavigation() {
    elements.navItems.forEach(item => {
        item.addEventListener('click', () => {
            // Remove active class from all nav items and sections
            elements.navItems.forEach(nav => nav.classList.remove('active'));
            elements.sections.forEach(section => section.classList.remove('active'));
            
            // Add active class to clicked nav item
            item.classList.add('active');
            
            // Show corresponding section
            const sectionId = item.getAttribute('data-section');
            const targetSection = document.getElementById(sectionId);
            if (targetSection) {
                targetSection.classList.add('active');
                
                // Load section-specific content
                loadSectionContent(sectionId);
            }
        });
    });
}

// Load Section Content
function loadSectionContent(sectionId) {
    switch(sectionId) {
        case 'dashboard':
            updateDashboard();
            break;
        case 'monitor':
            updateMonitor();
            break;
        case 'bandwidth':
            updateBandwidthManager();
            break;
        case 'protocol':
            updateProtocolEngine();
            break;
        case 'scheduler':
            updateScheduler();
            break;
        case 'prefetch':
            updatePrefetchQueue();
            break;
        case 'profiles':
            updateProfiles();
            break;
        case 'analytics':
            updateAnalytics();
            break;
    }
}

// Dashboard Updates
function updateDashboard() {
    // Update network health
    if (elements.healthPercentage) {
        elements.healthPercentage.textContent = `${appState.networkHealth}%`;
    }
    
    // Update active apps list
    if (elements.activeAppsList) {
        elements.activeAppsList.innerHTML = appState.activeApps.slice(0, 3).map(app => `
            <div class="app-item">
                <div class="app-info">
                    <div class="app-icon">${app.icon}</div>
                    <span>${app.name}</span>
                </div>
                <div class="bandwidth-bar">
                    <div class="bandwidth-fill" style="width: ${app.usage}%;"></div>
                </div>
            </div>
        `).join('');
    }
    
    // Update stats
    updateDashboardStats();
}

function updateDashboardStats() {
    const stats = {
        'data-used': `${(Math.random() * 5 + 1).toFixed(1)} GB`,
        'time-saved': `${Math.floor(Math.random() * 60 + 30)} min`,
        'apps-managed': appState.activeApps.length,
        'profile-switches': Math.floor(Math.random() * 5 + 1)
    };
    
    Object.entries(stats).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    });
}

// Monitor Updates
function updateMonitor() {
    if (elements.processList) {
        elements.processList.innerHTML = appState.activeApps.map(app => `
            <div class="process-item">
                <div class="app-info">
                    <div class="app-icon">${app.icon}</div>
                    <div>
                        <div>${app.name}.exe</div>
                        <div style="font-size: 12px; color: #888;">PID: ${app.pid}</div>
                    </div>
                </div>
                <div style="text-align: right;">
                    <span class="protocol-badge protocol-${app.protocol.toLowerCase()}">${app.protocol}</span>
                    <div style="font-size: 12px; margin-top: 5px;">
                        ↓ ${app.download} KB/s ↑ ${app.upload} KB/s
                    </div>
                </div>
            </div>
        `).join('');
    }
}

// Bandwidth Manager Updates
function updateBandwidthManager() {
    if (elements.bandwidthAppsGrid) {
        elements.bandwidthAppsGrid.innerHTML = appState.activeApps.map((app, index) => `
            <div class="app-card">
                <div class="app-header">
                    <div class="app-icon-large">${app.icon}</div>
                    <div>
                        <h4>${app.name}</h4>
                        <span style="font-size: 12px; color: #888;">${getAppCategory(app.name)}</span>
                    </div>
                </div>
                
                <div class="slider-container">
                    <div class="slider-label">
                        <span>Download Limit</span>
                        <span class="download-value">${(app.download / 100).toFixed(1)} MB/s</span>
                    </div>
                    <input type="range" class="slider download-slider" min="0" max="100" value="${app.usage}" data-app="${index}">
                </div>
                
                <div class="slider-container">
                    <div class="slider-label">
                        <span>Upload Limit</span>
                        <span class="upload-value">${(app.upload / 100).toFixed(1)} MB/s</span>
                    </div>
                    <input type="range" class="slider upload-slider" min="0" max="100" value="${Math.floor(app.usage * 0.6)}" data-app="${index}">
                </div>
                
                <select class="priority-select" data-app="${index}">
                    <option value="critical">Critical Priority</option>
                    <option value="high">High Priority</option>
                    <option value="normal" ${app.name === 'Chrome' ? 'selected' : ''}>Normal Priority</option>
                    <option value="low" ${app.name === 'Spotify' ? 'selected' : ''}>Low Priority</option>
                    <option value="blocked">Blocked</option>
                </select>
            </div>
        `).join('');
        
        // Add event listeners for sliders
        setupSliderListeners();
    }
}

// Protocol Engine Updates
function updateProtocolEngine() {
    if (elements.protocolMatrix) {
        elements.protocolMatrix.innerHTML = appState.activeApps.slice(0, 3).map(app => `
            <tr>
                <td>${app.name}</td>
                <td><span class="protocol-badge protocol-${app.protocol.toLowerCase()}">${app.protocol}</span></td>
                <td>${app.protocol === 'UDP' ? 'TCP' : 'HTTP/3'}</td>
                <td>${getProtocolReason(app.name, app.protocol)}</td>
            </tr>
        `).join('');
    }
    
    if (elements.switchHistory) {
        const switches = [
            { time: '14:23:45', app: 'Zoom', change: 'UDP → TCP', reason: 'High packet loss detected', color: '#ff6600' },
            { time: '14:20:12', app: 'Chrome', change: 'enabled HTTP/3', reason: 'Network stable', color: '#00ff00' },
            { time: '14:15:33', app: 'Gaming app', change: 'TCP → UDP', reason: 'Low latency mode', color: '#00f5ff' }
        ];
        
        elements.switchHistory.innerHTML = switches.map(s => `
            <div class="history-item">
                <span>${s.time} - ${s.app} ${s.change}</span>
                <span class="history-reason" style="color: ${s.color};">${s.reason}</span>
            </div>
        `).join('');
    }
    
    updateNetworkConditions();
}

function updateNetworkConditions() {
    const conditions = {
        latency: { value: Math.floor(Math.random() * 20 + 10), unit: 'ms', color: '#00ff00' },
        jitter: { value: Math.floor(Math.random() * 5 + 1), unit: 'ms', color: '#ffff00' },
        loss: { value: (Math.random() * 0.5).toFixed(1), unit: '%', color: '#00ff00' },
        stability: { value: 'Excellent', unit: '', color: '#00ff00' }
    };
    
    Object.entries(conditions).forEach(([key, data]) => {
        const valueElement = document.getElementById(`condition-${key}`);
        const barElement = document.getElementById(`${key}-bar`);
        
        if (valueElement) {
            valueElement.textContent = `${data.value}${data.unit}`;
            valueElement.style.color = data.color;
        }
        
        if (barElement) {
            const percentage = key === 'stability' ? 90 : Math.max(10, 100 - parseFloat(data.value) * 10);
            barElement.style.width = `${percentage}%`;
        }
    });
}

// Scheduler Updates
function updateScheduler() {
    if (elements.weeklySchedule) {
        generateWeeklySchedule();
    }
}

function generateWeeklySchedule() {
    if (!elements.weeklySchedule) return;
    
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    let scheduleHTML = '<div class="time-header"></div>';
    
    // Time headers
    for (let hour = 0; hour < 24; hour++) {
        scheduleHTML += `<div class="time-header">${hour.toString().padStart(2, '0')}</div>`;
    }
    
    // Days and time blocks
    days.forEach(day => {
        scheduleHTML += `<div class="time-header">${day}</div>`;
        for (let hour = 0; hour < 24; hour++) {
            const isActive = (hour >= 6 && hour <= 23) && day !== 'Sat' && day !== 'Sun' ? hour < 22 : hour >= 8 && hour <= 20;
            scheduleHTML += `<div class="schedule-block ${isActive ? 'active' : ''}" data-day="${day}" data-hour="${hour}"></div>`;
        }
    });
    
    elements.weeklySchedule.innerHTML = scheduleHTML;
    
    // Add click listeners
    document.querySelectorAll('.schedule-block').forEach(block => {
        block.addEventListener('click', () => {
            block.classList.toggle('active');
        });
    });
}

// Prefetch Queue Updates
function updatePrefetchQueue() {
    if (elements.downloadQueue) {
        elements.downloadQueue.innerHTML = appState.downloadQueue.map((item, index) => `
            <div class="download-item">
                <div class="download-info">
                    <h4>${item.name}</h4>
                    <div class="download-details">Size: ${item.size} • Scheduled: ${item.time}</div>
                </div>
                <div class="download-actions">
                    <span class="priority-badge priority-${item.priority.toLowerCase()}">${item.priority}</span>
                    <button style="background: none; border: none; color: #888; cursor: pointer;" onclick="removeDownload(${index})">⋮</button>
                </div>
            </div>
        `).join('');
    }
    
    if (elements.aiRecommendations) {
        elements.aiRecommendations.innerHTML = appState.recommendations.map(rec => `
            <div class="recommendation-item recommendation-${rec.type}">
                <div class="recommendation-icon">${rec.icon}</div>
                <div class="recommendation-content">
                    <h5>${rec.title}</h5>
                    <p>${rec.description}</p>
                </div>
            </div>
        `).join('');
    }
}

// Profiles Updates
function updateProfiles() {
    if (elements.profilesContainer) {
        elements.profilesContainer.innerHTML = appState.profiles.map((profile, index) => `
            <div class="profile-card ${profile.active ? 'active' : ''}" data-profile="${index}">
                <div class="profile-icon">${profile.icon}</div>
                <div class="profile-name">${profile.name}</div>
                <div class="profile-description">${profile.description}</div>
                <div class="profile-stats">
                    <div class="profile-stat">Apps: ${profile.apps}</div>
                    <div class="profile-stat">Bandwidth: ${profile.bandwidth}</div>
                </div>
                <button class="action-btn profile-btn" data-profile="${index}">
                    ${profile.active ? 'Currently Active' : 'Switch Profile'}
                </button>
            </div>
        `).join('');
        
        // Add profile switch listeners
        setupProfileListeners();
    }
}

// Analytics Updates
function updateAnalytics() {
    if (elements.appPerformanceList) {
        elements.appPerformanceList.innerHTML = appState.activeApps.map(app => `
            <div class="app-performance-item">
                <div class="performance-info">
                    <div class="app-icon">${app.icon}</div>
                    <div>
                        <div style="font-weight: 600;">${app.name}</div>
                        <div style="font-size: 12px; color: #888;">${getAppCategory(app.name)}</div>
                    </div>
                </div>
                <div class="performance-metrics-analytics">
                    <div class="performance-metric">
                        <div class="metric-value-small">${Math.floor(Math.random() * 30 + 10)}%</div>
                        <div class="metric-label-small">Improvement</div>
                    </div>
                    <div class="performance-metric">
                        <div class="metric-value-small">${Math.floor(Math.random() * 50 + 20)}ms</div>
                        <div class="metric-label-small">Avg Latency</div>
                    </div>
                    <div class="performance-metric">
                        <div class="metric-value-small">${(Math.random() * 2 + 0.5).toFixed(1)}GB</div>
                        <div class="metric-label-small">Data Used</div>
                    </div>
                </div>
            </div>
        `).join('');
    }
}

// Event Listeners Setup
function setupEventListeners() {
    // Kill switch
    if (elements.killSwitch) {
        elements.killSwitch.addEventListener('click', handleKillSwitch);
    }
    
    // Profile selector
    if (elements.profileSelector) {
        elements.profileSelector.addEventListener('change', handleProfileChange);
    }
    
    // Quick action buttons
    document.querySelectorAll('.action-btn').forEach(btn => {
        if (btn.dataset.action) {
            btn.addEventListener('click', () => handleQuickAction(btn.dataset.action));
        }
        if (btn.dataset.timer) {
            btn.addEventListener('click', () => handleTimerAction(btn.dataset.timer));
        }
    });
    
    // Add download button
    const addDownloadBtn = document.getElementById('add-download');
    if (addDownloadBtn) {
        addDownloadBtn.addEventListener('click', handleAddDownload);
    }
    
    // Sleep settings
    setupSleepSettings();
}

function setupSliderListeners() {
    document.querySelectorAll('.download-slider').forEach(slider => {
        slider.addEventListener('input', (e) => {
            const appIndex = parseInt(e.target.dataset.app);
            const value = parseInt(e.target.value);
            const valueSpan = e.target.parentNode.querySelector('.download-value');
            if (valueSpan) {
                valueSpan.textContent = `${(value * 50 / 100).toFixed(1)} MB/s`;
            }
            appState.activeApps[appIndex].usage = value;
        });
    });
    
    document.querySelectorAll('.upload-slider').forEach(slider => {
        slider.addEventListener('input', (e) => {
            const appIndex = parseInt(e.target.dataset.app);
            const value = parseInt(e.target.value);
            const valueSpan = e.target.parentNode.querySelector('.upload-value');
            if (valueSpan) {
                valueSpan.textContent = `${(value * 20 / 100).toFixed(1)} MB/s`;
            }
            appState.activeApps[appIndex].upload = value * 2;
        });
    });
    
    document.querySelectorAll('.priority-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const appIndex = parseInt(e.target.dataset.app);
            const priority = e.target.value;
            // Update app priority logic here
            showNotification(`${appState.activeApps[appIndex].name} priority changed to ${priority}`);
        });
    });
}

function setupProfileListeners() {
    document.querySelectorAll('.profile-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const profileIndex = parseInt(e.target.dataset.profile);
            switchProfile(profileIndex);
        });
    });
}

function setupSleepSettings() {
    const bedtimeInput = document.getElementById('bedtime');
    const wakeTimeInput = document.getElementById('wake-time');
    const autoCutoffCheck = document.getElementById('auto-cutoff');
    const allowUpdatesCheck = document.getElementById('allow-updates');
    const blockSocialCheck = document.getElementById('block-social');
    
    [bedtimeInput, wakeTimeInput, autoCutoffCheck, allowUpdatesCheck, blockSocialCheck].forEach(input => {
        if (input) {
            input.addEventListener('change', () => {
                showNotification('Sleep settings updated');
            });
        }
    });
}

// Action Handlers
function handleKillSwitch() {
    const confirmed = confirm('Are you sure you want to kill all network connections?');
    if (confirmed) {
        showNotification('All network connections terminated', 'warning');
        // Simulate network shutdown
        appState.networkHealth = 0;
        appState.activeApps = [];
        updateDashboard();
        updateMonitor();
    }
}

function handleProfileChange(e) {
    const newProfile = e.target.value;
    appState.activeProfile = newProfile;
    showNotification(`Switched to ${newProfile} profile`);
    
    // Update profile-specific settings
    updateProfileSettings(newProfile);
}

function handleQuickAction(action) {
    const actions = {
        gaming: () => {
            appState.activeProfile = 'gaming';
            elements.profileSelector.value = 'gaming';
            showNotification('Gaming mode activated');
        },
        work: () => {
            appState.activeProfile = 'work';
            elements.profileSelector.value = 'work';
            showNotification('Work mode activated');
        },
        sleep: () => {
            handleTimerAction('480'); // 8 hours
        },
        boost: () => {
            showNotification('Priority boost applied to active applications');
        }
    };
    
    if (actions[action]) {
        actions[action]();
    }
}

function handleTimerAction(duration) {
    if (appState.timer) {
        clearInterval(appState.timer);
    }
    
    let minutes;
    if (duration === 'until-6am') {
        const now = new Date();
        const tomorrow6am = new Date(now);
        tomorrow6am.setDate(tomorrow6am.getDate() + 1);
        tomorrow6am.setHours(6, 0, 0, 0);
        minutes = Math.floor((tomorrow6am - now) / (1000 * 60));
    } else {
        minutes = parseInt(duration);
    }
    
    startTimer(minutes);
    showNotification(`Sleep timer set for ${formatTime(minutes)}`);
}

function handleAddDownload() {
    const newDownload = {
        name: 'New Download Task',
        size: `${(Math.random() * 10 + 1).toFixed(1)} GB`,
        time: '03:30 AM',
        priority: 'MED'
    };
    
    appState.downloadQueue.push(newDownload);
    updatePrefetchQueue();
    showNotification('Download added to queue');
}

function switchProfile(profileIndex) {
    // Deactivate all profiles
    appState.profiles.forEach(profile => profile.active = false);
    
    // Activate selected profile
    appState.profiles[profileIndex].active = true;
    appState.activeProfile = appState.profiles[profileIndex].name.toLowerCase().replace(' profile', '');
    
    updateProfiles();
    showNotification(`Switched to ${appState.profiles[profileIndex].name}`);
}

function removeDownload(index) {
    appState.downloadQueue.splice(index, 1);
    updatePrefetchQueue();
    showNotification('Download removed from queue');
}

// Timer Functions
function startTimer(minutes) {
    appState.timerEndTime = new Date(Date.now() + minutes * 60000);
    
    if (elements.activeTimer) {
        elements.activeTimer.classList.add('visible');
    }
    
    appState.timer = setInterval(() => {
        const remaining = Math.max(0, Math.floor((appState.timerEndTime - new Date()) / 1000));
        
        if (remaining === 0) {
            clearInterval(appState.timer);
            appState.timer = null;
            if (elements.activeTimer) {
                elements.activeTimer.classList.remove('visible');
            }
            showNotification('Sleep timer completed - Network disabled', 'info');
            return;
        }
        
        if (elements.timerCountdown) {
            elements.timerCountdown.textContent = formatSeconds(remaining);
        }
    }, 1000);
}

function formatTime(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
        return `${hours}h ${mins}m`;
    }
    return `${mins} minutes`;
}

function formatSeconds(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Real-time Updates
function startRealTimeUpdates() {
    // Update network stats every 3 seconds
    setInterval(() => {
        updateNetworkStats();
        updateBandwidthData();
    }, 3000);
    
    // Update process data every 5 seconds
    setInterval(() => {
        updateProcessData();
    }, 5000);
}

function updateNetworkStats() {
    // Simulate network health fluctuations
    appState.networkHealth = Math.max(85, Math.min(98, appState.networkHealth + (Math.random() - 0.5) * 4));
    
    if (elements.healthPercentage) {
        elements.healthPercentage.textContent = `${Math.floor(appState.networkHealth)}%`;
    }
    
    // Update latency display
    const latency = Math.floor(Math.random() * 30 + 10);
    if (elements.networkLatency) {
        elements.networkLatency.textContent = `Online • ${latency}ms`;
    }
    
    // Update health stats
    const latencyStat = document.getElementById('latency-stat');
    const jitterStat = document.getElementById('jitter-stat');
    const lossStat = document.getElementById('loss-stat');
    
    if (latencyStat) latencyStat.textContent = `${latency}ms`;
    if (jitterStat) jitterStat.textContent = `${Math.floor(Math.random() * 5 + 1)}ms`;
    if (lossStat) lossStat.textContent = `${(Math.random() * 0.5).toFixed(1)}%`;
}

function updateBandwidthData() {
    // Simulate bandwidth usage changes
    appState.activeApps.forEach(app => {
        app.download = Math.max(10, app.download + (Math.random() - 0.5) * 100);
        app.upload = Math.max(5, app.upload + (Math.random() - 0.5) * 20);
        app.usage = Math.max(5, Math.min(95, app.usage + (Math.random() - 0.5) * 10));
    });
    
    // Update bandwidth bars
    document.querySelectorAll('.bandwidth-fill').forEach(bar => {
        const randomWidth = Math.floor(Math.random() * 80) + 10;
        bar.style.width = randomWidth + '%';
    });
}

function updateProcessData() {
    // Update process list if monitor is active
    const activeSection = document.querySelector('.section.active');
    if (activeSection && activeSection.id === 'monitor') {
        updateMonitor();
    }
}

// Utility Functions
function getAppCategory(appName) {
    const categories = {
        'Zoom': 'Video Conferencing',
        'Chrome': 'Web Browser',
        'Spotify': 'Music Streaming',
        'Discord': 'Communication',
        'Steam': 'Gaming Platform'
    };
    return categories[appName] || 'Application';
}

function getProtocolReason(appName, protocol) {
    const reasons = {
        'Zoom': protocol === 'UDP' ? 'Low latency required' : 'Network congestion',
        'Chrome': protocol === 'TCP' ? 'Reliability needed' : 'HTTP/3 optimization',
        'Spotify': 'Music streaming optimization',
        'Discord': 'Voice chat optimization',
        'Steam': 'Large file transfer'
    };
    return reasons[appName] || 'Automatic optimization';
}

function updateProfileSettings(profile) {
    // Simulate profile-specific optimizations
    const profileSettings = {
        work: {
            zoom: { priority: 'high', bandwidth: 80 },
            chrome: { priority: 'normal', bandwidth: 60 }
        },
        gaming: {
            steam: { priority: 'critical', bandwidth: 95 },
            discord: { priority: 'high', bandwidth: 70 }
        },
        sleep: {
            all: { priority: 'low', bandwidth: 20 }
        }
    };
    
    // Apply settings based on profile
    if (profileSettings[profile]) {
        showNotification(`${profile} profile optimizations applied`);
    }
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        background: rgba(0, 245, 255, 0.9);
        color: #000;
        padding: 12px 20px;
        border-radius: 8px;
        font-weight: 600;
        z-index: 10000;
        animation: slideInRight 0.3s ease;
    `;
    
    if (type === 'warning') {
        notification.style.background = 'rgba(255, 0, 64, 0.9)';
        notification.style.color = '#fff';
    }
    
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

// Initialize Components
function initializeComponents() {
    // Load initial data
    updateDashboard();
    
    // Add CSS animations
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOutRight {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
    `;
    document.head.appendChild(style);
}

// Export functions for global access
window.removeDownload = removeDownload;

console.log('📊 Network Scheduler JavaScript loaded successfully!');