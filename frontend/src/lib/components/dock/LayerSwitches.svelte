<script lang="ts">
	/**
	 * The layers as grouped switch rows: a master switch per group, then its layers.
	 * The dock's popover and the side panel show the same list.
	 */
	import { LAYER_GROUPS, type LayerState } from '$lib/state/layers.svelte';
	import Switch from './Switch.svelte';

	interface Props {
		layers: LayerState;
	}

	let { layers }: Props = $props();
</script>

{#each LAYER_GROUPS as group (group.id)}
	<div class="group" role="group" aria-label={group.label}>
		<Switch
			variant="header"
			label={group.label}
			checked={layers.isGroupOn(group)}
			mixed={layers.isGroupMixed(group)}
			onchange={(on) => layers.setGroup(group, on)}
		/>
		{#each group.layers as layer (layer.key)}
			<Switch
				label={layer.label}
				note={layer.note}
				checked={layers[layer.key]}
				onchange={() => layers.toggle(layer.key)}
			/>
		{/each}
	</div>
{/each}

<style>
	.group + .group {
		margin-top: 4px;
		padding-top: 4px;
		border-top: 1px solid var(--hairline);
	}
</style>
