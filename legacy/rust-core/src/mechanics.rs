use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct OrbitState {
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrbitPoint {
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    pub time: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrbitSolution {
    pub trajectory: Vec<OrbitPoint>,
    pub semi_major_axis: f64,
    pub eccentricity: f64,
    pub specific_energy: f64,
}

fn derivatives(state: [f64; 4], mu: f64) -> [f64; 4] {
    let x = state[0];
    let y = state[1];
    let vx = state[2];
    let vy = state[3];

    let r_sq = x * x + y * y;
    let r = r_sq.sqrt();

    if r < 1e-6 {
        return [vx, vy, 0.0, 0.0];
    }

    let ax = -mu * x / (r_sq * r);
    let ay = -mu * y / (r_sq * r);

    [vx, vy, ax, ay]
}

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

pub fn compute_orbit(initial: OrbitState, mu: f64, dt: f64, steps: usize) -> OrbitSolution {
    let mut current_state = [initial.x, initial.y, initial.vx, initial.vy];
    let mut trajectory = Vec::with_capacity(steps + 1);

    trajectory.push(OrbitPoint {
        x: current_state[0],
        y: current_state[1],
        vx: current_state[2],
        vy: current_state[3],
        time: 0.0,
    });

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

    let x = initial.x;
    let y = initial.y;
    let vx = initial.vx;
    let vy = initial.vy;

    let r = (x * x + y * y).sqrt();
    let v_sq = vx * vx + vy * vy;
    let specific_energy = v_sq / 2.0 - mu / r;

    let semi_major_axis = if specific_energy.abs() < 1e-9 {
        f64::INFINITY
    } else {
        -mu / (2.0 * specific_energy)
    };

    let r_dot_v = x * vx + y * vy;
    let ex = ((v_sq - mu / r) * x - r_dot_v * vx) / mu;
    let ey = ((v_sq - mu / r) * y - r_dot_v * vy) / mu;
    let eccentricity = (ex * ex + ey * ey).sqrt();

    OrbitSolution {
        trajectory,
        semi_major_axis,
        eccentricity,
        specific_energy,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_circular_orbit_rk4() {
        let mu: f64 = 398600.44;
        let r: f64 = 7000.0;
        let v = (mu / r).sqrt();

        let initial = OrbitState {
            x: r,
            y: 0.0,
            vx: 0.0,
            vy: v,
        };

        let solution = compute_orbit(initial, mu, 10.0, 100);

        assert!(solution.semi_major_axis > 6990.0 && solution.semi_major_axis < 7010.0);
        assert!(solution.eccentricity < 0.01);
        assert!(solution.specific_energy < 0.0);
        assert_eq!(solution.trajectory.len(), 101);
    }
}
