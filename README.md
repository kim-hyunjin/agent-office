# Pawgents Office

Claude Code 세션들이 일하는 모습을 **픽셀아트 사무실**로 보여주는 로컬 웹 UI입니다.

- 터미널에서 띄운 `claude` 세션 하나 = 직원 한 명. 책상에 앉아 파일을 읽고, 코드를 고치고, 터미널을 두드립니다.
- `Agent` 툴로 띄운 서브에이전트 = 옆자리 보조 직원. 일이 끝나면 사라집니다.
- 권한 승인을 기다리면 손을 들고 `!`, 답변이 끝나면 말풍선, 세션이 끝나면 문으로 퇴근합니다.
- 직원을 클릭하면 오른쪽 패널에 활동 로그가 나옵니다. 패널의 답변 카드를 누르면 전체 답변을 마크다운으로 크게 볼 수 있습니다.

의존성 없음. Node 24 이상만 있으면 됩니다.

## 사용법

### Claude Code 플러그인으로 (권장)

```
/plugin marketplace add kim-hyunjin/pawgents-office
/plugin install pawgents-office@pawgents-office
```

설치 후 새로 띄우는 `claude` 세션부터 훅이 자동으로 걸리고, 세션이 시작될 때 서버가 꺼져 있으면 백그라운드로 띄웁니다(로그: `~/.pawgents-office/server.log`). settings.json은 건드리지 않습니다.

| 명령 | 동작 |
|---|---|
| `/pawgents-office:open` | 서버를 (꺼져 있으면) 띄우고 브라우저로 http://127.0.0.1:17777 을 엽니다 |
| `/pawgents-office:stop` | 백그라운드 서버를 끕니다 |

자동 시작이 싫으면 `PAWGENTS_OFFICE_AUTOSTART=0`을 설정하고 `pnpm start`로 직접 띄우세요.
예전에 `pnpm install-hooks`로 훅을 설치했다면 이벤트가 두 번 들어가니 `pnpm uninstall-hooks`로 먼저 지우세요.
로컬 클론을 그대로 쓰려면 `/plugin marketplace add ~/pawgents-office` 처럼 경로를 넣으면 됩니다.

### 직접 실행

```bash
cd ~/pawgents-office
pnpm install-hooks     # 최초 1회: ~/.claude/settings.json에 hook 등록 (자동 백업)
pnpm start             # http://127.0.0.1:17777
claude                 # 아무 터미널, 아무 레포에서 평소처럼 사용
```

```bash
pnpm demo              # Claude 없이 가짜 직원 2명으로 화면 확인
pnpm uninstall-hooks   # hook 제거 (settings.json 원복)
```

`pnpm`이 없으면 `node server/index.mjs`, `node hooks/install.mjs` 처럼 직접 실행해도 됩니다.

## 동작 방식

| 소스 | 용도 |
|---|---|
| **Claude Code hooks** (`SessionStart/End`, `UserPromptSubmit`, `Pre/PostToolUse`, `PermissionRequest`, `Notification`, `Stop`, `SubagentStart/Stop` 등) | 상태 변화의 주 소스. `async` command hook이라 Claude를 기다리게 하지 않고, 훅 스크립트는 아무것도 출력하지 않아 **토큰을 쓰지 않습니다**. |
| `~/.claude/sessions/<pid>.json` | 살아있는 세션 목록. hook 설치 전에 시작된 세션도 여기서 잡아 표시합니다(존재·바쁨 여부만). 프로세스가 죽으면 퇴근 처리. |
| transcript (`~/.claude/projects/.../<session>.jsonl`) | 세션 제목, 모델, 최근 답변 텍스트(말풍선). 상태는 바꾸지 않습니다. |

서버(`server/`)는 `POST /hook`으로 이벤트를 받아 상태를 갱신하고 `GET /events`(SSE)로 브라우저에 밀어줍니다.
책상 배정은 `~/.pawgents-office/state.json`에 기억되어 서버를 재시작해도 같은 세션은 같은 자리에 앉습니다.

## 사무실 구조와 행동

```
┌ 회의실 A ┐┌─ 사무실: 마주 보는 세로 책상 2줄 (12석) ─┐┌ 회의실 C ┐
├ 회의실 B ┤│  놀이터: 캣타워·스크래처·캣휠·실뭉치·박스·방석  │├ 회의실 D ┤
└ 로비·입구 ┘└ 휴게실 ┘└ 기획실 (보드) ┘└ 서재 (책장) ─────────────┘
```

