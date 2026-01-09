#Requires AutoHotkey v2.0

class WorkLogManager {
    static BaseDate := "20260101"   ; 기준일

    ; 주간 근무 순서: A -> D -> C -> B
    static DayShiftOrder := ["A", "D", "C", "B"]

    ; 야간 근무 순서: B -> A -> D -> C
    static NightShiftOrder := ["B", "A", "D", "C"]

    ; --------------------------------------------------------------------------
    ; 현재 컨텍스트(이전/현재/다음 근무) 반환
    ; --------------------------------------------------------------------------
    static GetCurrentContext(userTeam := "") {
        now := A_Now

        ; 00:00 ~ 09:00 사이인 경우 전날 야간으로 간주 (Global Logic)
        hour := Integer(FormatTime(now, "H"))
        min := Integer(FormatTime(now, "m"))
        timeVal := hour * 100 + min ; HHmm format for easier comparison

        isNightCorrection := (hour < 9)

        targetDate := now
        if (isNightCorrection) {
            targetDate := DateAdd(now, -1, "Days")
        }

        ; Global Standard Logic
        ; 09:00 ~ 17:59 : 주간
        ; 18:00 ~ 08:59 : 야간 (익일 09시 전까지)
        isNight := (hour >= 18 || hour < 9)

        currentTeam := this.CalculateTeam(targetDate, isNight)

        ; --- Buffer Logic Override (30m) ---
        ; Morning Buffer: 08:30 (830) ~ 09:30 (930)
        ; Evening Buffer: 17:30 (1730) ~ 18:30 (1830)
        if (userTeam != "") {
            ; Normalize team name (remove "조" suffix if present)
            userTeam := StrReplace(userTeam, "조", "")

            ; 1. Morning Buffer (08:30 ~ 09:30)
            if (timeVal >= 830 && timeVal <= 930) {
                ; Transition: Night (Outgoing) -> Day (Incoming)
                ; Date context:
                ; If 08:30~08:59: Standard is Night (Prev Day Calc). Incoming is Day (Today Calc).
                ; If 09:00~09:30: Standard is Day (Today Calc). Outgoing is Night (Prev Day Calc).

                ; To be safe, let's calculate both potential teams for THIS buffer period
                ; Morning transition is always relative to "today" (if < 9 -> targetDate is yesterday. If >=9 -> targetDate is today)
                ; Actually, let's just calc "Yesterday Night" and "Today Day".

                ; "Night Team" (Outgoing): Yesterday's Night
                nightTeam := this.CalculateTeam(DateAdd(now, (hour < 9 ? -1 : -1), "Days"), true) ; Wait, if 9:00, -1 day. If 8:30, -1 day (already targetDate).
                ; Let's use absolute dates based on NOW

                dateForNight := (hour < 9) ? DateAdd(now, -1, "Days") : DateAdd(now, -1, "Days")
                ; Wait, at 09:10, Night was yesterday's night. Correct.

                dateForDay := now ; Today's Day

                teamNight := this.CalculateTeam(dateForNight, true)
                teamDay := this.CalculateTeam(dateForDay, false)

                if (userTeam == teamDay) {
                    ; User is Day Team -> Force Day Context
                    isNight := false
                    currentTeam := teamDay
                    targetDate := dateForDay ; Reset target date to today if forced to Day
                } else if (userTeam == teamNight) {
                    ; User is Night Team -> Force Night Context
                    isNight := true
                    currentTeam := teamNight
                    targetDate := dateForNight ; Reset target date to yesterday if forced to Night
                }
            }
            ; 2. Evening Buffer (17:30 ~ 18:30)
            else if (timeVal >= 1730 && timeVal <= 1830) {
                ; Transition: Day (Outgoing) -> Night (Incoming)

                teamDay := this.CalculateTeam(now, false) ; Today Day
                teamNight := this.CalculateTeam(now, true) ; Today Night

                if (userTeam == teamNight) {
                    ; User is Night Team -> Force Night Context
                    isNight := true
                    currentTeam := teamNight
                } else if (userTeam == teamDay) {
                    ; User is Day Team -> Force Day Context
                    isNight := false
                    currentTeam := teamDay
                }
            }
        }

        ; 이전/다음 근무 계산 (Based on finalized isNight/currentTeam)
        if (!isNight) { ; 현재 주간
            prevTeam := this.CalculateTeam(DateAdd(targetDate, -1, "Days"), true) ; 전날 야간
            nextTeam := this.CalculateTeam(targetDate, true)                      ; 오늘 야간

            shiftName := "주간"
        } else { ; 현재 야간
            prevTeam := this.CalculateTeam(targetDate, false)                     ; 오늘 주간
            nextTeam := this.CalculateTeam(DateAdd(targetDate, 1, "Days"), false) ; 내일 주간

            shiftName := "야간"
        }

        return Map(
            "date", FormatTime(targetDate, "yyyyMMdd"),
            "isNight", isNight,
            "shiftName", shiftName,
            "prev", prevTeam,
            "current", currentTeam,
            "next", nextTeam
        )
    }

    ; --------------------------------------------------------------------------
    ; 특정 날짜/시간대의 근무조 계산
    ; --------------------------------------------------------------------------
    static CalculateTeam(dateStr, isNight) {
        ; 날짜 차이 계산 (일 단위)
        diff := DateDiff(dateStr, this.BaseDate, "Days")

        ; 음수 처리 (기준일 이전)
        if (diff < 0) {
            diff := Mod(diff, 4) + 4
        }

        idx := Mod(diff, 4) + 1 ; 1-based index

        if (isNight) {
            return this.NightShiftOrder[idx]
        } else {
            return this.DayShiftOrder[idx]
        }
    }
}
