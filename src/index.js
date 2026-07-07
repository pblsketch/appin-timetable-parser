'use strict';

/**
 * appin-timetable-parser
 * 압핀(유원테크, YWTek) 시간표 시스템의 공개 인터넷 서버(sgpap.com)에서
 * 학교 시간표 데이터를 가져와 사람이 다루기 쉬운 형태로 해석하는 라이브러리.
 *
 * - 의존성 없음(Node 18+ 내장 fetch / TextDecoder 사용, EUC-KR 포함).
 * - 정적 파일은 EUC-KR(CP949), PHP 응답은 UTF-8로 인코딩이 혼재한다.
 * - 리버스 엔지니어링으로 파악한 규격이며 예고 없이 바뀔 수 있다.
 */

const BASE = 'http://www.sgpap.com';
const DEFAULT_TIMEOUT = 15000;

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
 *  - `과목/교실` 형태면 { subject, room }
 *  - `과목`만 있으면 { subject, room: null }
 *  - `@B ... @K` 같은 서식 마커는 제거한 값을 subject 로, 원본을 raw 로 둔다.
 */
function parseCell(raw) {
  if (raw === '' || raw == null) return null;
  const cleaned = raw.replace(/@[A-Za-z]/g, '').trim();
  if (cleaned === '') return null;
  const slash = cleaned.indexOf('/');
  if (slash >= 0) {
    return { subject: cleaned.slice(0, slash), room: cleaned.slice(slash + 1), raw };
  }
  return { subject: cleaned, room: null, raw };
}

/**
 * 시간표 텍스트(g/h/t 파일 등)를 구조화한다.
 * 파일의 각 줄 = 한 주간 시간표(하나의 대상).
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
 * 학교를 (시/군, 학교명)으로 조회하여 서버 식별자(webdir)를 얻는다.
 * getupdir.php 는 "정확한 등록명"에만 매칭한다(부분 검색 없음).
 *
 * 요청은 반드시 UTF-8 로 보내야 매칭된다(이 라이브러리는 UTF-8 로 인코딩함).
 * 응답 형식(실측 확인):
 *   - 미매칭: `1&nothing`
 *   - 매칭  : `1&<webdir>&<num>&<yyyymmdd>&1`   예) `1&0000&75&20270220&1`
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
    date: parts[3] || undefined, // yyyymmdd 형태의 날짜 필드(의미는 갱신/만료로 추정)
  };
}

/**
 * 학교의 "원소표"(이동수업 교실/반 목록 등)를 가져온다. dnele.php.
 * 응답(UTF-8): `<status>&<원소목록>&<인덱스>&<이동교실>&...`
 * @returns {Promise<{status:string, elements:string[], indices:string[], movementRooms:string[], raw:string}>}
 */
