'use strict';

// 네트워크 없이 파서 로직만 검증하는 간단한 테스트.
const assert = require('node:assert');
const { parseGrid, parseCell } = require('../src');

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

console.log('all parser tests passed ✓');
