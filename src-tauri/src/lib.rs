use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::process::ExitStatusExt;
use std::process::{Command, Stdio};
use tauri::{Emitter, Manager};

mod docker_proxy;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

struct PullTaskState {
    pid: u32,
    cancelled: Arc<AtomicBool>,
}

lazy_static::lazy_static! {
    static ref ACTIVE_PULLS: Mutex<HashMap<String, PullTaskState>> = Mutex::new(HashMap::new());
}

fn leak(s: String) -> &'static str {
    Box::leak(s.into_boxed_str())
}

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
            .env("DOCKER_HOST", "unix:///tmp/docker.sock")
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

#[derive(Debug, Serialize, Deserialize)]
struct StreamCommandRequest {
    command: String,
    event_id: String,
}

#[tauri::command]
async fn run_container_cmd_stream(
    app: tauri::AppHandle,
    request: StreamCommandRequest,
) -> CommandResult {
    let path = "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin";
    let parts: Vec<String> = request.command.split_whitespace().map(String::from).collect();
    let event_id = request.event_id.clone();

    if parts.is_empty() {
        return CommandResult {
            success: false,
            stdout: String::new(),
            stderr: "Empty command".to_string(),
        };
    }

    log_to_file(&format!("Running stream command: {}", request.command));

    // Handle both "container logs -f ..." and "logs -f ..." formats
    let (cmd, args) = if parts[0] == "container" && parts.len() > 1 {
        (parts[1].clone(), parts[2..].to_vec())
    } else {
        (parts[0].clone(), parts[1..].to_vec())
    };

    let event_id_clone = event_id.clone();
    let app_clone = app.clone();

    tokio::task::spawn_blocking(move || {
        use std::io::{BufRead, BufReader};

        let result = Command::new("/usr/local/bin/container")
            .arg(&cmd)
            .args(&args)
            .env("PATH", path)
            .env("DOCKER_HOST", "unix:///tmp/docker.sock")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();

        match result {
            Ok(mut child) => {
                let stdout = child.stdout.take().unwrap();
                let stderr = child.stderr.take().unwrap();

                let stdout_reader = BufReader::new(stdout);
                let stderr_reader = BufReader::new(stderr);

                // Read stdout in current thread
                for line in stdout_reader.lines() {
                    match line {
                        Ok(line) => {
                            let _ = app_clone.emit(
                                &format!("stream-output-{}", event_id_clone),
                                json!({"line": line, "stream": "stdout"}),
                            );
                        }
                        Err(_) => break,
                    }
                }

                // Read stderr
                for line in stderr_reader.lines() {
                    match line {
                        Ok(line) => {
                            let _ = app_clone.emit(
                                &format!("stream-output-{}", event_id_clone),
                                json!({"line": line, "stream": "stderr"}),
                            );
                        }
                        Err(_) => break,
                    }
                }

                let status = child.wait().unwrap_or_else(|_| std::process::ExitStatus::from_raw(1));
                let _ = app_clone.emit(
                    &format!("stream-complete-{}", event_id_clone),
                    json!({"success": status.success()}),
                );

                CommandResult {
                    success: status.success(),
                    stdout: String::new(),
                    stderr: String::new(),
                }
            }
            Err(e) => {
                log_to_file(&format!("Failed to spawn command: {e}"));
                let _ = app.emit(
                    &format!("stream-complete-{}", event_id),
                    json!({"success": false, "error": e.to_string()}),
                );
                CommandResult {
                    success: false,
                    stdout: String::new(),
                    stderr: format!("Failed to execute command: {e}"),
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

#[tauri::command]
fn cancel_pull(reference: String) -> CommandResult {
    let mut pulls = ACTIVE_PULLS.lock().unwrap();

    if let Some(state) = pulls.remove(&reference) {
        // Set cancellation flag
        state.cancelled.store(true, Ordering::SeqCst);

        // Kill the process directly
        let _ = unsafe {
            libc::kill(-(state.pid as i32), libc::SIGTERM)
        };

        CommandResult {
            success: true,
            stdout: format!("Pull cancelled: {reference}"),
            stderr: String::new(),
        }
    } else {
        CommandResult {
            success: false,
            stdout: String::new(),
            stderr: format!("No pull found for: {reference}"),
        }
    }
}

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
    arch: Option<String>,
    cap_add: Option<String>,
    cap_drop: Option<String>,
    dns: Option<String>,
    dns_domain: Option<String>,
    dns_option: Option<String>,
    dns_search: Option<String>,
    init: bool,
    label: Option<String>,
    mount: Option<String>,
    no_dns: bool,
    os: Option<String>,
    platform: Option<String>,
    read_only: bool,
    rosetta: bool,
    runtime: Option<String>,
    ssh: bool,
    shm_size: Option<String>,
    tmpfs: Option<String>,
    ulimit: Option<String>,
    user: Option<String>,
    max_concurrent_downloads: Option<String>,
    progress: Option<String>,
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
    if let Some(a) = arch {
        args.push("-a".into());
        args.push(a);
    }
    if let Some(ca) = cap_add {
        args.push("--cap-add".into());
        args.push(ca);
    }
    if let Some(cd) = cap_drop {
        args.push("--cap-drop".into());
        args.push(cd);
    }
    if let Some(d) = dns {
        args.push("--dns".into());
        args.push(d);
    }
    if let Some(dd) = dns_domain {
        args.push("--dns-domain".into());
        args.push(dd);
    }
    if let Some(do_) = dns_option {
        args.push("--dns-option".into());
        args.push(do_);
    }
    if let Some(ds) = dns_search {
        args.push("--dns-search".into());
        args.push(ds);
    }
    if init {
        args.push("--init".into());
    }
    if let Some(l) = label {
        args.push("-l".into());
        args.push(l);
    }
    if let Some(mnt) = mount {
        args.push("--mount".into());
        args.push(mnt);
    }
    if no_dns {
        args.push("--no-dns".into());
    }
    if let Some(o) = os {
        args.push("--os".into());
        args.push(o);
    }
    if let Some(p) = platform {
        args.push("--platform".into());
        args.push(p);
    }
    if read_only {
        args.push("--read-only".into());
    }
    if rosetta {
        args.push("--rosetta".into());
    }
    if let Some(r) = runtime {
        args.push("--runtime".into());
        args.push(r);
    }
    if ssh {
        args.push("--ssh".into());
    }
    if let Some(ss) = shm_size {
        args.push("--shm-size".into());
        args.push(ss);
    }
    if let Some(t) = tmpfs {
        args.push("--tmpfs".into());
        args.push(t);
    }
    if let Some(u) = ulimit {
        args.push("--ulimit".into());
        args.push(u);
    }
    if let Some(usr) = user {
        args.push("-u".into());
        args.push(usr);
    }
    if let Some(mcd) = max_concurrent_downloads {
        args.push("--max-concurrent-downloads".into());
        args.push(mcd);
    }
    if let Some(p) = progress {
        args.push("--progress".into());
        args.push(p);
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
async fn create_container(
    image: String,
    name: Option<String>,
    cpus: Option<String>,
    memory: Option<String>,
    ports: Option<String>,
    envs: Option<String>,
    volumes: Option<String>,
    network: Option<String>,
    entrypoint: Option<String>,
    working_dir: Option<String>,
    arch: Option<String>,
    cap_add: Option<String>,
    cap_drop: Option<String>,
    dns: Option<String>,
    dns_domain: Option<String>,
    dns_option: Option<String>,
    dns_search: Option<String>,
    init: bool,
    label: Option<String>,
    mount: Option<String>,
    no_dns: bool,
    os: Option<String>,
    platform: Option<String>,
    read_only: bool,
    rosetta: bool,
    runtime: Option<String>,
    shm_size: Option<String>,
    tmpfs: Option<String>,
    ulimit: Option<String>,
    user: Option<String>,
    max_concurrent_downloads: Option<String>,
    progress: Option<String>,
) -> CommandResult {
    let mut args: Vec<String> = vec!["create".into()];
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
    if let Some(a) = arch {
        args.push("-a".into());
        args.push(a);
    }
    if let Some(ca) = cap_add {
        args.push("--cap-add".into());
        args.push(ca);
    }
    if let Some(cd) = cap_drop {
        args.push("--cap-drop".into());
        args.push(cd);
    }
    if let Some(d) = dns {
        args.push("--dns".into());
        args.push(d);
    }
    if let Some(dd) = dns_domain {
        args.push("--dns-domain".into());
        args.push(dd);
    }
    if let Some(do_) = dns_option {
        args.push("--dns-option".into());
        args.push(do_);
    }
    if let Some(ds) = dns_search {
        args.push("--dns-search".into());
        args.push(ds);
    }
    if init {
        args.push("--init".into());
    }
    if let Some(l) = label {
        args.push("-l".into());
        args.push(l);
    }
    if let Some(mnt) = mount {
        args.push("--mount".into());
        args.push(mnt);
    }
    if no_dns {
        args.push("--no-dns".into());
    }
    if let Some(o) = os {
        args.push("--os".into());
        args.push(o);
    }
    if let Some(p) = platform {
        args.push("--platform".into());
        args.push(p);
    }
    if read_only {
        args.push("--read-only".into());
    }
    if rosetta {
        args.push("--rosetta".into());
    }
    if let Some(r) = runtime {
        args.push("--runtime".into());
        args.push(r);
    }
    if let Some(ss) = shm_size {
        args.push("--shm-size".into());
        args.push(ss);
    }
    if let Some(t) = tmpfs {
        args.push("--tmpfs".into());
        args.push(t);
    }
    if let Some(u) = ulimit {
        args.push("--ulimit".into());
        args.push(u);
    }
    if let Some(usr) = user {
        args.push("-u".into());
        args.push(usr);
    }
    if let Some(mcd) = max_concurrent_downloads {
        args.push("--max-concurrent-downloads".into());
        args.push(mcd);
    }
    if let Some(p) = progress {
        args.push("--progress".into());
        args.push(p);
    }
    args.push(image);
    run_container_cmd_async(args).await
}

#[tauri::command]
async fn copy_from_container(id: String, container_path: String, local_path: String) -> CommandResult {
    run_container_cmd_async(vec!["cp".into(), format!("{}:{}", id, container_path), local_path]).await
}

#[tauri::command]
async fn copy_to_container(id: String, local_path: String, container_path: String) -> CommandResult {
    run_container_cmd_async(vec!["cp".into(), local_path, format!("{}:{}", id, container_path)]).await
}

#[tauri::command]
async fn export_container(id: String, output: Option<String>) -> CommandResult {
    let mut args: Vec<String> = vec!["export".into()];
    if let Some(o) = output {
        args.push("-o".into());
        args.push(o);
    }
    args.push(id);
    run_container_cmd_async(args).await
}

#[tauri::command]
async fn list_container_files(id: String, path: String) -> CommandResult {
    run_container_cmd_async(vec!["exec".into(), id, "ls".into(), "-la".into(), path]).await
}

#[tauri::command]
async fn read_container_file(id: String, path: String) -> CommandResult {
    run_container_cmd_async(vec!["exec".into(), id, "cat".into(), path]).await
}

#[tauri::command]
async fn write_container_file(id: String, path: String, content: String) -> CommandResult {
    let cmd = format!("cat > {} << 'ENDOFFILE'\n{}\nENDOFFILE", path, content);
    run_container_cmd_async(vec!["exec".into(), id, "sh".into(), "-c".into(), cmd]).await
}

#[tauri::command]
async fn delete_container_file(id: String, path: String) -> CommandResult {
    run_container_cmd_async(vec!["exec".into(), id, "rm".into(), path]).await
}

#[tauri::command]
async fn make_container_dir(id: String, path: String) -> CommandResult {
    run_container_cmd_async(vec!["exec".into(), id, "mkdir".into(), "-p".into(), path]).await
}

#[tauri::command]
async fn list_container_dirs(id: String, path: String) -> CommandResult {
    run_container_cmd_async(vec!["exec".into(), id, "sh".into(), "-c".into(), format!("find {} -maxdepth 1 -type d 2>/dev/null | sort", path)]).await
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
async fn image_exists_locally(reference: String) -> CommandResult {
    let result = run_container_cmd_async(vec!["image".into(), "inspect".into(), reference]).await;
    CommandResult {
        success: result.success,
        stdout: if result.success { "exists".to_string() } else { String::new() },
        stderr: result.stderr,
    }
}

#[tauri::command]
async fn pull_image(reference: String, app: tauri::AppHandle) -> CommandResult {
    let path = "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin";
    let ref_clone = reference.clone();
    let task_id = reference.clone();

    // Create per-task cancellation flag
    let cancelled = Arc::new(AtomicBool::new(false));
    let cancelled_clone = cancelled.clone();

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

        // Store PID for cancellation
        let pid = child.id();

        // Register in active pulls
        {
            let mut pulls = ACTIVE_PULLS.lock().unwrap();
            pulls.insert(task_id.clone(), PullTaskState {
                pid,
                cancelled: cancelled_clone,
            });
            log_to_file(&format!("Registered pull task: {} (pid: {})", task_id, pid));
        }

        let stderr = child.stderr.take().unwrap();
        let reader = BufReader::new(stderr);
        let mut last_progress = String::new();

        for line in reader.lines() {
            // Check if this specific task is cancelled
            if cancelled.load(Ordering::SeqCst) {
                log_to_file(&format!("Pull cancelled: {}", ref_clone));
                let _ = child.kill();
                let _ = app.emit("pull-complete", &json!({"reference": ref_clone, "success": false}));
                // Remove from active pulls
                let mut pulls = ACTIVE_PULLS.lock().unwrap();
                pulls.remove(&task_id);
                return CommandResult {
                    success: false,
                    stdout: String::new(),
                    stderr: "Pull cancelled".to_string(),
                };
            }

            match line {
                Ok(line) => {
                    let line = line.trim().to_string();
                    if line.is_empty() {
                        continue;
                    }

                    let _ = app.emit("pull-progress", &json!({"reference": ref_clone, "message": line}));
                    last_progress = line.clone();
                }
                Err(e) => {
                    log_to_file(&format!("Error reading pull output: {e}"));
                    break;
                }
            }
        }

        // Remove from active pulls
        {
            let mut pulls = ACTIVE_PULLS.lock().unwrap();
            pulls.remove(&task_id);
            log_to_file(&format!("Removed pull task: {}", task_id));
        }

        let status = child.wait().unwrap_or_else(|e| {
            log_to_file(&format!("Error waiting for pull: {e}"));
            std::process::ExitStatus::default()
        });

        log_to_file(&format!("Pull {} completed: success={}", ref_clone, status.success()));
        let _ = app.emit("pull-complete", &json!({"reference": ref_clone, "success": status.success()}));

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
async fn save_image(reference: String, output: Option<String>) -> CommandResult {
    let mut args: Vec<String> = vec!["image".into(), "save".into()];
    if let Some(o) = output {
        args.push("-o".into());
        args.push(o);
    }
    args.push(reference);
    run_container_cmd_async(args).await
}

#[tauri::command]
async fn load_image(input: Option<String>, force: bool) -> CommandResult {
    let mut args: Vec<String> = vec!["image".into(), "load".into()];
    if let Some(i) = input {
        args.push("-i".into());
        args.push(i);
    }
    if force {
        args.push("-f".into());
    }
    run_container_cmd_async(args).await
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
async fn create_volume(name: String, size: Option<String>, labels: Option<String>, opts: Option<String>) -> CommandResult {
    let mut args: Vec<String> = vec!["volume".into(), "create".into()];
    if let Some(s) = size {
        args.push("-s".into());
        args.push(s);
    }
    if let Some(l) = labels {
        for label in l.split(',') {
            args.push("--label".into());
            args.push(label.trim().to_string());
        }
    }
    if let Some(o) = opts {
        for opt in o.split(',') {
            args.push("--opt".into());
            args.push(opt.trim().to_string());
        }
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
    labels: Option<String>,
    options: Option<String>,
    plugin: Option<String>,
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
    if let Some(l) = labels {
        for label in l.split(',') {
            args.push("--label".into());
            args.push(label.trim().to_string());
        }
    }
    if let Some(o) = options {
        for opt in o.split(',') {
            args.push("--option".into());
            args.push(opt.trim().to_string());
        }
    }
    if let Some(p) = plugin {
        args.push("--plugin".into());
        args.push(p);
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
async fn create_machine(
    image: String,
    name: Option<String>,
    cpus: Option<String>,
    memory: Option<String>,
    set_default: bool,
    no_boot: bool,
    home_mount: Option<String>,
    arch: Option<String>,
    os: Option<String>,
    platform: Option<String>,
) -> CommandResult {
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
    if set_default {
        args.push("--set-default".into());
    }
    if no_boot {
        args.push("--no-boot".into());
    }
    if let Some(hm) = home_mount {
        args.push("--home-mount".into());
        args.push(hm);
    }
    if let Some(a) = arch {
        args.push("-a".into());
        args.push(a);
    }
    if let Some(o) = os {
        args.push("--os".into());
        args.push(o);
    }
    if let Some(p) = platform {
        args.push("--platform".into());
        args.push(p);
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

#[tauri::command]
async fn run_machine_command(name: String, command: Option<String>, root: bool) -> CommandResult {
    let script = format!(
        "tell application \"Terminal\"\n  activate\n  do script \"/usr/local/bin/container machine run {}-n {} {}\"\nend tell",
        if root { "--root " } else { "" },
        name,
        command.unwrap_or_else(|| String::new())
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
async fn system_df() -> CommandResult {
    run_container_cmd_async(vec!["system".into(), "df".into(), "--format".into(), "json".into()]).await
}

#[tauri::command]
async fn system_version() -> CommandResult {
    run_container_cmd_async(vec!["--version".into()]).await
}

#[tauri::command]
async fn system_logs(follow: bool, last: Option<String>) -> CommandResult {
    let mut args: Vec<String> = vec!["system".into(), "logs".into()];
    if follow {
        args.push("-f".into());
    }
    if let Some(l) = last {
        args.push("--last".into());
        args.push(l);
    }
    run_container_cmd_async(args).await
}

// ==================== Docker CLI Proxy ====================

fn translate_docker_command(parts: &[String]) -> Vec<String> {
    if parts.is_empty() || parts[0] != "docker" {
        return parts.to_vec();
    }

    if parts.len() == 1 {
        return vec!["container".into(), "--help".into()];
    }

    let subcmd = parts[1].as_str();
    let rest = &parts[2..];

    match subcmd {
        "ps" => {
            let mut args = vec!["ls".into()];
            for arg in rest {
                match arg.as_str() {
                    "-a" | "--all" => args.push("--all".into()),
                    "--no-trunc" => {}
                    "-q" | "--quiet" => {}
                    "-s" | "--size" => {}
                    _ => {
                        if arg.starts_with("--format") || arg.starts_with("--filter") || arg.starts_with("--limit") || arg.starts_with("--no-stream") {
                            // skip docker-only flags
                        } else {
                            args.push(arg.clone());
                        }
                    }
                }
            }
            args
        }
        "run" => {
            let mut args = vec!["run".into()];
            let mut i = 0;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-d" | "--detach" => args.push("-d".into()),
                    "--rm" => args.push("--rm".into()),
                    "--name" => {
                        args.push("--name".into());
                        if i + 1 < rest.len() { i += 1; args.push(rest[i].clone()); }
                    }
                    "-c" | "--cpus" => {
                        args.push("-c".into());
                        if i + 1 < rest.len() { i += 1; args.push(rest[i].clone()); }
                    }
                    "-m" | "--memory" => {
                        args.push("-m".into());
                        if i + 1 < rest.len() { i += 1; args.push(rest[i].clone()); }
                    }
                    "-p" | "--publish" => {
                        args.push("-p".into());
                        if i + 1 < rest.len() { i += 1; args.push(rest[i].clone()); }
                    }
                    "-e" | "--env" => {
                        args.push("-e".into());
                        if i + 1 < rest.len() { i += 1; args.push(rest[i].clone()); }
                    }
                    "-v" | "--volume" => {
                        args.push("-v".into());
                        if i + 1 < rest.len() { i += 1; args.push(rest[i].clone()); }
                    }
                    "--network" => {
                        args.push("--network".into());
                        if i + 1 < rest.len() { i += 1; args.push(rest[i].clone()); }
                    }
                    "--entrypoint" => {
                        args.push("--entrypoint".into());
                        if i + 1 < rest.len() { i += 1; args.push(rest[i].clone()); }
                    }
                    "-w" | "--workdir" => {
                        args.push("-w".into());
                        if i + 1 < rest.len() { i += 1; args.push(rest[i].clone()); }
                    }
                    "-u" | "--user" => {
                        args.push("-u".into());
                        if i + 1 < rest.len() { i += 1; args.push(rest[i].clone()); }
                    }
                    "-it" => { args.push("-i".into()); args.push("-t".into()); }
                    "-i" | "--interactive" => args.push("-i".into()),
                    "-t" | "--tty" => args.push("-t".into()),
                    "--init" => args.push("--init".into()),
                    "--read-only" => args.push("--read-only".into()),
                    "--restart" => { i += 1; } // skip docker-only restart policy
                    "--network-alias" | "--network-aliases" => { i += 1; }
                    "--expose" => { i += 1; }
                    "--hostname" => { i += 1; }
                    "--domainname" | "--dns-search" => { i += 1; }
                    "--add-host" => { i += 1; }
                    "--label" | "-l" => { i += 1; }
                    "--shm-size" => { i += 1; }
                    "--tmpfs" => {
                        args.push("--tmpfs".into());
                        if i + 1 < rest.len() { i += 1; args.push(rest[i].clone()); }
                    }
                    "--ulimit" => { i += 1; }
                    "--cap-add" => {
                        args.push("--cap-add".into());
                        if i + 1 < rest.len() { i += 1; args.push(rest[i].clone()); }
                    }
                    "--cap-drop" => {
                        args.push("--cap-drop".into());
                        if i + 1 < rest.len() { i += 1; args.push(rest[i].clone()); }
                    }
                    "--dns" => {
                        args.push("--dns".into());
                        if i + 1 < rest.len() { i += 1; args.push(rest[i].clone()); }
                    }
                    "--platform" => {
                        args.push("--platform".into());
                        if i + 1 < rest.len() { i += 1; args.push(rest[i].clone()); }
                    }
                    "--no-cache" => args.push("--no-cache".into()),
                    "--pull" => { i += 1; }
                    _ => args.push(rest[i].clone()),
                }
                i += 1;
            }
            args
        }
        "stop" => {
            let mut args = vec!["stop".into()];
            let mut i = 0;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-t" | "--time" => {
                        args.push("-t".into());
                        if i + 1 < rest.len() { i += 1; args.push(rest[i].clone()); }
                    }
                    _ => args.push(rest[i].clone()),
                }
                i += 1;
            }
            args
        }
        "start" => {
            let mut args = vec!["start".into()];
            args.extend(rest.iter().cloned());
            args
        }
        "restart" => {
            let mut args = vec!["stop".into()];
            args.extend(rest.iter().cloned());
            args
        }
        "rm" => {
            let mut args = vec!["rm".into()];
            for arg in rest {
                match arg.as_str() {
                    "-f" | "--force" => args.push("-f".into()),
                    "-v" | "--volumes" => {} // container rm doesn't support -v
                    _ => args.push(arg.clone()),
                }
            }
            args
        }
        "rmi" | "image" => {
            if subcmd == "rmi" {
                let mut args = vec!["image".into(), "rm".into()];
                for arg in rest {
                    match arg.as_str() {
                        "-f" | "--force" => args.push("-f".into()),
                        _ => args.push(arg.clone()),
                    }
                }
                args
            } else {
                let mut args = vec!["image".into()];
                args.extend(rest.iter().cloned());
                args
            }
        }
        "images" => {
            let mut args = vec!["image".into(), "ls".into(), "--format".into(), "json".into()];
            for arg in rest {
                if !arg.starts_with('-') {
                    args.push(arg.clone());
                }
            }
            args
        }
        "pull" => {
            let mut args = vec!["image".into(), "pull".into()];
            args.extend(rest.iter().cloned());
            args
        }
        "push" => {
            let mut args = vec!["image".into(), "push".into()];
            args.extend(rest.iter().cloned());
            args
        }
        "tag" => {
            let mut args = vec!["image".into(), "tag".into()];
            args.extend(rest.iter().cloned());
            args
        }
        "build" => {
            let mut args = vec!["build".into()];
            let mut i = 0;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-t" | "--tag" => {
                        args.push("-t".into());
                        if i + 1 < rest.len() { i += 1; args.push(rest[i].clone()); }
                    }
                    "-f" | "--file" => {
                        args.push("-f".into());
                        if i + 1 < rest.len() { i += 1; args.push(rest[i].clone()); }
                    }
                    "--no-cache" => args.push("--no-cache".into()),
                    "--build-arg" => {
                        args.push("--build-arg".into());
                        if i + 1 < rest.len() { i += 1; args.push(rest[i].clone()); }
                    }
                    _ => args.push(rest[i].clone()),
                }
                i += 1;
            }
            args
        }
        "exec" => {
            let mut args = vec!["exec".into()];
            let mut i = 0;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-it" => { args.push("-i".into()); args.push("-t".into()); }
                    "-i" | "--interactive" => args.push("-i".into()),
                    "-t" | "--tty" => args.push("-t".into()),
                    "-d" | "--detach" => {}
                    "-w" | "--workdir" => {
                        args.push("-w".into());
                        if i + 1 < rest.len() { i += 1; args.push(rest[i].clone()); }
                    }
                    "-u" | "--user" => {
                        args.push("-u".into());
                        if i + 1 < rest.len() { i += 1; args.push(rest[i].clone()); }
                    }
                    _ => args.push(rest[i].clone()),
                }
                i += 1;
            }
            args
        }
        "logs" => {
            let mut args = vec!["logs".into()];
            for arg in rest {
                match arg.as_str() {
                    "-f" | "--follow" => args.push("-f".into()),
                    "-n" | "--tail" => {} // skip docker-only
                    "--since" => {} // skip docker-only
                    _ => {
                        if let Some(n) = arg.strip_prefix("--tail=") {
                            args.push("-n".into());
                            args.push(n.to_string());
                        } else if arg.starts_with('-') {
                            // skip unknown flags
                        } else {
                            args.push(arg.clone());
                        }
                    }
                }
            }
            args
        }
        "inspect" => {
            let mut args = vec!["inspect".into()];
            args.extend(rest.iter().cloned());
            args
        }
        "cp" => {
            let mut args = vec!["cp".into()];
            args.extend(rest.iter().cloned());
            args
        }
        "export" => {
            let mut args = vec!["export".into()];
            for arg in rest {
                match arg.as_str() {
                    "-o" | "--output" => {} // skip
                    _ => args.push(arg.clone()),
                }
            }
            args
        }
        "kill" => {
            let mut args = vec!["kill".into()];
            let mut i = 0;
            while i < rest.len() {
                match rest[i].as_str() {
                    "-s" | "--signal" => {
                        args.push("-s".into());
                        if i + 1 < rest.len() { i += 1; args.push(rest[i].clone()); }
                    }
                    _ => args.push(rest[i].clone()),
                }
                i += 1;
            }
            args
        }
        "stats" => {
            let mut args = vec!["stats".into(), "--format".into(), "json".into(), "--no-stream".into()];
            args.extend(rest.iter().cloned());
            args
        }
        "volume" => {
            let mut args = vec!["volume".into()];
            args.extend(rest.iter().cloned());
            args
        }
        "network" => {
            let mut args = vec!["network".into()];
            args.extend(rest.iter().cloned());
            args
        }
        "system" => {
            let mut args = vec!["system".into()];
            args.extend(rest.iter().cloned());
            args
        }
        "machine" => {
            let mut args = vec!["machine".into()];
            args.extend(rest.iter().cloned());
            args
        }
        "info" => {
            vec!["system".into(), "df".into(), "--format".into(), "json".into()]
        }
        "version" => {
            vec!["--version".into()]
        }
        "login" => {
            let mut args = vec!["registry".into(), "login".into()];
            args.extend(rest.iter().cloned());
            args
        }
        "logout" => {
            let mut args = vec!["registry".into(), "logout".into()];
            args.extend(rest.iter().cloned());
            args
        }
        _ => {
            let mut args = vec![];
            args.extend(parts.iter().cloned());
            args
        }
    }
}

// ==================== Open URL ====================

#[tauri::command]
fn open_url(url: String) -> CommandResult {
    match open::that(&url) {
        Ok(_) => CommandResult {
            success: true,
            stdout: String::new(),
            stderr: String::new(),
        },
        Err(e) => CommandResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to open URL: {e}"),
        },
    }
}

// ==================== Volume Export/Import ====================

#[tauri::command]
async fn export_volume(name: String, output: String) -> CommandResult {
    // Get volume mountpoint
    let inspect = run_container_cmd_async(vec!["volume".into(), "inspect".into(), name.clone()]).await;
    if !inspect.success {
        return CommandResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to inspect volume: {}", inspect.stderr),
        };
    }

    let parsed: Result<Vec<serde_json::Value>, _> = serde_json::from_str(&inspect.stdout);
    let mountpoint = match parsed {
        Ok(arr) if !arr.is_empty() => {
            arr[0].get("configuration")
                .and_then(|c| c.get("source"))
                .and_then(|v| v.as_str())
                .or_else(|| arr[0].get("Mountpoint").and_then(|v| v.as_str()))
                .unwrap_or("")
                .to_string()
        }
        _ => {
            return CommandResult {
                success: false,
                stdout: String::new(),
                stderr: "Could not determine volume mountpoint".to_string(),
            };
        }
    };

    if mountpoint.is_empty() {
        return CommandResult {
            success: false,
            stdout: String::new(),
            stderr: "Volume mountpoint is empty".to_string(),
        };
    }

    // Create parent directory if needed
    if let Some(parent) = std::path::Path::new(&output).parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    // Tar the volume data
    let mountpoint_clone = mountpoint.clone();
    let output_clone = output.clone();
    tokio::task::spawn_blocking(move || {
        let result = std::process::Command::new("tar")
            .args(["-cf", &output_clone, "-C", &mountpoint_clone, "."])
            .output();
        match result {
            Ok(output) => CommandResult {
                success: output.status.success(),
                stdout: String::new(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            },
            Err(e) => CommandResult {
                success: false,
                stdout: String::new(),
                stderr: format!("Failed to create tar: {e}"),
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
async fn import_volume(name: String, input: String) -> CommandResult {
    // Create the volume
    let create = run_container_cmd_async(vec!["volume".into(), "create".into(), name.clone()]).await;
    if !create.success {
        return CommandResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to create volume: {}", create.stderr),
        };
    }

    // Get the new volume's mountpoint
    let inspect = run_container_cmd_async(vec!["volume".into(), "inspect".into(), name.clone()]).await;
    if !inspect.success {
        return CommandResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to inspect created volume: {}", inspect.stderr),
        };
    }

    let parsed: Result<Vec<serde_json::Value>, _> = serde_json::from_str(&inspect.stdout);
    let mountpoint = match parsed {
        Ok(arr) if !arr.is_empty() => {
            arr[0].get("configuration")
                .and_then(|c| c.get("source"))
                .and_then(|v| v.as_str())
                .or_else(|| arr[0].get("Mountpoint").and_then(|v| v.as_str()))
                .unwrap_or("")
                .to_string()
        }
        _ => {
            return CommandResult {
                success: false,
                stdout: String::new(),
                stderr: "Could not determine volume mountpoint".to_string(),
            };
        }
    };

    if mountpoint.is_empty() {
        return CommandResult {
            success: false,
            stdout: String::new(),
            stderr: "Volume mountpoint is empty".to_string(),
        };
    }

    // Extract tar to volume mountpoint
    let mountpoint_clone = mountpoint.clone();
    let input_clone = input.clone();
    tokio::task::spawn_blocking(move || {
        let result = std::process::Command::new("tar")
            .args(["-xf", &input_clone, "-C", &mountpoint_clone])
            .output();
        match result {
            Ok(output) => CommandResult {
                success: output.status.success(),
                stdout: format!("Volume '{name}' imported successfully"),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            },
            Err(e) => CommandResult {
                success: false,
                stdout: String::new(),
                stderr: format!("Failed to extract tar: {e}"),
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

// ==================== Batch Migration ====================

#[tauri::command]
async fn export_migration(
    images: Vec<String>,
    volumes: Vec<String>,
    containers: Vec<String>,
    output_dir: String,
) -> CommandResult {
    use std::path::PathBuf;

    let out = PathBuf::from(&output_dir);
    let images_dir = out.join("images");
    let volumes_dir = out.join("volumes");
    let containers_dir = out.join("containers");

    // Create directories
    let _ = std::fs::create_dir_all(&images_dir);
    let _ = std::fs::create_dir_all(&volumes_dir);
    let _ = std::fs::create_dir_all(&containers_dir);

    let mut manifest_images = Vec::new();
    let mut manifest_volumes = Vec::new();
    let mut manifest_containers = Vec::new();
    let mut errors = Vec::new();

    // Export images
    for img in &images {
        let safe_name = img.replace('/', "_").replace(':', "_");
        let tar_path = images_dir.join(format!("{safe_name}.tar"));
        let tar_str = tar_path.to_string_lossy().to_string();

        let result = run_container_cmd_async(vec![
            "image".into(), "save".into(), "-o".into(), tar_str.clone(), img.clone()
        ]).await;

        if result.success {
            let size = std::fs::metadata(&tar_path).map(|m| m.len()).unwrap_or(0);
            manifest_images.push(serde_json::json!({
                "name": img,
                "file": format!("images/{safe_name}.tar"),
                "size": size,
            }));
        } else {
            errors.push(format!("Failed to export image {img}: {}", result.stderr));
        }
    }

    // Export volumes
    for vol in &volumes {
        let tar_path = volumes_dir.join(format!("{vol}.tar"));
        let tar_str = tar_path.to_string_lossy().to_string();

        // Get mountpoint
        let inspect = run_container_cmd_async(vec!["volume".into(), "inspect".into(), vol.clone()]).await;
        if !inspect.success {
            errors.push(format!("Failed to inspect volume {vol}: {}", inspect.stderr));
            continue;
        }

        let parsed: Result<Vec<serde_json::Value>, _> = serde_json::from_str(&inspect.stdout);
        let mountpoint = match parsed {
            Ok(arr) if !arr.is_empty() => {
                arr[0].get("configuration")
                    .and_then(|c| c.get("source"))
                    .and_then(|v| v.as_str())
                    .or_else(|| arr[0].get("Mountpoint").and_then(|v| v.as_str()))
                    .unwrap_or("")
                    .to_string()
            }
            _ => {
                errors.push(format!("Could not determine mountpoint for volume {vol}"));
                continue;
            }
        };

        if mountpoint.is_empty() {
            errors.push(format!("Empty mountpoint for volume {vol}"));
            continue;
        }

        let mountpoint_clone = mountpoint.clone();
        let tar_str_clone = tar_str.clone();
        let tar_result = tokio::task::spawn_blocking(move || {
            std::process::Command::new("tar")
                .args(["-cf", &tar_str_clone, "-C", &mountpoint_clone, "."])
                .output()
        })
        .await;

        match tar_result {
            Ok(Ok(output)) if output.status.success() => {
                let size = std::fs::metadata(&tar_path).map(|m| m.len()).unwrap_or(0);
                manifest_volumes.push(serde_json::json!({
                    "name": vol,
                    "file": format!("volumes/{vol}.tar"),
                    "size": size,
                }));
            }
            _ => {
                errors.push(format!("Failed to export volume {vol}"));
            }
        }
    }

    // Export containers
    for container_id in &containers {
        // Inspect container to get config
        let inspect = run_container_cmd_async(vec!["inspect".into(), container_id.clone()]).await;
        if !inspect.success {
            errors.push(format!("Failed to inspect container {container_id}: {}", inspect.stderr));
            continue;
        }

        let parsed: Result<Vec<serde_json::Value>, _> = serde_json::from_str(&inspect.stdout);
        let config = match parsed {
            Ok(arr) if !arr.is_empty() => arr[0].clone(),
            _ => {
                errors.push(format!("Could not parse container config for {container_id}"));
                continue;
            }
        };

        // Extract container name
        let name = config.get("configuration")
            .and_then(|c| c.get("id"))
            .and_then(|v| v.as_str())
            .unwrap_or(container_id)
            .to_string();

        // Save container config
        let config_path = containers_dir.join(format!("{name}.json"));
        let _ = std::fs::write(&config_path, serde_json::to_string_pretty(&config).unwrap_or_default());

        // Export container filesystem
        let fs_tar_path = containers_dir.join(format!("{name}.fs.tar"));
        let fs_tar_str = fs_tar_path.to_string_lossy().to_string();
        let container_id_clone = container_id.clone();
        let export_result = tokio::task::spawn_blocking(move || {
            std::process::Command::new("/usr/local/bin/container")
                .args(["export", "-o", &fs_tar_str, &container_id_clone])
                .output()
        })
        .await;

        let fs_size = match export_result {
            Ok(Ok(output)) if output.status.success() => {
                std::fs::metadata(&fs_tar_path).map(|m| m.len()).unwrap_or(0)
            }
            _ => {
                errors.push(format!("Failed to export container filesystem for {container_id}"));
                0
            }
        };

        let config_size = std::fs::metadata(&config_path).map(|m| m.len()).unwrap_or(0);
        manifest_containers.push(serde_json::json!({
            "id": container_id,
            "name": name,
            "config_file": format!("containers/{name}.json"),
            "config_size": config_size,
            "filesystem_file": format!("containers/{name}.fs.tar"),
            "filesystem_size": fs_size,
        }));
    }

    // Write manifest
    let manifest = serde_json::json!({
        "version": "1.0",
        "created": format!("{:?}", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()),
        "images": manifest_images,
        "volumes": manifest_volumes,
        "containers": manifest_containers,
    });

    let manifest_path = out.join("manifest.json");
    let _ = std::fs::write(&manifest_path, serde_json::to_string_pretty(&manifest).unwrap_or_default());

    if errors.is_empty() {
        CommandResult {
            success: true,
            stdout: format!("Migration exported to {output_dir}"),
            stderr: String::new(),
        }
    } else {
        CommandResult {
            success: !manifest_images.is_empty() || !manifest_volumes.is_empty(),
            stdout: format!("Exported {} images, {} volumes, {} containers",
                manifest_images.len(), manifest_volumes.len(), manifest_containers.len()),
            stderr: errors.join("\n"),
        }
    }
}

#[tauri::command]
async fn import_migration(
    input_dir: String,
    import_images: bool,
    import_volumes: bool,
    import_containers: bool,
) -> CommandResult {
    use std::path::PathBuf;

    let inp = PathBuf::from(&input_dir);
    let manifest_path = inp.join("manifest.json");

    // Read manifest
    let manifest_str = match std::fs::read_to_string(&manifest_path) {
        Ok(s) => s,
        Err(e) => {
            return CommandResult {
                success: false,
                stdout: String::new(),
                stderr: format!("Failed to read manifest.json: {e}"),
            };
        }
    };

    let manifest: serde_json::Value = match serde_json::from_str(&manifest_str) {
        Ok(v) => v,
        Err(e) => {
            return CommandResult {
                success: false,
                stdout: String::new(),
                stderr: format!("Failed to parse manifest.json: {e}"),
            };
        }
    };

    let mut imported_images = 0;
    let mut imported_volumes = 0;
    let mut imported_containers = 0;
    let mut errors = Vec::new();

    // Import images
    if import_images {
        if let Some(imgs) = manifest.get("images").and_then(|v| v.as_array()) {
            for img in imgs {
                let file = img.get("file").and_then(|v| v.as_str()).unwrap_or("");
                let tar_path = inp.join(file);

                if !tar_path.exists() {
                    errors.push(format!("Image tar not found: {file}"));
                    continue;
                }

                let tar_str = tar_path.to_string_lossy().to_string();
                let result = run_container_cmd_async(vec![
                    "image".into(), "load".into(), "-i".into(), tar_str
                ]).await;

                if result.success {
                    imported_images += 1;
                } else {
                    errors.push(format!("Failed to import image: {}", result.stderr));
                }
            }
        }
    }

    // Import volumes
    if import_volumes {
        if let Some(vols) = manifest.get("volumes").and_then(|v| v.as_array()) {
            for vol in vols {
                let name = vol.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let file = vol.get("file").and_then(|v| v.as_str()).unwrap_or("");
                let tar_path = inp.join(file);

                if !tar_path.exists() {
                    errors.push(format!("Volume tar not found: {file}"));
                    continue;
                }

                // Create volume
                let create = run_container_cmd_async(vec![
                    "volume".into(), "create".into(), name.to_string()
                ]).await;

                if !create.success {
                    errors.push(format!("Failed to create volume {name}: {}", create.stderr));
                    continue;
                }

                // Get mountpoint
                let inspect = run_container_cmd_async(vec![
                    "volume".into(), "inspect".into(), name.to_string()
                ]).await;

                let parsed: Result<Vec<serde_json::Value>, _> = serde_json::from_str(&inspect.stdout);
                let mountpoint = match parsed {
                    Ok(arr) if !arr.is_empty() => {
                        arr[0].get("configuration")
                            .and_then(|c| c.get("source"))
                            .and_then(|v| v.as_str())
                            .or_else(|| arr[0].get("Mountpoint").and_then(|v| v.as_str()))
                            .unwrap_or("")
                            .to_string()
                    }
                    _ => {
                        errors.push(format!("Could not determine mountpoint for volume {name}"));
                        continue;
                    }
                };

                // Extract tar
                let tar_str = tar_path.to_string_lossy().to_string();
                let mountpoint_clone = mountpoint.clone();
                let extract_result = tokio::task::spawn_blocking(move || {
                    std::process::Command::new("tar")
                        .args(["-xf", &tar_str, "-C", &mountpoint_clone])
                        .output()
                })
                .await;

                match extract_result {
                    Ok(Ok(output)) if output.status.success() => {
                        imported_volumes += 1;
                    }
                    _ => {
                        errors.push(format!("Failed to extract volume {name}"));
                    }
                }
            }
        }
    }

    // Import containers
    if import_containers {
        if let Some(containers) = manifest.get("containers").and_then(|v| v.as_array()) {
            for container in containers {
                let name = container.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let config_file = container.get("config_file").and_then(|v| v.as_str()).unwrap_or("");

                // Read container config
                let config_path = inp.join(config_file);
                if !config_path.exists() {
                    errors.push(format!("Container config not found: {config_file}"));
                    continue;
                }

                let config_str = match std::fs::read_to_string(&config_path) {
                    Ok(s) => s,
                    Err(e) => {
                        errors.push(format!("Failed to read container config {config_file}: {e}"));
                        continue;
                    }
                };

                let config: serde_json::Value = match serde_json::from_str(&config_str) {
                    Ok(v) => v,
                    Err(e) => {
                        errors.push(format!("Failed to parse container config {config_file}: {e}"));
                        continue;
                    }
                };

                // Extract container creation parameters from config
                let image_ref = config.get("configuration")
                    .and_then(|c| c.get("image"))
                    .and_then(|i| i.get("reference"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                if image_ref.is_empty() {
                    errors.push(format!("No image reference in container config for {name}"));
                    continue;
                }

                // Build create command args
                let mut args: Vec<String> = vec!["create".into(), "--name".into(), name.to_string()];

                // Add environment variables
                if let Some(env) = config.get("configuration")
                    .and_then(|c| c.get("initProcess"))
                    .and_then(|p| p.get("environment")) {
                    if let Some(env_arr) = env.as_array() {
                        for e in env_arr {
                            if let Some(s) = e.as_str() {
                                args.push("-e".into());
                                args.push(s.to_string());
                            }
                        }
                    }
                }

                // Add port mappings
                if let Some(ports) = config.get("configuration")
                    .and_then(|c| c.get("publishedPorts")) {
                    if let Some(ports_arr) = ports.as_array() {
                        for port in ports_arr {
                            if let (Some(host), Some(container)) = (
                                port.get("hostPort").and_then(|v| v.as_u64()),
                                port.get("containerPort").and_then(|v| v.as_u64())
                            ) {
                                args.push("-p".into());
                                args.push(format!("{}:{}", host, container));
                            }
                        }
                    }
                }

                // Add volume mounts
                if let Some(mounts) = config.get("configuration")
                    .and_then(|c| c.get("mounts")) {
                    if let Some(mounts_arr) = mounts.as_array() {
                        for mount in mounts_arr {
                            if let Some(source) = mount.get("source").and_then(|v| v.as_str()) {
                                if let Some(destination) = mount.get("destination").and_then(|v| v.as_str()) {
                                    args.push("-v".into());
                                    args.push(format!("{}:{}", source, destination));
                                }
                            }
                        }
                    }
                }

                // Add resource limits
                if let Some(resources) = config.get("configuration")
                    .and_then(|c| c.get("resources")) {
                    if let Some(cpus) = resources.get("cpus").and_then(|v| v.as_f64()) {
                        args.push("-c".into());
                        args.push(cpus.to_string());
                    }
                    if let Some(memory) = resources.get("memoryInBytes").and_then(|v| v.as_u64()) {
                        args.push("-m".into());
                        args.push(format!("{}b", memory));
                    }
                }

                // Add image
                args.push(image_ref.to_string());

                // Create container
                let create_result = run_container_cmd_async(args).await;
                if !create_result.success {
                    errors.push(format!("Failed to create container {name}: {}", create_result.stderr));
                    continue;
                }

                // Import filesystem if available
                let fs_file = container.get("filesystem_file").and_then(|v| v.as_str()).unwrap_or("");
                let fs_tar_path = inp.join(fs_file);
                if fs_tar_path.exists() {
                    // Use container import to restore filesystem
                    let fs_tar_str = fs_tar_path.to_string_lossy().to_string();
                    let import_result = run_container_cmd_async(vec![
                        "import".into(), fs_tar_str, name.to_string()
                    ]).await;

                    if !import_result.success {
                        errors.push(format!("Failed to import filesystem for container {name}: {}", import_result.stderr));
                    }
                }

                imported_containers += 1;
            }
        }
    }

    if errors.is_empty() {
        CommandResult {
            success: true,
            stdout: format!("Imported {imported_images} images, {imported_volumes} volumes, {imported_containers} containers"),
            stderr: String::new(),
        }
    } else {
        CommandResult {
            success: imported_images > 0 || imported_volumes > 0 || imported_containers > 0,
            stdout: format!("Imported {imported_images} images, {imported_volumes} volumes, {imported_containers} containers"),
            stderr: errors.join("\n"),
        }
    }
}

// ==================== Docker Import ====================

fn run_docker_cmd(args: Vec<String>) -> CommandResult {
    let path = "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:/opt/homebrew/sbin";
    let cmd_str = args.join(" ");
    log_to_file(&format!("Running: docker {cmd_str}"));

    let output = std::process::Command::new("docker")
        .args(&args)
        .env("PATH", path)
        .env_remove("DOCKER_HOST")
        .output();

    match output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            log_to_file(&format!("docker {} => ok={}, out={}b, err={}", cmd_str, output.status.success(), stdout.len(), stderr));
            CommandResult {
                success: output.status.success(),
                stdout,
                stderr,
            }
        }
        Err(e) => {
            log_to_file(&format!("docker {} => ERR: {e}", cmd_str));
            CommandResult {
                success: false,
                stdout: String::new(),
                stderr: format!("Failed to execute docker: {e}"),
            }
        }
    }
}

async fn run_docker_cmd_async(args: Vec<String>) -> CommandResult {
    tokio::task::spawn_blocking(move || run_docker_cmd(args))
        .await
        .unwrap_or_else(|e| CommandResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Task failed: {e}"),
        })
}

#[tauri::command]
async fn docker_list_all() -> CommandResult {
    log_to_file("docker_list_all: starting");

    let img_result = run_docker_cmd_async(vec![
        "images".into(), "--format".into(), "json".into()
    ]).await;

    let vol_result = run_docker_cmd_async(vec![
        "volume".into(), "ls".into(), "--format".into(), "json".into()
    ]).await;

    let ctr_result = run_docker_cmd_async(vec![
        "ps".into(), "-a".into(), "--format".into(), "json".into()
    ]).await;

    log_to_file(&format!("docker_list_all: img_ok={}, vol_ok={}, ctr_ok={}",
        img_result.success, vol_result.success, ctr_result.success));

    // Parse images
    let mut images = Vec::new();
    if img_result.success {
        // Get image detailed sizes from docker system df -v
        let df_result = run_docker_cmd_async(vec![
            "system".into(), "df".into(), "-v".into()
        ]).await;

        let mut image_sizes: std::collections::HashMap<String, (String, String)> = std::collections::HashMap::new();
        if df_result.success {
            let mut in_image_section = false;
            for line in df_result.stdout.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("REPOSITORY") && trimmed.contains("UNIQUE SIZE") {
                    in_image_section = true;
                    continue;
                }
                if in_image_section && !trimmed.is_empty() {
                    let parts: Vec<&str> = trimmed.split_whitespace().collect();
                    // Format: repo tag id created size shared_size unique_size containers
                    if parts.len() >= 7 {
                        let id = parts[2];
                        let unique_size = parts[6];
                        // Find SIZE (column 5, 0-indexed)
                        let size = parts[4];
                        image_sizes.insert(id.to_string(), (size.to_string(), unique_size.to_string()));
                    }
                }
                if in_image_section && trimmed.is_empty() && !image_sizes.is_empty() {
                    break;
                }
            }
        }

        for line in img_result.stdout.lines() {
            if line.trim().is_empty() { continue; }
            if let Ok(obj) = serde_json::from_str::<serde_json::Value>(line) {
                let repo = obj.get("Repository").and_then(|v| v.as_str()).unwrap_or("");
                let tag = obj.get("Tag").and_then(|v| v.as_str()).unwrap_or("latest");
                let id = obj.get("ID").and_then(|v| v.as_str()).unwrap_or("");
                if !repo.is_empty() && repo != "<none>" {
                    let (virtual_size, unique_size) = image_sizes.get(id).cloned().unwrap_or_default();
                    images.push(serde_json::json!({
                        "Repository": repo, "Tag": tag, "Size": virtual_size, "UniqueSize": unique_size, "ID": id,
                    }));
                }
            }
        }
    }
    log_to_file(&format!("docker_list_all: parsed {} images", images.len()));

    // Parse volumes
    let mut volumes = Vec::new();
    if vol_result.success {
        // Get volume sizes from docker system df -v
        let df_result = run_docker_cmd_async(vec![
            "system".into(), "df".into(), "-v".into()
        ]).await;

        let mut volume_sizes: std::collections::HashMap<String, String> = std::collections::HashMap::new();
        if df_result.success {
            let mut in_volume_section = false;
            for line in df_result.stdout.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("VOLUME NAME") {
                    in_volume_section = true;
                    continue;
                }
                if in_volume_section && !trimmed.is_empty() {
                    // Format: "name    links    size"
                    let parts: Vec<&str> = trimmed.split_whitespace().collect();
                    if parts.len() >= 3 {
                        let name = parts[0].to_string();
                        let size = parts[2].to_string();
                        volume_sizes.insert(name, size);
                    }
                }
                if in_volume_section && trimmed.is_empty() && !volume_sizes.is_empty() {
                    break;
                }
            }
        }

        for line in vol_result.stdout.lines() {
            if line.trim().is_empty() { continue; }
            if let Ok(obj) = serde_json::from_str::<serde_json::Value>(line) {
                let name = obj.get("Name").and_then(|v| v.as_str()).unwrap_or("");
                let driver = obj.get("Driver").and_then(|v| v.as_str()).unwrap_or("local");
                if !name.is_empty() {
                    let size = volume_sizes.get(name).cloned().unwrap_or_default();
                    volumes.push(serde_json::json!({
                        "Name": name, "Driver": driver, "Size": size,
                    }));
                }
            }
        }
    }
    log_to_file(&format!("docker_list_all: parsed {} volumes", volumes.len()));

    // Parse containers
    let mut containers = Vec::new();
    let mut volume_usage: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    let mut image_usage: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    if ctr_result.success {
        for line in ctr_result.stdout.lines() {
            if line.trim().is_empty() { continue; }
            if let Ok(obj) = serde_json::from_str::<serde_json::Value>(line) {
                let id = obj.get("ID").and_then(|v| v.as_str()).unwrap_or("");
                let names = obj.get("Names").and_then(|v| v.as_str()).unwrap_or("");
                let image = obj.get("Image").and_then(|v| v.as_str()).unwrap_or("");
                // Track image usage
                if !image.is_empty() {
                    let name_clean = names.trim_start_matches('/').to_string();
                    image_usage.entry(image.to_string()).or_default().push(name_clean);
                }
                // Extract volume mounts from Mounts field
                let mut mounts = Vec::new();
                if let Some(mounts_str) = obj.get("Mounts").and_then(|v| v.as_str()) {
                    for mount in mounts_str.split(",") {
                        let mount = mount.trim();
                        if mount.is_empty() { continue; }
                        // Mount format: "volume_name:/container_path" or "source:/container_path:ro"
                        if let Some(parts) = mount.split(':').next() {
                            let vol_name = parts.trim().to_string();
                            if !vol_name.is_empty() && !vol_name.starts_with('/') {
                                mounts.push(vol_name.clone());
                                volume_usage.entry(vol_name).or_default().push(names.trim_start_matches('/').to_string());
                            }
                        }
                    }
                }
                containers.push(serde_json::json!({
                    "ID": id,
                    "Image": obj.get("Image").and_then(|v| v.as_str()).unwrap_or(""),
                    "Names": names,
                    "State": obj.get("State").and_then(|v| v.as_str()).unwrap_or(""),
                    "Status": obj.get("Status").and_then(|v| v.as_str()).unwrap_or(""),
                    "Mounts": mounts,
                }));
            }
        }
    }
    log_to_file(&format!("docker_list_all: parsed {} containers", containers.len()));

    let combined = serde_json::json!({
        "images": images,
        "volumes": volumes,
        "containers": containers,
        "volumeUsage": volume_usage,
        "imageUsage": image_usage,
        "dockerAvailable": img_result.success || vol_result.success || ctr_result.success,
    });

    CommandResult {
        success: true,
        stdout: serde_json::to_string(&combined).unwrap_or_default(),
        stderr: String::new(),
    }
}

#[tauri::command]
async fn import_docker_image(reference: String) -> CommandResult {
    // Check if docker is available
    let check = run_docker_cmd_async(vec!["--version".into()]).await;
    if !check.success {
        return CommandResult {
            success: false,
            stdout: String::new(),
            stderr: "Docker is not installed or not in PATH".to_string(),
        };
    }

    // Save Docker image to temp file
    let temp_dir = std::env::temp_dir();
    let safe_name = reference.replace('/', "_").replace(':', "_");
    let tar_path = temp_dir.join(format!("docker_img_{safe_name}.tar"));
    let tar_str = tar_path.to_string_lossy().to_string();

    log_to_file(&format!("Saving Docker image {reference} to {tar_str}"));
    let save_result = run_docker_cmd_async(vec![
        "save".into(), "-o".into(), tar_str.clone(), reference.clone()
    ]).await;

    if !save_result.success {
        return CommandResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to save Docker image: {}", save_result.stderr),
        };
    }

    // Load into Apple Container
    log_to_file(&format!("Loading image into Apple Container"));
    let load_result = run_container_cmd_async(vec![
        "image".into(), "load".into(), "-i".into(), tar_str.clone()
    ]).await;

    // Clean up temp file
    let _ = std::fs::remove_file(&tar_path);

    if load_result.success {
        CommandResult {
            success: true,
            stdout: format!("Image '{reference}' imported from Docker to Apple Container"),
            stderr: String::new(),
        }
    } else {
        CommandResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to load into Apple Container: {}", load_result.stderr),
        }
    }
}

#[tauri::command]
async fn import_docker_volume(name: String) -> CommandResult {
    // Check if docker is available
    let check = run_docker_cmd_async(vec!["--version".into()]).await;
    if !check.success {
        return CommandResult {
            success: false,
            stdout: String::new(),
            stderr: "Docker is not installed or not in PATH".to_string(),
        };
    }

    // Create a temporary container to access the volume data
    let temp_container = format!("__migration_{name}");
    log_to_file(&format!("Creating temp container for volume {name}"));

    // Find a busybox image to use
    let busybox_check = run_docker_cmd_async(vec!["image".into(), "inspect".into(), "busybox:latest".into()]).await;
    let busybox_image = if busybox_check.success {
        "busybox:latest"
    } else {
        // Try to pull busybox
        let pull = run_docker_cmd_async(vec!["pull".into(), "busybox:latest".into()]).await;
        if pull.success {
            "busybox:latest"
        } else {
            return CommandResult {
                success: false,
                stdout: String::new(),
                stderr: "Failed to find or pull busybox image for volume export".to_string(),
            };
        }
    };

    // Create temp container with the Docker volume
    let create_result = run_docker_cmd_async(vec![
        "create".into(),
        "--name".into(), temp_container.clone(),
        "-v".into(), format!("{name}:/data:ro"),
        busybox_image.into(),
        "true".into(),
    ]).await;

    if !create_result.success {
        return CommandResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to create temp container: {}", create_result.stderr),
        };
    }

    // Export the volume data
    let temp_dir = std::env::temp_dir();
    let tar_path = temp_dir.join(format!("docker_vol_{name}.tar"));
    let tar_str = tar_path.to_string_lossy().to_string();

    log_to_file(&format!("Exporting Docker volume {name}"));
    let export_result = run_docker_cmd_async(vec![
        "cp".into(),
        format!("{temp_container}:/data/."),
        tar_str.clone(),
    ]).await;

    // Remove temp container
    let _ = run_docker_cmd_async(vec!["rm".into(), "-f".into(), temp_container.clone()]).await;

    if !export_result.success {
        let _ = std::fs::remove_file(&tar_path);
        return CommandResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to export Docker volume: {}", export_result.stderr),
        };
    }

    // Create Apple Container volume and import data
    let create_vol = run_container_cmd_async(vec![
        "volume".into(), "create".into(), name.clone()
    ]).await;

    if !create_vol.success {
        let _ = std::fs::remove_file(&tar_path);
        return CommandResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to create Apple Container volume: {}", create_vol.stderr),
        };
    }

    // Get the mountpoint
    let inspect = run_container_cmd_async(vec![
        "volume".into(), "inspect".into(), name.clone()
    ]).await;

    let parsed: Result<Vec<serde_json::Value>, _> = serde_json::from_str(&inspect.stdout);
    let mountpoint = match parsed {
        Ok(arr) if !arr.is_empty() => {
            arr[0].get("configuration")
                .and_then(|c| c.get("source"))
                .and_then(|v| v.as_str())
                .or_else(|| arr[0].get("Mountpoint").and_then(|v| v.as_str()))
                .unwrap_or("")
                .to_string()
        }
        _ => {
            let _ = std::fs::remove_file(&tar_path);
            return CommandResult {
                success: false,
                stdout: String::new(),
                stderr: "Could not determine volume mountpoint".to_string(),
            };
        }
    };

    // Extract tar to mountpoint
    let tar_str_clone = tar_str.clone();
    let mountpoint_clone = mountpoint.clone();
    let extract_result = tokio::task::spawn_blocking(move || {
        std::process::Command::new("tar")
            .args(["-xf", &tar_str_clone, "-C", &mountpoint_clone])
            .output()
    })
    .await;

    let _ = std::fs::remove_file(&tar_path);

    match extract_result {
        Ok(Ok(output)) if output.status.success() => {
            CommandResult {
                success: true,
                stdout: format!("Volume '{name}' imported from Docker to Apple Container"),
                stderr: String::new(),
            }
        }
        _ => {
            CommandResult {
                success: false,
                stdout: String::new(),
                stderr: "Failed to extract volume data".to_string(),
            }
        }
    }
}

#[tauri::command]
async fn import_docker_container(id: String, image: String) -> CommandResult {
    // Check docker is available
    let check = run_docker_cmd_async(vec!["--version".into()]).await;
    if !check.success {
        return CommandResult {
            success: false,
            stdout: String::new(),
            stderr: "Docker is not installed or not in PATH".to_string(),
        };
    }

    // First, import the Docker image into Apple Container
    let img_import = import_docker_image(image.clone()).await;
    if !img_import.success {
        return CommandResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to import image: {}", img_import.stderr),
        };
    }

    // Get container config from Docker
    let inspect = run_docker_cmd_async(vec![
        "inspect".into(), id.clone()
    ]).await;

    if !inspect.success {
        return CommandResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to inspect Docker container: {}", inspect.stderr),
        };
    }

    let parsed: Result<Vec<serde_json::Value>, _> = serde_json::from_str(&inspect.stdout);
    let config = match parsed {
        Ok(arr) if !arr.is_empty() => arr[0].clone(),
        _ => {
            return CommandResult {
                success: false,
                stdout: String::new(),
                stderr: "Could not parse Docker container config".to_string(),
            };
        }
    };

    // Extract container name
    let name = config.get("Name").and_then(|v| v.as_str())
        .unwrap_or(&id).trim_start_matches('/').to_string();

    // Build create command args from Docker config
    let mut args: Vec<String> = vec!["create".into(), "--name".into(), name.clone()];

    // Environment variables
    if let Some(env) = config.get("Config").and_then(|c| c.get("Env")).and_then(|e| e.as_array()) {
        for e in env {
            if let Some(s) = e.as_str() {
                args.push("-e".into());
                args.push(s.to_string());
            }
        }
    }

    // Port mappings from HostConfig
    if let Some(port_bindings) = config.get("HostConfig").and_then(|h| h.get("PortBindings")) {
        if let Some(obj) = port_bindings.as_object() {
            for (container_port, bindings) in obj {
                if let Some(arr) = bindings.as_array() {
                    for binding in arr {
                        if let Some(host_port) = binding.get("HostPort").and_then(|v| v.as_str()) {
                            args.push("-p".into());
                            args.push(format!("{}:{}", host_port, container_port.replace("/tcp", "")));
                        }
                    }
                }
            }
        }
    }

    // Volume mounts from HostConfig
    if let Some(binds) = config.get("HostConfig").and_then(|h| h.get("Binds")).and_then(|b| b.as_array()) {
        for bind in binds {
            if let Some(s) = bind.as_str() {
                args.push("-v".into());
                args.push(s.to_string());
            }
        }
    }

    // Working directory
    if let Some(wd) = config.get("Config").and_then(|c| c.get("WorkingDir")).and_then(|v| v.as_str()) {
        if !wd.is_empty() {
            args.push("-w".into());
            args.push(wd.to_string());
        }
    }

    // Add image
    args.push(image.clone());

    // Create container
    let create_result = run_container_cmd_async(args).await;
    if !create_result.success {
        return CommandResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to create container: {}", create_result.stderr),
        };
    }

    CommandResult {
        success: true,
        stdout: format!("Container '{name}' imported from Docker"),
        stderr: String::new(),
    }
}

// ==================== Docker Socket Path ====================

#[tauri::command]
fn get_docker_socket_path(app: tauri::AppHandle) -> String {
    let socket_dir = app.path().app_data_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    socket_dir.join("docker.sock").to_string_lossy().to_string()
}

// ==================== Socktainer Management ====================

const SOCKTAINER_BIN: &str = "/opt/socktainer/bin/socktainer";
const SOCKTAINER_SOCKET: &str = "/Users/yan.yang/.socktainer/container.sock";

#[tauri::command]
fn is_socktainer_installed() -> bool {
    std::path::Path::new(SOCKTAINER_BIN).exists()
}

#[tauri::command]
fn is_socktainer_running() -> bool {
    std::process::Command::new("pgrep")
        .arg("-f")
        .arg("socktainer")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[tauri::command]
fn start_socktainer() -> CommandResult {
    if !std::path::Path::new(SOCKTAINER_BIN).exists() {
        return CommandResult {
            success: false,
            stdout: String::new(),
            stderr: "Socktainer not installed at /opt/socktainer/bin/socktainer".to_string(),
        };
    }

    // Check if already running
    if is_socktainer_running() {
        return CommandResult {
            success: true,
            stdout: "Socktainer already running".to_string(),
            stderr: String::new(),
        };
    }

    // Start socktainer in background
    match std::process::Command::new(SOCKTAINER_BIN)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        Ok(_) => {
            // Wait a bit for socket to be created
            std::thread::sleep(std::time::Duration::from_millis(500));
            if std::path::Path::new(SOCKTAINER_SOCKET).exists() {
                CommandResult {
                    success: true,
                    stdout: format!("Socktainer started, socket at {SOCKTAINER_SOCKET}"),
                    stderr: String::new(),
                }
            } else {
                CommandResult {
                    success: false,
                    stdout: String::new(),
                    stderr: "Socktainer started but socket not found".to_string(),
                }
            }
        }
        Err(e) => CommandResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to start socktainer: {e}"),
        },
    }
}

#[tauri::command]
fn stop_socktainer() -> CommandResult {
    match std::process::Command::new("pkill")
        .arg("-f")
        .arg("socktainer")
        .output()
    {
        Ok(_) => CommandResult {
            success: true,
            stdout: "Socktainer stopped".to_string(),
            stderr: String::new(),
        },
        Err(e) => CommandResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to stop socktainer: {e}"),
        },
    }
}

#[tauri::command]
fn get_socktainer_socket_path() -> String {
    SOCKTAINER_SOCKET.to_string()
}

#[tauri::command]
fn open_terminal() -> CommandResult {
    let docker_host = format!("unix://{}", SOCKTAINER_SOCKET);
    
    let script = format!(
        "tell application \"Terminal\"\n\
         activate\n\
         do script \"export DOCKER_HOST='{}'\"\n\
         end tell",
        docker_host
    );
    
    log_to_file(&format!("Opening terminal with DOCKER_HOST={}", docker_host));
    
    match std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
    {
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            log_to_file(&format!("osascript stderr: {}", stderr));
            
            if stderr.is_empty() {
                CommandResult {
                    success: true,
                    stdout: "Terminal opened".to_string(),
                    stderr: String::new(),
                }
            } else {
                CommandResult {
                    success: false,
                    stdout: String::new(),
                    stderr,
                }
            }
        }
        Err(e) => {
            log_to_file(&format!("Failed to run osascript: {}", e));
            CommandResult {
                success: false,
                stdout: String::new(),
                stderr: format!("Failed to run osascript: {}", e),
            }
        }
    }
}

