// Global chart instances
let speedChart = null;
let deviceChart = null;
let forecastChart = null; // NEW: Forecast chart
let lastDeviceList = [];

// Global state
let currentDevice = null;
let dataUsagePeriod = '24h';
let socket = null;
let currentHotspotSSID = "MyBandwidthManager";
let isToggleProcessing = false;

// Scheduler state
let currentScheduleId = null;
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let schedules = []; // This will hold the schedules fetched from backend
let currentFilter = 'all';

// --- NEW: Security State (with ipBlockList) ---
let currentSecurityState = {
    isolation: false,
    acMode: 'allow_all',
    blockList: [],
    allowList: [],
    ipBlockList: [] // <-- ADDED
};

// -------------------------------------------------------------------
// HELPER FUNCTIONS
// -------------------------------------------------------------------
function formatSpeed(bytesPerSecond) { if (typeof bytesPerSecond !== 'number' || bytesPerSecond < 0) return "0 Kbps"; const kbits = (bytesPerSecond * 8) / 1000; return kbits < 1000 ? `${kbits.toFixed(0)} Kbps` : `${(kbits / 1000).toFixed(2)} Mbps`; }
function formatBytes(bytes) { if (typeof bytes !== 'number' || bytes < 0) return "0.0 MB"; const megabytes = bytes / 1048576; return megabytes < 1024 ? `${megabytes.toFixed(1)} MB` : `${(megabytes / 1024).toFixed(2)} GB`; }
function formatBytesFromMB(mb) { if (typeof mb !== 'number' || mb < 0) return "0.0 MB"; return mb < 1024 ? `${mb.toFixed(1)} MB` : `${(mb / 1024).toFixed(2)} GB`; } // Helper for schedule display
function formatSeconds(seconds) { if (seconds == null || seconds < 0) return "-"; seconds = Math.round(seconds); const days = Math.floor(seconds / 86400); seconds %= 86400; const hours = Math.floor(seconds / 3600); seconds %= 3600; const minutes = Math.floor(seconds / 60); let parts = []; if (days > 0) parts.push(`${days}d`); if (hours > 0) parts.push(`${hours}h`); if (minutes > 0 || (days === 0 && hours === 0)) parts.push(`${minutes}m`); return parts.length > 0 ? parts.join(" ") : "0m"; }
function showNotification(message, status = 'success') { const notification = document.createElement('div'); let gradient = 'linear-gradient(135deg, var(--success) 0%, #059669 100%)'; let shadow = 'rgba(16, 185, 129, 0.3)'; if (status === 'error') { gradient = 'linear-gradient(135deg, var(--danger) 0%, #B91C1C 100%)'; shadow = 'rgba(239, 68, 68, 0.3)'; } notification.style.cssText = `position: fixed; top: 90px; right: 32px; background: ${gradient}; color: white; padding: 16px 24px; border-radius: 12px; box-shadow: 0 8px 24px ${shadow}; z-index: 1001; animation: slideInRight 0.3s ease-out; font-weight: 500;`; notification.textContent = message; document.body.appendChild(notification); setTimeout(() => { notification.style.animation = 'slideOutRight 0.3s ease-out'; setTimeout(() => notification.remove(), 300); }, 3000); }

