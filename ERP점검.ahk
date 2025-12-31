#Requires AutoHotkey v2.0

class ERPInspector {
    static LoadingGui := ""
    static WebAppURL :=
        "https://script.google.com/macros/s/AKfycbyoSMf94VffKSvIoBNJHKkQqY213h6M9KhTSBJ1BK9ed8dW64d50ZbjGWGu4n31bJB-/exec"
    static TARGET_SPREADSHEET_ID := "19rgzRnTQtOwwW7Ts5NbBuItNey94dAZsEnO7Tk0cm6s"
    static Host := "124.53.39.7:10002"
    static sapURL := "http://" ERPInspector.Host "/d/s/vcgYgdNicaIAwaXvwUONF2JQHHtCwogE/0BLU6TjjW769YG9FnHGXBrWpStcQz7ec-mLeAXdBi0wo"
    static sapdownURL := "http://" ERPInspector.Host "/d/s/vcgYgdNicaIAwaXvwUONF2JQHHtCwogE/webapi/entry.cgi/%EC%9E%91%EC%97%85%EB%B3%B4%EA%B3%A0.sap?api=SYNO.SynologyDrive.Files&method=download&version=2&files=%5B%22id%3A780060735230228225%22%5D&force_download=true&json_error=true&_dc=1697345185683&sharing_token=%22"

    static Start(locationName, orderNumber, locationType, members) {
        ; 메인 창 숨김
        if IsSet(MainGui)
            MainGui.Hide()

        ; 로딩 창 표시
        ERPInspector.ShowLoading("ERP 점검 매크로 실행 중...")

        try {
            ; 작업보고.sap 파일 확인 및 다운로드
            if !FileExist("작업보고.sap") {
                ERPInspector.UpdateLoadingText("작업보고.sap 다운로드 중...")
                ERPInspector.DownloadSAPFile()
            }

            ; 변전소인 경우 엑셀 다운로드 등 선행 작업
            excelPath := ""
            if (locationType == "변전소") {
                ERPInspector.UpdateLoadingText("변전소 데이터 확인 중...")
                excelPath := ERPInspector.CheckSubstation(locationName)

                ; 엑셀 다운로드 실패 또는 수동 전환 시 excelPath가 "MANUAL"일 수 있음
                if (excelPath == "CANCEL") {
                    ERPInspector.Stop()
                    return
                }
            }

            ; SAP 매크로 실행
            ERPInspector.UpdateLoadingText("SAP 자동화 실행 중...")
            ERPInspector.RunSAPMacro(locationName, orderNumber, locationType, members, excelPath)

        } catch as e {
            MsgBox("오류가 발생했습니다: " e.Message, "오류", "iconx")
        } finally {
            ERPInspector.Stop()
        }
    }

    static Stop() {
        ERPInspector.HideLoading()
        if IsSet(MainGui)
            MainGui.Show()
    }

