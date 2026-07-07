# appin-timetable-parser

압핀(유원테크, YWTek) 시간표 시스템의 공개 인터넷 서버(`sgpap.com`)에서 학교 시간표를 가져와, 다루기 쉬운 구조로 해석하는 **의존성 없는** Node.js 라이브러리입니다.

압핀은 국내 일부 중·고등학교가 쓰는 시간표 작성·안내 프로그램으로, 학교가 만든 시간표를 유원테크의 인터넷 서버로 올려 앱(iOS/Android/PC)이 받아 보여줍니다. 이 라이브러리는 그 공개 서버가 실제로 주고받는 형식을 분석해, 앱 없이도 시간표를 프로그램으로 읽을 수 있게 합니다. (컴시간 알리미용 파서가 여럿 공개돼 있는 것과 같은 맥락의, 압핀용 상호운용 파서입니다.)

> **비공식 프로젝트입니다.** 유원테크와 아무런 관련이 없으며, 리버스 엔지니어링으로 파악한 규격이라 예고 없이 바뀌면 동작하지 않을 수 있습니다.

## 특징

- 의존성 0개 — Node 18+의 내장 `fetch` / `TextDecoder`만 사용(EUC-KR 디코딩 포함)
- 정적 파일(EUC-KR)과 PHP 응답(UTF-8)의 인코딩 혼재를 자동 처리
- 시간표 격자(요일 × 교시 × 과목/교실)를 구조화된 JSON으로 반환

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
  const school = await appin.resolveSchool('OO시', 'OO고등학교');
  const webdir = school.webdir; // 예: '0000'

  // 2) 학급/원소 목록
  const ele = await appin.getElements(webdir);
  console.log(ele.elements); // ['1-1','1-2', …]

  // 3) 시간표 파일을 받아 구조화
  const { rows } = await appin.getTimetable(webdir, 'h2.txt');
  // rows[대상][요일][교시] = { subject, room } | null
  console.log(rows[0]);
})();
```

명령줄 예제:

```bash
node example.js <webdir> h2.txt
```

## 서버·데이터 구조

리버스 엔지니어링으로 확인한 내용입니다.

### 서버

- 베이스: `http://www.sgpap.com` (평문 HTTP)
- PHP 엔드포인트: `POST`, `application/x-www-form-urlencoded`, **UTF-8**
- 시간표 원본: `http://www.sgpap.com/tm/<webdir>/` 폴더의 **정적 텍스트 파일**(로그인 불필요), **EUC-KR(CP949)**

### 주요 엔드포인트

| 경로 | 용도 | 파라미터 |
|---|---|---|
| `/tm/getupdir.php` | (시/군, 학교명) → 학교 코드 | `hgsj`, `hgm` |
| `/tm/dnele.php` | 원소표(이동수업 교실/반 목록) | `webdir` |
| `/tm/checkapvpcver.php` | 서버/버전 확인 | — |

`getupdir` 는 **정확한 등록명에만** 매칭하며, 없으면 `1&nothing` 을 반환합니다.

### 학교 폴더 파일 구조 (`/tm/<webdir>/`)

| 파일 | 내용 |
|---|---|
| `ele.txt` | 이동수업 교실/반 목록(이름 CSV + 인덱스) |
| `h<N>.txt` | 학급 계열 시간표(과목 위주) |
| `g<N>.txt` | 학급 계열 시간표 + 이동교실(`과목/교실`) |
| `t<N>.txt` | 교사 시간표(학교가 게시한 경우에만 채워짐) |
| `s<N>.txt` | 학생 개인시간표(대개 비어 있음) |
| `<name>.inx` | 각 `.txt`의 줄별 바이트 오프셋 색인(4바이트 정수, 무시 가능) |
| `hsidb.txt`, `*.cnt` | 학교 코드·버전 등 메타데이터 |

### 시간표 셀 문법

각 `.txt`의 **한 줄 = 한 주(한 대상의 주간 시간표)** 입니다.

```
줄 = 요일1 , 요일2 , 요일3 , 요일4 , 요일5 ,
요일 = 교시1 ^ 교시2 ^ … ^ 교시N
교시 = "" (빈 시간) | "과목" | "과목/교실"
```

예: `공통수학1^^^통합사회1^공통국어1^공통영어1^한국사1,^공통영어1^…`

`@B…@K` 같은 `@` + 영문자 마커가 붙는 경우가 있는데(서식/구분 표시로 추정), `parseCell` 은 이를 제거한 값을 `subject` 로, 원본을 `raw` 로 보존합니다.

### 인코딩

