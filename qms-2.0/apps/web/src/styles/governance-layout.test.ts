import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync(`${process.cwd()}/src/styles/global.css`, 'utf8');

it('gives governance Cards and Tabs a shrinkable grid track', () => {
  expect(css).toMatch(/\.governance-panel\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

it('keeps wide governance tables locally scrollable without clipping page content', () => {
  expect(css).toMatch(/\.governance-panel \.ant-table-wrapper\s*\{[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto/);
  expect(css).not.toMatch(/\.governance-panel\s*\{[^}]*overflow(?:-x)?:\s*(?:hidden|clip)/);
});
