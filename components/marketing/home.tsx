import { LhMark } from "@/components/lh-mark";

/** Public source repository. AGPL-3.0-only requires this offer. */
export const SHUNKAN_SOURCE = "https://github.com/Razkaroth/shunkan";

export const SHUNKAN_LICENSE = `${SHUNKAN_SOURCE}/blob/Raz-edition/LICENSE`;

const LOOP = [
	{
		index: "01",
		title: "Measure",
		body: "Before teaching, the agent finds where your understanding ends.",
	},
	{
		index: "02",
		title: "Plan",
		body: "A dependency path from that point to the goal. It changes when you do.",
	},
	{
		index: "03",
		title: "Teach",
		body: "One reasoning step at a time. You predict, then check.",
	},
	{
		index: "04",
		title: "Practice",
		body: "Problems that ask the idea to come to mind without being named.",
	},
] as const;

const ADDS = [
	"Hosted Next.js application",
	"Accounts",
	"Database",
	"AI gateway",
	"No Electron",
] as const;

/**
 * Public marketing entry for Shunkan. The learning app stays on its own
 * routes; this surface introduces the hosted product.
 */
export function MarketingHome() {
	return (
		<div className="marketing-home bg-[#141414] text-[#e6e6e6]" data-testid="marketing-home">
			<style>{`
				@keyframes shunkan-in {
					from { opacity: 0; transform: translateY(10px); }
					to { opacity: 1; transform: none; }
				}
				.marketing-home .shunkan-in {
					animation: shunkan-in 700ms ease-out both;
				}
				.marketing-home a:focus-visible {
					outline: 1px solid #e6e6e6;
					outline-offset: 4px;
				}
				@media (prefers-reduced-motion: reduce) {
					.marketing-home .shunkan-in { animation: none; }
				}
			`}</style>

			<section className="relative min-h-svh overflow-hidden">
				{/* Already a sized webp. next/image would re-encode it. */}
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img
					src="/marketing/knowledge-graph.webp"
					alt=""
					width={2000}
					height={1125}
					fetchPriority="high"
					className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center"
				/>
				<div
					aria-hidden="true"
					className="absolute inset-0 bg-[linear-gradient(180deg,rgba(20,20,20,0.2)_0%,#141414_64%)] md:bg-[linear-gradient(90deg,#141414_0%,#141414_42%,rgba(20,20,20,0.78)_62%,rgba(20,20,20,0.2)_100%)]"
				/>

				<header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-6 py-5 md:px-14">
					<a href="#top" className="flex items-center gap-3 font-mono text-sm tracking-[0.14em] text-[#f4f1ea]">
						<LhMark className="size-6" />
						<span>Shunkan</span>
					</a>
					<a
						href={SHUNKAN_SOURCE}
						className="font-mono text-sm tracking-[0.14em] text-[#f4f1ea] underline decoration-[#434343] underline-offset-4 hover:decoration-[#f4f1ea]"
						rel="noreferrer"
						target="_blank"
					>
						Source
					</a>
				</header>

				<div
					id="top"
					className="relative z-10 flex min-h-svh max-w-[34rem] flex-col justify-end px-6 pt-28 pb-16 md:justify-center md:px-14 md:pb-20"
				>
					<p className="shunkan-in font-mono text-sm tracking-[0.22em] text-[#e2b657]" lang="ja">
						瞬間
					</p>
					<h1
						className="shunkan-in font-title mt-4 text-[clamp(4.25rem,11vw,7.5rem)] leading-[0.9] tracking-[-0.03em] text-[#f4f1ea]"
						style={{ animationDelay: "80ms" }}
					>
						Shunkan
					</h1>
					<p
						className="shunkan-in mt-6 max-w-[16ch] font-title text-[clamp(1.75rem,3vw,2.25rem)] leading-[1.15] text-[#f4f1ea]"
						style={{ animationDelay: "160ms" }}
					>
						A moment of learning.
					</p>
					<p
						className="shunkan-in mt-6 font-sans text-lg leading-relaxed text-[#d7d7d7]"
						style={{ animationDelay: "240ms" }}
					>
						An agent harness for learning, hosted.
					</p>
					<div className="shunkan-in mt-10 flex flex-wrap items-center gap-x-8 gap-y-4" style={{ animationDelay: "320ms" }}>
						<a
							href="/users"
							className="inline-flex min-h-11 items-center bg-[#f4f1ea] px-5 font-mono text-sm tracking-[0.14em] text-[#141414]"
						>
							Enter the app
						</a>
						<a
							href={SHUNKAN_SOURCE}
							className="inline-flex min-h-11 items-center font-mono text-sm tracking-[0.14em] text-[#f4f1ea] underline decoration-[#434343] underline-offset-4 hover:decoration-[#f4f1ea]"
							rel="noreferrer"
							target="_blank"
						>
							Read the source
						</a>
					</div>
				</div>
			</section>

			<section id="application" className="border-t border-[#434343] px-6 py-24 md:px-14">
				<div className="grid items-end gap-12 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:gap-24">
					<div>
						<p className="font-mono text-sm tracking-[0.18em] text-[#e2b657]">The application</p>
						<h2 className="font-title mt-4 text-[clamp(2rem,4vw,3.25rem)] leading-[1.05] text-[#f4f1ea]">
							Measure, plan, teach, practice.
						</h2>
					</div>
					<ol className="divide-y divide-[#434343] border-y border-[#434343]">
						{LOOP.map((step) => (
							<li key={step.index} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-6 py-7">
								<span className="font-mono text-sm text-[#9a9a9a]">{step.index}</span>
								<div>
									<h3 className="font-title text-2xl text-[#f4f1ea]">{step.title}</h3>
									<p className="mt-2 max-w-[36rem] font-sans text-lg leading-relaxed text-[#d0d0d0]">{step.body}</p>
								</div>
							</li>
						))}
					</ol>
				</div>
				<p className="mt-16 max-w-[40rem] font-sans text-lg leading-relaxed text-[#d0d0d0]">
					What you learn stays as propositions and the premises that lead to them. The graph is the home of the app, and later sessions read it instead of starting over.
				</p>
				<figure className="mt-16">
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img
						src="/marketing/teaching-session.webp"
						alt="A teaching session on gradient descent: an explanation, a prediction to check, a confidence mark, and the lesson plan beside the transcript."
						width={1800}
						height={1255}
						className="w-full border border-[#434343]"
					/>
					<figcaption className="mt-4 max-w-[40rem] font-mono text-sm tracking-[0.04em] text-[#a3a3a3]">
						A teaching session. Predict, then check. The plan stays visible.
					</figcaption>
				</figure>
			</section>

			<section id="hosted" className="border-t border-[#434343] px-6 py-24 md:px-14">
				<div className="grid gap-12 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:gap-24">
					<div>
						<p className="font-mono text-sm tracking-[0.18em] text-[#e2b657]">Over LearnHarness</p>
						<h2 className="font-title mt-4 text-[clamp(2rem,4vw,3.25rem)] leading-[1.05] text-[#f4f1ea]">
							The same harness, hosted.
						</h2>
					</div>
					<div>
						<p className="max-w-[38rem] font-sans text-lg leading-relaxed text-[#d0d0d0]">
							LearnHarness is the learning method and the desktop application. Shunkan is the hosted line of that harness.
						</p>
						<ul className="mt-10 divide-y divide-[#434343] border-y border-[#434343]">
							{ADDS.map((item) => (
								<li key={item} className="py-5 font-title text-[clamp(1.6rem,3vw,2.15rem)] leading-none text-[#f4f1ea]">
									{item}
								</li>
							))}
						</ul>
					</div>
				</div>
			</section>

			<footer id="license" className="border-t border-[#434343] px-6 py-20 md:px-14">
				<p className="font-mono text-sm tracking-[0.18em] text-[#e2b657]">License</p>
				<p className="font-title mt-4 text-[clamp(2rem,4vw,3.25rem)] leading-none">
					<a
						href={SHUNKAN_LICENSE}
						className="text-[#f4f1ea] underline decoration-[#434343] underline-offset-8 hover:decoration-[#f4f1ea]"
						rel="license noreferrer"
						target="_blank"
					>
						AGPL-3.0-only
					</a>
				</p>
				<p className="mt-6 max-w-[36rem] font-sans text-lg leading-relaxed text-[#d0d0d0]">
					The source is public. The license stays AGPL-3.0-only, so this hosted app links to it.
				</p>
				<a
					href={SHUNKAN_SOURCE}
					className="mt-8 inline-flex max-w-full font-mono text-sm break-all text-[#f4f1ea] underline decoration-[#434343] underline-offset-4 hover:decoration-[#f4f1ea]"
					rel="noreferrer"
					target="_blank"
				>
					{SHUNKAN_SOURCE}
				</a>
			</footer>
		</div>
	);
}
