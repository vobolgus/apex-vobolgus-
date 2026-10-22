<main class="page">
	<h1>Sky Quiz</h1>
	<p class="sub">Лобби игровых режимов в новом фронтенде (по спеке: 5 режимов).</p>

	<section class="grid">
		<article class="card">
			<h2>Constellation</h2>
			<p>Угадай созвездие по изображению.</p>
		</article>
		<article class="card">
			<h2>Star</h2>
			<p>Определи звезду по участку неба.</p>
		</article>
		<article class="card">
			<h2>Messier</h2>
			<p>Угадай объект Мессье по изображению/карте.</p>
		</article>
		<article class="card">
			<h2>Draw</h2>
			<p>Соедини звёзды в контур созвездия.</p>
		</article>
		<article class="card">
			<h2>Trivia</h2>
			<p>Классический астроквиз с фактами и мифологией.</p>
		</article>
	</section>
</main>

<style>
	.page {
		max-width: 1100px;
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

	.grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 12px;
	}

	.card {
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 14px;
		padding: 14px;
	}

	.card h2 {
		margin: 0 0 8px 0;
		font-size: 1rem;
	}

	.card p {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.9rem;
	}

	@media (max-width: 960px) {
		.grid {
			grid-template-columns: 1fr;
		}
	}
</style>
