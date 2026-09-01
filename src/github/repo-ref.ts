import { type Result, ok, err } from "../result.js";

/** A public GitHub repository, identified only by owner and name. */
export type RepoRef = {
  readonly owner: string;
  readonly repo: string;
};

export type RepoRefFailure = {
  readonly kind: "invalid-input";
  /** Echoed back so the failure page can quote what was actually submitted. */
  readonly input: string;
};

/**
 * GitHub owner names: 1-39 characters of alphanumerics and hyphens, with no
 * leading or trailing hyphen.
 */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

/**
 * GitHub repository names: 1-100 characters of alphanumerics, hyphen,
 * underscore and dot. "." and ".." are excluded because they are path
 * segments, not names.
 */
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

const HOSTS = new Set(["github.com", "www.github.com"]);

/** The maximum length of input we will look at, before any parsing. */
const MAX_INPUT = 300;

/**
 * Accepts what a person is likely to paste: a browser URL from anywhere in a
 * repository, an SSH clone URL, or a bare "owner/name". Extra path segments
 * (/tree/main, /blob/main/package.json, /pull/12) are discarded -- only the
 * default branch is scanned in this slice, so a branch in the URL would be a
 * promise we do not keep.
 */
export function parseRepoRef(input: string): Result<RepoRef, RepoRefFailure> {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_INPUT) return err({ kind: "invalid-input", input });

  const path = extractPath(trimmed);
  if (path === null) return err({ kind: "invalid-input", input });

  const segments = path.split("/").filter((segment) => segment.length > 0);
  const owner = segments[0];
  const rawRepo = segments[1];
  if (owner === undefined || rawRepo === undefined) return err({ kind: "invalid-input", input });

  const repo = rawRepo.endsWith(".git") ? rawRepo.slice(0, -".git".length) : rawRepo;
  if (!OWNER.test(owner)) return err({ kind: "invalid-input", input });
  if (!REPO.test(repo) || repo === "." || repo === "..") return err({ kind: "invalid-input", input });

  return ok({ owner, repo });
}

/**
 * Reduces an accepted input form to the "owner/repo/..." path within
 * github.com, or null if the input names some other host.
 */
function extractPath(input: string): string | null {
  const ssh = /^git@github\.com:(.+)$/.exec(input);
  if (ssh?.[1] !== undefined) return ssh[1];

  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(input) || input.startsWith("//")) {
    let url: URL;
    try {
      url = new URL(input.startsWith("//") ? `https:${input}` : input);
    } catch {
      return null;
    }
    return HOSTS.has(url.hostname.toLowerCase()) ? url.pathname : null;
  }

  // Host-relative forms: "github.com/owner/repo" and bare "owner/repo".
  const withoutHost = /^(?:www\.)?github\.com\/(.*)$/i.exec(input);
  if (withoutHost?.[1] !== undefined) return withoutHost[1];
  if (input.includes(":")) return null;
  return input;
}

/** The canonical "owner/repo" form, used in URLs and as a display name. */
export function formatRepoRef(ref: RepoRef): string {
  return `${ref.owner}/${ref.repo}`;
}

export function repoHtmlUrl(ref: RepoRef): string {
  return `https://github.com/${ref.owner}/${ref.repo}`;
}
