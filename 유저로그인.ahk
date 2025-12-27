#Requires AutoHotkey v2.0
#Include "설정관리.ahk"
#Include "Lib\UIA.ahk"

/*
    유저로그인.ahk
    - 단축일지의 로그인/유저등록 로직 이식
    - 불필요한 안내 문구 제거 및 심플화
*/

class UserLogin {
    static LoginUser() {
        return this.selectAndAuthUser()
    }

    static selectAndAuthUser() {
        loop {
            guiObj := UserSelectionGUI()
            selectedUser := guiObj.WaitForSubmit()

            if (!selectedUser || !selectedUser.Has("id")) {
                return false
            }

            ; 프로필 확인
            profiles := ConfigManager.GetProfiles()
            targetProfile := ""
            for p in profiles {
                if p["id"] == selectedUser["id"] {
                    targetProfile := p
                    break
                }
            }

            if !targetProfile {
                MsgBox "해당 유저 프로필을 찾을 수 없습니다.", "오류", "Iconx"
                continue
            }

            ; 2차 비밀번호 확인
            ; (기존 단축일지처럼 2차 비번으로 본인 인증)
            pwBox := InputBox("2차 비밀번호를 입력하세요", "인증", "Password w250")
            if (pwBox.Result != "OK") {
                continue
            }

            savedPW2 := targetProfile.Has("pw2") ? targetProfile["pw2"] : ""

            ; 2차 비밀번호가 설정되지 않은 경우 신규 유저로 간주하여 통과시킬 수도 있으나,
            ; 등록 시 필수로 입력받으므로 불일치면 실패 처리
            if (savedPW2 != "" && pwBox.Value != savedPW2) {
                MsgBox "2차 비밀번호가 일치하지 않습니다.", "오류", "Icon!"
                continue
            }

            ; 로그인 성공
            ConfigManager.Set("appSettings.lastUser", targetProfile["id"]) ; ID로 저장 (이름 대신)
            ConfigManager.CurrentUser := targetProfile
            return true
        }
    }
}

class UserSelectionGUI {
    controls := Map()
    result := Map()
    submitted := false

    __New() {
        this.controls["main"] := gui("", "사용자 선택")
        this.controls["main"].SetFont("S10", "맑은 고딕")
        this.controls["main"].Opt("-MinimizeBox -MaximizeBox")

        this.controls["main"].AddText("Section", "등록된 유저:")
        this.controls["userList"] := this.controls["main"].AddListBox("xs w200 h150")
        this.controls["userList"].OnEvent("DoubleClick", (*) => this.onSelectUser())

        ; 버튼 그룹
        this.controls["btn_ok"] := this.controls["main"].AddButton("xs w200 h30", "로그인")
        this.controls["btn_ok"].OnEvent("Click", (*) => this.onSelectUser())

        this.controls["btn_add"] := this.controls["main"].AddButton("xs w95 h30", "유저 추가")
        this.controls["btn_add"].OnEvent("Click", (*) => this.onAddUser())

        this.controls["btn_del"] := this.controls["main"].AddButton("x+10 w95 h30", "삭제")
        this.controls["btn_del"].OnEvent("Click", (*) => this.onDeleteUser())

        this.loadUserList()
        this.controls["main"].OnEvent("Close", (*) => this.onCancel())
        this.controls["main"].Show("Center")
    }

    loadUserList() {
        profiles := ConfigManager.GetProfiles()
        this.controls["userList"].Delete()
        lastUserId := ConfigManager.Get("appSettings.lastUser")

        selectIndex := 0
        for i, p in profiles {
            name := p.Has("name") ? p["name"] : p["id"]
            this.controls["userList"].Add([name " (" p["id"] ")"])
            if (p["id"] == lastUserId)
                selectIndex := i
        }

        if (selectIndex > 0)
            this.controls["userList"].Choose(selectIndex)
    }

    onSelectUser() {
        idx := this.controls["userList"].Value
        if (idx == 0) {
            MsgBox "유저를 선택해주세요."
            return
        }

        profiles := ConfigManager.GetProfiles()
        if (idx > profiles.Length)
            return

        this.result := profiles[idx] ; 1-based index
        this.submitted := true
        this.controls["main"].Destroy()
    }

    onAddUser() {
        this.controls["main"].Opt("+Disabled") ; 메인창 비활성
        regGui := UserInputGUI()
        newUserResult := regGui.WaitForSubmit()
        this.controls["main"].Opt("-Disabled") ; 메인창 활성
        this.controls["main"].Show() ; 다시 포커스

        if (newUserResult && newUserResult.Count > 0) {
            newID := newUserResult["id"]

            if ConfigManager.Config["users"].Has(newID) {
                MsgBox "이미 존재하는 사번입니다: " newID, "오류", "Iconx"
                return
            }

            ; Users 객체에 추가 (newUserResult가 이미 구조화된 Map임)
            ConfigManager.Config["users"][newID] := newUserResult
            ConfigManager.Save()
            this.loadUserList()
        }
    }

