use axum::{extract::{Query, State}, Json};
use crate::AppState;
use axum::http::StatusCode;
use crate::models::{OrbitComputeRequest, OrbitComputeResponse, OrbitPoint};
use rust_core::mechanics::OrbitState;

fn validate_request(req: &OrbitComputeRequest) -> Result<(), (StatusCode, String)> {
    if req.mu <= 0.0 {
        return Err((StatusCode::BAD_REQUEST, "mu must be > 0".to_string()));
    }
    if req.dt <= 0.0 {
        return Err((StatusCode::BAD_REQUEST, "dt must be > 0".to_string()));
    }
    if req.steps == 0 || req.steps > 100_000 {
        return Err((StatusCode::BAD_REQUEST, "steps must be in 1..=100000".to_string()));
    }
    Ok(())
}

fn compute_orbit_from_request(req: OrbitComputeRequest) -> Result<OrbitComputeResponse, (StatusCode, String)> {
    validate_request(&req)?;

    let solution = rust_core::mechanics::compute_orbit(
        OrbitState {
            x: req.r_x,
            y: req.r_y,
            vx: req.v_x,
            vy: req.v_y,
        },
        req.mu,
        req.dt,
        req.steps,
    );

    let trajectory = solution
        .trajectory
        .into_iter()
        .map(|p| OrbitPoint {
            x: p.x,
            y: p.y,
            vx: p.vx,
            vy: p.vy,
            time: p.time,
        })
        .collect();

    Ok(OrbitComputeResponse {
        trajectory,
        semi_major_axis: solution.semi_major_axis,
        eccentricity: solution.eccentricity,
        specific_energy: solution.specific_energy,
    })
}

pub async fn compute_orbit(
    State(_state): State<AppState>,
    Json(req): Json<OrbitComputeRequest>,
) -> Result<Json<OrbitComputeResponse>, (StatusCode, String)> {
    Ok(Json(compute_orbit_from_request(req)?))
}

pub async fn compute_orbit_get(
    State(_state): State<AppState>,
    Query(req): Query<OrbitComputeRequest>,
) -> Result<Json<OrbitComputeResponse>, (StatusCode, String)> {
    Ok(Json(compute_orbit_from_request(req)?))
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

        let response = compute_orbit(State(state), Json(req)).await.unwrap().0;

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
