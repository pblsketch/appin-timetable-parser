'use strict';

/**
 * 옵트인 라이브 교차검증 테스트 (네트워크 필요).
 *   APPIN_LIVE=1 node test/live.test.js
 *
 * 정적 파일 방식(이 라이브러리)이 동적 PHP 방식(hbtime/gstime)과 같은 결과를 내는지
 * 실제 서버에서 확인한다. 기본 단위 테스트(parse.test.js)와 분리되어 있으며,
 * APPIN_LIVE 가 없으면 아무 요청도 보내지 않고 건너뛴다.
 *
 * 기본 대상: 대구 학남고등학교(0650). APPIN_CITY / APPIN_SCHOOL 로 바꿀 수 있다.
 */

const assert = require('node:assert');
const appin = require('../src');

if (!process.env.APPIN_LIVE) {
  console.log('live test skipped (set APPIN_LIVE=1 to run — 실제 서버로 요청을 보냅니다)');
  process.exit(0);
}

const CITY = process.env.APPIN_CITY || '대구';
const SCHOOL = process.env.APPIN_SCHOOL || '학남고등학교';
const norm = (s) => (s || '').replace(/,+$/, '');

// 동적 PHP 응답을 직접 얻는 최소 헬퍼(라이브러리 밖 대조용).
async function postPhp(path, params) {
  const res = await fetch(`http://www.sgpap.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: new URLSearchParams(params).toString(),
  });
  return new TextDecoder('utf-8').decode(Buffer.from(await res.arrayBuffer()));
}
const rowToDays = (row) =>
  row.map((day) => day.map((c) => (c ? c.raw : '')).join('^'));

(async () => {
  const school = await appin.resolveSchool(CITY, SCHOOL);
  assert.ok(school.found && school.webdir, `학교 조회 실패: ${CITY} ${SCHOOL}`);
  const webdir = school.webdir;

  const ele = await appin.getElements(webdir);
  assert.strictEqual(ele.status, '2', 'dnele status 는 2 여야 함');
  assert.ok(ele.classes.length > 0, '학급 목록이 있어야 함');
  assert.ok(ele.teacherNumbers.length > 0, '교사 번호 목록이 있어야 함');
  assert.ok(ele.version, 'version(elever) 이 있어야 함');

  const week = appin.weekNoFromDate();
  assert.ok(Number.isInteger(week) && week > 0, 'weekNoFromDate 는 양의 정수');

  // 1) 학급: 정적 h == 동적 hbtime (같은 주차, 요일별 문자열)
  const cIdx = Math.max(appin.classIndexOf(ele.classes, '1-1'), 0);
  const staticClass = await appin.getClassTimetable(webdir, week, cIdx);
  assert.ok(staticClass, 'h 파일에서 학급 시간표를 얻어야 함');
  const hb = await postPhp('/tm/hbtime.php', {
    webdir, hbno: String(cIdx), wkno: String(week), dayno: '1', elever: ele.version,
  });
  const hbDays = norm(hb.split('&')[2]).split(',');
  const staticDays = rowToDays(staticClass);
  for (let d = 0; d < Math.min(5, hbDays.length); d++) {
    assert.strictEqual(staticDays[d], hbDays[d], `학급 ${ele.classes[cIdx]} ${d + 1}요일: 정적 h == 동적 hbtime`);
  }

  // 2) 교사: 정적 g == 동적 gstime (교사 0번)
  const staticTeacher = await appin.getTeacherTimetable(webdir, week, 0);
  assert.ok(staticTeacher, 'g 파일에서 교사 시간표를 얻어야 함');
  const gs = await postPhp('/tm/gstime.php', {
    webdir, gsno: '0', wkno: String(week), dayno: '1', elever: ele.version,
  });
  const gsDays = norm(gs.split('&')[2]).split(',');
  const stDays = rowToDays(staticTeacher);
  assert.strictEqual(stDays[0], gsDays[0], '교사 1번 월요일: 정적 g == 동적 gstime');

  // 3) 교시 시각: s 파일이 HH:MM 배열로 파싱되고 동적 응답과 일치
  const times = await appin.getPeriodTimes(webdir, week);
  assert.ok(times.length > 0 && /^\d{2}:\d{2}$/.test(times[0]), '교시 시각이 HH:MM 형태여야 함');
  const hbTimesRaw = (hb.split('&')[3] || '').trim();
  const hbTimes = appin.parsePeriodTimes(hbTimesRaw);
  assert.deepStrictEqual(times.slice(0, hbTimes.length), hbTimes, 's 파일 교시시각 == hbtime 시간대 필드');

  console.log(`live cross-check passed ✓  (${CITY} ${SCHOOL} / webdir ${webdir} / week ${week})`);
  console.log(`  학급 ${ele.classes.length} · 교사 ${ele.teacherNumbers.length} · 교실 ${JSON.stringify(ele.rooms)} · 교시시각 ${JSON.stringify(times)}`);
})().catch((e) => {
  console.error('live test FAILED:', e.message);
  process.exit(1);
});
