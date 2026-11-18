"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/i18n";
import { RICH_SVG_MAX, TEX_TIMEOUT_MS, type RichCodeDecision } from "@/src/core";

/** Render one enabled smiles, abc, or tikz fence in the browser. */
export function RichCodeBlock({ language, source, decision }: { language: string; source: string; decision: RichCodeDecision }) {
	const t = useT();
	const [svg, setSvg] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		if (decision !== "render") return;
		let alive = true;
		const finish = (markup: string) => {
			if (!alive) return;
			if (!markup.includes("<svg") || markup.length > RICH_SVG_MAX) setFailed(true);
			else setSvg(markup);
		};
		const fail = () => { if (alive) setFailed(true); };
		if (language === "smiles") {
			void import("smiles-drawer").then((mod) => {
				const drawer = new mod.default.SvgDrawer({ width: 320, height: 220 });
				const parsed = mod.default.Parser.parse(source);
				const node = drawer.draw(parsed, null, "light");
				finish(node.outerHTML);
			}).catch(fail);
		} else if (language === "abc") {
			void import("abcjs/src/api/abc_tunebook_svg.js").then((mod) => {
				const host = document.createElement("div");
				mod.renderAbc(host, source);
				finish(host.innerHTML);
			}).catch(fail);
		} else if (language === "tikz") {
			const timer = setTimeout(fail, TEX_TIMEOUT_MS);
			void import("isomorphic-tikzjax").then(async (mod) => {
				const markup = await mod.tex2svg(source);
				clearTimeout(timer);
				finish(markup);
			}).catch(() => { clearTimeout(timer); fail(); });
		}
		return () => { alive = false; };
	}, [decision, language, source]);
	if (decision === "too-big") return <p className="text-sm text-muted-foreground">{t("chat.rich.tooBig")}</p>;
	if (failed) return <p className="text-sm text-muted-foreground">{t("chat.rich.failed")}</p>;
	if (!svg) return null;
	return <div className="max-h-[60vh] max-w-full overflow-auto" data-testid={`rich-${language}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function richFlagsFromDocument(): { chemicalStructures: boolean; musicalNotation: boolean; technicalDiagrams: boolean } {
	if (typeof document === "undefined") return { chemicalStructures: false, musicalNotation: false, technicalDiagrams: false };
	const root = document.documentElement;
	return {
		chemicalStructures: root.dataset.richChemical === "1",
		musicalNotation: root.dataset.richMusic === "1",
		technicalDiagrams: root.dataset.richDiagrams === "1",
	};
}