// -------------------------------------------------------------------
// CHART INITIALIZATION
// -------------------------------------------------------------------
function initCharts() {
    const speedCtx = document.getElementById('speedChart')?.getContext('2d');
    const deviceCtx = document.getElementById('deviceChart')?.getContext('2d');
    const forecastCtx = document.getElementById('forecastChart')?.getContext('2d'); // NEW

    if (speedCtx) {
        speedChart = new Chart(speedCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    { label: 'Download', data: [], borderColor: '#06b6d4', backgroundColor: 'rgba(6, 182, 212, 0.1)', tension: 0.4, fill: true, pointRadius: 0, borderWidth: 2 },
                    { label: 'Upload', data: [], borderColor: '#8b5cf6', backgroundColor: 'rgba(139, 92, 246, 0.1)', tension: 0.4, fill: true, pointRadius: 0, borderWidth: 2 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: 'index' },
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y.toFixed(2)} Mbps` } } },
                scales: { y: { beginAtZero: true, ticks: { callback: (v) => v + ' Mbps' } }, x: { grid: { display: false } } }
            }
        });
    }

    if (deviceCtx) {
        deviceChart = new Chart(deviceCtx, {
            type: 'doughnut',
            data: {
                labels: [],
                datasets: [{ data: [], backgroundColor: ['#06b6d4', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'], borderWidth: 0, hoverOffset: 10 }]
            },
            options: {
                responsive: true, 
                maintainAspectRatio: true,
                aspectRatio: 1,
                layout: {
                    padding: 10
                },
                plugins: {
                    legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 10 } },
                    tooltip: {
                        callbacks: {
                            label: (c) => {
                                const vMB = c.parsed || 0; const vB = vMB * 1048576;
                                const tMB = c.dataset.data.reduce((a, b) => a + b, 0);
                                const p = tMB === 0 ? 0 : ((vMB / tMB) * 100);
                                return `${c.label}: ${formatBytes(vB)} (${p.toFixed(1)}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    // --- NEW: Initialize Forecast Chart ---
    if (forecastCtx) {
        forecastChart = new Chart(forecastCtx, {
            type: 'line',
            data: {
                labels: [], // Will be timestamps, e.g., "14:00", "14:15"
                datasets: [
                    {
                        label: 'Predicted Usage',
                        data: [],
                        borderColor: '#f59e0b', // Orange
                        tension: 0.4,
                        fill: false,
                        pointRadius: 0,
                        borderWidth: 2,
                        borderDash: [5, 5]
                    },
                    {
                        label: 'Confidence (Upper)',
                        data: [],
                        borderColor: 'rgba(245, 158, 11, 0.2)',
                        tension: 0.4,
                        fill: false,
                        pointRadius: 0,
                        borderWidth: 1
                    },
                    {
                        label: 'Confidence (Lower)',
                        data: [],
                        borderColor: 'rgba(245, 158, 11, 0.2)',
                        tension: 0.4,
                        fill: '-1', // Fill to the dataset at index 1 (Upper)
                        backgroundColor: 'rgba(245, 158, 11, 0.1)',
                        pointRadius: 0,
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: 'index' },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (c) => {
                                if (c.dataset.label.startsWith('Confidence')) return null;
                                return `${c.dataset.label}: ${c.parsed.y.toFixed(2)} Mbps (avg)`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { callback: (v) => v + ' Mbps' }
                    },
                    x: {
                        grid: { display: false }
                    }
                }
            }
        });
    }
}

// -------------------------------------------------------------------
// DATA RENDERING
// -------------------------------------------------------------------

function updateDashboardData(data) {
    // --- Update Status Bar ---
    const indicator = document.getElementById('hotspot-indicator'); const statusText = document.getElementById('hotspot-status-text'); const toggle = document.getElementById('hotspot-toggle'); const warningMessage = document.querySelector('#hotspotSettingsModal .info-message');

    if (indicator && statusText && toggle) { const isBackendOn = (data.hotspot_status === "ON"); if (isBackendOn) { currentHotspotSSID = data.hotspot_ssid || "Hotspot"; indicator.classList.add('active'); statusText.textContent = `Hotspot: ON (${currentHotspotSSID})`; statusText.style.color = 'var(--success)'; if (warningMessage) warningMessage.style.display = 'flex'; } else { currentHotspotSSID = "Hotspot"; indicator.classList.remove('active'); statusText.textContent = 'Hotspot: OFF'; statusText.style.color = 'var(--text-primary)'; if (warningMessage) warningMessage.style.display = 'none'; } if (toggle.checked !== isBackendOn) { toggle.checked = isBackendOn; } if (toggle.disabled) { toggle.disabled = false; } isToggleProcessing = false; }
    const currentSsidElement = document.getElementById('current-ssid'); if (currentSsidElement) currentSsidElement.textContent = currentHotspotSSID;

    // --- Update Stat Cards ---
    const dlSpeedEl = document.getElementById('download-speed'); const ulSpeedEl = document.getElementById('upload-speed'); const deviceCountEl = document.getElementById('device-count'); const dataUsageEl = document.getElementById('data-usage'); if (dlSpeedEl) dlSpeedEl.textContent = data.total_download_speed || "-"; if (ulSpeedEl) ulSpeedEl.textContent = data.total_upload_speed || "-"; if (deviceCountEl) deviceCountEl.textContent = data.device_count || "0"; if (dataUsageEl) dataUsageEl.textContent = data.total_data_usage || "0.0 MB";

    // --- Update Device List & Table ---
    const previousDeviceList = lastDeviceList; // Keep track for comparison
    lastDeviceList = data.devices || [];

    // Only re-render if the device list actually changed (avoids flickering)
    if (JSON.stringify(previousDeviceList) !== JSON.stringify(lastDeviceList)) {
        const searchFilter = document.getElementById('device-search')?.value || '';
        renderDevices(lastDeviceList, searchFilter);

        // --- MODIFIED: Update other device lists ---
        if (document.getElementById('scheduler-page')?.classList.contains('active')) {
            populateDeviceDropdown();
        }
        // Update security page device list if it's active
        if (document.getElementById('security-page')?.classList.contains('active')) {
             renderSecurityDeviceList(lastDeviceList, currentSecurityState);
        }
    }

    // --- Update Charts ---
    if (speedChart && data.timestamp && data.total_download_mbps != null) { const { labels, datasets } = speedChart.data; labels.push(data.timestamp); datasets[0].data.push(data.total_download_mbps); datasets[1].data.push(data.total_upload_mbps); if (labels.length > 20) { labels.shift(); datasets[0].data.shift(); datasets[1].data.shift(); } speedChart.update('none'); }
    if (deviceChart) { const onlineDevices = lastDeviceList.filter(d => d.status === 'online'); deviceChart.data.labels = onlineDevices.map(d => d.hostname || 'Unknown'); deviceChart.data.datasets[0].data = onlineDevices.map(d => (d.sessionData_Bytes || 0) / 1048576); deviceChart.update('none'); }
}

function renderDevices(devicesData, filterText = '') {
    const tbody = document.getElementById('devices-tbody');
    if (!tbody || !devicesData) return;

    const searchLower = filterText.toLowerCase();
    const filteredDevices = devicesData.filter(device => {
    if (!filterText) return true;
    return device.ip?.includes(searchLower) ||
            (device.hostname && device.hostname.toLowerCase().includes(searchLower)) ||
            (device.mac && device.mac.toLowerCase().includes(searchLower));
    });

    tbody.innerHTML = filteredDevices.map(device => {
    const statusClass = device.status === 'online' ? 'online' : 'offline';
    const statusText = device.status === 'online' ? 'Online' : 'Offline';
    const priority = device.priority ?? 7;
    
    const limitDisabled = device.hasLimit ? '' : 'disabled';
    const quotaDisabled = device.hasQuota ? '' : 'disabled';
    
    const trashIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;

    // Determine tooltip text based on if quota is active and throttled
    let quotaTooltip = 'Set quota';
    if (device.hasQuota) {
        // --- FIX was here ---
        quotaTooltip = `Quota: ↓${formatBytes(device.quota_dl_used_bytes ?? 0)}/${formatBytes(device.quota_dl_limit_bytes)} | ↑${formatBytes(device.quota_ul_used_bytes ?? 0)}/${formatBytes(device.quota_ul_limit_bytes)} (${formatSeconds(device.quota_time_left_seconds)})`;
        // --- End of FIX ---
        if (device.quota_status_str === "🚫 Throttled") {
            quotaTooltip += " - THROTTLED";
        }
    }
    const limitTooltip = device.hasLimit ? `Limit: ↓${device.limit_dl_kbps}k ↑${device.limit_ul_kbps}k P${device.priority}` : 'Set limit';

    // --- *** START MODIFICATION *** ---
    let actionsHtml = '';
    let removeHtml = '';

    if (device.active_schedule_id != null) {
        // A schedule is active. Show a disabled badge.
        actionsHtml = `
            <div class="actions-cell">
                <span class="action-btn-scheduled" title="This device is being managed by schedule ID ${device.active_schedule_id}">
                    On Schedule
                </span>
            </div>
        `;
        // Also disable remove buttons
        removeHtml = `
            <div class="actions-cell">
                <button class="btn-remove" title="Remove Limit" disabled>
                    ${trashIcon}
                </button>
                <button class="btn-remove" title="Remove Quota" disabled>
                    ${trashIcon}
                </button>
            </div>
        `;

    } else {
        // No schedule is active. Show normal buttons.
        actionsHtml = `
            <div class="actions-cell">
                <button class="action-btn ${device.hasLimit ? 'active' : ''}" onclick="openLimitModal('${device.id}')">
                    ${device.hasLimit ? '<span class="checkmark">✓</span>' : ''} Limit
                    <span class="tooltip">${limitTooltip}</span>
                </button>
                <button class="action-btn ${device.hasQuota ? 'active' : ''} ${device.quota_status_str === "🚫 Throttled" ? 'throttled' : ''}" onclick="openQuotaModal('${device.id}')">
                    ${device.hasQuota ? '<span class="checkmark">✓</span>' : ''} Quota
                    <span class="tooltip">${quotaTooltip}</span>
                </button>
            </div>
        `;
        
        removeHtml = `
            <div class="actions-cell">
                <button class="btn-remove" title="Remove Limit" onclick="removeLimit('${device.id}')" ${limitDisabled}>
                    ${trashIcon}
                </button>
                <button class="btn-remove" title="Remove Quota" onclick="removeQuota('${device.id}')" ${quotaDisabled}>
                    ${trashIcon}
                </button>
            </div>
        `;
    }
    // --- *** END MODIFICATION *** ---

    return `
    <tr data-device-id="${device.id}">
        <td><span class="status-badge ${statusClass}"><span class="status-dot"></span> ${statusText}</span></td>
        <td><span class="speed-text">${device.ip || '-'}</span></td>
        <td>${device.hostname || 'Unknown'}</td>
        <td><span class="speed-text">${device.mac || '-'}</span></td>
        <td><span class="speed-text">${formatSpeed(device.downloadSpeed_Bps)}</span></td>
        <td><span class="speed-text">${formatSpeed(device.uploadSpeed_Bps)}</span></td>
        <td>${formatBytes(device.sessionData_Bytes)}</td>
        <td><span class="priority-badge priority-${priority}">${priority}</span></td>
        <td>
            ${actionsHtml}
        </td>
        <td>
            ${removeHtml}
        </td>
    </tr>
    `}).join('');
}

// --- NEW: Render Forecast Chart Data ---
/**
* Renders the forecast data into the forecastChart.
* @param {Array} forecastData - Array of {timestamp, predicted_bytes, ...}
*/
function renderForecastChart(forecastData) {
    if (!forecastChart || !forecastData || forecastData.length === 0) {
        console.warn("Forecast chart or data not available.");
        return;
    }

    // Helper to convert bytes per 15-min interval to avg Mbps
    const aggregationSeconds = 15 * 60; // 900 seconds
    const convertToMbps = (bytes) => (bytes / aggregationSeconds) * 8 / 1000000;

    // Format labels to be human-readable times
    const labels = forecastData.map(d => {
        const date = new Date(d.timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    });

    const predictedData = forecastData.map(d => convertToMbps(d.predicted_bytes));
    const upperData = forecastData.map(d => convertToMbps(d.predicted_upper));
    const lowerData = forecastData.map(d => convertToMbps(d.predicted_lower));

    forecastChart.data.labels = labels;
    forecastChart.data.datasets[0].data = predictedData; // Predicted
    forecastChart.data.datasets[1].data = upperData;     // Upper
    forecastChart.data.datasets[2].data = lowerData;     // Lower

    forecastChart.update('none');
}


// -------------------------------------------------------------------
// WEBSOCKET CLIENT
// -------------------------------------------------------------------
function connectWebSocket() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsURL = `${wsProtocol}//${window.location.host}/ws/network/`;
    console.log('Connecting to WebSocket at:', wsURL);
    socket = new WebSocket(wsURL);

    socket.onopen = () => {
        console.log('WebSocket connected successfully.');
        // Request initial data when connection opens
        requestInitialData();
    };

    socket.onmessage = (event) => {
    try {
        const data = JSON.parse(event.data);

        // Check message type
        if (data.type === 'notification') {
            showNotification(data.message, data.status);
        } else if (data.type === 'schedules_list' || data.type === 'schedules.update') { 
            // Handle schedule list updates (both message types)
            console.log("Received schedules update:", data.schedules?.length, "schedules");
            schedules = data.schedules || [];
            renderCalendar();
            renderSchedulesList();
        } else if (data.type === 'devices_list' || data.type === 'devices.list') { 
            // Handle device list for dropdown (both message types)
            lastDeviceList = data.devices || [];
            populateDeviceDropdown();
        } else if (data.type === 'security_state_update') { 
            // --- Handle Security State (MODIFIED) ---
            currentSecurityState = {
                isolation: data.isolation,
                acMode: data.acMode,
                blockList: data.blockList || [],
                allowList: data.allowList || [],
                ipBlockList: data.ipBlockList || []
            };
            // Render the security page UI
            renderSecurityPage(currentSecurityState);
            // Re-render the device list on the security page
            renderSecurityDeviceList(lastDeviceList, currentSecurityState);
        } else if (data.type === 'forecast_data') { 
            renderForecastChart(data.forecast);
        }
        else { // Assume it's the regular dashboard update
            updateDashboardData(data);
        }
    } catch (e) {
        console.error("Failed to parse incoming WebSocket message:", event.data, e);
    }
    };

    socket.onclose = (event) => {
        console.error('WebSocket closed. Reconnecting in 3s.', event.reason);
        updateDashboardData({ hotspot_status: "OFF", hotspot_ssid: "", total_download_speed: "-", total_upload_speed: "-", device_count: "-", total_data_usage: "-", devices: [] });
        schedules = []; // Clear schedules on disconnect
        renderCalendar();
        renderSchedulesList();
        
        // --- NEW: Clear forecast data ---
        if (forecastChart) {
            forecastChart.data.labels = [];
            forecastChart.data.datasets[0].data = [];
            forecastChart.data.datasets[1].data = [];
            forecastChart.data.datasets[2].data = [];
            forecastChart.update();
        }
        
        // --- Clear security data (MODIFIED) ---
        currentSecurityState = { isolation: false, acMode: 'allow_all', blockList: [], allowList: [], ipBlockList: [] };
        renderSecurityPage(currentSecurityState);
        renderSecurityDeviceList(lastDeviceList, currentSecurityState);

        setTimeout(connectWebSocket, 3000);
    };

    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        socket.close(); // Triggers onclose, which handles reconnect
    };
}

// Function to request initial data
function requestInitialData() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        console.log("Requesting initial schedules, devices, security, and forecast data...");
        socket.send(JSON.stringify({ type: 'request_schedules' }));
        socket.send(JSON.stringify({ type: 'request_devices' }));
        socket.send(JSON.stringify({ type: 'request_security_state' }));
        socket.send(JSON.stringify({ type: 'request_forecast' }));
    }
}

