import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

it('constrains the grid and wide table locally without hiding page overflow or changing permissions', () => {
  const css = readFileSync(`${process.cwd()}/src/features/process-quality/process-quality.css`, 'utf8');
  expect(css).toMatch(/\.process-quality-page\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  expect(css).toMatch(/\.process-quality-card\s*\{[^}]*min-width:\s*0/);
  expect(css).toMatch(/\.process-quality-page \.ant-table-wrapper\s*\{[^}]*max-width:\s*100%/);
  expect(css).not.toMatch(/\.process-quality-page \.ant-table-wrapper\s*\{[^}]*overflow/);
  expect(css).toMatch(/\.process-quality-heading\s*\{[^}]*flex-wrap:\s*wrap/);
  expect(css).not.toMatch(/body\s*\{[^}]*overflow/);
});

it('uses only the quantity label and its full-size filter target for the compact title measurement', () => {
  const css = readFileSync(`${process.cwd()}/src/features/process-quality/process-quality.css`, 'utf8');
  expect(css).toMatch(/\.process-quality-filter-title--compact\s*\{\s*display:\s*inline-flex;\s*\}/);
  expect(css).toMatch(/\.process-quality-filter-title > button\s*\{[^}]*width:\s*var\(--filter-size\);[^}]*height:\s*var\(--filter-size\)/);
});
