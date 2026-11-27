import { act, fireEvent, render, screen } from '@testing-library/react';
import { Input } from 'antd';
import { createPortal } from 'react-dom';
import { beforeAll, expect, test, vi } from 'vitest';

vi.mock('./App', () => ({ App: () => null }));

beforeAll(async () => {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  await act(async () => { await import('./main'); });
});

function observePicker(label: string) {
  const input = screen.getByLabelText<HTMLInputElement>(label);
  const showPicker = vi.fn();
  input.showPicker = showPicker;
  return { input, showPicker };
}

test('opens the native picker from inputs mounted after bootstrap, including a portal range', () => {
  render(<>
    <label>Introduced on<input type="date" defaultValue="2026-11-27" /></label>
    <Input aria-label="Scoring month" type="month" />
    {createPortal(<>
      <Input aria-label="From" type="datetime-local" />
      <Input aria-label="To" type="datetime-local" />
    </>, document.body)}
  </>);

  for (const label of ['Introduced on', 'Scoring month', 'From', 'To']) {
    const { input, showPicker } = observePicker(label);
    fireEvent.click(input);
    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(showPicker.mock.contexts[0]).toBe(input);
  }
});

test('opens with Alt+ArrowDown and leaves regular editing and Escape to the browser', () => {
  render(<label>Planned date<input type="date" /></label>);
  const { input, showPicker } = observePicker('Planned date');

  for (const key of ['ArrowDown', 'ArrowLeft', 'Backspace', 'Delete', 'Escape', 'Tab', '1']) {
    expect(fireEvent.keyDown(input, { key })).toBe(true);
  }
  expect(showPicker).not.toHaveBeenCalled();
  expect(fireEvent.keyDown(input, { key: 'ArrowDown', altKey: true })).toBe(false);
  expect(showPicker).toHaveBeenCalledOnce();
});

test('ignores read-only inputs, disabled inputs and fieldsets, other types, and canceled actions', () => {
  render(<>
    <Input type="date" aria-label="Read only" readOnly />
    <Input type="datetime-local" aria-label="Disabled" disabled />
    <fieldset disabled><input type="date" aria-label="Disabled by fieldset" /></fieldset>
    <input type="text" aria-label="Text" />
    <input type="date" aria-label="Canceled" onClick={event => event.preventDefault()} onKeyDown={event => event.preventDefault()} />
  </>);

  for (const label of ['Read only', 'Disabled', 'Disabled by fieldset', 'Text', 'Canceled']) {
    const { input, showPicker } = observePicker(label);
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'ArrowDown', altKey: true });
    expect(showPicker).not.toHaveBeenCalled();
  }
});

test('preserves default events when the picker API is unavailable or the browser denies opening it', () => {
  render(<input type="date" aria-label="Date" />);
  const { input, showPicker } = observePicker('Date');
  showPicker.mockImplementation(() => { throw new DOMException('No active gesture', 'NotAllowedError'); });

  expect(fireEvent.click(input)).toBe(true);
  expect(fireEvent.keyDown(input, { key: 'ArrowDown', altKey: true })).toBe(true);
  expect(showPicker).toHaveBeenCalledTimes(2);

  Object.defineProperty(input, 'showPicker', { value: undefined });
  expect(fireEvent.click(input)).toBe(true);
  expect(fireEvent.keyDown(input, { key: 'ArrowDown', altKey: true })).toBe(true);
});

test.each(['date', 'datetime-local', 'month'])('focuses editable %s before calling an optional picker API', type => {
  render(<>
    <button type="button">Other control</button>
    <input type={type} aria-label="Editable" />
    <input type={type} aria-label="Read only" readOnly />
  </>);
  const editable = observePicker('Editable');
  const readOnly = observePicker('Read only');
  const other = screen.getByRole('button', { name: 'Other control' });
  other.focus();
  editable.showPicker.mockImplementation(() => document.activeElement);
  expect(fireEvent.click(editable.input)).toBe(true);
  expect(editable.showPicker.mock.results).toEqual([{ type: 'return', value: editable.input }]);

  other.focus();
  Object.defineProperty(editable.input, 'showPicker', { value: undefined });
  expect(fireEvent.click(editable.input)).toBe(true);
  expect(editable.input).toHaveFocus();

  other.focus();
  expect(fireEvent.click(readOnly.input)).toBe(true);
  expect(other).toHaveFocus();
  expect(readOnly.showPicker).not.toHaveBeenCalled();
});

test('preserves native required, range, local date-time values, and clearing', () => {
  const onChange = vi.fn();
  render(<form aria-label="Schedule">
    <input aria-label="Start" name="start" type="datetime-local" required min="2026-11-27T08:00" max="2026-11-27T18:00" step={1} onChange={onChange} />
  </form>);
  const { input, showPicker } = observePicker('Start');
  const form = screen.getByRole<HTMLFormElement>('form', { name: 'Schedule' });

  fireEvent.click(input);
  expect(showPicker).toHaveBeenCalledOnce();
  expect(onChange).not.toHaveBeenCalled();
  expect(input.validity.valueMissing).toBe(true);

  fireEvent.change(input, { target: { value: '2026-11-27T07:30:42' } });
  expect(input.validity.rangeUnderflow).toBe(true);
  fireEvent.change(input, { target: { value: '2026-11-27T18:30:42' } });
  expect(input.validity.rangeOverflow).toBe(true);
  fireEvent.change(input, { target: { value: '2026-11-27T10:30:42' } });
  expect(input.validity.valid).toBe(true);
  expect(input.value).toMatch(/^2026-11-27T10:30:42(?:\.000)?$/);
  const localValue = input.value;
  fireEvent.click(input);
  expect(new FormData(form).get('start')).toBe(localValue);
  fireEvent.change(input, { target: { value: '' } });
  expect(input.validity.valueMissing).toBe(true);
  expect(onChange).toHaveBeenCalledTimes(4);
});
