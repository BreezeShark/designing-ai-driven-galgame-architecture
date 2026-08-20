import { useEffect, useRef, useState } from "react";

export function useTypewriter(text: string, speed = 26) {
  const [progress, setProgress] = useState<{ text: string; shown: number }>({ text: "", shown: 0 });
  const shownRef = useRef(0);

  // When a new text arrives, reset during render (React's endorsed "adjust
  // state on prop change" pattern) instead of a synchronous setState in an
  // effect — avoids cascading renders and lint errors.
  if (progress.text !== text) {
    setProgress({ text, shown: 0 });
  }

  const done = !text || progress.shown >= text.length;

  useEffect(() => {
    shownRef.current = 0;
    if (!text) return;
    const timer = setInterval(() => {
      shownRef.current = Math.min(shownRef.current + 1, text.length);
      setProgress({ text, shown: shownRef.current });
      if (shownRef.current >= text.length) clearInterval(timer);
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed]);

  function skip() {
    shownRef.current = text.length;
    setProgress({ text, shown: text.length });
  }

  return { display: text.slice(0, progress.shown), done, skip };
}
