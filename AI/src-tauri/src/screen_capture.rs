use serde::Serialize;
use std::{thread, time::Duration};
use tauri::WebviewWindow;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowCapture {
    pub title: String,
    pub width: u32,
    pub height: u32,
    pub mime_type: String,
    pub image_data: String,
}

/// 隐藏客户端后截取上一个前台窗口，然后立即恢复客户端。
///
/// 这样用户点击「查看当前窗口」时，捕获到的是点击前正在使用的应用，
/// 而不是昔涟 AI 自己的窗口。
#[tauri::command]
pub fn capture_active_window(window: WebviewWindow) -> Result<WindowCapture, String> {
    window
        .hide()
        .map_err(|error| format!("无法临时隐藏客户端：{error}"))?;
    thread::sleep(Duration::from_millis(350));

    let result = capture_foreground_window();

    // 无论截图成功与否都要恢复主窗口，避免错误时应用看似「消失」。
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    result
}

#[cfg(target_os = "windows")]
fn capture_foreground_window() -> Result<WindowCapture, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, ColorType, RgbImage};
    use std::{ffi::c_void, mem::size_of, ptr::null_mut};
    use windows_sys::Win32::{
        Foundation::{HWND, RECT},
        Graphics::{
            Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS},
            Gdi::{
                BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject,
                GetDIBits, GetWindowDC, ReleaseDC, SelectObject, BITMAPINFO, BI_RGB, CAPTUREBLT,
                DIB_RGB_COLORS, SRCCOPY,
            },
        },
        Storage::Xps::PrintWindow,
        UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowRect, GetWindowTextW, PW_RENDERFULLCONTENT,
        },
    };

    const MAX_CAPTURE_PIXELS: usize = 20_000_000;
    const MAX_OUTPUT_WIDTH: u32 = 1920;
    const MAX_OUTPUT_HEIGHT: u32 = 1200;

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return Err("未找到可截取的前台窗口".to_string());
        }

        let mut rect = RECT::default();
        let dwm_result = DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS as u32,
            (&mut rect as *mut RECT).cast::<c_void>(),
            size_of::<RECT>() as u32,
        );
        if dwm_result < 0 && GetWindowRect(hwnd, &mut rect) == 0 {
            return Err("无法读取前台窗口尺寸".to_string());
        }

        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width <= 1 || height <= 1 {
            return Err("前台窗口已最小化或尺寸无效".to_string());
        }
        let pixel_count = (width as usize)
            .checked_mul(height as usize)
            .ok_or_else(|| "前台窗口尺寸过大".to_string())?;
        if pixel_count > MAX_CAPTURE_PIXELS {
            return Err("前台窗口分辨率过高，请先缩小窗口后重试".to_string());
        }

        let window_dc = GetWindowDC(hwnd);
        if window_dc.is_null() {
            return Err("无法读取前台窗口画面".to_string());
        }
        let memory_dc = CreateCompatibleDC(window_dc);
        if memory_dc.is_null() {
            ReleaseDC(hwnd, window_dc);
            return Err("无法创建截图画布".to_string());
        }
        let bitmap = CreateCompatibleBitmap(window_dc, width, height);
        if bitmap.is_null() {
            DeleteDC(memory_dc);
            ReleaseDC(hwnd, window_dc);
            return Err("无法创建截图位图".to_string());
        }
        let previous = SelectObject(memory_dc, bitmap);

        let capture_result = (|| -> Result<(Vec<u8>, u32, u32), String> {
            let printed = PrintWindow(hwnd, memory_dc, PW_RENDERFULLCONTENT);
            if printed == 0 {
                // 某些 GPU 加速应用不支持 PrintWindow，此时从屏幕 DC 回退捕获。
                let screen_dc = GetWindowDC(null_mut::<c_void>() as HWND);
                if screen_dc.is_null() {
                    return Err("前台窗口拒绝了截图".to_string());
                }
                let copied = BitBlt(
                    memory_dc,
                    0,
                    0,
                    width,
                    height,
                    screen_dc,
                    rect.left,
                    rect.top,
                    SRCCOPY | CAPTUREBLT,
                );
                ReleaseDC(null_mut::<c_void>() as HWND, screen_dc);
                if copied == 0 {
                    return Err("无法复制前台窗口画面".to_string());
                }
            }

            let mut bitmap_info = BITMAPINFO::default();
            bitmap_info.bmiHeader.biSize = size_of::<windows_sys::Win32::Graphics::Gdi::BITMAPINFOHEADER>() as u32;
            bitmap_info.bmiHeader.biWidth = width;
            // 负高度让 GetDIBits 返回自上而下的像素，避免再做一次垂直翻转。
            bitmap_info.bmiHeader.biHeight = -height;
            bitmap_info.bmiHeader.biPlanes = 1;
            bitmap_info.bmiHeader.biBitCount = 32;
            bitmap_info.bmiHeader.biCompression = BI_RGB;

            let mut bgra = vec![0u8; pixel_count * 4];
            let scan_lines = GetDIBits(
                memory_dc,
                bitmap,
                0,
                height as u32,
                bgra.as_mut_ptr().cast::<c_void>(),
                &mut bitmap_info,
                DIB_RGB_COLORS,
            );
            if scan_lines == 0 {
                return Err("无法读取截图像素".to_string());
            }

            let rgb = bgra_to_rgb(&bgra);
            let image = RgbImage::from_raw(width as u32, height as u32, rgb)
                .ok_or_else(|| "截图像素数据无效".to_string())?;
            let scale = f64::min(
                1.0,
                f64::min(
                    MAX_OUTPUT_WIDTH as f64 / width as f64,
                    MAX_OUTPUT_HEIGHT as f64 / height as f64,
                ),
            );
            let output_width = ((width as f64 * scale).round() as u32).max(1);
            let output_height = ((height as f64 * scale).round() as u32).max(1);
            let output_image = if output_width != width as u32 || output_height != height as u32 {
                image::imageops::resize(&image, output_width, output_height, FilterType::Triangle)
            } else {
                image
            };

            let mut jpeg = Vec::new();
            JpegEncoder::new_with_quality(&mut jpeg, 84)
                .encode(
                    output_image.as_raw(),
                    output_width,
                    output_height,
                    ColorType::Rgb8.into(),
                )
                .map_err(|error| format!("压缩截图失败：{error}"))?;
            Ok((jpeg, output_width, output_height))
        })();

        if !previous.is_null() {
            SelectObject(memory_dc, previous);
        }
        DeleteObject(bitmap);
        DeleteDC(memory_dc);
        ReleaseDC(hwnd, window_dc);

        let (jpeg, output_width, output_height) = capture_result?;
        let mut title_buffer = [0u16; 512];
        let title_length = GetWindowTextW(hwnd, title_buffer.as_mut_ptr(), title_buffer.len() as i32);
        let title = if title_length > 0 {
            String::from_utf16_lossy(&title_buffer[..title_length as usize])
        } else {
            "未命名窗口".to_string()
        };

        Ok(WindowCapture {
            title,
            width: output_width,
            height: output_height,
            mime_type: "image/jpeg".to_string(),
            image_data: format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg)),
        })
    }
}

#[cfg(not(target_os = "windows"))]
fn capture_foreground_window() -> Result<WindowCapture, String> {
    Err("当前窗口截图第一版仅支持 Windows 客户端".to_string())
}

#[cfg(target_os = "windows")]
fn bgra_to_rgb(bgra: &[u8]) -> Vec<u8> {
    let mut rgb = Vec::with_capacity(bgra.len() / 4 * 3);
    let (pixels, remainder) = bgra.as_chunks::<4>();
    debug_assert!(remainder.is_empty());
    for pixel in pixels {
        rgb.extend_from_slice(&[pixel[2], pixel[1], pixel[0]]);
    }
    rgb
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::bgra_to_rgb;

    #[test]
    fn converts_windows_bgra_pixels_to_rgb() {
        assert_eq!(
            bgra_to_rgb(&[10, 20, 30, 255, 1, 2, 3, 0]),
            vec![30, 20, 10, 3, 2, 1]
        );
    }
}
