# Sourced by the release:* tasks that move the pending version on main.

# open_main_bump_pr <version> <reason>: opens a PR that sets the pending
# version on main to <version>. main is protected, so a PR is the only way in.
# An older open bump PR is closed, since merging it would move main backwards.
open_main_bump_pr() {
  local version="$1" reason="$2"
  local bump_branch="bump/v$version"
  local bump_namespace="${bump_branch%%/*}"

  set -x
  if git show-ref --verify --quiet "refs/heads/$bump_namespace"; then
    git branch -D "$bump_namespace"
  fi
  if git ls-remote --exit-code --heads origin "$bump_namespace" >/dev/null 2>&1; then
    git push origin --delete "$bump_namespace"
  fi
  git checkout -B "$bump_branch" origin/main
  mise run release:set-version "$version"
  git push --force --set-upstream origin "$bump_branch"
  set +x

  local pr_url
  pr_url=$(gh pr create --base main --head "$bump_branch" --title "bump: v$version" --body "Bump pending version on \`main\` to $version $reason." \
    || gh pr view "$bump_branch" --json url --jq .url)

  local stale
  for stale in $(gh pr list --base main --state open --json number,headRefName \
    --jq ".[] | select((.headRefName | startswith(\"bump/\")) and .headRefName != \"$bump_branch\") | .number"); do
    gh pr close "$stale" --delete-branch --comment "Superseded by $pr_url."
  done

  echo -e "Opened $pr_url bumping \x1b[36mmain\x1b[0m pending version to $version. Merge it once approved."
}
