/**
 * Names a table gives to what it lists: the constellations in full, and the proper
 * names of the bright stars, which the star catalogue (Hipparcos) does not carry.
 */

/** The 88 constellations by their IAU abbreviation. */
export const CONSTELLATION_NAMES: Record<string, string> = {
	And: 'Andromeda',
	Ant: 'Antlia',
	Aps: 'Apus',
	Aqr: 'Aquarius',
	Aql: 'Aquila',
	Ara: 'Ara',
	Ari: 'Aries',
	Aur: 'Auriga',
	Boo: 'Boötes',
	Cae: 'Caelum',
	Cam: 'Camelopardalis',
	Cnc: 'Cancer',
	CVn: 'Canes Venatici',
	CMa: 'Canis Major',
	CMi: 'Canis Minor',
	Cap: 'Capricornus',
	Car: 'Carina',
	Cas: 'Cassiopeia',
	Cen: 'Centaurus',
	Cep: 'Cepheus',
	Cet: 'Cetus',
	Cha: 'Chamaeleon',
	Cir: 'Circinus',
	Col: 'Columba',
	Com: 'Coma Berenices',
	CrA: 'Corona Australis',
	CrB: 'Corona Borealis',
	Crv: 'Corvus',
	Crt: 'Crater',
	Cru: 'Crux',
	Cyg: 'Cygnus',
	Del: 'Delphinus',
	Dor: 'Dorado',
	Dra: 'Draco',
	Equ: 'Equuleus',
	Eri: 'Eridanus',
	For: 'Fornax',
	Gem: 'Gemini',
	Gru: 'Grus',
	Her: 'Hercules',
	Hor: 'Horologium',
	Hya: 'Hydra',
	Hyi: 'Hydrus',
	Ind: 'Indus',
	Lac: 'Lacerta',
	Leo: 'Leo',
	LMi: 'Leo Minor',
	Lep: 'Lepus',
	Lib: 'Libra',
	Lup: 'Lupus',
	Lyn: 'Lynx',
	Lyr: 'Lyra',
	Men: 'Mensa',
	Mic: 'Microscopium',
	Mon: 'Monoceros',
	Mus: 'Musca',
	Nor: 'Norma',
	Oct: 'Octans',
	Oph: 'Ophiuchus',
	Ori: 'Orion',
	Pav: 'Pavo',
	Peg: 'Pegasus',
	Per: 'Perseus',
	Phe: 'Phoenix',
	Pic: 'Pictor',
	Psc: 'Pisces',
	PsA: 'Piscis Austrinus',
	Pup: 'Puppis',
	Pyx: 'Pyxis',
	Ret: 'Reticulum',
	Sge: 'Sagitta',
	Sgr: 'Sagittarius',
	Sco: 'Scorpius',
	Scl: 'Sculptor',
	Sct: 'Scutum',
	Ser: 'Serpens',
	Sex: 'Sextans',
	Tau: 'Taurus',
	Tel: 'Telescopium',
	Tri: 'Triangulum',
	TrA: 'Triangulum Australe',
	Tuc: 'Tucana',
	UMa: 'Ursa Major',
	UMi: 'Ursa Minor',
	Vel: 'Vela',
	Vir: 'Virgo',
	Vol: 'Volans',
	Vul: 'Vulpecula'
};

