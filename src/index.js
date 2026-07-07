'use strict';

/**
 * appin-timetable-parser
 * 압핀(유원테크, YWTek) 시간표 시스템의 공개 인터넷 서버(sgpap.com)에서
 * 학교 시간표 데이터를 가져와 사람이 다루기 쉬운 형태로 해석하는 라이브러리.
 *
 * - 의존성 없음(Node 18+ 내장 fetch / TextDecoder 사용, EUC-KR 포함).
 * - 정적 파일은 EUC-KR(CP949), PHP 응답은 UTF-8로 인코딩이 혼재한다.
 * - 리버스 엔지니어링으로 파악한 규격이며 예고 없이 바뀔 수 있다.
 *
 * 파일 종류(2026-07-07 대구 학남고 0650 실측 + 동료 교사 apin-timetable 교차 검증):
 *   h<N>.txt = 학급 시간표      (줄 수 = 학급 수, hbtime.php 와 동일)
 *   g<N>.txt = 교사 시간표      (줄 수 = 교사 수, gstime.php 와 동일. 셀은 `과목/학급`)
 *   t<N>.txt = 특별실/교실 시간표 (줄 수 = 교실 수, 셀은 `과목/학급`)
 *   s<N>.txt = 교시 시작시각    (HHMM 반복 문자열, 예: 0830 0930 …)
 *   N = 주차(week). h20.txt == hbtime.php wkno=20 임을 실측으로 확인.
 */

const BASE = 'http://www.sgpap.com';
const DEFAULT_TIMEOUT = 15000;
const WEEK_MS = 7 * 24 * 3600 * 1000;

