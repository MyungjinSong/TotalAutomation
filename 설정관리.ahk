#Requires AutoHotkey v2.0
#Include "Lib\JSON.ahk"

class ConfigManager {
    static ConfigPath := A_ScriptDir "\config.json"
    static Config := Map()
    static CurrentUser := Map() ; 현재 로그인한 유저의 '프로필' 객체 (user.profile)

    ; 설정 로드
    static Load() {
        if !FileExist(this.ConfigPath) {
            this.Config := Map("users", Map(), "appSettings", Map())
            this.Save() ; Create the file immediately
            return true
        }

        try {
            fileContent := FileRead(this.ConfigPath, "UTF-8")
            this.Config := JSON.parse(fileContent)
            return true
        } catch as e {
            MsgBox("설정 파일 로드 중 오류 발생: " e.Message, "오류", "Iconx")
            return false
        }
    }

    ; 설정 저장
    static Save() {
        try {
            fileContent := JSON.stringify(this.Config, 4)
            if FileExist(this.ConfigPath)
                FileDelete(this.ConfigPath)
            FileAppend(fileContent, this.ConfigPath, "UTF-8")
            return true
        } catch as e {
            MsgBox("설정 파일 저장 중 오류 발생: " e.Message, "오류", "Iconx")
            return false
        }
    }

    ; 전역 설정 가져오기 (appSettings 등)
    static Get(keyPath, defaultValue := "") {
        return this._GetValue(this.Config, keyPath, defaultValue)
    }

    ; 전역 설정 설정하기
    static Set(keyPath, value) {
        this._SetValue(this.Config, keyPath, value)
        this.Save()
    }

    ; --- 사용자별 설정 메서드 ---

    ; 현재 로그인한 유저의 ID 가져오기
    static GetCurrentUserID() {
        if this.CurrentUser.Has("id")
            return this.CurrentUser["id"]
        return ""
    }

    ; 특정 유저의 루트 객체 가져오기
    static GetUserRoot(userID) {
        if !this.Config.Has("users")
            this.Config["users"] := Map()

        if !this.Config["users"].Has(userID)
            this._InitializeUser(userID)

        return this.Config["users"][userID]
    }

    ; 현재 유저의 설정 가져오기 (예: "hotkeys", "presets.dailyLog")
    static GetUserConfig(keyPath, defaultValue := "") {
        uid := this.GetCurrentUserID()
        if (uid == "")
            return defaultValue
        userRoot := this.GetUserRoot(uid)
        return this._GetValue(userRoot, keyPath, defaultValue)
    }

    ; 현재 유저의 설정 저장하기
    static SetUserConfig(keyPath, value) {
        uid := this.GetCurrentUserID()
        if (uid == "")
            return
        userRoot := this.GetUserRoot(uid)
        this._SetValue(userRoot, keyPath, value)
        this.Save()
    }

    ; 유저 초기화 (기본 구조 생성)
    static _InitializeUser(userID) {
        this.Config["users"][userID] := Map(
            "profile", Map("id", userID),
            "colleagues", [],
            "locations", [],
            "hotkeys", [],
            "presets", Map()
        )
    }

    ; 프로필 목록 가져오기 (로그인 화면용 - 모든 유저의 profile 객체 리스트 반환)
    static GetProfiles() {
        profiles := []
        if this.Config.Has("users") {
            for uid, data in this.Config["users"] {
                if data.Has("profile")
                    profiles.Push(data["profile"])
            }
        }
        return profiles
    }

    ; 내부 헬퍼: Get Value
    static _GetValue(rootObj, keyPath, defaultValue) {
        keys := StrSplit(keyPath, ".")
        current := rootObj

        for k in keys {
            if !IsObject(current) || !current.Has(k)
                return defaultValue
            current := current[k]
        }
        return current
    }

    ; 내부 헬퍼: Set Value
    static _SetValue(rootObj, keyPath, value) {
        keys := StrSplit(keyPath, ".")
        current := rootObj

        loop keys.Length - 1 {
            k := keys[A_Index]
            if !current.Has(k)
                current[k] := Map()
            current := current[k]
        }

        lastKey := keys[keys.Length]
        current[lastKey] := value
    }
}
