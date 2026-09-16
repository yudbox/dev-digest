/**
 * Agent manifest YAML generator.
 * Pure function; no I/O. Produces `.devdigest/agents/<slug>.yaml` content.
 */
import type { AgentManifestInput } from "@devdigest/shared";

/**
 * Serialize an agent manifest to YAML text. Uses a hand-rolled serializer
 * so we don't pull a YAML library into the generator (the output is simple
 * scalar + list structure). Skills are skill slugs, not ids.
 */
export function agentYaml(manifest: AgentManifestInput): string {
  const lines: string[] = [];

  // Scalar fields (order matches AgentManifest schema for readability)
  lines.push(`name: ${yamlString(manifest.name)}`);
  lines.push(`provider: ${manifest.provider ?? "openrouter"}`);
  lines.push(`model: ${yamlString(manifest.model)}`);

  // system_prompt: block scalar (|) for multiline safety
  const prompt = manifest.system_prompt ?? "";
  lines.push("system_prompt: |");
  for (const line of prompt.split("\n")) {
    lines.push(`  ${line}`);
  }

  // skills list (slugs)
  const skills = manifest.skills ?? [];
  if (skills.length === 0) {
    lines.push("skills: []");
  } else {
    lines.push("skills:");
    for (const slug of skills) {
      lines.push(`  - ${slug}`);
    }
  }

  lines.push(`strategy: ${manifest.strategy ?? "auto"}`);
  lines.push(`ci_fail_on: ${manifest.ci_fail_on ?? "critical"}`);

  return lines.join("\n") + "\n";
}

/** Quote a string if it contains special YAML characters. */
function yamlString(val: string): string {
  if (/[:#\[\]{}*&!|>'",\n]/.test(val)) {
    return JSON.stringify(val);
  }
  return val;
}
