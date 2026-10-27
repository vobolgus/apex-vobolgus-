<script lang="ts">
	import '../app.css';
	import '$lib/ui/tokens.css';

	let { children } = $props();
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
		min-height: 100vh;
	}

	.content {
		padding-top: 0;
	}
</style>