| 상황 | 행동 |
|---|---|
| 새 세션 | 로비 문으로 들어와 빈 책상까지 걸어감 (벽·가구를 피해 경로 탐색) |
| 서브에이전트가 살아 있음 | 직원이 빈 **회의실** 상석에 앉고, 보조 직원들이 테이블에 둘러앉음(노트북 펼침). 마지막 보조가 끝나고 8초 뒤 복귀. 회의실 4개가 다 차면 책상 옆 통로에 보조 직원이 서서 일함 |
| `plan` 모드 | **기획실** 보드 앞에 서서 마커로 끄적임. 모드가 바뀌면 자리로 복귀 |
| 웹 검색 (WebFetch / WebSearch) | **서재** 책장 앞에 서서 책을 뒤적임. 마지막 검색 후 10초 동안 머물다 자리로 복귀(연속 검색 시 왔다갔다 방지), 대기 상태가 되면 바로 복귀 |
| `auto` / `bypassPermissions` / `dontAsk` | 번개 배지, 타이핑과 모니터 코드 스크롤이 빨라짐 |
| `acceptEdits` | 체크 배지 |
| 15초 이상 대기 | 자리를 떠나 **놀이터**와 **휴게실**을 돌아다님: 캣타워 꼭대기, 스크래처에 앞발 대고 긁기, 캣휠 달리기, 실뭉치 치기, 박스에 들어가기, 방석에서 낮잠(Zzz), 소파·커피머신. 7~15초(낮잠·휴게실은 20~40초)마다 다른 곳으로 이동. 다음 프롬프트에 복귀 (`?playAfter=초` 로 조절). 백그라운드 셸을 기다리는 중이면 자리에서 대기 |
| 권한 대기 | 손 들고 `!` |
| 세션 종료 | 문으로 걸어 나가고 5분 뒤 책상 반납 |

이름·상태 글자는 화면에 띄우지 않습니다. 고양이에 마우스를 올리면 툴팁, 클릭하면 상세 패널이 열립니다. 왼쪽 위 상태 표시의 "목록 ▾"를 누르면 직원 목록이 열려, 모두의 상태·위치를 한눈에 보고 줄을 눌러 상세 패널로 가거나 **퇴근** 버튼(두 번 눌러 확인)으로 세션을 끝낼 수 있습니다. 로비 카운터의 헤드셋 쓴 벵갈 고양이는 상주 안내원으로, 세션과 무관한 장식입니다. 오른쪽 아래 "모델 안내" 버튼을 누르면 모델별 품종·직급·모니터와 현재 인원을 보여주고, 모델마다 품종을 고를 수 있습니다.

## 상태 (툴 → 모니터·소품)

| 상태 | 트리거 | 연출 |
|---|---|---|
| 대기 | Stop, idle 알림 | 책상의 커피 → 잠시 뒤 놀이터·휴게실로 |
| 생각 중 | 프롬프트 제출, 툴 완료 직후 | 머리 위 `...` |
| 읽는 중 | Read / Grep / Glob | 책, 어두운 모니터 |
| 코딩 중 | Edit / Write / MultiEdit / NotebookEdit | 파란 모니터 + 코드 줄 |
| 터미널 | Bash | 검은 모니터 + 초록 글자 |
| 검색 중 | WebFetch / WebSearch | 돋보기 |
| 위임 중 | Agent / Task | 전화기, 종이비행기가 보조 직원에게 날아감 |
| 작업 중 | 그 외 툴, 또는 레지스트리 busy | 흰 모니터 |
| 응답 대기 | PermissionRequest, permission 알림, AskUserQuestion | 손 들기 + `!` |
| 퇴근 | SessionEnd, 프로세스 종료 | 문으로 걸어 나감, 5분 뒤 책상 반납 |

## 무엇을 하는지 자세히 보기

| 위치 | 내용 |
|---|---|
| 책상 이름표 | 이름 / 현재 툴 · 대상 (또는 행선지) / 직급 · 모드 |
| 마우스 올리기 | 현재 지시(프롬프트), 툴 상세(전체 명령·경로·패턴), 생각 중인 내용, 보조 직원이 받은 임무 |
| 직원 클릭 (패널) | 현재 작업과 소요 시간, 이번 턴 툴 횟수·경과, 비용과 변경 줄 수, 지시문, 생각 중, 보조 직원별 임무·현재 툴, 작업한 파일, 활동 로그(툴 상세 + 결과 앞부분 + 소요 시간) |
| 화면 하단 티커 | 모든 세션의 최근 활동 6건이 실시간으로 흐름 |

