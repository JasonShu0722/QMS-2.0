import type { CSSProperties } from 'react';
import { useLanguage } from '../i18n/Language';
import styles from './qms-loading.module.css';

const glyphs = [
  ['01110', '10001', '10001', '10001', '10101', '10011', '01111'],
  ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
];

export function QmsLoadingMark({ className, style, announce = false }: { className?: string; style?: CSSProperties; announce?: boolean } = {}) {
  const { locale } = useLanguage();
  return <span className={[styles.matrix, className].filter(Boolean).join(' ')} style={style} aria-hidden={announce ? undefined : true} data-qms-loading-mark>
    {announce && <span className={styles.screenReaderText}>{locale === 'en-US' ? 'Loading' : '正在加载'}</span>}
    {glyphs.map((glyph, letter) => <span className={styles.glyph} key={letter}>
      {glyph.join('').split('').map((dot, index) => <span
        key={index}
        className={dot === '1' ? styles.lit : styles.dim}
        style={dot === '1' ? { animationDelay: `${(letter * 7 + index % 5) * 55 - 2000}ms` } : undefined}
      />)}
    </span>)}
  </span>;
}

export function QmsLoading({ label = '正在加载', size = 'region' }: { label?: string; size?: 'page' | 'region' | 'inline' }) {
  return <span className={styles[size]} role="status" aria-label={label}>
    <QmsLoadingMark />
    <span>{label}</span>
  </span>;
}