/** The same 88 in Russian. */
export const CONSTELLATION_NAMES_RU: Record<string, string> = {
	And: 'Андромеда',
	Ant: 'Насос',
	Aps: 'Райская Птица',
	Aqr: 'Водолей',
	Aql: 'Орёл',
	Ara: 'Жертвенник',
	Ari: 'Овен',
	Aur: 'Возничий',
	Boo: 'Волопас',
	Cae: 'Резец',
	Cam: 'Жираф',
	Cnc: 'Рак',
	CVn: 'Гончие Псы',
	CMa: 'Большой Пёс',
	CMi: 'Малый Пёс',
	Cap: 'Козерог',
	Car: 'Киль',
	Cas: 'Кассиопея',
	Cen: 'Центавр',
	Cep: 'Цефей',
	Cet: 'Кит',
	Cha: 'Хамелеон',
	Cir: 'Циркуль',
	Col: 'Голубь',
	Com: 'Волосы Вероники',
	CrA: 'Южная Корона',
	CrB: 'Северная Корона',
	Crv: 'Ворон',
	Crt: 'Чаша',
	Cru: 'Южный Крест',
	Cyg: 'Лебедь',
	Del: 'Дельфин',
	Dor: 'Золотая Рыба',
	Dra: 'Дракон',
	Equ: 'Малый Конь',
	Eri: 'Эридан',
	For: 'Печь',
	Gem: 'Близнецы',
	Gru: 'Журавль',
	Her: 'Геркулес',
	Hor: 'Часы',
	Hya: 'Гидра',
	Hyi: 'Южная Гидра',
	Ind: 'Индеец',
	Lac: 'Ящерица',
	Leo: 'Лев',
	LMi: 'Малый Лев',
	Lep: 'Заяц',
	Lib: 'Весы',
	Lup: 'Волк',
	Lyn: 'Рысь',
	Lyr: 'Лира',
	Men: 'Столовая Гора',
	Mic: 'Микроскоп',
	Mon: 'Единорог',
	Mus: 'Муха',
	Nor: 'Наугольник',
	Oct: 'Октант',
	Oph: 'Змееносец',
	Ori: 'Орион',
	Pav: 'Павлин',
	Peg: 'Пегас',
	Per: 'Персей',
	Phe: 'Феникс',
	Pic: 'Живописец',
	Psc: 'Рыбы',
	PsA: 'Южная Рыба',
	Pup: 'Корма',
	Pyx: 'Компас',
	Ret: 'Сетка',
	Sge: 'Стрела',
	Sgr: 'Стрелец',
	Sco: 'Скорпион',
	Scl: 'Скульптор',
	Sct: 'Щит',
	Ser: 'Змея',
	Sex: 'Секстант',
	Tau: 'Телец',
	Tel: 'Телескоп',
	Tri: 'Треугольник',
	TrA: 'Южный Треугольник',
	Tuc: 'Тукан',
	UMa: 'Большая Медведица',
	UMi: 'Малая Медведица',
	Vel: 'Паруса',
	Vir: 'Дева',
	Vol: 'Летучая Рыба',
	Vul: 'Лисичка'
};

