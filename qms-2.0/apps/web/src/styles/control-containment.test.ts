import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it } from 'vitest';

const css = readFileSync(`${process.cwd()}/src/styles/global.css`, 'utf8');
const hosts = ['qms-content', 'qms-console-theme', 'ant-modal', 'ant-drawer'];
let stylesheet: HTMLStyleElement;

beforeEach(() => {
  stylesheet = document.createElement('style');
  stylesheet.textContent = css;
  document.head.append(stylesheet);
});

afterEach(() => {
  stylesheet.remove();
  document.body.replaceChildren();
});

it.each(hosts)('allows a Select shell to shrink within %s without clipping its children', (hostClass) => {
  const host = document.createElement('div');
  host.className = hostClass;
  const select = document.createElement('div');
  select.className = 'ant-select ant-select-multiple';
  const input = document.createElement('input');
  input.className = 'ant-select-input';
  input.style.minWidth = '4px';
  select.append(input);
  host.append(select);
  document.body.append(host);

  const style = getComputedStyle(select);
  expect(style.minWidth).toBe('0');
  expect(style.maxWidth).toBe('100%');
  expect(style.boxSizing).toBe('border-box');
  expect(style.overflow).not.toMatch(/hidden|clip/);
  expect(getComputedStyle(input).minWidth).toBe('4px');
});

it.each(hosts)('limits an InputNumber shell in %s without making it fill the row', (hostClass) => {
  const host = document.createElement('div');
  host.className = hostClass;
  const number = document.createElement('div');
  number.className = 'ant-input-number';
  number.style.width = '90px';
  host.append(number);
  document.body.append(host);

  expect(getComputedStyle(number).maxWidth).toBe('100%');
  expect(getComputedStyle(number).width).toBe('90px');
});

it.each(hosts)('limits native textarea width in %s while retaining manual resize directions', (hostClass) => {
  const host = document.createElement('div');
  host.className = hostClass;
  document.body.append(host);
  for (const resize of ['both', 'vertical']) {
    const textarea = document.createElement('textarea');
    textarea.style.resize = resize;
    host.append(textarea);
    const style = getComputedStyle(textarea);
    expect(style.maxWidth).toBe('100%');
    expect(style.boxSizing).toBe('border-box');
    expect(style.resize).toBe(resize);
  }
});
