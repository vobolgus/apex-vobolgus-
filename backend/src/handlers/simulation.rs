use axum::{extract::State, Json};
use crate::AppState;
use crate::models::{OrbitComputeRequest, OrbitComputeResponse, OrbitPoint};

// Функция вычисления производной вектора состояния S = [x, y, vx, vy]
// dS/dt = [vx, vy, ax, ay]
fn derivatives(state: [f64; 4], mu: f64) -> [f64; 4] {
    let x = state[0];
    let y = state[1];
    let vx = state[2];
    let vy = state[3];

    let r_sq = x * x + y * y;
    let r = r_sq.sqrt();
    
    if r < 1e-6 {
        return [vx, vy, 0.0, 0.0]; // защита от деления на ноль в сингулярности
    }

    let ax = -mu * x / (r_sq * r);
    let ay = -mu * y / (r_sq * r);

    [vx, vy, ax, ay]
}

// Шаг интегрирования методом Рунге-Кутты 4-го порядка (RK4)
fn rk4_step(state: [f64; 4], mu: f64, dt: f64) -> [f64; 4] {
    let k1 = derivatives(state, mu);

    let mut state_k2 = [0.0; 4];
    for i in 0..4 {
        state_k2[i] = state[i] + 0.5 * dt * k1[i];
    }
    let k2 = derivatives(state_k2, mu);

    let mut state_k3 = [0.0; 4];
    for i in 0..4 {
        state_k3[i] = state[i] + 0.5 * dt * k2[i];
    }
    let k3 = derivatives(state_k3, mu);

    let mut state_k4 = [0.0; 4];
    for i in 0..4 {
        state_k4[i] = state[i] + dt * k3[i];
    }
    let k4 = derivatives(state_k4, mu);

    let mut next_state = [0.0; 4];
    for i in 0..4 {
        next_state[i] = state[i] + (dt / 6.0) * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]);
    }

    next_state
}

pub async fn compute_orbit(
    State(_state): State<AppState>,
    Json(req): Json<OrbitComputeRequest>,
) -> Json<OrbitComputeResponse> {
    let mu = req.mu;
    let dt = req.dt;
    let steps = req.steps;

    let mut current_state = [req.r_x, req.r_y, req.v_x, req.v_y];
    let mut trajectory = Vec::with_capacity(steps + 1);

    // Добавляем начальную точку
    trajectory.push(OrbitPoint {
        x: current_state[0],
        y: current_state[1],
        vx: current_state[2],
        vy: current_state[3],
        time: 0.0,
    });

    // Интегрируем шаги
    let mut t = 0.0;
    for _ in 0..steps {
        current_state = rk4_step(current_state, mu, dt);
        t += dt;
        trajectory.push(OrbitPoint {
            x: current_state[0],
            y: current_state[1],
            vx: current_state[2],
            vy: current_state[3],
            time: t,
        });
    }

    // Вычисляем орбитальные элементы по начальному состоянию
    let x = req.r_x;
    let y = req.r_y;
    let vx = req.v_x;
    let vy = req.v_y;

    let r = (x * x + y * y).sqrt();
    let v_sq = vx * vx + vy * vy;

    // 1. Удельная энергия
    let specific_energy = v_sq / 2.0 - mu / r;

    // 2. Большая полуось
    let semi_major_axis = if specific_energy.abs() < 1e-9 {
        f64::INFINITY
    } else {
        -mu / (2.0 * specific_energy)
    };

    // 3. Вектор эксцентриситета и эксцентриситет
    // e_vec = ((v^2 - mu/r)*r - (r.v)*v) / mu
    let r_dot_v = x * vx + y * vy;
    let ex = ((v_sq - mu / r) * x - r_dot_v * vx) / mu;
    let ey = ((v_sq - mu / r) * y - r_dot_v * vy) / mu;
    let eccentricity = (ex * ex + ey * ey).sqrt();

    Json(OrbitComputeResponse {
        trajectory,
        semi_major_axis,
        eccentricity,
        specific_energy,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::State;
    use crate::AppState;
    use sqlx::SqlitePool;
    use std::sync::Arc;

    #[tokio::test]
    async fn test_circular_orbit_rk4() {
        // Инициализируем пустую БД (для AppState)
        let db = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let state = AppState {
            db,
            hip_catalog: Arc::new(rust_core::catalog::HipCatalog::new()),
            messier_catalog: Arc::new(rust_core::catalog::MessierCatalog::new()),
        };

        // Запрос для круговой орбиты Земли (r = 7000 км, v = sqrt(mu/r))
        let mu: f64 = 398600.44;
        let r: f64 = 7000.0;
        let v = (mu / r).sqrt(); // ~7.54 km/s

        let req = OrbitComputeRequest {
            r_x: r,
            r_y: 0.0,
            v_x: 0.0,
            v_y: v,
            mu,
            dt: 10.0,
            steps: 100,
        };

        let response = compute_orbit(State(state), Json(req)).await;

        // Проверяем характеристики орбиты
        assert!(response.semi_major_axis > 6990.0 && response.semi_major_axis < 7010.0);
        assert!(response.eccentricity < 0.01); // практически круговая
        assert!(response.specific_energy < 0.0); // эллиптическая/круговая орбита связана
        assert_eq!(response.trajectory.len(), 101);

        // Проверим закон сохранения энергии (первая и последняя точки должны иметь одинаковую энергию)
        let first = &response.trajectory[0];
        let last = &response.trajectory[100];

        let e_first = (first.vx * first.vx + first.vy * first.vy) / 2.0 - mu / (first.x * first.x + first.y * first.y).sqrt();
        let e_last = (last.vx * last.vx + last.vy * last.vy) / 2.0 - mu / (last.x * last.x + last.y * last.y).sqrt();

        // Погрешность RK4 за 100 шагов должна быть крайне мала
        assert!((e_first - e_last).abs() < 1e-5);
    }
}