// Function to request security data
function loadSecurityData() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        console.log("Requesting security state...");
        socket.send(JSON.stringify({ type: 'request_security_state' }));
        // Also refresh device list to populate the add list
        socket.send(JSON.stringify({ type: 'request_devices' })); 
    }
}

// -------------------------------------------------------------------
// SCHEDULER FUNCTIONS
// -------------------------------------------------------------------

function initScheduler() {
    renderCalendar();
    renderSchedulesList();
}

function loadSchedules() {
    if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'request_schedules' }));
    } else {
    console.warn("Cannot load schedules: WebSocket not open.");
    }
}

function renderCalendar() {
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    document.getElementById('calendar-month-year').textContent = `${monthNames[currentMonth]} ${currentYear}`;

    const firstDay = new Date(currentYear, currentMonth, 1).getDay(); // 0=Sun, 1=Mon...
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const today = new Date();

    const calendarDays = document.getElementById('calendar-days');
    if (!calendarDays) return;

    calendarDays.innerHTML = '';
    const totalCells = firstDay + daysInMonth;
    const rows = Math.ceil(totalCells / 7);
    calendarDays.style.gridTemplateRows = `repeat(${rows}, minmax(100px, 1fr))`;

    for (let i = 0; i < firstDay; i++) {
    calendarDays.insertAdjacentHTML('beforeend', '<div class="calendar-day empty"></div>');
    }

    for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday = today.getFullYear() === currentYear && today.getMonth() === currentMonth && today.getDate() === day;
    const daySchedules = getSchedulesForDate(dateStr);
    const dayCell = document.createElement('div');
    dayCell.className = 'calendar-day';
    if (isToday) dayCell.classList.add('today');
    dayCell.innerHTML = `
        <div class="day-number">${day}</div>
        ${daySchedules.length > 0 ? `<div class="day-indicators">${daySchedules.map(s => `<span class="schedule-indicator ${s.rule_type}" title="${s.name}"></span>`).join('')}</div>` : ''}
    `;
    dayCell.onclick = () => showDaySchedules(dateStr);
    calendarDays.appendChild(dayCell);
    }

    const remainingCells = (rows * 7) - totalCells;
    for (let i = 0; i < remainingCells; i++) {
    calendarDays.insertAdjacentHTML('beforeend', '<div class="calendar-day empty"></div>');
    }
}

