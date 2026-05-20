mod constellation;
mod messier;
mod star;

use crate::models::{RenderConfig, LayersConfig, StyleConfig, QuestionResponse, DrawStar};
use crate::svg_generator::{SvgGenerator, get_constellations_data, localize_constellation};
use anyhow::{anyhow, bail, Result};
use rust_core::catalog::{HipCatalog, MessierCatalog};
use rand::{seq::SliceRandom, Rng};
use std::collections::{HashMap, HashSet};
use serde::{Deserialize, Serialize};

// Константы сложности из Python-версии
pub static DIFFICULTY_MAGNITUDE: &[(&str, f32)] = &[
    ("easy", 4.0),
    ("medium", 5.5),
    ("hard", 6.5),
];

pub static EASY_CONSTELLATIONS: &[&str] = &[
    "ORI", "UMA", "CAS", "CYG", "LEO", "SCO", "GEM", "TAU", "AQL", "LYR", 
    "PER", "AUR", "VIR", "SGR", "AND", "BOO", "HER", "DRA", "CRU", "UMI"
];

pub static MEDIUM_CONSTELLATIONS: &[&str] = &[
    "AND", "AQL", "AQR", "ARI", "AUR", "BOO", "CAM", "CAP", "CAS", "CEP", 
    "CET", "CMA", "CMI", "CNC", "COL", "COM", "COR", "CRA", "CRB", "CRU", 
    "CRV", "CRT", "CVN", "CYG", "DEL", "DRA", "EQU", "ERI", "GEM", "GRU", 
    "HER", "HYA", "LEO", "LIB", "LYR", "OPH", "ORI", "PEG", "PER", "PSC", 
    "SCO", "SCT", "SER", "SGR", "TAU", "TRI", "UMA", "UMI", "VIR", "VUL", "SAG"
];

// Факты о созвездиях
pub static CONSTELLATION_FACTS: &[(&str, &str)] = &[
    ("ORI", "В Орионе есть две звезды первой величины: красный сверхгигант Бетельгейзе и голубой сверхгигант Ригель."),
    ("UMA", "Большая Медведица включает Большой Ковш — самый известный астеризм северного неба."),
    ("CAS", "Кассиопея похожа на W или M и для средних широт обычно циркумполярна, то есть не заходит за горизонт."),
    ("CYG", "В Лебеде находится Денеб — очень яркая и при этом далёкая звезда, входящая в Летний треугольник."),
    ("LEO", "Лев — зодиакальное созвездие; здесь расположена галактика M66 из триплета Льва."),
    ("SCO", "Скорпион легко узнать по Антаресу: это красный сверхгигант, настолько большой, что «поместил бы» орбиту Марса."),
    ("GEM", "Близнецы названы в честь Кастора и Поллукса — мифологических братьев, связанных с двумя яркими звёздами созвездия."),
    ("TAU", "В Тельце находится M1 (Крабовидная туманность) — остаток сверхновой, наблюдавшейся в 1054 году."),
    ("AQL", "В Орле находится Альтаир — одна из трёх звёзд Летнего треугольника и заметный ориентир летнего неба."),
    ("LYR", "Лира содержит Вегу — 5‑ю по яркости звезду неба; около 12 000 лет назад она была близка к северному полюсу мира."),
    ("PER", "В Персее находится Алголь («Демонская звезда») — яркая затменно‑переменная звезда с заметными падениями блеска."),
    ("AUR", "В Возничем светит Капелла — 6‑я по яркости звезда неба; это не одиночная звезда, а многокомпонентная система."),
    ("VIR", "Дева — крупнейшее зодиакальное созвездие; в этой области неба расположено Скопление Девы из ~1300 галактик."),
    ("SGR", "Стрелец направлен в сторону центра Млечного Пути; в нём находится более 15 объектов каталога Мессье."),
    ("AND", "В Андромеде находится M31 — ближайшая к нам крупная галактика, которую в хороших условиях видно невооружённым глазом."),
    ("BOO", "В Волопасе сияет Арктур — ярчайшая звезда северного полушария и один из главных ориентиров весеннего неба."),
    ("HER", "В Геркулесе находится M13 — Великое шаровое скопление, одно из самых эффектных объектов для небольшого телескопа."),
    ("DRA", "Дракон окружает Малую Медведицу; около 5000 лет назад Тубан был звездой‑полюсом, близкой к северному полюсу мира."),
    ("CRU", "Южный Крест — самое маленькое по площади созвездие и важный ориентир для навигации в южном полушарии."),
    ("UMI", "В Малой Медведице находится Полярная звезда — примерно в 430 световых годах от нас и рядом с северным полюсом мира."),
];

