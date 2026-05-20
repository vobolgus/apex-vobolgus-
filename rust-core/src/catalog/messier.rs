use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MessierObject {
    pub m_number: i32,
    pub name: String,
    pub ra: f32,
    pub dec: f32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub v_mag: f32,
    pub size: f32,
    pub obj_type: i32, // Соответствует MessierType
    pub constellation: String,
}

impl MessierObject {
    pub fn type_name(&self) -> &'static str {
        match self.obj_type {
            1 => "Galaxy",
            2 => "Globular Cluster",
            3 => "Open Cluster",
            4 => "Nebula",
            5 => "Supernova Remnant",
            6 => "Star Cloud",
            7 => "Double Star",
            _ => "Unknown",
        }
    }

    pub fn type_color(&self) -> &'static str {
        match self.obj_type {
            1 => "#FF6B9D",
            2 => "#FFD700",
            3 => "#87CEEB",
            4 => "#00CED1",
            5 => "#FF4500",
            6 => "#DDA0DD",
            7 => "#FFFDE7",
            _ => "#FFFFFF",
        }
    }
}

pub struct MessierCatalog {
    objects: Vec<MessierObject>,
}

impl MessierCatalog {
    pub fn new() -> Self {
        let binary_data = include_bytes!("messier_data.bin");
        let objects: Vec<MessierObject> = bincode::deserialize(binary_data).unwrap();
        Self { objects }
    }

    pub fn get_all_objects(&self) -> Vec<MessierObject> {
        self.objects.clone()
    }

    pub fn get_object_by_number(&self, m_number: i32) -> Option<MessierObject> {
        self.objects.iter().find(|o| o.m_number == m_number).cloned()
    }

    pub fn get_objects_by_type(&self, obj_type: i32) -> Vec<MessierObject> {
        self.objects
            .iter()
            .filter(|o| o.obj_type == obj_type)
            .cloned()
            .collect()
    }

    pub fn get_objects_by_constellation(&self, constellation: &str) -> Vec<MessierObject> {
        let const_upper = constellation.to_uppercase();
        self.objects
            .iter()
            .filter(|o| o.constellation.to_uppercase() == const_upper)
            .cloned()
            .collect()
    }

    pub fn get_objects_by_magnitude(&self, min_mag: f32, max_mag: f32) -> Vec<MessierObject> {
        self.objects
            .iter()
            .filter(|o| o.v_mag >= min_mag && o.v_mag <= max_mag)
            .cloned()
            .collect()
    }
}