    ; 유저 삭제
    onDeleteUser() {
        idx := this.controls["userList"].Value
        if (idx == 0) {
            return
        }

        profiles := ConfigManager.GetProfiles()
        targetProfile := profiles[idx]
        targetID := targetProfile["id"]

        if MsgBox("'" targetProfile["name"] "' 님의 정보를 삭제하시겠습니까?", "삭제 확인", "YesNo Icon?") == "Yes" {
            ; 삭제 시 2차 비밀번호 확인
            pwBox := InputBox("삭제하려면 2차 비밀번호를 입력하세요", "인증", "Password w250")
            if (pwBox.Result != "OK") {
                return
            }

            savedPW2 := targetProfile.Has("pw2") ? targetProfile["pw2"] : ""
            if (savedPW2 != "" && pwBox.Value != savedPW2) {
                MsgBox "2차 비밀번호가 일치하지 않습니다.", "오류", "Icon!"
                return
            }

            ; ConfigManager에서 유저 삭제 (users 객체에서 해당 키 삭제)
            if ConfigManager.Config.Has("users") && ConfigManager.Config["users"].Has(targetID) {
                ConfigManager.Config["users"].Delete(targetID)
                ConfigManager.Save()
            }
            this.loadUserList()
        }
    }

    onCancel() {
        this.result := Map()
        this.submitted := false
        this.controls["main"].Destroy()
    }

    WaitForSubmit() {
        while WinExist("사용자 선택")
            Sleep 100
        return this.result
    }
}

class UserInputGUI {
    controls := Map()
    result := Map()
    submitted := false

    __New() {
        this.controls["main"] := Gui("+Owner", "유저 정보 등록")
        this.controls["main"].SetFont("S10", "맑은 고딕")
        this.controls["main"].Opt("-MinimizeBox -MaximizeBox")

        mainGui := this.controls["main"]

        mainGui.AddText("w120 Section", "이름 *")
        mainGui.AddText("w120", "사번 *")
        mainGui.AddText("w120", "통합 PW *")
        mainGui.AddText("w120", "통합 PW 확인 *")
        mainGui.AddText("w120", "2차 PW *")
        mainGui.AddText("w120", "2차 PW 확인 *")
        mainGui.AddText("w120", "SAP PW")
        mainGui.AddText("w120", "SAP PW 확인")

        this.controls["name"] := mainGui.AddEdit("ys-3 Section w120")
        this.controls["webID"] := mainGui.AddEdit("w120 Number Limit6")

        ; 근무조 자동계산 로직은 복잡하니 일단 선택으로
        this.controls["team"] := mainGui.AddDropDownList("x+10 yp w80 Choose1", ["A조", "B조", "C조", "D조", "일근"])

        this.controls["webPW1"] := mainGui.AddEdit("xs Password w210")
        this.controls["webPW2"] := mainGui.AddEdit("Password w210")
        this.controls["pw2_1"] := mainGui.AddEdit("Password Number Limit6 w210")
        this.controls["pw2_2"] := mainGui.AddEdit("Password Number Limit6 w210")
        this.controls["sapPW1"] := mainGui.AddEdit("Password w210")
        this.controls["sapPW2"] := mainGui.AddEdit("Password w210")

        ; 체크 표시용
        this.setupPwCheck("webPW1", "webPW2")
        this.setupPwCheck("pw2_1", "pw2_2")
        this.setupPwCheck("sapPW1", "sapPW2")

        btnSave := mainGui.AddButton("xs w210 h35", "저장")
        btnSave.OnEvent("Click", (*) => this.onSave())

        mainGui.OnEvent("Close", (*) => this.onCancel())
        mainGui.Show("Center")
    }

    setupPwCheck(id1, id2) {
        this.controls[id1].OnEvent("Change", (*) => this.checkMatch(id1, id2))
        this.controls[id2].OnEvent("Change", (*) => this.checkMatch(id1, id2))
    }

    checkMatch(id1, id2) {
        val1 := this.controls[id1].Value
        val2 := this.controls[id2].Value

        if (val1 != "" && val2 != "" && val1 == val2)
            this.controls[id2].Opt("+cGreen")
        else
            this.controls[id2].Opt("+cBlack")
    }

    onSave() {
        name := Trim(this.controls["name"].Value)
        id := Trim(this.controls["webID"].Value)
        team := this.controls["team"].Text
        wp1 := this.controls["webPW1"].Value
        wp2 := this.controls["webPW2"].Value
        p2_1 := this.controls["pw2_1"].Value
        p2_2 := this.controls["pw2_2"].Value
        sp1 := this.controls["sapPW1"].Value
        sp2 := this.controls["sapPW2"].Value

        if (name == "" || id == "" || wp1 == "" || wp2 == "" || p2_1 == "" || p2_2 == "") {
            MsgBox "필수 항목(*)을 모두 입력해주세요.", "알림"
            return
        }

        if (wp1 != wp2) {
            MsgBox "통합 비밀번호가 일치하지 않습니다.", "오류"
            return
        }
        if (p2_1 != p2_2) {
            MsgBox "2차 비밀번호가 일치하지 않습니다.", "오류"
            return
        }
        if (sp1 != "" && sp1 != sp2) {
            MsgBox "SAP 비밀번호가 일치하지 않습니다.", "오류"
            return
        }

        ; 저장할 데이터 Map 생성 (ConfigManager 구조에 맞게)
        this.result := Map(
            "id", id,
            "profile", Map(
                "id", id,
                "name", name,
                "webPW", wp1,
                "pw2", p2_1,
                "sapPW", sp1,
                "team", team,
                "department", "호포전기분소"
            ),
            "colleagues", [],
            "locations", [],
            "hotkeys", [],
            "presets", Map()
        )

        this.submitted := true
        this.controls["main"].Destroy()
    }

    onCancel() {
        this.result := Map()
        this.submitted := false
        this.controls["main"].Destroy()
    }

    WaitForSubmit() {
        while WinExist("유저 정보 등록")
            Sleep 100
        return this.result
    }
}