function getSchedulesForDate(dateStr) {
    const date = new Date(dateStr + 'T00:00:00');
    const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday

    return schedules.filter(schedule => {
    if (!schedule.is_enabled) return false;
    const scheduleStartDate = schedule.start_date ? new Date(schedule.start_date + 'T00:00:00') : null;
    const scheduleEndDate = schedule.end_date ? new Date(schedule.end_date + 'T00:00:00') : null;
    const checkDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const compareStartDate = scheduleStartDate ? new Date(scheduleStartDate.getFullYear(), scheduleStartDate.getMonth(), scheduleStartDate.getDate()) : null;
    const compareEndDate = scheduleEndDate ? new Date(scheduleEndDate.getFullYear(), scheduleEndDate.getMonth(), scheduleEndDate.getDate()) : null;
    if (compareStartDate && checkDate < compareStartDate) return false;
    if (compareEndDate && checkDate > compareEndDate) return false;
    const repeatMode = schedule.repeat_mode;
    if (repeatMode === 'once') {
        return compareStartDate && checkDate.getTime() === compareStartDate.getTime();
    } else if (repeatMode === 'daily') {
        return true;
    } else if (repeatMode === 'weekdays') {
        return dayOfWeek >= 1 && dayOfWeek <= 5;
    } else if (repeatMode === 'weekends') {
        return dayOfWeek === 0 || dayOfWeek === 6;
    } else if (repeatMode === 'custom') {
        return schedule.custom_days && schedule.custom_days.includes(dayOfWeek);
    }
    return false;
    });
}

function showDaySchedules(dateStr) {
    console.log(`Clicked on date: ${dateStr}`);
    const daySchedules = getSchedulesForDate(dateStr);
    if (daySchedules.length > 0) {
    showNotification(`${daySchedules.length} schedule(s) active on ${dateStr}`);
    } else {
    showNotification(`No schedules for ${dateStr}`, 'info');
    }
}

// --- NEW HELPER FUNCTION ---
/**
 * Checks if a schedule is currently active right now.
 * @param {object} schedule - The schedule object to check.
 * @returns {boolean} - True if the schedule is currently active, false otherwise.
 */
