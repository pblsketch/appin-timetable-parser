'use strict';

/**
 * 사용 예시.
 *   node example.js <webdir> [파일명]
 *
 * webdir(학교 코드)는 압핀 시간표 서버의 학교 식별자입니다.
 * resolveSchool(시/군, 학교명)으로 찾거나, 이미 아는 코드를 직접 넣으세요.
 */

const appin = require('./src');

async function main() {
  const webdir = process.argv[2] || process.env.APPIN_WEBDIR;
  const filename = process.argv[3] || 'h2.txt';

  if (!webdir) {
    console.error('사용법: node example.js <webdir> [파일명]');
    console.error('예:    node example.js 0000 h2.txt');
    process.exit(1);
  }

  // 1) 원소표(이동수업 교실/반 목록)
  const ele = await appin.getElements(webdir);
  console.log('원소(elements):', ele.elements.slice(0, 20), ele.elements.length > 20 ? '…' : '');
  console.log('이동교실(movementRooms):', ele.movementRooms);

  // 2) 학교 폴더의 파일 목록
  const files = await appin.listFiles(webdir);
  console.log(`파일 ${files.length}개. 예:`, files.filter((f) => f.endsWith('.txt')).slice(0, 8));

  // 3) 특정 시간표 파일 파싱
  const { rows } = await appin.getTimetable(webdir, filename);
  console.log(`\n${filename} — 대상 ${rows.length}개(줄)`);
  const first = rows.find((r) => r.some((day) => day.some(Boolean)));
  if (first) {
    console.log('첫 번째 내용 있는 대상의 요일별 교시:');
    first.forEach((day, d) => {
      const cells = day.map((c) => (c ? c.subject + (c.room ? `/${c.room}` : '') : '·'));
      console.log(`  요일${d + 1}: ${cells.join(' | ')}`);
    });
  }
}

main().catch((e) => {
  console.error('오류:', e.message);
  process.exit(1);
});
