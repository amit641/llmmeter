# Changesets

This directory contains [changesets](https://github.com/changesets/changesets) for the llmmeter monorepo.

When you make a user-visible change, run:

```sh
pnpm changeset
```

Pick the affected packages, the bump type (patch/minor/major), and write a one-line summary. The release workflow will batch unreleased changesets into a single "Version Packages" PR; merging that PR publishes to npm.
