//! Tiền xử lý SVG: bỏ nhiễu (path fill="none") + sort path trái → phải,
//! tách từng path và bọc thành SVG hoàn chỉnh để rasterize/lưu mẫu.

use regex::Regex;

/// Sort các <path> trong SVG theo tọa độ x của lệnh Move đầu tiên (trái → phải),
/// giữ nguyên phần prefix/suffix ngoài vùng path.
fn sort_simple_svg(content: &str) -> String {
    let re_path = Regex::new(r#"(?s)<path\b[^>]*/>|<path\b[^>]*>.*?</path>"#).unwrap();
    let re_x = Regex::new(r#"d\s*=\s*"\s*[Mm]\s*[,\s]*(-?[0-9]*\.?[0-9]+)"#).unwrap();

    let mut paths: Vec<(f32, String)> = re_path
        .find_iter(content)
        .map(|m| {
            let s = m.as_str();
            let x = re_x
                .captures(s)
                .and_then(|c| c.get(1))
                .and_then(|g| g.as_str().parse::<f32>().ok())
                .unwrap_or(f32::MAX);
            (x, s.to_string())
        })
        .collect();

    if paths.is_empty() {
        return content.to_string();
    }

    paths.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

    let first_start = re_path.find(content).map(|m| m.start()).unwrap();
    let last_end = re_path.find_iter(content).last().map(|m| m.end()).unwrap();

    let prefix = &content[..first_start];
    let suffix = &content[last_end..];
    let body: String = paths.into_iter().map(|(_, s)| s).collect();

    format!("{}{}{}", prefix, body, suffix)
}

/// Bỏ path nhiễu (fill="none") rồi sort trái → phải. Trả về SVG đã xử lý.
pub fn svg_preprocessing(content: &str) -> String {
    let regex = Regex::new(r#"<path\s+[^>]*fill="none"[^>]*\s*\/?>"#).unwrap();
    let svg_no_noise = regex.replace_all(content, "");
    sort_simple_svg(&svg_no_noise)
}

/// Tách các <path> đã sort trái → phải, trả về danh sách chuỗi path.
pub fn extract_sorted_paths(content: &str) -> Vec<String> {
    let re_path = Regex::new(r#"(?s)<path\b[^>]*/>|<path\b[^>]*>.*?</path>"#).unwrap();
    let re_x = Regex::new(r#"d\s*=\s*"\s*[Mm]\s*[,\s]*(-?[0-9]*\.?[0-9]+)"#).unwrap();

    let mut paths: Vec<(f32, String)> = re_path
        .find_iter(content)
        .map(|m| {
            let s = m.as_str();
            let x = re_x
                .captures(s)
                .and_then(|c| c.get(1))
                .and_then(|g| g.as_str().parse::<f32>().ok())
                .unwrap_or(f32::MAX);
            (x, s.to_string())
        })
        .collect();

    paths.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    paths.into_iter().map(|(_, s)| s).collect()
}

/// Bọc 1 path đơn lẻ thành SVG hoàn chỉnh (khung 200x40) để rasterize/lưu mẫu.
pub fn wrap_path(path: &str) -> String {
    format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40" viewBox="0 0 200 40">{}</svg>"#,
        path
    )
}
