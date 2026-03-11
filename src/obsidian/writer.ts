import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type StoredMadr = {
  context_and_problem: string;
  considered_options: string;
  decision_drivers: string;
  decision_outcome: string;
  generation_id: number;
  id: string;
  seq: number;
  status: string;
  supersedes_madr: string | null;
  timestamp: string;
  title: string;
};

function slugifyTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return slug.length === 0 ? "untitled" : slug;
}

export function getMadrVaultPath(vaultRoot: string, madrId: string, title: string): string {
  return path.resolve(vaultRoot, "Pythia", `${madrId}-${slugifyTitle(title)}.md`);
}

function renderFrontmatter(madr: StoredMadr): string {
  const drivers = JSON.parse(madr.decision_drivers) as string[];
  const options = JSON.parse(madr.considered_options) as string[];

  return [
    "---",
    `madr_id: ${madr.id}`,
    `title: ${madr.title}`,
    `status: ${madr.status}`,
    `timestamp: ${madr.timestamp}`,
    `generation_id: ${madr.generation_id}`,
    "context_and_problem: |",
    ...madr.context_and_problem.split("\n").map((line) => `  ${line}`),
    "decision_drivers:",
    ...drivers.map((driver) => `  - ${driver}`),
    "considered_options:",
    ...options.map((option) => `  - ${option}`),
    "decision_outcome: |",
    ...madr.decision_outcome.split("\n").map((line) => `  ${line}`),
    `supersedes_madr: ${madr.supersedes_madr ?? ""}`,
    "---"
  ].join("\n");
}

function renderAffectedFiles(impactsFiles: string[]): string {
  if (impactsFiles.length === 0) {
    return "";
  }

  return `*Files affected: ${impactsFiles.map((filePath) => `[[${filePath}]]`).join(", ")}*`;
}

export function renderMadrMarkdown(madr: StoredMadr, impactsFiles: string[]): string {
  const supersedesNotice = madr.supersedes_madr === null
    ? ""
    : `> ⚠️ This decision supersedes [[${madr.supersedes_madr}]]\n\n`;
  const affectedFiles = renderAffectedFiles(impactsFiles);

  return [
    renderFrontmatter(madr),
    "",
    `# ${madr.id} — ${madr.title}`,
    "",
    supersedesNotice.trimEnd(),
    supersedesNotice.length > 0 ? "" : "",
    "## Context and Problem",
    madr.context_and_problem,
    "",
    "## Decision Drivers",
    ...((JSON.parse(madr.decision_drivers) as string[]).map((driver) => `- ${driver}`)),
    "",
    "## Considered Options",
    ...((JSON.parse(madr.considered_options) as string[]).map((option) => `- ${option}`)),
    "",
    "## Decision Outcome",
    madr.decision_outcome,
    "",
    affectedFiles
  ].filter((line, index, lines) => !(line === "" && lines[index - 1] === "")).join("\n");
}

export class ObsidianWriter {
  async write(madr: StoredMadr, vaultRoot: string, impactsFiles: string[]): Promise<string> {
    const vaultPath = getMadrVaultPath(vaultRoot, madr.id, madr.title);
    const pythiaRoot = path.resolve(vaultRoot, "Pythia");

    if (!vaultPath.startsWith(`${pythiaRoot}${path.sep}`)) {
      throw new Error("Vault path escaped the Pythia directory");
    }

    await mkdir(pythiaRoot, { recursive: true });
    await writeFile(vaultPath, renderMadrMarkdown(madr, impactsFiles), "utf8");

    return vaultPath;
  }
}
