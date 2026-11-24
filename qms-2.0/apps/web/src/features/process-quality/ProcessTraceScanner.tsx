import { Alert, Button, Modal } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

type NativeDetector = { detect: (video: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
export function ProcessTraceScanner({ purpose = 'trace', onScan, onClose }: { purpose?: 'trace' | 'material-batch'; onScan: (value: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const callbacks = useRef({ onScan, onClose }); callbacks.current = { onScan, onClose };
  const release = useRef<() => void>(() => {});
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let stream: MediaStream | undefined;
    let decoder: { stop: () => void } | undefined;
    let frame: number | undefined;
    const initialScope = useWorkTabsStore.getState().sessionScope;
    function stop() {
      active = false;
      if (frame !== undefined) cancelAnimationFrame(frame);
      decoder?.stop(); decoder = undefined;
      stream?.getTracks().forEach(track => track.stop()); stream = undefined;
      if (video.current) video.current.srcObject = null;
    }
    release.current = stop;
    function accept(value: string) {
      if (!active || !value) return;
      stop(); callbacks.current.onScan(value); callbacks.current.onClose();
    }
    const unsubscribe = useWorkTabsStore.subscribe(state => {
      if (state.sessionScope !== initialScope && active) { stop(); callbacks.current.onClose(); }
    });
    async function start() {
      if (!window.isSecureContext) { setError('手机扫码需要 HTTPS，请返回手动输入。'); return; }
      if (!navigator.mediaDevices?.getUserMedia) { setError('当前设备无法使用相机，请返回手动输入。'); return; }
      try {
        const acquired = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (!active) { acquired.getTracks().forEach(track => track.stop()); return; }
        stream = acquired;
        const preview = video.current;
        if (!preview) { stop(); return; }
        preview.srcObject = stream;
        const Detector = (window as typeof window & { BarcodeDetector?: new () => NativeDetector }).BarcodeDetector;
        if (Detector) {
          await preview.play();
          if (!active) return;
          const detector = new Detector();
          async function detect() {
            if (!active) return;
            try { const results = await detector.detect(preview!); if (active && results[0]?.rawValue) { accept(results[0].rawValue); return; } }
            catch (cause) { if (active && !(cause instanceof DOMException && cause.name === 'InvalidStateError')) { stop(); setError('识别失败，请返回手动输入后重试。'); return; } }
            if (active) frame = requestAnimationFrame(() => void detect());
          }
          frame = requestAnimationFrame(() => void detect());
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          if (!active) return;
          const reader = new BrowserMultiFormatReader();
          const controls = await reader.decodeFromStream(stream, preview, (result, _cause, controls) => {
            if (result && active) { decoder = controls; accept(result.getText()); }
          });
          if (active) decoder = controls; else controls.stop();
        }
      } catch (cause) {
        if (!active) return;
        stop();
        setError(cause instanceof DOMException && cause.name === 'NotAllowedError' ? '相机权限被拒绝，请允许相机访问或返回手动输入。' : cause instanceof DOMException && cause.name === 'NotFoundError' ? '未找到可用相机，请返回手动输入。' : '相机或识别器启动失败，请返回手动输入后重试。');
      }
    }
    void start();
    return () => { unsubscribe(); stop(); };
  }, []);
  function close() { release.current(); callbacks.current.onClose(); }
  const materialBatch = purpose === 'material-batch';
  return <Modal open title={materialBatch ? '扫描批次标签' : '扫描追溯码'} footer={<Button onClick={close}>返回手动输入</Button>} onCancel={close} destroyOnHidden>
    {error ? <Alert type="warning" showIcon title={error} /> : <Alert type="info" title={materialBatch ? '将批次标签对准相机，识别后回填此物料明细。' : '将二维码或条码对准相机，识别后回填追溯码。'} />}
    <video ref={video} aria-label="扫码相机预览" className="process-trace-video" autoPlay muted playsInline hidden={!!error} />
  </Modal>;
}