// Факты о звездах
pub static STAR_FACTS: &[(&str, &str)] = &[
    ("Sirius", "Сириус — самая яркая звезда ночного неба (−1,46m); это двойная система на расстоянии 8,6 световых лет."),
    ("Vega", "Вега — одна из вершин Летнего треугольника; около 14 000 лет назад она была Полярной звездой."),
    ("Arcturus", "Арктур — ярчайшая звезда северного полушария; красный гигант примерно в 37 световых годах от нас."),
    ("Capella", "Капелла — сложная система: два ярких компонента‑гиганта и ещё пара тусклых звёзд меньшей массы."),
    ("Rigel", "Ригель — голубой сверхгигант; его светимость оценивают примерно в 120 000 раз выше солнечной."),
    ("Procyon", "Процион — двойная система: яркий субгигант и белый карлик; расстояние около 11,5 световых лет."),
    ("Betelgeuse", "Бетельгейзе — красный сверхгигант на поздней стадии эволюции; его диаметр больше орбиты Юпитера."),
    ("Altair", "Альтаир вращается очень быстро (286 км/с), поэтому заметно сплюснут у экватора — примерно на 20%."),
    ("Aldebaran", "Альдебаран — оранжевый гигант, «глаз» Тельца; находится примерно в 65 световых годах от Земли."),
    ("Spica", "Спика — ярчайшая звезда Девы и тесная двойная система; обе звезды деформированы из‑за значительных приливных сил."),
    ("Antares", "Антарес — «соперник Марса»; красный сверхгигант диаметром примерно ~700 солнечных."),
    ("Pollux", "Поллукс — ярчайшая звезда Близнецов; у неё известна экзопланета Поллукс b."),
    ("Deneb", "Денеб — один из самых далёких ярких объектов неба: около ~2600 световых лет и светимость 200 000 Солнц."),
    ("Regulus", "Регул — «сердце Льва»; это быстро вращающаяся звезда, почти достигшая критической скорости распада."),
    ("Polaris", "Полярная звезда находится примерно в 0.7° от полюса мира и медленно приближается к нему из‑за прецессии."),
    ("Canopus", "Канопус — 2‑я по яркости звезда неба; голубовато‑белый сверхгигант примерно в 310 световых годах."),
    ("Rigil Centaurus", "Альфа Центавра — ближайшая к нам звёздная система (4,37 св. лет); это тройная звезда."),
    ("Acrux", "Акрукс — ярчайшая звезда Южного Креста; голубой гигант примерно в 320 световых годах от нас."),
    ("Denebola", "Денебола — «хвост Льва»; белая звезда главной последовательности умеренно высокой температуры."),
    ("Castor", "Кастор — шестикратная звёздная система: три пары, которые вращаются вокруг общего центра масс."),
    ("Mizar", "Мицар — первая двойная звезда, обнаруженная в телескоп (1617 г.); рядом заметен Алькор как визуальный компаньон."),
];

