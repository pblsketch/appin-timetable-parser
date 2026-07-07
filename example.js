'use strict';

/**
 * 사용 예시.
 *   node example.js <시/군> <학교명>
 *   node example.js 0650                 # webdir 를 직접 아는 경우
 *
 * webdir(학교 코드)는 압핀 시간표 서버의 학교 식별자입니다.
 * resolveSchool(시/군, 학교명)으로 찾거나, 이미 아는 코드를 직접 넣으세요.
 */

const appin = require('./src');

async function main() {
  const a = process.argv.slice(2);
  let webdir;

  if (a.length >= 2) {
    const school = await appin.resolveSchool(a[0], a[1]);
    if (!school.found) {
      console.error(`학교를 찾지 못했습니다: ${a[0]} ${a[1]} (정확한 등록명이어야 합니다)`);
      process.exit(1);
    }
    webdir = school.webdir;
    console.log(`학교 코드(webdir): ${webdir}`);
  } else {
    webdir = a[0] || process.env.APPIN_WEBDIR;
  }

  if (!webdir) {
    console.error('사용법: node example.js <시/군> <학교명>   또는   node example.js <webdir>');
    console.error('예:    node example.js 대구 학남고등학교   |   node example.js 0650');
    process.exit(1);
  }

  // 1) 기준 목록(학급 / 교사 번호 / 교실 / 버전)
  const ele = await appin.getElements(webdir);
  console.log('학급(classes):', ele.classes.slice(0, 10), ele.classes.length > 10 ? `… (총 ${ele.classes.length})` : '');
  console.log('교사 번호(teacherNumbers):', `${ele.teacherNumbers.length}명`);
  console.log('교실(rooms):', ele.rooms, '/ 버전:', ele.version);

  // 2) 현재 주차(날짜 계산이 기본, 파일 수정일은 교차 확인용)
  const week = appin.weekNoFromDate();
  console.log(`\n현재 주차(weekNoFromDate): ${week}`);

  // 3) 학급 시간표 — 1학년 1반 (없으면 첫 학급)
  const classIdx = Math.max(appin.classIndexOf(ele.classes, '1-1'), 0);
  const classRow = await appin.getClassTimetable(webdir, week, classIdx);
  if (classRow) {
    console.log(`\n[학급] ${ele.classes[classIdx]} — ${week}주차`);
    classRow.forEach((day, d) => {
      console.log(`  요일${d + 1}: ${day.map((c) => (c ? c.subject : '·')).join(' | ')}`);
    });
  }

  // 4) 교사 시간표(g 파일) — 1번 교사. 셀 ref 는 학급 라벨.
  const teacherRow = await appin.getTeacherTimetable(webdir, week, 0);
  if (teacherRow) {
    const mon = teacherRow[0].map((c) => (c ? `${c.subject}${c.ref ? `(${c.ref})` : ''}` : '·')).join(' | ');
    console.log(`\n[교사] ${ele.teacherNumbers[0]}번 — 월요일: ${mon}`);
  }

  // 5) 교시 시작시각(s 파일)
  const times = await appin.getPeriodTimes(webdir, week);
  console.log(`\n[교시 시작시각] ${times.join(', ')}`);
}

main().catch((e) => {
  console.error('오류:', e.message);
  process.exit(1);
});
