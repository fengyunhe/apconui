use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixListener;

const DOCKER_API_VERSION: &str = "1.45";

fn rand_u16() -> u16 {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let s = RandomState::new();
    let mut h = s.build_hasher();
    h.write_u64(std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64);
    h.finish() as u16
}

fn rand_u48() -> u64 {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let s = RandomState::new();
    let mut h = s.build_hasher();
    h.write_u64(std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64);
    h.finish() & 0xFFFFFFFFFFFF
}

pub fn start_docker_socket_server(socket_path: &Path) {
    let socket_path = socket_path.to_path_buf();
    if socket_path.exists() {
        let _ = std::fs::remove_file(&socket_path);
    }

    // Set DOCKER_HOST env var for all child processes
    let socket_str = socket_path.to_string_lossy().to_string();
    std::env::set_var("DOCKER_HOST", format!("unix://{socket_str}"));

    std::thread::spawn(move || {
        let rt = match tokio::runtime::Runtime::new() {
            Ok(r) => r,
            Err(e) => {
                eprintln!("Failed to create tokio runtime for Docker socket: {e}");
                return;
            }
        };

        rt.block_on(async move {
            let listener = match UnixListener::bind(&socket_path) {
                Ok(l) => l,
                Err(e) => {
                    eprintln!("Failed to bind Docker socket: {e}");
                    return;
                }
            };

            // Set permissions so Docker CLI can connect
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&socket_path, std::fs::Permissions::from_mode(0o666));
            }

            eprintln!("Docker-compatible socket listening on {}", socket_path.display());

            loop {
                match listener.accept().await {
                    Ok((stream, _)) => {
                        tokio::spawn(async move {
                            handle_connection(stream).await;
                        });
                    }
                    Err(e) => {
                        eprintln!("Docker socket accept error: {e}");
                    }
                }
            }
        });
    });
}

async fn handle_connection(stream: tokio::net::UnixStream) {
    let (mut reader, mut writer) = tokio::io::split(stream);

    // Read the entire request into a buffer
    let mut buf = Vec::new();
    let mut temp = [0u8; 4096];
    loop {
        match reader.read(&mut temp).await {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&temp[..n]);
                // Check if we have complete headers
                if let Some(_) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
            Err(_) => return,
        }
    }

    let request = String::from_utf8_lossy(&buf).to_string();
    let mut parts = request.split("\r\n");
    let request_line = match parts.next() {
        Some(l) => l,
        None => return,
    };

    let method_path: Vec<&str> = request_line.split_whitespace().collect();
    if method_path.len() < 2 {
        send_response(&mut writer, 400, "Bad Request", "{}").await;
        return;
    }

    let method = method_path[0];
    let path = method_path[1];

    let mut headers = HashMap::new();
    let mut body_start = 0;
    for line in parts {
        if line.is_empty() {
            body_start = request.find("\r\n\r\n").unwrap_or(request.len()) + 4;
            break;
        }
        if let Some((key, value)) = line.split_once(':') {
            headers.insert(key.trim().to_lowercase(), value.trim().to_string());
        }
    }

    let body = if let Some(content_length) = headers.get("content-length") {
        let expected: usize = content_length.parse().unwrap_or(0);
        let mut body_buf = vec![0u8; expected];
        let already = buf.len().saturating_sub(body_start);
        if already > 0 {
            let copy_len = already.min(expected);
            body_buf[..copy_len].copy_from_slice(&buf[body_start..body_start + copy_len]);
        }
        if already < expected {
            let _ = reader.read_exact(
                &mut body_buf[already..],
            ).await;
        }
        String::from_utf8_lossy(&body_buf).to_string()
    } else {
        String::new()
    };

    let response = route_request(method, path, &body).await;
    send_response(&mut writer, response.0, &response.1, &response.2).await;
}

