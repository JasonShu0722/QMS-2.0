const calendarInputTypes = new Set(['date', 'datetime-local', 'month']);

function openNativeDatePicker(event: MouseEvent | KeyboardEvent): boolean {
  const input = event.target;
  if (event.defaultPrevented || !(input instanceof HTMLInputElement) || !calendarInputTypes.has(input.type)
    || input.readOnly || input.matches(':disabled')) return false;

  if (event.type === 'click' && input.ownerDocument.activeElement !== input) input.focus();
  if (typeof input.showPicker !== 'function') return false;

  try {
    input.showPicker();
    return true;
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    return false;
  }
}

export function enableNativeDatePicker(): void {
  document.addEventListener('click', openNativeDatePicker);
  document.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
      && openNativeDatePicker(event)) event.preventDefault();
  });
}