/** 내부: 타임아웃이 있는 fetch */
async function timedFetch(url, options = {}, timeoutMs = DEFAULT_TIMEOUT) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 학교 폴더의 정적 파일을 받아 EUC-KR로 디코딩한다. */
async function fetchStatic(webdir, filename, timeoutMs) {
  const url = `${BASE}/tm/${encodeURIComponent(webdir)}/${encodeURIComponent(filename)}`;
  const res = await timedFetch(url, { headers: { 'User-Agent': 'appin-timetable-parser' } }, timeoutMs);
  if (!res.ok) throw new Error(`fetchStatic ${filename}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return new TextDecoder('euc-kr').decode(buf);
}

/** 내부: PHP 엔드포인트에 form-urlencoded POST를 보내고 UTF-8로 받는다. */
async function postForm(path, params, timeoutMs) {
  const body = new URLSearchParams(params).toString();
  const res = await timedFetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': 'appin-timetable-parser',
    },
    body,
  }, timeoutMs);
  if (!res.ok) throw new Error(`postForm ${path}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return new TextDecoder('utf-8').decode(buf);
}

/**
 * 한 칸(cell)을 해석한다.
 *  - 빈 칸(`''`)은 null
 *  - `과목/대상` 형태면 { subject, ref }
 *  - `과목`만 있으면 { subject, ref: null }
 *  - `@B ... @K` 같은 서식 마커는 제거한 값을 subject 로, 원본을 raw 로 둔다.
 *
 * `ref` = `/` 뒤의 연결 대상. **파일 종류에 따라 의미가 다르다.**
 *   - g(교사)·t(교실) 파일: `ref` 는 **학급 라벨**(예: `1-7`). 교실 번호가 아니다.
 *   - h(학급) 파일: 대개 `/` 가 없어 `ref` 는 null.
 * (예전 `room` 필드명은 g/t 파일에서 학급을 교실로 오해하게 하여 `ref` 로 정정했다.)
 */
function parseCell(raw) {
  if (raw === '' || raw == null) return null;
  const cleaned = raw.replace(/@[A-Za-z]/g, '').trim();
  if (cleaned === '') return null;
  const slash = cleaned.indexOf('/');
  if (slash >= 0) {
    return { subject: cleaned.slice(0, slash), ref: cleaned.slice(slash + 1), raw };
  }
  return { subject: cleaned, ref: null, raw };
}

/**
 * 시간표 텍스트(h/g/t 파일 등)를 구조화한다.
 * 파일의 각 줄 = 한 주간 시간표(하나의 대상: 학급·교사·교실).
 *   줄 안: 쉼표(`,`)로 요일 구분 → 각 요일 안: 캐럿(`^`)으로 교시 구분.
 * 반환: rows[대상][요일][교시] = cell | null
 *
 * @param {string} text  EUC-KR 로 디코딩된 파일 내용
 * @param {object} [opts]
 * @param {boolean} [opts.dropTrailingEmptyDay=true] 줄 끝의 빈 요일 토큰 제거
 * @returns {(object|null)[][][]}
 */
function parseGrid(text, opts = {}) {
  const { dropTrailingEmptyDay = true } = opts;
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  return lines.map((line) => {
    let days = line.split(',');
    if (dropTrailingEmptyDay) {
      while (days.length > 1 && days[days.length - 1] === '') days.pop();
    }
    return days.map((day) => day.split('^').map(parseCell));
  });
}

/**
 * s<N>.txt(교시 시작시각) 문자열을 파싱한다.
 * 형식: `HHMM` 이 이어붙은 문자열이 요일 수만큼 공백으로 반복된다.
 *   예: `0830093010301130132014201520        0830…` → 한 요일치 = 08:30,09:30,…
 * @param {string} text
 * @returns {string[]}  예: ['08:30','09:30','10:30','11:30','13:20','14:20','15:20']
 */
function parsePeriodTimes(text) {
  const firstDay = String(text || '').trim().split(/\s+/)[0] || '';
  const chunks = firstDay.match(/\d{4}/g) || [];
  return chunks.map((c) => `${c.slice(0, 2)}:${c.slice(2)}`);
}

/**
 * 학교를 (시/군, 학교명)으로 조회하여 서버 식별자(webdir)를 얻는다.
 * getupdir.php 는 "정확한 등록명"에만 매칭한다(부분 검색 없음).
 *
 * 요청은 반드시 UTF-8 로 보내야 매칭된다(이 라이브러리는 UTF-8 로 인코딩함).
 * 응답 형식(실측 확인):
 *   - 미매칭: `1&nothing`
 *   - 매칭  : `1&<webdir>&<num>&<yyyymmdd>&1`   예) `1&0650&75&20270220&1`
 *
 * @returns {Promise<{found:boolean, raw:string, webdir?:string, date?:string}>}
 */
async function resolveSchool(city, schoolName, timeoutMs) {
  const raw = await postForm('/tm/getupdir.php', { hgsj: city, hgm: schoolName }, timeoutMs);
  if (/nothing/i.test(raw)) return { found: false, raw };
  const parts = raw.split('&');
  return {
    found: true,
    raw,
    webdir: parts[1] || undefined,
    date: parts[3] || undefined, // yyyymmdd. 의미 미확정(구독 만료일/주차 앵커로 추정) — 하드 실패 금지.
  };
}

/**
 * 학교의 기준 목록을 가져온다. dnele.php.
 * 응답(UTF-8): `2&<학급목록>&<교사번호목록>&<교실목록>&<버전>&`
 *   예) `2&1-1,1-2,…,3-9&1,2,…,54&정보실&34&`
 * 실측 확인: 2번째=학급(27), 3번째=**교사 번호(54, 이름 아님)**, 4번째=**교실**, 5번째=**버전**.
 * (예전 `indices`/`movementRooms` 명칭을 `teacherNumbers`/`rooms` 로 정정하고 `version` 을 노출한다.)
 *
 * @returns {Promise<{status:string, classes:string[], teacherNumbers:string[], rooms:string[], version:string, elements:string[], raw:string}>}
 */
async function getElements(webdir, timeoutMs) {
  const raw = await postForm('/tm/dnele.php', { webdir }, timeoutMs);
  const f = raw.split('&');
  const csv = (s) => (s ? s.split(',').filter((x) => x !== '') : []);
  const classes = csv(f[1]);
  return {
    status: f[0] || '',
    classes,
    teacherNumbers: csv(f[2]),
    rooms: csv(f[3]),
    version: f[4] || '',
    elements: classes, // 하위호환 별칭(deprecated): elements === classes
    raw,
  };
}

/**
 * 학교 폴더의 파일 목록을 수정일·크기까지 파싱한다.
 * @returns {Promise<Array<{name:string, modified:Date|null, size:string}>>}
 */
async function listFilesDetailed(webdir, timeoutMs) {
  const url = `${BASE}/tm/${encodeURIComponent(webdir)}/`;
  const res = await timedFetch(url, { headers: { 'User-Agent': 'appin-timetable-parser' } }, timeoutMs);
  if (!res.ok) throw new Error(`listFiles: HTTP ${res.status}`);
  const html = await res.text();
  const out = [];
  const re = /<a href="([^"?/][^"]*\.[a-zA-Z0-9]+)">[^<]*<\/a>\s*<\/td>\s*<td[^>]*>\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})?\s*<\/td>\s*<td[^>]*>\s*([\d.kKMGB-]+)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({
      name: m[1],
      modified: m[2] ? new Date(m[2].replace(' ', 'T') + ':00') : null,
      size: m[3],
    });
  }
  return out;
}

