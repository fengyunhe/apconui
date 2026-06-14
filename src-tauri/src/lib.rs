use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use tauri::{Emitter, Manager};

fn log_to_file(msg: &str) {
    if let Ok(mut f) = OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/apconui.log")
    {
        let _ = writeln!(f, "{}", msg);
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CommandResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

async fn run_container_cmd_async(args: Vec<String>) -> CommandResult {
    let path = "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin";
    let cmd = args[0].clone();
    let rest: Vec<String> = args[1..].to_vec();
    log_to_file(&format!("Running: container {}", args.join(" ")));

    tokio::task::spawn_blocking(move || {
        let output = Command::new("/usr/local/bin/container")
            .arg(&cmd)
            .args(&rest)
            .env("PATH", path)
            .output();

        match output {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                log_to_file(&format!("stdout: {} bytes, stderr: {} bytes", stdout.len(), stderr.len()));
                CommandResult {
                    success: output.status.success(),
                    stdout,
                    stderr,
                }
            }
            Err(e) => {
                log_to_file(&format!("Failed to execute container command: {e}"));
                CommandResult {
                    success: false,
                    stdout: String::new(),
                    stderr: format!("Failed to execute container command: {e}"),
                }
            }
        }
    })
    .await
    .unwrap_or_else(|e| CommandResult {
        success: false,
        stdout: String::new(),
        stderr: format!("Task failed: {e}"),
    })
}

fn leak(s: String) -> &'static str {
    Box::leak(s.into_boxed_str())
}

// ==================== System Commands ====================

#[tauri::command]
async fn system_start() -> CommandResult {
    run_container_cmd_async(vec!["system".into(), "start".into()]).await
}

#[tauri::command]
async fn system_stop() -> CommandResult {
    run_container_cmd_async(vec!["system".into(), "stop".into()]).await
}

// ==================== Container Commands ====================

#[tauri::command]
async fn list_containers(all: bool) -> CommandResult {
    let mut args = vec!["ls".into(), "--format".into(), "json".into()];
    if all {
        args.push("--all".into());
    }
    run_container_cmd_async(args).await
}

#[tauri::command]
async fn run_container(
    image: String,
    name: Option<String>,
    detach: bool,
    rm: bool,
    cpus: Option<String>,
    memory: Option<String>,
    ports: Option<String>,
    envs: Option<String>,
    volumes: Option<String>,
    network: Option<String>,
    entrypoint: Option<String>,
    working_dir: Option<String>,
) -> CommandResult {
    let mut args: Vec<String> = vec!["run".into()];

    if detach {
        args.push("-d".into());
    }
    if rm {
        args.push("--rm".into());
    }
    if let Some(n) = name {
        args.push("--name".into());
        args.push(n);
    }
    if let Some(c) = cpus {
        args.push("-c".into());
        args.push(c);
    }
    if let Some(m) = memory {
        args.push("-m".into());
        args.push(m);
    }
    if let Some(p) = ports {
        for port in p.split(',') {
            args.push("-p".into());
            args.push(port.trim().to_string());
        }
    }
    if let Some(e) = envs {
        for env in e.split(',') {
            args.push("-e".into());
            args.push(env.trim().to_string());
        }
    }
    if let Some(v) = volumes {
        for vol in v.split(',') {
            args.push("-v".into());
            args.push(vol.trim().to_string());
        }
    }
    if let Some(n) = network {
        args.push("--network".into());
        args.push(n);
    }
    if let Some(ep) = entrypoint {
        args.push("--entrypoint".into());
        args.push(ep);
    }
    if let Some(wd) = working_dir {
        args.push("-w".into());
        args.push(wd);
    }

    args.push(image);
    run_container_cmd_async(args).await
}

#[tauri::command]
async fn stop_container(id: String, timeout: Option<i32>) -> CommandResult {
    let mut args: Vec<String> = vec!["stop".into()];
    if let Some(t) = timeout {
        args.push("-t".into());
        args.push(t.to_string());
    }
    args.push(id);
    run_container_cmd_async(args).await
}

