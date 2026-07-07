'use strict';

// 네트워크 없이 파서 로직만 검증하는 간단한 테스트.
const assert = require('node:assert');
const { parseGrid, parseCell, estimateWeekFromDate } = require('../src');

// 1) 빈 칸
assert.strictEqual(parseCell(''), null);
assert.strictEqual(parseCell('^'.replace('^', '')), null);

// 2) 과목만
assert.deepStrictEqual(parseCell('국어'), { subject: '국어', room: null, raw: '국어' });

// 3) 과목/교실
assert.deepStrictEqual(parseCell('공통수학1/101'), {
  subject: '공통수학1',
  room: '101',
  raw: '공통수학1/101',
});

// 4) 서식 마커 제거
assert.strictEqual(parseCell('@B동아@K').subject, '동아');

// 5) 한 줄 = 한 주. 요일(,) × 교시(^)
const line = '국어^^수학,^체육^^,';
const rows = parseGrid(line);
assert.strictEqual(rows.length, 1);
const [week] = rows;
assert.strictEqual(week.length, 2, '끝의 빈 요일은 제거');
assert.strictEqual(week[0][0].subject, '국어');
assert.strictEqual(week[0][1], null);
assert.strictEqual(week[0][2].subject, '수학');
assert.strictEqual(week[1][1].subject, '체육');

// 6) 여러 줄
const multi = parseGrid('국어,수학\n영어,과학');
assert.strictEqual(multi.length, 2);
assert.strictEqual(multi[1][0][0].subject, '영어');

// 7) 주차 추정: getupdir 날짜(마지막 주차 앵커) 기반
//    anchor 20270220 = 53주차 기준 → 2026-07-07 은 20주차(실측 확인값)
assert.strictEqual(estimateWeekFromDate('20270220', 53, new Date('2026-07-07')), 20);
assert.strictEqual(estimateWeekFromDate('20270220', 53, new Date('2026-06-15')), 17);
// clamp: 앵커보다 훨씬 이후면 마지막 주차로
assert.strictEqual(estimateWeekFromDate('20270220', 53, new Date('2027-12-31')), 53);
assert.strictEqual(estimateWeekFromDate('20270220', 53, new Date('2025-01-01')), 1);

console.log('all parser tests passed ✓');