/** A constellation in full, in English or Russian; the abbreviation itself when it is not one of the 88. */
export function constellationName(abbreviation: string, language: 'en' | 'ru' = 'en'): string {
	const names = language === 'ru' ? CONSTELLATION_NAMES_RU : CONSTELLATION_NAMES;
	return names[abbreviation] ?? abbreviation;
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
export function kindName(kind: string, language: 'en' | 'ru' = 'en'): string {
	return language === 'ru' ? (KIND_NAMES_RU[kind] ?? kind) : kind;
}

/**
 * The bright stars with a name in common use: the name, right ascension in hours
 * and declination in degrees (J2000, to a few hundredths of a degree: enough to tell
 * which star of the catalogue is meant).
 */
const NAMED_STARS: readonly (readonly [string, number, number])[] = [
	['Sirius', 6.752, -16.716],
	['Canopus', 6.399, -52.696],
	['Rigil Kentaurus', 14.66, -60.834],
	['Arcturus', 14.261, 19.182],
	['Vega', 18.616, 38.784],
	['Capella', 5.278, 45.998],
	['Rigel', 5.242, -8.202],
	['Procyon', 7.655, 5.225],
	['Achernar', 1.629, -57.237],
	['Betelgeuse', 5.919, 7.407],
	['Hadar', 14.064, -60.373],
	['Altair', 19.846, 8.868],
	['Acrux', 12.443, -63.099],
	['Aldebaran', 4.599, 16.509],
	['Antares', 16.49, -26.432],
	['Spica', 13.42, -11.161],
	['Pollux', 7.755, 28.026],
	['Fomalhaut', 22.961, -29.622],
	['Deneb', 20.69, 45.28],
	['Mimosa', 12.795, -59.689],
	['Regulus', 10.14, 11.967],
	['Adhara', 6.977, -28.972],
	['Castor', 7.577, 31.888],
	['Shaula', 17.56, -37.104],
	['Gacrux', 12.519, -57.113],
	['Bellatrix', 5.419, 6.35],
	['Elnath', 5.438, 28.608],
	['Miaplacidus', 9.22, -69.717],
	['Alnilam', 5.604, -1.202],
	['Alnair', 22.137, -46.961],
	['Alnitak', 5.679, -1.943],
	['Alioth', 12.9, 55.96],
	['Dubhe', 11.062, 61.751],
	['Mirfak', 3.405, 49.861],
	['Wezen', 7.14, -26.393],
	['Sargas', 17.622, -42.998],
	['Kaus Australis', 18.403, -34.385],
	['Avior', 8.375, -59.51],
	['Alkaid', 13.792, 49.313],
	['Menkalinan', 5.992, 44.948],
	['Atria', 16.811, -69.028],
	['Alhena', 6.629, 16.399],
	['Peacock', 20.427, -56.735],
	['Mirzam', 6.378, -17.956],
	['Alphard', 9.46, -8.659],
	['Polaris', 2.53, 89.264],
	['Hamal', 2.12, 23.463],
	['Algieba', 10.333, 19.842],
	['Diphda', 0.726, -17.987],
	['Mizar', 13.399, 54.925],
	['Nunki', 18.921, -26.297],
	['Menkent', 14.111, -36.37],
	['Mirach', 1.162, 35.621],
	['Alpheratz', 0.14, 29.091],
	['Rasalhague', 17.582, 12.56],
	['Kochab', 14.845, 74.156],
	['Saiph', 5.796, -9.67],
	['Denebola', 11.818, 14.572],
	['Algol', 3.136, 40.956],
	['Almach', 2.065, 42.33],
	['Alphecca', 15.578, 26.715],
	['Mintaka', 5.533, -0.299],
	['Sadr', 20.37, 40.257],
	['Schedar', 0.675, 56.537],
	['Eltanin', 17.943, 51.489],
	['Caph', 0.153, 59.15],
	['Merak', 11.031, 56.382],
	['Phecda', 11.897, 53.695],
	['Enif', 21.736, 9.875],
	['Scheat', 23.063, 28.083],
	['Markab', 23.079, 15.205],
	['Alderamin', 21.31, 62.586],
	['Albireo', 19.512, 27.96],
	['Unukalhai', 15.738, 6.426],
	['Zubeneschamali', 15.283, -9.383],
	['Vindemiatrix', 13.036, 10.959],
	['Rasalgethi', 17.244, 14.39]
];

/** A named star is the catalogue's star within this of its place, degrees. */
const NAME_REACH_DEG = 0.4;

/**
 * The name of the star at (`raRad`, `decRad`), or null when it has none here. Two
 * catalogue stars may be within reach of one name (a close pair): the caller gives
 * it to the brighter, which it meets first, and passes `taken` to keep it from the
 * other.
 */
export function starName(raRad: number, decRad: number, taken: Set<string>): string | null {
	const reach = Math.cos((NAME_REACH_DEG * Math.PI) / 180);
	const sinDec = Math.sin(decRad);
	const cosDec = Math.cos(decRad);
	for (const [name, raHours, decDeg] of NAMED_STARS) {
		if (taken.has(name)) continue;
		const ra = (raHours * Math.PI) / 12;
		const dec = (decDeg * Math.PI) / 180;
		// The cosine of the angle between the two places.
		const near = sinDec * Math.sin(dec) + cosDec * Math.cos(dec) * Math.cos(raRad - ra);
		if (near >= reach) {
			taken.add(name);
			return name;
		}
	}
	return null;
}