#[tauri::command]
async fn start_container(id: String) -> CommandResult {
    run_container_cmd_async(vec!["start".into(), id]).await
}

#[tauri::command]
async fn delete_container(id: String, force: bool) -> CommandResult {
    let mut args: Vec<String> = vec!["rm".into()];
    if force {
        args.push("-f".into());
    }
    args.push(id);
    run_container_cmd_async(args).await
}

#[tauri::command]
async fn kill_container(id: String, signal: Option<String>) -> CommandResult {
    let mut args: Vec<String> = vec!["kill".into()];
    if let Some(s) = signal {
        args.push("-s".into());
        args.push(s);
    }
    args.push(id);
    run_container_cmd_async(args).await
}

#[tauri::command]
async fn inspect_container(id: String) -> CommandResult {
    run_container_cmd_async(vec!["inspect".into(), id]).await
}

#[tauri::command]
async fn get_container_logs(id: String, follow: bool, lines: Option<i32>) -> CommandResult {
    let mut args: Vec<String> = vec!["logs".into()];
    if follow {
        args.push("-f".into());
    }
    if let Some(n) = lines {
        args.push("-n".into());
        args.push(n.to_string());
    }
    args.push(id);
    run_container_cmd_async(args).await
}

#[tauri::command]
async fn exec_container(id: String, command: String, interactive: bool, tty: bool) -> CommandResult {
    let mut args: Vec<String> = vec!["exec".into()];
    if interactive {
        args.push("-i".into());
    }
    if tty {
        args.push("-t".into());
    }
    args.push(id);
    args.push(command);
    run_container_cmd_async(args).await
}

#[tauri::command]
fn exec_container_shell(id: String) -> CommandResult {
    let script = format!(
        "tell application \"Terminal\"\n  activate\n  do script \"/usr/local/bin/container exec -it {} bash || /usr/local/bin/container exec -it {} sh\"\nend tell",
        id, id
    );
    match std::process::Command::new("osascript")
        .args(["-e", leak(script)])
        .output()
    {
        Ok(output) => CommandResult {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        },
        Err(e) => CommandResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to open terminal: {e}"),
        },
    }
}

#[tauri::command]
fn open_container_logs(id: String) -> CommandResult {
    let script = format!(
        "tell application \"Terminal\"\n  activate\n  do script \"/usr/local/bin/container logs -f {}\"\nend tell",
        id
    );
    match std::process::Command::new("osascript")
        .args(["-e", leak(script)])
        .output()
    {
        Ok(output) => CommandResult {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        },
        Err(e) => CommandResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to open terminal: {e}"),
        },
    }
}

#[tauri::command]
async fn get_container_stats(id: Option<String>) -> CommandResult {
    let mut args: Vec<String> = vec!["stats".into(), "--format".into(), "json".into(), "--no-stream".into()];
    if let Some(i) = id {
        args.push(i);
    }
    run_container_cmd_async(args).await
}

#[tauri::command]
async fn prune_containers() -> CommandResult {
    run_container_cmd_async(vec!["prune".into()]).await
}

// ==================== Image Commands ====================

#[tauri::command]
async fn list_images() -> CommandResult {
    run_container_cmd_async(vec!["image".into(), "ls".into(), "--format".into(), "json".into()]).await
}

