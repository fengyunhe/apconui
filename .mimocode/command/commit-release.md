---
description: "Commit all changes, tag a new version, and push to trigger GitHub Actions release. Use when user says '提交代码，发布一个版本', 'commit and release', or similar."
agent: main
---

# Commit & Release

Package the current changes into a release.

## Steps

1. **Check status**: Run `git status` and `git diff --stat` to understand what changed.
2. **Review recent tags**: Run `git tag --sort=-v:refname | head -5` to determine the next version number.
3. **Stage and commit**: `git add -A && git commit` with a clear message following the project's conventional commit style (e.g., `feat:`, `fix:`, `chore:`). If the user provides a specific message, use it exactly.
4. **Determine version**: If user specified a version (e.g., "v1.0.0"), use it. Otherwise, increment the latest tag's patch version (e.g., v0.3.0 → v0.3.1) unless the changes warrant a minor/major bump — ask if unclear.
5. **Tag**: `git tag <version>`
6. **Push**: `git push origin main --tags` (push commits and tags together).
7. **Report**: Confirm the push succeeded and note that GitHub Actions will automatically build and release the arm64 DMG.

## Notes

- This project uses `tauri-apps/tauri-action@v0` in GitHub Actions. Tag pattern `v*` triggers the release workflow.
- Only arm64 builds are produced (Apple silicon target).
- If the user says just "提交代码" (commit only, no release), skip steps 4-6 and only do `git add -A && git commit && git push`.
