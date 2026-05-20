use rust_core::{
    DateTime, HipCatalog, MessierCatalog, StereoProjection, PinholeProjection, CameraConfig
};
use std::fs::File;
use std::io::Write;
use std::path::Path;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("Loading catalogs...");
    let hip = HipCatalog::new();
    let messier = MessierCatalog::new();

    // 1. НАСТРОЙКИ СТЕРЕОГРАФИЧЕСКОЙ КАРТЫ (Full-Sky)
    // Наблюдатель в Москве: 55.75° N, 37.62° E
    // Время: 2026-05-20 23:00:00 (майское звездное небо)
    let observer_lat = 55.75f32;
    let observer_lon = 37.62f32;
    let observation_time = DateTime::new(2026, 5, 20, 23, 0, 0);

    println!("Generating Stereographic projection...");
    let mut stereo_svg_stars = String::new();
    let mut stereo_svg_messier = String::new();

    let width = 800.0;
    let height = 800.0;
    let cx = width / 2.0;
    let cy = height / 2.0;
    let scale = 320.0; // Масштаб стереографической проекции

    // Рисуем сетку высот и азимутов (горизонт и концентрические круги)
    let mut grid_svg = String::new();
    // Наш горизонт (zenith = pi/2 = 90 deg -> radius = 2.0 * tan(45 deg) = 2.0 -> в пикселях = 2.0 * scale = 640)
    grid_svg.push_str(&format!(
        r##"<circle cx="{}" cy="{}" r="{}" fill="none" stroke="#222244" stroke-width="1.5" stroke-dasharray="4 4" />"##,
        cx, cy, 2.0 * scale
    ));
    // Зенитные круги на 30 и 60 градусов зенитного расстояния
    for &z_deg in &[30.0f32, 60.0f32] {
        let r = 2.0 * (z_deg.to_radians() / 2.0).tan() * scale;
        grid_svg.push_str(&format!(
            r##"<circle cx="{}" cy="{}" r="{}" fill="none" stroke="#151528" stroke-width="1" />"##,
            cx, cy, r
        ));
    }
    // Линии меридиана и первого вертикала (крест через зенит)
    grid_svg.push_str(&format!(
        r##"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="#151528" stroke-width="1" />"##,
        cx, cy - 2.0 * scale, cx, cy + 2.0 * scale
    ));
    grid_svg.push_str(&format!(
        r##"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="#151528" stroke-width="1" />"##,
        cx - 2.0 * scale, cy, cx + 2.0 * scale, cy
    ));

    // Проецируем звезды
    let stars = hip.get_stars(6.5, None);
    let mut projected_stars_count = 0;
    for star in &stars {
        if let Some(proj) = StereoProjection::project(
            star.x, star.y, star.z,
            observer_lat, observer_lon,
            observation_time
        ) {
            projected_stars_count += 1;
            // Перевод в экранные координаты (y инвертирован)
            let px = cx + proj.x * scale;
            let py = cy - proj.y * scale;

            // Радиус и прозрачность в зависимости от звездной величины
            let r = (6.8 - star.v_mag).max(0.1) * 0.8;
            let opacity = ((6.8 - star.v_mag) / 6.8).clamp(0.2, 1.0);

            stereo_svg_stars.push_str(&format!(
                r##"<circle cx="{:.1}" cy="{:.1}" r="{:.2}" fill="#ffffff" opacity="{:.2}" filter="url(#glow)" />"##,
                px, py, r, opacity
            ));
        }
    }

    // Проецируем объекты Мессье
    let messier_objects = messier.get_all_objects();
    let mut projected_messier_count = 0;
    for obj in &messier_objects {
        if let Some(proj) = StereoProjection::project(
            obj.x, obj.y, obj.z,
            observer_lat, observer_lon,
            observation_time
        ) {
            projected_messier_count += 1;
            let px = cx + proj.x * scale;
            let py = cy - proj.y * scale;

            let color = obj.type_color();
            let label = format!("M{}", obj.m_number);

            stereo_svg_messier.push_str(&format!(
                r##"<g class="messier" data-name="{}" data-type="{}">
                    <circle cx="{:.1}" cy="{:.1}" r="6" fill="none" stroke="{}" stroke-width="1" stroke-dasharray="2 2" />
                    <circle cx="{:.1}" cy="{:.1}" r="1.5" fill="{}" />
                    <text x="{:.1}" y="{:.1}" fill="{}" font-size="8" font-family="'Inter', sans-serif" dx="8" dy="3">{}</text>
                   </g>"##,
                obj.name, obj.type_name(), px, py, color, px, py, color, px, py, color, label
            ));
        }
    }
    println!("Stereographic: Projected {} stars and {} Messier objects.", projected_stars_count, projected_messier_count);


    // 2. НАСТРОЙКИ ПИНХОЛЬНОЙ ПРОЕКЦИИ (Узкое поле зрения, как объектив телескопа)
    // Направим камеру прямо на область созвездия Ориона / Тельца (например, M45 Плеяды или M42 Туманность Ориона)
    // M42: RA = 5h 35m 17s (1.462 рад), DEC = -5° 23' (-0.094 рад)
    // ECI координаты центра M42:
    let m42 = messier.get_object_by_number(42).unwrap();
    let camera_direction = [m42.x as f64, m42.y as f64, m42.z as f64];
    
    // Камера с FOV 40 градусов, квадратный кадр 800x800
    let cam_config = CameraConfig::from_fov_and_aspect(40.0, 1.0, 800);
    let tilt_deg = 15.0; // Поворот камеры вокруг своей оси

    println!("Generating Pinhole projection looking at M42 Orion Nebula...");
    let mut pinhole_svg_stars = String::new();
    let mut pinhole_svg_messier = String::new();

    // Проецируем звезды в пинхоль
    let mut pinhole_stars_count = 0;
    for star in &stars {
        if let Some(proj) = PinholeProjection::project(
            star.x, star.y, star.z,
            camera_direction,
            tilt_deg,
            &cam_config
        ) {
            pinhole_stars_count += 1;
            let r = (6.8 - star.v_mag).max(0.1) * 1.2;
            let opacity = ((6.8 - star.v_mag) / 6.8).clamp(0.3, 1.0);

            pinhole_svg_stars.push_str(&format!(
                r##"<circle cx="{:.1}" cy="{:.1}" r="{:.2}" fill="#ffffff" opacity="{:.2}" filter="url(#glow)" />"##,
                proj.x_pix, proj.y_pix, r, opacity
            ));
        }
    }

    // Проецируем объекты Мессье в пинхоль
    let mut pinhole_messier_count = 0;
    for obj in &messier_objects {
        if let Some(proj) = PinholeProjection::project(
            obj.x, obj.y, obj.z,
            camera_direction,
            tilt_deg,
            &cam_config
        ) {
            pinhole_messier_count += 1;
            let px = proj.x_pix;
            let py = proj.y_pix;

            let color = obj.type_color();
            let label = format!("M{}", obj.m_number);
            let is_center = obj.m_number == 42;
            let marker_r = if is_center { 18.0 } else { 8.0 };

            pinhole_svg_messier.push_str(&format!(
                r##"<g class="messier" data-name="{}" data-type="{}">
                    <circle cx="{:.1}" cy="{:.1}" r="{}" fill="none" stroke="{}" stroke-width="{}" stroke-dasharray="3 2" />
                    <circle cx="{:.1}" cy="{:.1}" r="2" fill="{}" />
                    <text x="{:.1}" y="{:.1}" fill="{}" font-size="10" font-weight="{}" font-family="'Inter', sans-serif" dx="{}" dy="4">{}</text>
                   </g>"##,
                obj.name, obj.type_name(), px, py, marker_r, color, if is_center { 2 } else { 1 }, px, py, color, px, py, color, if is_center { "bold" } else { "normal" }, marker_r + 4.0, label
            ));
        }
    }
    println!("Pinhole: Projected {} stars and {} Messier objects.", pinhole_stars_count, pinhole_messier_count);

    // 3. ГЕНЕРАЦИЯ HTML
    let html_content = format!(
        r##"<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>Apex Astronomy Core Visualizer</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
    <style>
        :root {{
            --bg-color: #06060c;
            --panel-bg: rgba(13, 13, 27, 0.7);
            --border-color: rgba(255, 255, 255, 0.08);
            --accent-color: #5856d6;
            --text-primary: #f5f5f7;
            --text-secondary: #8e8e93;
        }}
        body {{
            margin: 0;
            background-color: var(--bg-color);
            color: var(--text-primary);
            font-family: 'Inter', sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            min-height: 100vh;
            overflow-x: hidden;
            background-image: 
                radial-gradient(circle at 10% 20%, rgba(88, 86, 214, 0.05) 0%, transparent 40%),
                radial-gradient(circle at 90% 80%, rgba(0, 206, 209, 0.05) 0%, transparent 40%);
        }}
        header {{
            text-align: center;
            margin: 40px 0 20px 0;
        }}
        h1 {{
            font-family: 'Outfit', sans-serif;
            font-size: 2.8rem;
            font-weight: 800;
            margin: 0;
            background: linear-gradient(135deg, #ffffff 30%, #a2a2d0 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: -0.5px;
        }}
        .subtitle {{
            color: var(--text-secondary);
            font-size: 1.1rem;
            margin-top: 8px;
            font-weight: 300;
        }}
        .container {{
            display: flex;
            flex-wrap: wrap;
            gap: 40px;
            justify-content: center;
            max-width: 1700px;
            width: 100%;
            padding: 20px;
            box-sizing: border-box;
        }}
        .card {{
            background: var(--panel-bg);
            border: 1px solid var(--border-color);
            border-radius: 24px;
            padding: 24px;
            backdrop-filter: blur(20px);
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
            display: flex;
            flex-direction: column;
            align-items: center;
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }}
        .card:hover {{
            transform: translateY(-4px);
            box-shadow: 0 30px 60px rgba(88, 86, 214, 0.1);
        }}
        .card h2 {{
            font-family: 'Outfit', sans-serif;
            font-size: 1.5rem;
            margin: 0 0 10px 0;
            font-weight: 600;
            width: 100%;
            text-align: left;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 12px;
        }}
        .card .meta {{
            font-size: 0.85rem;
            color: var(--text-secondary);
            width: 100%;
            margin-bottom: 16px;
            line-height: 1.4;
        }}
        .meta strong {{
            color: #ffffff;
        }}
        .skychart-wrapper {{
            position: relative;
            width: 800px;
            height: 800px;
            border-radius: 16px;
            overflow: hidden;
            background: #000003;
            border: 1px solid rgba(255, 255, 255, 0.05);
        }}
        svg {{
            width: 100%;
            height: 100%;
        }}
        .messier {{
            cursor: pointer;
            transition: opacity 0.2s;
        }}
        .messier:hover {{
            opacity: 1 !important;
        }}
        .messier:hover circle {{
            stroke-width: 1.5px;
            stroke-dasharray: none;
        }}
        .tooltip {{
            position: fixed;
            background: rgba(10, 10, 20, 0.95);
            border: 1px solid rgba(88, 86, 214, 0.3);
            border-radius: 12px;
            padding: 10px 14px;
            font-size: 0.85rem;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s ease;
            z-index: 100;
            box-shadow: 0 10px 20px rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(5px);
        }}
        .tooltip {{
            color: var(--text-primary);
        }}
        .tooltip strong {{
            color: #ffffff;
            display: block;
            margin-bottom: 4px;
            font-size: 0.9rem;
        }}
    </style>
</head>
<body>
    <header>
        <h1>Apex Astronomy Core Visualizer</h1>
        <div class="subtitle">Интерактивная верификация расчетов rust-core: каталоги Hipparcos и Мессье в проекциях</div>
    </header>

    <div class="container">
        <!-- СТЕРЕОГРАФИЧЕСКАЯ КАРТА -->
        <div class="card">
            <h2>Стереографическая проекция (Full-Sky)</h2>
            <div class="meta">
                Центр: Зенит наблюдателя в <strong>Москве</strong> (55.75° N, 37.62° E)<br>
                Время: <strong>2026-05-20 23:00:00</strong> | Лимит яркости звезд: <strong>6.5m</strong><br>
                Отображено звезд: <strong>{}</strong> | Объектов Мессье: <strong>{}</strong>
            </div>
            <div class="skychart-wrapper">
                <svg viewBox="0 0 800 800">
                    <defs>
                        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                            <feGaussianBlur stdDeviation="1.2" result="blur" />
                            <feMerge>
                                <feMergeNode in="blur" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    </defs>
                    <rect width="800" height="800" fill="#000004" />
                    <!-- Сетка координат -->
                    {}
                    <!-- Звезды -->
                    {}
                    <!-- Мессье -->
                    {}
                </svg>
            </div>
        </div>

        <!-- ПИНХОЛЬНАЯ КАРТА -->
        <div class="card">
            <h2>Гномоническая (Pinhole) проекция</h2>
            <div class="meta">
                Центр камеры: <strong>M42 (Туманность Ориона)</strong><br>
                Параметры: Поле зрения (FOV) = <strong>40.0°</strong> | Наклон камеры = <strong>15.0°</strong><br>
                Отображено звезд в поле: <strong>{}</strong> | Объектов Мессье: <strong>{}</strong>
            </div>
            <div class="skychart-wrapper">
                <svg viewBox="0 0 800 800">
                    <rect width="800" height="800" fill="#000002" />
                    <!-- Звезды -->
                    {}
                    <!-- Мессье -->
                    {}
                </svg>
            </div>
        </div>
    </div>

    <div class="tooltip" id="tooltip"></div>

    <script>
        const tooltip = document.getElementById('tooltip');
        const messierGroups = document.querySelectorAll('.messier');

        messierGroups.forEach(group => {{
            group.addEventListener('mouseenter', (e) => {{
                const name = group.getAttribute('data-name');
                const type = group.getAttribute('data-type');
                
                tooltip.innerHTML = `<strong>${{name}}</strong>Тип: ${{type}}`;
                tooltip.style.opacity = '1';
            }});

            group.addEventListener('mousemove', (e) => {{
                tooltip.style.left = (e.clientX + 15) + 'px';
                tooltip.style.top = (e.clientY + 15) + 'px';
            }});

            group.addEventListener('mouseleave', () => {{
                tooltip.style.opacity = '0';
            }});
        }});
    </script>
</body>
</html>
"##,
        projected_stars_count, projected_messier_count,
        grid_svg,
        stereo_svg_stars,
        stereo_svg_messier,
        pinhole_stars_count, pinhole_messier_count,
        pinhole_svg_stars,
        pinhole_svg_messier
    );

    let output_path = Path::new("/Users/svyatoslav.suglobov/PycharmProjects/apex-vobolgus-/sky_chart.html");
    let mut file = File::create(&output_path)?;
    file.write_all(html_content.as_bytes())?;
    println!("Visualizer HTML written successfully to: {:?}", output_path);

    Ok(())
}
