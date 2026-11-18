/** Family limits for fenced smiles, abc, and tikz. Families default off. */
export const RICH_CODE = {
	smiles: { flag: "chemicalStructures", max: 2_048 },
	abc: { flag: "musicalNotation", max: 16_384 },
	tikz: { flag: "technicalDiagrams", max: 32_768 },
} as const;

export const RICH_SVG_MAX = 2_097_152;
export const TEX_TIMEOUT_MS = 10_000;

export interface RichCodeFlags {
	chemicalStructures?: boolean;
	musicalNotation?: boolean;
	technicalDiagrams?: boolean;
}

export type RichCodeDecision = "off" | "render" | "too-big";

export function richCodeDecision(language: string, source: string, flags: RichCodeFlags): RichCodeDecision {
	const family = RICH_CODE[language as keyof typeof RICH_CODE];
	if (!family || !flags[family.flag]) return "off";
	return source.length > family.max ? "too-big" : "render";
}
