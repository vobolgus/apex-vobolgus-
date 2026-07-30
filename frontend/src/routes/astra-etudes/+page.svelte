<main class="page">
	<h1>AstraEtudes</h1>
	<p class="sub">
		Хаб интерактивных астросимуляторов. Следующий шаг по спеке — орбитальный симулятор.
	</p>

	<section class="panel">
		<h2>Planned simulator</h2>
		<ul>
			<li>Orbit simulator (RK4 + orbital elements)</li>
			<li>Moon phases</li>
			<li>Doppler effect demo</li>
		</ul>
	</section>
</main>

<style>
	.page {
		max-width: 1000px;
		margin: 48px auto;
		padding: 24px;
	}

	h1 {
		margin: 0 0 8px 0;
		font-size: clamp(1.8rem, 4vw, 2.5rem);
	}

	.sub {
		margin: 0 0 18px 0;
		color: var(--text-muted);
	}

	.panel {
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 14px;
		padding: 16px;
	}

	h2 {
		margin: 0 0 10px 0;
		font-size: 1.05rem;
	}

	ul {
		margin: 0;
		padding-left: 18px;
		color: var(--text-muted);
	}

	li {
		margin: 6px 0;
	}
</style>