function isScheduleCurrentlyActive(schedule) {
    if (!schedule.is_enabled) {
        return false;
    }

    try {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth(); // 0-11
        const currentDay = now.getDate(); // 1-31
        const currentDayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat

        // Format current date as YYYY-MM-DD string for easy comparison
        const todayStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}`;
        
        // Format current time as HH:MM string
        const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        // 1. Check Date Range (is the schedule valid for today?)
        let dateActive = true;
        if (schedule.start_date && todayStr < schedule.start_date) {
            dateActive = false; // Hasn't started yet
        }
        if (schedule.end_date && todayStr > schedule.end_date) {
            dateActive = false; // Has already ended
        }

        if (!dateActive) {
            return false; // No need to check time or repeat
        }
        
        // 2. Check Time Range (is it the right time of day?)
        let timeActive = false;
        const startTime = schedule.start_time; // "HH:MM"
        const endTime = schedule.end_time; // "HH:MM"
        
        if (startTime <= endTime) {
            // Normal case (e.g., 09:00 to 17:00)
            timeActive = (currentTimeStr >= startTime && currentTimeStr <= endTime);
        } else {
            // Overnight case (e.g., 22:00 to 06:00)
            timeActive = (currentTimeStr >= startTime || currentTimeStr <= endTime);
        }

        if (!timeActive) {
            return false; // No need to check repeat
        }

        // 3. Check Repeat Pattern (is it the right day of the week/month?)
        let repeatActive = false;
        const repeatMode = schedule.repeat_mode;

        if (repeatMode === 'once') {
            repeatActive = (todayStr === schedule.start_date);
        } else if (repeatMode === 'daily') {
            repeatActive = true;
        } else if (repeatMode === 'weekdays') {
            repeatActive = (currentDayOfWeek >= 1 && currentDayOfWeek <= 5); // Mon-Fri
        } else if (repeatMode === 'weekends') {
            repeatActive = (currentDayOfWeek === 0 || currentDayOfWeek === 6); // Sun, Sat
        } else if (repeatMode === 'custom') {
            // The 'custom_days' array stores 0=Sun, 1=Mon, etc. which matches getDay()
            repeatActive = schedule.custom_days && schedule.custom_days.includes(currentDayOfWeek);
        }

        // Final decision
        return dateActive && timeActive && repeatActive;
    } catch (e) {
        console.error("Error checking schedule activity:", e, schedule);
        return false;
    }
}
// --- END NEW HELPER FUNCTION ---

function renderSchedulesList() {
    const container = document.getElementById('schedules-list');
    if (!container) return;

    const filtered = schedules.filter(s => {
        if (currentFilter === 'all') return true;
        if (currentFilter === 'limit') return s.rule_type === 'limit';
        if (currentFilter === 'quota') return s.rule_type === 'quota';
        // --- MODIFICATION ---
        // Was: if (currentFilter === 'active') return s.is_enabled;
        if (currentFilter === 'active') return isScheduleCurrentlyActive(s);
        // --- END MODIFICATION ---
        return true;
    });

    if (filtered.length === 0) {
    container.innerHTML = '<div class="no-schedules">No schedules found matching the filter.</div>';
    return;
    }

    container.innerHTML = filtered.map(schedule => {
    const device = lastDeviceList.find(d => d.ip === schedule.device_ip);
    const deviceName = device ? (device.hostname || device.ip) : schedule.device_ip;
    const typeClass = schedule.rule_type;
    const statusClass = schedule.is_enabled ? 'enabled' : 'disabled';
    let detailsHTML = '';
    if (schedule.rule_type === 'limit') {
        detailsHTML = `
            <div class="schedule-detail"><span>↓</span> ${schedule.limit_dl_kbps || '-'} Kbps</div>
            <div class="schedule-detail"><span>↑</span> ${schedule.limit_ul_kbps || '-'} Kbps</div>
            <div class="schedule-detail"><span>P</span> ${schedule.priority ?? '-'}</div>
        `;
    } else {
        const dlQuotaDisplay = schedule.quotaDownload ? formatBytesFromMB(schedule.quotaDownload) : formatBytes(schedule.quota_dl_bytes || 0);
        const ulQuotaDisplay = schedule.quotaUpload ? formatBytesFromMB(schedule.quotaUpload) : formatBytes(schedule.quota_ul_bytes || 0);
        detailsHTML = `
            <div class="schedule-detail"><span>↓</span> ${dlQuotaDisplay}</div>
            <div class="schedule-detail"><span>↑</span> ${ulQuotaDisplay}</div>
        `;
    }
    const repeatText = schedule.repeat_mode.charAt(0).toUpperCase() + schedule.repeat_mode.slice(1);
    const dateRange = `${schedule.start_date || 'N/A'}${schedule.end_date ? ` → ${schedule.end_date}` : ''}`;

    return `
        <div class="schedule-card ${typeClass} ${statusClass}" data-schedule-id="${schedule.id}">
            <div class="schedule-header">
                <div class="schedule-title">
                    <span class="schedule-type-badge ${typeClass}">${schedule.rule_type.toUpperCase()}</span>
                    <h3>${schedule.name}</h3>
                </div>
                <div class="schedule-actions">
                    <button class="btn-icon" onclick="toggleSchedule(${schedule.id})" title="${schedule.is_enabled ? 'Disable' : 'Enable'}">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            ${schedule.is_enabled ? '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>' : '<polyline points="20 6 9 17 4 12"/>'}
                        </svg>
                    </button>
                    <button class="btn-icon" onclick="editSchedule(${schedule.id})" title="Edit">
                        <svg width="18" height="18" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="btn-icon btn-danger" onclick="deleteSchedule(${schedule.id})" title="Delete">
                        <svg width="18" height="18" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            </div>
            <div class="schedule-body">
                <div class="schedule-info">
                    <div class="schedule-device">
                        <svg width="16" height="16" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
                        ${deviceName} (${schedule.device_ip})
                    </div>
                    <div class="schedule-time">
                        <svg width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        ${schedule.start_time} - ${schedule.end_time}
                    </div>
                    <div class="schedule-repeat">
                        <svg width="16" height="16" viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
                        ${repeatText} ${schedule.repeat_mode === 'custom' ? `(${schedule.custom_days.map(d => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(',')})` : ''}
                    </div>
                    <div class="schedule-date">
                        <svg width="16" height="16" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        ${dateRange}
                    </div>
                </div>
                <div class="schedule-details">
                    ${detailsHTML}
                </div>
            </div>
        </div>
    `;
    }).join('');
}

function previousMonth() {
    currentMonth--;
    if (currentMonth < 0) {
    currentMonth = 11;
    currentYear--;
    }
    renderCalendar();
}

function nextMonth() {
    currentMonth++;
    if (currentMonth > 11) {
    currentMonth = 0;
    currentYear++;
    }
    renderCalendar();
}

function populateDeviceDropdown() {
    const select = document.getElementById('schedule-device');
    if (!select) return;
    const currentVal = select.value;
    const onlineDevices = lastDeviceList.filter(d => d.status === 'online');
    select.innerHTML = '<option value="">Select a device...</option>' +
    onlineDevices.map(d => `<option value="${d.ip}" ${d.ip === currentVal ? 'selected' : ''}>${d.hostname || 'Unknown'} (${d.ip})</option>`).join('');
    if (currentVal && !onlineDevices.some(d => d.ip === currentVal)) {
        const offlineDevice = lastDeviceList.find(d => d.ip === currentVal);
        if (offlineDevice) {
            select.insertAdjacentHTML('beforeend', `<option value="${offlineDevice.ip}" selected disabled>${offlineDevice.hostname || 'Unknown'} (${offlineDevice.ip}) - Offline</option>`);
        } else {
            console.warn("Previously selected device for schedule not found:", currentVal);
        }
    }
}

function openScheduleModal() {
    currentScheduleId = null;
    document.getElementById('schedule-modal-title').textContent = 'Create Schedule';
    document.getElementById('schedule-name').value = '';
    document.getElementById('schedule-type').value = 'limit';
    document.getElementById('schedule-device').value = '';
    const today = new Date();
    const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    document.getElementById('schedule-start-date').value = todayStr;
    document.getElementById('schedule-end-date').value = '';
    document.getElementById('schedule-start-time').value = '00:00';
    document.getElementById('schedule-end-time').value = '23:59';
    document.getElementById('schedule-limit-download').value = '1024';
    document.getElementById('schedule-limit-upload').value = '512';
    document.getElementById('schedule-limit-priority').value = '5';
    document.getElementById('schedule-quota-download').value = '1000';
    document.getElementById('schedule-quota-upload').value = '500';
    document.getElementById('schedule-enabled').checked = true;
    document.querySelectorAll('.repeat-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector('[data-repeat="once"]').classList.add('active');
    document.getElementById('custom-days-container').style.display = 'none';
    document.querySelectorAll('#custom-days-container .day-checkbox input').forEach(cb => cb.checked = false);
    document.getElementById('limit-fields').style.display = 'block';
    document.getElementById('quota-fields').style.display = 'none';
    populateDeviceDropdown();
    openModal('scheduleModal');
}

function editSchedule(scheduleId) {
    const schedule = schedules.find(s => s.id === scheduleId);
    if (!schedule) {
    showNotification(`Schedule with ID ${scheduleId} not found.`, 'error');
    return;
    }
    currentScheduleId = scheduleId;
    document.getElementById('schedule-modal-title').textContent = 'Edit Schedule';
    document.getElementById('schedule-name').value = schedule.name;
    document.getElementById('schedule-type').value = schedule.rule_type;
    document.getElementById('schedule-start-date').value = schedule.start_date || '';
    document.getElementById('schedule-end-date').value = schedule.end_date || '';
    document.getElementById('schedule-start-time').value = schedule.start_time;
    document.getElementById('schedule-end-time').value = schedule.end_time;
    document.getElementById('schedule-enabled').checked = schedule.is_enabled;
    populateDeviceDropdown();
    document.getElementById('schedule-device').value = schedule.device_ip;
    if (schedule.rule_type === 'limit') {
    document.getElementById('schedule-limit-download').value = schedule.limit_dl_kbps || '';
    document.getElementById('schedule-limit-upload').value = schedule.limit_ul_kbps || '';
    document.getElementById('schedule-limit-priority').value = schedule.priority ?? 5;
    document.getElementById('limit-fields').style.display = 'block';
    document.getElementById('quota-fields').style.display = 'none';
    } else {
    document.getElementById('schedule-quota-download').value = schedule.quotaDownload ?? (schedule.quota_dl_bytes ? schedule.quota_dl_bytes / (1024 * 1024) : '');
    document.getElementById('schedule-quota-upload').value = schedule.quotaUpload ?? (schedule.quota_ul_bytes ? schedule.quota_ul_bytes / (1024 * 1024) : '');
    document.getElementById('limit-fields').style.display = 'none';
    document.getElementById('quota-fields').style.display = 'block';
    }
    document.querySelectorAll('.repeat-btn').forEach(btn => btn.classList.remove('active'));
    const repeatBtn = document.querySelector(`[data-repeat="${schedule.repeat_mode}"]`);
    if (repeatBtn) repeatBtn.classList.add('active');
    const customDaysContainer = document.getElementById('custom-days-container');
    document.querySelectorAll('#custom-days-container .day-checkbox input').forEach(cb => cb.checked = false);
    if (schedule.repeat_mode === 'custom' && schedule.custom_days) {
    customDaysContainer.style.display = 'block';
    schedule.custom_days.forEach(dayIndex => {
        const checkbox = document.querySelector(`#custom-days-container .day-checkbox input[value="${dayIndex}"]`);
        if (checkbox) checkbox.checked = true;
    });
    } else {
    customDaysContainer.style.display = 'none';
    }
    openModal('scheduleModal');
}

