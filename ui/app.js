// app.js

// --- Global Data Store ---
let appConfig = {};
let selectedUserId = null;
let loginUsers = []; // Store user data for login validation

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Initial Nav Setup
    switchMainTab('view-daily-log');

    // Manual Window Drag Handler
    const titleBar = document.getElementById('title-bar');
    if (titleBar) {
        titleBar.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (e.target.closest('.control-btn') || e.target.tagName === 'INPUT') return;
            sendMessageToAHK({ command: 'dragWindow' });
        });
    }

    // Request Initial Data
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage({ command: 'ready' });
    }

    // Password Validation Listeners
    setupPasswordValidation('new-webpw', 'new-webpw2');
    setupPasswordValidation('new-pw2', 'new-pw2-confirm');
    setupPasswordValidation('new-sappw', 'new-sappw2');
});

// --- AHK Bridge ---
if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener('message', event => {
        try {
            // PostWebMessageAsJson sends a parsed object, no need to parse again
            const msg = event.data;
            handleAhkMessage(msg);
        } catch (e) {
            console.error('Error handling AHK message:', e);
        }
    });
} else {
    // Browser fallback
    console.warn('WebView2 environment not detected.');
}

function sendMessageToAHK(payload) {
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(payload);
    } else {
        console.log('To AHK:', payload);
    }
}

function handleAhkMessage(msg) {
    switch (msg.type) {
        case 'initLogin':
            loginUsers = msg.users;
            renderUserList(msg.users);
            break;
        case 'loginSuccess':
            handleLoginSuccess(msg.profile);
            break;
        case 'loginFail':
            showNativeMsgBox(msg.message, "로그인 실패");
            break;
        case 'loadConfig':
            appConfig = msg.data;
            if (document.getElementById('settings-view').style.display !== 'none') {
                loadSettingsToUI();
            }
            break;
        case 'releaseNotes':
            if (msg.error) {
                renderReleaseNotes(null, msg.error);
            } else {
                renderReleaseNotes(msg.data);
            }
            break;
    }
}

// --- Navigation & Views ---

function switchMainTab(viewId) {
    document.querySelectorAll('#content .view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-top .menu-item').forEach(el => el.classList.remove('active'));

    const target = document.getElementById(viewId);
    if (target) target.classList.add('active');

    const navItem = document.querySelector(`.nav-top .menu-item[data-target="${viewId}"]`);
    if (navItem) navItem.classList.add('active');
}

function switchView(viewName) {
    // Hide all main containers first
    const loginCon = document.getElementById('login-container');
    const appCon = document.getElementById('app-container');
    const setView = document.getElementById('settings-view');

    loginCon.style.display = 'none';
    appCon.style.display = 'none';
    setView.style.display = 'none';

    if (viewName === 'login') {
        loginCon.style.display = 'flex';
        document.getElementById('login-view').style.display = 'flex';
        document.getElementById('password-view').style.display = 'none';
        document.getElementById('add-user-view').style.display = 'none';
    } else if (viewName === 'add') {
        loginCon.style.display = 'flex';
        document.getElementById('login-view').style.display = 'none';
        document.getElementById('add-user-view').style.display = 'block';
        resetAddUserForm();
    } else if (viewName === 'app') {
        appCon.style.display = 'flex';
    } else if (viewName === 'settings') {
        setView.style.display = 'flex';
        // Ensure data is loaded
        loadSettingsToUI();
    }
}

function openSettings() {
    sendMessageToAHK({ command: 'requestConfig' });
    switchView('settings');
    switchSettingsTab('tab-user');
}

function closeSettings() {
    switchView('app');
}

function switchSettingsTab(tabId) {
    document.querySelectorAll('.settings-sidebar .tab-item').forEach(el => el.classList.remove('active'));
    const clickedTab = document.querySelector(`.settings-sidebar .tab-item[onclick="switchSettingsTab('${tabId}')"]`);
    if (clickedTab) clickedTab.classList.add('active');

    document.querySelectorAll('.settings-tab-pane').forEach(el => el.classList.remove('active'));
    const targetPane = document.getElementById(tabId);
    if (targetPane) targetPane.classList.add('active');

    if (tabId === 'tab-updates') {
        requestReleaseNotes();
    }
}

