// Version arithmetic for release zips: each segment counts 0-9, so the
// sequence goes 1.0.1, 1.0.2, ... 1.0.9, 1.1.0, ... 1.9.9, 2.0.0.
export function bumpVersion(version) {
  const m = /^(\d+)\.(\d)\.(\d)$/.exec(version);
  if (!m) throw new Error(`Unsupported version format: ${version} (expected major.minor.patch with single-digit minor/patch)`);
  let [major, minor, patch] = m.slice(1).map(Number);
  patch += 1;
  if (patch > 9) {
    patch = 0;
    minor += 1;
  }
  if (minor > 9) {
    minor = 0;
    major += 1;
  }
  return `${major}.${minor}.${patch}`;
}
