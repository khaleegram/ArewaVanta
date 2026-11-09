export type PreparedScoreboard = {
  file: File;
  preview: string;
  cropped: boolean;
  originalWidth: number;
  width: number;
  height: number;
};

/** Locate the main image between the black borders of a phone gallery capture. */
export function scoreboardBounds(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): { top: number; bottom: number } {
  if (height < width * 1.25) return { top: 0, bottom: height };
  const step = Math.max(1, Math.floor(width / 180));
  const rows: boolean[] = [];
  for (let y = 0; y < height; y++) {
    let visible = 0;
    let samples = 0;
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 38) visible++;
      samples++;
    }
    rows.push(visible / samples > 0.16);
  }
  const rowGap = Math.max(14, Math.round(width * 0.03));
  const bands: { top: number; bottom: number }[] = [];
  let start = -1;
  let last = -1;
  for (let y = 0; y <= height; y++) {
    if (rows[y]) {
      if (start < 0) start = y;
      last = y;
    }
    if (start >= 0 && (y - last > rowGap || y === height)) {
      bands.push({ top: start, bottom: last + 1 });
      start = -1;
    }
  }
  bands.sort((a, b) => b.bottom - b.top - (a.bottom - a.top));
  const band = bands[0];
  if (
    !band ||
    band.bottom - band.top < width * 0.25 ||
    band.bottom - band.top > height * 0.85
  ) return { top: 0, bottom: height };
  return {
    top: Math.max(0, band.top - 10),
    bottom: Math.min(height, band.bottom + 10),
  };
}

/** Prepare screenshots locally; this needs no additional provider or API call. */
export async function prepareScoreboard(file: File): Promise<PreparedScoreboard> {
  const image = await createImageBitmap(file);
  try {
    // Bound canvas memory for large photos while keeping scoreboard text legible.
    const scale = Math.min(1, 2400 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not prepare this screenshot.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const bounds = scoreboardBounds(
      context.getImageData(0, 0, canvas.width, canvas.height).data,
      canvas.width, canvas.height,
    );
    const cropped = bounds.top > 0 || bounds.bottom < canvas.height;
    const output = document.createElement("canvas");
    const enlargement = Math.min(2.5, 1400 / canvas.width);
    output.width = Math.round(canvas.width * enlargement);
    output.height = Math.round((bounds.bottom - bounds.top) * enlargement);
    const drawing = output.getContext("2d");
    if (!drawing) throw new Error("Could not prepare this screenshot.");
    drawing.imageSmoothingEnabled = true;
    drawing.imageSmoothingQuality = "high";
    drawing.drawImage(
      canvas, 0, bounds.top, canvas.width, bounds.bottom - bounds.top,
      0, 0, output.width, output.height,
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      output.toBlob(
        (value) => value
          ? resolve(value)
          : reject(new Error("Could not prepare this screenshot.")),
        "image/png",
      ),
    );
    // Keep a valid original when a detailed PNG would exceed the upload limit.
    const prepared = blob.size <= 5 * 1024 * 1024
      ? new File([blob], file.name.replace(/\.[^.]+$/, "") + ".png", {
          type: "image/png", lastModified: file.lastModified,
        })
      : file;
    return {
      file: prepared, preview: URL.createObjectURL(blob), cropped,
      originalWidth: image.width, width: output.width, height: output.height,
    };
  } finally {
    image.close();
  }
}
