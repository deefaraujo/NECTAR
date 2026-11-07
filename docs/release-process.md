# Release process

NECTAR follows [Semantic Versioning](https://semver.org/). A release is a Git tag `vX.Y.Z`, an entry in [CHANGELOG.md](../CHANGELOG.md), and a GitHub release with the Windows build attached.

## Steps

1. Make sure `main` is clean and the checks pass:

   ```powershell
   npm ci
   npm run check:publication
   npm test
   npm run test:teamwork
   ```

2. Move the **Unreleased** entries in `CHANGELOG.md` under a new version heading with today's date, and update the compare links at the bottom.
3. Bump the version:

   ```powershell
   npm version X.Y.Z --no-git-tag-version
   ```

4. Commit with the message `Release vX.Y.Z`, then tag and push:

   ```powershell
   git tag -a vX.Y.Z -m "NECTAR vX.Y.Z"
   git push origin main --follow-tags
   ```

5. The [release workflow](../.github/workflows/release.yml) builds `NECTAR-X.Y.Z-win-x64.zip` on Windows and publishes the GitHub release with the changelog section as notes.

## Building locally

```powershell
npm run build
```

The zip lands in `dist/`. Builds are never committed.