#[tauri::command]
async fn pull_image(reference: String, app: tauri::AppHandle) -> CommandResult {
    let path = "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin";
    let ref_clone = reference.clone();

    tokio::task::spawn_blocking(move || {
        log_to_file(&format!("Pulling image: {}", ref_clone));

        let mut child = match Command::new("/usr/local/bin/container")
            .args(["image", "pull", &ref_clone])
            .env("PATH", path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                return CommandResult {
                    success: false,
                    stdout: String::new(),
                    stderr: format!("Failed to spawn pull command: {e}"),
                };
            }
        };

        let stderr = child.stderr.take().unwrap();
        let reader = BufReader::new(stderr);
        let mut last_progress = String::new();

        for line in reader.lines() {
            match line {
                Ok(line) => {
                    let line = line.trim().to_string();
                    if line.is_empty() {
                        continue;
                    }

                    if line.contains("error") || line.contains("Error") || line.contains("failed") {
                        let _ = app.emit("pull-progress", &line);
                        last_progress = line.clone();
                    } else if line.contains("extracting") || line.contains("copying") || line.contains("Downloading") || line.contains("Extracting") {
                        let _ = app.emit("pull-progress", &line);
                        last_progress = line.clone();
                    } else if line.contains("%") || line.contains("done") || line.contains("complete") {
                        let _ = app.emit("pull-progress", &line);
                        last_progress = line.clone();
                    } else {
                        let _ = app.emit("pull-progress", &line);
                        last_progress = line.clone();
                    }
                }
                Err(e) => {
                    log_to_file(&format!("Error reading pull output: {e}"));
                    break;
                }
            }
        }

        let status = child.wait().unwrap_or_else(|e| {
            log_to_file(&format!("Error waiting for pull: {e}"));
            std::process::ExitStatus::default()
        });

        let _ = app.emit("pull-complete", status.success());

        CommandResult {
            success: status.success(),
            stdout: last_progress,
            stderr: String::new(),
        }
    })
    .await
    .unwrap_or_else(|e| CommandResult {
        success: false,
        stdout: String::new(),
        stderr: format!("Task failed: {e}"),
    })
}

#[tauri::command]
async fn push_image(reference: String) -> CommandResult {
    run_container_cmd_async(vec!["image".into(), "push".into(), reference]).await
}

#[tauri::command]
async fn delete_image(name: String, force: bool) -> CommandResult {
    let mut args: Vec<String> = vec!["image".into(), "rm".into()];
    if force {
        args.push("-f".into());
    }
    args.push(name);
    run_container_cmd_async(args).await
}

#[tauri::command]
async fn inspect_image(name: String) -> CommandResult {
    run_container_cmd_async(vec!["image".into(), "inspect".into(), name]).await
}

#[tauri::command]
async fn build_image(
    context: String,
    tag: String,
    dockerfile: Option<String>,
    no_cache: bool,
    build_args: Option<String>,
) -> CommandResult {
    let mut args: Vec<String> = vec!["build".into(), "-t".into(), tag];

    if let Some(f) = dockerfile {
        args.push("-f".into());
        args.push(f);
    }
    if no_cache {
        args.push("--no-cache".into());
    }
    if let Some(ba) = build_args {
        for arg in ba.split(',') {
            args.push("--build-arg".into());
            args.push(arg.trim().to_string());
        }
    }
    args.push(context);
    run_container_cmd_async(args).await
}

#[tauri::command]
async fn tag_image(source: String, target: String) -> CommandResult {
    run_container_cmd_async(vec!["image".into(), "tag".into(), source, target]).await
}

#[tauri::command]
async fn prune_images(all: bool) -> CommandResult {
    let mut args: Vec<String> = vec!["image".into(), "prune".into()];
    if all {
        args.push("-a".into());
    }
    run_container_cmd_async(args).await
}

// ==================== Volume Commands ====================

#[tauri::command]
async fn list_volumes() -> CommandResult {
    run_container_cmd_async(vec!["volume".into(), "ls".into(), "--format".into(), "json".into()]).await
}

#[tauri::command]
async fn create_volume(name: String, size: Option<String>) -> CommandResult {
    let mut args: Vec<String> = vec!["volume".into(), "create".into()];
    if let Some(s) = size {
        args.push("-s".into());
        args.push(s);
    }
    args.push(name);
    run_container_cmd_async(args).await
}

#[tauri::command]
async fn delete_volume(name: String) -> CommandResult {
    run_container_cmd_async(vec!["volume".into(), "rm".into(), name]).await
}

