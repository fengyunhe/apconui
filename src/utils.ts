import type { RawContainer, Container, RawImage, Image, RawNetwork, Network, RawVolume } from "./types";

export function parseJsonArray<T>(stdout: string): T[] {
  try {
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed)) return parsed;
    return [parsed];
  } catch {
    return [];
  }
}

export function mapContainers(raw: RawContainer[]): Container[] {
  return raw.map((c) => {
    const ref = c.configuration.image?.reference || "";
    const ip = c.status.networks?.[0]?.ipv4Address?.split("/")[0] || "";
    const args = c.configuration.initProcess?.arguments || [];
    const command = args.length > 0 ? args.join(" ") : "";
    const ports = (c.configuration.publishedPorts || []).map(p => {
      const proto = p.proto ? `/${p.proto}` : "";
      return p.hostPort && p.containerPort ? `${p.hostPort}:${p.containerPort}${proto}` : "";
    }).filter(Boolean).join(", ");
    return {
      id: c.configuration.id || "",
      image: ref,
      command,
      os: c.configuration.platform?.os || "",
      arch: c.configuration.platform?.architecture || "",
      state: c.status.state || "unknown",
      ip,
      ports,
      cpus: c.configuration.resources?.cpus || 0,
      memoryBytes: c.configuration.resources?.memoryInBytes || 0,
      created: c.configuration.creationDate?.split("T")[0] || "",
      labels: c.configuration.labels || {},
    };
  });
}

export function mapImages(raw: RawImage[]): Image[] {
  return raw.map((img) => {
    const fullName = img.configuration.name || "";
    const lastSlash = fullName.lastIndexOf("/");
    const namePart = lastSlash >= 0 ? fullName.substring(0, lastSlash) : "";
    const tagPart = lastSlash >= 0 ? fullName.substring(lastSlash + 1) : fullName;
    const colonIdx = tagPart.indexOf(":");
    const name = colonIdx >= 0 ? tagPart.substring(0, colonIdx) : tagPart;
    const tag = colonIdx >= 0 ? tagPart.substring(colonIdx + 1) : "latest";

    let totalSize = 0;
    const archSet = new Set<string>();
    let cmd: string[] | undefined;

    if (img.variants && img.variants.length > 0) {
      for (const v of img.variants) {
        totalSize += v.size || 0;
        if (v.platform?.architecture && v.platform.architecture !== "unknown") {
          archSet.add(v.platform.architecture);
        }
        if (!cmd && v.config?.config?.Cmd && v.config.config.Cmd.length > 0) {
          cmd = v.config.config.Cmd;
        }
      }
    } else {
      totalSize = img.configuration.descriptor?.size || 0;
    }

    return {
      name: namePart ? `${namePart}/${name}` : name,
      tag,
      digest: img.id ? img.id.substring(0, 12) : "",
      size: formatBytes(totalSize),
      created: img.configuration.creationDate?.split("T")[0],
      architectures: archSet.size > 0 ? Array.from(archSet) : undefined,
      cmd,
    };
  });
}

export function mapNetworks(raw: RawNetwork[]): Network[] {
  return raw.map((n) => ({
    name: n.configuration?.name || "",
    state: "running",
    subnet: n.status?.ipv4Subnet || "",
  }));
}

export function mapVolumes(raw: RawVolume[]): import("./types").Volume[] {
  return raw.map((v) => ({
    name: v.configuration?.name || v.id || "",
    driver: v.configuration?.driver || "",
    source: v.configuration?.source || "",
    size: v.configuration?.sizeInBytes ? `${(v.configuration.sizeInBytes / 1073741824).toFixed(1)} GB` : "",
  }));
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