- 정적 파일(`ele/h/g/t/s.txt`): **EUC-KR(CP949)**
- PHP 응답(`dnele` 등): **UTF-8**

라이브러리가 알아서 구분해 디코딩합니다.

## 학교 코드(webdir) 찾기

압핀 앱은 사용자가 (시/군, 학교명)을 입력하면 `getupdir.php` 로 학교 코드를 받아옵니다. `resolveSchool` 이 이 요청을 그대로 보냅니다.

```js
const r = await appin.resolveSchool('OO시', 'OO고등학교');
if (r.found) console.log(r.webdir); // 예: '0000'
```

실측으로 확인한 응답 형식:

```
미매칭: 1&nothing
매칭  : 1&<webdir>&<num>&<yyyymmdd>&1     예) 1&0000&75&20270220&1
```

> **중요(인코딩):** 한글은 반드시 **UTF-8**로 보내야 매칭됩니다(EUC-KR 로 보내면 매칭 실패). 이 라이브러리가 UTF-8 로 처리합니다.
>
> `getupdir` 는 **정확한 등록명에만** 매칭합니다(부분 검색 없음). "○○고" vs "○○고등학교", 띄어쓰기까지 학교가 등록한 표기와 정확히 일치해야 합니다.

## 학급 시간표 가져오기 (대상↔학급 매핑)

실측으로 확인한 규칙:

- **학급 라벨 `"<학년>-<반>"`** — `getElements().elements` 가 `['1-1','1-2',…,'3-9']` 처럼 학년-반 순서로 나옵니다. 예: `'2-3'` = 2학년 3반.
- **파일의 N번째 줄 = 원소 목록의 N번째 학급** — `h<주차>.txt` / `g<주차>.txt` 의 각 줄이 `elements` 와 같은 순서로 대응합니다.
- **파일 번호 = 주차(week)** — `h2.txt`, `h3.txt` … 는 서로 다른 주의 시간표입니다.

```js
const { elements } = await appin.getElements(webdir);
const idx = appin.classIndexOf(elements, '2-3'); // 2학년 3반의 줄 인덱스
const week = 2;                                   // 원하는 주차
const row = await appin.getClassTimetable(webdir, week, idx);          // 과목만
const roomRow = await appin.getClassTimetable(webdir, week, idx, { withRooms: true }); // 과목/교실
// row[요일][교시] = { subject, room } | null
```

> 셀에 붙는 `A/B/C/D` 접두나 `@B공강@K` 같은 마커는 고교학점제 선택과목 분반·공강 등을 나타냅니다.

## API

- `resolveSchool(city, name)` → `{ found, raw, webdir?, date? }`
- `getElements(webdir)` → `{ status, elements, indices, movementRooms, raw }`
- `classIndexOf(elements, label)` → `number` (학급 라벨 → 줄 인덱스, 없으면 -1)
- `getClassTimetable(webdir, week, classIndex, opts?)` → `rows[요일][교시]` (opts.withRooms 로 교실 포함)
- `getTimetable(webdir, filename, opts?)` → `{ filename, rows, text }`
- `parseGrid(text, opts?)` → `rows[대상][요일][교시]`
- `parseCell(raw)` → `{ subject, room, raw } | null`
- `listFiles(webdir)` → `string[]` (해당 학교 폴더의 파일명)
- `fetchStatic(webdir, filename)` → EUC-KR 디코딩된 원문

## 알려진 한계

- **교사 이름은 서버에 없습니다.** 교사 시간표는 `t<번호>.txt`처럼 **번호**로만 접근되고, 이름↔번호 매핑은 학교 내부 관리 프로그램에만 있는 것으로 보입니다. 즉 "교사 이름으로 검색"은 이 서버만으로는 불가능합니다.
- **대상↔학급 매핑**(줄 순서 = `elements` 순서, 라벨 = 학년-반)은 실측 학교들에서 확인했으나, 학교 설정에 따라 편차가 있을 수 있습니다. **"현재 주차"를 자동으로 고르는 기능은 없습니다**(원하는 `week` 파일 번호를 지정해야 함).
- **`/tm/` 의 폴더 수 ≠ 실제 학교 수.** 폴더에는 빈/테스트/폐기 항목이 다수 섞여 있어, 표본 조사상 실제 데이터를 가진 폴더는 전체의 1/3 수준입니다.
- 규격은 유원테크가 단독으로 운영·변경합니다. 언제든 바뀔 수 있습니다.

## 기여

이슈/PR 환영합니다. 특히 학교별 파일·줄 구성 매핑, `@` 마커 의미, `getupdir` 성공 응답 형식 등에 대한 관찰을 공유해 주세요.

## 라이선스

[MIT](./LICENSE)
