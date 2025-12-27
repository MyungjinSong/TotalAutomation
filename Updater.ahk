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

; ==============================================================================
; Helper Functions
; ==============================================================================
LoadConfig() {
    if !FileExist(configFile)
        return Map()
    return JSON.parse(FileRead(configFile, "UTF-8"))
}

GetLatestRelease(repo) {
    url := "https://api.github.com/repos/" repo "/releases/latest"
    whr := ComObject("WinHttp.WinHttpRequest.5.1")
    whr.Open("GET", url, true)
    whr.Send()
    whr.WaitForResponse()

    if (whr.Status != 200)
        return ""

    return JSON.parse(whr.ResponseText)
}

; ==============================================================================
; Main Logic
; ==============================================================================
try {
    config := LoadConfig()

    if !config.Has("appSettings") || !config["appSettings"].Has("repo") || !config["appSettings"].Has("version") {
        MsgBox("설정 파일(config.json)에 버전 또는 저장소 정보가 없습니다.`nMain을 먼저 실행해주세요.")
        Run(mainExe)
        ExitApp
    }

    repo := config["appSettings"]["repo"]
    currentVer := config["appSettings"]["version"]

    ; 1. Check for Updates
    ; Only check if Main.exe exists (Production Mode) or simply check anyway?
    ; Safety: Do NOT overwrite Main.ahk with downloaded EXE.
    mode := "Production"
    if !FileExist(mainExe) && FileExist(mainAhk)
        mode := "Development"

    latestRelease := GetLatestRelease(repo)

    if (mode == "Production" && IsObject(latestRelease) && latestRelease.Has("tag_name")) {
        latestVer := latestRelease["tag_name"]

        ; Simple string comparison (Assumption: v3.0.0 format)
        ; For robust comparison, a semantic version parser is needed,
        ; but for now checking if strings are different is enough if we strictly increase versions.
        if (latestVer != currentVer) {
            if (MsgBox("새 버전이 있습니다: " latestVer "`n현재 버전: " currentVer "`n`n업데이트하시겠습니까?", "업데이트 알림", "YesNo") == "Yes") {

                ; Find asset url
                downloadUrl := ""
                for asset in latestRelease["assets"] {
                    if (asset["name"] == "Main.exe" || asset["name"] == "IntegratedAutomation.exe") { ; Adjust filename as needed
                        downloadUrl := asset["browser_download_url"]
                        break
                    }
                }

                if (downloadUrl == "") {
                    MsgBox("업데이트 파일을 찾을 수 없습니다.`n관리자에게 문의하세요.")
                } else {
                    ; Close Main if running
                    ProcessClose("Main.exe") ; Or wait for it to close
                    ProcessWaitClose("Main.exe", 5)

                    ; Download
                    DownloadGui := Gui("+AlwaysOnTop -Caption +ToolWindow", "업데이트 다운로드 중...")
                    DownloadGui.Add("Text", "w200 Center", "다운로드 중... 잠시만 기다려주세요.")
                    DownloadGui.Show()

                    try {
                        Download(downloadUrl, tempExe)

                        ; Replace
                        if FileExist(mainExe)
                            FileMove(mainExe, mainExe ".old", 1)
                        FileMove(tempExe, mainExe, 1)

                        ; Update Config Version (Optional: Main can do this, but safe to do here)
                        config["appSettings"]["version"] := latestVer
                        f := FileOpen(configFile, "w", "UTF-8")
                        f.Write(JSON.stringify(config))
                        f.Close()

                        MsgBox("업데이트가 완료되었습니다.")
                    } catch as e {
                        MsgBox("업데이트 실패: " e.Message)
                    }
                    DownloadGui.Destroy()
                }
            }
        }
    }

    ; 2. Run Main
    if FileExist(mainExe)
        Run(mainExe)
    else if FileExist(mainAhk)
        Run(mainAhk)
    else
        MsgBox("실행할 프로그램(" mainExe ")을 찾을 수 없습니다.")

} catch as e {
    MsgBox("오류 발생: " e.Message)
    if FileExist(mainExe)
        Run(mainExe)
}

ExitApp