// Факты об объектах Мессье
pub static MESSIER_FACTS: &[(i32, &str)] = &[
    (1, "M1 (Крабовидная туманность) — остаток сверхновой 1054 года; в центре находится нейтронная звезда‑пульсар."),
    (31, "M31 (Туманность Андромеды) — ближайшая крупная галактика; через ~4 млрд лет она сольётся с Млечным Путём."),
    (42, "M42 (Туманность Ориона) — активная область звездообразования примерно в 1344 световых годах."),
    (45, "M45 (Плеяды) — молодое рассеянное скопление; большинство звёзд образовалось около ~100 млн лет назад."),
    (13, "M13 — Великое шаровое скопление Геркулеса: около 300 000 звёзд на расстоянии 22 200 световых лет."),
    (51, "M51 (Галактика Водоворот) — первая галактика, у которой заметили спиральную структуру (1845 г.)."),
    (57, "M57 (Кольцо Лиры) — планетарная туманность: умирающая звезда сбросила оболочку, и газ светится вокруг ядра."),
    (27, "M27 (Гантель) — первая открытая планетарная туманность (Мессье, 1764)."),
    (8, "M8 (Лагуна) — один из немногих объектов Мессье, которые можно увидеть невооружённым глазом."),
];

// Тривиа-вопросы
pub struct TriviaQuestion {
    pub question: &'static str,
    pub answer: &'static str,
    pub hint: &'static str,
}

pub static TRIVIA_QUESTIONS: &[TriviaQuestion] = &[
    TriviaQuestion {
        question: "Созвездие с Бетельгейзе и Ригелем; здесь находится M42 — Туманность Ориона, яркая область звездообразования.",
        answer: "ORI",
        hint: "Пояс из трёх звёзд, хорошо виден зимой",
    },
    TriviaQuestion {
        question: "Созвездие с «Большим Ковшом» из семи ярких звёзд; две крайние звезды на ковше указывают направление на Полярную.",
        answer: "UMA",
        hint: "Медведица с длинным хвостом",
    },
    TriviaQuestion {
        question: "Созвездие Летнего треугольника, где находится Вега — пятая по яркости звезда ночного неба.",
        answer: "LYR",
        hint: "Музыкальный инструмент",
    },
    TriviaQuestion {
        question: "Созвездие‑«W», которое в северных широтах обычно не заходит за горизонт. Названо в честь эфиопской царицы.",
        answer: "CAS",
        hint: "Гордая царица",
    },
    TriviaQuestion {
        question: "В этом зодиакальном созвездии находится Антарес — «соперник Марса», одна из самых красных ярких звёзд.",
        answer: "SCO",
        hint: "Ядовитое членистоногое",
    },
    TriviaQuestion {
        question: "Созвездие, где находится Альтаир — один из самых быстро вращающихся ярких объектов на небе.",
        answer: "AQL",
        hint: "Гордая птица-символ США",
    },
    TriviaQuestion {
        question: "Ближайшая крупная галактика M31 находится в этом созвездии; осенью её можно увидеть невооружённым глазом.",
        answer: "AND",
        hint: "Принцесса, прикованная к скале",
    },
    TriviaQuestion {
        question: "Созвездие с большим числом объектов Мессье; оно направлено примерно в сторону центра Млечного Пути.",
        answer: "SGR",
        hint: "Полуконь-получеловек с луком",
    },
    TriviaQuestion {
        question: "Созвездие с Арктуром — ярчайшей звездой северного полушария; его фигуру часто сравнивают с «воздушным змеем».",
        answer: "BOO",
        hint: "Пастух",
    },
    TriviaQuestion {
        question: "Созвездие, где находится Денеб — один из самых далёких ярких объектов, видимых невооружённым глазом.",
        answer: "CYG",
        hint: "Белая водоплавающая птица",
    },
];

