import { forwardRef, type SVGProps } from "react";
import type { EventCheckIn } from "./api/types";
import { formatDateRange } from "./presentation";

type Props = { data: EventCheckIn; day?: EventCheckIn["event"]["days"][number]; includeEmpty: boolean };
type Row = { number: number | null; team: EventCheckIn["slots"][number] | null };
const WIDTH = 1120;
const HEIGHT = 1300;
const INK = "#243c30";
const MUTED = "#66776c";

// Keep long and stylized names whole, including in exported images and PDFs.
function FitText({ text, width, size = 16, ...props }: { text: string; width: number; size?: number } & SVGProps<SVGTextElement>) {
  const estimated = Array.from(text).reduce((total, character) => total + (/[^\u0000-\u024f]/u.test(character) ? size : size * .62), 0);
  return <text {...props} fontSize={size} {...(estimated > width ? { textLength: width, lengthAdjust: "spacingAndGlyphs" } : {})}>{text}</text>;
}

const SlotSheet = forwardRef<SVGSVGElement, Props>(function SlotSheet({ data, day, includeEmpty }, ref) {
  const occupied = new Set(data.slots.flatMap((slot) => slot.slot_number === null ? [] : [slot.slot_number]));
  const emptyNumbers = Array.from({ length: data.event.squad_capacity }, (_, index) => index + 1).filter((number) => !occupied.has(number));
  const rows: Row[] = data.slots.map((team) => ({ number: team.slot_number, team }));
  if (includeEmpty) rows.push(...emptyNumbers.map((number) => ({ number, team: null })));
  rows.sort((left, right) => (left.number ?? Infinity) - (right.number ?? Infinity));
  const columns = [rows.slice(0, Math.ceil(rows.length / 2)), rows.slice(Math.ceil(rows.length / 2))];
  const rowHeight = 73;
  const contentHeight = Math.max(...columns.map((column) => column.length * rowHeight), 1);
  const scale = Math.min(1, 960 / contentHeight);
  const columnWidth = 512 / scale;
  const date = day ? `${day.label || "Match day"} · ${formatDateRange(day.date, null)}` : formatDateRange(data.event.days[0]?.date ?? null, data.event.days.at(-1)?.date ?? null);
  const timestamp = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: data.event.timezone }).format(new Date(data.generated_at));
  return <svg ref={ref} className="check-in-sheet" xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width={WIDTH} height={HEIGHT} role="img" aria-labelledby="slot-sheet-title slot-sheet-description" fontFamily="Arial, Helvetica, sans-serif" fill={INK}>
    <title id="slot-sheet-title">{data.event.title} — clan slots</title>
    <desc id="slot-sheet-description">{date}. {data.slots.length} assigned slots. {rows.map(({ number, team }) => `Slot ${number ?? "unassigned"}: ${team ? team.clan.name : "No clan listed"}`).join(". ")}</desc>
    <rect width={WIDTH} height={HEIGHT} fill="#fff" />
    <path transform="translate(42 36)" d="M0 42 20 2h10L10 42Zm20 0 10-20L40 42h10L30 2l-5 10L40 42Z" fill="#e64b35" />
    <text x="104" y="72" fontSize="29" fontWeight="700" letterSpacing="-1">arewavanta<tspan fill="#e64b35">.</tspan></text>
    <text x="1078" y="66" textAnchor="end" fill={MUTED} fontSize="13" letterSpacing="2">LOBBY SLOTS</text>
    <FitText x="42" y="130" text={data.event.title} width={1036} size={36} fontWeight="700" />
    <FitText x="42" y="163" text={date} width={1036} size={17} fill={MUTED} />
    <line x1="42" y1="190" x2="1078" y2="190" stroke={INK} strokeWidth="2" />
    <text x="42" y="222" fontSize="20" fill={MUTED}><tspan fontWeight="700" fill={INK}>{data.slots.length}</tspan> assigned · {data.event.squad_capacity} slots</text>
    {columns.map((column, index) => {
      let top = 0;
      return <g key={index} transform={`translate(${index ? 566 : 42} 250) scale(${scale})`}>
        {column.map((row) => {
          const y = top;
          top += rowHeight;
          const team = row.team;
          return <g key={team?.squad.id ?? `empty-${row.number}`} transform={`translate(0 ${y})`}>
            <rect x="0" y="8" width="54" height="52" rx="8" fill={team ? INK : "#edf1ed"} />
            <text x="27" y="43" textAnchor="middle" fill={team ? "#fff" : MUTED} fontSize="25" fontWeight="700">{row.number === null ? "—" : String(row.number).padStart(2, "0")}</text>
            <FitText x="70" y="43" text={team?.clan.name ?? "No clan listed"} width={columnWidth - 80} size={26} fontWeight={team ? "700" : "400"} fill={team ? INK : MUTED} />
            <line x1="0" y1={rowHeight - 1} x2={columnWidth} y2={rowHeight - 1} stroke="#dce4dd" />
          </g>;
        })}
      </g>;
    })}
    {!rows.length && <text x="42" y="285" fontSize="18" fill={MUTED}>No slots assigned yet.</text>}
    <line x1="42" y1="1220" x2="1078" y2="1220" stroke="#dce4dd" />
    <text x="42" y="1250" fontSize="13" fill={MUTED}>Stay in your assigned slot.</text>
    <text x="42" y="1278" fontSize="12" fill={MUTED}>Updated {timestamp} · {data.event.timezone === "Africa/Lagos" ? "WAT" : data.event.timezone}</text>
    <text x="1078" y="1278" textAnchor="end" fontSize="13" fontWeight="700">arewavanta.com</text>
  </svg>;
});

export async function saveSlotSheetImage(svg: SVGSVGElement, filename: string) {
  const source = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH * 2;
    canvas.height = HEIGHT * 2;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image export is unavailable in this browser. Use Print / Save PDF instead.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Couldn’t create the image. Try Print / Save PDF.")), "image/png"));
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    // Give mobile browsers time to start their download before releasing the URL.
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 60_000);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default SlotSheet;
