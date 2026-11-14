# Private deployment repositories

Keep reusable application code in this public repository and personal configuration in a separate **private** repository. Each employee can maintain their own configuration repo and Apps Script instance. The template is in `templates/config-repo/`.

The private repo contains:

- `config.json`: owner, management recipients, Staff Calendar ID, HR system name, fiscal year, schedule, holidays and policy.
- `target.json`: existing Apps Script project ID, deployment ID and canonical web app URL. These identifiers are routing metadata, not credentials.
- `sources/workbooks/`: original Excel workbooks, with names and bytes preserved.
- `sources/inventory.json`: fiscal years, filenames and SHA-256 checksums.
- `instance.json`: paths and the latest source FY used as the history anchor.
- `app.lock.json`: public source URL and a full commit SHA.

OAuth credentials stay outside both repositories. Generated imports, the application checkout, `.venv`, `.env`, clasp bindings and bundles stay in ignored `local/app/`. Source workbooks are intentionally versioned only in the private repo. They are excluded from Docker build contexts and CI artifacts. The original source folder is retained as a backup.

## Separate an existing installation

First complete the normal CLI setup and import configuration in your application checkout. Requirements: Node 24.11.1+, zsh, uv 0.9.5+, Git, Docker and `docker-compose`. The existing `.env`, `.clasp.json` and `local/deployment.json` supply settings and the deployment target. This initializer requires one `fyYYYY...xlsx` file per source year, including the current configured FY. The filename overrides stale internal year headers.

```sh
node scripts/instance.ts init \
  --instance ../dayoff-config \
  --workbooks /path/to/original-workbooks \
  --dry-run
node scripts/instance.ts init \
  --instance ../dayoff-config \
  --workbooks /path/to/original-workbooks
cd ../dayoff-config
git init -b main
git add .
git commit -m 'Initialize private deployment configuration'
gh repo create OWNER/dayoff-config --private --source . --remote origin
gh repo view OWNER/dayoff-config --json visibility
# Verify PRIVATE before uploading personal source files.
git push -u origin main
./scripts/test.sh
./scripts/bootstrap.sh
./scripts/deploy.sh --dry-run
./scripts/deploy.sh
```

The initializer pins the current public checkout's commit, so commit and push reusable changes before initializing. It copies only declarative configuration, selected target metadata, the generic template and original workbooks. It never copies authorization files or a live ledger. Bootstrap regenerates imports; deployment reuses the same project and deployment rather than creating a second instance. Existing Script Properties, ledger, reminder links and event ownership remain attached to that project. Deployment alone does not import history, recreate charges or change recorded HR entry status.

## Configuration and code updates

Run subsequent operations from the private repo. Edit `config.json`, review changes privately and commit them, then use `./scripts/update.sh --dry-run` followed by `./scripts/update.sh`. Connection changes can also use `node local/app/scripts/configure.ts --config config.json` with the documented configuration flags. Do not run deployment from the old checkout after switching; it retains its old local inputs.

To update application code, choose a reviewed full public commit SHA:

```sh
./scripts/build.sh --app-revision FULL_COMMIT_SHA
./scripts/test.sh
git add app.lock.json
git commit -m 'Update pinned application revision'
./scripts/update.sh --dry-run
./scripts/update.sh
```

Public pushes do not automatically upgrade this instance. Deployment descriptions include both application and configuration revisions when the private repository has a commit. To roll code back, pin a previous reviewed revision that supports the existing ledger schema; do not revert imported records or their migrations.

Workbook changes require review and `./scripts/inventory.sh` before commit. Rebuilding source snapshots does not reconcile already imported current-year charges automatically. Keep the workbook-derived policy snapshot when updating an existing installation. Carryover, active-year corrections and fiscal rollover require separate review as described in [operations](operations.md).

`./scripts/teardown.sh --dry-run` previews removal; `./scripts/teardown.sh` disables delivery and removes the web deployment while retaining the private ledger and source workbooks.

## Recover a workstation

Clone the private repo and reinstall the listed tools. Run `./scripts/bootstrap.sh` and `./scripts/test.sh`, then sign in with the existing Google account using `(cd local/app && npx --no-install clasp login)` before deploying. Bootstrap rebuilds local files from the pinned source and original workbooks. A separate public checkout is useful for application development; deployment should continue from the private repo.

The running app, live ledger, Script Properties and reminder triggers remain in Google. **Do not initialize a new ledger or delete Script Properties during machine recovery.** New ledger creation requires typing `CREATE NEW LEDGER` and is rejected if a ledger binding or retained ledger metadata exists. There is no overwrite override. See [ledger protection and backups](operations.md#backups-teardown-and-rollover). The Git repos preserve code, settings and original workbooks, not subsequent live journal entries.

## CI and optional GitOps

Private-repo checks verify repository visibility, configuration, target identifiers and workbook hashes. Read-only container checks collate original sources and reconcile current-year monthly totals with cached annual totals. They also run the pinned application's lint, format, type and unit tests. Checks print status and counts, not attendance values. No private bundles or sources are uploaded as artifacts.

The generated workflow deploys only after `DAYOFF_GITOPS_ENABLED=true` is explicitly configured. For unattended deployment, create a GitHub environment named `dayoff` and add the `CLASP_AUTH_JSON` environment secret from an external credential file through stdin. The private repo already supplies configuration and original workbooks, so duplicate configuration/import secrets are unnecessary. Authentication is restored temporarily and removed after the job. Manual dispatch defaults to dry run; deployment and teardown are serialized. Leave the variable unset for CLI-only deployment.

The public repo's separate optional workflow remains available for installations that keep private configuration in encrypted secrets. Use one deployment workflow per instance to avoid competing configurations. See [CLI/GitOps operation](gitops.md).
