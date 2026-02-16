export interface TemplateValues {
  name: string;
  description: string;
  acceptanceCriteria: string;
  dir: string;
  worktree: boolean;
  worktreePath: string;
  command: string;
}

export function buildCardTemplate(
  values: TemplateValues,
  metaOnly: boolean,
): string {
  const lines: string[] = [
    "# Tukan Card",
    "# Lines starting with # are ignored.",
    "# Save and quit (:wq) to apply, quit without saving (:q!) to cancel.",
    "",
    `Name: ${values.name}`,
  ];

  if (!metaOnly) {
    lines.push(`Working Directory: ${values.dir}`);
    lines.push(`Worktree: ${values.worktree ? "yes" : "no"}`);
    if (values.worktree) {
      lines.push(`Worktree Path: ${values.worktreePath}`);
    }
    lines.push(`Command: ${values.command}`);
  }

  lines.push("");
  lines.push("## Description");
  lines.push(values.description || "");
  lines.push("");
  lines.push("## Acceptance Criteria");
  lines.push(values.acceptanceCriteria || "");
  lines.push("");

  return lines.join("\n");
}

export interface ParsedTemplate {
  name?: string;
  description?: string;
  acceptanceCriteria?: string;
  dir?: string;
  worktree?: boolean;
  worktreePath?: string;
  command?: string;
}

export function parseCardTemplate(
  content: string,
  metaOnly: boolean,
): ParsedTemplate {
  const result: ParsedTemplate = {};
  const descMarker = "## Description";
  const criteriaMarker = "## Acceptance Criteria";
  const descIdx = content.indexOf(descMarker);
  const criteriaIdx = content.indexOf(criteriaMarker);

  // Parse header key-value pairs (before ## Description)
  const headerText = descIdx >= 0 ? content.slice(0, descIdx) : content;
  for (const line of headerText.split("\n")) {
    if (line.startsWith("#") || line.trim() === "") continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    switch (key) {
      case "Name":
        result.name = value;
        break;
      case "Working Directory":
        if (!metaOnly) result.dir = value;
        break;
      case "Worktree":
        if (!metaOnly) result.worktree = value === "yes";
        break;
      case "Worktree Path":
        if (!metaOnly) result.worktreePath = value;
        break;
      case "Command":
        if (!metaOnly && value) {
          result.command = value;
        }
        break;
    }
  }

  // Parse description
  if (descIdx >= 0) {
    const descStart = descIdx + descMarker.length;
    const descEnd = criteriaIdx >= 0 ? criteriaIdx : content.length;
    result.description = content.slice(descStart, descEnd).replace(/^\n/, "").trimEnd();
  }

  // Parse acceptance criteria
  if (criteriaIdx >= 0) {
    const criteriaStart = criteriaIdx + criteriaMarker.length;
    result.acceptanceCriteria = content.slice(criteriaStart).replace(/^\n/, "").trimEnd();
  }

  return result;
}
