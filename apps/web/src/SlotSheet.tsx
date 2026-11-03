import { forwardRef, type SVGProps } from "react";
import type { EventCheckIn } from "./api/types";
import { formatDateRange } from "./presentation";

type Props = { data: EventCheckIn; day?: EventCheckIn["event"]["days"][number]; includeEmpty: boolean };
type Row = { number: number | null; team: EventCheckIn["slots"][number] | null };
const WIDTH = 1120;
const HEIGHT = 1584;
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
  const rowHeight = (row: Row) => Math.max(84, 46 + Math.ceil((row.team?.players.length ?? 0) / 2) * 23);
  const contentHeight = Math.max(...columns.map((column) => column.reduce((height, row) => height + rowHeight(row), 0)), 1);
  const scale = Math.min(1.18, 1220 / contentHeight);
  const columnWidth = 512 / scale;
  const playerWidth = (columnWidth - 74) / 2;
  const date = day ? `${day.label || "Match day"} · ${formatDateRange(day.date, null)}` : formatDateRange(data.event.days[0]?.date ?? null, data.event.days.at(-1)?.date ?? null);
  const timestamp = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: data.event.timezone }).format(new Date(data.generated_at));
  const playerCount = data.slots.reduce((count, slot) => count + slot.players.length, 0);
  return <svg ref={ref} className="check-in-sheet" xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width={WIDTH} height={HEIGHT} role="img" aria-labelledby="slot-sheet-title slot-sheet-description" fontFamily="Arial, Helvetica, sans-serif" fill={INK}>
    <title id="slot-sheet-title">{data.event.title} — slots and players</title>
    <desc id="slot-sheet-description">{date}. {data.slots.length} assigned squads, {playerCount} players. {rows.map(({ number, team }) => `Slot ${number ?? "unassigned"}: ${team ? `${team.clan.name}, ${team.squad.name}. ${team.players.map((player) => player.ign).join(", ") || "Lineup not listed"}` : "No squad assigned"}`).join(". ")}</desc>
    <rect width={WIDTH} height={HEIGHT} fill="#fff" />
    <path transform="translate(42 36)" d="M0 42 20 2h10L10 42Zm20 0 10-20L40 42h10L30 2l-5 10L40 42Z" fill="#e64b35" />
    <text x="104" y="72" fontSize="29" fontWeight="700" letterSpacing="-1">arewavanta<tspan fill="#e64b35">.</tspan></text>
    <text x="1078" y="66" textAnchor="end" fill={MUTED} fontSize="13" letterSpacing="2">LOBBY LINEUP</text>
    <FitText x="42" y="130" text={data.event.title} width={1036} size={36} fontWeight="700" />
    <FitText x="42" y="163" text={date} width={1036} size={17} fill={MUTED} />
    <line x1="42" y1="190" x2="1078" y2="190" stroke={INK} strokeWidth="2" />
    <text x="42" y="222" fontSize="15"><tspan fontWeight="700">{data.slots.length}</tspan> squads <tspan dx="18" fontWeight="700">{playerCount}</tspan> players</text>
    <text x="1078" y="222" textAnchor="end" fill={MUTED} fontSize="13">Current registered lineups · {data.event.squad_capacity} slots</text>
    {columns.map((column, index) => {
      let top = 0;
      return <g key={index} transform={`translate(${index ? 566 : 42} 250) scale(${scale})`}>
        {column.map((row) => {
          const y = top;
          top += rowHeight(row);
          const team = row.team;
          return <g key={team?.squad.id ?? `empty-${row.number}`} transform={`translate(0 ${y})`}>
            <rect x="0" y="9" width="43" height="43" rx="8" fill={team ? INK : "#edf1ed"} />
            <text x="21.5" y="37" textAnchor="middle" fill={team ? "#fff" : MUTED} fontSize="21" fontWeight="700">{row.number === null ? "—" : String(row.number).padStart(2, "0")}</text>
            <FitText x="57" y="26" text={team?.clan.name ?? "No squad assigned"} width={columnWidth - 69} size={18} fontWeight="700" fill={team ? INK : MUTED} />
            {team && <>
              <FitText x="57" y="45" text={team.squad.number ? `Squad ${team.squad.number}` : team.squad.name} width={columnWidth - 69} size={12} fill={MUTED} />
              {team.players.length ? team.players.map((player, playerIndex) => <FitText key={player.id} x={57 + (playerIndex % 2) * (playerWidth + 12)} y={66 + Math.floor(playerIndex / 2) * 23} text={player.ign} width={playerWidth} size={15} />) : <text x="57" y="66" fontSize="14" fill={MUTED}>Lineup not listed yet</text>}
            </>}
            <line x1="0" y1={rowHeight(row) - 1} x2={columnWidth} y2={rowHeight(row) - 1} stroke="#dce4dd" />
          </g>;
        })}
      </g>;
    })}
    {!rows.length && <text x="42" y="285" fontSize="18" fill={MUTED}>No squads assigned yet.</text>}
    <line x1="42" y1="1500" x2="1078" y2="1500" stroke="#dce4dd" />
    <text x="42" y="1528" fontSize="13" fill={MUTED}>Stay in your assigned slot. Organizers can update lineups.</text>
    <text x="42" y="1552" fontSize="12" fill={MUTED}>Updated {timestamp} · {data.event.timezone === "Africa/Lagos" ? "WAT" : data.event.timezone}</text>
    <text x="1078" y="1552" textAnchor="end" fontSize="13" fontWeight="700">arewavanta.com</text>
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
