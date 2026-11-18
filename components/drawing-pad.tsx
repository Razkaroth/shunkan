"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useT } from "@/components/i18n";

type Tool = "pen" | "eraser" | "pan";
interface Stroke { tool: "pen" | "eraser"; color: string; points: Array<{ x: number; y: number }> }

/** Unfinished ink lives only in this component. A reload drops it. */
export function DrawingPad({ onAdd }: { onAdd: (pngBase64: string) => void }) {
	const t = useT();
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [tool, setTool] = useState<Tool>("pen");
	const [strokes, setStrokes] = useState<Stroke[]>([]);
	const draft = useRef<Stroke | null>(null);
	const origin = useRef({ x: 0, y: 0 });
	const view = useRef({ x: 0, y: 0 });

	const paint = () => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.save();
		ctx.translate(view.current.x, view.current.y);
		for (const stroke of [...strokes, draft.current].filter((item): item is Stroke => item !== null && item.points.length > 0)) {
			ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
			ctx.strokeStyle = stroke.color;
			ctx.lineWidth = stroke.tool === "eraser" ? 18 : 2.5;
			ctx.lineCap = "round";
			ctx.beginPath();
			stroke.points.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
			ctx.stroke();
		}
		ctx.restore();
	};

	useEffect(() => { paint(); });

	const point = (event: PointerEvent<HTMLCanvasElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();
		return { x: event.clientX - rect.left - view.current.x, y: event.clientY - rect.top - view.current.y };
	};

	return (
		<div className="rounded-md border border-border bg-card p-2" data-testid="drawing-pad">
			<div className="mb-2 flex flex-wrap gap-1">
				{(["pen", "eraser", "pan"] as const).map((item) => (
					<button key={item} type="button" className="rounded-sm border border-border px-2 py-1 text-xs" aria-pressed={tool === item} onClick={() => setTool(item)}>
						{t(item === "pen" ? "chat.drawing.pen" : item === "eraser" ? "chat.drawing.eraser" : "chat.drawing.pan")}
					</button>
				))}
				<button type="button" className="rounded-sm border border-border px-2 py-1 text-xs" onClick={() => setStrokes((current) => current.slice(0, -1))}>{t("chat.drawing.undo")}</button>
				<button
					type="button"
					className="rounded-sm border border-border px-2 py-1 text-xs"
					onClick={() => {
						const canvas = canvasRef.current;
						if (!canvas) return;
						const data = canvas.toDataURL("image/png").split(",")[1];
						if (data) onAdd(data);
					}}
				>
					{t("chat.drawing.add")}
				</button>
			</div>
			<canvas
				ref={canvasRef}
				width={640}
				height={360}
				className="h-48 w-full touch-none rounded-sm bg-background"
				onPointerDown={(event) => {
					event.currentTarget.setPointerCapture(event.pointerId);
					if (tool === "pan") { origin.current = { x: event.clientX - view.current.x, y: event.clientY - view.current.y }; return; }
					const color = getComputedStyle(event.currentTarget).color || "#111";
					draft.current = { tool, color, points: [point(event)] };
					paint();
				}}
				onPointerMove={(event) => {
					if (tool === "pan" && event.currentTarget.hasPointerCapture(event.pointerId)) {
						view.current = { x: event.clientX - origin.current.x, y: event.clientY - origin.current.y };
						paint();
						return;
					}
					if (!draft.current) return;
					draft.current.points.push(point(event));
					paint();
				}}
				onPointerUp={() => {
					if (draft.current) setStrokes((current) => [...current, draft.current!]);
					draft.current = null;
				}}
			/>
		</div>
	);
}
