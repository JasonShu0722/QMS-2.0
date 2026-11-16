import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProcessTraceScanner } from './ProcessTraceScanner';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

const decodeFromStream = vi.fn();
vi.mock('@zxing/browser', () => ({ BrowserMultiFormatReader: class { decodeFromStream = decodeFromStream; } }));
const stop = vi.fn();
const controlsStop = vi.fn();
const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
const getUserMedia = vi.fn();
beforeEach(() => {
  stop.mockReset(); controlsStop.mockReset(); getUserMedia.mockReset().mockResolvedValue(stream);
  decodeFromStream.mockReset().mockResolvedValue({ stop: controlsStop });
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('BarcodeDetector', undefined);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('only fills a decoded value and releases the camera without submitting a registration', async () => {
  const onScan = vi.fn(); const onClose = vi.fn();
  render(<ProcessTraceScanner onScan={onScan} onClose={onClose} />);
  await waitFor(() => expect(decodeFromStream).toHaveBeenCalled());
  const callback = decodeFromStream.mock.calls[0][2];
  act(() => callback({ getText: () => '0000123456' }, undefined, { stop: controlsStop }));
  expect(onScan).toHaveBeenCalledWith('0000123456');
  expect(onClose).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledOnce();
  expect(controlsStop).toHaveBeenCalled();
});
it('keeps manual entry available after camera permission is denied', async () => {
  getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
  const onScan = vi.fn(); const onClose = vi.fn();
  render(<ProcessTraceScanner onScan={onScan} onClose={onClose} />);
  await screen.findByText('相机权限被拒绝，请允许相机访问或返回手动输入。');
  fireEvent.click(screen.getByRole('button', { name: '返回手动输入' }));
  expect(onClose).toHaveBeenCalledOnce(); expect(onScan).not.toHaveBeenCalled();
});
it('releases a camera returned after cancellation and never decodes it', async () => {
  let resolveCamera!: (value: MediaStream) => void;
  getUserMedia.mockReturnValue(new Promise<MediaStream>(resolve => { resolveCamera = resolve; }));
  const view = render(<ProcessTraceScanner onScan={vi.fn()} onClose={vi.fn()} />);
  view.unmount();
  await act(async () => resolveCamera(stream));
  expect(stop).toHaveBeenCalledOnce(); expect(decodeFromStream).not.toHaveBeenCalled();
});
it('stops decoding and rejects late results after the identity changes', async () => {
  const onScan = vi.fn(); const onClose = vi.fn();
  render(<ProcessTraceScanner onScan={onScan} onClose={onClose} />);
  await waitFor(() => expect(decodeFromStream).toHaveBeenCalled());
  act(() => useWorkTabsStore.getState().bindSession('scanner-next-identity'));
  expect(stop).toHaveBeenCalledOnce(); expect(onClose).toHaveBeenCalledOnce();
  act(() => decodeFromStream.mock.calls[0][2]({ getText: () => 'LATE' }, undefined, { stop: controlsStop }));
  expect(onScan).not.toHaveBeenCalled();
});
it('uses native detection when available and releases the camera on success', async () => {
  const detect = vi.fn().mockResolvedValue([{ rawValue: 'QR-LOCAL' }]);
  vi.stubGlobal('BarcodeDetector', class { detect = detect; });
  const onScan = vi.fn();
  const view = render(<ProcessTraceScanner onScan={onScan} onClose={vi.fn()} />);
  await waitFor(() => expect(onScan).toHaveBeenCalledWith('QR-LOCAL'));
  expect(decodeFromStream).not.toHaveBeenCalled();
  view.unmount(); expect(stop).toHaveBeenCalledOnce();
});
it('releases a live stream when cancelled without emitting a scan', async () => {
  const onScan = vi.fn(); const onClose = vi.fn();
  render(<ProcessTraceScanner onScan={onScan} onClose={onClose} />);
  await waitFor(() => expect(decodeFromStream).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: '返回手动输入' }));
  expect(stop).toHaveBeenCalledOnce(); expect(controlsStop).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce(); expect(onScan).not.toHaveBeenCalled();
});
it('does not request camera access on an insecure connection', async () => {
  vi.stubGlobal('isSecureContext', false);
  render(<ProcessTraceScanner onScan={vi.fn()} onClose={vi.fn()} />);
  await screen.findByText('手机扫码需要 HTTPS，请返回手动输入。');
  expect(getUserMedia).not.toHaveBeenCalled();
});
