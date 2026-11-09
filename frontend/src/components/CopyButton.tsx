import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';

export const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // روی http غیرایمن clipboard API در دسترس نیست؛ راه جایگزین
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;opacity:0;inset-block-start:0';
    document.body.appendChild(area);
    area.select();
    const done = document.execCommand('copy');
    area.remove();
    return done;
  }
};

type CopyButtonProps = {
  text: string;
  label?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  iconOnly?: boolean;
};

export const CopyButton = ({ text, label = 'کپی', variant = 'secondary', size = 'sm', iconOnly }: CopyButtonProps) => {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const onClick = async () => {
    setState((await copyText(text)) ? 'done' : 'failed');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1800);
  };

  const text2 = state === 'done' ? 'کپی شد' : state === 'failed' ? 'کپی نشد' : label;
  return (
    <Button
      variant={variant}
      size={size}
      icon={state === 'done' ? 'check' : 'copy'}
      onClick={onClick}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      style={iconOnly ? { width: size === 'sm' ? 32 : 40, padding: 0 } : undefined}
    >
      {iconOnly ? <span className="sr-only" aria-live="polite">{text2}</span> : text2}
    </Button>
  );
};