async fn route_request(method: &str, path: &str, body: &str) -> (u16, &'static str, String) {
    match path {
        "/_ping" | "/v1.45/_ping" => (200, "OK", "OK".to_string()),
        "/_ping/version" => (200, "OK", "OK".to_string()),
        p if p.ends_with("/version") => handle_version().await,
        p if p.ends_with("/info") => handle_info().await,

        // Containers
        p if p.ends_with("/containers/json") && method == "GET" => handle_container_list().await,
        p if p.ends_with("/containers/create") && method == "POST" => handle_container_create(body).await,
        p if regex_match(p, r"/containers/[^/]+/json") && method == "GET" => {
            let id = extract_id(p, "/containers/", "/json");
            handle_container_inspect(&id).await
        }
        p if regex_match(p, r"/containers/[^/]+/start") && method == "POST" => {
            let id = extract_id(p, "/containers/", "/start");
            handle_container_start(&id).await
        }
        p if regex_match(p, r"/containers/[^/]+/stop") && method == "POST" => {
            let id = extract_id(p, "/containers/", "/stop");
            handle_container_stop(&id).await
        }
        p if regex_match(p, r"/containers/[^/]+/restart") && method == "POST" => {
            let id = extract_id(p, "/containers/", "/restart");
            handle_container_restart(&id).await
        }
        p if regex_match(p, r"/containers/[^/]+/kill") && method == "POST" => {
            let id = extract_id(p, "/containers/", "/kill");
            handle_container_kill(&id).await
        }
        p if regex_match(p, r"/containers/[^/]+/rename") && method == "POST" => {
            let id = extract_id(p, "/containers/", "/rename");
            let name = extract_query_param(path, "name");
            handle_container_rename(&id, &name).await
        }
        p if regex_match(p, r"/containers/[^/]+$") && method == "DELETE" => {
            let id = extract_id(p, "/containers/", "");
            let force = path.contains("force=true");
            handle_container_remove(&id, force).await
        }
        p if regex_match(p, r"/containers/[^/]+/logs") && method == "GET" => {
            let id = extract_id(p, "/containers/", "/logs");
            let tail = extract_query_param(path, "tail");
            handle_container_logs(&id, &tail).await
        }

        // Images
        p if p.ends_with("/images/json") && method == "GET" => handle_image_list().await,
        p if p.ends_with("/images/create") && method == "POST" => {
            let reference = extract_query_param(path, "fromImage");
            let tag = extract_query_param(path, "tag");
            let ref_str = if tag.is_empty() {
                reference
            } else {
                format!("{reference}:{tag}")
            };
            handle_image_pull(&ref_str).await
        }
        p if regex_match(p, r"/images/[^/]+$") && method == "DELETE" => {
            let name = extract_image_name(p);
            handle_image_remove(&name).await
        }
        p if regex_match(p, r"/images/[^/]+/json") && method == "GET" => {
            let name = extract_id(p, "/images/", "/json");
            handle_image_inspect(&name).await
        }
        p if p.ends_with("/build") && method == "POST" => handle_image_build(body).await,

        // Volumes
        p if p.ends_with("/volumes") && method == "GET" => handle_volume_list().await,
        p if p.ends_with("/volumes/create") && method == "POST" => handle_volume_create(body).await,
        p if regex_match(p, r"/volumes/[^/]+$") && method == "DELETE" => {
            let name = extract_id(p, "/volumes/", "");
            handle_volume_remove(&name).await
        }
        p if regex_match(p, r"/volumes/[^/]+/json") && method == "GET" => {
            let name = extract_id(p, "/volumes/", "/json");
            handle_volume_inspect(&name).await
        }

        // Networks
        p if p.ends_with("/networks") && method == "GET" => handle_network_list().await,
        p if p.ends_with("/networks/create") && method == "POST" => handle_network_create(body).await,
        p if regex_match(p, r"/networks/[^/]+$") && method == "DELETE" => {
            let id = extract_id(p, "/networks/", "");
            handle_network_remove(&id).await
        }
        p if regex_match(p, r"/networks/[^/]+") && method == "GET" => {
            let id = extract_id(p, "/networks/", "");
            handle_network_inspect(&id).await
        }

        // System
        p if p.ends_with("/system/df") && method == "GET" => handle_system_df().await,
        p if p.ends_with("/system/usage") && method == "GET" => handle_system_df().await,

        _ => (404, "Not Found", json!({"message": format!("Unknown endpoint: {path}")}).to_string()),
    }
}

