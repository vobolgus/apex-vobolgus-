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

impl Default for MessierCatalog {
    fn default() -> Self {
        Self::new()
    }
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

    pub fn iter_all_objects(&self) -> impl Iterator<Item = &MessierObject> {
        self.objects.iter()
    }

    pub fn get_object_by_number(&self, m_number: i32) -> Option<MessierObject> {
        self.objects
            .iter()
            .find(|o| o.m_number == m_number)
            .cloned()
    }

    pub fn get_objects_by_type(&self, obj_type: i32) -> Vec<MessierObject> {
        self.objects
            .iter()
            .filter(|o| o.obj_type == obj_type)
            .cloned()
            .collect()
    }

    pub fn iter_objects_by_type(&self, obj_type: i32) -> impl Iterator<Item = &MessierObject> {
        self.objects.iter().filter(move |o| o.obj_type == obj_type)
    }

    pub fn get_objects_by_constellation(&self, constellation: &str) -> Vec<MessierObject> {
        let const_upper = constellation.to_uppercase();
        self.objects
            .iter()
            .filter(|o| o.constellation.to_uppercase() == const_upper)
            .cloned()
            .collect()
    }

    pub fn iter_objects_by_constellation<'a>(
        &'a self,
        constellation: &'a str,
    ) -> impl Iterator<Item = &'a MessierObject> + 'a {
        let const_upper = constellation.to_uppercase();
        self.objects
            .iter()
            .filter(move |o| o.constellation.to_uppercase() == const_upper)
    }

    pub fn get_objects_by_magnitude(&self, min_mag: f32, max_mag: f32) -> Vec<MessierObject> {
        self.objects
            .iter()
            .filter(|o| o.v_mag >= min_mag && o.v_mag <= max_mag)
            .cloned()
            .collect()
    }

    pub fn iter_objects_by_magnitude(
        &self,
        min_mag: f32,
        max_mag: f32,
    ) -> impl Iterator<Item = &MessierObject> {
        self.objects
            .iter()
            .filter(move |o| o.v_mag >= min_mag && o.v_mag <= max_mag)
    }
}

#[cfg(test)]
mod tests {
    use super::{MessierCatalog, MessierObject};

    fn assert_messier_eq(a: &MessierObject, b: &MessierObject) {
        assert_eq!(a.m_number, b.m_number);
        assert_eq!(a.name, b.name);
        assert_eq!(a.ra, b.ra);
        assert_eq!(a.dec, b.dec);
        assert_eq!(a.x, b.x);
        assert_eq!(a.y, b.y);
        assert_eq!(a.z, b.z);
        assert_eq!(a.v_mag, b.v_mag);
        assert_eq!(a.size, b.size);
        assert_eq!(a.obj_type, b.obj_type);
        assert_eq!(a.constellation, b.constellation);
    }

    #[test]
    fn iter_all_objects_matches_get_all_objects() {
        let catalog = MessierCatalog::new();
        let owned = catalog.get_all_objects();
        let iterated: Vec<MessierObject> = catalog.iter_all_objects().cloned().collect();

        assert_eq!(owned.len(), iterated.len());
        for (a, b) in owned.iter().zip(iterated.iter()) {
            assert_messier_eq(a, b);
        }
    }

    #[test]
    fn iter_objects_by_type_matches_get_objects_by_type() {
        let catalog = MessierCatalog::new();
        let owned = catalog.get_objects_by_type(1);
        let iterated: Vec<MessierObject> = catalog.iter_objects_by_type(1).cloned().collect();

        assert_eq!(owned.len(), iterated.len());
        for (a, b) in owned.iter().zip(iterated.iter()) {
            assert_messier_eq(a, b);
        }
    }

    #[test]
    fn iter_objects_by_constellation_matches_get_objects_by_constellation() {
        let catalog = MessierCatalog::new();
        let owned = catalog.get_objects_by_constellation("ori");
        let iterated: Vec<MessierObject> = catalog
            .iter_objects_by_constellation("ori")
            .cloned()
            .collect();

        assert_eq!(owned.len(), iterated.len());
        for (a, b) in owned.iter().zip(iterated.iter()) {
            assert_messier_eq(a, b);
        }
    }

    #[test]
    fn iter_objects_by_magnitude_matches_get_objects_by_magnitude() {
        let catalog = MessierCatalog::new();
        let owned = catalog.get_objects_by_magnitude(0.0, 6.0);
        let iterated: Vec<MessierObject> = catalog
            .iter_objects_by_magnitude(0.0, 6.0)
            .cloned()
            .collect();

        assert_eq!(owned.len(), iterated.len());
        for (a, b) in owned.iter().zip(iterated.iter()) {
            assert_messier_eq(a, b);
        }
    }
}
