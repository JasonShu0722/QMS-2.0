import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Spin } from 'antd';
import { useLanguage } from '../../i18n/Language';

export function AttachmentCameraDialog({ onConfirm, onClose }: { onConfirm: (file: File) => void; onClose: () => void }) {
  const { t, locale } = useLanguage();
  const english = locale === 'en-US';
  const video = useRef<HTMLVideoElement>(null);
  const alive = useRef(false);
  const [photo, setPhoto] = useState<File>();
  const [url, setUrl] = useState<string>();
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (photo) return;
    let active = true;
    let stream: MediaStream | undefined;
    const element = video.current!;
    function stop() {
      stream?.getTracks().forEach(track => track.stop());
      stream = undefined;
      element.srcObject = null;
    }
    async function connect() {
      try {
        const opened = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (!active) { opened.getTracks().forEach(track => track.stop()); return; }
        stream = opened;
        element.srcObject = stream;
        await element.play();
        if (active) setReady(true);
      } catch {
        if (active) { stop(); setFailed(true); }
      }
    }
    void connect();
    return () => { active = false; stop(); };
  }, [photo]);
  useEffect(() => {
    if (!photo) return;
    const local = URL.createObjectURL(photo);
    setUrl(local);
    return () => URL.revokeObjectURL(local);
  }, [photo]);

  function capture() {
    const element = video.current;
    if (!element?.videoWidth || !element.videoHeight) return;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1920 / Math.max(element.videoWidth, element.videoHeight));
    canvas.width = Math.max(1, Math.round(element.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(element.videoHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) { setFailed(true); return; }
    setCapturing(true);
    try {
      context.drawImage(element, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        if (!alive.current) return;
        setCapturing(false);
        if (!blob || blob.type !== 'image/jpeg') { setFailed(true); return; }
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        setPhoto(new File([blob], `photo-${stamp}.jpg`, { type: 'image/jpeg' }));
      }, 'image/jpeg', 0.9);
    } catch {
      setCapturing(false);
      setFailed(true);
    }
  }

  return <Modal open title={english ? 'Take a photo' : '拍照上传'} onCancel={onClose} footer={[
    <Button key="cancel" onClick={onClose}>{t('取消')}</Button>,
    photo && <Button key="retake" onClick={() => { setReady(false); setFailed(false); setUrl(undefined); setPhoto(undefined); }}>{english ? 'Retake' : '重拍'}</Button>,
    photo ? <Button key="upload" type="primary" onClick={() => onConfirm(photo)}>{english ? 'Confirm upload' : '确认上传'}</Button>
      : <Button key="capture" type="primary" disabled={!ready || failed} loading={capturing} onClick={capture}>{english ? 'Capture' : '拍照'}</Button>,
  ]}>
    {failed && <Alert type="warning" showIcon title={english ? 'Camera unavailable. You can choose a saved photo instead.' : '相机不可用，可选择已保存的照片上传。'} />}
    {!photo && !ready && !failed && <Spin />}
    {!photo && <video className="attachment-camera__video" ref={video} hidden={!ready || failed} muted playsInline />}
    {photo && url && <img className="attachment-preview__image" src={url} alt={english ? 'Photo to upload' : '待上传照片'} />}
  </Modal>;
}
