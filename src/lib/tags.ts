import { existsSync } from "node:fs"
import { join } from "node:path"

export function getTags(dir: string): string {
  const tags: string[] = []
  const has = (f: string) => existsSync(join(dir, f))
  if (has(".git")) tags.push("git")
  if (has("package.json")) tags.push("node")
  if (has("pyproject.toml") || has("setup.py") || has("requirements.txt")) tags.push("py")
  if (has("Cargo.toml")) tags.push("rust")
  if (has("go.mod")) tags.push("go")
  if (has("CLAUDE.md")) tags.push("claude")
  if (has("Dockerfile") || has("docker-compose.yml") || has("docker-compose.yaml")) tags.push("docker")
  return tags.join(",")
}