// ==================== Container Handlers ====================

async fn handle_container_list() -> (u16, &'static str, String) {
    let result = run_cmd(vec!["ls".into(), "--format".into(), "json".into(), "--all".into()]).await;
    if !result.success {
        return (500, "Internal Server Error", json!({"message": result.stderr}).to_string());
    }

    let raw_containers: Vec<Value> = serde_json::from_str(&result.stdout).unwrap_or_default();

    let mut containers = Vec::new();
    for raw in &raw_containers {
        let id = raw.get("id").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
        let conf = raw.get("configuration").unwrap_or(&Value::Null);
        let st = raw.get("status").unwrap_or(&Value::Null);

        let image_ref = conf.get("image")
            .and_then(|v| v.get("reference"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        let state = st.get("state").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();

        let created = conf.get("creationDate").and_then(|v| v.as_str()).unwrap_or("").to_string();

        let name = st.get("networks")
            .and_then(|v| v.get(0))
            .and_then(|v| v.get("hostname"))
            .and_then(|v| v.as_str())
            .unwrap_or(&id)
            .to_string();

        let status_str = match state.as_str() {
            "running" => format!("Up since {}", st.get("startedDate").and_then(|v| v.as_str()).unwrap_or("")),
            "stopped" => "Exited".to_string(),
            s => s.to_string(),
        };

        containers.push(json!({
            "Id": id,
            "Names": [format!("/{}", name)],
            "Image": image_ref,
            "State": state,
            "Status": status_str,
            "Created": created,
            "Ports": "",
        }));
    }

    (200, "OK", serde_json::to_string(&containers).unwrap_or_default())
}

async fn handle_container_create(body: &str) -> (u16, &'static str, String) {
    let config: Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(e) => return (400, "Bad Request", json!({"message": e.to_string()}).to_string()),
    };

    let image = config.get("Image").and_then(|v| v.as_str()).unwrap_or("");
    let name = config.get("name").and_then(|v| v.as_str()).unwrap_or("");

    let mut args: Vec<String> = vec!["create".into()];
    if !name.is_empty() {
        args.push("--name".into());
        args.push(name.to_string());
    }
    // Add env vars
    if let Some(env) = config.get("Env").and_then(|v| v.as_array()) {
        for e in env {
            if let Some(s) = e.as_str() {
                args.push("-e".into());
                args.push(s.to_string());
            }
        }
    }
    args.push(image.to_string());

    let result = run_cmd(args).await;
    if !result.success {
        return (400, "Bad Request", json!({"message": result.stderr}).to_string());
    }

    let id = result.stdout.trim().to_string();
    (201, "Created", json!({"Id": id, "Warnings": []}).to_string())
}

async fn handle_container_inspect(id: &str) -> (u16, &'static str, String) {
    let result = run_cmd(vec!["inspect".into(), id.to_string()]).await;
    if !result.success {
        return (404, "Not Found", json!({"message": result.stderr}).to_string());
    }
    // Apple Container returns an array, Docker returns single object
    let parsed: Result<Vec<Value>, _> = serde_json::from_str(&result.stdout);
    match parsed {
        Ok(arr) if !arr.is_empty() => (200, "OK", arr[0].to_string()),
        _ => (200, "OK", result.stdout),
    }
}

async fn handle_container_start(id: &str) -> (u16, &'static str, String) {
    let result = run_cmd(vec!["start".into(), id.to_string()]).await;
    if result.success {
        (204, "No Content", String::new())
    } else {
        (500, "Internal Server Error", json!({"message": result.stderr}).to_string())
    }
}

async fn handle_container_stop(id: &str) -> (u16, &'static str, String) {
    let result = run_cmd(vec!["stop".into(), id.to_string()]).await;
    if result.success {
        (204, "No Content", String::new())
    } else {
        (500, "Internal Server Error", json!({"message": result.stderr}).to_string())
    }
}

async fn handle_container_restart(id: &str) -> (u16, &'static str, String) {
    let stop = run_cmd(vec!["stop".into(), id.to_string()]).await;
    if !stop.success {
        return (500, "Internal Server Error", json!({"message": stop.stderr}).to_string());
    }
    let start = run_cmd(vec!["start".into(), id.to_string()]).await;
    if start.success {
        (204, "No Content", String::new())
    } else {
        (500, "Internal Server Error", json!({"message": start.stderr}).to_string())
    }
}

async fn handle_container_kill(id: &str) -> (u16, &'static str, String) {
    let result = run_cmd(vec!["kill".into(), id.to_string()]).await;
    if result.success {
        (204, "No Content", String::new())
    } else {
        (500, "Internal Server Error", json!({"message": result.stderr}).to_string())
    }
}

async fn handle_container_rename(id: &str, name: &str) -> (u16, &'static str, String) {
    if name.is_empty() {
        return (400, "Bad Request", json!({"message": "name parameter required"}).to_string());
    }
    let result = run_cmd(vec!["rename".into(), id.to_string(), name.to_string()]).await;
    if result.success {
        (200, "OK", String::new())
    } else {
        (500, "Internal Server Error", json!({"message": result.stderr}).to_string())
    }
}

async fn handle_container_remove(id: &str, force: bool) -> (u16, &'static str, String) {
    let mut args: Vec<String> = vec!["rm".into()];
    if force {
        args.push("-f".into());
    }
    args.push(id.to_string());
    let result = run_cmd(args).await;
    if result.success {
        (204, "No Content", String::new())
    } else {
        (500, "Internal Server Error", json!({"message": result.stderr}).to_string())
    }
}

async fn handle_container_logs(id: &str, tail: &str) -> (u16, &'static str, String) {
    let mut args: Vec<String> = vec!["logs".into()];
    if !tail.is_empty() && tail != "all" {
        args.push("-n".into());
        args.push(tail.to_string());
    }
    args.push(id.to_string());
    let result = run_cmd(args).await;
    (200, "OK", json!({"message": result.stdout}).to_string())
}

// ==================== Image Handlers ====================

async fn handle_image_list() -> (u16, &'static str, String) {
    let result = run_cmd(vec!["image".into(), "ls".into(), "--format".into(), "json".into()]).await;
    if !result.success {
        return (500, "Internal Server Error", json!({"message": result.stderr}).to_string());
    }

    let raw_images: Vec<Value> = serde_json::from_str(&result.stdout).unwrap_or_default();

    let mut images = Vec::new();
    for raw in &raw_images {
        let id = raw.get("id").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
        let conf = raw.get("configuration").unwrap_or(&Value::Null);
        let name = conf.get("name").and_then(|v| v.as_str()).unwrap_or("<none>:<none>").to_string();
        let created = conf.get("creationDate").and_then(|v| v.as_str()).unwrap_or("").to_string();

        // Calculate total size from variants
        let size: u64 = raw.get("variants")
            .and_then(|v| v.as_array())
            .map(|variants| variants.iter()
                .filter_map(|v| v.get("size").and_then(|s| s.as_u64()))
                .sum())
            .unwrap_or(0);

        images.push(json!({
            "Id": id,
            "RepoTags": [name],
            "Created": created,
            "Size": size,
            "VirtualSize": size,
        }));
    }

    (200, "OK", serde_json::to_string(&images).unwrap_or_default())
}

async fn handle_image_pull(reference: &str) -> (u16, &'static str, String) {
    let result = run_cmd(vec!["image".into(), "pull".into(), reference.to_string()]).await;
    if result.success {
        (200, "OK", json!({"status": "Pull complete"}).to_string())
    } else {
        (500, "Internal Server Error", json!({"message": result.stderr}).to_string())
    }
}

async fn handle_image_remove(name: &str) -> (u16, &'static str, String) {
    let result = run_cmd(vec!["image".into(), "rm".into(), name.to_string()]).await;
    if result.success {
        (200, "OK", json!({"Deleted": name, "Untagged": name}).to_string())
    } else {
        (500, "Internal Server Error", json!({"message": result.stderr}).to_string())
    }
}

async fn handle_image_inspect(name: &str) -> (u16, &'static str, String) {
    let result = run_cmd(vec!["image".into(), "inspect".into(), name.to_string()]).await;
    if !result.success {
        return (404, "Not Found", json!({"message": result.stderr}).to_string());
    }
    let parsed: Result<Vec<Value>, _> = serde_json::from_str(&result.stdout);
    match parsed {
        Ok(arr) if !arr.is_empty() => (200, "OK", arr[0].to_string()),
        _ => (200, "OK", result.stdout),
    }
}

async fn handle_image_build(_body: &str) -> (u16, &'static str, String) {
    (200, "OK", json!({"stream": "Build not supported via socket API, use CLI"}).to_string())
}

// ==================== Volume Handlers ====================

async fn handle_volume_list() -> (u16, &'static str, String) {
    let result = run_cmd(vec!["volume".into(), "ls".into(), "--format".into(), "json".into()]).await;
    if !result.success {
        return (500, "Internal Server Error", json!({"message": result.stderr}).to_string());
    }

    let mut volumes = Vec::new();
    for line in result.stdout.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(raw) = serde_json::from_str::<Value>(line) {
            let name = raw.get("Name").or(raw.get("name"))
                .and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
            let driver = raw.get("Driver").or(raw.get("driver"))
                .and_then(|v| v.as_str()).unwrap_or("local").to_string();
            let created = raw.get("CreatedAt").or(raw.get("created_at"))
                .and_then(|v| v.as_str()).unwrap_or("").to_string();
            let mountpoint = raw.get("Mountpoint").or(raw.get("mountpoint"))
                .and_then(|v| v.as_str()).unwrap_or("").to_string();

            volumes.push(json!({
                "Name": name,
                "Driver": driver,
                "Mountpoint": mountpoint,
                "Created": created,
                "Labels": {},
                "Scope": "local",
            }));
        }
    }

    (200, "OK", json!({"Volumes": volumes, "Warnings": []}).to_string())
}