function requestReleaseNotes() {
    const container = document.getElementById('release-list');
    if (container) container.innerHTML = '<div class="loading-spinner">불러오는 중...</div>';
    sendMessageToAHK({ command: 'getReleaseNotes' });
}

function renderReleaseNotes(data, error = null) {
    const container = document.getElementById('release-list');
    if (!container) return;

    container.innerHTML = '';

    if (error) {
        container.innerHTML = `<div style="color:red; text-align:center;">오류: ${error}</div>`;
        return;
    }

    if (!data || data.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px;">업데이트 내역이 없습니다.</div>';
        return;
    }

    data.forEach(release => {
        const date = new Date(release.published_at).toLocaleDateString('ko-KR');
        const bodyText = release.body || "내용 없음";

        const item = document.createElement('div');
        item.className = 'release-item';
        item.innerHTML = `
            <div class="release-header">
                <span class="release-ver">${release.tag_name}</span>
                <span class="release-date">${date}</span>
            </div>
            <div class="release-body">${escapeHtml(bodyText)}</div>
        `;
        container.appendChild(item);
    });
}

function escapeHtml(text) {
    return text.replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ... (Rest of Login Logic remains same) ...

// --- Validation Utils ---
function setupPasswordValidation(id1, id2) {
    const el1 = document.getElementById(id1);
    const el2 = document.getElementById(id2);
    if (!el1 || !el2) return;

    const validate = () => {
        const val1 = el1.value;
        const val2 = el2.value;

        // Find label to add checkmark
        const label = el2.parentNode.querySelector('label');

        if (val2.length > 0) {
            if (val1 === val2) {
                // Match
                el2.classList.remove('inputs-error');
                el2.classList.add('inputs-match');
                if (label) label.classList.add('validation-success');
            } else {
                // Mismatch
                el2.classList.remove('inputs-match');
                el2.classList.add('inputs-error');
                if (label) label.classList.remove('validation-success');
            }
        } else {
            // Empty
            el2.classList.remove('inputs-match');
            el2.classList.remove('inputs-error');
            if (label) label.classList.remove('validation-success');
        }
    };

    el1.addEventListener('input', validate);
    el2.addEventListener('input', validate);
}

// --- Login Logic ---
function renderUserList(users) {
    const container = document.getElementById('user-list-container');
    container.innerHTML = '';

    if (!users || users.length === 0) {
        container.innerHTML = '<div style="padding:20px; text-align:center; color:#888;">등록된 사용자가 없습니다.</div>';
        return;
    }

    users.forEach(user => {
        const item = document.createElement('div');
        item.className = 'user-item';
        item.ondblclick = () => {
            selectUser(user.id);
            moveToPasswordView();
        };
        item.onclick = () => selectUser(user.id);

        item.innerHTML = `
            <div class="user-info">
                <span class="user-name">${user.name}</span>
                <span class="user-id">(${user.id})</span>
            </div>
        `;
        item.dataset.id = user.id;
        container.appendChild(item);
    });
}

function selectUser(id) {
    selectedUserId = id;
    // Highlight UI
    document.querySelectorAll('.user-item').forEach(el => el.classList.remove('selected'));
    const item = document.querySelector(`.user-item[data-id="${id}"]`);
    if (item) item.classList.add('selected');

    // Enable Buttons
    document.getElementById('btn-next').disabled = false;
    document.getElementById('btn-delete').disabled = false;
}

function moveToPasswordView() {
    if (!selectedUserId) return;
    const user = loginUsers.find(u => u.id === selectedUserId);
    if (!user) return;

    // Switch to Password View
    document.getElementById('login-view').style.display = 'none';
    const pwdView = document.getElementById('password-view');
    pwdView.style.display = 'flex';

    document.getElementById('pwd-user-name').innerText = user.name;
    document.getElementById('pwd-user-id').innerText = `(${user.id})`;

    const pwInput = document.getElementById('login-pw2');
    pwInput.value = '';
    pwInput.focus();
}

function backToUserList() {
    selectedUserId = null;
    // Clear UI Selection
    document.querySelectorAll('.user-item').forEach(el => el.classList.remove('selected'));

    // Disable Buttons
    document.getElementById('btn-next').disabled = true;
    document.getElementById('btn-delete').disabled = true;

    document.getElementById('password-view').style.display = 'none';
    document.getElementById('login-view').style.display = 'flex';
}

function handleLoginKey(e) {
    if (e.key === 'Enter') {
        tryLogin();
    }
}

function tryLogin() {
    if (!selectedUserId) {
        showNativeMsgBox('사용자를 선택해주세요.', '알림');
        return;
    }

    const pwInput = document.getElementById('login-pw2');
    const enteredPw = pwInput.value;

    const user = loginUsers.find(u => u.id === selectedUserId);
    if (!user) return;

    // Local 2nd Password Check
    if (user.pw2 !== enteredPw) {
        showNativeMsgBox('2차 비밀번호가 일치하지 않습니다.', '로그인 실패');
        pwInput.value = '';
        pwInput.focus();
        return;
    }

    sendMessageToAHK({ command: 'tryLogin', id: selectedUserId });
}

function handleLoginSuccess(profile) {
    switchView('app');
    const titleEl = document.getElementById('app-title');
    if (titleEl) titleEl.innerText = `통합자동화 v3.0 - ${profile.name}`;

    // Set selectedUserId to current logged in user to ensure settings load correct user profile
    selectedUserId = profile.id;

    // Request full config
    sendMessageToAHK({ command: 'requestConfig' });
}

function deleteUser() {
    if (!selectedUserId) {
        showNativeMsgBox("삭제할 유저를 선택해주세요.");
        return;
    }
    sendMessageToAHK({ command: 'deleteUser', id: selectedUserId });
}

function submitNewUser() {
    const name = getVal('new-name');
    const id = getVal('new-id');
    const team = getVal('new-team');

    const webpw = getVal('new-webpw');
    const webpw2 = getVal('new-webpw2');
    const pw2 = getVal('new-pw2');
    const pw2_confirm = getVal('new-pw2-confirm');
    const sappw = getVal('new-sappw');
    const sappw2 = getVal('new-sappw2');

    if (!name || !id || !webpw || !pw2) {
        showNativeMsgBox('필수 정보를 입력해주세요.');
        return;
    }
    if (webpw !== webpw2) {
        showNativeMsgBox('통합 비밀번호가 일치하지 않습니다.');
        return;
    }
    if (pw2 !== pw2_confirm) {
        showNativeMsgBox('2차 비밀번호가 일치하지 않습니다.');
        return;
    }
    if (sappw && sappw !== sappw2) {
        showNativeMsgBox('SAP 비밀번호가 일치하지 않습니다.');
        return;
    }

    const newUser = { id, name, team, webPW: webpw, pw2: pw2, sapPW: sappw };
    sendMessageToAHK({ command: 'addUser', data: newUser });

    switchView('login');
}

function resetAddUserForm() {
    ['new-name', 'new-id', 'new-webpw', 'new-webpw2', 'new-pw2', 'new-pw2-confirm', 'new-sappw', 'new-sappw2'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
}

// --- Settings Logic ---
let saveTimeout = null;
function autoSaveSettings() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveSettings, 500); // 500ms debounce
}

