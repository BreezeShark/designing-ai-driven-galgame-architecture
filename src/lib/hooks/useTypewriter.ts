import { useEffect, useRef, useState } from "react";

export function useTypewriter(text: string, speed = 26) {
  const [display, setDisplay] = useState(text);
  const [done, setDone] = useState(true);
  const frame = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (frame.current) clearInterval(frame.current);
    if (!text) {
      setDisplay("");
      setDone(true);
      return;
    }
    setDisplay("");
    setDone(false);
    let i = 0;
    frame.current = setInterval(() => {
      i += 1;
      setDisplay(text.slice(0, i));
      if (i >= text.length) {
        setDone(true);
        if (frame.current) clearInterval(frame.current);
      }
    }, speed);
    return () => {
      if (frame.current) clearInterval(frame.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  function skip() {
    setDisplay(text);
    setDone(true);
    if (frame.current) clearInterval(frame.current);
  }

  return { display, done, skip };
}