// Именные звезды (HIP ID -> English name)
pub static NAMED_STARS: &[(i32, &str)] = &[
    (32349, "Sirius"), (91262, "Vega"), (69673, "Arcturus"), (37279, "Procyon"), 
    (24436, "Rigel"), (27989, "Betelgeuse"), (30438, "Canopus"), (24608, "Capella"), 
    (97649, "Altair"), (102098, "Deneb"), (80763, "Antares"), (65474, "Spica"), 
    (49669, "Regulus"), (11767, "Polaris"), (21421, "Aldebaran"), (677, "Alpheratz"), 
    (25336, "Bellatrix"), (36850, "Castor"), (37826, "Pollux"), (57632, "Denebola"), 
    (54061, "Dubhe"), (53910, "Merak"), (65378, "Mizar"), (3179, "Schedar"), 
    (746, "Caph"), (6686, "Ruchbah"), (5447, "Mirach"), (113881, "Scheat"), 
    (113963, "Markab"), (68702, "Hadar"), (71683, "Rigil Centaurus"), (60718, "Acrux"), 
    (87833, "Eltanin"), (92420, "Sheliak"), (93194, "Sulafat"), (84345, "Rasalgethi"), 
    (80816, "Kornephoros"), (77070, "Unukalhai"), (72622, "Zubenelgenubi"), 
    (74785, "Zubeneschamali"), (85670, "Rastaban"), (75097, "Pherkad"), (72105, "Izar"), 
    (68756, "Thuban"), (95947, "Albireo"), (100453, "Sadr"), (105199, "Alderamin"), 
    (84012, "Sabik"), (86228, "Sargas"), (78820, "Acrab"), (85696, "Lesath"), 
    (81266, "Alniyat II"), (85927, "Shaula"), (92855, "Nunki"), (14135, "Menkar"), 
    (10826, "Mira"), (20205, "Aldebaran"),
];

// Словарь русских имен звезд
pub static STAR_NAMES_RU: &[(&str, &str)] = &[
    ("Sirius", "Сириус"), ("Vega", "Вега"), ("Arcturus", "Арктур"), ("Procyon", "Процион"),
    ("Rigel", "Ригель"), ("Betelgeuse", "Бетельгейзе"), ("Canopus", "Канопус"), ("Capella", "Капелла"),
    ("Altair", "Альтаир"), ("Deneb", "Денеб"), ("Antares", "Антарес"), ("Spica", "Спика"),
    ("Regulus", "Регул"), ("Polaris", "Полярная звезда"), ("Aldebaran", "Альдебаран"),
    ("Alpheratz", "Альферац"), ("Bellatrix", "Беллатрикс"), ("Castor", "Кастор"), ("Pollux", "Поллукс"),
    ("Denebola", "Дenebola"), ("Dubhe", "Дубхе"), ("Merak", "Мерак"), ("Mizar", "Мицар"),
    ("Schedar", "Шедар"), ("Caph", "Каф"), ("Ruchbah", "Рухба"), ("Mirach", "Мирах"),
    ("Scheat", "Шеат"), ("Markab", "Маркаб"), ("Hadar", "Хадар"), ("Rigil Centaurus", "Ригель Кентавра"),
    ("Acrux", "Акрукс"), ("Eltanin", "Этамин"), ("Sheliak", "Шелиак"), ("Sulafat", "Сулафат"),
    ("Rasalgethi", "Расальгети"), ("Kornephoros", "Корнефорос"), ("Unukalhai", "Унукальхай"),
    ("Zubenelgenubi", "Зубен эль-Генуби"), ("Zubeneschamali", "Зубен эш-Шамали"),
    ("Rastaban", "Растабан"), ("Pherkad", "Феркад"), ("Izar", "Изар"), ("Thuban", "Тубан"),
    ("Albireo", "Альбирео"), ("Sadr", "Садр"), ("Alderamin", "Альдерамин"), ("Sabik", "Сабик"),
    ("Sargas", "Саргас"), ("Acrab", "Акраб"), ("Lesath", "Лесат"), ("Alniyat II", "Альнят II"),
    ("Shaula", "Шаула"), ("Nunki", "Нунки"), ("Menkar", "Menkar"), ("Mira", "Мира"),
];

