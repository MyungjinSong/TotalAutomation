// app.js

// --- Global Data Store ---
let appConfig = {};
let selectedUserId = null;
let loginUsers = []; // Store user data for login validation
let isDailyLogInitialized = false; // Flag for persistence
let pendingRestoreState = null; // State waiting for config load

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

    // --- UX Improvements ---
    // 1. Numeric Input Restrictions
    const numericInputs = ['login-pw2', 'new-id', 'new-pw2', 'new-pw2-confirm', 'user-pw2'];
    numericInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/[^0-9]/g, '');

                // 2. Auto-Login Trigger (Only for login-pw2)
                if (id === 'login-pw2') {
                    checkAutoLogin(e.target.value);
                }
            });
        }
    });

    // ERP Check Order Number Restriction (Dynamic elements handled elsewhere or if static)
    // Assuming adding a global delegation or checking specific view load in future if needed.
    // For now, let's look for specific ID if it exists? 
    // The user mentioned "ERP Check tab order number", but that might be dynamically generated.
    // I will add a helper for it.
});

function checkAutoLogin(inputPw) {
    if (!selectedUserId) return;

    // Find selected user data
    // loginUsers contains profile objects directly
    const user = loginUsers.find(u => u.id === selectedUserId);
    if (user && user.pw2 === inputPw) {
        // Match found! Login immediately.
        tryLogin();
    }
}

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
            initPresets(); // Initialize Presets for Track/Vehicle Views
            if (document.getElementById('settings-view').style.display !== 'none') {
                loadSettingsToUI();
            }
            // Initialize Daily Log IF logged in and not yet done (Fix for Race Condition)
            if (selectedUserId && !isDailyLogInitialized) {
                renderDailyLogUI();
                isDailyLogInitialized = true;
            }

            // Apply pending restore if exists (Race Condition Fix)
            if (pendingRestoreState) {
                restoreUiStateData(pendingRestoreState);
                pendingRestoreState = null;
            }
            break;
        case 'releaseNotes':
            if (msg.error) {
                renderReleaseNotes(null, msg.error);
            } else {
                renderReleaseNotes(msg.data);
            }
            break;
        case 'getUiState':
            const state = collectUiState();
            sendMessageToAHK({ command: 'saveUiState', data: state });
            break;
        case 'restoreUiState':
            if (isDailyLogInitialized) {
                restoreUiStateData(msg.data);
            } else {
                pendingRestoreState = msg.data;
            }
            break;
        case 'updateERPStatus':
            handleERPStatusUpdate(msg.status);
            break;
    }
}

// --- State Persistence ---
function collectUiState() {
    const state = {
        activeView: null,
        mainTab: null,
        formData: {},
        customState: {} // Generic storage for .savable-ui elements
    };

    // 1. Active View detection
    if (document.getElementById('app-container').style.display !== 'none') state.activeView = 'app';
    else if (document.getElementById('settings-view').style.display !== 'none') state.activeView = 'settings';
    else if (document.getElementById('add-user-view').style.display !== 'none') state.activeView = 'add';
    else state.activeView = 'login'; // default

    // 2. Active Main Tab
    const activeTab = document.querySelector('.view-section.active');
    if (activeTab) state.mainTab = activeTab.id;

    // 3. Form Data
    // 모든 input, select, textarea 수집 (비밀번호 제외)
    const elements = document.querySelectorAll('input, select, textarea');
    elements.forEach(el => {
        if (!el.id) return; // ID가 없으면 복구 불가
        if (el.type === 'password') return; // 비밀번호는 제외

        // 제외할 기타 요소들이 있다면 여기서 필터링

        let value;
        if (el.type === 'checkbox') {
            value = el.checked;
        } else if (el.type === 'radio') {
            if (el.checked) value = el.value;
            else return; // 라디오는 선택된 것만 저장
        } else {
            value = el.value;
        }

        state.formData[el.id] = {
            tag: el.tagName,
            type: el.type,
            value: value
        };
    });

    // 4. Custom Savable UI
    document.querySelectorAll('.savable-ui').forEach(el => {
        const key = el.getAttribute('data-save-key');
        if (key) {
            state.customState[key] = getSavableValue(el, key);
        }
    });

    return state;
}

function getSavableValue(el, key) {
    if (key === 'erpLocation') {
        return selectedERPLocation;
    }
    // Future extensions:
    // if (key === 'someOtherWidget') return ...;
    return null;
}