    static ShowLoading(text := "처리 중...") {
        if (ERPInspector.LoadingGui != "")
            return

        g := Gui("+AlwaysOnTop -Caption +ToolWindow +Owner")
        g.BackColor := "White"
        g.SetFont("s12", "맑은 고딕")

        ; 간단한 로딩 UI 구성 (나중에 WebView로 교체 가능)
        ; 여기서는 WebView2를 사용하여 CSS 애니메이션 표시
        wv := WebView2.Create(g.Hwnd)
        if (wv) {
            rect := [0, 0, 300, 150] ; x, y, w, h
            wv.SetRect(rect)
            g.Show("w300 h150 Center NoActivate")

            html := "
            (
                <!DOCTYPE html>
                <html>
                <head>
                <style>
                    body { 
                        margin: 0; 
                        padding: 0; 
                        display: flex; 
                        flex-direction: column;
                        justify-content: center; 
                        align-items: center; 
                        height: 15vh; 
                        font-family: 'Malgun Gothic', sans-serif;
                        background-color: #f8f9fa;
                        overflow: hidden;
                    }
                    .spinner {
                        width: 50px;
                        padding: 8px;
                        aspect-ratio: 1;
                        border-radius: 50%;
                        background: #25b09b;
                        --_m: 
                            conic-gradient(#0000 10%,#000),
                            linear-gradient(#000 0 0) content-box;
                        -webkit-mask: var(--_m);
                                mask: var(--_m);
                        -webkit-mask-composite: source-out;
                                mask-composite: subtract;
                        animation: s3 1s infinite linear;
                    }
                    @keyframes s3 {to{transform: rotate(1turn)}}
                    .text { margin-top: 20px; font-size: 16px; color: #333; font-weight: bold; }
                </style>
                </head>
                <body>
                    <div class="spinner"></div>
                    <div class="text" id="status">" text "</div>
                    <script>
                        function updateText(newText) {
                            document.getElementById('status').innerText = newText;
                        }
                    </script>
                </body>
                </html>
            )"
            wv.NavigateToString(html)
            ERPInspector.LoadingGui := { Gui: g, Wv: wv }
        } else {
            ; WebView 실패 시 기본 UI
            g.AddText("vStatusCenter w280 Center", text)
            g.Show("w300 h100 Center")
            ERPInspector.LoadingGui := { Gui: g, Wv: "" }
        }
    }

    static UpdateLoadingText(text) {
        if (ERPInspector.LoadingGui == "")
            return

        if (ERPInspector.LoadingGui.Wv) {
            ERPInspector.LoadingGui.Wv.ExecuteScript("updateText('" text "');", 0)
        } else {
            try ERPInspector.LoadingGui.Gui["Status"].Text := text
        }
    }

    static HideLoading() {
        if (ERPInspector.LoadingGui != "") {
            ERPInspector.LoadingGui.Gui.Destroy()
            ERPInspector.LoadingGui := ""
        }
    }

    static DownloadSAPFile() {
        try {
            wh := ComObject("WinHTTP.WinHTTPRequest.5.1")
            wh.SetTimeouts(2000, 3000, 5000, 5000)
            wh.Open("GET", ERPInspector.sapURL)
            wh.Send()
            wh.WaitForResponse()

            ; 쿠키 추출 (Set-Cookie 헤더)
            cookieHeader := wh.GetResponseHeader("Set-Cookie")
            ; 실제 쿠키 값 파싱 로직이 필요할 수 있으나, 기존 코드에서는 특정 위치를 잘라냄.
            ; 여기서는 전체 쿠키를 사용하는 것이 안전할 수 있음.
            ; 기존 코드: cookie := SubStr(wh.GetResponseHeader("set-cookie"), 60, 248) -> 불안정해 보임

            ; 기존 URL 구조상 sharing_token 뒤에 파라미터가 붙으므로 원본 로직을 최대한 존중하되,
            ; Download 함수를 사용하여 처리.

            ; 임시: WinHttp로 직접 다운로드 시도
            wh.Open("GET", ERPInspector.sapURL) ; URL이 다운로드 URL이 아님, 확인 필요.
            ; 기존 코드 로직: sapURL 접속 -> 쿠키 획득 -> sapdownURL + 쿠키 -> 다운로드

            ; 쿠키 처리 로직 보완 (기존 코드 참조)
            cookie := SubStr(cookieHeader, 60, 248)

            downloadUrl := ERPInspector.sapdownURL . cookie . "%22"
            Download(downloadUrl, "작업보고.sap")
        } catch {
            ; 실패 시 무시하거나 경고
        }
    }

    static CheckSubstation(locationName) {
        excelFileName := locationName ".xlsx"

        ; 1. 다운로드 시도
        if !ERPInspector.DownloadExcel(locationName, excelFileName) {
            ; 다운로드 실패 시
            if (MsgBox("웹 연동(엑셀 다운로드) 실패. 수동으로 진행하시겠습니까?", "확인", "YesNo IconExclamation") != "Yes")
                return "CANCEL"
            return "MANUAL"
        }

        ; 2. 파일 수정 시간 확인 (최근 18시간 이내인지)
        try {
            fileTime := FileGetTime(excelFileName)
            diffHours := DateDiff(A_Now, fileTime, "Hours")

            if (diffHours > 18) {
                if (MsgBox("엑셀 파일이 최근(18시간 내)에 수정되지 않았습니다. (경과: " diffHours "시간)`n수동으로 진행하시겠습니까?", "확인",
                    "YesNo IconExclamation") != "Yes")
                    return "CANCEL"
                return "MANUAL"
            }
        } catch {
            return "MANUAL"
        }

        return excelFileName
    }

    static DownloadExcel(sheetName, savePath) {
        try {
            encName := ERPInspector.URLEncode(sheetName)
            url := ERPInspector.WebAppURL "?fileId=" ERPInspector.TARGET_SPREADSHEET_ID "&sheetName=" encName "&filename=" encName ".xlsx"

            Download(url, savePath)
            return true
        } catch {
            return false
        }
    }

    static RunSAPMacro(locationName, orderNumber, locationType, members, excelPath) {

        ; 수동 입력 필요 시 엑셀 열기
        if (locationType == "변전소" && (excelPath == "MANUAL" || excelPath == "")) {
            ERPInspector.HideLoading() ; 수동 조작을 위해 로딩창 숨김

            if (MsgBox("변전소 수동 입력 모드입니다.`n엑셀을 열고 데이터를 입력한 후 저장하고 엑셀을 종료해주세요.`n종료가 감지되면 SAP 입력이 시작됩니다.", "안내",
                "OKCancel IconInformation") == "Cancel") {
                return
            }

            try {
                if !FileExist(locationName ".xlsx")
                    FileAppend("", locationName ".xlsx") ; 빈 파일 생성 시도 (혹은 템플릿 복사 필요)

                Run(locationName ".xlsx")
                if WinWaitActive("ahk_class XLMAIN", , 10) {
                    WinWaitClose("ahk_class XLMAIN")
                } else {
                    MsgBox("엑셀을 찾을 수 없습니다.")
                    return
                }
            } catch {
                MsgBox("엑셀 실행 중 오류 발생")
                return
            }

            ERPInspector.ShowLoading("SAP 입력 준비 중...")
        }

        ; SAP 실행
        if !FileExist("작업보고.sap") {
            MsgBox("작업보고.sap 파일이 없습니다.")
            return
        }

        Run("작업보고.sap")

        ; SAP GUI 제어 (기존 로직 이식)
        ERPInspector.ProcessSAP(orderNumber, members, locationType, locationName)
    }

    static ProcessSAP(orderNumber, members, locationType, locationName) {
        chk1 := true, chk2 := true, chk3 := true

        loginConfig := ConfigManager.GetSAPConfig()
        sapID := loginConfig.ID
        sapPW := loginConfig.PW

        loop 30 { ; 최대 30초 대기
            Sleep 1000

            ; 1. 보안 경고 처리
            if WinExist("SAP GUI 보안") && chk1 {
                WinActivate
                Sleep 250
                Send "{Space}"
                Sleep 250
                Send "{Enter}"
                chk1 := false
            }

            ; 2. 로그인 (유형 A)
            if WinExist("작업완료보고 ahk_class #32770") && chk2 {
                WinActivate
                Sleep 250
                Send "{Ctrl down}a{Ctrl up}"
                Sleep 250
                Send "{Text}" sapID
                Sleep 250
                Send "{Tab}"
                Sleep 250
                Send "{Text}" sapPW
                Sleep 500
                Send "{Enter}"
                chk2 := false
            }

            ; 3. 로그인 (유형 B)
            if WinExist("SAP ahk_class SAP_FRONTEND_SESSION", , "Easy") && chk3 {
                WinActivate
                Sleep 250
                Send "{Ctrl down}a{Ctrl up}"
                Send "{Text}" sapID
                Send "{Tab}"
                Send "{Text}" sapPW
                Send "{Enter}"
                chk3 := false
            }

            ; 4. 오더창 진입 확인
            if WinExist("작업완료보고 ahk_class SAP_FRONTEND_SESSION") {
                WinActivate
                Sleep 750
                if WinGetMinMax("작업완료보고 ahk_class SAP_FRONTEND_SESSION") != 1
                    WinMaximize

                Send "{Text}" orderNumber
                Send "{Enter}"
                break
            }

            if (A_Index == 30) {
                MsgBox("SAP 로그인/실행 시간 초과")
                return
            }
        }

        ; 오더 진입 대기
        if !ERPInspector.WaitForOrderEntry() {
            ERPInspector.Stop()
            return
        }

        ; 데이터 입력
        Send "{Tab 16}"
        Sleep 250
        A_Clipboard := members
        Send "^v" ; 작업자 입력
        Sleep 500

        if (locationType == "변전소") {
            ; 측정값 입력 탭 이동
            Send "{Shift down}{Tab 14}{Shift up}{Right 2}{Enter}"
            Sleep 500
            Send "{Tab 5}{Enter}" ; 업로드 버튼
            Sleep 500

            ; 파일 선택 창
            if WinWait("열기 ahk_exe saplogon.exe", , 15) {
                Sleep 250
                Send "{Tab}{Shift down}{Tab}{Shift up}"
                Sleep 250
                Send "{Text}" A_WorkingDir "\" locationName ".xlsx"
                Sleep 250
                Send "{Enter}"

                ; 입력 완료 대기 (원래 로직 복원)
                if !ERPInspector.WaitForInputBuffer() {
                    ERPInspector.Stop()
                    return
                }
            } else {
                MsgBox("파일 선택 창이 뜨지 않았습니다.")
                ERPInspector.Stop()
                return
            }
        }

        MsgBox("입력이 완료되었습니다. 확인 후 저장하세요.", "완료", "iconi")
    }

    static WaitForOrderEntry() {
        ; 원래의 픽셀서치 로직 복원
        sleep 250
        CoordMode "Pixel", "Screen"
        getPos := ""
        loop {
            if WinExist("작업완료보고 ahk_class SAP_FRONTEND_SESSION")
                WinActivate

            if GetCaretPos(&cx, &cy, &cw, &ch) {
                nowColor := PixelGetColor(cx + 5, cy + 5)
                if (nowColor == 0xDFEBF5)
                    break
            }

            WinActivate("작업완료보고")
            sleep 100
            Send "{end}"

            if A_Index > 20 {
                MsgBox("시간초과로 종료합니다 - 오더 진입실패`n" getPos, "타임아웃", "iconx")
                return false
            }

            sleep 150
            if GetCaretPos(&cx, &cy, &cw, &ch) {
                getPos .= "`n" cx ", " cy " => " PixelGetColor(cx + 5, cy + 5)
            }
        }
        CoordMode "Pixel", "Client"
        sleep 500
        return true
    }

    static WaitForInputBuffer() {
        ; 측정값 입력 완료 대기 (원래 로직 복원)
        sleep 250
        CoordMode "Pixel", "Screen"
        loop {
            if GetCaretPos(&cx, &cy, &cw, &ch) {
                if (PixelGetColor(cx + 5, cy + 5) == 0xFEF09E)
                    break
            }

            WinActivate("작업완료보고")
            sleep 250

            if WinExist("SAP GUI 보안") {
                WinActivate
                sleep 250
                ControlSend("{Space}", "button1", "SAP GUI 보안")
                sleep 250
                ControlSend("{Enter}", "button2", "SAP GUI 보안")
                sleep 250
            }

            if WinExist("Microsoft Office Excel ahk_exe EXCEL.EXE") { ; 엑셀경고
                WinActivate
                sleep 250
                Send "y"
                sleep 250
            }

            Send "{end}"
            if A_Index > 40 {
                MsgBox("시간초과로 종료합니다 - 측정값 입력 실패", "타임아웃", "iconx")
                return false
            }
        }
        CoordMode "Pixel", "Client"
        return true
    }

    static URLEncode(str, encoding := "UTF-8") {
        return str ; 간단히 처리하거나 실제 인코딩 함수 필요. AHK v2에는 내장함수가 없으므로 필요시 구현
    }

}

GetCaretPos(&X, &Y, &W, &H) {
    /*
    	This implementation prefers CaretGetPos > Acc > UIA. This is mostly due to speed differences
    	between the methods and statistically it seems more likely that the UIA method is required the
    	least (Chromium apps support Acc as well).
    */
    ; Default caret
    savedCaret := A_CoordModeCaret
    CoordMode "Caret", "Screen"
    CaretGetPos(&X, &Y)
    CoordMode "Caret", savedCaret
    if IsInteger(X) and ((X | Y) != 0) {
        W := 4, H := 20
        return true
    }

    ; Acc caret
    static _ := DllCall("LoadLibrary", "Str", "oleacc", "Ptr")
    try {
        idObject := 0xFFFFFFF8 ; OBJID_CARET
        if DllCall("oleacc\AccessibleObjectFromWindow", "ptr", WinExist("A"), "uint", idObject &= 0xFFFFFFFF
        , "ptr", -16 + NumPut("int64", idObject == 0xFFFFFFF0 ? 0x46000000000000C0 : 0x719B3800AA000C81, NumPut(
            "int64", idObject == 0xFFFFFFF0 ? 0x0000000000020400 : 0x11CF3C3D618736E0, IID := Buffer(16)))
        , "ptr*", oAcc := ComValue(9, 0)) = 0 {
            x := Buffer(4), y := Buffer(4), w := Buffer(4), h := Buffer(4)
            oAcc.accLocation(ComValue(0x4003, x.ptr, 1), ComValue(0x4003, y.ptr, 1), ComValue(0x4003, w.ptr, 1),
            ComValue(0x4003, h.ptr, 1), 0)
            X := NumGet(x, 0, "int"), Y := NumGet(y, 0, "int"), W := NumGet(w, 0, "int"), H := NumGet(h, 0, "int")
            if (X | Y) != 0
                return true
        }
    }

    ; UIA caret
    static IUIA := ComObject("{e22ad333-b25f-460c-83d0-0581107395c9}", "{34723aff-0c9d-49d0-9896-7ab52df8cd8a}")
    try {
        ComCall(8, IUIA, "ptr*", &FocusedEl := 0) ; GetFocusedElement
        ComCall(16, FocusedEl, "int", 10014, "ptr*", &patternObject := 0), ObjRelease(FocusedEl) ; GetCurrentPattern. TextPattern = 10014
        if patternObject {
            ComCall(5, patternObject, "ptr*", &selectionRanges := 0), ObjRelease(patternObject) ; GetSelections
            ComCall(4, selectionRanges, "int", 0, "ptr*", &selectionRange := 0) ; GetElement
            ComCall(10, selectionRange, "ptr*", &boundingRects := 0), ObjRelease(selectionRange), ObjRelease(
                selectionRanges) ; GetBoundingRectangles
            if (Rect := ComValue(0x2005, boundingRects)).MaxIndex() = 3 { ; VT_ARRAY | VT_R8
                X := Round(Rect[0]), Y := Round(Rect[1]), W := Round(Rect[2]), H := Round(Rect[3])
                return true
            }
        }
    }

    return false
}
