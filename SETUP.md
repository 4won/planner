# 4WON'S PLANNER — 설치·배포 가이드

웹 주소 하나로 PC·휴대폰 어디서든 쓰고, 앱처럼 설치할 수 있는 PWA입니다.

| 구성 | 역할 | 비용 |
|---|---|---|
| GitHub Pages | 앱 화면(`docs/`)을 웹 주소로 공개 | 무료 |
| Supabase | 로그인, 할 일 저장·동기화, 월요일 알림 발송 | 무료 요금제 |

> 공개되는 것은 앱 코드뿐입니다. 할 일 데이터는 Supabase에 저장되고, 로그인한 본인만 읽을 수 있습니다(행 단위 보안 규칙).

---

## 1. Supabase 프로젝트 만들기 (직접, 약 5분)

1. https://supabase.com 에 가입하고 **New project**를 누릅니다.
   - Name: `planner`
   - Database Password: 아무 강한 비밀번호 (따로 보관. 이 앱에서는 쓰지 않음)
   - Region: **Northeast Asia (Seoul)**
2. 프로젝트가 만들어지면 **Project Settings → API**(또는 **Data API**)에서 아래 두 값을 복사해 Claude에게 알려 주세요.
   - **Project URL** (`https://xxxx.supabase.co`)
   - **anon public** 키 (공개용 키라 알려 줘도 괜찮습니다. `service_role` 키는 절대 공유하지 마세요)
3. **SQL Editor → New query**에 [`supabase/sql/01_schema.sql`](supabase/sql/01_schema.sql) 내용을 붙여 넣고 **Run**을 누릅니다.

## 2. Claude가 하는 일

Project URL을 받으면 Claude가 아래를 진행합니다.

- `docs/config.js`에 URL과 anon 키를 넣습니다.
- 월요일 예약 SQL을 만듭니다: `node tools/fill-cron-sql.js <Project URL>` → `supabase/sql/02_monday_cron.local.sql`
  - 이 파일 내용도 **SQL Editor**에 붙여 넣고 **Run** 해 주세요. 매주 월요일 08:30(한국 시간)에 알림 함수가 실행되도록 예약합니다.
- 알림 함수(`weekly-digest`)를 배포하고 비밀값을 등록합니다. 이를 위해 터미널에서 **한 번만** 아래 명령을 실행해 Supabase에 로그인해 주세요(브라우저가 열립니다).

```bash
npx -y supabase login
```

- GitHub 저장소를 만들어 올리고 GitHub Pages를 켭니다. 앱 주소는 `https://<GitHub 아이디>.github.io/planner/` 입니다.

## 3. 로그인 설정 (직접, 2분)

Supabase 대시보드 **Authentication → URL Configuration**에서

- **Site URL**을 앱 주소(`https://<GitHub 아이디>.github.io/planner/`)로 바꿉니다. 가입 확인 메일의 링크가 이 주소로 돌아옵니다.

## 4. 내 계정 만들기

1. 앱 주소를 열고 이메일·비밀번호(8자 이상)를 입력한 뒤 **처음이에요 · 가입**을 누릅니다.
2. 받은 확인 메일의 링크를 누르고, 앱으로 돌아와 **로그인**합니다.
3. 혼자 쓸 앱이므로 다른 사람이 가입하지 못하게 막습니다:
   **Authentication → Sign In / Providers**(또는 **Settings**)에서 **Allow new users to sign up**을 끕니다.

비밀번호를 잊으면 **Authentication → Users**에서 해당 사용자의 비밀번호 재설정 메일을 보낼 수 있습니다.

## 5. 기기마다 설치하기

| 기기 | 방법 |
|---|---|
| Windows / Mac (Chrome·Edge) | 앱 주소 → 주소창 오른쪽 **설치** 아이콘 → 설치. 시작 메뉴·작업표시줄에 고정 가능 |
| Android (Chrome) | 앱 주소 → 메뉴 ⋮ → **앱 설치** 또는 **홈 화면에 추가** |
| iPhone / iPad (Safari) | 앱 주소 → 공유 버튼 → **홈 화면에 추가** → 홈 화면 아이콘으로 실행 |

설치 후 각 기기에서 한 번씩 로그인하면 됩니다.

## 6. 월요일 알림 켜기 (기기마다)

앱 오른쪽 위 **⚙ 설정 → 월요일 알림 → 이 기기에서 알림 켜기** → 알림 허용.
**지금 테스트 알림 받기**로 바로 확인할 수 있습니다.

- iPhone은 iOS 16.4 이상에서, **홈 화면에 추가한 앱**으로 열었을 때만 알림을 켤 수 있습니다.
- 이번 주 챙길 일이 하나도 없는 주에는 알림을 보내지 않습니다.

---

## 7. 구글·애플 캘린더 연결 (선택)

