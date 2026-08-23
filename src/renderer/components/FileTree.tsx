import { useCallback, useMemo, useRef, useState } from "react";
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
  /** Relative path of the tree's single tabbable row (roving tabindex). */
  readonly rovingPath: string | null;
  readonly registerItem: (relativePath: string, element: HTMLLIElement | null) => void;
}

/** The rows a user can actually see, in visual order: depth-first, descending
 *  only into expanded directories. Drives arrow-key navigation. */
function flattenVisible(
  nodes: readonly TreeNode[],
  expanded: ReadonlySet<string>,
): readonly TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (list: readonly TreeNode[]): void => {
    for (const node of list) {
      out.push(node);
      if (node.isDirectory && expanded.has(node.relativePath)) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

export function FileTree(props: FileTreeProps): JSX.Element {
  const { nodes, folder, selected, expanded, onToggleDir } = props;
  const visible = useMemo(() => flattenVisible(nodes, expanded), [nodes, expanded]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const items = useRef(new Map<string, HTMLLIElement>());

  const selectedPath =
    selected?.startsWith(`${folder}/`) === true ? selected.slice(folder.length + 1) : null;

  // The ARIA tree pattern wants exactly one tab stop for the whole tree. Prefer
  // the row the user last arrowed to, then the current selection, then the
  // first row — each only while it is still visible.
  const isVisible = (path: string | null): boolean =>
    path !== null && visible.some((node) => node.relativePath === path);
  const rovingPath = isVisible(activePath)
    ? activePath
    : isVisible(selectedPath)
      ? selectedPath
      : (visible[0]?.relativePath ?? null);

  // Stable identity: an inline callback would make every row's ref detach and
  // re-attach on each render.
  const registerItem = useCallback((relativePath: string, element: HTMLLIElement | null): void => {
    if (element) items.current.set(relativePath, element);
    else items.current.delete(relativePath);
  }, []);

  function focusItem(relativePath: string): void {
    setActivePath(relativePath);
    items.current.get(relativePath)?.focus();
  }

  /** Arrow-key navigation for the whole tree. Lives on the `tree` root because
   *  key events bubble from the focused `treeitem`, so the traversal logic
   *  stays in the one place that knows the flattened visible order. */
  function handleNavigation(event: React.KeyboardEvent): void {
    if (rovingPath === null) return;
    const index = visible.findIndex((node) => node.relativePath === rovingPath);
    if (index < 0) return;
    const node = visible[index];

    switch (event.key) {
      case "ArrowDown": {
        const next = visible[index + 1];
        if (next) focusItem(next.relativePath);
        break;
      }
      case "ArrowUp": {
        const previous = visible[index - 1];
        if (previous) focusItem(previous.relativePath);
        break;
      }
      case "ArrowRight": {
        if (!node.isDirectory) return;
        if (!expanded.has(node.relativePath)) onToggleDir(node.relativePath);
        else if (visible[index + 1]) focusItem(visible[index + 1].relativePath);
        break;
      }
      case "ArrowLeft": {
        if (node.isDirectory && expanded.has(node.relativePath)) {
          onToggleDir(node.relativePath);
          break;
        }
        const slash = node.relativePath.lastIndexOf("/");
        if (slash < 0) return;
        focusItem(node.relativePath.slice(0, slash));
        break;
      }
      case "Home": {
        if (visible[0]) focusItem(visible[0].relativePath);
        break;
      }
      case "End": {
        const last = visible[visible.length - 1];
        if (last) focusItem(last.relativePath);
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  }

  return (
    <ul className="tree" role="tree" onKeyDown={handleNavigation}>
      {nodes.map((node) => (
        <TreeBranch
          key={node.relativePath}
          node={node}
          folder={folder}
          selected={selected}
          expanded={expanded}
          onToggleDir={onToggleDir}
          onSelectFile={props.onSelectFile}
          onContextMenu={props.onContextMenu}
          rovingPath={rovingPath}
          registerItem={registerItem}
        />
      ))}
    </ul>
  );
}

function TreeBranch(props: BranchProps): JSX.Element {
  const {
    node, folder, selected, expanded,
    onToggleDir, onSelectFile, onContextMenu, rovingPath, registerItem,
  } = props;
  const selectionKey = `${folder}/${node.relativePath}`;
  const tabIndex = rovingPath === node.relativePath ? 0 : -1;
  const setItemRef = useCallback(
    (element: HTMLLIElement | null): void => registerItem(node.relativePath, element),
    [registerItem, node.relativePath],
  );

  function activateOnKey(event: React.KeyboardEvent, activate: () => void): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    activate();
  }

  function handleContextMenu(event: React.MouseEvent): void {
    if (!onContextMenu) return;
    event.preventDefault();
    event.stopPropagation();
    onContextMenu(node, { x: event.clientX, y: event.clientY });
  }

  if (node.isDirectory) {
    const isOpen = expanded.has(node.relativePath);
    const Chevron = isOpen ? ChevronDown : ChevronRight;
    const FolderIcon = isOpen ? FolderOpen : Folder;
    return (
      <li
        ref={setItemRef}
        role="treeitem"
        aria-expanded={isOpen}
        // Directories are toggled, not selected. `aria-selected` is only here
        // because jsx-a11y/role-has-required-aria-props treats it as required
        // on every treeitem.
        aria-selected={false}
        tabIndex={tabIndex}
        onClick={(event) => {
          event.stopPropagation();
          onToggleDir(node.relativePath);
        }}
        onKeyDown={(event) => activateOnKey(event, () => onToggleDir(node.relativePath))}
        onContextMenu={handleContextMenu}
      >
        <div className="tree-node" style={{ cursor: "pointer" }}>
          <Chevron size={12} className="caret" style={{ width: 12, color: "var(--muted)" }} />
          <FolderIcon size={12} style={{ width: 12, color: "var(--muted)" }} />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {node.name}
          </span>
          <span className="tag">{node.fileCount}</span>
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
                rovingPath={rovingPath}
                registerItem={registerItem}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  const isSelected = selected === selectionKey;
  return (
    <li
      ref={setItemRef}
      role="treeitem"
      aria-selected={isSelected}
      tabIndex={tabIndex}
      onClick={(event) => {
        event.stopPropagation();
        onSelectFile(selectionKey);
      }}
      onKeyDown={(event) => activateOnKey(event, () => onSelectFile(selectionKey))}
      onContextMenu={handleContextMenu}
    >
      <div className={`tree-node${isSelected ? " selected" : ""}`}>
        <span style={{ width: 12, flexShrink: 0, display: "inline-block" }} />
        <FileText size={12} style={{ width: 12, color: "var(--muted)" }} />
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.name}
        </span>
      </div>
    </li>
  );
}
