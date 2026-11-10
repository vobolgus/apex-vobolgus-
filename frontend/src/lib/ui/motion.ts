/**
 * Whether the user asked the system for less motion. Everything that moves for
 * its own sake (the sky's glide after a drag, the flight to a linked view, fades
 * and slides) checks this and takes the direct route instead. CSS does the same
 * with `@media (prefers-reduced-motion: reduce)`; this is for what the script
 * animates.
 */
export function prefersReducedMotion(): boolean {
	return (
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches
	);
}