// ==================== Raw Command Execution ====================

fn format_docker_output(original_cmd: &str, result: &CommandResult) -> String {
    if !result.success || result.stdout.trim().is_empty() {
        return result.stdout.clone();
    }

    // Only format docker command outputs
    if !original_cmd.starts_with("docker ") {
        return result.stdout.clone();
    }

    let words: Vec<&str> = original_cmd.split_whitespace().collect();

    // Detect the actual operation: docker images, docker image ls, docker ps, docker container ls, etc.
    let is_images_cmd = words.contains(&"images")
        || (words.contains(&"image") && words.contains(&"ls"));
    let is_containers_cmd = words.contains(&"ps")
        || (words.contains(&"container") && words.contains(&"ls"));
    let is_version_cmd = words.contains(&"version");
    let is_info_cmd = words.contains(&"info");

    if is_images_cmd {
        let raw_items: Vec<serde_json::Value> = match serde_json::from_str(&result.stdout) {
            Ok(v) => v,
            Err(_) => return result.stdout.clone(),
        };
        if raw_items.is_empty() {
            return "REPOSITORY   TAG       IMAGE ID   CREATED   SIZE\n<none>       <none>    <none>     <none>    0B".to_string();
        }

        // Normalize Apple Container format to Docker-like format
        let items: Vec<serde_json::Value> = raw_items.iter().map(|item| {
            // Apple Container: {"id": "...", "configuration": {"name": "...", "creationDate": "...", "descriptor": {"size": ...}}, "variants": [...]}
            // Docker: {"Id": "...", "RepoTags": ["..."], "Created": "...", "Size": ...}
            let id = item.get("id").and_then(|v| v.as_str())
                .or_else(|| item.get("Id").and_then(|v| v.as_str()))
                .unwrap_or("").to_string();
            let name = item.get("configuration").and_then(|c| c.get("name")).and_then(|v| v.as_str())
                .unwrap_or("").to_string();
            let created = item.get("configuration").and_then(|c| c.get("creationDate")).and_then(|v| v.as_str())
                .or_else(|| item.get("Created").and_then(|v| v.as_str()))
                .unwrap_or("").to_string();
            // Size: sum from variants or use Size field
            let size = item.get("Size").and_then(|v| v.as_u64()).unwrap_or_else(|| {
                item.get("variants").and_then(|v| v.as_array()).map(|variants| {
                    variants.iter().filter_map(|v| v.get("size").and_then(|s| s.as_u64())).sum()
                }).unwrap_or(0)
            });

            let repo_tags = if !name.is_empty() {
                serde_json::json!([name])
            } else if let Some(tags) = item.get("RepoTags") {
                tags.clone()
            } else {
                serde_json::json!([])
            };

            serde_json::json!({
                "Id": id,
                "RepoTags": repo_tags,
                "Created": created,
                "Size": size,
            })
        }).collect();

        let mut out = String::new();
        out.push_str(&format!("{:<13} {:<9} {:<11} {:<9} {:<10}\n", "REPOSITORY", "TAG", "IMAGE ID", "CREATED", "SIZE"));
        for item in &items {
            let tags = item.get("RepoTags").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            let id = item.get("Id").and_then(|v| v.as_str()).unwrap_or("<none>");
            let short_id = if id.len() > 12 { &id[..12] } else { id };
            let created = format_timestamp_from_value(item.get("Created").unwrap_or(&serde_json::Value::Null));
            let size = item.get("Size").and_then(|v| v.as_u64()).unwrap_or(0);
            let size_str = format_size(size);

            if tags.is_empty() {
                out.push_str(&format!("{:<13} {:<9} {:<11} {:<9} {:<10}\n", "<none>", "<none>", short_id, created, size_str));
            } else {
                for tag in &tags {
                    let tag_str = tag.as_str().unwrap_or("<none>");
                    let parts: Vec<&str> = tag_str.splitn(2, ':').collect();
                    let repo = parts.get(0).unwrap_or(&"<none>");
                    let tag_name = parts.get(1).unwrap_or(&"latest");
                    out.push_str(&format!("{:<13} {:<9} {:<11} {:<9} {:<10}\n", repo, tag_name, short_id, created, size_str));
                }
            }
        }
        out
    } else if is_containers_cmd {
        let raw_items: Vec<serde_json::Value> = match serde_json::from_str(&result.stdout) {
            Ok(v) => v,
            Err(_) => return result.stdout.clone(),
        };
        if raw_items.is_empty() {
            return "CONTAINER ID   IMAGE   COMMAND   CREATED   STATUS   PORTS   NAMES\n".to_string();
        }

        // Normalize Apple Container format
        let items: Vec<serde_json::Value> = raw_items.iter().map(|item| {
            let id = item.get("id").and_then(|v| v.as_str())
                .or_else(|| item.get("Id").and_then(|v| v.as_str()))
                .unwrap_or("").to_string();
            let image = item.get("configuration").and_then(|c| c.get("image")).and_then(|i| i.get("reference")).and_then(|v| v.as_str())
                .or_else(|| item.get("Image").and_then(|v| v.as_str()))
                .unwrap_or("").to_string();
            let state = item.get("status").and_then(|s| s.get("state")).and_then(|v| v.as_str())
                .or_else(|| item.get("State").and_then(|v| v.as_str()))
                .unwrap_or("unknown").to_string();
            let created = item.get("configuration").and_then(|c| c.get("creationDate")).and_then(|v| v.as_str())
                .or_else(|| item.get("Created").and_then(|v| v.as_str()))
                .unwrap_or("").to_string();
            let names = item.get("status").and_then(|s| s.get("networks")).and_then(|n| n.get(0)).and_then(|n| n.get("hostname")).and_then(|v| v.as_str())
                .or_else(|| item.get("Names").and_then(|n| n.get(0)).and_then(|v| v.as_str()))
                .unwrap_or("").to_string();

            let status = match state.as_str() {
                "running" => format!("Up"),
                "stopped" => "Exited".to_string(),
                s => s.to_string(),
            };

            serde_json::json!({
                "Id": id,
                "Image": image,
                "State": state,
                "Status": status,
                "Created": created,
                "Names": [if names.starts_with('/') { &names[1..] } else { &names }],
            })
        }).collect();

        let mut out = String::new();
        out.push_str(&format!("{:<14} {:<20} {:<20} {:<20} {:<10}\n", "CONTAINER ID", "IMAGE", "STATUS", "CREATED", "NAMES"));
        for item in &items {
            let id = item.get("Id").and_then(|v| v.as_str()).unwrap_or("");
            let short_id = if id.len() > 12 { &id[..12] } else { id };
            let names = item.get("Names").and_then(|v| v.as_array())
                .and_then(|a| a.get(0)).and_then(|v| v.as_str()).unwrap_or("");
            let image = item.get("Image").and_then(|v| v.as_str()).unwrap_or("");
            let status = item.get("Status").and_then(|v| v.as_str()).unwrap_or("");
            let created = format_timestamp_from_value(item.get("Created").unwrap_or(&serde_json::Value::Null));
            out.push_str(&format!("{:<14} {:<20} {:<20} {:<20} {:<10}\n", short_id, image, status, created, names));
        }
        out
    } else if is_version_cmd {
        let data: serde_json::Value = match serde_json::from_str(&result.stdout) {
            Ok(v) => v,
            Err(_) => return result.stdout.clone(),
        };
        let version = data.get("Version").and_then(|v| v.as_str()).unwrap_or("unknown");
        let api = data.get("ApiVersion").and_then(|v| v.as_str()).unwrap_or("unknown");
        let os = data.get("Os").and_then(|v| v.as_str()).unwrap_or("unknown");
        let arch = data.get("Arch").and_then(|v| v.as_str()).unwrap_or("unknown");
        format!("Client: Docker Engine - Apple Container\n Version:           {version}\n API version:       {api}\n\nServer: Apple Container\n Version:           {version}\n API version:       {api}\n OS/Arch:           {os}/{arch}\n")
    } else if is_info_cmd {
        let data: serde_json::Value = match serde_json::from_str(&result.stdout) {
            Ok(v) => v,
            Err(_) => return result.stdout.clone(),
        };
        let server = data.get("ServerVersion").and_then(|v| v.as_str()).unwrap_or("unknown");
        let driver = data.get("Driver").and_then(|v| v.as_str()).unwrap_or("unknown");
        let arch = data.get("Architecture").and_then(|v| v.as_str()).unwrap_or("unknown");
        let containers = data.get("Containers").and_then(|v| v.as_u64()).unwrap_or(0);
        let images = data.get("Images").and_then(|v| v.as_u64()).unwrap_or(0);
        format!("Server Version: {server}\nStorage Driver: {driver}\nArchitecture: {arch}\nContainers: {containers}\nImages: {images}\n")
    } else {
        result.stdout.clone()
    }
}