function loadSettingsToUI() {
    const uid = selectedUserId;
    if (!uid || !appConfig.users || !appConfig.users[uid]) return;

    const user = appConfig.users[uid];
    const profile = user.profile || {};

    setVal('user-name', profile.name);
    setVal('user-id', profile.id);
    setVal('user-dept', profile.department);
    setVal('user-team', profile.team);
    setVal('user-webpw', profile.webPW);
    setVal('user-pw2', profile.pw2);
    setVal('user-sappw', profile.sapPW);

    // DEBUG: Trace Data
    // showNativeMsgBox("UI Load for " + uid + " | Workers: " + (user.colleagues ? user.colleagues.length : 'null'), "Debug");

    // Attach AutoSave to User Info inputs
    ['user-dept', 'user-team', 'user-webpw', 'user-pw2', 'user-sappw'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.oninput = autoSaveSettings;
        if (el && el.tagName === 'SELECT') el.onchange = autoSaveSettings;
    });

    // Workers
    const wBody = document.querySelector('#worker-table tbody');
    wBody.innerHTML = '';
    (user.colleagues || []).forEach(w => addWorkerRowToTable(wBody, w));

    // Locations
    const lBody = document.querySelector('#location-table tbody');
    lBody.innerHTML = '';
    (user.locations || []).forEach(l => addLocationRowToTable(lBody, l));

    // Hotkeys
    const hBody = document.querySelector('#hotkey-table tbody');
    hBody.innerHTML = '';
    const hotkeys = user.hotkeys || [];
    renderHotkeyTable(hotkeys);

    // Presets
    renderPresetList(user.presets || {});
}

