import { HttpException } from '@nestjs/common';

function invalid(): never {
  throw new HttpException({ code: 'SUPPLIER_PERFORMANCE_INPUT_INVALID', message: '绩效月份、权重或得分无效' }, 400);
}

export function monthRange(month: string): { start: Date; end: Date } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) invalid();
  const [year, monthNumber] = month.split('-').map(Number);
  if (year! < 100 || year! > 9998) invalid();
  return { start: new Date(Date.UTC(year!, monthNumber! - 1, 1)), end: new Date(Date.UTC(year!, monthNumber!, 1)) };
}

export function scoreCard(input: { inspectionCount: number; passCount: number; cooperationScore: number; incomingWeight: number; cooperationWeight: number }): { incomingScore: number; totalScore: number } {
  const { inspectionCount, passCount, cooperationScore, incomingWeight, cooperationWeight } = input;
  if (!Number.isSafeInteger(inspectionCount) || inspectionCount <= 0 || !Number.isSafeInteger(passCount) || passCount < 0 || passCount > inspectionCount ||
      ![cooperationScore, incomingWeight, cooperationWeight].every((value) => Number.isInteger(value) && value >= 0 && value <= 100) ||
      incomingWeight + cooperationWeight !== 100) invalid();
  const incomingScore = Math.round(passCount / inspectionCount * 10000) / 100;
  const totalScore = Math.round((incomingScore * incomingWeight + cooperationScore * cooperationWeight) * 100) / 10000;
  return { incomingScore, totalScore };
}
