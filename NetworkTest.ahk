#Requires AutoHotkey v2.0
#SingleInstance Force

; ==============================================================================
; 네트워크 진단 도구
; ==============================================================================
; 이 도구는 통합자동화 프로그램의 네트워크 연결 문제를 진단하기 위해 사용됩니다.
; 주요 점검 항목:
; 1. 기본 인터넷 연결 (Google DNS Ping)
; 2. GitHub API 연결 (업데이트 확인용)
; 3. Google Apps Script 연결 (ERP 데이터 통신용)
; ==============================================================================

global LogEdit := ""
global WebAppURL :=
    "https://script.google.com/macros/s/AKfycbyoSMf94VffKSvIoBNJHKkQqY213h6M9KhTSBJ1BK9ed8dW64d50ZbjGWGu4n31bJB-/exec"
global GitHubURL := "https://api.github.com/repos/MyungjinSong/TotalAutomation/releases?per_page=1"

MakeGui()

MakeGui() {
    global LogEdit

    myGui := Gui(, "네트워크 진단 도구")
    myGui.SetFont("s10", "Malgun Gothic")

    myGui.Add("Text", "w600 Center", "아래 '검사 시작' 버튼을 눌러 네트워크 상태를 점검하세요.")
    myGui.Add("Button", "w600 h40 Default", "검사 시작").OnEvent("Click", StartTest)

    LogEdit := myGui.Add("Edit", "x10 w600 h400 ReadOnly", "대기 중...")

    myGui.Add("Button", "x10 w290 h40", "결과 복사").OnEvent("Click", CopyLog)
    myGui.Add("Button", "x+10 w290 h40", "종료").OnEvent("Click", (*) => ExitApp())

    myGui.Show()
}

StartTest(*) {
    LogEdit.Value := "=== 네트워크 진단 시작 (" FormatTime(, "yyyy-MM-dd HH:mm:ss") ") ===`r`n`r`n"

    ; 1. 인터넷 연결 확인 (Ping)
    Log("1. 기본 인터넷 연결 확인 (Ping 8.8.8.8)...")
    if PingAddress("8.8.8.8") {
        Log("[성공] 인터넷 연결이 정상입니다.`r`n")
    } else {
        Log("[실패] 인터넷에 연결할 수 없습니다. LAN 케이블이나 Wi-Fi를 확인하세요.`r`n")
        Log("진단을 중단합니다.")
        return
    }

    ; 2. GitHub API 확인
    Log("2. 업데이트 서버 연결 확인 (GitHub API)...")
    try {
        whr := ComObject("WinHttp.WinHttpRequest.5.1")
        whr.Open("GET", GitHubURL, true)

        ;whr.Option[9] := 2048
        whr.Option[4] := 13056

        whr.Send()
        whr.WaitForResponse()

        status := whr.Status
        if (status == 200) {
            Log("[성공] GitHub 서버에 연결되었습니다. (Status: 200)`r`n")
        } else {
            Log("[실패] GitHub 서버 응답 오류. (Status: " status ")`r`n")
            Log("응답 내용: " whr.ResponseText "`r`n")
        }
    } catch as e {
        Log("[실패] GitHub 연결 중 오류 발생: " e.Message "`r`n")
    }

    ; 3. Google Apps Script 확인
    ; 진단 도구 내부에서 실행해볼 수 있는 로직
    Log("3. ERP 서버 실제 통신 테스트 (curl 사용)...")
    tempFile := A_Temp "\diag_test.json"
    cmd := 'curl.exe -skL -w "%{http_code}" "' . WebAppURL . '?action=ping" -o "' . tempFile . '"'
    try {
        ; RunWait를 사용하여 결과 코드를 직접 확인
        shell := ComObject("WScript.Shell")
        exec := shell.Exec(cmd)
        httpCode := exec.StdOut.ReadAll() ; -w "%{http_code}" 옵션으로 출력된 값

        if (httpCode == "200") {
            Log("[성공] curl을 이용한 ERP 연결에 성공했습니다.`r`n")
        } else {
            Log("[실패] curl 통신 실패. HTTP 코드: " httpCode "`r`n")
        }
        if FileExist(tempFile)
            FileDelete(tempFile)
    } catch as e {
        Log("[실패] curl 실행 중 오류: " e.Message "`r`n")
    }

    Log("=== 진단 완료 ===")
    MsgBox("진단이 완료되었습니다.", "완료", "iconi")
}

PingAddress(address) {
    try {
        ; RunWait returns the exit code
        exitCode := RunWait("ping.exe -n 1 -w 2000 " address, , "Hide")
        return (exitCode == 0)
    } catch {
        return false
    }
}

Log(text) {
    LogEdit.Value .= text "`r`n"
    SendMessage(0x0115, 7, 0, LogEdit.Hwnd, "ahk_id " LogEdit.Hwnd) ; WM_VSCROLL, SB_BOTTOM
}

CopyLog(*) {
    A_Clipboard := LogEdit.Value
    MsgBox("결과가 클립보드에 복사되었습니다.", "알림")
}
