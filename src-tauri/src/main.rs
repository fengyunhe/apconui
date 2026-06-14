// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::OpenOptions;
use std::io::Write;

fn log_to_file(msg: &str) {
    if let Ok(mut f) = OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/apconui.log")
    {
        let _ = writeln!(f, "{}", msg);
    }
}

fn main() {
    log_to_file("main() called");
    std::panic::set_hook(Box::new(|info| {
        log_to_file(&format!("PANIC: {}", info));
    }));
    app_lib::run();
}