async fn handle_volume_create(body: &str) -> (u16, &'static str, String) {
    let config: Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(e) => return (400, "Bad Request", json!({"message": e.to_string()}).to_string()),
    };
    let name = config.get("Name").and_then(|v| v.as_str()).unwrap_or("unknown");

    let result = run_cmd(vec!["volume".into(), "create".into(), name.to_string()]).await;
    if result.success {
        (201, "Created", json!({"Name": name}).to_string())
    } else {
        (500, "Internal Server Error", json!({"message": result.stderr}).to_string())
    }
}

async fn handle_volume_remove(name: &str) -> (u16, &'static str, String) {
    let result = run_cmd(vec!["volume".into(), "rm".into(), name.to_string()]).await;
    if result.success {
        (204, "No Content", String::new())
    } else {
        (500, "Internal Server Error", json!({"message": result.stderr}).to_string())
    }
}

async fn handle_volume_inspect(name: &str) -> (u16, &'static str, String) {
    let result = run_cmd(vec!["volume".into(), "inspect".into(), name.to_string()]).await;
    if !result.success {
        return (404, "Not Found", json!({"message": result.stderr}).to_string());
    }
    let parsed: Result<Vec<Value>, _> = serde_json::from_str(&result.stdout);
    match parsed {
        Ok(arr) if !arr.is_empty() => (200, "OK", arr[0].to_string()),
        _ => (200, "OK", result.stdout),
    }
}