function saveSettings() {
    const uid = selectedUserId;
    if (!uid || !appConfig.users) return;

    const user = appConfig.users[uid];
    if (!user.profile) user.profile = {};

    user.profile.department = getVal('user-dept');
    user.profile.team = getVal('user-team');
    user.profile.webPW = getVal('user-webpw');
    user.profile.pw2 = getVal('user-pw2');
    user.profile.sapPW = getVal('user-sappw');

    // Gather Workers with Logic
    const newWorkers = [];
    const rows = document.querySelectorAll('#worker-table tbody tr');

    // Constraint Checking Maps
    const managers = [];
    const drivers = { 'A조': { '정': 0, '부': 0 }, 'B조': { '정': 0, '부': 0 }, 'C조': { '정': 0, '부': 0 }, 'D조': { '정': 0, '부': 0 }, '일근': { '정': 0, '부': 0 } };

    rows.forEach(row => {
        const inputs = row.querySelectorAll('input, select');
        const team = inputs[2].value;
        const isManager = inputs[4].checked; // Checkbox
        const driverRole = inputs[5].value; // Select

        if (isManager) managers.push(row);
        if (driverRole !== '-' && drivers[team]) {
            drivers[team][driverRole]++;
        }

        newWorkers.push({
            name: inputs[0].value,
            id: inputs[1].value,
            team: team,
            phone: inputs[3].value,
            isManager: isManager ? 1 : 0,
            driverRole: driverRole
        });
    });

    // Enforce Manager Constraint (Last one checked wins, handled by UI event usually, but here we validate state)
    // Actually, UI event is better for UX. But let's assume the state is what it is.
    // If multiple managers are checked, we might warn or just save.
    // User requested: "Only 1 manager possible". Let's enforce in UI changes mostly.

    user.colleagues = newWorkers;

    // Gather Locations
    const newLocs = [];
    document.querySelectorAll('#location-table tbody tr').forEach(row => {
        const inputs = row.querySelectorAll('input');
        newLocs.push({
            name: inputs[0].value,
            order: inputs[1].value,
            type: inputs[2].value
        });
    });
    user.locations = newLocs;

    // Gather Hotkeys
    const newHotkeys = [];
    document.querySelectorAll('#hotkey-table tbody tr').forEach(row => {
        const action = row.dataset.action;
        const key = row.dataset.key;
        const desc = row.dataset.desc;
        const enabled = row.querySelector('input[type="checkbox"]').checked;
        newHotkeys.push({ action, key, desc, enabled });
    });
    user.hotkeys = newHotkeys;

    sendMessageToAHK({ command: 'saveConfig', data: appConfig });
}

// --- Worker Logic ---
function handleManagerCheck(checkbox) {
    if (checkbox.checked) {
        // Uncheck all others
        const allChecks = document.querySelectorAll('#worker-table input[type="checkbox"]');
        allChecks.forEach(cb => {
            if (cb !== checkbox) cb.checked = false;
        });
    }
    autoSaveSettings();
}

function handleDriverChange(select) {
    // Unique Driver Per Team Logic?
    // "Each Team can have 1 Jung, 1 Bu". 
    // Complexity: We need to know the team of this row.
    const row = select.closest('tr');
    const teamSelect = row.querySelector('select:first-of-type'); // First select is Team
    const team = teamSelect.value;
    const role = select.value;

    if (role !== '-') {
        // Check if another row with same team has same role
        const rows = document.querySelectorAll('#worker-table tbody tr');
        for (const r of rows) {
            if (r === row) continue;
            const t = r.querySelector('select:first-of-type').value;
            const d = r.querySelector('select:last-of-type').value; // Last select is Driver
            if (t === team && d === role) {
                // Conflict
                showNativeMsgBox(`${team}에는 이미 ${role}운전원이 있습니다.`);
                select.value = '-'; // Revert
                return;
            }
        }
    }
    autoSaveSettings();
}

