import { CopyButton } from './CopyButton';
import styles from './CodeBlock.module.css';

type CodeBlockProps = { code: string; language: string; copyLabel?: string };

export const CodeBlock = ({ code, language, copyLabel = 'کپی کد' }: CodeBlockProps) => (
  <div className={styles.block}>
    <div className={styles.bar}>
      <span className={styles.language}>{language}</span>
      <CopyButton text={code} label={copyLabel} variant="ghost" />
    </div>
    <pre className={styles.pre} tabIndex={0}><code>{code}</code></pre>
  </div>
);