/**
 * 학교 폴더의 파일명 목록(디렉터리 인덱스)을 파싱한다.
 * 반환 예: ['ele.txt','h1.txt','h1.inx','g1.txt','t1.txt','s1.txt', ...]
 */
async function listFiles(webdir, timeoutMs) {
  return (await listFilesDetailed(webdir, timeoutMs)).map((e) => e.name);
}

/** 'yyyymmdd' → Date(로컬 자정) */
function parseYmd(s) {
  return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
}

/** 주어진 날짜가 속한 주의 월요일(로컬 자정)로 정규화한다. */
function mondayOf(date) {
  const out = new Date(date);
  const day = out.getDay() || 7; // 일요일(0)→7
  out.setDate(out.getDate() + 1 - day);
  out.setHours(0, 0, 0, 0);
  return out;
}

/**
 * 날짜로부터 압핀 주차 번호(= h/g/t/s 파일 번호)를 계산한다(순수 함수, 권장).
 * 학교연도(3월 시작) 3월 1일이 속한 주의 월요일을 1주차 기준으로 삼는다.
 * 실측: weekNoFromDate('2026-07-06') === 20 이고 h20.txt == hbtime wkno=20.
 * 동료 교사 apin-timetable 의 apinWeekNo 와 동일한 계산이며, 서로 값이 일치했다.
 *
 * @param {Date|string|number} [date=now]
 * @returns {number} 1 이상의 정수
 */
function weekNoFromDate(date = new Date()) {
  const monday = mondayOf(date instanceof Date ? date : new Date(date));
  const schoolYear = monday.getMonth() < 2 ? monday.getFullYear() - 1 : monday.getFullYear();
  const base = mondayOf(new Date(schoolYear, 2, 1)); // 3월 = 월 인덱스 2
  return Math.floor((monday.getTime() - base.getTime()) / WEEK_MS) + 1;
}

/**
 * getupdir 날짜 필드로 주차를 추정한다(순수 함수, 러프).
 * ⚠️ 시간대·시각 반올림에 민감해 실측에서 ±1주 오차가 관측됐다(2026-07-07: 21 반환, 실제 20).
 * 정확한 주차는 weekNoFromDate(날짜 계산) 또는 currentWeekByUpdate(파일 수정일)를 쓰라.
 *
 * @deprecated weekNoFromDate 를 권장.
 */
function estimateWeekFromDate(getupdirDate, totalWeeks, targetDate = new Date()) {
  const anchor = parseYmd(getupdirDate);
  const target = targetDate instanceof Date ? targetDate : new Date(targetDate);
  const diff = Math.round((anchor.getTime() - target.getTime()) / WEEK_MS);
  const wk = totalWeeks - diff;
  return Math.min(Math.max(wk, 1), totalWeeks);
}

/** 내부: 파일 목록에서 수정일 기준 현재 주차를 고른다. */
function pickWeekByUpdate(entries, asOf) {
  const hs = entries
    .filter((e) => /^h\d+\.txt$/.test(e.name) && e.modified && e.modified <= asOf)
    .map((e) => ({ n: Number(e.name.slice(1, e.name.indexOf('.'))), modified: e.modified }));
  if (!hs.length) return null;
  hs.sort((a, b) => b.modified - a.modified || b.n - a.n);
  return hs[0].n;
}

/**
 * 현재(활성) 주차를 계산한다. 날짜 계산이 기본값(더 안정적).
 * @returns {Promise<{webdir:string, week:number, weekByUpdate:(number|null), totalWeeks:number, date:string}|null>}
 *   week         = weekNoFromDate(날짜 계산, 권장 기본값)
 *   weekByUpdate = currentWeekByUpdate(파일 수정일, 교차 확인용)
 */
async function estimateCurrentWeek(city, schoolName, opts = {}) {
  const school = await resolveSchool(city, schoolName, opts.timeoutMs);
  if (!school.found || !school.webdir) return null;
  const files = await listFilesDetailed(school.webdir, opts.timeoutMs);
  const totalWeeks = files.filter((f) => /^h\d+\.txt$/.test(f.name)).length;
  const asOf = opts.date ? new Date(opts.date) : new Date();
  return {
    webdir: school.webdir,
    week: weekNoFromDate(asOf),
    weekByUpdate: pickWeekByUpdate(files, asOf),
    totalWeeks,
    date: school.date,
  };
}

