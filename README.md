# appin-timetable-parser

압핀(유원테크, YWTek) 시간표 시스템의 공개 인터넷 서버(`sgpap.com`)에서 학교 시간표를 가져와, 다루기 쉬운 구조로 해석하는 **의존성 없는** Node.js 라이브러리입니다.

압핀은 국내 일부 중·고등학교가 쓰는 시간표 작성·안내 프로그램으로, 학교가 만든 시간표를 유원테크의 인터넷 서버로 올려 앱(iOS/Android/PC)이 받아 보여줍니다. 이 라이브러리는 그 공개 서버가 실제로 주고받는 형식을 분석해, 앱 없이도 시간표를 프로그램으로 읽을 수 있게 합니다. (컴시간 알리미용 파서가 여럿 공개돼 있는 것과 같은 맥락의, 압핀용 상호운용 파서입니다.)

> **비공식 프로젝트입니다.** 유원테크와 아무런 관련이 없으며, 리버스 엔지니어링으로 파악한 규격이라 예고 없이 바뀌면 동작하지 않을 수 있습니다.

> **정적 파일 방식입니다.** 이 라이브러리는 학교 폴더의 정적 텍스트 파일(`h/g/t/s<N>.txt`)을 직접 읽습니다. 압핀 앱과 동일한 동적 PHP 흐름(`hbtime.php`/`gstime.php`)을 쓰는 TypeScript 클라이언트로는 동료 교사의 [apin-timetable](https://github.com/shinnanchanguk/apin-timetable)이 있으며, 두 방식은 **같은 학교·같은 주차에서 동일한 결과**를 냅니다(아래 "교차 검증" 참고).

## 특징

- 의존성 0개 — Node 18+의 내장 `fetch` / `TextDecoder`만 사용(EUC-KR 디코딩 포함)
- 정적 파일(EUC-KR)과 PHP 응답(UTF-8)의 인코딩 혼재를 자동 처리
- 학급·교사·교실 시간표 격자(요일 × 교시 × `과목/대상`)와 교시 시각을 구조화된 JSON으로 반환

## ⚠️ 책임 있는 사용

- 이 도구는 **자신의 학교 시간표를 조회**하는 등 정당한 상호운용·학습 목적을 위한 것입니다.
- 남의 서버이므로 **대량 수집·과도한 요청을 하지 마세요.** 이 저장소는 전체 학교를 훑는 기능을 제공하지 않습니다.
- 저장소에는 **어떤 학교의 실제 시간표 데이터도 포함하지 않습니다.** 예제는 실행 시점에 직접 받아옵니다.
- 개인정보(교사 이름 등)는 이 서버에 게시되지 않습니다(아래 "한계" 참고).

## 설치

```bash
# 아직 npm 미배포. 저장소를 직접 사용하세요.
git clone https://github.com/pblsketch/appin-timetable-parser.git
cd appin-timetable-parser
```

## 빠른 시작

```js
const appin = require('./src'); // 또는 require('appin-timetable-parser')

(async () => {
  // 1) 학교명으로 코드 찾기
  const school = await appin.resolveSchool('대구', '학남고등학교');
  const webdir = school.webdir; // 예: '0650'

  // 2) 기준 목록(학급 / 교사 번호 / 교실 / 버전)
  const ele = await appin.getElements(webdir);
  console.log(ele.classes);        // ['1-1','1-2', …]
  console.log(ele.teacherNumbers); // ['1','2', … '54']  (이름 아님)

  // 3) 현재 주차 = 파일 번호 (날짜 계산이 권장)
  const week = appin.weekNoFromDate(); // 예: 20

  // 4) 학급 시간표 (h<week>.txt)
  const idx = appin.classIndexOf(ele.classes, '1-1');
  const row = await appin.getClassTimetable(webdir, week, idx);
  // row[요일][교시] = { subject, ref } | null
  console.log(row[0]); // 월요일

  // 5) 교사 시간표(g), 교시 시각(s)
  const teacher = await appin.getTeacherTimetable(webdir, week, 0); // 1번 교사
  const times = await appin.getPeriodTimes(webdir, week);           // ['08:30', …]
})();
```

명령줄 예제:

```bash
node example.js 대구 학남고등학교
node example.js 0650              # webdir 를 직접 아는 경우
```

## 서버·데이터 구조

리버스 엔지니어링 + 실측(2026-07-07 대구 학남고 `0650`)으로 확인한 내용입니다.

### 서버

- 베이스: `http://www.sgpap.com` (평문 HTTP)
- PHP 엔드포인트: `POST`, `application/x-www-form-urlencoded`, **UTF-8**
- 시간표 원본: `http://www.sgpap.com/tm/<webdir>/` 폴더의 **정적 텍스트 파일**(로그인 불필요), **EUC-KR(CP949)**

### 주요 엔드포인트

| 경로 | 용도 | 파라미터 |
|---|---|---|
| `/tm/getupdir.php` | (시/군, 학교명) → 학교 코드 | `hgsj`, `hgm` |
| `/tm/dnele.php` | 기준 목록(학급/교사번호/교실/버전) | `webdir` |
| `/tm/checkapvpcver.php` | 서버/버전 확인 | — |

`getupdir` 는 **정확한 등록명에만** 매칭하며, 없으면 `1&nothing` 을 반환합니다.

### 학교 폴더 파일 구조 (`/tm/<webdir>/`)

실측으로 파일 종류를 확정했습니다(학남고 0650 기준 줄 수와 dnele 목록·`hbtime`/`gstime` 응답 대조).

| 파일 | 내용 | 줄 수(대상) | 셀 형식 |
|---|---|---|---|
| `ele.txt` | 이동수업 교실/반 목록(이름 CSV + 인덱스) | — | — |
| `h<N>.txt` | **학급 시간표** (`hbtime.php` 와 동일) | 학급 수(27) | `과목` |
| `g<N>.txt` | **교사 시간표** (`gstime.php` 와 동일) | 교사 수(54) | `과목/학급` |
| `t<N>.txt` | **특별실/교실 시간표** | 교실 수(1=정보실) | `과목/학급` |
| `s<N>.txt` | **교시 시작시각** (요일 수만큼 반복) | 1 | `HHMM` 연속 |
| `<name>.inx` | 각 `.txt`의 줄별 바이트 오프셋 색인(4바이트 정수, 무시 가능) | — | — |
| `hsidb.txt`, `*.cnt` | 학교 코드·버전 등 메타데이터 | — | — |

> ⚠️ 이전 문서는 `g`를 "학급+이동교실", `t`를 "교사", `s`를 "학생 개인시간표"로 잘못 설명했습니다. 실측 결과 **`g`=교사, `t`=특별실, `s`=교시시각**으로 정정했습니다(동료 교사 [apin-timetable](https://github.com/shinnanchanguk/apin-timetable)과 교차 검증).

### 시간표 셀 문법

`h/g/t` 파일은 **한 줄 = 한 대상(학급·교사·교실)의 한 주간 시간표** 입니다.

```
줄 = 요일1 , 요일2 , 요일3 , 요일4 , 요일5 ,
요일 = 교시1 ^ 교시2 ^ … ^ 교시N
교시 = "" (빈 시간) | "과목" | "과목/대상"
```

- 학급 파일(`h`): 대개 `과목`만. 예: `과학탐구실험1^통합과학1^공통영어1^…`
- 교사·교실 파일(`g`/`t`): `과목/학급`. 예: `공통국어1/1-7^공통국어1/1-2^…` — `/` 뒤는 **학급 라벨**(교실 번호가 아님)

`parseCell` 은 `/` 뒤 값을 `ref` 로 돌려줍니다(교실이 아니라 문맥상 학급 라벨). `@B…@K` 같은 `@`+영문자 마커(서식/구분 표시로 추정)는 제거한 값을 `subject` 로, 원본을 `raw` 로 보존합니다.

### 인코딩

- 정적 파일(`ele/h/g/t/s.txt`): **EUC-KR(CP949)**
- PHP 응답(`dnele` 등): **UTF-8**

라이브러리가 알아서 구분해 디코딩합니다.

## 학교 코드(webdir) 찾기

압핀 앱은 사용자가 (시/군, 학교명)을 입력하면 `getupdir.php` 로 학교 코드를 받아옵니다. `resolveSchool` 이 이 요청을 그대로 보냅니다.

```js
const r = await appin.resolveSchool('대구', '학남고등학교');
if (r.found) console.log(r.webdir); // 예: '0650'
```

실측으로 확인한 응답 형식:

```
미매칭: 1&nothing
매칭  : 1&<webdir>&<num>&<yyyymmdd>&1     예) 1&0650&75&20270220&1
```

> **중요(인코딩):** 한글은 반드시 **UTF-8**로 보내야 매칭됩니다(EUC-KR 로 보내면 매칭 실패). 이 라이브러리가 UTF-8 로 처리합니다.
>
> `getupdir` 는 **정확한 등록명에만** 매칭합니다(부분 검색 없음). "○○고" vs "○○고등학교", 띄어쓰기까지 학교가 등록한 표기와 정확히 일치해야 합니다.
>
> `<yyyymmdd>` 필드(예 `20270220`)의 의미는 **미확정**입니다(구독 만료일 또는 주차 앵커로 추정). 값이 미래라 하드 실패로 쓰기엔 위험하므로 이 라이브러리는 참고값으로만 둡니다.

## 대상별 시간표 가져오기

실측으로 확인한 규칙:

- **파일 번호 = 주차(week)** — `h20.txt` = 20주차이고, 이는 `hbtime.php wkno=20` 과 동일합니다. `h20 ≠ h53`(서로 다른 주).
- **줄 순서 = 목록 순서** — `h<주차>.txt`의 N번째 줄 = `getElements().classes`의 N번째 학급, `g<주차>.txt`의 N번째 줄 = `teacherNumbers`의 N번째 교사(= `gstime.php gsno`).
- **학급 라벨 `"<학년>-<반>"`** — `classes` 가 `['1-1',…,'3-9']` 순서로 나옵니다.

```js
const { classes, teacherNumbers } = await appin.getElements(webdir);
const week = appin.weekNoFromDate();                 // 현재 주차(= 파일 번호)

// 학급 시간표 (h)
const cIdx = appin.classIndexOf(classes, '2-3');     // 2학년 3반
const classRow = await appin.getClassTimetable(webdir, week, cIdx);

// 교사 시간표 (g) — 셀 ref 는 학급 라벨
const teacherRow = await appin.getTeacherTimetable(webdir, week, 0); // 1번 교사

// 특별실/교실 시간표 (t)
const roomRow = await appin.getRoomTimetable(webdir, week, 0);

// 교시 시작시각 (s)
const times = await appin.getPeriodTimes(webdir, week); // ['08:30','09:30', …]
// row[요일][교시] = { subject, ref } | null
```

> 셀에 붙는 `A/B/C/D` 접두나 `@B공강@K` 같은 마커는 고교학점제 선택과목 분반·공강 등을 나타내는 것으로 **추정**됩니다(서버 근거로 확정되지는 않음).

## 현재 주차 알아내기

시간표 파일 번호(`h<N>`)는 주차입니다. "지금 몇 주차인지"를 구하는 방법:

**① 날짜 계산(권장, 순수 함수)** — 학교연도 3월 1일이 속한 주의 월요일을 1주차로 삼아 계산합니다. 결정론적이라 시간대 영향을 덜 받습니다.

```js
appin.weekNoFromDate();                       // 오늘 기준 현재 주차
appin.weekNoFromDate(new Date('2026-07-06'));  // → 20 (실측: h20.txt == hbtime wkno=20)
```

**② 파일 수정일 기반(교차 확인용)** — 학교가 현재 주차 파일을 갱신하므로, 가장 최근 수정된 `h<N>.txt` 를 고릅니다.

```js
await appin.currentWeekByUpdate(webdir); // → 20
```

> ⚠️ 파일 수정일 방식은 학교가 **다음 주 파일을 현재 주보다 먼저** 갱신하면 미래 주차로 흔들릴 수 있습니다. 정확도가 중요하면 ①(날짜 계산)을 기본으로 쓰고, ②는 교차 확인용으로 두세요. `estimateCurrentWeek` 는 둘 다 반환합니다(`week` = ①, `weekByUpdate` = ②).
>
> `estimateWeekFromDate`(getupdir 날짜 앵커 방식)는 ±1주 오차가 관측되어(2026-07-07: 21 반환, 실제 20) **비권장**입니다.

## API

- `resolveSchool(city, name)` → `{ found, raw, webdir?, date? }`
- `getElements(webdir)` → `{ status, classes, teacherNumbers, rooms, version, elements(=classes 별칭), raw }`
- `classIndexOf(list, label)` → `number` (라벨 → 줄 인덱스, 없으면 -1)
- `getClassTimetable(webdir, week, classIndex, opts?)` → `rows[요일][교시]` (h 파일, 학급)
- `getTeacherTimetable(webdir, week, teacherIndex, opts?)` → `rows[요일][교시]` (g 파일, 교사)
- `getRoomTimetable(webdir, week, roomIndex?, opts?)` → `rows[요일][교시]` (t 파일, 교실)
- `getPeriodTimes(webdir, week, opts?)` → `string[]` (s 파일, 예 `['08:30', …]`)
- `getTimetable(webdir, filename, opts?)` → `{ filename, rows, text }`
- `weekNoFromDate(date?)` → `number` (권장, 순수 함수)
- `estimateCurrentWeek(city, name, opts?)` → `{ webdir, week, weekByUpdate, totalWeeks, date }`
- `currentWeekByUpdate(webdir, opts?)` → `number` (파일 수정일 기반, 교차 확인용)
- `estimateWeekFromDate(getupdirDate, totalWeeks, targetDate?)` → `number` (deprecated, ±1 오차)
- `parseGrid(text, opts?)` → `rows[대상][요일][교시]`
- `parseCell(raw)` → `{ subject, ref, raw } | null` (`ref` = `/` 뒤 값; g/t 파일에선 학급 라벨)
- `parsePeriodTimes(text)` → `string[]`
- `listFiles(webdir)` → `string[]` / `listFilesDetailed(webdir)` → `{name, modified, size}[]`
- `fetchStatic(webdir, filename)` → EUC-KR 디코딩된 원문

## 교차 검증 (2026-07-07, 대구 학남고 0650)

동료 교사의 동적 PHP 방식([apin-timetable](https://github.com/shinnanchanguk/apin-timetable))과 이 정적 파일 방식을 같은 주차로 대조했습니다.

| 항목 | 정적(이 라이브러리) | 동적(PHP) | 결과 |
|---|---|---|---|
| 학교 코드 | `0650` | `0650` | 일치 |
| 학급 시간표 | `h20.txt`[1-1] | `hbtime.php wkno=20` | 월~금 전 교시 일치 |
| 교사 시간표 | `g20.txt` | `gstime.php` | 교사 1·2·10·54번 일치 |
| 교시 시각 | `s20.txt` | 응답 시간대 필드 | 일치(`08:30`…) |

옵트인 라이브 테스트로 회귀를 확인할 수 있습니다(네트워크 필요):

```bash
APPIN_LIVE=1 node test/live.test.js
```

## 알려진 한계

- **교사 이름은 서버에 없습니다.** 교사 시간표는 `g<주차>.txt`(또는 앱의 `gstime.php`)로 접근하되 **번호**로만 식별됩니다(`teacherNumbers` = `1`..`54`). 이름↔번호 매핑은 학교 내부 관리 프로그램에만 있는 것으로 보여, "교사 이름으로 검색"은 이 서버만으로는 불가능합니다.
- **현재 주차는 `weekNoFromDate`(날짜 계산)로 자동 산출**됩니다. 다만 방학·주 번호 재조정이 있는 학교에서는 실제 발행 주와 어긋날 수 있어, `currentWeekByUpdate`(파일 수정일)로 교차 확인하는 것을 권합니다.
- **파일 종류·줄 매핑**(h=학급, g=교사, t=교실, s=교시시각)은 학남고 1곳에서 실측 확정했으나, 특별실이 여럿인 학교의 `t` 줄 수, 학년별 교시가 다른 학교의 `s` 구조 등은 표본을 더 확인해야 합니다.
- **`/tm/` 의 폴더 수 ≠ 실제 학교 수.** 폴더에는 빈/테스트/폐기 항목이 다수 섞여 있어, 표본 조사상 실제 데이터를 가진 폴더는 전체의 1/3 수준입니다.
- 규격은 유원테크가 단독으로 운영·변경합니다. 언제든 바뀔 수 있습니다.

## 기여

이슈/PR 환영합니다. 특히 학교별 파일·줄 구성 매핑, `@`/`A~D` 마커 의미, `getupdir` 날짜 필드 의미 등에 대한 관찰을 공유해 주세요.

## 라이선스

[MIT](./LICENSE)