// ==================== Network Handlers ====================

async fn handle_network_list() -> (u16, &'static str, String) {
    let result = run_cmd(vec!["network".into(), "ls".into(), "--format".into(), "json".into()]).await;
    if !result.success {
        return (500, "Internal Server Error", json!({"message": result.stderr}).to_string());
    }

    let mut networks = Vec::new();
    for line in result.stdout.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(raw) = serde_json::from_str::<Value>(line) {
            let id = raw.get("ID").or(raw.get("id"))
                .and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
            let name = raw.get("Name").or(raw.get("name"))
                .and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
            let driver = raw.get("Driver").or(raw.get("driver"))
                .and_then(|v| v.as_str()).unwrap_or("bridge").to_string();
            let created = raw.get("CreatedAt").or(raw.get("created_at"))
                .and_then(|v| v.as_str()).unwrap_or("").to_string();

            networks.push(json!({
                "Id": id,
                "Name": name,
                "Driver": driver,
                "Created": created,
                "Scope": "local",
                "Labels": {},
            }));
        }
    }

    (200, "OK", serde_json::to_string(&networks).unwrap_or_default())
}

async fn handle_network_create(body: &str) -> (u16, &'static str, String) {
    let config: Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(e) => return (400, "Bad Request", json!({"message": e.to_string()}).to_string()),
    };
    let name = config.get("Name").and_then(|v| v.as_str()).unwrap_or("unknown");

    let result = run_cmd(vec!["network".into(), "create".into(), name.to_string()]).await;
    if result.success {
        let id = result.stdout.trim().to_string();
        (201, "Created", json!({"Id": id}).to_string())
    } else {
        (500, "Internal Server Error", json!({"message": result.stderr}).to_string())
    }
}

