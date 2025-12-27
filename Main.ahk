#Requires AutoHotkey v2.0
#SingleInstance Force
#Include "설정관리.ahk"
#Include "Lib\JSON.ahk"
#Include "Lib\WebView2.ahk"

; ==============================================================================
; Compiler Directives
; ==============================================================================
;@Ahk2Exe-SetVersion 2.0.0.0
;@Ahk2Exe-SetProductVersion v3.0
;@Ahk2Exe-SetDescription 통합자동화
; ==============================================================================
; ==============================================================================
; Initialization
; ==============================================================================
global AppVersion := "v3.0.0"
global wvc := ""
global wv := ""
global MainGui := ""

if !ConfigManager.Load() {
    ExitApp
}

; Update Check (Blocking Wait)
skipUpdate := false
for arg in A_Args {
    if (arg = "/skipupdate")
        skipUpdate := true
}

if (!skipUpdate) {
    updaterExe := A_ScriptDir "\Updater.exe"
    if FileExist(updaterExe) {
        try RunWait(updaterExe)
    }
}

; 2. Main Window
ShowMainWindow()

; ==============================================================================
; Main Logic
; ==============================================================================
ShowMainWindow() {
    global MainGui, wvc, wv

    ; Create Borderless Window
    ; Create Borderless Window with Resize style (WS_THICKFRAME = +Resize, 0x00040000)
    ; This enables the standard Windows 10/11 drop shadow even without a caption.
    ; We manually prevent resizing via OnMessage if needed, but for now we allow it as per modern app behavior.
    ; Arguments Check
    titleSuffix := ""
    for arg in A_Args {
        if (arg = "/offline")
            titleSuffix := " - 오프라인 모드"
    }

    MainGui := Gui("-Caption +Resize", "통합자동화 " AppVersion titleSuffix)
    MainGui.SetFont("S10", "Malgun Gothic")
    MainGui.BackColor := "FFFFFF"

    ; Event Handlers
    MainGui.OnEvent("Close", (*) => ExitApp())
    MainGui.OnEvent("Size", OnGuiSize)

    ; Setup WebView2
    try {
        dllPath := A_ScriptDir "\Lib\" (A_PtrSize = 8 ? "64bit" : "32bit") "\WebView2Loader.dll"
        if !FileExist(dllPath)
            throw Error("WebView2Loader.dll not found")

        wvc := WebView2.create(MainGui.Hwnd, , , , , , dllPath)
        wvc.IsVisible := true
        wv := wvc.CoreWebView2

        ; Disable Browser Features
        settings := wv.Settings
        settings.AreDefaultContextMenusEnabled := false
        settings.IsZoomControlEnabled := false
        settings.IsStatusBarEnabled := false
        settings.AreBrowserAcceleratorKeysEnabled := true ; F12 Allowed for Debug

        wv.add_WebMessageReceived(OnWebMessage)

        ; HTML Path Logic
        htmlPath := A_ScriptDir "\ui\index.html"
        if !FileExist(htmlPath) {
            throw Error("HTML file not found: " htmlPath)
        }

        ; Normalize path
        htmlPath := StrReplace(htmlPath, "\", "/")

        ; Handle UNC vs Local Path
        if (SubStr(htmlPath, 1, 2) == "//") {
            ; UNC Path: //server/share -> file://server/share
            uri := "file:" htmlPath
        } else {
            ; Local Path: C:/... -> file:///C:/...
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

    ; Handle Drop Shadow using DWM extending frame (works better than CS_DROPSHADOW or simple NCCALCSIZE)
    if (VerCompare(A_OSVersion, "6.0") >= 0) {
        MARGINS := Buffer(16, 0)
        NumPut("Int", 1, MARGINS, 0) ; Left
        NumPut("Int", 1, MARGINS, 4) ; Right
        NumPut("Int", 1, MARGINS, 8) ; Top
        NumPut("Int", 1, MARGINS, 12) ; Bottom
        DllCall("Dwmapi\DwmExtendFrameIntoClientArea", "Ptr", MainGui.Hwnd, "Ptr", MARGINS)
    }
}

OnGuiSize(guiObj, minMax, width, height) {
    if (wvc) {
        wvc.Fill()
    }
}

; ==============================================================================
; Bridge: JS -> AHK
; ==============================================================================
OnWebMessage(sender, args) {
    jsonStr := args.WebMessageAsJson

    if (jsonStr == "")
        return

    try {
        msg := JSON.parse(jsonStr)
    } catch as e {
        return
    }

    command := msg.Has("command") ? msg["command"] : ""

    if (command == "ready") {
        profiles := ConfigManager.GetProfiles()
        payload := Map("type", "initLogin", "users", profiles)

        jsonResp := JSON.stringify(payload)
        wv.PostWebMessageAsJson(jsonResp)
    }
    else if (command == "tryLogin") {
        uid := msg.Has("id") ? msg["id"] : ""

        ConfigManager.Set("appSettings.lastUser", uid)

        userRoot := ConfigManager.GetUserRoot(uid)
        profile := userRoot.Has("profile") ? userRoot["profile"] : Map("id", uid, "name", "Unknown")
        ConfigManager.CurrentUser := profile

        payload := Map("type", "loginSuccess", "profile", profile)

        jsonResp := JSON.stringify(payload)
        wv.PostWebMessageAsJson(jsonResp)
    }
    else if (command == "requestConfig") {
        cfg := ConfigManager.Config
        payload := Map("type", "loadConfig", "data", cfg)
        wv.PostWebMessageAsJson(JSON.stringify(payload))
    }
    else if (command == "msgbox") {
        text := msg.Has("text") ? msg["text"] : ""
        title := msg.Has("title") ? msg["title"] : "알림"
        MsgBox(text, title)
    }
    else if (command == "deleteUser") {
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
    else if (command == "addUser") {
        ; Checking if this handler was missing or deleted?
        ; Re-adding minimal handler just in case it was lost in previous edits
        if (msg.Has("data")) {
            newUser := msg["data"]
            newID := newUser["id"]

            if ConfigManager.Config["users"].Has(newID) {
                payload := Map("type", "loginFail", "message", "이미 존재하는 사번입니다.")
                wv.PostWebMessageAsJson(JSON.stringify(payload))
            } else {
                ConfigManager.Config["users"][newID] := Map(
                    "profile", newUser,
                    "colleagues", [],
                    "locations", [],
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
    else if (command == "minimize") {
        MainGui.Minimize()
    }
    else if (command == "close") {
        ExitApp
    }
    else if (command == "saveConfig") {
        if msg.Has("data") {
            newConfig := msg["data"]
            ConfigManager.Config := newConfig
            ConfigManager.Save()
            ; MsgBox removed for auto-save silent operation
        }
    }
    else if (command == "runTask") {
        taskName := msg.Has("task") ? msg["task"] : ""
        if (taskName == "DailyLog") {
            MsgBox("일일 점검 일지 생성 작업을 시작합니다.")
        }
        else if (taskName == "TrackAccess") {
            MsgBox("선로 출입 일지 생성 작업을 시작합니다.")
        }
    }
    else if (command == "dragWindow") {
        DllCall("User32\ReleaseCapture")
        PostMessage(0xA1, 2, 0, , "ahk_id " MainGui.Hwnd)
    }
    else if (command == "getReleaseNotes") {
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
}
