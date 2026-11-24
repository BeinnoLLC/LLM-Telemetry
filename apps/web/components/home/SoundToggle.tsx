"use client";

// LLMTELEMET-291 (T-20 RUN F2): the real sound button. The engine owns the
// saved preference and the first-gesture unlock; this component only paints
// and flips it (live.js:999-1025).
import { useEffect, useState } from "react";

import type { SoundEngine } from "../../lib/home/sound";
import { homeSound } from "../../lib/home/sound-client";
import styles from "./SoundToggle.module.css";

export interface SoundToggleProps {
  /** Injectable for jsdom; production uses the shared browser engine. */
  engine?: SoundEngine;
}

export default function SoundToggle({ engine }: SoundToggleProps) {
  const sound = engine ?? homeSound();
  // Server render is always ON; the saved preference is applied after mount,
  // so hydration cannot disagree with the markup.
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    setEnabled(sound.isEnabled());
    return sound.armUnlock(window);
  }, [sound]);

  const label = enabled ? "Sound on — click to mute" : "Sound off — click to unmute";
  const toggle = (): void => {
    sound.setEnabled(!enabled);
    setEnabled(sound.isEnabled());
  };

  return (
    <button
      type="button"
      className={styles.toggle}
      aria-pressed={enabled}
      aria-label={label}
      title={label}
      onClick={toggle}
    >
      <span aria-hidden="true" className={styles.icon}>
        {enabled ? "♫" : "×"}
      </span>
      <span>{enabled ? "Sound on" : "Sound off"}</span>
    </button>
  );
}