async fn handle_network_remove(id: &str) -> (u16, &'static str, String) {
    let result = run_cmd(vec!["network".into(), "rm".into(), id.to_string()]).await;
    if result.success {
        (204, "No Content", String::new())
    } else {
        (500, "Internal Server Error", json!({"message": result.stderr}).to_string())
    }
}

async fn handle_network_inspect(id: &str) -> (u16, &'static str, String) {
    let result = run_cmd(vec!["network".into(), "inspect".into(), id.to_string()]).await;
    if !result.success {
        return (404, "Not Found", json!({"message": result.stderr}).to_string());
    }
    let parsed: Result<Vec<Value>, _> = serde_json::from_str(&result.stdout);
    match parsed {
        Ok(arr) if !arr.is_empty() => (200, "OK", arr[0].to_string()),
        _ => (200, "OK", result.stdout),
    }
}

// ==================== System Handlers ====================

async fn handle_version() -> (u16, &'static str, String) {
    let result = run_cmd(vec!["--version".into()]).await;
    let version_str = if result.success {
        result.stdout.trim().to_string()
    } else {
        "0.0.0".to_string()
    };
    let version = version_str.split_whitespace().last().unwrap_or("0.0.0");

    (200, "OK", json!({
        "Platform": {"Name": "Apple Container"},
        "Components": [{
            "Name": "Engine",
            "Version": version,
            "Details": {"ApiVersion": DOCKER_API_VERSION}
        }],
        "Version": version,
        "ApiVersion": DOCKER_API_VERSION,
        "MinAPIVersion": "1.24",
        "GoVersion": "N/A",
        "Os": "darwin",
        "Arch": std::env::consts::ARCH,
        "BuildTime": "",
        "KernelVersion": "",
    }).to_string())
}

async fn handle_info() -> (u16, &'static str, String) {
    let _result = run_cmd(vec!["system".into(), "df".into(), "--format".into(), "json".into()]).await;

    (200, "OK", json!({
                "ID": format!("{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs() as u32,
                    rand_u16(), rand_u16(), rand_u16(), rand_u48()),
        "Containers": 0,
        "ContainersRunning": 0,
        "ContainersStopped": 0,
        "Images": 0,
        "Driver": "apple-container",
        "DockerRootDir": "/var/lib/container",
        "OperatingSystem": "darwin",
        "Architecture": std::env::consts::ARCH,
        "NCPU": num_cpus(),
        "MemTotal": 0,
        "ServerVersion": "0.4.0",
        "Labels": ["provider=apple-container"],
        "SystemStatus": [["Context", "default"]],
    }).to_string())
}

async fn handle_system_df() -> (u16, &'static str, String) {
    let result = run_cmd(vec!["system".into(), "df".into(), "--format".into(), "json".into()]).await;
    if result.success {
        (200, "OK", result.stdout)
    } else {
        (200, "OK", json!({"LayersSize": 0, "Images": [], "Containers": [], "Volumes": []}).to_string())
    }
}

// ==================== Helpers ====================

