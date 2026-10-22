<main class="home">
	<section class="hero">
		<h1>Apex</h1>
		<p>Новый фронтенд по спеке: генератор, игры и AstroEtudes в одной SvelteKit-структуре.</p>
		<div class="actions">
			<a class="cta" href="/generator">Открыть генератор</a>
			<a class="ghost" href="/games">Открыть игры</a>
		</div>
	</section>

	<section class="cards">
		<a class="card" href="/generator">
			<h2>Generator</h2>
			<p>Live preview + layered catalog loading + export to PDF.</p>
		</a>
		<a class="card" href="/games">
			<h2>Sky Quiz</h2>
			<p>Лобби игровых режимов и общий UX каркас под 5 режимов.</p>
		</a>
		<a class="card" href="/astra-etudes">
			<h2>AstraEtudes</h2>
			<p>Хаб симуляторов (орбитальная механика и другие физические сценарии).</p>
		</a>
	</section>
</main>

<style>
	.home {
		max-width: 1100px;
		margin: 48px auto 80px auto;
		padding: 24px;
	}

	.hero {
		margin-bottom: 24px;
	}

	h1 {
		margin: 0 0 12px 0;
		font-size: clamp(2rem, 5vw, 3rem);
	}

	p {
		margin: 0 0 24px 0;
		color: var(--text-muted);
		max-width: 760px;
	}

	.actions {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
	}

	.cta {
		display: inline-block;
		padding: 12px 18px;
		border-radius: 10px;
		background: linear-gradient(135deg, var(--accent), #8b5cf6);
		color: #fff;
		font-weight: 600;
	}

	.ghost {
		display: inline-block;
		padding: 12px 18px;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--panel);
		color: var(--text);
		font-weight: 600;
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 12px;
	}

	.card {
		display: block;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 14px;
		padding: 16px;
	}

	.card h2 {
		margin: 0 0 8px 0;
		font-size: 1.05rem;
		color: var(--text);
	}

	.card p {
		margin: 0;
		font-size: 0.9rem;
	}

	@media (max-width: 960px) {
		.cards {
			grid-template-columns: 1fr;
		}
	}
</style>