#[tauri::command]
async fn inspect_volume(name: String) -> CommandResult {
    run_container_cmd_async(vec!["volume".into(), "inspect".into(), name]).await
}

#[tauri::command]
async fn prune_volumes() -> CommandResult {
    run_container_cmd_async(vec!["volume".into(), "prune".into()]).await
}

// ==================== Network Commands ====================

#[tauri::command]
async fn list_networks() -> CommandResult {
    run_container_cmd_async(vec!["network".into(), "ls".into(), "--format".into(), "json".into()]).await
}

#[tauri::command]
async fn create_network(
    name: String,
    subnet: Option<String>,
    subnet_v6: Option<String>,
    internal: bool,
) -> CommandResult {
    let mut args: Vec<String> = vec!["network".into(), "create".into()];
    if internal {
        args.push("--internal".into());
    }
    if let Some(s) = subnet {
        args.push("--subnet".into());
        args.push(s);
    }
    if let Some(sv6) = subnet_v6 {
        args.push("--subnet-v6".into());
        args.push(sv6);
    }
    args.push(name);
    run_container_cmd_async(args).await
}

#[tauri::command]
async fn delete_network(name: String) -> CommandResult {
    run_container_cmd_async(vec!["network".into(), "rm".into(), name]).await
}

#[tauri::command]
async fn inspect_network(name: String) -> CommandResult {
    run_container_cmd_async(vec!["network".into(), "inspect".into(), name]).await
}

#[tauri::command]
async fn prune_networks() -> CommandResult {
    run_container_cmd_async(vec!["network".into(), "prune".into()]).await
}

// ==================== Registry Commands ====================

#[tauri::command]
async fn registry_login(server: String, username: String, password: String) -> CommandResult {
    let srv = server.clone();
    let usr = username.clone();
    let pass = password.clone();

    tokio::task::spawn_blocking(move || {
        match Command::new("/usr/local/bin/container")
            .args(["registry", "login", "-u", &usr, "--password-stdin", &srv])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(mut child) => {
                if let Some(stdin) = child.stdin.as_mut() {
                    use std::io::Write;
                    let _ = stdin.write_all(pass.as_bytes());
                }
                match child.wait_with_output() {
                    Ok(output) => CommandResult {
                        success: output.status.success(),
                        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                    },
                    Err(e) => CommandResult {
                        success: false,
                        stdout: String::new(),
                        stderr: format!("Failed to wait for registry login: {e}"),
                    },
                }
            }
            Err(e) => CommandResult {
                success: false,
                stdout: String::new(),
                stderr: format!("Failed to spawn registry login: {e}"),
            },
        }
    })
    .await
    .unwrap_or_else(|e| CommandResult {
        success: false,
        stdout: String::new(),
        stderr: format!("Task failed: {e}"),
    })
}

#[tauri::command]
async fn registry_logout(server: String) -> CommandResult {
    run_container_cmd_async(vec!["registry".into(), "logout".into(), server]).await
}

#[tauri::command]
async fn registry_list() -> CommandResult {
    run_container_cmd_async(vec!["registry".into(), "list".into(), "--format".into(), "json".into()]).await
}

// ==================== Machine Commands ====================

#[tauri::command]
async fn list_machines() -> CommandResult {
    run_container_cmd_async(vec!["machine".into(), "ls".into(), "--format".into(), "json".into()]).await
}

#[tauri::command]
async fn create_machine(image: String, name: Option<String>, cpus: Option<String>, memory: Option<String>) -> CommandResult {
    let mut args: Vec<String> = vec!["machine".into(), "create".into(), image];
    if let Some(n) = name {
        args.push("--name".into());
        args.push(n);
    }
    if let Some(c) = cpus {
        args.push("--cpus".into());
        args.push(c);
    }
    if let Some(m) = memory {
        args.push("--memory".into());
        args.push(m);
    }
    run_container_cmd_async(args).await
}

