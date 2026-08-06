#!/bin/sh
# Push a snapshot of the working tree to a backup branch WITHOUT touching the
# working tree, the index or HEAD.
#
# Long agent runs leave thousands of uncommitted lines in the tree for hours at
# a time, and this container is ephemeral. Committing that to the deploy branch
# would push half-written code to the live site; doing nothing risks losing it.
# So: build a commit object from a scratch index and push it to its own branch.
# Nothing here can disturb work in progress.
set -e
BRANCH="${1:-wip-snapshot}"
IDX="$(mktemp -d)/index"
export GIT_INDEX_FILE="$IDX"
git read-tree HEAD
git add -A
TREE=$(git write-tree)
unset GIT_INDEX_FILE
if [ "$TREE" = "$(git rev-parse HEAD^{tree})" ]; then
  echo "snapshot: tree identical to HEAD, nothing to save"
  exit 0
fi
COMMIT=$(git commit-tree "$TREE" -p HEAD -m "wip snapshot $(date -u +%Y-%m-%dT%H:%M:%SZ)")
for i in 1 2 3 4; do
  if git push -f origin "$COMMIT:refs/heads/$BRANCH" 2>&1; then
    echo "snapshot: pushed $COMMIT -> $BRANCH"
    exit 0
  fi
  sleep $((2 ** i))
done
echo "snapshot: push failed" >&2
exit 1
