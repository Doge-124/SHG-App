//! Silent printing of generated PDFs (receipts / vouchers).
//!
//! The frontend renders an A5 PDF with jsPDF and hands us the raw bytes. We
//! write them to a temp file and ask the OS to print them to the default (or a
//! named) printer *without* showing a print dialog — this is what powers the
//! "Silent printing" auto-print option.
//!
//! On Windows we use the shell `print` / `printto` verbs via ShellExecuteW,
//! which dispatch to the machine's registered PDF handler. With a silent-capable
//! handler installed (SumatraPDF, Adobe/Foxit Reader, etc.) no UI appears. On
//! other platforms the command is a no-op error so the frontend falls back to
//! the in-app print dialog.

use std::io::Write;

/// Write the PDF bytes to a uniquely-named temp file and return its path.
fn write_temp_pdf(bytes: &[u8]) -> Result<std::path::PathBuf, String> {
    if bytes.is_empty() {
        return Err("No PDF data to print".to_string());
    }
    // Nanosecond timestamp keeps concurrent prints from clobbering each other.
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!("shg-print-{stamp}.pdf"));
    let mut f = std::fs::File::create(&path).map_err(|e| format!("Could not create temp file: {e}"))?;
    f.write_all(bytes).map_err(|e| format!("Could not write temp file: {e}"))?;
    Ok(path)
}

/// Best-effort cleanup: the print handler reads the file asynchronously, so we
/// wait a while before deleting it. Failure to delete is harmless (temp dir is
/// cleaned by the OS eventually).
fn schedule_cleanup(path: std::path::PathBuf) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(120));
        let _ = std::fs::remove_file(&path);
    });
}

#[cfg(windows)]
fn to_wide(s: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(windows)]
fn shell_print(path: &std::path::Path, printer: Option<&str>) -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

    let path_str = path.to_string_lossy().to_string();
    let verb = to_wide(if printer.is_some() { "printto" } else { "print" });
    let file = to_wide(&path_str);
    // `printto` takes the target printer (quoted) as its parameters; `print`
    // uses the default printer and takes no parameters.
    let params: Option<Vec<u16>> = printer.map(|p| to_wide(&format!("\"{p}\"")));
    let params_ptr = params
        .as_ref()
        .map(|v| v.as_ptr())
        .unwrap_or(std::ptr::null());

    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            params_ptr,
            std::ptr::null(),
            SW_HIDE as i32,
        )
    };

    // ShellExecuteW returns a value > 32 on success.
    if (result as isize) <= 32 {
        return Err(format!(
            "Could not print: the system has no silent PDF print handler configured (code {})",
            result as isize
        ));
    }
    Ok(())
}

/// Print a PDF (given as raw bytes) silently to the default or a named printer.
#[tauri::command]
pub fn silent_print_pdf(bytes: Vec<u8>, printer: Option<String>) -> Result<(), String> {
    let path = write_temp_pdf(&bytes)?;

    #[cfg(windows)]
    {
        let res = shell_print(&path, printer.as_deref());
        schedule_cleanup(path);
        res
    }

    #[cfg(not(windows))]
    {
        let _ = printer;
        schedule_cleanup(path);
        Err("Silent printing is only supported on Windows".to_string())
    }
}
