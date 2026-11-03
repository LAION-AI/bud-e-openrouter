import { type Deck, type Paragraph, SLIDE_H, SLIDE_W } from "./pptx.ts";

/** Bounded visual context, drawn from the same slide data as the editor.
 * Text/layout/style data is sent alongside it; unsupported shapes are outlined.
 */
export async function slidePreviews(
  deck: Deck,
  slide?: number,
): Promise<string[]> {
  const selected = slide === undefined
    ? deck.slides.slice(0, 3)
    : deck.slides.slice(slide - 1, slide);
  const previews: string[] = [];
  for (const item of selected) {
    const canvas = document.createElement("canvas");
    canvas.width = SLIDE_W;
    canvas.height = SLIDE_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return previews;
    if (item.gradient) {
      const radians = item.gradient.angle * Math.PI / 180;
      const gradient = ctx.createLinearGradient(
        0,
        0,
        Math.cos(radians) * SLIDE_W,
        Math.sin(radians) * SLIDE_H,
      );
      gradient.addColorStop(0, item.gradient.from);
      gradient.addColorStop(1, item.gradient.to);
      ctx.fillStyle = gradient;
    } else ctx.fillStyle = item.background ?? "#ffffff";
    ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);
    for (const e of item.elements) {
      ctx.save();
      ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
      ctx.rotate((e.rotation ?? 0) * Math.PI / 180);
      ctx.translate(-e.w / 2, -e.h / 2);
      if (e.kind === "image") {
        if (/^data:image\//.test(e.src)) {
          const image = new Image();
          image.src = e.src;
          try {
            await image.decode();
            ctx.drawImage(image, 0, 0, e.w, e.h);
          } catch { /* Text snapshot still notes the image. */ }
        }
      } else {
        if (e.fill) {
          ctx.fillStyle = e.fill;
          ctx.beginPath();
          if (e.kind === "shape" && e.shape === "ellipse") {
            ctx.ellipse(e.w / 2, e.h / 2, e.w / 2, e.h / 2, 0, 0, Math.PI * 2);
          } else if (e.kind === "shape" && e.shape === "roundRect") {
            ctx.roundRect(0, 0, e.w, e.h, 12);
          } else ctx.rect(0, 0, e.w, e.h);
          ctx.fill();
        }
        if (e.stroke) {
          ctx.strokeStyle = e.stroke;
          ctx.lineWidth = e.strokeWidth ?? 1;
          ctx.strokeRect(0, 0, e.w, e.h);
        }
        ctx.beginPath();
        ctx.rect(0, 0, e.w, e.h);
        ctx.clip();
        drawParagraphs(ctx, e.paragraphs ?? [], e.w, e.h, e.valign);
      }
      ctx.restore();
    }
    previews.push(canvas.toDataURL("image/jpeg", 0.72));
  }
  return previews;
}

function drawParagraphs(
  ctx: CanvasRenderingContext2D,
  paragraphs: Paragraph[],
  width: number,
  height: number,
  valign?: string,
) {
  const lines: Array<{ text: string; paragraph: Paragraph; size: number }> = [];
  for (const paragraph of paragraphs) {
    const run = paragraph.runs[0];
    const size = (run?.size ?? 18) * 4 / 3;
    ctx.font = `${run?.italic ? "italic " : ""}${
      run?.bold ? "bold " : ""
    }${size}px ${run?.font ?? "Arial"}`;
    const text = `${paragraph.bullet ? "• " : ""}${
      paragraph.runs.map((r) => r.text).join("")
    }`;
    let line = "";
    for (const word of text.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (
        line &&
        ctx.measureText(next).width > width - 20 - (paragraph.level ?? 0) * 24
      ) {
        lines.push({ text: line, paragraph, size });
        line = word;
      } else line = next;
    }
    lines.push({ text: line, paragraph, size });
  }
  const totalHeight = lines.reduce((sum, line) => sum + line.size * 1.25, 0);
  let y = valign === "middle"
    ? Math.max(4, (height - totalHeight) / 2)
    : valign === "bottom"
    ? Math.max(4, height - totalHeight - 4)
    : 4;
  ctx.textBaseline = "top";
  for (const { text, paragraph, size } of lines) {
    const run = paragraph.runs[0];
    ctx.font = `${run?.italic ? "italic " : ""}${
      run?.bold ? "bold " : ""
    }${size}px ${run?.font ?? "Arial"}`;
    ctx.fillStyle = run?.color ?? "#262626";
    ctx.textAlign = paragraph.align === "center"
      ? "center"
      : paragraph.align === "right"
      ? "right"
      : "left";
    const x = ctx.textAlign === "center"
      ? width / 2
      : ctx.textAlign === "right"
      ? width - 8
      : 8 + (paragraph.level ?? 0) * 24;
    ctx.fillText(text, x, y);
    y += size * 1.25;
  }
}