function saveSchedule() {
    const name = document.getElementById('schedule-name').value.trim();
    const type = document.getElementById('schedule-type').value;
    const deviceIp = document.getElementById('schedule-device').value;
    const startDate = document.getElementById('schedule-start-date').value;
    const endDate = document.getElementById('schedule-end-date').value;
    const startTime = document.getElementById('schedule-start-time').value;
    const endTime = document.getElementById('schedule-end-time').value;
    const enabled = document.getElementById('schedule-enabled').checked;
    const repeatBtn = document.querySelector('.repeat-btn.active');
    const repeat = repeatBtn ? repeatBtn.dataset.repeat : 'once';
    if (!name) { showNotification('Please enter a schedule name', 'error'); return; }
    if (!deviceIp) { showNotification('Please select a device', 'error'); return; }
    if (!startDate) { showNotification('Please select a start date', 'error'); return; }
    if (!startTime || !endTime) { showNotification('Please select start and end times', 'error'); return; }
    let customDays = [];
    if (repeat === 'custom') {
    customDays = Array.from(document.querySelectorAll('#custom-days-container .day-checkbox input:checked'))
                        .map(cb => parseInt(cb.value));
    if (customDays.length === 0) {
        showNotification('Please select at least one day for custom repeat', 'error');
        return;
    }
    }
    const scheduleData = {
    id: currentScheduleId,
    name: name,
    rule_type: type,
    device_ip: deviceIp,
    start_date: startDate,
    end_date: endDate || null,
    start_time: startTime,
    end_time: endTime,
    repeat_mode: repeat,
    custom_days: customDays,
    is_enabled: enabled
    };
    if (type === 'limit') {
    const dl = parseInt(document.getElementById('schedule-limit-download').value);
    const ul = parseInt(document.getElementById('schedule-limit-upload').value);
    const prio = parseInt(document.getElementById('schedule-limit-priority').value);
    if (isNaN(dl) || dl <= 0) { showNotification('Invalid Download Limit', 'error'); return; }
    if (isNaN(ul) || ul <= 0) { showNotification('Invalid Upload Limit', 'error'); return; }
    if (isNaN(prio) || prio < 0 || prio > 7) { showNotification('Invalid Priority', 'error'); return; }
    scheduleData.limit_dl_kbps = dl;
    scheduleData.limit_ul_kbps = ul;
    scheduleData.priority = prio;
    } else {
    const dlMB = parseInt(document.getElementById('schedule-quota-download').value);
    const ulMB = parseInt(document.getElementById('schedule-quota-upload').value);
    if (isNaN(dlMB) || dlMB <= 0) { showNotification('Invalid Download Quota (MB)', 'error'); return; }
    if (isNaN(ulMB) || ulMB <= 0) { showNotification('Invalid Upload Quota (MB)', 'error'); return; }
    scheduleData.quotaDownload = dlMB;
    scheduleData.quotaUpload = ulMB;
    }
    if (socket && socket.readyState === WebSocket.OPEN) {
    console.log("Sending save_schedule:", scheduleData);
    socket.send(JSON.stringify({
        type: 'save_schedule',
        schedule: scheduleData
    }));
    showNotification(`Saving schedule '${name}'...`);
    } else {
    showNotification("Error: Cannot save schedule. WebSocket not connected.", "error");
    }
    closeModal('scheduleModal');
}

function toggleSchedule(scheduleId) {
    const schedule = schedules.find(s => s.id === scheduleId);
    if (!schedule) return;
    const newEnabledState = !schedule.is_enabled;
    if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
        type: 'toggle_schedule',
        id: scheduleId,
        enabled: newEnabledState
    }));
    showNotification(`Requesting to ${newEnabledState ? 'enable' : 'disable'} schedule...`);
    } else {
    showNotification("Error: Cannot toggle schedule. WebSocket not connected.", "error");
    }
}

function deleteSchedule(scheduleId) {
    const schedule = schedules.find(s => s.id === scheduleId);
    if (!schedule) return;
    if (!confirm(`Are you sure you want to delete the schedule "${schedule.name}"?`)) return;
    if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
        type: 'delete_schedule',
        id: scheduleId
    }));
    showNotification(`Requesting to delete schedule '${schedule.name}'...`);
    } else {
    showNotification("Error: Cannot delete schedule. WebSocket not connected.", "error");
    }
}

// -------------------------------------------------------------------
// --- SECURITY PAGE RENDER FUNCTIONS
// -------------------------------------------------------------------

/**
* Updates the entire Security page UI based on the current state.
*/
function renderSecurityPage(state) {
    // Update Client Isolation Toggle
    const isoToggle = document.getElementById('client-isolation-toggle');
    if (isoToggle) {
        isoToggle.checked = state.isolation;
    }

    // Update Access Control Mode Radios
    const acModeRadio = document.querySelector(`input[name="ac-mode"][value="${state.acMode}"]`);
    if (acModeRadio) {
        acModeRadio.checked = true;
    }

    // Render MAC Lists
    renderMacList('#block-list-ul', state.blockList, 'block');
    renderMacList('#allow-list-ul', state.allowList, 'allow');
    
    // --- NEW: Render IP Block List ---
    renderIpBlockList('#ip-block-list-ul', state.ipBlockList);
}

/**
* Renders a list of MAC addresses into a <ul>.
*/
function renderMacList(ulSelector, macList, listType) {
    const ul = document.getElementById(ulSelector.substring(1)); // Get element by ID
    if (!ul) return;

    if (!macList || macList.length === 0) {
        ul.innerHTML = `<li class="mac-list-empty">This list is empty.</li>`;
        return;
    }

    ul.innerHTML = macList.map(mac => `
        <li>
            <span>${mac}</span>
            <button class="btn-remove-mac" data-mac="${mac}" data-list-type="${listType}" title="Remove MAC">&times;</button>
        </li>
    `).join('');
}

