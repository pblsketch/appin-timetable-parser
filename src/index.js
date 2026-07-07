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
 * 학교 폴더의 파일 목록(디렉터리 인덱스)을 파싱한다.
 * 반환 예: ['ele.txt','h1.txt','h1.inx','g1.txt','t1.txt', ...]
 */
async function listFiles(webdir, timeoutMs) {
  const url = `${BASE}/tm/${encodeURIComponent(webdir)}/`;
  const res = await timedFetch(url, { headers: { 'User-Agent': 'appin-timetable-parser' } }, timeoutMs);
  if (!res.ok) throw new Error(`listFiles: HTTP ${res.status}`);
  const html = await res.text();
  const out = [];
  const re = /href="([^"?/][^"]*\.[a-zA-Z0-9]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
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

module.exports = {
  BASE,
  fetchStatic,
  parseCell,
  parseGrid,
  resolveSchool,
  getElements,
  listFiles,
  getTimetable,
};