function addWorkerRow(data = {}) {
    const tbody = document.querySelector('#worker-table tbody');
    // Fix: Check if data has keys (loaded config) or is empty (new row button)
    const rowData = Object.keys(data).length > 0 ? data : { name: '', id: '', team: 'A조', phone: '', isManager: 0, driverRole: '-' };
    addWorkerRowToTable(tbody, rowData);
    // Auto scroll to bottom of the settings content area
    const contentArea = document.querySelector('.settings-content-area');
    if (contentArea) contentArea.scrollTop = contentArea.scrollHeight;
}

function addWorkerRowToTable(tbody, data) {
    const tr = document.createElement('tr');

    // Team Options
    const teams = ['A조', 'B조', 'C조', 'D조', '일근'];
    let teamOpts = teams.map(t => `<option value="${t}" ${data.team === t ? 'selected' : ''}>${t}</option>`).join('');

    // Driver Options
    const drivers = ['-', '정', '부'];
    let driverOpts = drivers.map(d => `<option value="${d}" ${data.driverRole === d ? 'selected' : ''}>${d}</option>`).join('');

    tr.innerHTML = `
        <td><input type="text" value="${data.name || ''}" placeholder="이름" oninput="autoSaveSettings()"></td>
        <td><input type="text" value="${data.id || ''}" placeholder="사번" maxlength="6" oninput="this.value=this.value.replace(/[^0-9]/g,''); autoSaveSettings()"></td>
        <td><select onchange="autoSaveSettings()">${teamOpts}</select></td>
        <td><input type="text" value="${data.phone || ''}" placeholder="   -    -    " maxlength="13" oninput="formatPhone(this); autoSaveSettings()"></td>
        <td class="center"><input type="checkbox" ${data.isManager ? 'checked' : ''} onchange="handleManagerCheck(this)"></td>
        <td class="center"><select onchange="handleDriverChange(this)">${driverOpts}</select></td>
        <td class="center"><button class="small-btn danger" onclick="this.closest('tr').remove(); autoSaveSettings()">X</button></td>
    `;
    tbody.appendChild(tr);
}

// --- Location Logic ---
function addLocationRow(data = {}) {
    const tbody = document.querySelector('#location-table tbody');
    // Fix: Check if data has keys (loaded config) or is empty (new row button)
    const rowData = Object.keys(data).length > 0 ? data : { name: '', order: '', type: '기타업무' };
    addLocationRowToTable(tbody, rowData);
    // Auto scroll to bottom of the settings content area
    const contentArea = document.querySelector('.settings-content-area');
    if (contentArea) contentArea.scrollTop = contentArea.scrollHeight;
}

function addLocationRowToTable(tbody, data) {
    const tr = document.createElement('tr');

    // Type Options
    const types = ['변전소', '전기실', '기타업무'];
    let typeOpts = types.map(t => `<option value="${t}" ${data.type === t ? 'selected' : ''}>${t}</option>`).join('');

    tr.innerHTML = `
        <td><input type="text" value="${data.name || ''}" placeholder="장소명" oninput="autoSaveSettings()"></td>
        <td><input type="text" value="${data.order || ''}" placeholder="순서" oninput="autoSaveSettings()"></td>
        <td><select onchange="autoSaveSettings()">${typeOpts}</select></td>
        <td class="center"><button class="small-btn danger" onclick="this.closest('tr').remove(); autoSaveSettings()">X</button></td>
    `;
    tbody.appendChild(tr);
}

// --- Hotkey Logic ---
const defaultHotkeys = [
    { action: "AutoLogin", key: "#z", desc: "자동 로그인" },
    { action: "AutoLoginOpenLog", key: "#!z", desc: "자동 로그인 + 업무일지 실행" },
    { action: "ConvertExcel", key: "#!a", desc: "일반업무 -> 엑셀 변환" },
    { action: "CopyExcel", key: "#!c", desc: "엑셀 데이터 복사" },
    { action: "PasteExcel", key: "#!v", desc: "일반업무에 붙여넣기" }
];

const hotkeyTranslations = {
    "AutoLogin": "자동 로그인",
    "AutoLoginOpenLog": "자동 로그인 + 일지",
    "ConvertExcel": "엑셀 변환",
    "CopyExcel": "엑셀 복사",
    "PasteExcel": "붙여넣기"
};

