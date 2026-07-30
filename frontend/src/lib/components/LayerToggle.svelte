<script lang="ts">
	let {
		label,
		value = $bindable(false),
		accent = 'rgba(128, 169, 242, 0.65)',
		accentFill = 'rgba(108, 144, 216, 0.22)',
		accentThumb = '#d6e6ff',
		title = 'Included in exported file'
	} = $props<{
		label: string;
		value?: boolean;
		accent?: string;
		accentFill?: string;
		accentThumb?: string;
		title?: string;
	}>();
</script>

<button
	class="toggle-chip"
	class:is-on={value}
	type="button"
	role="switch"
	aria-checked={value}
	onclick={() => (value = !value)}
	style="--chip-accent: {accent}; --chip-accent-fill: {accentFill}; --chip-thumb-on: {accentThumb};"
	{title}
>
	{label}
	<span class="toggle-thumb"></span>
</button>

<style>
	.toggle-chip {
		height: 28px;
		padding: 0 10px 0 8px;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.14);
		background: rgba(255, 255, 255, 0.03);
		color: #d4dae3;
		font-size: 0.72rem;
		font-weight: 600;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
		transition:
			border-color 0.16s ease,
			background 0.16s ease,
			color 0.16s ease;
	}

	.toggle-chip:hover {
		border-color: rgba(255, 255, 255, 0.28);
		background: rgba(255, 255, 255, 0.08);
		color: #eef2f9;
	}

	.toggle-chip:active {
		background: rgba(255, 255, 255, 0.14);
	}

	.toggle-chip.is-on {
		border-color: var(--chip-accent);
		background: var(--chip-accent-fill);
	}

	.toggle-thumb {
		width: 14px;
		height: 14px;
		border-radius: 999px;
		background: #7e8694;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4) inset;
		transition: background 0.16s ease;
	}

	.toggle-chip.is-on .toggle-thumb {
		background: var(--chip-thumb-on);
	}
</style>
