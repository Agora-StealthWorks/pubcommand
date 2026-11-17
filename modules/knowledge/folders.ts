/** Folder paths ("Resources/Experts") into a tree for the Brain sidebar. */

export type FolderNode = {
  name: string;
  path: string;
  /** Notes directly in this folder. */
  count: number;
  /** Notes in this folder and below. */
  total: number;
  children: FolderNode[];
};

export function normalizeFolder(value: string | null | undefined): string | null {
  if (!value) return null;
  const clean = value
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/")
    .slice(0, 300);
  return clean || null;
}

export function buildFolderTree(rows: readonly { folder: string | null; count: number }[]): FolderNode[] {
  const root: FolderNode = { name: "", path: "", count: 0, total: 0, children: [] };
  for (const row of rows) {
    const folder = normalizeFolder(row.folder);
    root.total += row.count;
    if (!folder) {
      root.count += row.count;
      continue;
    }
    let node = root;
    const parts = folder.split("/");
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      let child = node.children.find((item) => item.path === path);
      if (!child) {
        child = { name: part, path, count: 0, total: 0, children: [] };
        node.children.push(child);
      }
      child.total += row.count;
      if (index === parts.length - 1) child.count += row.count;
      node = child;
    });
  }
  const sort = (nodes: FolderNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach((node) => sort(node.children));
  };
  sort(root.children);
  return root.children;
}

/** "Resources/Experts" -> ["Resources", "Resources/Experts"], for breadcrumbs and open folders. */
export function folderAncestors(folder: string | null): string[] {
  const clean = normalizeFolder(folder);
  if (!clean) return [];
  const parts = clean.split("/");
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}
