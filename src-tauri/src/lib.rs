use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};
use tauri::{Emitter, Manager};

mod docker_proxy;

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

static PULL_CANCELLED: AtomicBool = AtomicBool::new(false);
static PULL_PID: AtomicU32 = AtomicU32::new(0);

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

#[tauri::command]
fn cancel_pull() -> CommandResult {
    let pid = PULL_PID.load(Ordering::SeqCst);
    if pid == 0 {
        return CommandResult {
            success: false,
            stdout: String::new(),
            stderr: "No pull in progress".to_string(),
        };
    }

    // Set cancellation flag - the pull loop will check this and kill the process
    PULL_CANCELLED.store(true, Ordering::SeqCst);

    // Also kill the process directly as a backup
    let _ = unsafe {
        libc::kill(-(pid as i32), libc::SIGTERM)
    };

    CommandResult {
        success: true,
        stdout: "Pull cancellation requested".to_string(),
        stderr: String::new(),
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

    // Reset cancellation flag
    PULL_CANCELLED.store(false, Ordering::SeqCst);

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
        PULL_PID.store(child.id(), Ordering::SeqCst);

        let stderr = child.stderr.take().unwrap();
        let reader = BufReader::new(stderr);
        let mut last_progress = String::new();

        for line in reader.lines() {
            // Check if cancelled
            if PULL_CANCELLED.load(Ordering::SeqCst) {
                log_to_file("Pull cancelled by user");
                let _ = child.kill();
                let _ = app.emit("pull-complete", false);
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

        // Clear PID
        PULL_PID.store(0, Ordering::SeqCst);

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

    // If docker command and Socktainer is running, query Socktainer directly via HTTP
    if is_docker && is_socktainer_running() {
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

    // Translate Docker commands to Apple Container commands
    let translated = if parts[0] == "docker" {
        translate_docker_command(&parts)
    } else if parts[0] == "container" {
        // Strip "container" prefix, pass rest directly
        parts[1..].to_vec()
    } else {
        parts
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

    result
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
            cancel_pull,
            open_url,
            get_docker_socket_path,
            is_socktainer_installed,
            is_socktainer_running,
            start_socktainer,
            stop_socktainer,
            get_socktainer_socket_path,
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
