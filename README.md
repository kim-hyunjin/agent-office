# Agent Office

Claude Code 세션들이 일하는 모습을 **픽셀아트 사무실**로 보여주는 로컬 웹 UI입니다.

- 터미널에서 띄운 `claude` 세션 하나 = 직원 한 명. 책상에 앉아 파일을 읽고, 코드를 고치고, 터미널을 두드립니다.
- `Agent` 툴로 띄운 서브에이전트 = 옆자리 보조 직원. 일이 끝나면 사라집니다.
- 권한 승인을 기다리면 손을 들고 `!`, 답변이 끝나면 말풍선, 세션이 끝나면 문으로 퇴근합니다.
- 직원을 클릭하면 오른쪽 패널에 활동 로그가 나옵니다.

의존성 없음. Node 24 이상만 있으면 됩니다.

## 사용법

```bash
cd ~/agent-office
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
책상 배정은 `~/.agent-office/state.json`에 기억되어 서버를 재시작해도 같은 세션은 같은 자리에 앉습니다.

## 사무실 구조와 행동

```
┌ 회의실 A ┐  ┌────── 벤치 책상 4줄 (16석) ──────┐  ┌ 기획 보드 ┐
├ 회의실 B ┤  │  2인 벤치 × 2 pod, 통로           │  ├ 서가      ┤
└ 로비·입구 ┘  └───────────────────────────────────┘  └ 라운지    ┘
```

| 상황 | 행동 |
|---|---|
| 새 세션 | 로비 문으로 들어와 빈 책상까지 걸어감 (벽·가구를 피해 경로 탐색) |
| 서브에이전트가 살아 있음 | 직원이 빈 **회의실** 상석에 앉고, 보조 직원들이 테이블에 둘러앉음(노트북 펼침). 마지막 보조가 끝나고 8초 뒤 복귀. 회의실 2개가 다 차면 책상 옆 통로에 보조 직원이 서서 일함 |
| `plan` 모드 | **기획 보드** 앞에 서서 마커로 끄적임. 모드가 바뀌면 자리로 복귀 |
| 웹 검색 (WebFetch / WebSearch) | **서가** 책장 앞에 서서 책을 뒤적임. 마지막 검색 후 10초 동안 머물다 자리로 복귀(연속 검색 시 왔다갔다 방지), 대기 상태가 되면 바로 복귀 |
| `auto` / `bypassPermissions` / `dontAsk` | 번개 배지, 타이핑과 모니터 코드 스크롤이 빨라짐 |
| `acceptEdits` | 체크 배지 |
| 90초 이상 대기 | **라운지** 소파나 커피머신 앞에서 커피를 마시며 쉼. 다음 프롬프트에 복귀 (`?loungeAfter=초` 로 조절) |
| 권한 대기 | 손 들고 `!` |
| 세션 종료 | 문으로 걸어 나가고 5분 뒤 책상 반납 |

책상 이름표는 항상 그 자리 주인을 보여주고, 자리를 비우면 어디 갔는지("회의실 A", "기획 보드", "서가", "라운지")를 대신 표시합니다.

## 상태 (툴 → 모니터·소품)

| 상태 | 트리거 | 연출 |
|---|---|---|
| 대기 | Stop, idle 알림 | 커피, 가끔 Zzz |
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

## 모델별 외형 (직급)

직원의 옷차림, 책상 장비, 이름표 직함은 세션이 쓰는 모델 계열에 따라 정해집니다(화면 우하단 범례). 상위 모델일수록 '선임'처럼 보입니다. 같은 계열 안에서는 세션마다 머리·피부색이 달라집니다.

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
| `AGENT_OFFICE_PORT` | `17777` | 서버 포트. 훅 스크립트도 같은 변수를 읽습니다. |
| `AGENT_OFFICE_DATA` | `~/.agent-office` | 책상 배정 저장 위치 |
| `AGENT_OFFICE_DEBUG` | | `1`이면 훅 스크립트가 `~/.agent-office/hook.log`에 기록 |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Claude Code 설정 디렉터리를 옮긴 경우 |

## 트러블슈팅

- **직원이 안 나타남**: `pnpm install-hooks`를 실행했는지, 서버가 떠 있는지 확인. 이미 떠 있던 `claude`는 재시작해야 툴 상세가 보입니다(존재 여부는 레지스트리로 바로 보임).
- **훅이 도는지 확인**: `AGENT_OFFICE_DEBUG=1 claude` 로 실행한 뒤 `~/.agent-office/hook.log`를 보거나, `claude --debug hooks`.
- **서버 로그**: 서버 터미널에 `[hook] PreToolUse Edit · office.js  <세션> → coding` 식으로 찍힙니다.
- **포트 충돌**: `AGENT_OFFICE_PORT=18000 pnpm start` 처럼 바꾸고, 훅도 같은 변수를 보도록 쉘 환경에 export 하세요.

## 구조

```
server/   index.mjs(HTTP/SSE) · reducer.mjs(이벤트→상태) · store.mjs(모델/책상/영속화)
          registry.mjs(세션 레지스트리 폴링) · transcript.mjs(transcript tail)
web/      office.js(진입점) · render.js · sprites.js · tilemap.js · panel.js
hooks/    send.mjs(훅 본체) · install.mjs · uninstall.mjs
scripts/  demo.mjs(가짜 이벤트 재생)
```
