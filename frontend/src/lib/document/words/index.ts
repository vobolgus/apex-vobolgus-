/**
 * The words the document sets on a page, in each language it writes in
 * (`Language`): what a template writes on its own, what a table calls itself and
 * its columns and says when it has nothing to list, and the names of what is on
 * the sky. Nothing here lays anything out: `templates.ts` and `table.ts` look their
 * words up here, and the big tables of names are data beside it
 * (`constellations.ts`, `stars.ts`).
 *
 * What the editor's controls call things is in English alone (`labels.ts`), and
 * what a field shows (`text.ts`) is the same in every language.
 */

import type { Language, TableSource } from '../types';
import { CONSTELLATION_NAMES } from './constellations';
import { NAMED_STARS } from './stars';

/** In the order the picker offers them; the first is the one a page is written in untold. */
export const LANGUAGES: readonly Language[] = ['en', 'ru'];

/** What a template or a table writes in when it is told no language. */
export const DEFAULT_LANGUAGE: Language = LANGUAGES[0];

// === A template's words ===

/** The words a template writes on its own, in one language. */
export interface TemplateWords {
	titles: Record<'caption' | 'pair' | 'finder', string>;
	skyCaption: string;
	frameCaption: string;
	/** What a close-up's caption says after the object's name. */
	closeUpCaption: string;
	header: string;
	tasks: string;
}

export const TEMPLATE_WORDS: Record<Language, TemplateWords> = {
	en: {
		titles: { caption: 'Sky chart', pair: 'Two skies', finder: 'Finder card' },
		skyCaption: 'Latitude {lat} · sidereal time {lst}',
		frameCaption: 'Centre {ra}, {dec} · field {fov}',
		closeUpCaption: ' · field {fov}',
		header: 'Name ______________________   Class ________',
		tasks: [
			'1. Mark the zenith with Z and the cardinal points with N, S, W, E.',
			'2. Mark the celestial pole with P.',
			'3. Mark the vernal equinox, or else the autumnal one.',
			'4. Draw the great circles of the celestial equator and of the ecliptic.',
			'5. Work out the sidereal time of the chart: __________',
			'6. Find the latitude it was taken at: __________',
			'7. Draw the outlines of all the constellations in sight.',
			'8. Mark on the chart the objects of the tables below.'
		].join('\n')
	},
	ru: {
		titles: { caption: 'Карта неба', pair: 'Два неба', finder: 'Поисковая карта' },
		skyCaption: 'Широта {lat} · звёздное время {lst}',
		frameCaption: 'Центр {ra}, {dec} · поле {fov}',
		closeUpCaption: ' · поле {fov}',
		header: 'Фамилия, имя ______________________   Класс ________',
		tasks: [
			'1. Обозначьте точку зенита символом Z и стороны света символами N, S, W, E.',
			'2. Обозначьте полюс мира символом P.',
			'3. Обозначьте точку весны или же точку осени.',
			'4. Проведите большие круги небесного экватора и эклиптики.',
			'5. Рассчитайте звёздное время скайчарта: __________',
			'6. Определите широту места съёмки: __________',
			'7. Проведите контуры всех видимых созвездий.',
			'8. Отметьте на скайчарте объекты из таблиц ниже.'
		].join('\n')
	}
};

// === A table's words ===

/** The words a table sets on the page, in one language. */
interface TableWords {
	titles: Record<TableSource, string>;
	headers: Record<TableSource, string[]>;
	noChart: string;
	notLoaded: string;
	none: string;
}

export const TABLE_WORDS: Record<Language, TableWords> = {
	en: {
		titles: { messier: 'Messier objects', stars: 'Stars' },
		headers: {
			messier: ['Object', 'Name', 'Type', 'Constellation', 'Mag'],
			stars: ['№', 'Name', 'RA', 'Dec', 'Mag']
		},
		noChart: 'No chart to read',
		notLoaded: 'The catalogue is not loaded',
		none: 'None on this chart'
	},
	ru: {
		titles: { messier: 'Объекты Мессье', stars: 'Звёзды' },
		headers: {
			messier: ['Объект', 'Название', 'Тип', 'Созвездие', 'Зв. вел.'],
			stars: ['№', 'Название', 'α', 'δ', 'Зв. вел.']
		},
		noChart: 'Нет скайчарта',
		notLoaded: 'Каталог не загружен',
		none: 'На этом скайчарте нет'
	}
};

// === The names of what is on the sky ===

/** A constellation in full, in English or Russian; the abbreviation itself when it is not one of the 88. */
export function constellationName(
	abbreviation: string,
	language: Language = DEFAULT_LANGUAGE
): string {
	return CONSTELLATION_NAMES[language][abbreviation] ?? abbreviation;
}

/** What the Messier catalogue calls each kind of object, in Russian. */
const KIND_NAMES_RU: Record<string, string> = {
	Galaxy: 'Галактика',
	'Globular Cluster': 'Шаровое скопление',
	'Open Cluster': 'Рассеянное скопление',
	Nebula: 'Туманность',
	'Supernova Remnant': 'Остаток сверхновой',
	'Star Cloud': 'Звёздное облако',
	'Double Star': 'Двойная звезда'
};

/** A kind of object as the catalogue names it, or in Russian. */
export function kindName(kind: string, language: Language = DEFAULT_LANGUAGE): string {
	return language === 'ru' ? (KIND_NAMES_RU[kind] ?? kind) : kind;
}

/** A named star is the catalogue's star within this of its place, degrees. */
const NAME_REACH_DEG = 0.4;

/**
 * The name of the star at (`raRad`, `decRad`), in English or Russian, or null when
 * it has none here. Two catalogue stars may be within reach of one name (a close
 * pair): the caller gives it to the brighter, which it meets first, and passes
 * `taken` to keep it from the other.
 */
export function starName(
	raRad: number,
	decRad: number,
	taken: Set<string>,
	language: Language = DEFAULT_LANGUAGE
): string | null {
	const reach = Math.cos((NAME_REACH_DEG * Math.PI) / 180);
	const sinDec = Math.sin(decRad);
	const cosDec = Math.cos(decRad);
	for (const [name, russian, raHours, decDeg] of NAMED_STARS) {
		if (taken.has(name)) continue;
		const ra = (raHours * Math.PI) / 12;
		const dec = (decDeg * Math.PI) / 180;
		// The cosine of the angle between the two places.
		const near = sinDec * Math.sin(dec) + cosDec * Math.cos(dec) * Math.cos(raRad - ra);
		if (near >= reach) {
			taken.add(name);
			return language === 'ru' ? russian : name;
		}
	}
	return null;
}
