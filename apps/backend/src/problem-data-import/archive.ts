import { isValidFilename } from "../common/validators";

/** One file entry read from an uploaded archive, as needed to plan its destination name. */
export interface ArchiveEntry {
  /** The path as stored in the archive, using `/` as the separator. */
  path: string;
  /** The uncompressed size of the entry in bytes. */
  size: number;
}

/** A planned testdata file: the flat problem-file name and the archive entry it comes from. */
export interface PlannedArchiveFile {
  /** The resulting filename inside the problem's testdata. Never contains `/`. */
  name: string;
  /** The original archive path, kept for error reporting and to locate the entry's content. */
  entryPath: string;
}

/**
 * Splits an archive path into its non-trivial segments.
 *
 * Empty segments (from a leading/trailing slash or doubled slashes) and `.` segments are dropped. A `..` segment is
 * rejected outright: it cannot be represented as a flat problem file, and accepting it would let an archive escape its
 * own root.
 */
function splitArchivePath(path: string): string[] {
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") throw new Error(`Archive entry ${JSON.stringify(path)} contains a parent directory segment`);
    segments.push(segment);
  }
  return segments;
}

/**
 * Maps the files of an uploaded archive to flat testdata filenames.
 *
 * A single common top-level directory is stripped when *every* entry is nested under it (each entry has at least two
 * segments and they all share the first one); zips are commonly packed that way. Every remaining path is then
 * flattened by joining its segments with `_`, so the result only ever contains flat names accepted by
 * {@link isValidFilename}. The input order is preserved.
 *
 * @throws If an entry contains `..`, if a resulting name is empty or not a valid filename, or if two entries map to
 * the same name.
 */
export function planArchiveEntries(entries: ArchiveEntry[]): PlannedArchiveFile[] {
  const segmentsPerEntry = entries.map(entry => splitArchivePath(entry.path));

  let stripTopLevel = entries.length > 0 && segmentsPerEntry.every(segments => segments.length >= 2);
  if (stripTopLevel) {
    const topLevel = segmentsPerEntry[0][0];
    stripTopLevel = segmentsPerEntry.every(segments => segments[0] === topLevel);
  }

  const usedNames = new Map<string, string>();
  const planned: PlannedArchiveFile[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const segments = stripTopLevel ? segmentsPerEntry[i].slice(1) : segmentsPerEntry[i];

    if (segments.length === 0) throw new Error(`Archive entry ${JSON.stringify(entry.path)} has no filename`);

    const name = segments.join("_");
    if (!isValidFilename(name))
      throw new Error(`Archive entry ${JSON.stringify(entry.path)} maps to invalid filename ${JSON.stringify(name)}`);

    const conflict = usedNames.get(name);
    if (conflict != null) {
      const conflictingEntries = `${JSON.stringify(conflict)} and ${JSON.stringify(entry.path)}`;
      throw new Error(`Archive entries ${conflictingEntries} map to the same filename ${JSON.stringify(name)}`);
    }

    usedNames.set(name, entry.path);
    planned.push({ name, entryPath: entry.path });
  }

  return planned;
}