function renderHotkeyTable(savedHotkeys) {
    const tbody = document.querySelector('#hotkey-table tbody');
    tbody.innerHTML = '';

    defaultHotkeys.forEach(def => {
        // Find saved state
        const saved = savedHotkeys.find(h => h.action === def.action);
        const isEnabled = saved ? saved.enabled : true;

        const tr = document.createElement('tr');
        tr.dataset.action = def.action;
        tr.dataset.key = def.key;
        tr.dataset.desc = def.desc;

        // Render Keycap
        const keyHtml = renderKeycap(def.key);
        // Translate Action Name
        const actionName = hotkeyTranslations[def.action] || def.action;

        tr.innerHTML = `
            <td>${actionName}</td>
            <td>${keyHtml}</td>
            <td class="desc-cell" title="${def.desc}">${def.desc}</td>
            <td class="center"><input type="checkbox" ${isEnabled ? 'checked' : ''} onchange="autoSaveSettings()"></td>
        `;
        tbody.appendChild(tr);
    });
}

function renderKeycap(keyStr) {
    // Replace modifiers with <kbd>
    let html = keyStr;
    // Better rendering with less spacing
    let parts = [];
    if (keyStr.includes('#')) parts.push('<kbd>Win</kbd>');
    if (keyStr.includes('^')) parts.push('<kbd>Ctrl</kbd>');
    if (keyStr.includes('!')) parts.push('<kbd>Alt</kbd>');
    if (keyStr.includes('+')) parts.push('<kbd>Shift</kbd>');

    // Extract the main key (strip modifiers)
    let mainKey = keyStr.replace(/[#^!+]/g, '');
    parts.push(`<kbd>${mainKey.toUpperCase()}</kbd>`);

    return parts.join('+'); // Removed spaces around + for tighter look
}

// --- Preset Logic ---
function renderPresetList(presetsMap) {
    const sel = document.getElementById('preset-selector');
    sel.innerHTML = '<option value="">(새 프리셋)</option>';
    if (!presetsMap) return;

    // If presetsMap is array (from v3 structure update?) or object
    // Assuming object for now based on legacy code or map
    // Check if array
    let list = Array.isArray(presetsMap) ? presetsMap : Object.keys(presetsMap).map(k => presetsMap[k]);

    list.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.text = p.name;
        sel.appendChild(opt);
    });
}

// --- Utils ---
function getVal(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
}
function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val !== undefined ? val : '';
}

function showNativeMsgBox(text, title = "알림") {
    sendMessageToAHK({ command: 'msgbox', text: text, title: title });
}


// Global Exports
window.switchMainTab = switchMainTab;
window.runTask = function (task) { showNativeMsgBox(task + ' 시작'); };
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.switchSettingsTab = switchSettingsTab;
window.tryLogin = tryLogin;
window.deleteUser = deleteUser;
window.switchView = switchView;
window.submitNewUser = submitNewUser;
window.saveSettings = saveSettings;
window.addWorkerRow = addWorkerRow;
window.addLocationRow = addLocationRow;
window.minimizeWindow = function () { sendMessageToAHK({ command: 'minimize' }); };
window.closeWindow = function () { sendMessageToAHK({ command: 'close' }); };
window.autoSaveSettings = autoSaveSettings; // Export for direct calls if needed
window.handleManagerCheck = handleManagerCheck;
window.handleDriverChange = handleDriverChange;

function formatPhone(input) {
    let value = input.value.replace(/[^0-9]/g, '');
    let formatted = '';

    if (value.length < 4) {
        formatted = value;
    } else if (value.length < 7) {
        formatted = value.substr(0, 3) + '-' + value.substr(3);
    } else if (value.length < 11) {
        // 010-123-4567 (3-3-4)
        formatted = value.substr(0, 3) + '-' + value.substr(3, 3) + '-' + value.substr(6);
    } else {
        // 010-1234-5678 (3-4-4)
        formatted = value.substr(0, 3) + '-' + value.substr(3, 4) + '-' + value.substr(7);
    }

    // Safety cut
    if (formatted.length > 13) formatted = formatted.substr(0, 13);

    input.value = formatted;
}