/**
* Renders the list of connected devices on the Security page.
*/
function renderSecurityDeviceList(devices, securityState) {
    const tbody = document.getElementById('security-device-list-tbody');
    if (!tbody) return;

    if (!devices || devices.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="no-data-cell">No devices connected.</td></tr>';
        return;
    }

    const { blockList = [], allowList = [] } = securityState;
    
    tbody.innerHTML = devices.map(device => {
        const statusClass = device.status === 'online' ? 'online' : 'offline';
        const statusText = device.status === 'online' ? 'Online' : 'Offline';
        const mac = device.mac;

        if (!mac) return ''; // Cannot add a device without a MAC

        const isOnBlockList = blockList.includes(mac);
        const isOnAllowList = allowList.includes(mac);
        const isManaged = isOnBlockList || isOnAllowList;

        let actionButtons = '';
        if (isManaged) {
            actionButtons = `<span class="managed-text">
                ${isOnBlockList ? 'On Block List' : 'On Allow List'}
            </span>`;
        } else {
            actionButtons = `
                <button class="btn btn-secondary btn-small" data-mac="${mac}" data-list-type="block">
                    Add to Block
                </button>
                <button class="btn btn-secondary btn-small" data-mac="${mac}" data-list-type="allow">
                    Add to Allow
                </button>
            `;
        }

        return `
            <tr>
                <td><span class="status-badge ${statusClass}"><span class="status-dot"></span> ${statusText}</span></td>
                <td>${device.hostname || 'Unknown'}</td>
                <td><span class="speed-text">${device.ip || '-'}</span></td>
                <td><span class="speed-text">${mac}</span></td>
                <td>
                    <div class="actions-cell">
                        ${actionButtons}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// -------------------------------------------------------------------
// EVENT LISTENERS
// -------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    initCharts();
    connectWebSocket(); // WebSocket connection now requests initial data

    document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const page = item.dataset.page;
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        item.classList.add('active');
        const targetPage = document.getElementById(page + '-page');
        if (targetPage) targetPage.classList.add('active');

        // If switching to scheduler, ensure data is fresh (or request it)
        if (page === 'scheduler') {
            renderCalendar(); // Re-render based on current schedules array
            renderSchedulesList();
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'request_devices' }));
            }
        }
        
        // --- If switching to security, request data ---
        if (page === 'security') {
            loadSecurityData();
            // Re-render lists with current data
            renderSecurityPage(currentSecurityState);
            renderSecurityDeviceList(lastDeviceList, currentSecurityState);
        }

        // --- If switching to AI, request data ---
        if (page === 'ai') {
             if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'request_forecast' }));
            }
        }
    });
    });

    // --- (Other existing listeners: time-btn, search, modals, toggle) ---
    document.querySelectorAll('.time-btn').forEach(btn=>{btn.addEventListener('click',()=>{document.querySelectorAll('.time-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');dataUsagePeriod=btn.dataset.time;if(socket&&socket.readyState===WebSocket.OPEN){socket.send(JSON.stringify({type:'set_usage_period',period:dataUsagePeriod}));}});});
    const searchInput=document.getElementById('device-search');if(searchInput){searchInput.addEventListener('input',(e)=>{renderDevices(lastDeviceList,e.target.value);});}
    document.querySelectorAll('.modal').forEach(modal=>{modal.addEventListener('click',(e)=>{if(e.target===modal)closeModal(modal.id);});});
    document.querySelectorAll('.modal-close').forEach(btn=>{btn.addEventListener('click',()=>closeModal(btn.closest('.modal')?.id));});
    const toggleInput=document.getElementById('hotspot-toggle');if(toggleInput){toggleInput.onchange=(event)=>{if(isToggleProcessing){event.preventDefault();event.target.checked=!event.target.checked;return;}if(socket&&socket.readyState===WebSocket.OPEN){const newState=event.target.checked;toggleInput.disabled=true;isToggleProcessing=true;socket.send(JSON.stringify({type:'hotspot_toggle',state:newState}));}else{showNotification("Cannot change hotspot state: Not connected.","error");event.target.checked=!event.target.checked;isToggleProcessing=false;}};}

    // --- Scheduler modal/page event listeners ---
    const scheduleTypeSelect = document.getElementById('schedule-type');
    if (scheduleTypeSelect) {
    scheduleTypeSelect.addEventListener('change', (e) => {
        const isLimit = e.target.value === 'limit';
        document.getElementById('limit-fields').style.display = isLimit ? 'block' : 'none';
        document.getElementById('quota-fields').style.display = isLimit ? 'none' : 'block';
    });
    }
    document.querySelectorAll('.repeat-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('.repeat-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('custom-days-container').style.display = (btn.dataset.repeat === 'custom') ? 'block' : 'none';
    });
    });
    document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentFilter = tab.dataset.filter;
        renderSchedulesList(); // Re-render list with new filter
    });
    });

    // -------------------------------------------------------------------
    // --- SECURITY PAGE EVENT LISTENERS
    // -------------------------------------------------------------------

    // Client Isolation Toggle
    const isoToggle = document.getElementById('client-isolation-toggle');
    if (isoToggle) {
        isoToggle.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({
                    type: 'set_client_isolation',
                    enabled: enabled
                }));
                showNotification(`Setting Client Isolation to ${enabled ? 'ON' : 'OFF'}...`);
            } else {
                showNotification("Error: WebSocket not connected.", "error");
            }
        });
    }

    // Access Control Mode Radios
    document.querySelectorAll('input[name="ac-mode"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.checked) {
                const mode = e.target.value;
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({
                        type: 'set_ac_mode',
                        mode: mode
                    }));
                    showNotification(`Setting Access Control Mode to ${mode}...`);
                } else {
                    showNotification("Error: WebSocket not connected.", "error");
                }
            }
        });
    });

    // Add MAC to Block List Form
    const blockForm = document.getElementById('add-block-mac-form');
    if (blockForm) {
        blockForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const input = document.getElementById('block-mac-input');
            const mac = input.value.trim();
            if (validateMAC(mac)) {
                sendAddMac(mac, 'block');
                input.value = '';
            } else {
                showNotification("Invalid MAC address format.", "error");
            }
        });
    }

    // Add MAC to Allow List Form
    const allowForm = document.getElementById('add-allow-mac-form');
    if (allowForm) {
        allowForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const input = document.getElementById('allow-mac-input');
            const mac = input.value.trim();
            if (validateMAC(mac)) {
                sendAddMac(mac, 'allow');
                input.value = '';
            } else {
                showNotification("Invalid MAC address format.", "error");
            }
        });
    }
    
    // Remove MAC button (Event Delegation on lists)
    const blockListUl = document.getElementById('block-list-ul');
    if (blockListUl) {
        blockListUl.addEventListener('click', handleRemoveMacClick);
    }
    const allowListUl = document.getElementById('allow-list-ul');
    if (allowListUl) {
        allowListUl.addEventListener('click', handleRemoveMacClick);
    }

    // Add from Connected Devices (Event Delegation)
    const secDeviceTbody = document.getElementById('security-device-list-tbody');
    if (secDeviceTbody) {
        secDeviceTbody.addEventListener('click', (e) => {
            const button = e.target.closest('button[data-mac]');
            if (button) {
                const mac = button.dataset.mac;
                const listType = button.dataset.listType;
                if (mac && listType) {
                    sendAddMac(mac, listType);
                }
            }
        });
    }

    // --- NEW: IP Block List Form ---
    const ipBlockForm = document.getElementById('add-ip-block-form');
    if (ipBlockForm) {
        ipBlockForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const input = document.getElementById('ip-block-input');
            const ipRange = input.value.trim();
            if (validateIPCIDR(ipRange)) {
                sendAddIpBlock(ipRange);
                input.value = '';
            } else {
                showNotification("Invalid IP/CIDR format (e.g., 1.1.1.1 or 2a03::/64).", "error");
            }
        });
    }
    
    // --- NEW: IP Block List UL (for removal) ---
    const ipBlockListUl = document.getElementById('ip-block-list-ul');
    if (ipBlockListUl) {
        ipBlockListUl.addEventListener('click', (e) => {
            const button = e.target.closest('.btn-remove-mac'); // Using same class as MAC lists
            if (button) {
                const ipRange = button.dataset.ipRange;
                if (ipRange) {
                    if (confirm(`Are you sure you want to unblock ${ipRange}?`)) {
                        sendRemoveIpBlock(ipRange);
                    }
                }
            }
        });
    }
});
// --- End of DOMContentLoaded ---

// -------------------------------------------------------------------
// --- SECURITY HELPER FUNCTIONS
// -------------------------------------------------------------------

function validateMAC(mac) {
    const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
    return macRegex.test(mac);
}

function sendAddMac(mac, listType) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'add_mac',
            mac: mac,
            list_type: listType
        }));
        showNotification(`Adding ${mac} to ${listType} list...`);
    } else {
        showNotification("Error: WebSocket not connected.", "error");
    }
}

function handleRemoveMacClick(e) {
    const button = e.target.closest('.btn-remove-mac');
    if (button) {
        const mac = button.dataset.mac;
        if (mac) {
            if (confirm(`Are you sure you want to remove ${mac} from the list?`)) {
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({
                        type: 'remove_mac',
                        mac: mac
                    }));
                    showNotification(`Removing ${mac} from list...`);
                } else {
                    showNotification("Error: WebSocket not connected.", "error");
                }
            }
        }
    }
}

// --- NEW: IP Block List Helper Functions ---

/**
 * Renders a list of IPs/CIDRs into a <ul>.
 */
function renderIpBlockList(ulSelector, ipList) {
    const ul = document.getElementById(ulSelector.substring(1));
    if (!ul) return;

    if (!ipList || ipList.length === 0) {
        ul.innerHTML = `<li class="mac-list-empty">No IPs or ranges are blocked.</li>`;
        return;
    }

    ul.innerHTML = ipList.map(ipRange => `
        <li>
            <span>${ipRange}</span>
            <button class="btn-remove-mac" data-ip-range="${ipRange}" title="Unblock IP/Range">&times;</button>
        </li>
    `).join('');
}

/**
 * Validates an IPv4 or IPv6 IP/CIDR string.
 */
function validateIPCIDR(ipRange) {
    // This is a basic check. The backend (iptables/ip6tables) does the real validation.
    // We just check for a dot (IPv4) or a colon (IPv6).
    if (ipRange.includes('.') || ipRange.includes(':')) {
        // Basic sanitation to prevent obvious command injection attempts
        if (ipRange.includes(';') || ipRange.includes('&') || ipRange.includes('|') || ipRange.includes('`')) {
            return false;
        }
        return true;
    }
    // Not a valid format
    return false;
}