async function getElements(webdir, timeoutMs) {
  const raw = await postForm('/tm/dnele.php', { webdir }, timeoutMs);
  const f = raw.split('&');
  const csv = (s) => (s ? s.split(',').filter((x) => x !== '') : []);
  return {
    status: f[0] || '',
    elements: csv(f[1]),
    indices: csv(f[2]),
    movementRooms: csv(f[3]),
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
 * 반환 예: ['ele.txt','h1.txt','h1.inx','g1.txt','t1.txt', ...]
 */
async function listFiles(webdir, timeoutMs) {
  return (await listFilesDetailed(webdir, timeoutMs)).map((e) => e.name);
}

/** 'yyyymmdd' → Date(로컬 자정) */
function parseYmd(s) {
  return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
}

const WEEK_MS = 7 * 24 * 3600 * 1000;

/**
 * getupdir 날짜 필드로 주차를 추정한다(순수 함수).
 * 실측상 getupdir 의 날짜(yyyymmdd)는 대략 "마지막 주차(= h 파일 수)"의 기준일이라,
 *   week ≈ totalWeeks - round((anchorDate - targetDate) / 7일)
 * 로 계산한다. 최근/현재 날짜에서 정확도가 높고, 일반적으로 ±1주 오차가 있을 수 있다.
 *
 * @param {string} getupdirDate resolveSchool().date (yyyymmdd)
 * @param {number} totalWeeks 학교 폴더의 h<N>.txt 개수
 * @param {Date|string|number} [targetDate=now]
 * @returns {number} 1..totalWeeks 로 clamp 된 주차
 */
function estimateWeekFromDate(getupdirDate, totalWeeks, targetDate = new Date()) {
  const anchor = parseYmd(getupdirDate);
  const target = targetDate instanceof Date ? targetDate : new Date(targetDate);
  const diff = Math.round((anchor.getTime() - target.getTime()) / WEEK_MS);
  const wk = totalWeeks - diff;
  return Math.min(Math.max(wk, 1), totalWeeks);
}

/**
 * 학교명으로 현재 주차를 추정한다(getupdir 날짜 + h 파일 수 기반).
 * @returns {Promise<{webdir:string, week:number, totalWeeks:number, date:string}|null>}
 */
async function estimateCurrentWeek(city, schoolName, opts = {}) {
  const school = await resolveSchool(city, schoolName, opts.timeoutMs);
  if (!school.found || !school.webdir) return null;
  const files = await listFiles(school.webdir, opts.timeoutMs);
  const totalWeeks = files.filter((f) => /^h\d+\.txt$/.test(f)).length;
  return {
    webdir: school.webdir,
    totalWeeks,
    date: school.date,
    week: estimateWeekFromDate(school.date, totalWeeks, opts.date || new Date()),
  };
}

/**
 * 현재 주차를 파일 "수정일"로 정밀 판정한다(webdir 만 필요, 더 정확).
 * 학교가 매주 현재 주차 파일을 갱신하므로, 기준일 이하에서 가장 최근에 수정된
 * h<N>.txt 의 N 이 현재(활성) 주차다.
 * @returns {Promise<number|null>}
 */
async function currentWeekByUpdate(webdir, opts = {}) {
  const asOf = opts.date ? new Date(opts.date) : new Date();
  const entries = await listFilesDetailed(webdir, opts.timeoutMs);
  const hs = entries
    .filter((e) => /^h\d+\.txt$/.test(e.name) && e.modified && e.modified <= asOf)
    .map((e) => ({ n: Number(e.name.slice(1, e.name.indexOf('.'))), modified: e.modified }));
  if (!hs.length) return null;
  hs.sort((a, b) => b.modified - a.modified || b.n - a.n);
  return hs[0].n;
}

/**
 * 특정 시간표 파일을 받아서 구조화까지 한 번에 수행한다.
 * @param {string} webdir 학교 코드
 * @param {string} filename 예: 'h2.txt', 'g2.txt', 't5.txt'
 */
async function getTimetable(webdir, filename, opts = {}) {
  const text = await fetchStatic(webdir, filename, opts.timeoutMs);
  return { filename, rows: parseGrid(text, opts), text };
}

/**
 * dnele 원소(학급) 목록에서 라벨의 줄 인덱스를 찾는다.
 * 시간표 파일의 "N번째 줄" 이 "getElements().elements 의 N번째 학급" 에 대응한다(실측 확인).
 * 학급 라벨은 `"<학년>-<반>"` 형식이다. 예: '2-3' → 2학년 3반.
 * @returns {number} 0-기반 인덱스, 없으면 -1
 */
function classIndexOf(elements, label) {
  return elements.indexOf(label);
}

/**
 * 특정 학급의 한 주간 시간표를 가져온다.
 * @param {string} webdir 학교 코드
 * @param {number|string} week h/g 파일 번호(= 주차). 예: 2 → 'h2.txt'
 * @param {number} classIndex getElements().elements 기준 0-기반 인덱스(classIndexOf 로 구함)
 * @param {object} [opts] { withRooms?: boolean } withRooms 면 g 파일(과목/교실) 사용
 * @returns {Promise<(object|null)[][]|null>} [요일][교시] 또는 null
 */
async function getClassTimetable(webdir, week, classIndex, opts = {}) {
  const prefix = opts.withRooms ? 'g' : 'h';
  const { rows } = await getTimetable(webdir, `${prefix}${week}.txt`, opts);
  return rows[classIndex] || null;
}

module.exports = {
  BASE,
  fetchStatic,
  parseCell,
  parseGrid,
  resolveSchool,
  getElements,
  listFiles,
  listFilesDetailed,
  getTimetable,
  classIndexOf,
  getClassTimetable,
  estimateWeekFromDate,
  estimateCurrentWeek,
  currentWeekByUpdate,
};
