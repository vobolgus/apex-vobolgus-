<script lang="ts">
	import '../app.css';
	import '$lib/ui/tokens.css';
	import { onMount } from 'svelte';

	let { children } = $props();

	/*
	 * A pinch is the chart's: it zooms the sky. Anywhere else it would zoom the page
	 * itself, and a page zoomed that way pans under two fingers, up, down and sideways,
	 * with its far edges out of the window; what is repainted on it leaves hairlines
	 * behind in Safari, too. So a pinch that nothing took does nothing: Safari tells of
	 * one in gesture events, the others as a wheel with Ctrl held. The browser's own
	 * zoom (⌘+ and ⌘−), which lays the page out again at its new size, is untouched.
	 *
	 * A page that is zoomed that way already (it was before this, or by a double tap)
	 * keeps its pinch, which is the way back out.
	 */
	onMount(() => {
		const gestures = ['gesturestart', 'gesturechange', 'gestureend'] as const;
		const zoomed = () => (window.visualViewport?.scale ?? 1) > 1.001;
		const keep = (event: Event) => {
			if (!zoomed()) event.preventDefault();
		};
		const keepWheel = (event: WheelEvent) => {
			if (event.ctrlKey && !zoomed()) event.preventDefault();
		};
		for (const type of gestures) document.addEventListener(type, keep, { passive: false });
		window.addEventListener('wheel', keepWheel, { passive: false });
		return () => {
			for (const type of gestures) document.removeEventListener(type, keep);
			window.removeEventListener('wheel', keepWheel);
		};
	});
</script>

<svelte:head>
	<title>Apex</title>
	<link rel="icon" href="/icon-constellation.png" />
</svelte:head>

<div class="shell">
	<div class="content">
		{@render children()}
	</div>
</div>

<style>
	.shell {
		height: 100%;
	}

	.content {
		padding-top: 0;
	}
</style>