pub fn localize_star(name_en: &str) -> String {
    for &(en, ru) in STAR_NAMES_RU {
        if en == name_en {
            return ru.to_string();
        }
    }
    name_en.to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuestionData {
    pub question_type: String,
    pub question_text: String,
    pub options: Option<Vec<String>>,
    pub correct_answer: String,
    pub hint: String,
    pub fun_fact: String,
    pub hint_used: bool,
    // Внутреннее состояние для верификации
    pub correct_abbr: Option<String>,
    pub correct_hip: Option<i32>,
    pub correct_ra_deg: Option<f32>,
    pub correct_dec_deg: Option<f32>,
    pub correct_m_num: Option<i32>,
    // Для режима Draw
    pub ref_edges: Option<Vec<Vec<i32>>>,
    pub predrawn_edges: Option<Vec<Vec<i32>>>,
    // Использованные объекты в JSON
    pub used_objects: HashSet<String>,
}

pub struct QuestionFactory;

impl QuestionFactory {
    // Вспомогательная функция получения списка созвездий по сложности
    pub(super) fn get_constellations_pool(difficulty: &str) -> Vec<String> {
        let pool = match difficulty {
            "easy" => EASY_CONSTELLATIONS.iter().map(|&s| s.to_string()).collect::<Vec<_>>(),
            "medium" => MEDIUM_CONSTELLATIONS.iter().map(|&s| s.to_string()).collect::<Vec<_>>(),
            _ => get_constellations_data().keys().cloned().collect::<Vec<_>>(),
        };
        // Фильтруем те, которые реально есть в constellations_data.json
        let available = get_constellations_data();
        pool.into_iter().filter(|c| available.contains_key(c)).collect()
    }

    pub(super) fn get_magnitude_limit(difficulty: &str) -> f32 {
        for &(diff, val) in DIFFICULTY_MAGNITUDE {
            if diff == difficulty {
                return val;
            }
        }
        5.5
    }

    pub fn make_question(
        mode: &str,
        difficulty: &str,
        used_objects: &mut HashSet<String>,
        hip_catalog: &HipCatalog,
        messier_catalog: &MessierCatalog,
    ) -> Result<(QuestionResponse, QuestionData)> {
        let mut rng = rand::thread_rng();

        match mode {
            "constellation" => constellation::generate(difficulty, used_objects, hip_catalog, messier_catalog),
            "star" => star::generate(difficulty, used_objects, hip_catalog, messier_catalog),
            "messier" => messier::generate(difficulty, used_objects, hip_catalog, messier_catalog),
            "draw" => {
                let pool = Self::get_constellations_pool(difficulty);
                let mut available: Vec<String> = pool.iter()
                    .filter(|c| !used_objects.contains(*c))
                    .cloned()
                    .collect();

                if available.is_empty() {
                    used_objects.clear();
                    available = pool.clone();
                }

                let correct_abbr = available.choose(&mut rng).cloned().unwrap_or_else(|| "ORI".to_string());
                used_objects.insert(correct_abbr.clone());

                let const_json = get_constellations_data()
                    .get(&correct_abbr)
                    .ok_or_else(|| anyhow!("constellation '{}' not found in embedded data", correct_abbr))?;
                let constellation_name = localize_constellation(&correct_abbr, &const_json.name);

                let center = [const_json.center[0] as f64, const_json.center[1] as f64, const_json.center[2] as f64];
                let ref_lines = &const_json.lines;

                let mut const_hip_ids = HashSet::new();
                for line in ref_lines {
                    for &hip in line {
                        const_hip_ids.insert(hip);
                    }
                }

                // Загрузим звезды
                let mag_limit = Self::get_magnitude_limit(difficulty);
                let bg_mag = (mag_limit + 1.0).min(6.5);
                let all_stars = hip_catalog.get_stars(bg_mag, None);

                // Гномоническая проекция
                let z = [center[0], center[1], center[2]];
                let z_norm = (z[0].powi(2) + z[1].powi(2) + z[2].powi(2)).sqrt();
                let z_axis = [z[0]/z_norm, z[1]/z_norm, z[2]/z_norm];

                let arb = if z_axis[2].abs() < 0.9 { [0.0, 0.0, 1.0] } else { [1.0, 0.0, 0.0] };

                // x_axis: cross(arb, z_axis)
                let mut x_ax = [
                    arb[1] * z_axis[2] - arb[2] * z_axis[1],
                    arb[2] * z_axis[0] - arb[0] * z_axis[2],
                    arb[0] * z_axis[1] - arb[1] * z_axis[0]
                ];
                let x_norm = (x_ax[0].powi(2) + x_ax[1].powi(2) + x_ax[2].powi(2)).sqrt();
                x_ax = [x_ax[0] / x_norm, x_ax[1] / x_norm, x_ax[2] / x_norm];

                // y_axis: cross(z_axis, x_axis)
                let y_ax = [
                    z_axis[1] * x_ax[2] - z_axis[2] * x_ax[1],
                    z_axis[2] * x_ax[0] - z_axis[0] * x_ax[2],
                    z_axis[0] * x_ax[1] - z_axis[1] * x_ax[0]
                ];

                // Проецируем звезды созвездия
                let mut const_projected = HashMap::new();
                for star in &all_stars {
                    if const_hip_ids.contains(&star.hip_id) {
                        let d = [star.x as f64, star.y as f64, star.z as f64];
                        let cos_t = d[0] * z_axis[0] + d[1] * z_axis[1] + d[2] * z_axis[2];
                        if cos_t < 0.05 { continue; }
                        let px = (d[0] * x_ax[0] + d[1] * x_ax[1] + d[2] * x_ax[2]) / cos_t;
                        let py = (d[0] * y_ax[0] + d[1] * y_ax[1] + d[2] * y_ax[2]) / cos_t;
                        const_projected.insert(star.hip_id, (px, py, star.v_mag));
                    }
                }

                // Если спроецировалось меньше 2 звезд созвездия, перезапускаем рекурсивно
                if const_projected.len() < 2 {
                    used_objects.remove(&correct_abbr);
                    return Self::make_question(mode, difficulty, used_objects, hip_catalog, messier_catalog);
                }

                // Проецируем фоновые звезды
                let mut bg_projected = HashMap::new();
                for star in &all_stars {
                    if const_hip_ids.contains(&star.hip_id) { continue; }
                    let d = [star.x as f64, star.y as f64, star.z as f64];
                    let cos_t = d[0] * z_axis[0] + d[1] * z_axis[1] + d[2] * z_axis[2];
                    if cos_t < 0.7 { continue; }
                    let px = (d[0] * x_ax[0] + d[1] * x_ax[1] + d[2] * x_ax[2]) / cos_t;
                    let py = (d[0] * y_ax[0] + d[1] * y_ax[1] + d[2] * y_ax[2]) / cos_t;
                    bg_projected.insert(star.hip_id, (px, py, star.v_mag));
                }

                // Определяем максимальный радиус созвездия для нормировки к [-1.0, 1.0]
                let mut max_r = 1e-9;
                for &(px, py, _) in const_projected.values() {
                    let r = px.abs().max(py.abs());
                    if r > max_r { max_r = r; }
                }
                max_r *= 1.2;

                let mut stars_list = vec![];
                let named_map: HashMap<i32, &str> = NAMED_STARS.iter().cloned().collect();

                for (&hip_id, &(px, py, mag)) in &const_projected {
                    let _name = named_map.get(&hip_id).map(|s| localize_star(s)).unwrap_or_default();
                    stars_list.push(DrawStar {
                        id: hip_id,
                        x: (px / max_r) as f32,
                        y: (py / max_r) as f32,
                        r: (mag_limit + 1.0 - mag).max(0.5) * 1.5, // пропорционально звездной величине
                        is_contour: true,
                    });
                }

                for (&hip_id, &(px, py, mag)) in &bg_projected {
                    let nx = px / max_r;
                    let ny = py / max_r;
                    if nx.abs() > 1.4 || ny.abs() > 1.4 { continue; }
                    stars_list.push(DrawStar {
                        id: hip_id,
                        x: nx as f32,
                        y: ny as f32,
                        r: (mag_limit + 1.0 - mag).max(0.5) * 1.5,
                        is_contour: false,
                    });
                }

                let mut ref_edges = vec![];
                for line in ref_lines {
                    for i in 0..(line.len() - 1) {
                        let id1 = line[i];
                        let id2 = line[i+1];
                        if const_projected.contains_key(&id1) && const_projected.contains_key(&id2) {
                            ref_edges.push(vec![id1, id2]);
                        }
                    }
                }

                // Сложность: Easy - 25% ребер уже нарисовано, нет поворота. Hard - ребер нет, случайный 2D-поворот
                let mut predrawn_edges = vec![];
                let tilt_deg: f32 = if difficulty == "easy" {
                    let n_pre = ((ref_edges.len() as f32) * 0.25).floor() as usize;
                    if n_pre > 0 {
                        let mut temp = ref_edges.clone();
                        temp.shuffle(&mut rng);
                        predrawn_edges.extend(temp.into_iter().take(n_pre));
                    }
                    0.0
                } else if difficulty == "medium" {
                    0.0
                } else {
                    rng.gen_range(0.0..360.0)
                };

                // Применяем 2D-поворот
                if tilt_deg != 0.0 {
                    let rad = tilt_deg.to_radians();
                    let cos_a = rad.cos();
                    let sin_a = rad.sin();
                    for star in &mut stars_list {
                        let x = star.x;
                        let y = star.y;
                        star.x = cos_a * x - sin_a * y;
                        star.y = sin_a * x + cos_a * y;
                    }
                }

                let fact = CONSTELLATION_FACTS.iter()
                    .find(|&&(abbr, _)| abbr == correct_abbr)
                    .map(|&(_, f)| f.to_string())
                    .unwrap_or_else(|| format!("Созвездие {}.", constellation_name));

                let correct_answer = constellation_name;
                let hint = format!("В рисунке этого созвездия {} линий", ref_edges.len());

                let q_data = QuestionData {
                    question_type: "draw".to_string(),
                    question_text: "Соедините звёзды созвездия линиями так, как они соединены на официальных картах.".to_string(),
                    options: None,
                    correct_answer,
                    hint,
                    fun_fact: fact,
                    hint_used: false,
                    correct_abbr: Some(correct_abbr),
                    correct_hip: None,
                    correct_ra_deg: None,
                    correct_dec_deg: None,
                    correct_m_num: None,
                    ref_edges: Some(ref_edges),
                    predrawn_edges: Some(predrawn_edges),
                    used_objects: std::mem::take(used_objects),
                };

                let q_resp = QuestionResponse {
                    session_id: "".to_string(),
                    current_round: 1,
                    total_rounds: 10,
                    question_type: "draw".to_string(),
                    question_text: "Соедините звёзды созвездия линиями так, как они соединены на официальных картах.".to_string(),
                    options: None,
                    image_svg: None, // в Draw режиме рендерим на Canvas
                    draw_stars: Some(stars_list),
                    has_hint: true,
                };

                Ok((q_resp, q_data))
            }
            "trivia" => {
                let pool = Self::get_constellations_pool(difficulty);
                let pool_set: HashSet<String> = pool.iter().cloned().collect();

                let mut available_trivia: Vec<&TriviaQuestion> = TRIVIA_QUESTIONS.iter()
                    .filter(|q| pool_set.contains(q.answer) && !used_objects.contains(q.answer))
                    .collect();

                if available_trivia.is_empty() {
                    used_objects.clear();
                    available_trivia = TRIVIA_QUESTIONS.iter()
                        .filter(|q| pool_set.contains(q.answer))
                        .collect();
                }

                if available_trivia.is_empty() {
                    available_trivia = TRIVIA_QUESTIONS.iter().collect();
                }

                let trivia = available_trivia
                    .choose(&mut rng)
                    .cloned()
                    .ok_or_else(|| anyhow!("available pool is empty for trivia"))?;
                let correct_abbr = trivia.answer.to_string();
                used_objects.insert(correct_abbr.clone());

                let const_json = get_constellations_data()
                    .get(&correct_abbr)
                    .ok_or_else(|| anyhow!("constellation '{}' not found in embedded data", correct_abbr))?;
                let correct_name = localize_constellation(&correct_abbr, &const_json.name);

                let mut distractors = pool.iter()
                    .filter(|c| **c != correct_abbr)
                    .cloned()
                    .collect::<Vec<_>>();
                distractors.shuffle(&mut rng);
                let selected_distractors = &distractors[..3.min(distractors.len())];

                let mut options = vec![correct_name.clone()];
                for d in selected_distractors {
                    let d_json = get_constellations_data()
                        .get(d)
                        .ok_or_else(|| anyhow!("constellation '{}' not found in embedded data", d))?;
                    options.push(localize_constellation(d, &d_json.name));
                }
                options.shuffle(&mut rng);

                // Рендерим красивое вращающееся звездное небо
                let mag_limit = Self::get_magnitude_limit(difficulty);
                let tilt_angle = Some(rng.gen_range(0.0..360.0));

                let config = RenderConfig {
                    projection: "pinhole".to_string(),
                    datetime: None,
                    latitude: 45.0,
                    longitude: 19.0,
                    magnitude_limit: Some(mag_limit),
                    fov_deg: Some(110.0), // широкий угол
                    aspect_ratio: Some(1.0),
                    constellation: Some(correct_abbr.clone()),
                    center_direction: None,
                    tilt_angle,
                    layers: LayersConfig {
                        ecliptic: false,
                        equator: false,
                        galactic_equator: false,
                        planets: false,
                        horizontal_grid: false,
                        equatorial_grid: false,
                        constellations: true,
                        constellation_names: false,
                        zenith: false,
                        poles: false,
                    },
                    style: StyleConfig {
                        star_color: "#FFFFFF".to_string(),
                        constellation_line_color: "#808080".to_string(),
                        grid_color: "#404040".to_string(),
                        background_color: "#05050A".to_string(),
                        font_family: "sans-serif".to_string(),
                        magnitude_scale: 1.0,
                    },
                    print_info: Some(false),
                    footer_text: None,
                };

                let image_svg = SvgGenerator::render_map(&config, hip_catalog, messier_catalog, None, None);

                let fact = CONSTELLATION_FACTS.iter()
                    .find(|&&(abbr, _)| abbr == correct_abbr)
                    .map(|&(_, f)| f.to_string())
                    .unwrap_or_else(|| format!("Созвездие {}.", correct_name));

                let correct_answer = correct_name;

                let q_data = QuestionData {
                    question_type: "trivia".to_string(),
                    question_text: trivia.question.to_string(),
                    options: Some(options.clone()),
                    correct_answer,
                    hint: trivia.hint.to_string(),
                    fun_fact: fact,
                    hint_used: false,
                    correct_abbr: Some(correct_abbr),
                    correct_hip: None,
                    correct_ra_deg: None,
                    correct_dec_deg: None,
                    correct_m_num: None,
                    ref_edges: None,
                    predrawn_edges: None,
                    used_objects: std::mem::take(used_objects),
                };

                let q_resp = QuestionResponse {
                    session_id: "".to_string(),
                    current_round: 1,
                    total_rounds: 10,
                    question_type: "trivia".to_string(),
                    question_text: trivia.question.to_string(),
                    options: Some(options),
                    image_svg: Some(image_svg),
                    draw_stars: None,
                    has_hint: true,
                };

                Ok((q_resp, q_data))
            }
            _ => bail!("unknown game mode: {mode}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::QuestionFactory;
    use rust_core::catalog::{HipCatalog, MessierCatalog};
    use std::collections::HashSet;

    #[test]
    fn test_make_question_unknown_mode_returns_error() {
        let mut used = HashSet::new();
        let hip_catalog = HipCatalog::new();
        let messier_catalog = MessierCatalog::new();

        let result = QuestionFactory::make_question(
            "definitely_not_a_real_mode",
            "easy",
            &mut used,
            &hip_catalog,
            &messier_catalog,
        );

        assert!(result.is_err(), "unknown mode should return Err, got: {result:?}");
    }
}
