'use strict';

// 네트워크 없이 파서 로직만 검증하는 간단한 테스트.
const assert = require('node:assert');
const {
  parseGrid,
  parseCell,
  parsePeriodTimes,
  weekNoFromDate,
  estimateWeekFromDate,
} = require('../src');

// 1) 빈 칸
assert.strictEqual(parseCell(''), null);
assert.strictEqual(parseCell('^'.replace('^', '')), null);

// 2) 과목만
assert.deepStrictEqual(parseCell('국어'), { subject: '국어', ref: null, raw: '국어' });

// 3) 과목/대상 — g·t 파일의 `/` 뒤는 학급 라벨(교실 번호가 아님)
assert.deepStrictEqual(parseCell('공통국어1/1-7'), {
  subject: '공통국어1',
  ref: '1-7',
  raw: '공통국어1/1-7',
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

// 7) 교시 시작시각(s<N>.txt) 파싱 — 실측 학남고 s20.txt 형식
assert.deepStrictEqual(
  parsePeriodTimes('0830093010301130132014201520        0830093010301130132014201520'),
  ['08:30', '09:30', '10:30', '11:30', '13:20', '14:20', '15:20'],
);
assert.deepStrictEqual(parsePeriodTimes(''), []);

// 8) 날짜 → 주차(권장). 실측: 2026-07-06(월) 주 = 20주차, h20.txt == hbtime wkno=20
assert.strictEqual(weekNoFromDate(new Date('2026-07-06')), 20);
assert.strictEqual(weekNoFromDate(new Date('2026-07-07')), 20, '같은 주 화요일도 20');
assert.strictEqual(weekNoFromDate(new Date('2026-06-29')), 19, '한 주 전은 19');

// 9) getupdir 날짜 추정(러프, deprecated) — 함수는 남아 있으나 ±1 오차 가능
assert.strictEqual(estimateWeekFromDate('20270220', 53, new Date('2026-07-07')), 20);
assert.strictEqual(estimateWeekFromDate('20270220', 53, new Date('2027-12-31')), 53);
assert.strictEqual(estimateWeekFromDate('20270220', 53, new Date('2025-01-01')), 1);

console.log('all parser tests passed ✓');
