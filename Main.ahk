#Requires AutoHotkey v2.0
#SingleInstance Force
#Include "설정관리.ahk"
#Include "Lib\JSON.ahk"
#Include "Lib\WebView2.ahk"
#Include "Lib\CryptAES.ahk"
#Include "Lib\UIA.ahk"
#Include "Lib\UIA_Browser.ahk"
#Include "단축기능.ahk"
#Include "URL.ahk"
#Include "ERP점검.ahk"

; ==============================================================================
; 컴파일러 지시문
; ==============================================================================
;@Ahk2Exe-SetVersion 3.0.0.0
;@Ahk2Exe-SetProductVersion v3.0
;@Ahk2Exe-SetDescription 통합자동화
; ==============================================================================
; ==============================================================================
; 초기화
; ==============================================================================
global AppVersion := "v3.0.1"
global wvc := ""
global wv := ""
global MainGui := ""
global LoadingGui := ""

if !ConfigManager.Load() {
    ExitApp
}

; 업데이트 확인 (차단 대기) - 컴파일된 경우(프로덕션 모드)에만 실행
skipUpdate := false
for arg in A_Args {
    if (arg = "/skipupdate")
        skipUpdate := true
}

if (A_IsCompiled && !skipUpdate) {
    updaterExe := A_ScriptDir "\Updater.exe"
    if FileExist(updaterExe) {
        try RunWait(updaterExe)
    }
}

; ==============================================================================
; 창 및 트레이 도우미
; ==============================================================================
OnWindowClose(*) {
    if (ConfigManager.GetCurrentUserID() == "") {
        ExitApp
    }
    MainGui.Hide()
    TrayTip "시스템 트레이에서 실행 중입니다", "통합자동화", 1
}

RestoreWindow(*) {
    MainGui.Show()
    WinActivate("ahk_id " MainGui.Hwnd)
}

; 2. 메인 창
ShowMainWindow()