/**
 * 현재 주차를 파일 "수정일"로 판정한다(webdir 만 필요, 교차 확인용).
 * ⚠️ 주의: 학교가 **다음 주 파일을 현재 주보다 먼저** 갱신하면 미래 주차로 흔들릴 수 있다.
 *   (실측 2026-07-07: h20=07-07, h21=07-06 로 정상 20 반환. 순서가 뒤집히면 오작동 가능.)
 *   정확도가 중요하면 weekNoFromDate(날짜 계산)를 기본으로, 이 값은 교차 확인용으로 쓰라.
 * @returns {Promise<number|null>}
 */
async function currentWeekByUpdate(webdir, opts = {}) {
  const asOf = opts.date ? new Date(opts.date) : new Date();
  const entries = await listFilesDetailed(webdir, opts.timeoutMs);
  return pickWeekByUpdate(entries, asOf);
}

/**
 * 특정 시간표 파일을 받아서 구조화까지 한 번에 수행한다.
 * @param {string} webdir 학교 코드
 * @param {string} filename 예: 'h20.txt'(학급), 'g20.txt'(교사), 't20.txt'(교실)
 */
async function getTimetable(webdir, filename, opts = {}) {
  const text = await fetchStatic(webdir, filename, opts.timeoutMs);
  return { filename, rows: parseGrid(text, opts), text };
}

/**
 * 목록에서 라벨의 줄 인덱스를 찾는다(학급·교사 공통).
 * 학급 라벨은 `"<학년>-<반>"` 형식(예 '2-3'). 교사는 번호 문자열('1'..'54').
 * @returns {number} 0-기반 인덱스, 없으면 -1
 */
function classIndexOf(elements, label) {
  return elements.indexOf(label);
}

/**
 * 특정 학급의 한 주간 시간표를 가져온다(h<week>.txt).
 * @param {string} webdir 학교 코드
 * @param {number|string} week 파일 번호(= 주차). weekNoFromDate 로 구하면 정확.
 * @param {number} classIndex getElements().classes 기준 0-기반 인덱스(classIndexOf 로 구함)
 * @returns {Promise<(object|null)[][]|null>} [요일][교시] 또는 null
 */
async function getClassTimetable(webdir, week, classIndex, opts = {}) {
  const { rows } = await getTimetable(webdir, `h${week}.txt`, opts);
  return rows[classIndex] || null;
}

/**
 * 특정 교사의 한 주간 시간표를 가져온다(g<week>.txt). 셀 `ref` 는 학급 라벨.
 * @param {number} teacherIndex getElements().teacherNumbers 기준 0-기반 인덱스.
 *   (교사 번호 '1' → 인덱스 0. gstime.php gsno 와 같은 순서임을 실측 확인.)
 */
async function getTeacherTimetable(webdir, week, teacherIndex, opts = {}) {
  const { rows } = await getTimetable(webdir, `g${week}.txt`, opts);
  return rows[teacherIndex] || null;
}

/**
 * 특정 교실(특별실)의 한 주간 시간표를 가져온다(t<week>.txt). 셀 `ref` 는 학급 라벨.
 * @param {number} [roomIndex=0] getElements().rooms 기준 0-기반 인덱스.
 */
async function getRoomTimetable(webdir, week, roomIndex = 0, opts = {}) {
  const { rows } = await getTimetable(webdir, `t${week}.txt`, opts);
  return rows[roomIndex] || null;
}

/**
 * 교시 시작시각을 가져온다(s<week>.txt).
 * @returns {Promise<string[]>} 예: ['08:30','09:30','10:30','11:30','13:20','14:20','15:20']
 */
async function getPeriodTimes(webdir, week, opts = {}) {
  const text = await fetchStatic(webdir, `s${week}.txt`, opts.timeoutMs);
  return parsePeriodTimes(text);
}

module.exports = {
  BASE,
  fetchStatic,
  parseCell,
  parseGrid,
  parsePeriodTimes,
  resolveSchool,
  getElements,
  listFiles,
  listFilesDetailed,
  getTimetable,
  classIndexOf,
  getClassTimetable,
  getTeacherTimetable,
  getRoomTimetable,
  getPeriodTimes,
  weekNoFromDate,
  estimateWeekFromDate,
  estimateCurrentWeek,
  currentWeekByUpdate,
};
