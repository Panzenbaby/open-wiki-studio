import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";
import type { Folder as FolderId } from "../../shared/ipc-types.ts";
import type { TreeNode } from "../fileTree.ts";

interface CtxPosition {
  readonly x: number;
  readonly y: number;
}

interface FileTreeProps {
  /** Children of the workspace root folder. */
  readonly nodes: readonly TreeNode[];
  readonly folder: FolderId;
  /** Selection key, e.g. "wiki/foo/bar.md" (matches `${folder}/${relativePath}`). */
  readonly selected: string | null;
  /** Set of expanded directory relative paths (folder-relative). */
  readonly expanded: ReadonlySet<string>;
  readonly onToggleDir: (relativePath: string) => void;
  readonly onSelectFile: (selectionKey: string) => void;
  /** Right-click handler; receives the node under the cursor + position. */
  readonly onContextMenu?: (node: TreeNode, position: CtxPosition) => void;
}

interface BranchProps {
  readonly node: TreeNode;
  readonly folder: FolderId;
  readonly selected: string | null;
  readonly expanded: ReadonlySet<string>;
  readonly onToggleDir: (relativePath: string) => void;
  readonly onSelectFile: (selectionKey: string) => void;
  readonly onContextMenu?: (node: TreeNode, position: CtxPosition) => void;
}

export function FileTree(props: FileTreeProps): JSX.Element {
  return (
    <ul className="tree" role="tree">
      {props.nodes.map((node) => (
        <TreeBranch
          key={node.relativePath}
          node={node}
          folder={props.folder}
          selected={props.selected}
          expanded={props.expanded}
          onToggleDir={props.onToggleDir}
          onSelectFile={props.onSelectFile}
          onContextMenu={props.onContextMenu}
        />
      ))}
    </ul>
  );
}

function TreeBranch(props: BranchProps): JSX.Element {
  const { node, folder, selected, expanded, onToggleDir, onSelectFile, onContextMenu } = props;
  const selectionKey = `${folder}/${node.relativePath}`;

  function handleContextMenu(event: React.MouseEvent): void {
    if (!onContextMenu) return;
    event.preventDefault();
    onContextMenu(node, { x: event.clientX, y: event.clientY });
  }

  if (node.isDirectory) {
    const isOpen = expanded.has(node.relativePath);
    const Chevron = isOpen ? ChevronDown : ChevronRight;
    const FolderIcon = isOpen ? FolderOpen : Folder;
    return (
      <li role="treeitem" aria-expanded={isOpen}>
        <div
          className="tree-node"
          style={{ cursor: "pointer" }}
          onClick={() => onToggleDir(node.relativePath)}
          onContextMenu={handleContextMenu}
        >
          <Chevron size={12} className="caret" style={{ width: 12, color: "var(--muted)" }} />
          <FolderIcon size={12} style={{ width: 12, color: "var(--muted)" }} />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {node.name}
          </span>
          <span className="tag">{node.children.length}</span>
        </div>
        {isOpen && node.children.length > 0 && (
          <ul className="tree-children" role="group">
            {node.children.map((child) => (
              <TreeBranch
                key={child.relativePath}
                node={child}
                folder={folder}
                selected={selected}
                expanded={expanded}
                onToggleDir={onToggleDir}
                onSelectFile={onSelectFile}
                onContextMenu={onContextMenu}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  const isSelected = selected === selectionKey;
  return (
    <li role="treeitem" aria-selected={isSelected}>
      <div
        className={`tree-node${isSelected ? " selected" : ""}`}
        onClick={() => onSelectFile(selectionKey)}
        onContextMenu={handleContextMenu}
      >
        <span style={{ width: 12, flexShrink: 0, display: "inline-block" }} />
        <FileText size={12} style={{ width: 12, color: "var(--muted)" }} />
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.name}
        </span>
      </div>
    </li>
  );
}