#[tauri::command]
async fn delete_machine(name: String, force: bool) -> CommandResult {
    let mut args: Vec<String> = vec!["machine".into(), "rm".into()];
    if force {
        args.push("-f".into());
    }
    args.push(name);
    run_container_cmd_async(args).await
}

#[tauri::command]
async fn start_machine(name: String) -> CommandResult {
    run_container_cmd_async(vec!["machine".into(), "run".into(), "-n".into(), name, "--".into(), "true".into()]).await
}

#[tauri::command]
async fn stop_machine(name: String) -> CommandResult {
    run_container_cmd_async(vec!["machine".into(), "stop".into(), name]).await
}

#[tauri::command]
async fn inspect_machine(name: String) -> CommandResult {
    run_container_cmd_async(vec!["machine".into(), "inspect".into(), name]).await
}

#[tauri::command]
async fn machine_logs(name: String) -> CommandResult {
    run_container_cmd_async(vec!["machine".into(), "logs".into(), name]).await
}

#[tauri::command]
async fn set_machine(name: String, settings: String) -> CommandResult {
    let args: Vec<String> = vec!["machine".into(), "set".into(), "-n".into(), name, settings];
    run_container_cmd_async(args).await
}

#[tauri::command]
async fn set_default_machine(name: String) -> CommandResult {
    run_container_cmd_async(vec!["machine".into(), "set-default".into(), name]).await
}

// ==================== Raw Command Execution ====================

#[tauri::command]
async fn run_raw_command(command: String) -> CommandResult {
    let parts: Vec<String> = command.split_whitespace().map(String::from).collect();
    if parts.is_empty() {
        return CommandResult {
            success: false,
            stdout: String::new(),
            stderr: "Empty command".to_string(),
        };
    }
    run_container_cmd_async(parts).await
}

fn ensure_container_system_running() -> bool {
    let path = "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin";
    let output = Command::new("/usr/local/bin/container")
        .args(["system", "status"])
        .env("PATH", path)
        .output();
    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            if stdout.contains("running") {
                log_to_file("Container system already running");
                return true;
            }
            log_to_file("Container system not running, starting...");
            let start = Command::new("/usr/local/bin/container")
                .args(["system", "start"])
                .env("PATH", path)
                .output();
            match start {
                Ok(s) => {
                    let success = s.status.success();
                    log_to_file(&format!("Container system start: success={}", success));
                    success
                }
                Err(e) => {
                    log_to_file(&format!("Failed to start container system: {}", e));
                    false
                }
            }
        }
        Err(e) => {
            log_to_file(&format!("Failed to check container system: {}", e));
            false
        }
    }
}

pub fn run() {
    log_to_file("=== Starting apconui ===");
    ensure_container_system_running();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            system_start,
            system_stop,
            list_containers,
            run_container,
            stop_container,
            start_container,
            delete_container,
            kill_container,
            inspect_container,
            get_container_logs,
            exec_container,
            exec_container_shell,
            open_container_logs,
            get_container_stats,
            prune_containers,
            list_images,
            pull_image,
            push_image,
            delete_image,
            inspect_image,
            build_image,
            tag_image,
            prune_images,
            list_volumes,
            create_volume,
            delete_volume,
            inspect_volume,
            prune_volumes,
            list_networks,
            create_network,
            delete_network,
            inspect_network,
            prune_networks,
            registry_login,
            registry_logout,
            registry_list,
            list_machines,
            create_machine,
            delete_machine,
            start_machine,
            stop_machine,
            inspect_machine,
            machine_logs,
            set_machine,
            set_default_machine,
            run_raw_command,
        ])
        .setup(|app| {
            log_to_file("Tauri setup called");
            if let Some(_window) = app.get_webview_window("main") {
                log_to_file("Main window found");
            } else {
                log_to_file("WARNING: Main window not found");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            log_to_file(&format!("Tauri error: {}", e));
            panic!("Tauri error: {}", e);
        });
    log_to_file("Tauri run finished");
}