앱 ⚙ 설정 → **구글 · 애플 캘린더**에서 두 방향을 각각 켭니다.

- **앱 일정 → 내 캘린더**
  - **구독 주소 만들기**를 누르고 주소를 복사합니다.
  - 구글: PC에서 calendar.google.com → 왼쪽 ‘다른 캘린더’ 옆 + → **URL로 추가**에 붙여 넣습니다.
  - 아이폰: **아이폰·맥에서 바로 구독** 버튼을 누릅니다.
  - 구글은 몇 시간 간격으로 새로 읽어서 반영이 늦을 수 있습니다.
- **내 캘린더 → 앱**
  - 구글은 캘린더 설정 → ‘캘린더 통합’의 **iCal 형식의 비공개 주소**를 복사합니다.
  - 애플은 캘린더 공유의 **공개 캘린더** 링크를 복사합니다.
  - 복사한 주소를 앱 설정에 붙여 넣습니다. 15분마다 가져오며, 가져온 일정은 읽기 전용입니다.

## 8. 메모 리캡

회의 메모방에 적은 뒤, Claude 데스크톱에서 “○○ 메모 리캡해줘”라고 말합니다.
Claude가 [RECAP.md](RECAP.md) 절차대로 요약과 등록 제안을 만들고, 앱의 메모 위에 리캡 카드로 띄웁니다.
카드에서 제목·날짜·프로젝트를 고치고 **선택 항목 등록**을 누르면 업무·일정이 만들어집니다.

## 9. 번역 탭 화자 구분 (Azure, 선택)

1. portal.azure.com에서 **Speech** 리소스를 **Free F0** 요금제·**Korea Central** 지역으로 만들고, "키 및 엔드포인트"에서 키 1을 복사합니다.
2. 서버 비밀값을 등록합니다 (Supabase 대시보드 › Edge Functions › Secrets, 또는 아래 명령).
   ```
   npx -y supabase secrets set AZURE_SPEECH_KEY=<키1> AZURE_SPEECH_REGION=koreacentral SPEECH_USER_IDS=<내 사용자 ID> --remote=ljltbagrjoowcseedwnw
   ```
3. 앱 번역 탭 › 번역 설정 › 음성 인식을 **Azure 화자 자동 구분**으로 바꿉니다.

사용 시간은 표 `speech_usage`에 월별(UTC)로 쌓이고, 5시간(`SPEECH_LIMIT_SEC`, 초 단위)이 차면 `speech-token` 함수가 토큰을 그만 주고 앱은 기기 내장 인식으로 자동 전환해 계속 듣습니다.

## 파일 구성

```
docs/                     GitHub Pages로 공개되는 앱
  index.html, styles.css
  js/                     화면별 모듈 (store.js = 오프라인 대기열·실시간 동기화 엔진)
  config.js               Supabase 주소·공개 키 (비어 있으면 이 기기에만 저장)
  sw.js                   오프라인 캐시, 푸시 알림 표시
  manifest.webmanifest    설치형 앱 정보
  icons/                  앱 아이콘 (tools/make-icons.js로 생성)
supabase/
  sql/01_schema.sql       테이블·보안 규칙
  sql/02_monday_cron.template.sql  월요일 예약 (값 채우기 전 원본)
  sql/03_projects_events_memos.sql  프로젝트·일정·메모·리캡·캘린더 표
  sql/04_more_cron.template.sql     일정 알림(매분)·캘린더 가져오기(15분) 예약
  functions/weekly-digest/  월요일 주간 요약 푸시
  functions/event-reminders/ 일정 시작 전 알림 푸시
  functions/calendar-feed/   구글·애플 구독용 ICS 주소
  functions/widget-data/     바탕화면 위젯(docs/widget.html)용 읽기 전용 데이터 (구독 주소와 같은 토큰)
  functions/ai-recap/        메모 "AI 리캡" 버튼: Gemini 무료 등급으로 정리본·등록 제안을 recaps에 저장
                             비밀값 GEMINI_API_KEY (.gemini.local.txt → secrets set), 선택 GEMINI_MODEL (쉼표로 순서, 기본 gemini-3.5-flash,gemini-flash-latest,gemini-3.8-flash)
  functions/calendar-sync/   구글·애플 iCal 가져오기
RECAP.md                  Claude가 메모를 리캡하는 절차
tools/                    아이콘·SQL 생성 스크립트
.vapid.local.json, .cron-secret.local.txt  푸시·예약용 비밀값 (git에 올리지 않음)
```

## 앱을 고친 뒤 배포할 때

`docs/sw.js`의 `CACHE` 이름(예: `wcp-v2` → `wcp-v3`)을 올리고, 새 파일이 생겼으면 `SHELL` 목록에도 넣은 뒤 GitHub에 푸시합니다. 앱은 다음에 열 때 새 버전을 받습니다.