; ==============================================================================
; 메인 로직
; ==============================================================================
ShowMainWindow() {
    global MainGui, wvc, wv

    ; 테두리 없는 창 생성
    ; 크기 조절 가능한 테두리 없는 창 생성 (WS_THICKFRAME = +Resize, 0x00040000)
    ; 이를 통해 캡션 없이도 표준 Windows 10/11 그림자 효과를 사용할 수 있습니다.
    ; 필요한 경우 OnMessage를 통해 수동으로 크기 조절을 방지할 수 있지만, 현재는 최신 앱 동작에 따라 허용합니다.
    ; 인수 확인
    titleSuffix := ""
    for arg in A_Args {
        if (arg = "/offline")
            titleSuffix := " - 오프라인 모드"
    }

    MainGui := Gui("-Caption +Resize", "통합자동화 " AppVersion titleSuffix)
    MainGui.SetFont("S10", "Malgun Gothic")
    MainGui.BackColor := "FFFFFF"

    ; 이벤트 핸들러
    MainGui.OnEvent("Close", OnWindowClose)
    MainGui.OnEvent("Size", OnGuiSize)

    ; 트레이 메뉴 설정
    A_TrayMenu.Delete() ; 기본값 지우기
    A_TrayMenu.Add("열기", RestoreWindow)
    A_TrayMenu.Add("종료", (*) => ExitApp())
    A_TrayMenu.Default := "열기"
    A_TrayMenu.ClickCount := 1 ; 한 번 클릭으로 복원

    ; 초기 단축키 설정 및 데이터 로드
    LoadConfigData()

    ; WebView2 설정
    try {
        dllPath := A_ScriptDir "\Lib\" (A_PtrSize = 8 ? "64bit" : "32bit") "\WebView2Loader.dll"
        if !FileExist(dllPath)
            throw Error("WebView2Loader.dll not found")

        wvc := WebView2.create(MainGui.Hwnd, , , , , , dllPath)
        wvc.IsVisible := true
        wv := wvc.CoreWebView2

        ; 브라우저 기능 비활성화
        settings := wv.Settings
        settings.AreDefaultContextMenusEnabled := false
        settings.IsZoomControlEnabled := false
        settings.IsStatusBarEnabled := false
        settings.AreBrowserAcceleratorKeysEnabled := true ; 디버그를 위해 F12 허용

        wv.add_WebMessageReceived(OnWebMessage)

        ; HTML 경로 로직
        htmlPath := A_ScriptDir "\ui\index.html"
        if !FileExist(htmlPath) {
            throw Error("HTML file not found: " htmlPath)
        }

        ; 경로 정규화
        htmlPath := StrReplace(htmlPath, "\", "/")

        ; UNC 대 로컬 경로 처리
        if (SubStr(htmlPath, 1, 2) == "//") {
            ; UNC 경로: //server/share -> file://server/share
            uri := "file:" htmlPath
        } else {
            ; 로컬 경로: C:/... -> file:///C:/...
            uri := "file:///" htmlPath
        }

        wv.Navigate(uri)

    } catch as e {
        MsgBox("Error: " e.Message)
        ExitApp
    }

    MainGui.Show("w800 h600 Center")

    if (wvc) {
        wvc.Fill()
    }

    ; DWM 확장 프레임을 사용하여 그림자 처리 (CS_DROPSHADOW나 단순 NCCALCSIZE보다 잘 작동함)
    if (VerCompare(A_OSVersion, "6.0") >= 0) {
        MARGINS := Buffer(16, 0)
        NumPut("Int", 1, MARGINS, 0) ; 왼쪽
        NumPut("Int", 1, MARGINS, 4) ; 오른쪽
        NumPut("Int", 1, MARGINS, 8) ; 위쪽
        NumPut("Int", 1, MARGINS, 12) ; 아래쪽
        DllCall("Dwmapi\DwmExtendFrameIntoClientArea", "Ptr", MainGui.Hwnd, "Ptr", MARGINS)
    }
}

OnGuiSize(guiObj, minMax, width, height) {
    if (wvc) {
        wvc.Fill()
    }
}

; ==============================================================================
; 브리지: JS -> AHK
; ==============================================================================
; ------------------------------------------------------------------------------
; WebView 메시지 수신 핸들러 (JS -> AHK)
; 설명: WebView(React/JS)에서 window.chrome.webview.postMessage로 보낸 JSON을 처리합니다.
; ------------------------------------------------------------------------------
OnWebMessage(sender, args) {
    jsonStr := args.WebMessageAsJson

    if (jsonStr == "")
        return

    ; JSON 데이터 파싱
    try {
        msg := JSON.parse(jsonStr)
    } catch as e {
        return
    }

    ; 커맨드 추출
    command := msg.Has("command") ? msg["command"] : ""

    ; --- 1. 초기화 및 로그인 ---
    if (command == "ready") {
        profiles := ConfigManager.GetProfiles()
        payload := Map("type", "initLogin", "users", profiles)
        wv.PostWebMessageAsJson(JSON.stringify(payload))

        ; 자동 로그인 복구 초기화
        restartFile := A_ScriptDir "\.restart_login"
        if FileExist(restartFile) {
            try {
                savedID := FileRead(restartFile)
                FileDelete(restartFile)
                if (savedID != "") {
                    ; 복구 로그인 시에도 AHK 내부 상태 동기화 (아래의 로그인 처리와 동일)
                    ConfigManager.Set("appSettings.lastUser", savedID)

                    userRoot := ConfigManager.GetUserRoot(savedID)
                    profile := userRoot.Has("profile") ? userRoot["profile"] : Map("id", savedID, "name", "Unknown")
                    ConfigManager.CurrentUser := profile
                    LoadConfigData()

                    payload := Map("type", "loginSuccess", "profile", profile)

                    jsonResp := JSON.stringify(payload)
                    wv.PostWebMessageAsJson(jsonResp)

                    ; UI 상태 복원 (로그인 복구 후 실행)
                    stateFile := A_ScriptDir "\.restore_state.json"
                    if FileExist(stateFile) {
                        try {
                            jsonStr := FileRead(stateFile)
                            FileDelete(stateFile)
                            if (jsonStr != "") {
                                state := JSON.parse(jsonStr)
                                payload := Map("type", "restoreUiState", "data", state)
                                wv.PostWebMessageAsJson(JSON.stringify(payload))
                            }
                        }
                    }
                }
            }
        }

        ; ERP 상태 폴링 시작
        ERP점검.StartPolling()
    }
    else if (command == "tryLogin") { ; 로그인 처리
        uid := msg.Has("id") ? msg["id"] : ""

        ConfigManager.Set("appSettings.lastUser", uid)

        userRoot := ConfigManager.GetUserRoot(uid)
        profile := userRoot.Has("profile") ? userRoot["profile"] : Map("id", uid, "name", "Unknown")
        ConfigManager.CurrentUser := profile
        LoadConfigData()

        payload := Map("type", "loginSuccess", "profile", profile)

        jsonResp := JSON.stringify(payload)
        wv.PostWebMessageAsJson(jsonResp)
    }
    ; --- 2. 데이터/설정 관리 ---
    else if (command == "requestConfig") {
        cfg := ConfigManager.Config
        payload := Map("type", "loadConfig", "data", cfg)
        wv.PostWebMessageAsJson(JSON.stringify(payload))
    } else if (command == "checkSubstation") {
        location := msg.Has("location") ? msg["location"] : ""
        if (location != "") {
            ERP점검.PreCheck(location)
        }
    } else if (command == "msgbox") {
        text := msg.Has("text") ? msg["text"] : ""
        title := msg.Has("title") ? msg["title"] : "알림"
        MsgBox(text, title)
    }
    else if (command == "deleteUser") { ; 유저 삭제
        if (msg.Has("id")) {
            targetID := msg["id"]
            if (MsgBox("정말로 해당 유저를 삭제하시겠습니까?`n(ID: " targetID ")", "삭제 확인", "YesNo Icon?") == "Yes") {
                if ConfigManager.Config["users"].Has(targetID) {
                    ConfigManager.Config["users"].Delete(targetID)
                    ConfigManager.Save()
                    MsgBox("삭제되었습니다.", "알림")
                }
                profiles := ConfigManager.GetProfiles()

                payload := Map("type", "initLogin", "users", profiles)
                jsonResp := JSON.stringify(payload)
                wv.PostWebMessageAsJson(jsonResp)
            }
        }
    }
    else if (command == "addUser") { ; 유저 추가
        if (msg.Has("data")) {
            newUser := msg["data"]
            newID := newUser["id"]

            if ConfigManager.Config["users"].Has(newID) {
                payload := Map("type", "loginFail", "message", "이미 존재하는 사번입니다.")
                wv.PostWebMessageAsJson(JSON.stringify(payload))
            } else {
                ConfigManager.Config["users"][newID] := Map(
                    "profile", newUser,
                    "hotkeys", [],
                    "presets", Map()
                )
                ConfigManager.Save()

                profiles := ConfigManager.GetProfiles()
                payload := Map("type", "initLogin", "users", profiles)
                wv.PostWebMessageAsJson(JSON.stringify(payload))
            }
        }
    }
    ; --- 3. UI 제어 ---
    else if (command == "minimize") {
        MainGui.Minimize()
    }
    else if (command == "close") {
        OnWindowClose() ; 최소화 로직 재사용
    }
    else if (command == "saveConfig") { ; 설정 저장
        if msg.Has("data") {
            newConfig := msg["data"]
            ConfigManager.Config := newConfig
            ConfigManager.Save()
        }
    }
    ; --- 4. 매크로 제어 ---
    else if (command == "runTask") {
        taskName := msg.Has("task") ? msg["task"] : ""

        ; 메인 창 최소화 및 로딩 GUI 표시
        ShowLoadingGUI()

        ; 작업을 비동기식으로 실행 (GUI 스레드 차단 방지)
        SetTimer(() => RunTaskAsync(taskName, msg), -1)
    }
    else if (command == "stopTask") {
        StopMacro()
    }
    else if (command == "dragWindow") { ; 창 드래그 (커스텀 타이틀바용)
        DllCall("User32\ReleaseCapture")
        PostMessage(0xA1, 2, 0, , "ahk_id " MainGui.Hwnd)
    }
    else if (command == "getReleaseNotes") { ; 릴리즈 노트 조회
        repo := "MyungjinSong/TotalAutomation"

        url := "https://api.github.com/repos/" repo "/releases?per_page=5"

        try {
            whr := ComObject("WinHttp.WinHttpRequest.5.1")
            whr.Open("GET", url, true)
            whr.Send()
            whr.WaitForResponse()

            if (whr.Status == 200) {
                releases := JSON.parse(whr.ResponseText)
                payload := Map("type", "releaseNotes", "data", releases)
                wv.PostWebMessageAsJson(JSON.stringify(payload))
            } else {
                wv.PostWebMessageAsJson(JSON.stringify(Map("type", "releaseNotes", "error", "GitHub API Error: " whr.Status
                )))
            }
        } catch as e {
            wv.PostWebMessageAsJson(JSON.stringify(Map("type", "releaseNotes", "error", e.Message)))
        }
    }
    ; --- 5. 기타 및 상태 저장 ---
    else if (command == "saveUiState") {
        if (msg.Has("data")) {
            uiState := msg["data"]
            stateFile := A_ScriptDir "\.restore_state.json"
            try {
                FileOpen(stateFile, "w", "UTF-8").Write(JSON.stringify(uiState))
            }
        }
        Reload
    }
}

; ==============================================================================
; 단축키 로직
; ==============================================================================
LoadConfigData() {
    global types, Orders
    global ID, PW

    ; 1. 사용자 식별
    uid := ConfigManager.GetCurrentUserID()
    if (uid == "")
        return

    ; 2. 사용자 루트 객체 로드
    userRoot := ConfigManager.GetUserRoot(uid)

    ; 3. ERP 데이터(types, Orders) 로드 (ERP점검.ahk 호환성)
    types := Map()
    Orders := Map()

    appSettings := ConfigManager.Get("appSettings", Map())
    if (appSettings.Has("locations")) {
        for loc in appSettings["locations"] {
            ; location 객체 구조: {name: "변전소A", type: "변전소", order: "1234"}
            if (loc.Has("name")) {
                name := loc["name"]
                if (loc.Has("type"))
                    types[name] := loc["type"]
                if (loc.Has("order"))
                    Orders[name] := loc["order"]
            }
        }
    }

    ; 4. 단축키 설정
    if (userRoot.Has("hotkeys")) {
        for hk in userRoot["hotkeys"] {
            ; 활성화 확인
            isEnabled := (hk.Has("enabled") && hk["enabled"])

            if (hk.Has("key") && hk["key"] != "") {

                try {
                    action := hk["action"]

                    ; 강제 종료 로직
                    if (action == "ForceExit") {
                        if (isEnabled) {
                            Hotkey hk["key"], (*) => ExitApp(), "On"
                        } else {
                            try Hotkey hk["key"], "Off"
                        }
                    }
                    else if (action == "AutoLogin") {
                        if (isEnabled) {
                            Hotkey hk["key"], ShortcutActions.AutoLoginAction, "On"
                        } else {
                            try Hotkey hk["key"], "Off"
                        }
                    }
                    else if (action == "AutoLoginOpenLog") {
                        if (isEnabled) {
                            Hotkey hk["key"], ShortcutActions.AutoLoginOpenLogAction, "On"
                        } else {
                            try Hotkey hk["key"], "Off"
                        }
                    }
                    else if (action == "ConvertExcel") {
                        if (isEnabled) {
                            Hotkey hk["key"], ShortcutActions.ConvertExcelAction, "On"
                        } else {
                            try Hotkey hk["key"], "Off"
                        }
                    }
                    else if (action == "CopyExcel") {
                        if (isEnabled) {
                            Hotkey hk["key"], ShortcutActions.CopyExcelAction, "On"
                        } else {
                            try Hotkey hk["key"], "Off"
                        }
                    }
                    else if (action == "PasteExcel") {
                        if (isEnabled) {
                            Hotkey hk["key"], ShortcutActions.PasteExcelAction, "On"
                        } else {
                            try Hotkey hk["key"], "Off"
                        }
                    }

                } catch as e {
                    ; 유효하지 않은 키 또는 오류 무시
                }
            }
        }
    }

    ; 5. 전역 변수 설정 (레거시 호환)
    if (ConfigManager.CurrentUser.Has("id"))
        ID := ConfigManager.CurrentUser["id"]
    else
        ID := ""

    if (ConfigManager.CurrentUser.Has("sapPW"))
        PW := ConfigManager.CurrentUser["sapPW"]
    else
        PW := ""
}

; ==============================================================================
; 로딩 GUI 및 매크로 제어
; ==============================================================================
ShowLoadingGUI() {
    global MainGui, LoadingGui

    MainGui.Minimize()

    ; ToolWindow 생성
    LoadingGui := Gui("+AlwaysOnTop -Caption +ToolWindow", "MacroRunning")
    LoadingGui.BackColor := "D3D3D3"

    ; 크기 계산 (200x70) - 가로 레이아웃에 더 적합
    w := 200
    h := 70
    ; 위치: 너비 80%, 높이 20%
    x := A_ScreenWidth * 0.8
    y := A_ScreenHeight * 0.2

    ; 화면 밖으로 나가지 않도록 확인
    if (x + w > A_ScreenWidth)
        x := A_ScreenWidth - w - 20

    LoadingGui.Show("x" x " y" y " w" w " h" h " NoActivate")

    ; GIF 및 텍스트용 ActiveX 생성 (Shell.Explorer)
    try {
        wb := LoadingGui.Add("ActiveX", "x0 y0 w" w " h" h, "Shell.Explorer").Value

        gifPath := A_ScriptDir "\ui\img\loading.gif"

        html :=
            "<html><body style='margin:0; padding:0; overflow:hidden; background-color:#D3D3D3; height:100%; border:none; font-family:`"Malgun Gothic`";'>"
            . "<table width='100%' height='100%' cellpadding='0' cellspacing='0' border='0'>"
            . "<tr>"
            . "<td align='right' width='60' style='padding-right:10px;'><img src='" gifPath "' width='40' height='40' style='display:block;'></td>"
            . "<td align='left' valign='middle'>"
            . "<div style='font-size:15px; font-weight:bold; color:#333; margin-bottom:2px;'>진행중</div>"
            . "<div style='font-size:11px; color:#555;'>(중지: ESC)</div>"
            . "</td>"
            . "</tr>"
            . "</table>"
            . "</body></html>"

        wb.Navigate("about:blank")
        wb.document.write(html)
        wb.silent := true
    } catch {
        LoadingGui.Add("Text", "x0 y30 w" w " Center", "Loading...")
    }

    ; ESC 단축키 등록
    Hotkey "Esc", StopMacro, "On"
}

StopMacro(*) {

    ; 자동 재로그인을 위해 현재 사용자 ID 저장
    if (ConfigManager.HasProp("CurrentUser") && ConfigManager.CurrentUser.Has("id")) {
        try {
            FileOpen(A_ScriptDir "\.restart_login", "w").Write(ConfigManager.CurrentUser["id"])
        }
    }

    ; [중요] 실행 중인 외부 프로세스(curl) 정리
    ; 다운로드 중 재시작 시 좀비 프로세스 방지 및 파일 잠금 해제
    try {
        RunWait "taskkill /F /IM curl.exe", , "Hide"
        ; 임시 JSON 파일 정리 (ERP 점검용)
        try FileDelete(A_WorkingDir "\temp_*.json")
    }

    Hotkey "Esc", "Off"

    ; UI 상태 저장을 요청하고 응답을 기다림 (응답 시 Reload)
    ; 만약 UI가 응답하지 않으면 2초 후 강제 Reload
    try {
        payload := Map("type", "getUiState")
        wv.PostWebMessageAsJson(JSON.stringify(payload))
    }
    SetTimer () => Reload(), -2000
}

EndMacro(*) {
    global MainGui, LoadingGui

    ; GUI 정리
    if (LoadingGui) {
        LoadingGui.Destroy()
        LoadingGui := ""
    }

    MainGui.Show()
}

; ==============================================================================
; 비동기 작업 실행기 (개발 중)
; ==============================================================================
; 설명:
;   WebView에서 'runTask' 명령으로 전달된 작업을 수행합니다.
;   GUI 스레드와 분리되어 실행되도록 SetTimer로 호출되었으나,
;   AHK는 단일 스레드 구조이므로 이곳에서 긴 루프나 Blocking 작업을 수행하면 UI 반응이 느려질 수 있습니다.
;
;   [향후 개발 방향성]
;   1. 모듈화: 각 taskName 별로 별도의 클래스나 함수로 로직을 분리하세요.
;      예) Tasks.DailyLog.Run(msg), Tasks.ERP.Run(msg)
;   2. 파라미터 활용: 'msg' 객체에는 UI에서 보낸 모든 파라미터(옵션, 날짜, 타겟 등)가 들어있으므로 이를 적극 활용하세요.
; ==============================================================================
RunTaskAsync(taskName, msg) {

    MainGui.Hide()

    ; --------------------------------------------------------------------------
    ; [리팩토링] 공통 데이터 주입 (전역 변수 의존성 제거)
    ; --------------------------------------------------------------------------
    currentID := ConfigManager.GetCurrentUserID()
    if (currentID != "") {
        msg["ID"] := currentID
        userRoot := ConfigManager.GetUserRoot(currentID)
        if (userRoot.Has("profile")) {
            profile := userRoot["profile"]
            msg["webPW"] := profile.Has("webPW") ? profile["webPW"] : ""
            msg["sapPW"] := profile.Has("sapPW") ? profile["sapPW"] : ""
        } else {
            msg["webPW"] := ""
            msg["sapPW"] := ""
        }
    }

    ; 1. 일일 업무일지 생성
    if (taskName == "DailyLog") {
        ; [TODO] 실제 업무일지 생성 로직 연결 필요
        ; 예: DailyLogGenerator.Create(msg["date"], msg["options"])

        temp_gui := gui()
        temp_text := temp_gui.Add("Text", "x50 y50", "5")
        temp_gui.Show()

        loop 5 { ; 개발용 시뮬레이션
            temp_text.Text := temp_text.Text - 1

            Sleep 1000
        }

        temp_gui.Destroy()

        MsgBox("일일 점검 일지 생성 작업 완료")
        StopMacro() ; 작업 완료 후 정리 및 복구
    }
    ; 2. ERP 점검 (변전소/전기실 등)
    else if (taskName == "ERPCheck") {
        ; [ERP 일일 점검]
        ; ERP점검.ahk 스크립트로 위임
        ERP점검.Start(msg)

        EndMacro()
    }
    ; 3. 선로 출입 일지
    else if (taskName == "TrackAccess") {
        ; [TODO] 선로출입일지 로직 구현 필요
        ; UI에서 전달받은 작업자 목록, 장소 등을 처리

        loop 10 {
            Sleep 500
        }

        MsgBox("선로 출입 일지 생성 작업 완료")
        StopMacro()
    }
    ; 4. 알 수 없는 작업 처리
    else {
        MsgBox("알 수 없는 작업: " taskName)
        StopMacro()
    }
}
