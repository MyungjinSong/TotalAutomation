#Requires AutoHotkey v2.0
#SingleInstance Force
#Include "Lib\JSON.ahk"

; ==============================================================================
; Configuration
; ==============================================================================
configFile := A_ScriptDir "\config.json"
mainExe := A_ScriptDir "\Main.exe"
mainAhk := A_ScriptDir "\Main.ahk"
tempExe := A_ScriptDir "\Main_new.exe"
logFile := A_ScriptDir "\debug.log"

; ==============================================================================
; GUI Setup (Lazy Init)
; ==============================================================================
CreateGui() {
    g := Gui("+AlwaysOnTop -Caption +ToolWindow +Owner", "Update")
    g.BackColor := "White"
    g.SetFont("s10", "Malgun Gothic")
    g.Add("Text", "w300 Center vStatusText", "업데이트 확인 중...")
    g.Add("Progress", "w300 h20 -Smooth +0x8 vLoadingBar")
    return g
}

global UpdateGui := ""

UpdateStatus(text) {
    global UpdateGui ; Fix: Declare global because we assign to it below
    if (UpdateGui == "") {
        UpdateGui := CreateGui()
        UpdateGui.Show("NoActivate")
    }
    UpdateGui["StatusText"].Text := text
}

; ==============================================================================
; Main Logic
; ==============================================================================
try {
    ; 0. IMMEDIATE GUI
    UpdateStatus("업데이트 확인 중...")

    ; Safety Mode Check
    mode := (!FileExist(mainExe) && FileExist(mainAhk)) ? "Development" : "Production"
    repo := "MyungjinSong/TotalAutomation"
    currentVer := GetLocalVersion()

    ; 1. INTERNET CHECK
    UpdateStatus("네트워크 연결 확인 중...")
    isOnline := CheckInternetConnection()

    if (!isOnline) {
        ; Case: OFFLINE
        ; Run Main in Offline Mode silently
        if (FileExist(mainExe)) {
            Run(mainExe " /offline")
        } else if (FileExist(mainAhk)) {
            Run(mainAhk " /offline")
        }
        UpdateGui.Destroy()
        ExitApp
    }

    ; 2. VERSION CHECK
    UpdateStatus("버전 정보 가져오는 중...")
    latestRelease := GetLatestRelease(repo)

    shouldUpdate := false
    downloadUrl := ""
    latestVer := ""

    if (IsObject(latestRelease) && latestRelease.Has("tag_name")) {
        latestVer := latestRelease["tag_name"]

        ; Normalize versions for comparison (remove 'v')
        cVerClean := StrReplace(currentVer, "v", "")
        lVerClean := StrReplace(latestVer, "v", "")

        if (VerCompare(lVerClean, cVerClean) > 0) {
            shouldUpdate := true
            for i, asset in latestRelease["assets"] {
                if (asset["name"] == "Main.exe") {
                    downloadUrl := asset["browser_download_url"]
                    break
                }
            }
        }
    } else {
        ; Case: ONLINE but API FAILED (or Limit Exceeded)
        MsgBox("업데이트 정보를 받아올 수 없습니다")
        UpdateGui.Destroy()

        ; Fallback to Normal Run (Skip Update Check in Main)
        if (mode == "Production" && !ProcessExist("Main.exe"))
            Run(mainExe " /skipupdate")

        ExitApp
    }

    if (shouldUpdate && downloadUrl != "" && mode == "Production") {
        ; Start Update - GUI already visible
        UpdateStatus("새 버전 발견! (" latestVer ")")

        ; 1. Close Main
        UpdateStatus("메인 프로그램 종료 중...")

        if ProcessExist("Main.exe") {
            try ProcessClose("Main.exe")
            if !ProcessWaitClose("Main.exe", 2) { ; Wait up to 2 seconds gracefully
                ; If still running, force kill immediately
                try RunWait('taskkill /F /IM "Main.exe"', , "Hide")
                ProcessWaitClose("Main.exe", 1) ; Final verification wait
            }
        }

        if ProcessExist("Main.exe") {
            MsgBox("Main.exe를 종료할 수 없습니다. 수동으로 종료해 주세요.")
            ExitApp
        }

        ; 2. Download
        UpdateStatus("다운로드 중...")
        UpdateGui["LoadingBar"].Opt("-0x8") ; Determinate mode
        UpdateGui["LoadingBar"].Value := 0

        try {
            whr := ComObject("WinHttp.WinHttpRequest.5.1")
            whr.Open("GET", downloadUrl, true)
            whr.SetRequestHeader("User-Agent", "AutoHotkey")
            whr.Option[4] := 13056
            whr.Send()
            whr.WaitForResponse()

            stream := ComObject("ADODB.Stream")
            stream.Type := 1 ; Binary
            stream.Open()
            stream.Write(whr.ResponseBody)
            stream.SaveToFile(tempExe, 2)
            stream.Close()

            UpdateGui["LoadingBar"].Value := 100
            UpdateStatus("설치 중...")

            ; 3. Replace
            if FileExist(mainExe)
                FileMove(mainExe, mainExe ".old", 1)
            FileMove(tempExe, mainExe, 1)
            try FileDelete(mainExe ".old")

        } catch as e {
            MsgBox("다운로드/설치 실패: " e.Message)
            ExitApp
        }

        ; 4. Restart Main (Exit Updater will happen naturally)
        Run(mainExe " /skipupdate")

    } else {
        ; No Update or Dev Mode
        ; If Main is NOT running, launch it (Launcher behavior)
        if (mode == "Production" && !ProcessExist("Main.exe")) {
            UpdateStatus("최신 버전입니다.")
            Run(mainExe " /skipupdate")
        }
        ; If Main IS running, just exit silently (Side-car behavior)
    }

} catch as e {
    MsgBox("오류 발생: " e.Message)
}

if (UpdateGui != "")
    UpdateGui.Destroy()

; ==============================================================================
; Helper Functions (Restored)
; ==============================================================================
GetLocalVersion() {
    ; 1. Try Reading from Main.exe File Version
    if FileExist(mainExe) {
        try {
            ver := FileGetVersion(mainExe)
            if (ver != "")
                return "v" ver ; AutoHotkey compiles as x.x.x.x, usually we map this to vX.X.X
        }
    }

    ; 2. Fallback: Parse Main.ahk
    if FileExist(mainAhk) {
        content := FileRead(mainAhk, "UTF-8")
        if RegExMatch(content, 'AppVersion\s*:=\s*"(v[\d\.]+)"', &match)
            return match[1]
    }

    return "v0.0.0"
}

GetLatestRelease(repo) {
    url := "https://api.github.com/repos/" repo "/releases/latest"
    try {
        whr := ComObject("WinHttp.WinHttpRequest.5.1")
        whr.Open("GET", url, true)
        whr.SetRequestHeader("User-Agent", "AutoHotkey")
        whr.Option[4] := 13056
        whr.Send()
        whr.WaitForResponse()

        if (whr.Status == 200)
            return JSON.parse(whr.ResponseText)
    }
    return ""
}

CheckInternetConnection() {
    try {
        ; Simple Ping to Google DNS (8.8.8.8) or similar reliable host
        ; Or HTTP HEAD to google.com
        whr := ComObject("WinHttp.WinHttpRequest.5.1")
        whr.Open("HEAD", "http://www.google.com", true)
        whr.Option[4] := 13056
        whr.Send()
        whr.WaitForResponse(2) ; Wait max 2 seconds

        return (whr.Status == 200)
    } catch {
        return false
    }
}
