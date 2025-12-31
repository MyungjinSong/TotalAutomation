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

            ; Decrypt sensitive fields
            key := this.GetKey()
            if (key != "" && this.Config.Has("users")) {
                for uid, user in this.Config["users"] {
                    if user.Has("profile") {
                        this._DecryptProfile(user["profile"], key)
                    }
                }
            }
            return true
        } catch as e {
            MsgBox("설정 파일 로드 중 오류 발생: " e.Message, "오류", "Iconx")
            return false
        }
    }

    ; 설정 저장
    static Save() {
        try {
            ; 1. Ensure file exists (to get File ID)
            if !FileExist(this.ConfigPath)
                FileAppend("", this.ConfigPath, "UTF-8")

            ; 2. Prepare data for saving (Encrypt sensitive fields)
            key := this.GetKey()

            ; Deep Copy via JSON to avoid modifying in-memory Config
            configToSave := JSON.parse(JSON.stringify(this.Config))

            if (key != "" && configToSave.Has("users")) {
                for uid, user in configToSave["users"] {
                    if user.Has("profile") {
                        this._EncryptProfile(user["profile"], key)
                    }
                }
            }

            fileContent := JSON.stringify(configToSave, 4)

            ; 3. Overwrite file (Preserve File ID by using FileOpen with "w")
            fObj := FileOpen(this.ConfigPath, "w", "UTF-8")
            fObj.Write(fileContent)
            fObj.Close()

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
    static GetKey() {
        if FileExist(this.ConfigPath)
            return GetFileID(this.ConfigPath)
        return ""
    }

    static _EncryptProfile(profile, key) {
        fields := ["pw2", "sapPW", "webPW"]
        for field in fields {
            if profile.Has(field) && profile[field] != "" {
                ; Prevent double encryption if something goes wrong, though we work on copy.
                ; Check if already encrypted? "ENC_"
                if (SubStr(profile[field], 1, 4) != "ENC_")
                    profile[field] := "ENC_" . Encrypt(profile[field], key)
            }
        }
    }

    static _DecryptProfile(profile, key) {
        fields := ["pw2", "sapPW", "webPW"]
        for field in fields {
            if profile.Has(field) && profile[field] != "" {
                if (SubStr(profile[field], 1, 4) == "ENC_") {
                    try {
                        decrypted := Decrypt(SubStr(profile[field], 5), key)
                        profile[field] := decrypted
                    } catch {
                        ; Decryption failed (wrong key?), keep original or empty?
                        ; Keep original (maybe user copied file manually?)
                    }
                }
            }
        }
    }
}