/**
 * Sends request to add an IP/CIDR to the block list.
 */
function sendAddIpBlock(ipRange) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'add_ip_block',
            ip_range: ipRange
        }));
        showNotification(`Requesting to block ${ipRange}...`);
    } else {
        showNotification("Error: WebSocket not connected.", "error");
    }
}

/**
 * Sends request to remove an IP/CIDR from the block list.
 */
function sendRemoveIpBlock(ipRange) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'remove_ip_block',
            ip_range: ipRange
        }));
        showNotification(`Requesting to unblock ${ipRange}...`);
    } else {
        showNotification("Error: WebSocket not connected.", "error");
    }
}

// -------------------------------------------------------------------
// MODAL FUNCTIONS
// -------------------------------------------------------------------
function openModal(modalId) { document.getElementById(modalId)?.classList.add('active'); }
function closeModal(modalId) { document.getElementById(modalId)?.classList.remove('active'); currentDevice=null; currentScheduleId=null; }
function openLimitModal(deviceId){currentDevice=deviceId;const device=lastDeviceList.find(d=>d.id===deviceId);const dlIn=document.getElementById('limit-download');const ulIn=document.getElementById('limit-upload');const prioIn=document.getElementById('limit-priority');if(device&&device.hasLimit){if(dlIn)dlIn.value=device.limit_dl_kbps||"";if(ulIn)ulIn.value=device.limit_ul_kbps||"";if(prioIn)prioIn.value=device.priority??5;}else{if(dlIn)dlIn.value="";if(ulIn)ulIn.value="";if(prioIn)prioIn.value=5;}openModal('limitModal');}
function applyLimit(){if(!currentDevice){showNotification("Err: No device selected.","error");closeModal('limitModal');return;}const dlIn=document.getElementById('limit-download');const ulIn=document.getElementById('limit-upload');const prioIn=document.getElementById('limit-priority');const dlKbps=parseInt(dlIn?.value,10);const ulKbps=parseInt(ulIn?.value,10);const prio=parseInt(prioIn?.value,10);if(isNaN(dlKbps)||dlKbps<=0){showNotification("Invalid DL Limit.","error");dlIn?.focus();return;}if(isNaN(ulKbps)||ulKbps<=0){showNotification("Invalid UL Limit.","error");ulIn?.focus();return;}if(isNaN(prio)||prio<0||prio>7){showNotification("Invalid Prio (0-7).","error");prioIn?.focus();return;}if(socket&&socket.readyState===WebSocket.OPEN){socket.send(JSON.stringify({type:'set_limit',ip:currentDevice,download:dlKbps,upload:ulKbps,priority:prio}));showNotification(`Applying limit to ${currentDevice}...`);}else{showNotification("Err: Cannot apply limit. WS not connected.","error");}closeModal('limitModal');}
function openQuotaModal(deviceId){currentDevice=deviceId;const device=lastDeviceList.find(d=>d.id===deviceId);const dlIn=document.getElementById('quota-download');const ulIn=document.getElementById('quota-upload');const pIn=document.getElementById('quota-period');if(device&&device.hasQuota){if(dlIn)dlIn.value=device.quota_dl_limit_bytes?Math.round(device.quota_dl_limit_bytes/1048576):"";if(ulIn)ulIn.value=device.quota_ul_limit_bytes?Math.round(device.quota_ul_limit_bytes/1048576):"";if(pIn){const s=device.quota_period_seconds;if(!s)pIn.value="24h";else if(s%86400===0&&s>0)pIn.value=`${s/86400}d`;else if(s%3600===0&&s>0)pIn.value=`${s/3600}h`;else if(s%60===0&&s>0)pIn.value=`${s/60}m`;else pIn.value=`${s}s`;}}else{if(dlIn)dlIn.value="";if(ulIn)ulIn.value="";if(pIn)pIn.value="24h";}openModal('quotaModal');}
function applyQuota(){if(!currentDevice){showNotification("Err: No device selected.","error");closeModal('quotaModal');return;}const dlIn=document.getElementById('quota-download');const ulIn=document.getElementById('quota-upload');const pIn=document.getElementById('quota-period');const dlMB=parseInt(dlIn?.value,10);const ulMB=parseInt(ulIn?.value,10);const pStr=pIn?.value.trim();if(isNaN(dlMB)||dlMB<=0){showNotification("Invalid DL Quota (MB).","error");dlIn?.focus();return;}if(isNaN(ulMB)||ulMB<=0){showNotification("Invalid UL Quota (MB).","error");ulIn?.focus();return;}if(!pStr||!/^\d+[hmds]$/i.test(pStr)){showNotification("Invalid Period (e.g. 1h, 7d).","error");pIn?.focus();return;}if(socket&&socket.readyState===WebSocket.OPEN){socket.send(JSON.stringify({type:'set_quota',ip:currentDevice,download_mb:dlMB,upload_mb:ulMB,period:pStr}));showNotification(`Applying quota to ${currentDevice}...`);}else{showNotification("Err: Cannot apply quota. WS not connected.","error");}closeModal('quotaModal');}
function removeLimit(deviceId){if(socket&&socket.readyState===WebSocket.OPEN){socket.send(JSON.stringify({type:'remove_limit',ip:deviceId}));showNotification(`Removing limit for ${deviceId}...`);}else{showNotification("Err: Cannot remove limit. WS not connected.","error");}}
function removeQuota(deviceId){if(socket&&socket.readyState===WebSocket.OPEN){socket.send(JSON.stringify({type:'remove_quota',ip:deviceId}));showNotification(`Removing quota for ${deviceId}...`);}else{showNotification("Err: Cannot remove quota. WS not connected.","error");}}
function toggleBlock(deviceId){console.log('Toggling block for',deviceId);}
function openSettingsModal(){const ssidIn=document.getElementById('ssid-input');const passIn=document.getElementById('password-input');const currentEl=document.getElementById('current-ssid');if(ssidIn)ssidIn.value=currentHotspotSSID;if(passIn)passIn.value="";if(currentEl)currentEl.textContent=currentHotspotSSID;openModal('hotspotSettingsModal');}
function applyHotspotSettings(){const newSSID=document.getElementById('ssid-input')?.value.trim();const newPass=document.getElementById('password-input')?.value;if(!newSSID){showNotification("SSID cannot be empty!","error");return;}if(newPass!=null&&newPass.length>0&&(newPass.length<8||newPass.length>63)){showNotification("Password must be 8-63 chars!","error");return;}if(socket&&socket.readyState===WebSocket.OPEN){socket.send(JSON.stringify({type:'set_hotspot_settings',ssid:newSSID,password:newPass??""}));}else{showNotification("Err: WS not connected.","error");}closeModal('hotspotSettingsModal');}
function togglePasswordVisibility(){const input=document.getElementById('password-input');if(input)input.type=input.type==='password'?'text':'password';}