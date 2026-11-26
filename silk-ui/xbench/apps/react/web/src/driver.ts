// The xbench protocol (PROTOCOL.md) for a React app: lines on the console that the runner reads,
// and the steps of a scene run one per animation frame.
import { frameStats } from "@silkui/core";

export const say = (line: string) => console.log("XB " + line);

export type Step =
  | { mark: string }
  | { idle: string; ms: number }
  | { driver: string; frame: (f: number) => boolean | void; frames?: number };

const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Waits for the first frame with content to be on screen, then runs the steps and says done. */
export async function run(steps: Step[]) {
  // The frame after the one that drew the first content: by then the first content frame has
  // been laid out, painted and handed to the compositor. Silk windows also count presents.
  await nextFrame();
  await nextFrame();
  for (let i = 0; i < 30 && (frameStats()?.frames ?? 1) === 0; i++) await nextFrame();
  say("first-paint");
  for (const step of steps) {
    if ("mark" in step) {
      say("mark " + step.mark);
      await sleep(400);
    } else if ("idle" in step) {
      say("idle-begin " + step.idle);
      await sleep(step.ms);
      say("idle-end " + step.idle);
    } else {
      await nextFrame();
      say("begin " + step.driver);
      const times: number[] = [];
      let f = 0;
      for (;;) {
        const t = await nextFrame();
        times.push(t);
        if (step.frames !== undefined && f >= step.frames) break;
        if (step.frame(f) === false) break;
        f += 1;
      }
      say(`end ${step.driver} ${f}`);
      const gaps: string[] = [];
      for (let k = 1; k < times.length; k++) gaps.push((times[k] - times[k - 1]).toFixed(3));
      say(`frames ${step.driver} ${gaps.join(",")}`);
    }
  }
  say("done");
}
