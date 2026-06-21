#!/usr/bin/env bash
#
# Build (if needed) and launch the macroracle Claude sandbox.
#
# Usage:
#   ./sandbox/run-sandbox.sh              # bash shell in the sandbox
#   ./sandbox/run-sandbox.sh claude       # new Claude session (skip-perms)
#   ./sandbox/run-sandbox.sh resume       # resume: interactive session picker
#   ./sandbox/run-sandbox.sh resume <id>  # resume a specific session
#   ./sandbox/run-sandbox.sh --rebuild …  # rebuild the image first
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE="macroracle-sandbox"
CONTAINER="claude-macroracle"
HOME_VOLUME="macroracle-claude-home"

REBUILD=0
if [[ "${1:-}" == "--rebuild" ]]; then REBUILD=1; shift; fi

if [[ "$REBUILD" == "1" ]] || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo ">> Building $IMAGE ..."
    docker build -t "$IMAGE" "$SCRIPT_DIR"
fi

if [[ "${1:-}" == "resume" ]]; then
    shift
    if [[ -n "${1:-}" ]]; then
        SID="$1"; shift
        CMD=(claude --dangerously-skip-permissions --resume "$SID" "$@")
    else
        CMD=(claude --dangerously-skip-permissions --resume)
    fi
elif [[ "${1:-}" == "claude" ]]; then
    shift
    CMD=(claude --dangerously-skip-permissions "$@")
elif [[ $# -gt 0 ]]; then
    CMD=("$@")
else
    CMD=(bash)
fi

DEPLOY_KEY="${MACRORACLE_DEPLOY_KEY:-$HOME/.ssh/macroracle-deploy}"
GIT_ARGS=()
if [[ -f "$DEPLOY_KEY" ]]; then
    GIT_ARGS+=(-v "$DEPLOY_KEY:/opt/macroracle-deploy-key:ro")
    GIT_ARGS+=(-e "GIT_SSH_COMMAND=ssh -i /opt/macroracle-deploy-key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new")
else
    echo ">> Note: no deploy key at $DEPLOY_KEY — 'git push' won't work in the sandbox."
fi

echo ">> Launching sandbox (workspace: $REPO_DIR)"
exec docker run --rm -it \
    --name "$CONTAINER" \
    "${GIT_ARGS[@]}" \
    -v "$REPO_DIR:/workspace/macroracle" \
    -v "$HOME_VOLUME:/home/node" \
    -w /workspace/macroracle \
    "$IMAGE" \
    "${CMD[@]}"