`hooks/send.mjs`는 `tool_response`의 앞 400자만 남기고 버리며, Agent 툴의 지시문은 600자까지 보조 직원에게 연결합니다. 생각 중 내용과 비용은 transcript에서 읽습니다(thinking 블록, `cost-state`).

## 웹에서 지시하기 (Orca)

[Orca](https://github.com/stablyai/orca) 터미널에서 실행 중인 세션에는 웹에서 직접 지시를 보낼 수 있습니다. `orca` CLI가 PATH에 있어야 합니다.

- **기존 직원에게 지시**: 직원을 클릭하고 패널 아래 입력창에 쓰고 Enter를 누릅니다(Shift+Enter는 줄바꿈). 서버가 `orca terminal send`로 그 세션의 터미널에 입력합니다. 직접 타이핑한 것과 똑같이 처리되고, 작업 중이면 Claude Code가 큐에 넣습니다.
- **새 직원 채용**: 사무실 아래쪽 벽, 직급 범례 옆의 `+ 새 직원` 버튼을 누르고 워크트리, 모델(선택), 첫 지시(선택)를 고르면 `orca agent launch --agent claude`로 새 세션을 띄웁니다. 곧 로비로 들어옵니다.
- **퇴근시키기**: 패널 머리의 `퇴근`을 두 번 누릅니다(첫 클릭은 확인용). 대기 중인 세션은 `/exit`로 깔끔하게 끝납니다. 웹에서 띄운 세션이면 탭도 닫히고, 직접 연 탭이면 셸이 남습니다. 작업 중이거나 권한 응답 대기 중이면 `강제 종료`로 바뀌고, Orca 터미널 탭을 닫아 진행 중인 작업을 끊습니다. 대화는 `claude --resume <세션 ID>`로 이어갈 수 있습니다.
- 권한 승인이나 질문 응답을 기다리는 세션에는 지시를 보내지 않습니다. 보낸 Enter가 다이얼로그의 기본 선택(승인)으로 들어갈 수 있기 때문입니다. 터미널에서 먼저 답해 주세요.

세션과 터미널은 훅이 보내는 `ORCA_TERMINAL_HANDLE`로 연결합니다(Orca가 관리 터미널에 넣어 주는 변수). 훅이 아직 안 온 세션은 같은 워크트리의 claude 터미널이 하나뿐일 때만 자동으로 짝을 짓습니다. 후보가 여럿이면 그 세션에서 한 번 프롬프트를 보내 연결하세요.

터미널에 입력을 넣는 엔드포인트(`POST /sessions/:id/prompt`, `POST /sessions/:id/close`, `POST /orca/launch`)는 같은 출처의 JSON 요청만 받습니다(Host·Origin·Content-Type 검사). 다른 웹페이지가 지시를 몰래 보낼 수 없고, `/hook`도 브라우저 요청(Origin 헤더 있음)은 거부합니다.

## 모델별 외형 (직급)

직원은 모두 고양이(보조 직원은 새끼 고양이)입니다. 이동할 때는 네 발로 뛰어다니고, 자리에서는 앉아서 앞발로 키보드를 두드리거나 책을 펼칩니다. 고양이 품종, 책상 장비, 직함은 세션이 쓰는 모델 계열에 따라 정해집니다. 기본 품종은 '똑똑한 고양이' 순위에 자주 오르는 순서를 따랐고, 오른쪽 아래 **모델 안내**에서 모델마다 품종을 바꿀 수 있습니다(서버의 `state.json`에 저장되어 모든 브라우저에 바로 반영). 고를 수 있는 품종: 아비시니안, 샴, 러시안블루, 페르시안, 코숏, 벵갈, 랙돌, 메인쿤, 브리티시 숏헤어, 스핑크스, 노르웨이 숲, 봄베이, 터키시 앙고라, 스코티시 폴드, 먼치킨. 품종마다 털색뿐 아니라 체형도 다릅니다(큰 귀·작은 귀·접힌 귀·링크스 귀털, 날씬·통통·대형·짧은 다리).

| 모델 | 직함 | 기본 품종 |
|---|---|---|
| Fable | 수석 | 아비시니안 (붉은 갈색 틱드 털) |
| Opus | 선임 | 샴 (크림색 몸, 어두운 얼굴·귀·발·꼬리, 파란 눈) |
| Sonnet | 사원 | 러시안 블루 (청회색, 초록 눈) |
| Haiku | 인턴 | 페르시안 (긴 털, 볼 갈기) |
| 기타 | — | 코리안 숏헤어 (치즈·고등어·턱시도·올블랙·삼색) |

같은 품종 안에서도 세션마다 털색이 조금씩 다릅니다(예: 샴은 실·블루·라일락 포인트).

| 계열 | 모델 id 패턴 | 직함 | 외형 | 책상 |
|---|---|---|---|---|
| Fable | `fable`, `mythos` | 수석 | 보라 정장 + 금색 넥타이 + 금 배지 | 금테 와이드 모니터 |
| Opus | `opus` | 선임 | 남색 정장 + 빨간 넥타이 + 안경 | 은테 모니터 |
| Sonnet | `sonnet` | 사원 | 청록 캐주얼 + 헤드폰 | 일반 모니터 |
| Haiku | `haiku` | 인턴 | 주황 티셔츠 + 사원증 목걸이 | 작은 노트북 |
| 기타 | 그 외 / 미확인 | — | 세션 해시 색, 액세서리 없음 | 일반 모니터 |

모델은 `SessionStart` 훅의 `model`, `PostModelSwitch`, transcript의 assistant 메시지에서 읽습니다. 보조 직원은 자기 transcript의 모델을 쓰고, 없으면 부모 세션 모델을 따릅니다. 계열·직함·액세서리 정의는 `web/sprites.js`의 `FAMILIES` 한 곳에 있습니다.

## 설정

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `PAWGENTS_OFFICE_PORT` | `17777` | 서버 포트. 훅 스크립트도 같은 변수를 읽습니다. |
| `PAWGENTS_OFFICE_DATA` | `~/.pawgents-office` | 책상 배정 저장 위치 |
| `PAWGENTS_OFFICE_DEBUG` | | `1`이면 훅 스크립트가 `~/.pawgents-office/hook.log`에 기록 |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Claude Code 설정 디렉터리를 옮긴 경우 |
| `PAWGENTS_OFFICE_ORCA_BIN` | `orca.exe` (Windows) / `orca` (macOS) / `orca-ide` (Linux) | Orca CLI 실행 파일. `ORCA_CLI_COMMAND`가 있으면 그 값을 씁니다. |

## 트러블슈팅

- **직원이 안 나타남**: 플러그인이 켜져 있는지(`/plugin`) 또는 `pnpm install-hooks`를 실행했는지, 서버가 떠 있는지 확인. 이미 떠 있던 `claude`는 재시작해야 툴 상세가 보입니다(존재 여부는 레지스트리로 바로 보임).
- **훅이 도는지 확인**: `PAWGENTS_OFFICE_DEBUG=1 claude` 로 실행한 뒤 `~/.pawgents-office/hook.log`를 보거나, `claude --debug hooks`.
- **서버 로그**: 서버 터미널에 `[hook] PreToolUse Edit · office.js  <세션> → coding` 식으로 찍힙니다.
- **포트 충돌**: `PAWGENTS_OFFICE_PORT=18000 pnpm start` 처럼 바꾸고, 훅도 같은 변수를 보도록 쉘 환경에 export 하세요.

## 구조

```
server/   index.mjs(HTTP/SSE) · reducer.mjs(이벤트→상태) · store.mjs(모델/책상/영속화)
          registry.mjs(세션 레지스트리 폴링) · transcript.mjs(transcript tail) · orca.mjs(Orca CLI 연동)
web/      office.js(진입점) · render.js · sprites.js · layout.js(배치 데이터·검증) · tilemap.js(배경 그리기)
          panel.js · launcher.js(새 직원)
hooks/    send.mjs(훅 본체) · ensure-server.mjs(서버 자동 시작) · hooks.json(플러그인 훅) · install.mjs · uninstall.mjs
scripts/  demo.mjs(가짜 이벤트 재생) · stop.mjs(백그라운드 서버 종료)
commands/ open.md · stop.md (플러그인 슬래시 명령)
.claude-plugin/  plugin.json · marketplace.json
```