fn format_size(bytes: u64) -> String {
    if bytes >= 1_073_741_824 {
        format!("{:.2} GB", bytes as f64 / 1_073_741_824.0)
    } else if bytes >= 1_048_576 {
        format!("{:.2} MB", bytes as f64 / 1_048_576.0)
    } else if bytes >= 1024 {
        format!("{:.2} KB", bytes as f64 / 1024.0)
    } else {
        format!("{bytes} B")
    }
}

fn format_timestamp_from_value(val: &serde_json::Value) -> String {
    match val {
        serde_json::Value::Number(n) => {
            if let Some(ts) = n.as_i64() {
                // Convert Unix timestamp to date string using std
                let secs = ts as u64;
                let days = secs / 86400;

                // Simple date calculation from Unix epoch (1970-01-01)
                let mut year = 1970i64;
                let mut remaining_days = days as i64;
                loop {
                    let days_in_year = if is_leap_year(year) { 366 } else { 365 };
                    if remaining_days < days_in_year {
                        break;
                    }
                    remaining_days -= days_in_year;
                    year += 1;
                }
                let month_days = if is_leap_year(year) {
                    [31,29,31,30,31,30,31,31,30,31,30,31]
                } else {
                    [31,28,31,30,31,30,31,31,30,31,30,31]
                };
                let mut month = 1u32;
                for &md in &month_days {
                    if remaining_days < md as i64 {
                        break;
                    }
                    remaining_days -= md as i64;
                    month += 1;
                }
                let day = remaining_days + 1;
                format!("{year}-{month:02}-{day:02}")
            } else {
                n.to_string()
            }
        }
        serde_json::Value::String(s) => {
            if s.len() > 10 { s[..10].to_string() } else { s.clone() }
        }
        _ => String::new(),
    }
}

fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

// ==================== Socktainer Direct Query ====================

fn query_socktainer_path(parts: &[String]) -> Option<String> {
    if parts.len() < 2 {
        return None;
    }
    let subcmd = parts[1].as_str();
    match subcmd {
        "ps" => Some("/containers/json?all=true".to_string()),
        "images" => Some("/images/json".to_string()),
        "version" => Some("/version".to_string()),
        "info" => Some("/info".to_string()),
        "inspect" if parts.len() >= 3 => Some(format!("/containers/{}/json", parts[2])),
        "logs" if parts.len() >= 3 => Some(format!("/containers/{}/logs?stdout=true&stderr=true", parts[2])),
        "stats" => Some("/containers/json".to_string()),
        "volume" if parts.len() >= 3 && parts[2] == "ls" => Some("/volumes".to_string()),
        "network" if parts.len() >= 3 && parts[2] == "ls" => Some("/networks".to_string()),
        "system" if parts.len() >= 3 && parts[2] == "df" => Some("/system/df".to_string()),
        _ => None,
    }
}

async fn query_socktainer_api(api_path: &str) -> CommandResult {
    let socket_path = SOCKTAINER_SOCKET.to_string();
    let api_path = api_path.to_string();

    tokio::task::spawn_blocking(move || {
        log_to_file(&format!("Querying Socktainer: {api_path}"));
        // Connect to Unix socket and send HTTP request
        match std::os::unix::net::UnixStream::connect(&socket_path) {
            Ok(stream) => {
                use std::io::Write;
                let mut stream = stream;
                let request = format!("GET {api_path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
                if stream.write_all(request.as_bytes()).is_err() {
                    return CommandResult {
                        success: false,
                        stdout: String::new(),
                        stderr: "Failed to write to Socktainer socket".to_string(),
                    };
                }
                let mut response = String::new();
                if stream.read_to_string(&mut response).is_ok() {
                    // Extract body from HTTP response
                    let body = if let Some(pos) = response.find("\r\n\r\n") {
                        response[pos + 4..].to_string()
                    } else {
                        response
                    };
                    CommandResult {
                        success: true,
                        stdout: body,
                        stderr: String::new(),
                    }
                } else {
                    CommandResult {
                        success: false,
                        stdout: String::new(),
                        stderr: "Failed to read from Socktainer socket".to_string(),
                    }
                }
            }
            Err(e) => CommandResult {
                success: false,
                stdout: String::new(),
                stderr: format!("Failed to connect to Socktainer: {e}"),
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
async fn run_raw_command(command: String) -> CommandResult {
    let parts: Vec<String> = command.split_whitespace().map(String::from).collect();
    if parts.is_empty() {
        return CommandResult {
            success: false,
            stdout: String::new(),
            stderr: "Empty command".to_string(),
        };
    }

    let is_docker = parts[0] == "docker";
    let is_container = parts[0] == "container";

    // Check if this is a streaming command (logs -f, stats, etc.)
    let is_stream_cmd = parts.iter().any(|p| p == "-f" || p == "--follow") ||
        (parts.iter().any(|p| p == "logs" || p == "stats") && !parts.iter().any(|p| p == "--no-stream"));

    // If docker command and Socktainer is running, query Socktainer directly via HTTP
    // Skip Socktainer for streaming commands as it doesn't support follow mode
    if is_docker && is_socktainer_running() && !is_stream_cmd {
        let path = query_socktainer_path(&parts);
        if let Some(api_path) = path {
            let mut result = query_socktainer_api(&api_path).await;
            // Format the output like other docker commands
            let formatted = format_docker_output(&command, &result);
            result.stdout = formatted;
            return result;
        }
        // Fallback if we can't map the command
        return CommandResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Socktainer is running but command '{}' is not yet supported via Socktainer", command),
        };
    }

    // For docker/container commands, use container CLI
    if is_docker || is_container {
        let translated = if is_docker {
            translate_docker_command(&parts)
        } else {
            // Strip "container" prefix, pass rest directly
            parts[1..].to_vec()
        };

        if translated.is_empty() {
            return CommandResult {
                success: false,
                stdout: String::new(),
                stderr: "Empty command after translation".to_string(),
            };
        }

        let mut result = run_container_cmd_async(translated).await;

        // Format docker command output for better readability
        if is_docker {
            let formatted = format_docker_output(&command, &result);
            result.stdout = formatted;
        }

        return result;
    }

    // For other commands, execute directly as system command
    let path = "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:/usr/sbin:/sbin";
    tokio::task::spawn_blocking(move || {
        let output = Command::new(&parts[0])
            .args(&parts[1..])
            .env("PATH", path)
            .output();

        match output {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                CommandResult {
                    success: output.status.success(),
                    stdout,
                    stderr,
                }
            }
            Err(e) => CommandResult {
                success: false,
                stdout: String::new(),
                stderr: format!("Failed to execute command: {e}"),
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
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            system_start,
            system_stop,
            system_df,
            system_version,
            system_logs,
            list_containers,
            run_container,
            create_container,
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
            copy_from_container,
            copy_to_container,
            export_container,
            list_container_files,
            read_container_file,
            write_container_file,
            delete_container_file,
            make_container_dir,
            list_container_dirs,
            list_images,
            image_exists_locally,
            pull_image,
            push_image,
            delete_image,
            inspect_image,
            build_image,
            tag_image,
            save_image,
            load_image,
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
            run_machine_command,
            run_raw_command,
            run_container_cmd_stream,
            cancel_pull,
            open_url,
            open_terminal,
            get_docker_socket_path,
            is_socktainer_installed,
            is_socktainer_running,
            start_socktainer,
            stop_socktainer,
            get_socktainer_socket_path,
            export_volume,
            import_volume,
            export_migration,
            import_migration,
            docker_list_all,
            import_docker_image,
            import_docker_volume,
            import_docker_container,
        ])
        .setup(|app| {
            log_to_file("Tauri setup called");
            if let Some(_window) = app.get_webview_window("main") {
                log_to_file("Main window found");
            } else {
                log_to_file("WARNING: Main window not found");
            }
            // Start Docker-compatible socket server in app data directory
            let socket_dir = app.path().app_data_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
            let _ = std::fs::create_dir_all(&socket_dir);
            let socket_path = socket_dir.join("docker.sock");
            docker_proxy::start_docker_socket_server(&socket_path);

            // Auto-start Socktainer if installed and not running
            if is_socktainer_installed() && !is_socktainer_running() {
                log_to_file("Socktainer detected, auto-starting...");
                let result = start_socktainer();
                log_to_file(&format!("Socktainer auto-start: {}", result.stdout));
            } else if is_socktainer_running() {
                log_to_file("Socktainer already running");
            } else {
                log_to_file("Socktainer not installed, skipping");
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
