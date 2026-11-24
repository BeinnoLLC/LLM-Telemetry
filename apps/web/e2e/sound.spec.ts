import { expect, test } from "@playwright/test";

interface AudioLog {
  state: string | null;
  starts: number[];
}

test("sound toggle unlocks Web Audio after a real gesture", async ({ page }) => {
  await page.addInitScript(() => {
    const Real = window.AudioContext;
    const log = { state: null as string | null, starts: [] as number[] };
    (window as unknown as { __ltAudio: typeof log }).__ltAudio = log;

    class RecordingAudioContext extends Real {
      constructor(...args: ConstructorParameters<typeof Real>) {
        super(...args);
        log.state = this.state;
        const resume = this.resume.bind(this);
        this.resume = () => resume().then(() => { log.state = this.state; });
      }
      createOscillator(): OscillatorNode {
        const osc = super.createOscillator();
        const start = osc.start.bind(osc);
        osc.start = (when?: number) => {
          log.starts.push(when ?? 0);
          start(when);
        };
        return osc;
      }
    }
    window.AudioContext = RecordingAudioContext;
    // A probe context records the pre-gesture state; the toggle creates its
    // own context on the first pointerdown and updates the same log on resume.
    void new RecordingAudioContext();
  });

  const audio = (): Promise<AudioLog> =>
    page.evaluate(() => (window as unknown as { __ltAudio: AudioLog }).__ltAudio);

  await page.goto("/");
  const on = page.getByRole("button", { name: /sound on/i });
  await expect(on).toHaveAttribute("aria-pressed", "true");
  expect((await audio()).state).toBe("suspended");

  await on.click();
  await expect.poll(async () => (await audio()).state).toBe("running");
  const off = page.getByRole("button", { name: /sound off/i });
  await expect(off).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => localStorage.getItem("lt-sound"))).toBe("0");

  // Unmuting is a gesture too: the engine confirms it with a real oscillator.
  await off.click();
  await expect.poll(async () => (await audio()).starts.length).toBeGreaterThan(0);
  await expect(on).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => localStorage.getItem("lt-sound"))).toBe("1");
});
