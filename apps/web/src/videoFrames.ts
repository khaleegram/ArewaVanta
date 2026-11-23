/**
 * Cuts the distinct, settled frames out of a screen recording inside the browser, so a 60 MB
 * video never has to be uploaded: only a few small JPEGs are sent to the reader.
 */
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
export const isVideoFile = (file: File) => file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(file.name);

const MAX_DURATION = 240;
const MAX_FRAMES = 36;
const STEP = 0.5;

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { video.removeEventListener("seeked", done); reject(new Error("The video stopped responding. Try a shorter recording.")); }, 8000);
    const done = () => { clearTimeout(timer); resolve(); };
    video.addEventListener("seeked", done, { once: true });
    video.currentTime = time;
  });
}

function signature(video: HTMLVideoElement, canvas: HTMLCanvasElement): Uint8ClampedArray {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const out = new Uint8ClampedArray(canvas.width * canvas.height);
  for (let i = 0; i < out.length; i++) out[i] = (data[i * 4] * 3 + data[i * 4 + 1] * 6 + data[i * 4 + 2]) / 10;
  return out;
}

function difference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

function spread(a: Uint8ClampedArray): number {
  let min = 255, max = 0;
  for (const value of a) { if (value < min) min = value; if (value > max) max = value; }
  return max - min;
}

export async function extractFrames(file: File, onProgress: (done: number) => void, signal?: AbortSignal): Promise<File[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true; video.playsInline = true; video.preload = "auto"; video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("This browser cannot open that video. On iPhone use Safari; otherwise send screenshots."));
    });
    if (!video.videoWidth || !Number.isFinite(video.duration)) throw new Error("This browser cannot read that video format. Use Safari on iPhone, or send screenshots.");
    if (video.duration > MAX_DURATION) throw new Error("Use a recording under four minutes. Scroll the table once, slowly.");

    const scale = Math.min(1, 1600 / video.videoWidth);
    const full = document.createElement("canvas");
    full.width = Math.round(video.videoWidth * scale); full.height = Math.round(video.videoHeight * scale);
    const small = document.createElement("canvas");
    small.width = 64; small.height = Math.max(16, Math.round(64 * video.videoHeight / video.videoWidth));

    const kept: { time: number; blob: Blob }[] = [];
    let previous: Uint8ClampedArray | null = null;
    let lastKept: Uint8ClampedArray | null = null;
    for (let time = 0.2; time < video.duration; time += STEP) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      await seek(video, time);
      const sample = signature(video, small);
      const settled = previous === null || difference(sample, previous) < 4;
      const fresh = lastKept === null || difference(sample, lastKept) > 7;
      previous = sample;
      onProgress(Math.min(1, time / video.duration));
      if (!settled || !fresh || spread(sample) < 40) continue;
      full.getContext("2d")!.drawImage(video, 0, 0, full.width, full.height);
      const blob = await new Promise<Blob | null>((resolve) => full.toBlob(resolve, "image/jpeg", 0.82));
      if (blob && blob.size < 4.5 * 1024 * 1024) { kept.push({ time, blob }); lastKept = sample; }
    }
    if (!kept.length) throw new Error("No clear frames were found. Record the scoreboard again and pause briefly on each part.");
    const chosen = kept.length > MAX_FRAMES ? Array.from({ length: MAX_FRAMES }, (_, i) => kept[Math.floor(i * kept.length / MAX_FRAMES)]) : kept;
    const base = file.name.replace(/\.[^.]+$/, "");
    return chosen.map(({ blob }, index) => new File([blob], `${base}-frame-${String(index + 1).padStart(2, "0")}.jpg`, { type: "image/jpeg" }));
  } finally {
    video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url);
  }
}