function restoreUiStateData(state) {
    if (!state) return;

    // 1. Restore View
    if (state.activeView) {
        switchView(state.activeView);
    }

    // 2. Restore Main Tab (if in app view)
    if (state.activeView === 'app' && state.mainTab) {
        switchMainTab(state.mainTab);
    }

    // 3. Restore Form Data
    if (state.formData) {
        Object.keys(state.formData).forEach(id => {
            const data = state.formData[id];
            const el = document.getElementById(id);
            if (!el) return;

            // 타입 검사 등 안전장치
            if (el.type === 'checkbox') {
                el.checked = data.value;
            } else if (el.type === 'radio') {
                // 라디오는 같은 Name 그룹 내에서 해당 ID를 체크
                el.checked = true;
            } else {
                el.value = data.value;
            }

            // Trigger input event for auto-save logic or UI updates
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }



    // 4. Restore Custom UI
    if (state.customState) {
        Object.keys(state.customState).forEach(key => {
            const val = state.customState[key];
            // Find element by key
            const el = document.querySelector(`.savable-ui[data-save-key="${key}"]`);
            if (el) {
                applySavableValue(el, key, val);
            }
        });
    }

}

function applySavableValue(el, key, value) {
    if (key === 'erpLocation') {
        selectedERPLocation = value;
        // Search and Select Button
        // Wait a bit for dynamic content if needed, though usually loaded by now
        setTimeout(() => {
            const buttons = el.querySelectorAll('.erp-btn');
            buttons.forEach(btn => {
                if (btn.innerText === value) {
                    btn.classList.add('selected');
                } else {
                    btn.classList.remove('selected');
                }
            });
        }, 50);
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

    if (viewId === 'view-erp-check') {
        // Apply User Preference for Inspector Format
        // Logic: If user has a specific preference, override the current state?
        // Or only set initial state? "Initial value" was requested.
        // Let's set it based on config every time we switch to this tab.
        const uid = selectedUserId;
        if (uid && appConfig.users && appConfig.users[uid]) {
            const pref = appConfig.users[uid].profile.erpFormat || 'summary';
            const toggle = document.getElementById('toggle-worker-format');
            // summary = unchecked, list = checked
            const shouldBeChecked = (pref === 'list');
            if (toggle.checked !== shouldBeChecked) {
                toggle.checked = shouldBeChecked;
                updateToggleStyle();
                // Note: We do NOT dispatch 'change' event here to avoid triggering auto-save indirectly
                // (though we added the guard clause just in case)
            }
        }
        renderERPCheck();
    } else if (viewId === 'view-daily-log') {
        // Only render if NOT initialized yet (Persistence Fix)
        if (!isDailyLogInitialized) {
            renderDailyLogUI();
        }
    }
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

    // Auto-init Daily Log View (Work Type Auto-selection)
    // Wait for Config Load (Race Condition Fix)
    // renderDailyLogUI(); // Removed here, moved to loadConfig
    isDailyLogInitialized = false; // Add this line to ensure reset

    switchMainTab('view-daily-log');
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
    if (!uid || !appConfig.users) return;

    // Revert: users is an Object (Map) keyed by ID
    const user = appConfig.users[uid];
    if (!user) return;

    const profile = user.profile || {};

    setVal('user-name', profile.name);
    setVal('user-id', profile.id);
    setVal('user-dept', profile.department);
    setVal('user-team', profile.team);
    setVal('user-webpw', profile.webPW);
    setVal('user-pw2', profile.pw2);
    setVal('user-pw2', profile.pw2);
    setVal('user-sappw', profile.sapPW);
    // New Setting: Inspector Display Format Preference (Default: summary)
    setVal('erp-format-pref', profile.erpFormat || 'summary');

    // DEBUG: Trace Data
    // showNativeMsgBox("UI Load for " + uid + " | Workers: " + appConfig.appSettings?.colleagues?.length, "Debug");

    // Attach AutoSave to User Info inputs
    ['user-dept', 'user-team', 'user-webpw', 'user-pw2', 'user-sappw'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.oninput = autoSaveSettings;
        if (el && el.tagName === 'SELECT') el.onchange = autoSaveSettings;
    });

    // Workers (Global from appSettings)
    const wBody = document.querySelector('#worker-table tbody');
    wBody.innerHTML = '';
    const globalWorkers = appConfig.appSettings?.colleagues || [];
    globalWorkers.forEach(w => addWorkerRowToTable(wBody, w));

    // Locations (Global)
    const lBody = document.querySelector('#location-table tbody');
    lBody.innerHTML = '';
    const globalLocs = (appConfig.appSettings && appConfig.appSettings.locations) ? appConfig.appSettings.locations : [];
    globalLocs.forEach(l => addLocationRowToTable(lBody, l));

    // Hotkeys
    const hBody = document.querySelector('#hotkey-table tbody');
    hBody.innerHTML = '';
    const hotkeys = user.hotkeys || [];
    renderHotkeyTable(hotkeys);

    // Presets
    renderPresetList(user.presets || {});

}

function saveSettings() {
    try {
        // [CRITICAL FIX] Prevent Auto-Save when Settings View is hidden
        // This prevents wiping data if called unintentionally from other views
        if (document.getElementById('settings-view').style.display === 'none') return;

        const uid = selectedUserId;
        if (!uid || !appConfig.users) return;

        // Revert: users is an Object (Map) keyed by ID
        const user = appConfig.users[uid];
        if (!user) return; // Should not happen if logged in

        if (!user.profile) user.profile = {};

        user.profile.department = getVal('user-dept');
        user.profile.team = getVal('user-team');
        user.profile.webPW = getVal('user-webpw');
        user.profile.pw2 = getVal('user-pw2');
        user.profile.sapPW = getVal('user-sappw');
        // New Setting: Inspector Display Format Preference
        user.profile.erpFormat = getVal('erp-format-pref');


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

        if (!appConfig.appSettings) appConfig.appSettings = {};
        appConfig.appSettings.colleagues = newWorkers;

        // Gather Locations (Global)
        const newLocs = [];
        document.querySelectorAll('#location-table tbody tr').forEach(row => {
            const inputs = row.querySelectorAll('input, select');
            newLocs.push({
                name: inputs[0].value,
                order: inputs[1].value,
                type: inputs[2].value
            });
        });

        if (!appConfig.appSettings) appConfig.appSettings = {};
        appConfig.appSettings.locations = newLocs;

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
    } catch (e) {
        showNativeMsgBox("설정 저장 중 오류: " + e.message);
    }
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
    const types = ['변전소', '전기실(그룹1)', '전기실(그룹2)', '전기실(그룹3)', '기타업무'];
    let typeOpts = types.map(t => `<option value="${t}" ${data.type === t ? 'selected' : ''}>${t}</option>`).join('');

    tr.innerHTML = `
        <td><input type="text" value="${data.name || ''}" placeholder="점검명" oninput="autoSaveSettings()"></td>
        <td><input type="text" value="${data.order || ''}" placeholder="오더번호" maxlength="8" oninput="this.value=this.value.replace(/[^0-9]/g,''); autoSaveSettings()"></td>
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
    { action: "PasteExcel", key: "#!v", desc: "일반업무에 붙여넣기" },
    { action: "ForceExit", key: "^Esc", desc: "강제 종료" }
];

const hotkeyTranslations = {
    "AutoLogin": "자동 로그인",
    "AutoLoginOpenLog": "자동 로그인 + 일지",
    "ConvertExcel": "엑셀 변환",
    "CopyExcel": "엑셀 복사",
    "PasteExcel": "붙여넣기",
    "ForceExit": "강제 종료"
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

// --- ERP Check Logic ---
let selectedERPLocation = null;

function renderERPCheck() {
    // 1. Get global locations
    const locations = (appConfig.appSettings && appConfig.appSettings.locations) ? appConfig.appSettings.locations : [];

    // 2. Clear containers
    const gridSub = document.getElementById('grid-substation');
    const gridEtc = document.getElementById('grid-etc');
    const elG1 = document.getElementById('elec-g1');
    const elG2 = document.getElementById('elec-g2');
    const elG3 = document.getElementById('elec-g3');

    if (gridSub) gridSub.innerHTML = '';
    if (gridEtc) gridEtc.innerHTML = '';
    if (elG1) elG1.innerHTML = '';
    if (elG2) elG2.innerHTML = '';
    if (elG3) elG3.innerHTML = '';

    selectedERPLocation = null; // Reset selection

    // 3. Process Items
    locations.forEach(loc => {
        const btn = document.createElement('div');
        btn.className = 'erp-btn';
        // Use TextNode to avoid overwriting span later if we appended
        btn.appendChild(document.createTextNode(loc.name));

        btn.dataset.locName = loc.name;
        btn.onclick = () => selectERPLoc(btn, loc.name);

        if (loc.type === '변전소') {
            // Default Status Dot (Yellow)
            const dot = document.createElement('span');
            dot.className = 'status-dot';
            dot.style.fontSize = '1.2em';
            dot.style.marginLeft = '5px';
            dot.style.fontWeight = 'bold';
            dot.style.color = '#FFC107'; // Amber/Yellow
            dot.innerText = '●';
            dot.title = "데이터 확인 중..."; // Initial tooltip
            btn.appendChild(dot);

            gridSub.appendChild(btn);
        } else if (loc.type === '기타업무') {
            gridEtc.appendChild(btn);
        } else if (loc.type.startsWith('전기실')) {
            // Group Matching
            if (loc.type.includes('그룹1')) {
                elG1.appendChild(btn);
            } else if (loc.type.includes('그룹2')) {
                elG2.appendChild(btn);
            } else if (loc.type.includes('그룹3')) {
                elG3.appendChild(btn);
            } else {
                gridEtc.appendChild(btn);
            }
        }
    });

    // Apply cached status if available
    handleERPStatusUpdate(null);
}

// ... (SelectERPLoc, Toggle, Run logic skipped/unchanged) ...

// --- ERP Status Update (Polling) ---
let latestERPStatus = null;

function handleERPStatusUpdate(statusMap) {
    if (statusMap) {
        latestERPStatus = statusMap;
    } else if (latestERPStatus) {
        statusMap = latestERPStatus;
    } else {
        return; // Keep Yellow
    }

    const btns = document.querySelectorAll('#grid-substation .erp-btn[data-loc-name]');

    btns.forEach(btn => {
        const locName = btn.dataset.locName;
        const dot = btn.querySelector('.status-dot');

        if (dot) {
            // AHK JSON serialization might send 1 instead of true
            const isUpdated = statusMap[locName] ? true : false;
            dot.style.color = isUpdated ? '#4CAF50' : '#FF0000'; // Green vs Red
            dot.title = isUpdated ? "점검 완료 (오늘)" : "점검 미완료";

            // Re-assert visibility (in case)
            dot.style.display = 'inline';
        }
    });
}
window.handleERPStatusUpdate = handleERPStatusUpdate;

function selectERPLoc(btn, locName) {
    // Deselect all
    document.querySelectorAll('.erp-btn').forEach(el => el.classList.remove('selected'));

    // Select this
    btn.classList.add('selected');
    selectedERPLocation = locName;
}

function toggleERPMode() {
    const btn = document.getElementById('btn-erp-mode');
    if (btn.innerText.includes('일괄모드')) {
        btn.innerText = '< 개별모드';
        // TODO: Switch to Batch UI (Future)
        showNativeMsgBox("일괄모드 준비 중입니다.");
    } else {
        btn.innerText = '일괄모드 >';
        // Switch back to Individual UI
    }
}

function runERPTask() {
    const btn = document.getElementById('btn-erp-mode');
    if (btn.innerText.includes('개별모드')) {
        // Batch Mode Run
        showNativeMsgBox("일괄모드 실행 (준비중)");
        return;
    }

    if (!selectedERPLocation) {
        showNativeMsgBox("점검 장소를 선택해주세요.");
        return;
    }

    // Send to AHK
    sendMessageToAHK({ command: 'runTask', task: 'ERPCheck', location: selectedERPLocation });

    // UI Feedback is handled by AHK or we can add it here if needed
    // showNativeMsgBox(selectedERPLocation + " 점검 시작 요청");
}



// --- Daily Log Logic ---
function renderDailyLogUI() {
    const uid = selectedUserId;
    if (!uid || !appConfig.users || !appConfig.users[uid]) return;

    // 1. Determine Work Type (Day/Night) based on Time
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const timeVal = hours * 100 + minutes;

    // Logic: Day if Mon-Fri (1-5) AND 08:30 <= Time < 17:30
    let isDay = false;
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        if (timeVal >= 830 && timeVal < 1730) {
            isDay = true;
        }
    }

    // Set Radio Button
    const radioDay = document.querySelector('input[name="work-type"][value="day"]');
    const radioNight = document.querySelector('input[name="work-type"][value="night"]');
    if (isDay) {
        radioDay.checked = true;
    } else {
        radioNight.checked = true;
    }

    // Apply Automation Options based on Work Type
    handleWorkTypeChange(false); // Validates and sets checkboxes

    // 2. Render Worker List
    // 2. Render Worker List
    renderDailyWorkerList();

    isDailyLogInitialized = true;
}

function handleWorkTypeChange(skipRenderWorkers = true) {
    const isDay = document.querySelector('input[name="work-type"][value="day"]').checked;

    // Checkboxes
    const chkMakeLog = document.getElementById('chk-make-log');
    const chkGeneral = document.getElementById('chk-general');
    const chkSafe = document.getElementById('chk-safe-manage');
    const chkDriving = document.getElementById('chk-driving');
    const chkDrink = document.getElementById('chk-drink');
    const chkCal = document.getElementById('chk-drink-cal');

    if (isDay) {
        // Day Mode
        chkMakeLog.checked = true;
        chkMakeLog.disabled = false;

        chkDriving.checked = false;
        chkDriving.disabled = true; // Disabled for Day

        chkDrink.disabled = false; // Enabled for Day

        // Calibration check state depends on Drink check
        if (chkDrink.checked) {
            chkCal.disabled = false;
        } else {
            chkCal.disabled = true;
        }

    } else {
        // Night Mode
        chkMakeLog.checked = false;
        chkMakeLog.disabled = true; // Disabled for Night

        chkDriving.checked = true;
        chkDriving.disabled = false;

        chkDrink.disabled = true;
        chkDrink.checked = false;
        chkCal.disabled = true;
        chkCal.checked = false;
    }

    enableDriverSelects(!isDay);

    // Toggle Driver Column Visibility
    const drvHeader = document.getElementById('col-header-drive');
    if (drvHeader) {
        if (isDay) {
            drvHeader.classList.add('hidden-col');
        } else {
            drvHeader.classList.remove('hidden-col');
        }
    }

    // Toggle Cells
    document.querySelectorAll('.w-drive-cell').forEach(cell => {
        if (isDay) {
            cell.classList.add('hidden-col');
        } else {
            cell.classList.remove('hidden-col');
        }
    });

}

function toggleDrinkCalibration() {
    const chkDrink = document.getElementById('chk-drink');
    const chkCal = document.getElementById('chk-drink-cal');
    if (chkDrink.checked) {
        chkCal.disabled = false;
    } else {
        chkCal.disabled = true;
        chkCal.checked = false;
    }
}

function renderDailyWorkerList() {
    const container = document.getElementById('daily-worker-list');
    container.innerHTML = '';
    // const countSpan = document.getElementById('worker-count'); // Removed

    // Get Current User ID & Profile
    const uid = selectedUserId;
    if (!uid || !appConfig.users || !appConfig.users[uid]) return;
    const user = appConfig.users[uid];

    // Use Global Colleagues
    const allColleagues = appConfig.appSettings?.colleagues || [];
    const myTeam = (user.profile && user.profile.team) ? user.profile.team : '';

    // Filter: Same Team OR '일근'
    const filteredWorkers = allColleagues.filter(w => {
        if (w.team === '일근') return true;
        if (myTeam && w.team === myTeam) return true;
        return false;
    });

    // Sort: Manager First (isManager=1), then ID (asc)
    const sortedWorkers = [...filteredWorkers].sort((a, b) => {
        if (a.isManager !== b.isManager) return b.isManager - a.isManager; // 1 before 0
        return a.id.localeCompare(b.id);
    });

    sortedWorkers.forEach((worker, index) => {
        const row = document.createElement('div');
        row.className = 'worker-row';
        row.dataset.id = worker.id;
        row.dataset.name = worker.name;

        // Default Checked logic: Select All by default
        const isChecked = true;

        // Dynamic Driver Column
        const isDay = document.querySelector('input[name="work-type"][value="day"]').checked;
        const driveClass = isDay ? 'wl-drive hidden-col w-drive-cell' : 'wl-drive w-drive-cell';

        row.innerHTML = `
            <label class="wl-name checkbox-label" style="margin: 0;" for="chk-worker-${worker.id}">
                <input type="checkbox" ${isChecked ? 'checked' : ''} class="w-chk" id="chk-worker-${worker.id}">
                <span>${worker.name}</span>
            </label>
            <div class="wl-note"><input type="text" placeholder="사유" class="w-note" id="note-worker-${worker.id}"></div>
            <div class="${driveClass}">
                <select class="w-drive" disabled id="drv-worker-${worker.id}">
                    <option value="">-</option>
                    <option value="정" ${worker.driverRole === '정' ? 'selected' : ''}>정</option>
                    <option value="부" ${worker.driverRole === '부' ? 'selected' : ''}>부</option>
                    <option value="검사자" ${worker.driverRole === '검사자' ? 'selected' : ''}>검사자</option>
                </select>
            </div>
        `;
        container.appendChild(row);

        // Add Listeners
        const chk = row.querySelector('.w-chk');
        const note = row.querySelector('.w-note');
        const drv = row.querySelector('.w-drive');

        // Logic: If Note has text (vacation), Uncheck.
        note.addEventListener('input', () => {
            if (note.value.trim() !== '' && note.value !== '일근') {
                chk.checked = false;
            } else {
                // Optional: Re-check if cleared?
                // chk.checked = true; 
            }
            updateWorkerStats();
        });

        chk.addEventListener('change', () => {
            updateWorkerStats();
            if (!chk.checked) drv.value = '';
        });
    });

    // countSpan.innerText = `총 ${filteredWorkers.length}명`; // Removed

    // Initial Driver Enable Check
    const isDay = document.querySelector('input[name="work-type"][value="day"]').checked;
    enableDriverSelects(!isDay);
}

function enableDriverSelects(enable) {
    document.querySelectorAll('.w-drive').forEach(el => {
        el.disabled = !enable;
    });
}

function toggleAllWorkers(mainChk) {
    const chks = document.querySelectorAll('#daily-worker-list .w-chk');
    chks.forEach(c => c.checked = mainChk.checked);
    updateWorkerStats();
}

function updateWorkerStats() {
    // Placeholder for stats logic
}

function startDailyLog() {
    const uid = selectedUserId;
    if (!uid) return;

    const workType = document.querySelector('input[name="work-type"]:checked').value; // 'day' or 'night'

    // Gather Options
    const options = {
        makeLog: document.getElementById('chk-make-log').checked,
        general: document.getElementById('chk-general').checked,
        safe: document.getElementById('chk-safe-manage').checked,
        driving: document.getElementById('chk-driving').checked,
        drink: document.getElementById('chk-drink').checked
    };

    // Gather Workers
    const workers = [];
    document.querySelectorAll('.worker-row').forEach(row => {
        const chk = row.querySelector('.w-chk');
        const note = row.querySelector('.w-note');
        const drv = row.querySelector('.w-drive');

        workers.push({
            name: row.dataset.name,
            id: row.dataset.id,
            attend: chk.checked,
            reason: note.value,
            driverRole: drv.value
        });
    });

    const payload = {
        command: 'runTask',
        task: 'DailyLog',
        data: {
            workType,
            options,
            workers
        }
    };
    sendMessageToAHK(payload);
}


// Global Exports
window.switchMainTab = switchMainTab;
window.runTask = function (task) { sendMessageToAHK({ command: 'runTask', task: task }); };
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
window.autoSaveSettings = autoSaveSettings;
window.handleManagerCheck = handleManagerCheck;
window.handleDriverChange = handleDriverChange;

// Daily Log Exports
// --- ERP Worker Modal Logic ---

let erpModalWorkerList = []; // Cache list

function openERPWorkerModal() {
    if (!selectedERPLocation) {
        showNativeMsgBox("점검 장소를 선택해주세요.");
        return;
    }

    // [New Logic] Check Substation Type & Trigger Pre-Check
    const uid = selectedUserId;
    if (uid && appConfig.appSettings && appConfig.appSettings.locations) {
        const locData = appConfig.appSettings.locations.find(l => l.name === selectedERPLocation);
        if (locData && locData.type === '변전소') {
            // Trigger AHK Pre-Check (Async/Blocking handled by AHK MsgBox)
            sendMessageToAHK({ command: 'checkSubstation', location: selectedERPLocation });
            // Note: If AHK shows a blocking MsgBox, the WebView might pause or waiting
            // user interaction on the AHK side.
        }
    }

    const modal = document.getElementById('erp-worker-modal');
    modal.style.display = 'flex';

    // Sync Toggle State from Main Tab
    const mainToggle = document.getElementById('toggle-worker-format');
    updateModalToggleState(mainToggle.checked);

    // Render List
    renderERPWorkerList();
}

function closeERPWorkerModal() {
    document.getElementById('erp-worker-modal').style.display = 'none';
}

function renderERPWorkerList() {
    const uid = selectedUserId;
    if (!uid || !appConfig.users || !appConfig.users[uid]) return;

    // Use global appSettings.colleagues
    const allColleagues = appConfig.appSettings?.colleagues || [];

    // Get My Team
    const user = appConfig.users[uid];
    const myTeam = (user.profile && user.profile.team) ? user.profile.team : '';

    const container = document.getElementById('erp-worker-list');
    container.innerHTML = '';

    // Filter: ID Match (if needed) or Team Match
    // Logic: Config colleagues contains EVERYONE. We need to filter by myTeam.
    const filteredWorkers = allColleagues.filter(w => {
        if (myTeam && w.team === myTeam) return true;
        return false;
    });

    if (filteredWorkers.length === 0) {
        container.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:#999;">점검자 목록이 없습니다.<br>설정에서 작업자를 추가해주세요.</div>';
        return;
    }

    // Sort: Manager First, then ID
    const sortedWorkers = [...filteredWorkers].sort((a, b) => {
        if (a.isManager !== b.isManager) return b.isManager - a.isManager;
        return a.id.localeCompare(b.id);
    });

    erpModalWorkerList = sortedWorkers; // Cache for submission

    sortedWorkers.forEach(worker => {
        const div = document.createElement('div');
        div.className = 'worker-checkbox-item';
        // Remove custom onclick handler (causes double-toggle with label)

        const isChecked = true; // Default Select All

        div.innerHTML = `
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; width:100%; color:black;">
                <input type="checkbox" id="chk-erp-${worker.id}" ${isChecked ? 'checked' : ''} value="${worker.name}" onchange="updateModalButtonText()" style="width:16px; height:16px; accent-color:#4CAF50;">
                <span style="font-size:14px; margin-top:1px;">${worker.name}</span>
            </label>
        `;
        container.appendChild(div);
    });

    // Initial Button Text Update
    updateModalButtonText();
}

function toggleModalWorkerFormat() {
    // Toggle the Main Tab Switch (Source of Truth)
    const mainToggle = document.getElementById('toggle-worker-format');
    mainToggle.checked = !mainToggle.checked;

    // Trigger change event to save state if needed (savable-ui) and update styles
    mainToggle.dispatchEvent(new Event('change', { bubbles: true }));

    updateModalToggleState(mainToggle.checked);
    updateModalButtonText(); // Update text format
}

function updateModalToggleState(isListMode) {
    // No longer changing button text here based on mode alone, 
    // now we update based on selection + mode in updateModalButtonText
}

// Renamed/Refactored: Updates the button text dynamically
function updateModalButtonText() {
    const isListMode = document.getElementById('toggle-worker-format').checked;
    const btn = document.getElementById('btn-erp-modal-toggle');

    // Gather selected names
    const selectedNames = [];
    const checkboxes = document.querySelectorAll('#erp-worker-list input[type="checkbox"]');
    checkboxes.forEach(c => {
        if (c.checked) selectedNames.push(c.value);
    });

    if (selectedNames.length === 0) {
        btn.innerText = "(선택 없음)";
        return;
    }

    if (isListMode) {
        // List Mode: "Name1, Name2, Name3"
        btn.innerText = selectedNames.join(', ');
    } else {
        // Summary Mode: "Name1 외 N명"
        if (selectedNames.length === 1) {
            btn.innerText = selectedNames[0];
        } else {
            btn.innerText = `${selectedNames[0]} 외 ${selectedNames.length - 1}명`;
        }
    }
}

function submitERPTask() {
    // 1. Gather Selected Workers
    const selectedNames = [];
    const checkboxes = document.querySelectorAll('#erp-worker-list input[type="checkbox"]');
    checkboxes.forEach(c => {
        if (c.checked) selectedNames.push(c.value);
    });

    if (selectedNames.length === 0) {
        showNativeMsgBox("작업자를 한 명 이상 선택해주세요.");
        return;
    }

    // 2. Check Format
    const isListMode = document.getElementById('toggle-worker-format').checked;
    const format = isListMode ? 'list' : 'summary';

    // 3. Find Location Data (Type, Order)
    const locName = selectedERPLocation;
    let locType = "";
    let locOrder = "";

    // appConfig.appSettings.locations should be available
    if (appConfig.appSettings && appConfig.appSettings.locations) {
        const locObj = appConfig.appSettings.locations.find(l => l.name === locName);
        if (locObj) {
            locType = locObj.type || "";
            locOrder = locObj.order || "";
        }
    }

    // 4. Send to AHK
    sendMessageToAHK({
        command: 'runTask',
        task: 'ERPCheck',
        location: locName,
        targetType: locType,
        targetOrder: locOrder,
        members: selectedNames,
        format: format
    });

    closeERPWorkerModal();
}

function updateToggleStyle() {
    const toggle = document.getElementById('toggle-worker-format');
    const lblSummary = document.getElementById('lbl-format-summary');
    const lblList = document.getElementById('lbl-format-list');

    if (toggle.checked) {
        // List Mode Checked
        if (lblSummary) lblSummary.classList.remove('bold-active');
        if (lblList) lblList.classList.add('bold-active');
    } else {
        // Summary Mode Unchecked
        if (lblSummary) lblSummary.classList.add('bold-active');
        if (lblList) lblList.classList.remove('bold-active');
    }
    autoSaveSettings();
}

// Global Exports
window.openERPWorkerModal = openERPWorkerModal;
window.closeERPWorkerModal = closeERPWorkerModal;
window.toggleModalWorkerFormat = toggleModalWorkerFormat;
window.submitERPTask = submitERPTask;
window.handleWorkTypeChange = handleWorkTypeChange;
window.toggleAllWorkers = toggleAllWorkers;
window.updateToggleStyle = updateToggleStyle;
window.startDailyLog = startDailyLog;
window.toggleDrinkCalibration = toggleDrinkCalibration;

// --- Helper: Preset Management ---
function getUserPresets(type) {
    const uid = selectedUserId;
    if (!uid || !appConfig.users || !appConfig.users[uid]) return {};
    const user = appConfig.users[uid];
    if (type === 'track') return user.trackPresets || {};
    if (type === 'vehicle') return user.vehiclePresets || {};
    return {};
}

function saveUserPresets(type, presets) {
    const uid = selectedUserId;
    if (!uid) return;
    if (!appConfig.users[uid]) return;

    if (type === 'track') appConfig.users[uid].trackPresets = presets;
    if (type === 'vehicle') appConfig.users[uid].vehiclePresets = presets;

    sendMessageToAHK({ command: 'saveConfig', data: appConfig });
}

function renderPresetOptions(selectId, presets) {
    const sel = document.getElementById(selectId);
    if (!sel) return;

    // Keep selection if possible
    const currentVal = sel.value;

    sel.innerHTML = '<option value="">프리셋 선택...</option>';

    Object.keys(presets).forEach(key => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.text = key;
        sel.appendChild(opt);
    });

    // "New Preset" Option
    const newOpt = document.createElement('option');
    newOpt.value = "__NEW__";
    newOpt.text = "+ 새 프리셋 추가";
    newOpt.style.fontWeight = "bold";
    newOpt.style.color = "#0063B5";
    sel.appendChild(newOpt);

    if (presets[currentVal] || currentVal === '__NEW__') sel.value = currentVal;
    if (!currentVal && Object.keys(presets).length > 0) sel.value = ""; // Default empty
}

// --- Track Access Logic ---
function loadTrackPreset() {
    const sel = document.getElementById('track-preset-sel');
    const key = sel.value;

    if (key === '__NEW__') {
        // Clear Form for New Entry
        setVal('ta-work-type', '1');
        setVal('ta-work-content', '');
        setVal('ta-work-from', '');
        setVal('ta-work-to', '');
        setVal('ta-driver-name', '');
        setVal('ta-driver-phone', '');
        setVal('ta-worker-name', '');
        setVal('ta-worker-phone', '');
        setVal('ta-safety-name', '');
        setVal('ta-safety-phone', '');
        setVal('ta-supervisor-id', '');

        setVal('ta-work-start', '');
        setVal('ta-work-end', '');
        setVal('ta-op-start', '');
        setVal('ta-op-end', '');
        setVal('ta-line', '1');
        setVal('ta-track-type', '1');
        if (document.getElementById('ta-track-cutoff')) document.getElementById('ta-track-cutoff').checked = false;
        setVal('ta-agreement-no', '');
        setVal('ta-total-count', '');
        if (document.getElementById('ta-station-input')) document.getElementById('ta-station-input').checked = false;
        return;
    }

    if (!key) return;

    const presets = getUserPresets('track');
    const data = presets[key];

    if (data) {
        setVal('ta-work-type', data.workType);
        setVal('ta-work-content', data.content);
        setVal('ta-work-from', data.workFrom);
        setVal('ta-work-to', data.workTo);
        setVal('ta-driver-name', data.driverName);
        setVal('ta-driver-phone', data.driverPhone);
        setVal('ta-worker-name', data.workerName);
        setVal('ta-worker-phone', data.workerPhone);
        setVal('ta-safety-name', data.safetyName);
        setVal('ta-safety-phone', data.safetyPhone);
        setVal('ta-supervisor-id', data.supervisorId);

        setVal('ta-work-start', data.workStart);
        setVal('ta-work-end', data.workEnd);
        setVal('ta-op-start', data.opStart);
        setVal('ta-op-end', data.opEnd);
        setVal('ta-line', data.line);
        setVal('ta-track-type', data.trackType);

        if (document.getElementById('ta-track-cutoff')) document.getElementById('ta-track-cutoff').checked = !!data.trackCutoff;
        setVal('ta-agreement-no', data.agreementNo);
        setVal('ta-total-count', data.totalCount);
        if (document.getElementById('ta-station-input')) document.getElementById('ta-station-input').checked = !!data.stationInput;
    }
}

function saveTrackPreset() {
    const sel = document.getElementById('track-preset-sel');
    let key = sel.value;

    if (!key || key === '__NEW__') {
        const newName = prompt("새 프리셋 이름을 입력하세요:");
        if (!newName) return;
        key = newName;
    }

    const data = {
        workType: getVal('ta-work-type'),
        content: getVal('ta-work-content'),
        workFrom: getVal('ta-work-from'),
        workTo: getVal('ta-work-to'),
        driverName: getVal('ta-driver-name'),
        driverPhone: getVal('ta-driver-phone'),
        workerName: getVal('ta-worker-name'),
        workerPhone: getVal('ta-worker-phone'),
        safetyName: getVal('ta-safety-name'),
        safetyPhone: getVal('ta-safety-phone'),
        supervisorId: getVal('ta-supervisor-id'),

        workStart: getVal('ta-work-start'),
        workEnd: getVal('ta-work-end'),
        opStart: getVal('ta-op-start'),
        opEnd: getVal('ta-op-end'),
        line: getVal('ta-line'),
        trackType: getVal('ta-track-type'),
        trackCutoff: document.getElementById('ta-track-cutoff') ? document.getElementById('ta-track-cutoff').checked : false,
        agreementNo: getVal('ta-agreement-no'),
        totalCount: getVal('ta-total-count'),
        stationInput: document.getElementById('ta-station-input') ? document.getElementById('ta-station-input').checked : false
    };

    const presets = getUserPresets('track');
    presets[key] = data;
    saveUserPresets('track', presets);

    renderPresetOptions('track-preset-sel', presets);
    sel.value = key;

    showNativeMsgBox(`'${key}' 프리셋이 저장되었습니다.`);
}

function renameTrackPreset() {
    const sel = document.getElementById('track-preset-sel');
    const oldKey = sel.value;
    if (!oldKey || oldKey === '__NEW__') {
        showNativeMsgBox("이름을 변경할 프리셋을 선택해주세요.");
        return;
    }

    const newKey = prompt("새 이름을 입력하세요:", oldKey);
    if (!newKey || newKey === oldKey) return;

    const presets = getUserPresets('track');
    if (presets[newKey]) {
        showNativeMsgBox("이미 존재하는 이름입니다.");
        return;
    }

    presets[newKey] = presets[oldKey];
    delete presets[oldKey];
    saveUserPresets('track', presets);

    renderPresetOptions('track-preset-sel', presets);
    sel.value = newKey;
}

function deleteTrackPreset() {
    const sel = document.getElementById('track-preset-sel');
    const key = sel.value;
    if (!key || key === '__NEW__') {
        showNativeMsgBox("삭제할 프리셋을 선택해주세요.");
        return;
    }

    if (!confirm(`'${key}' 프리셋을 삭제하시겠습니까?`)) return;

    const presets = getUserPresets('track');
    delete presets[key];
    saveUserPresets('track', presets);

    renderPresetOptions('track-preset-sel', presets);
    sel.value = "";
}

function runTrackAccessTask() {
    const data = {
        workType: getVal('ta-work-type'),
        content: getVal('ta-work-content'),
        workFrom: getVal('ta-work-from'),
        workTo: getVal('ta-work-to'),
        driverName: getVal('ta-driver-name'),
        driverPhone: getVal('ta-driver-phone'),
        workerName: getVal('ta-worker-name'),
        workerPhone: getVal('ta-worker-phone'),
        safetyName: getVal('ta-safety-name'),
        safetyPhone: getVal('ta-safety-phone'),
        supervisorId: getVal('ta-supervisor-id'),

        workStart: getVal('ta-work-start'),
        workEnd: getVal('ta-work-end'),
        opStart: getVal('ta-op-start'),
        opEnd: getVal('ta-op-end'),
        line: getVal('ta-line'),
        trackType: getVal('ta-track-type'),
        trackCutoff: document.getElementById('ta-track-cutoff') ? document.getElementById('ta-track-cutoff').checked : false,
        agreementNo: getVal('ta-agreement-no'),
        totalCount: getVal('ta-total-count'),
        stationInput: document.getElementById('ta-station-input') ? document.getElementById('ta-station-input').checked : false
    };

    sendMessageToAHK({ command: 'runTask', task: 'TrackAccess', data: data });
}


// --- Vehicle Log Logic ---
function loadVehiclePreset() {
    const sel = document.getElementById('vehicle-preset-sel');
    const key = sel.value;

    if (key === '__NEW__') {
        setVal('vl-driver', '');
        setVal('vl-point-1', '');
        setVal('vl-point-2', '');
        setVal('vl-track-type', '상행선');
        setVal('vl-start-time', '');
        setVal('vl-end-time', '');
        setVal('vl-content', '');
        setVal('vl-remarks', '');
        setVal('vl-approve-no', '');
        setVal('vl-dept', '');
        setVal('vl-approver', '');
        setVal('vl-run-time', '');
        setVal('vl-distance', '');
        return;
    }

    if (!key) return;

    const presets = getUserPresets('vehicle');
    const data = presets[key];

    if (data) {
        setVal('vl-driver', data.driver);
        setVal('vl-point-1', data.point1);
        setVal('vl-point-2', data.point2);
        setVal('vl-track-type', data.trackType);
        setVal('vl-start-time', data.startTime);
        setVal('vl-end-time', data.endTime);
        setVal('vl-content', data.content);
        setVal('vl-remarks', data.remarks);
        setVal('vl-approve-no', data.approveNo);
        setVal('vl-dept', data.dept);
        setVal('vl-approver', data.approver);
        setVal('vl-run-time', data.runTime);
        setVal('vl-distance', data.distance);
    }
}

function saveVehiclePreset() {
    const sel = document.getElementById('vehicle-preset-sel');
    let key = sel.value;

    if (!key || key === '__NEW__') {
        const newName = prompt("새 프리셋 이름을 입력하세요:");
        if (!newName) return;
        key = newName;
    }

    const data = {
        driver: getVal('vl-driver'),
        point1: getVal('vl-point-1'),
        point2: getVal('vl-point-2'),
        trackType: getVal('vl-track-type'),
        startTime: getVal('vl-start-time'),
        endTime: getVal('vl-end-time'),
        content: getVal('vl-content'),
        remarks: getVal('vl-remarks'),
        approveNo: getVal('vl-approve-no'),
        dept: getVal('vl-dept'),
        approver: getVal('vl-approver'),
        runTime: getVal('vl-run-time'),
        distance: getVal('vl-distance')
    };

    const presets = getUserPresets('vehicle');
    presets[key] = data;
    saveUserPresets('vehicle', presets);

    renderPresetOptions('vehicle-preset-sel', presets);
    sel.value = key;

    showNativeMsgBox(`'${key}' 프리셋이 저장되었습니다.`);
}

function renameVehiclePreset() {
    const sel = document.getElementById('vehicle-preset-sel');
    const oldKey = sel.value;
    if (!oldKey || oldKey === '__NEW__') {
        showNativeMsgBox("이름을 변경할 프리셋을 선택해주세요.");
        return;
    }

    const newKey = prompt("새 이름을 입력하세요:", oldKey);
    if (!newKey || newKey === oldKey) return;

    const presets = getUserPresets('vehicle');
    if (presets[newKey]) {
        showNativeMsgBox("이미 존재하는 이름입니다.");
        return;
    }

    presets[newKey] = presets[oldKey];
    delete presets[oldKey];
    saveUserPresets('vehicle', presets);

    renderPresetOptions('vehicle-preset-sel', presets);
    sel.value = newKey;
}

function deleteVehiclePreset() {
    const sel = document.getElementById('vehicle-preset-sel');
    const key = sel.value;
    if (!key || key === '__NEW__') {
        showNativeMsgBox("삭제할 프리셋을 선택해주세요.");
        return;
    }

    if (!confirm(`'${key}' 프리셋을 삭제하시겠습니까?`)) return;

    const presets = getUserPresets('vehicle');
    delete presets[key];
    saveUserPresets('vehicle', presets);

    renderPresetOptions('vehicle-preset-sel', presets);
    sel.value = "";
}

function runVehicleLogTask() {
    const data = {
        driver: getVal('vl-driver'),
        point1: getVal('vl-point-1'),
        point2: getVal('vl-point-2'),
        trackType: getVal('vl-track-type'),
        startTime: getVal('vl-start-time'),
        endTime: getVal('vl-end-time'),
        content: getVal('vl-content'),
        remarks: getVal('vl-remarks'),
        approveNo: getVal('vl-approve-no'),
        dept: getVal('vl-dept'),
        approver: getVal('vl-approver'),
        runTime: getVal('vl-run-time'),
        distance: getVal('vl-distance')
    };

    sendMessageToAHK({ command: 'runTask', task: 'VehicleLog', data: data });
}

// Execute 'runBringApproved' command
function runBringApproved() {
    sendMessageToAHK({ command: 'runTask', task: 'runBringApproved' });
}

// Helpers
function getVal(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
}

function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
}

// Helper: Init Presets after login
function initPresets() {
    const trackPresets = getUserPresets('track');
    const vehiclePresets = getUserPresets('vehicle');
    renderPresetOptions('track-preset-sel', trackPresets);
    renderPresetOptions('vehicle-preset-sel', vehiclePresets);
}


// Export new functions
window.loadTrackPreset = loadTrackPreset;
window.saveTrackPreset = saveTrackPreset;
window.renameTrackPreset = renameTrackPreset;
window.deleteTrackPreset = deleteTrackPreset;
window.runTrackAccessTask = runTrackAccessTask;

window.loadVehiclePreset = loadVehiclePreset;
window.saveVehiclePreset = saveVehiclePreset;
window.renameVehiclePreset = renameVehiclePreset;
window.deleteVehiclePreset = deleteVehiclePreset;
window.runVehicleLogTask = runVehicleLogTask;
window.initPresets = initPresets; // To be called after login/load