async fn run_cmd(args: Vec<String>) -> CommandResult {
    let cmd_str = args.join(" ");
    eprintln!("[docker-proxy] Running: container {cmd_str}");

    tokio::task::spawn_blocking(move || {
        let path = "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin";
        let cmd = args[0].clone();
        let rest: Vec<String> = args[1..].to_vec();

        match Command::new("/usr/local/bin/container")
            .arg(&cmd)
            .args(&rest)
            .env("PATH", path)
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
                stderr: format!("Failed to execute: {e}"),
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

#[derive(Debug)]
struct CommandResult {
    success: bool,
    stdout: String,
    stderr: String,
}

fn regex_match(s: &str, pattern: &str) -> bool {
    let pattern = pattern.trim_start_matches('^').trim_end_matches('$');
    let s_parts: Vec<&str> = s.split('/').filter(|p| !p.is_empty()).collect();

    // Parse pattern, handling wildcards like [^/]+ that contain /
    let mut pattern_parts: Vec<String> = Vec::new();
    let mut i = 0;
    let bytes = pattern.as_bytes();
    while i < bytes.len() {
        if bytes[i] == b'/' {
            i += 1;
            continue;
        }
        if bytes[i] == b'[' {
            // Find matching ] and include any following quantifier like +
            let start = i;
            while i < bytes.len() && bytes[i] != b']' {
                i += 1;
            }
            if i < bytes.len() {
                i += 1; // skip ]
            }
            // Check for quantifier after ]
            if i < bytes.len() && (bytes[i] == b'+' || bytes[i] == b'*' || bytes[i] == b'?') {
                i += 1;
            }
            pattern_parts.push(pattern[start..i].to_string());
        } else {
            let start = i;
            while i < bytes.len() && bytes[i] != b'/' {
                i += 1;
            }
            pattern_parts.push(pattern[start..i].to_string());
        }
    }

    if pattern_parts.len() != s_parts.len() {
        return false;
    }

    for (pp, sp) in pattern_parts.iter().zip(s_parts.iter()) {
        if pp.starts_with('[') && pp.ends_with(']') || pp.ends_with('+') || pp.ends_with('*') || pp.ends_with('?') {
            continue;
        }
        if pp != sp {
            return false;
        }
    }
    true
}

fn extract_id(path: &str, prefix: &str, suffix: &str) -> String {
    let without_prefix = path.strip_prefix(prefix).unwrap_or(path);
    let without_suffix = if suffix.is_empty() {
        without_prefix.to_string()
    } else {
        without_prefix.strip_suffix(suffix).unwrap_or(without_prefix).to_string()
    };
    // Also strip query parameters
    without_suffix.split('?').next().unwrap_or(&without_suffix).to_string()
}

fn extract_image_name(path: &str) -> String {
    let name = extract_id(path, "/images/", "");
    // URL decode
    name.replace("%2F", "/").replace("%3A", ":")
}

fn extract_query_param(path: &str, param: &str) -> String {
    if let Some(query) = path.split('?').nth(1) {
        for pair in query.split('&') {
            if let Some((key, value)) = pair.split_once('=') {
                if key == param {
                    return value.to_string();
                }
            }
        }
    }
    String::new()
}

fn num_cpus() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
}

async fn send_response(
    stream: &mut (impl tokio::io::AsyncWrite + Unpin),
    status: u16,
    _status_text: &str,
    body: &str,
) {
    let status_line = match status {
        200 => "HTTP/1.1 200 OK",
        201 => "HTTP/1.1 201 Created",
        204 => "HTTP/1.1 204 No Content",
        400 => "HTTP/1.1 400 Bad Request",
        404 => "HTTP/1.1 404 Not Found",
        500 => "HTTP/1.1 500 Internal Server Error",
        _ => "HTTP/1.1 200 OK",
    };

    let content_type = if body.is_empty() {
        "text/plain"
    } else {
        "application/json"
    };

    let response = if body.is_empty() {
        format!("{status_line}\r\nContent-Type: {content_type}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
    } else {
        format!(
            "{status_line}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    };

    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.flush().await;
}
